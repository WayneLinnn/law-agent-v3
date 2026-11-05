import { listCandidates } from "@/lib/retrieval";
import { getThread } from "@/lib/threads";

const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const thread = await getThread(id);
  if (!thread) {
    return Response.json({ error: "没有这段对话。" }, { status: 404, headers: noStore });
  }
  return Response.json({ candidates: await listCandidates(id) }, { headers: noStore });
}
