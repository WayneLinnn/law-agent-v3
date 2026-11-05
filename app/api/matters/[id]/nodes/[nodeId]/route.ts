import { dropNode } from "@/lib/nodes";

const noStore = { "Cache-Control": "no-store" };

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
) {
  const { id, nodeId } = await params;
  const saved = await dropNode(id, nodeId);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ id: saved.id }, { headers: noStore });
}
