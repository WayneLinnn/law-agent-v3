import { saveCardRevision } from "@/lib/contract-review";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { id?: unknown; revision?: unknown } | null;
  if (!body || typeof body.id !== "string" || typeof body.revision !== "string") {
    return Response.json({ error: "没有读懂提交的内容。" }, { status: 400, headers: noStore });
  }
  const saved = await saveCardRevision(id, body.id, body.revision);
  if ("error" in saved) return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  return Response.json({ ok: true }, { headers: noStore });
}
