import { notFound } from "next/navigation";

import { HandleDesk } from "@/components/handle-desk";
import { MatterFrame } from "@/components/matter-frame";
import { currentDraft } from "@/lib/drafts";
import { listMaterials } from "@/lib/materials";
import { materialState } from "@/lib/material-state";
import { getMatter } from "@/lib/matters";
import { listNotes } from "@/lib/notes";
import { absorbDatedNotes, listNodes } from "@/lib/nodes";
import { readNextSteps } from "@/lib/next-steps";
import { listCaseThread } from "@/lib/proposals";
import { listCandidates, listFocuses } from "@/lib/retrieval";
import { listTasks } from "@/lib/tasks";
import { listMatterThreads } from "@/lib/case-threads";
import { getThread } from "@/lib/threads";

export const dynamic = "force-dynamic";

export default async function MatterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const matter = await getMatter(id);
  if (!matter) notFound();
  await absorbDatedNotes(id);
  const threads = await listMatterThreads(id);
  const chosen = threads.find((item) => item.id === t)?.id ?? threads[0]?.id ?? "";
  const [materials, linked, notes, nodes, tasks, draft] = await Promise.all([
    listMaterials(id),
    chosen ? listCaseThread(id, chosen) : Promise.resolve(null),
    listNotes(id),
    listNodes(id),
    listTasks(id),
    currentDraft(id),
  ]);
  const thread = linked ? await getThread(linked.id) : null;
  const draftSeed =
    [...(thread?.messages ?? [])].reverse().find((message) => message.proposalKind === "文书底稿")?.body ?? "";
  const [batch, saved] = await Promise.all([
    thread ? listCandidates(thread.id) : Promise.resolve(null),
    listFocuses(matter.id),
  ]);
  const messages = (thread?.messages ?? [])
    .filter((message) => !message.proposalKind)
    .map((message) => ({
      id: message.id,
      role: message.role,
      mode: message.mode,
      body: message.body,
      next: readNextSteps(message.proposalKind, message.proposalBody),
    }));
  const today = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return (
    <MatterFrame matter={matter} desk fill>
      <HandleDesk
        matterId={matter.id}
        threadId={thread?.id}
        threads={threads.map((item) => ({ id: item.id, title: item.title }))}
        prompted={thread?.prompted ?? false}
        messages={messages}
        materials={materials.map((material) => ({
          id: material.id,
          filename: material.filename,
          kind: material.kind,
          stored: material.stored,
          state: materialState(material),
        }))}
        notes={notes.map((note) => ({ id: note.id, kind: note.kind, body: note.body }))}
        nodes={nodes.map((node) => ({
          id: node.id,
          happenedOn: node.happenedOn,
          title: node.title,
          detail: node.detail,
        }))}
        pending={(linked?.proposals ?? []).filter((proposal) => !proposal.acceptedAt && proposal.kind !== "节点")}
        batch={
          batch
            ? {
                messageId: batch.messageId,
                query: batch.query,
                items: batch.items.map((item) => ({
                  sourceId: item.sourceId,
                  kind: item.kind,
                  title: item.title,
                  text: item.text,
                  detail: item.detail,
                  status: item.status,
                  url: item.url,
                })),
              }
            : null
        }
        saved={saved.map((focus) => ({
          id: focus.id,
          body: focus.body,
          sources: focus.sources.map((source) => ({
            sourceId: source.sourceId,
            kind: source.kind,
            title: source.title,
            url: source.url,
          })),
        }))}
        tasks={tasks.map((task) => ({
          id: task.id,
          name: task.name,
          dueOn: task.dueOn,
          confirmed: Boolean(task.confirmedAt),
          overdue: Boolean(task.confirmedAt) && task.dueOn < day,
        }))}
        canConfirm={matter.status !== "已归档"}
        draft={
          draft
            ? {
                id: draft.id,
                kind: draft.kind,
                body: draft.body,
                warnings: draft.warnings,
                final: draft.final,
              }
            : null
        }
        draftSeed={draftSeed}
        locked={matter.status === "已归档"}
      />
    </MatterFrame>
  );
}
