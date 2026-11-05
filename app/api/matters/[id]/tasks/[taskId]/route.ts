import { dropTask } from "@/lib/tasks";

const noStore = { "Cache-Control": "no-store" };

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { id, taskId } = await params;
  const saved = await dropTask(id, taskId);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ id: saved.id }, { headers: noStore });
}
