import { draftFileText } from "@/lib/drafts";
import { officeFile } from "@/lib/office-file";

const noStore = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    format?: unknown;
    body?: unknown;
    kind?: unknown;
  } | null;
  if (!body) return Response.json({ error: "没有读懂提交的内容。" }, { status: 400, headers: noStore });
  const format = body.format === "pdf" ? "pdf" : body.format === "docx" ? "docx" : "";
  if (!format) return Response.json({ error: "请选择 Word 或 PDF。" }, { status: 400, headers: noStore });
  const text = typeof body.body === "string" ? body.body : undefined;
  const kind = typeof body.kind === "string" ? body.kind : undefined;
  const draft = await draftFileText(id, text, kind);
  if ("error" in draft) return Response.json({ error: draft.error }, { status: draft.status, headers: noStore });
  const file = officeFile(format, draft.text);
  const name = `${draft.name.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 40) || "文书"}.${file.ext}`;
  return new Response(Uint8Array.from(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
