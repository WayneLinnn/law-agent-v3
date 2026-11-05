import { openCaseThread } from "@/lib/case-threads";

const noStore = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opened = await openCaseThread(id);
  if ("error" in opened) {
    return Response.json({ error: opened.error }, { status: opened.status, headers: noStore });
  }
  return Response.json({ id: opened.id }, { status: opened.status, headers: noStore });
}
