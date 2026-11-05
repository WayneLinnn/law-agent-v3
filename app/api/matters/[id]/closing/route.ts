import { getClosing, saveOutcome } from "@/lib/closings";
import { getMatter } from "@/lib/matters";

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) return json({ error: "没有这件案子。" }, 404);
  const closing = await getClosing(id);
  if (!closing) return json({ error: "没有这件案子。" }, 404);
  return json({ ...closing, status: matter.status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    outcome?: unknown;
    outcomeOn?: unknown;
    outcomeNote?: unknown;
  } | null;
  if (!body) return json({ error: "没有读懂提交的内容。" }, 400);
  const saved = await saveOutcome(id, body);
  if ("error" in saved) return json({ error: saved.error }, saved.status);
  return json({ status: "ok" }, saved.status);
}
