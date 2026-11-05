import { reviseDraft } from "@/lib/drafts";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    body?: unknown;
    passage?: unknown;
    instruction?: unknown;
  } | null;
  if (!body) {
    return Response.json({ error: "没有读懂提交的内容。" }, { status: 400, headers: noStore });
  }
  const saved = await reviseDraft(id, body);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ body: saved.body }, { status: saved.status, headers: noStore });
}
