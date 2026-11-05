import { saveUploads } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const given = String(form.get("threadId") ?? "").trim();
  const threadId = given || crypto.randomUUID();
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  const saved = await saveUploads(threadId, files);
  if ("error" in saved) return Response.json({ error: saved.error }, { status: saved.status });
  return Response.json(saved, { status: 201 });
}
