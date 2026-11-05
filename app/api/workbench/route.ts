import { feeTotal, listMatters } from "@/lib/matters";
import { listDue } from "@/lib/tasks";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const [desk, matters] = await Promise.all([listDue(), listMatters()]);
  return Response.json(
    {
      prompts: desk.prompts,
      due: desk.due,
      fees: {
        total: feeTotal(matters.map((matter) => matter.feeReceived)),
        matters: matters.map((matter) => ({
          id: matter.id,
          name: matter.name,
          feeReceived: matter.feeReceived,
        })),
      },
    },
    { headers: noStore },
  );
}
