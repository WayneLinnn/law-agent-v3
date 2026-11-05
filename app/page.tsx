import { WorkbenchDesk } from "@/components/workbench-desk";
import { listCaseCards } from "@/lib/case-board";
import { listOpenTasks } from "@/lib/tasks";
import { getThread, listThreads } from "@/lib/threads";
import { listUploads } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const [threads, cases, tasks] = await Promise.all([
    listThreads(),
    listCaseCards(5, true),
    listOpenTasks(5),
  ]);
  const active = t ? await getThread(t) : null;
  const thread = active && !active.matterId ? active : null;
  const uploads = thread ? await listUploads(thread.id) : [];
  const messages = (thread?.messages ?? [])
    .filter((message) => !message.proposalKind)
    .map((message) => ({
      id: message.id,
      role: message.role,
      mode: message.mode,
      body: message.body,
    }));

  return (
    <WorkbenchDesk
      threadId={thread?.id}
      prompted={thread?.prompted ?? false}
      messages={messages}
      threads={threads}
      uploads={uploads}
      cases={cases}
      tasks={tasks}
    />
  );
}
