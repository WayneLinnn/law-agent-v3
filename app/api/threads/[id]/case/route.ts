import { openCase } from "@/lib/proposals";

const noStore = { "Cache-Control": "no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { clientName?: unknown } | null;
  if (!body || !("clientName" in body)) {
    return Response.json({ error: "没有读懂提交的内容。" }, { status: 400, headers: noStore });
  }
  const saved = await openCase(id, body.clientName);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ matterId: saved.matterId }, { status: saved.status, headers: noStore });
}
