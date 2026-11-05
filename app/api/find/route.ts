import { findHits } from "@/lib/find";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return Response.json({ error: "请写下要找的字。" }, { status: 400, headers: noStore });
  }
  const hits = await findHits(q);
  return Response.json(hits, { headers: noStore });
}
