import { runPlead } from "@/lib/plead-graph";
import { isPleadKind, latestPleading, type PleadSlots } from "@/lib/pleadings";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    kind?: unknown;
    slots?: unknown;
    materialId?: unknown;
  } | null;
  if (!body || typeof body.kind !== "string" || !isPleadKind(body.kind)) {
    return Response.json({ error: "请选择文书种类。" }, { status: 400, headers: noStore });
  }
  const slots: PleadSlots = {};
  if (body.slots && typeof body.slots === "object") {
    for (const [key, value] of Object.entries(body.slots)) {
      if (typeof value === "string") slots[key] = value;
    }
  }
  const ran = await runPlead(id, {
    kind: body.kind,
    slots,
    materialId: typeof body.materialId === "string" ? body.materialId : "",
    asked: "",
  });
  if ("error" in ran) return Response.json({ error: ran.error }, { status: 400, headers: noStore });
  const saved = await latestPleading(id, body.kind);
  return Response.json(
    {
      text: ran.text,
      id: saved?.id ?? "",
      version: saved?.version ?? 0,
      createdAt: saved?.createdAt ?? "",
      status: saved?.status ?? "缺槽位",
      body: saved?.body ?? "",
      warnings: saved?.warnings ?? "",
      slots: saved?.slots ?? slots,
    },
    { headers: noStore },
  );
}
