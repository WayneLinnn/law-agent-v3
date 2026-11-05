import { acceptProposal } from "@/lib/proposals";

const noStore = { "Cache-Control": "no-store" };

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id, messageId } = await params;
  const saved = await acceptProposal(id, messageId);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ id: saved.id }, { headers: noStore });
}
