import { createDraft, listMatters, type CreateDraftInput } from "@/lib/matters";
import { addMaterials, materializeMaterials } from "@/lib/materials";

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

export async function GET() {
  return json({ matters: await listMatters() });
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const raw = form?.get("card");
    const file = form?.get("file");
    if (typeof raw !== "string") return json({ error: "没有读懂提交的内容。" }, 400);
    let body: CreateDraftInput;
    try {
      body = JSON.parse(raw) as CreateDraftInput;
    } catch {
      return json({ error: "没有读懂提交的内容。" }, 400);
    }
    const created = await createDraft(body);
    if ("error" in created) return json({ error: created.error }, created.status);
    if (file instanceof File) {
      const saved = await addMaterials(created.id, [file]);
      if (!("error" in saved)) await materializeMaterials(created.id);
    }
    return json({ id: created.id }, created.status);
  }
  const body = (await request.json().catch(() => null)) as CreateDraftInput | null;
  if (!body || typeof body !== "object") return json({ error: "没有读懂提交的内容。" }, 400);
  const created = await createDraft(body);
  if ("error" in created) return json({ error: created.error }, created.status);
  return json({ id: created.id }, created.status);
}
