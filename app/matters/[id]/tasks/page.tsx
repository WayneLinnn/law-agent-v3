import { notFound } from "next/navigation";

import { MatterFrame } from "@/components/matter-frame";
import { TaskDesk } from "@/components/task-desk";
import { getMatter } from "@/lib/matters";
import { listTasks } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) notFound();
  const tasks = await listTasks(id);

  return (
    <MatterFrame matter={matter}>
      <TaskDesk
        matterId={matter.id}
        tasks={tasks}
        feeReceived={matter.feeReceived}
        locked={matter.status === "已归档"}
      />
    </MatterFrame>
  );
}
