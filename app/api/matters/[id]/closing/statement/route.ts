import { saveStatement } from "@/lib/closings";

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { statement?: unknown } | null;
  if (!body) return json({ error: "没有读懂提交的内容。" }, 400);
  const saved = await saveStatement(id, body);
  if ("error" in saved) return json({ error: saved.error }, saved.status);
  return json({ status: "ok" }, saved.status);
}
