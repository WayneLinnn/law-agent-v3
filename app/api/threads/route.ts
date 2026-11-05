import { respondAsk } from "@/lib/respond-ask";
import { ask, listThreads } from "@/lib/threads";

const noStore = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

export async function GET() {
  return json({ threads: await listThreads() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    mode?: unknown;
    text?: unknown;
    insist?: unknown;
  } | null;
  if (!body) return json({ error: "没有读懂提交的内容。" }, 400);
  return respondAsk(request, (delta, reset) => ask(body, delta, reset));
}
