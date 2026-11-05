import { setFeeReceived } from "@/lib/matters";

const noStore = { "Cache-Control": "no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { amount?: unknown } | null;
  if (!body || !("amount" in body)) {
    return Response.json(
      { error: "没有读懂提交的内容。" },
      { status: 400, headers: noStore },
    );
  }
  const saved = await setFeeReceived(id, body.amount);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ feeReceived: saved.feeReceived }, { headers: noStore });
}
