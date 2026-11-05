import { openUpload, uploadType } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const file = await openUpload(id);
  if (!file) {
    return Response.json(
      { error: "没有这份原件。" },
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
