import { officeFile } from "@/lib/office-file";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown; name?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "没有可导出的正文。" }, { status: 400, headers: noStore });
  if (text.length > 20_000) return Response.json({ error: "这段太长。" }, { status: 400, headers: noStore });
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "文书";
  const file = officeFile("docx", text);
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.${file.ext}`)}`,
      "Cache-Control": "no-store",
    },
  });
}
