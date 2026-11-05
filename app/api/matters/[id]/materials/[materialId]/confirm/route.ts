import { confirmMaterial } from "@/lib/materials";

const noStore = { "Cache-Control": "no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; materialId: string }> },
) {
  const { id, materialId } = await params;
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  if (!body) {
    return Response.json(
      { error: "没有读懂提交的内容。" },
      { status: 400, headers: noStore },
    );
  }
  const saved = await confirmMaterial(id, materialId, body.text);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ id: saved.id }, { headers: noStore });
}
