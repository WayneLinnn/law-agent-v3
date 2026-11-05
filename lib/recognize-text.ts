import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

const MAX_EDGE = 2000;
const SCRIPT = path.join(process.cwd(), "scripts", "ocr-image.ps1");

export function tightenRecognized(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/([^\u0000-\u007f])[ \t]+(?=[^\u0000-\u007f])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function toPng(bytes: Uint8Array) {
  const image = await loadImage(Buffer.from(bytes));
  const edge = Math.max(image.width, image.height);
  const scale = edge > MAX_EDGE ? MAX_EDGE / edge : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("没有画布。");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toBuffer("image/png");
}

export async function recognizeImages(pngs: Buffer[]) {
  if (pngs.length === 0) return [];
  const dir = await mkdtemp(path.join(os.tmpdir(), "law-ocr-"));
  const images = pngs.map((_, index) => path.join(dir, `${index}.png`));
  const out = path.join(dir, "out.txt");
  try {
    await Promise.all(pngs.map((png, index) => writeFile(images[index], png)));
    await run(SCRIPT, ["-Out", out, ...images]);
    const raw = await readFile(out, "utf8");
    const parts = raw.split("\f");
    return pngs.map((_, index) => tightenRecognized(parts[index] ?? ""));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function recognizePdfPages(pdf: Uint8Array, pages: number[]) {
  if (pages.length === 0) return [];
  const dir = await mkdtemp(path.join(os.tmpdir(), "law-pdf-"));
  const file = path.join(dir, "scan.pdf");
  const out = path.join(dir, "out.txt");
  try {
    await writeFile(file, pdf);
    await run(path.join(process.cwd(), "scripts", "ocr-pdf-pages.ps1"), [
      "-Pdf",
      file,
      "-Out",
      out,
      "-Pages",
      pages.join(","),
    ]);
    const raw = await readFile(out, "utf8");
    const parts = raw.split("\f");
    return pages.map((_, index) => tightenRecognized(parts[index] ?? ""));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(script: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script, ...args], {
      windowsHide: true,
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("识别超时。"));
    }, 90_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "没有识别出文字。"));
    });
  });
}
