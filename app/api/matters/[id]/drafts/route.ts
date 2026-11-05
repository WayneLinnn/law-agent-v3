import { listDrafts, saveDraft } from "@/lib/drafts";
import { getMatter } from "@/lib/matters";

const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) {
    return Response.json({ error: "没有这件案子。" }, { status: 404, headers: noStore });
  }
  return Response.json({ drafts: await listDrafts(id) }, { headers: noStore });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { kind?: unknown; body?: unknown } | null;
  if (!body) {
    return Response.json({ error: "没有读懂提交的内容。" }, { status: 400, headers: noStore });
  }
  const saved = await saveDraft(id, body);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ id: saved.id }, { status: saved.status, headers: noStore });
}
