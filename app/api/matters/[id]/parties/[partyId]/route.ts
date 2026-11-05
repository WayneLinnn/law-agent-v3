import { savePosition } from "@/lib/parties";

const noStore = { "Cache-Control": "no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; partyId: string }> },
) {
  const { id, partyId } = await params;
  const body = (await request.json().catch(() => null)) as { position?: unknown } | null;
  if (!body || !("position" in body)) {
    return Response.json(
      { error: "没有读懂提交的内容。" },
      { status: 400, headers: noStore },
    );
  }
  const saved = await savePosition(id, partyId, body.position);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ id: saved.id }, { headers: noStore });
}
