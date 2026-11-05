import { respondAsk } from "@/lib/respond-ask";
import { ask } from "@/lib/threads";

const noStore = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    mode?: unknown;
    text?: unknown;
    insist?: unknown;
  } | null;
  if (!body) {
    return Response.json({ error: "没有读懂提交的内容。" }, { status: 400, headers: noStore });
  }
  return respondAsk(request, (delta, reset) => ask({ ...body, threadId: id }, delta, reset));
}
