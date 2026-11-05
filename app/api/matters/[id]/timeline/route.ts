import { saveNodeDocument } from "@/lib/nodes";

const noStore = { "Cache-Control": "no-store" };

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const saved = await saveNodeDocument(id, typeof body?.text === "string" ? body.text : "");
  if ("error" in saved) {
    return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  }
  return Response.json({ rows: saved.rows }, { headers: noStore });
}
