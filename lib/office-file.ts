import "server-only";

import fs from "node:fs";
import { crc32 } from "node:zlib";

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const MAX_TEXT = 20_000;
const PAGE_W = 794;
const PAGE_H = 1123;

let fontName = "";

function ensureFont() {
  if (fontName) return fontName;
  const candidates = [
    "C:\\Windows\\Fonts\\msyh.ttc",
    "C:\\Windows\\Fonts\\msyh.ttf",
    "C:\\Windows\\Fonts\\simhei.ttf",
    "C:\\Windows\\Fonts\\simsun.ttc",
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const registered = GlobalFonts.registerFromPath(file, "CaseFont");
      if (registered) {
        fontName = "CaseFont";
        return fontName;
      }
    } catch {
      continue;
    }
  }
  fontName = "sans-serif";
  return fontName;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function zipStored(files: Array<{ name: string; data: Buffer }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const sum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, file.data);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

function documentXml(text: string) {
  const paragraphs = text.split(/\n/).map((line) => {
    const run = line
      ? `<w:r><w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/><w:sz w:val="21"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`
      : "";
    return `<w:p>${run}</w:p>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join("")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

export function buildDocx(text: string) {
  const body = text.trim().slice(0, MAX_TEXT);
  const files = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
      ),
    },
    {
      name: "word/_rels/document.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
      ),
    },
    { name: "word/document.xml", data: Buffer.from(documentXml(body)) },
  ];
  return zipStored(files);
}

function wrapLines(text: string) {
  const canvas = createCanvas(PAGE_W, PAGE_H);
  const ctx = canvas.getContext("2d");
  const font = ensureFont();
  ctx.font = `18px "${font}"`;
  const max = PAGE_W - 112;
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    if (!para) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const char of para) {
      if (ctx.measureText(line + char).width > max) {
        lines.push(line);
        line = char;
      } else {
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function pageJpeg(lines: string[]) {
  const canvas = createCanvas(PAGE_W, PAGE_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.fillStyle = "#162d3d";
  ctx.font = `18px "${ensureFont()}"`;
  lines.forEach((line, index) => {
    ctx.fillText(line, 56, 72 + index * 28);
  });
  return canvas.encodeSync("jpeg", 82);
}

function pdfPage(jpeg: Buffer, id: { page: number; content: number; image: number }) {
  const content = Buffer.from("q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n");
  const contentObj = Buffer.concat([
    Buffer.from(
      `<< /Length ${content.length} >>\nstream\n`,
    ),
    content,
    Buffer.from("endstream\nendobj\n"),
  ]);
  const imageObj = Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${PAGE_W} /Height ${PAGE_H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    ),
    jpeg,
    Buffer.from("\nendstream\nendobj\n"),
  ]);
  const pageObj = Buffer.from(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${id.content} 0 R /Resources << /XObject << /Im0 ${id.image} 0 R >> >> >>\nendobj\n`,
  );
  return { pageObj, contentObj, imageObj };
}

export function buildPdf(text: string) {
  const body = text.trim().slice(0, MAX_TEXT);
  const lines = wrapLines(body || " ");
  const perPage = 36;
  const pages: Buffer[] = [];
  for (let index = 0; index < lines.length; index += perPage) {
    pages.push(pageJpeg(lines.slice(index, index + perPage)));
  }
  if (pages.length === 0) pages.push(pageJpeg([""]));

  const objects: Buffer[] = [];
  const kids: number[] = [];
  pages.forEach((_, index) => {
    const page = 3 + index * 3;
    kids.push(page);
  });
  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
  objects.push(
    Buffer.from(
      `<< /Type /Pages /Count ${pages.length} /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`,
    ),
  );
  pages.forEach((jpeg, index) => {
    const built = pdfPage(jpeg, { page: 3 + index * 3, content: 4 + index * 3, image: 5 + index * 3 });
    objects.push(built.pageObj, built.contentObj, built.imageObj);
  });

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), object);
  });
  const start = Buffer.concat(chunks).length;
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
  for (const offset of offsets.slice(1)) xref.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  chunks.push(
    Buffer.from(xref.join("")),
    Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`),
  );
  return Buffer.concat(chunks);
}

export function officeFile(format: "docx" | "pdf", text: string) {
  if (format === "docx") return { bytes: buildDocx(text), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
  return { bytes: buildPdf(text), type: "application/pdf", ext: "pdf" };
}
