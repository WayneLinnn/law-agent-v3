import { openMaterialFile } from "@/lib/materials";
import { uploadType } from "@/lib/uploads";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; materialId: string }> },
) {
  const { id, materialId } = await params;
  const file = await openMaterialFile(id, materialId);
  if (!file) {
    return Response.json(
      { error: "没有这份材料。" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new Response(file.bytes, {
    headers: {
      "Content-Type": uploadType(file.filename),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
