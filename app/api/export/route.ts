import { officeFile } from "@/lib/office-file";

const noStore = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

function stem(value: unknown) {
  if (typeof value !== "string") return "文书";
  const name = value.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 40);
  return name || "文书";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    format?: unknown;
    name?: unknown;
  } | null;
  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: "没有可保存的正文。" }, { status: 400, headers: noStore });
  }
  if (body.text.length > 20_000) {
    return Response.json({ error: "这段太长。" }, { status: 400, headers: noStore });
  }
  const format = body.format === "pdf" ? "pdf" : body.format === "docx" ? "docx" : "";
  if (!format) return Response.json({ error: "请选择 Word 或 PDF。" }, { status: 400, headers: noStore });
  const file = officeFile(format, body.text);
  const name = `${stem(body.name)}.${file.ext}`;
  return new Response(Uint8Array.from(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
