import { addMaterials, listMaterials } from "@/lib/materials";
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
  return json({ materials: await listMaterials(id) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const files = form?.getAll("file").filter((item): item is File => item instanceof File) ?? [];
  if (files.length === 0) return json({ error: "请放入文件。" }, 400);
  const saved = await addMaterials(id, files);
  if ("error" in saved) return json({ error: saved.error }, saved.status);
  return json({ ids: saved.ids }, saved.status);
}
