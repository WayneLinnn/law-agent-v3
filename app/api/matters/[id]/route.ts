import { getMatter } from "@/lib/matters";

const noStore = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) {
    return Response.json({ error: "没有这件案子。" }, { status: 404, headers: noStore });
  }
  return Response.json({ matter }, { headers: noStore });
}
