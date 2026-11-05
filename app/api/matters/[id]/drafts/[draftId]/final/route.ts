import { finalizeDraft } from "@/lib/drafts";

const noStore = { "Cache-Control": "no-store" };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const { id, draftId } = await params;
  const saved = await finalizeDraft(id, draftId);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ id: saved.id }, { status: saved.status, headers: noStore });
}
