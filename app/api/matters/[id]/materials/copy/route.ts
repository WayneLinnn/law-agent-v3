import { addMaterials } from "@/lib/materials";
import { getMatter } from "@/lib/matters";
import { officeFile } from "@/lib/office-file";

const noStore = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

function stem(value: unknown) {
  if (typeof value !== "string") return "文书";
  const name = value.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 40);
  return name || "文书";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) return Response.json({ error: "没有这件案子。" }, { status: 404, headers: noStore });
  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    format?: unknown;
    name?: unknown;
  } | null;
  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: "没有可保存的正文。" }, { status: 400, headers: noStore });
  }
  if (body.text.length > 20_000) {
    return Response.json({ error: "这段太长。" }, { status: 400, headers: noStore });
  }
  const format = body.format === "pdf" ? "pdf" : body.format === "docx" ? "docx" : "";
  if (!format) return Response.json({ error: "请选择 Word 或 PDF。" }, { status: 400, headers: noStore });
  const file = officeFile(format, body.text);
  const base = stem(body.name);
  const filename = `${base}.${file.ext}`;
  const upload = new File([Uint8Array.from(file.bytes)], filename, { type: file.type });
  const saved = await addMaterials(id, [upload]);
  if ("error" in saved) return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  return Response.json({ filename }, { headers: noStore });
}
