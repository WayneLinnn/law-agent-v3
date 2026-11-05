import { unarchiveMatter } from "@/lib/closings";

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const saved = await unarchiveMatter(id);
  if ("error" in saved) return json({ error: saved.error }, saved.status);
  return json({ status: "ok" }, saved.status);
}
