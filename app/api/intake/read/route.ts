import { extractUpload } from "@/lib/extract-text";
import { fillIntake } from "@/lib/intake-fill";
import { intakeFromBytes, intakeFromText, type IntakeRead } from "@/lib/intake";

const FILE_BYTES = 8_000_000;

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

async function respond(read: { filename: string; text: string } & IntakeRead | { error: string; status: number }) {
  if ("error" in read) return json({ error: read.error }, read.status);
  const filled = await fillIntake(read.text, read);
  if ("error" in filled) return json({ error: filled.error }, filled.status);
  return json({ filename: read.filename, ...filled });
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    if (!body || typeof body.text !== "string") return json({ error: "没有读懂提交的内容。" }, 400);
    return respond(intakeFromText(body.text));
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "请放入一份 txt、Word、PDF 或照片。" }, 400);
  return readFile(file);
}

async function readFile(file: File) {
  const name = file.name.split(/[/\\]/).pop()?.trim() ?? "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!name) return json({ error: "请放入一份 txt、Word、PDF 或照片。" }, 400);
  if (bytes.byteLength === 0) return json({ error: "这份文件是空的。" }, 400);
  if (bytes.byteLength > FILE_BYTES) return json({ error: "这份文件太大。" }, 400);
  if (/\.txt$/i.test(name)) return respond(intakeFromBytes(name, bytes));
  if (!/\.(md|docx?|pdf|png|jpe?g|webp|gif|bmp)$/i.test(name)) {
    return json({ error: "请放入一份 txt、Word、PDF 或照片。" }, 400);
  }
  const extracted = await extractUpload(name, bytes);
  if (!extracted.text.trim()) return json({ error: extracted.note || "没有读出文字。" }, 400);
  const read = intakeFromText(extracted.text);
  if ("error" in read) return json({ error: read.error }, read.status);
  return respond({ ...read, filename: name });
}
