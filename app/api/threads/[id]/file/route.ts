import { fileFromWorkbench } from "@/lib/file-from-thread";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    clientName?: unknown;
    caseName?: unknown;
    lawyerIds?: unknown;
  } | null;
  if (!body) {
    return Response.json({ error: "没有读懂提交的内容。" }, { status: 400, headers: noStore });
  }
  const saved = await fileFromWorkbench(id, body);
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json(saved, { status: 201, headers: noStore });
}
