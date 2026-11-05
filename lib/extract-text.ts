import "server-only";

import mammoth from "mammoth";
import { extractText } from "unpdf";
import * as XLSX from "xlsx";

import { MAX_STORED, storePages, type StoredPage } from "@/lib/long-text";
import { recognizeImages, recognizePdfPages, toPng } from "@/lib/recognize-text";

export type Extracted = { kind: string; text: string; note: string };

const MAX_TEXT = MAX_STORED;
const THIN_PAGE = 20;
const OCR_BATCH = 12;
const CHECK_NOTE = "文字由系统识别，请核对。";

export async function extractUpload(filename: string, bytes: Uint8Array): Promise<Extracted> {
  const lower = filename.toLowerCase();
  if (/\.(txt|md|csv)$/.test(lower)) return pack("文本", decode(bytes), "这份文件里没有读到字。");
  if (/\.docx$/.test(lower)) {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return pack("Word", result.value, "这份 Word 里没有读到字。");
  }
  if (/\.doc$/.test(lower)) {
    return { kind: "Word", text: "", note: "旧版 .doc 读不了，请另存为 .docx。" };
  }
  if (/\.pdf$/.test(lower)) return extractPdf(bytes);
  if (/\.(xlsx|xls)$/.test(lower)) {
    const book = XLSX.read(Buffer.from(bytes), { type: "buffer" });
    const text = book.SheetNames.map((name) => {
      const sheet = book.Sheets[name];
      return `${name}\n${sheet ? XLSX.utils.sheet_to_csv(sheet) : ""}`;
    }).join("\n\n");
    return pack("表格", text, "这份表格是空的。");
  }
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(lower)) return extractPhoto(bytes);
  return { kind: "其他", text: "", note: "这种文件还不能抽文字。可以用 txt、md、docx、pdf、xlsx，或 png、jpg。" };
}

async function extractPhoto(bytes: Uint8Array): Promise<Extracted> {
  try {
    const png = await toPng(bytes);
    const [text] = await recognizeImages([png]);
    return recognized("照片", text ?? "", "没有识别出文字。");
  } catch {
    return { kind: "照片", text: "", note: "没有识别出文字。" };
  }
}

function pdfBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const data = pdfBytes(bytes);
  let extracted: Awaited<ReturnType<typeof extractText>>;
  try {
    extracted = await extractText(data, { mergePages: false });
  } catch {
    return { kind: "PDF", text: "", note: "这份 PDF 没有读出来。" };
  }
  const pages = (Array.isArray(extracted.text) ? extracted.text : [String(extracted.text ?? "")]).map((page) =>
    page.trim(),
  );
  const filled = await fillThinPages(data, pages);
  if (!filled.pages.some((page) => page.text.trim())) {
    return { kind: "PDF", text: "", note: filled.note || "没有识别出文字。" };
  }
  const stored = storePages(filled.pages);
  return {
    kind: "PDF",
    text: stored.text,
    note: [filled.note, stored.note].filter(Boolean).join(""),
  };
}

async function fillThinPages(data: Uint8Array, pages: string[]) {
  const thin = pages
    .map((text, index) => ({ index, text }))
    .filter((page) => page.text.replace(/\s/g, "").length < THIN_PAGE)
    .map((page) => page.index);
  if (thin.length === 0) return { pages: pages.map((text) => ({ text })), note: "" };

  const ocr = new Map<number, string>();
  const folded = new Set<number>();
  const batches: number[][] = [];
  for (let index = 0; index < thin.length; index += OCR_BATCH) batches.push(thin.slice(index, index + OCR_BATCH));
  let chars = pages.reduce((sum, page) => sum + page.trim().length, 0);
  let note = "";

  for (let batch = 0; batch < batches.length; batch += 1) {
    const found = await readBatch(data, batches[batch]);
    if (!found) {
      note = "后面的页没有识别完。";
      for (const index of thin) if (!ocr.has(index)) folded.add(index);
      break;
    }
    batches[batch].forEach((index, item) => {
      ocr.set(index, found[item] ?? "");
      chars += (found[item] ?? "").trim().length;
    });
    const last = batches[batches.length - 1];
    if (chars < MAX_TEXT || batch === batches.length - 1 || last === batches[batch]) continue;
    const tail = await readBatch(data, last);
    if (tail) last.forEach((index, item) => ocr.set(index, tail[item] ?? ""));
    else note = "文末几页没有识别完。";
    for (const index of thin) if (!ocr.has(index)) folded.add(index);
    note = note || "中间若干页只保留目录。";
    break;
  }

  const merged: StoredPage[] = pages.map((text, index) => {
    if (folded.has(index)) return { text: "", folded: true };
    if (ocr.has(index)) return { text: ocr.get(index) || text };
    return { text };
  });
  const usedOcr = [...ocr.values()].some((text) => text.trim());
  return { pages: merged, note: `${usedOcr ? CHECK_NOTE : ""}${note}` };
}

async function readBatch(data: Uint8Array, pages: number[]) {
  try {
    return await recognizePdfPages(data, pages);
  } catch {
    return null;
  }
}

function recognized(kind: string, text: string, emptyNote: string): Extracted {
  const trimmed = text.trim();
  if (!trimmed) return { kind, text: "", note: emptyNote };
  return { kind, text: trimmed.slice(0, MAX_TEXT), note: CHECK_NOTE };
}

function decode(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
}

function pack(kind: string, text: string, emptyNote: string): Extracted {
  const trimmed = text.replace(/\u0000/g, "").trim();
  return {
    kind,
    text: trimmed.slice(0, MAX_TEXT),
    note: trimmed ? "" : emptyNote,
  };
}
