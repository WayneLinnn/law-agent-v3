import { generateContractReview, latestContractReview } from "@/lib/contract-review";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    materialId?: unknown;
    text?: unknown;
    stance?: unknown;
    scale?: unknown;
  } | null;
  if (!body) return Response.json({ error: "没有读懂提交的内容。" }, { status: 400, headers: noStore });
  const ran = await generateContractReview(id, {
    materialId: typeof body.materialId === "string" ? body.materialId : "",
    text: typeof body.text === "string" ? body.text : "",
    stance: typeof body.stance === "string" ? body.stance : "",
    scale: typeof body.scale === "string" ? body.scale : "",
  });
  if ("error" in ran) return Response.json({ error: ran.error }, { status: ran.status, headers: noStore });
  const saved = await latestContractReview(id);
  return Response.json({ text: ran.text, cards: saved?.cards ?? [] }, { headers: noStore });
}
