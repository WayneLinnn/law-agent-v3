import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import { createDraft } from "@/lib/matters";
import { isFileTakeReply, wantsFileTake } from "@/lib/new-case";
import { recordNote } from "@/lib/notes";
import { listCandidates, saveHitsToMatter } from "@/lib/retrieval";
import { getThread, type ThreadMessage } from "@/lib/threads";

type Failure = { error: string; status: 400 | 404 | 409 };

export type TakeTurn = {
  lawyerId: string;
  modelId: string;
  question: string;
  answer: string;
  legal: boolean;
};

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function turnsFromMessages(messages: ThreadMessage[]): TakeTurn[] {
  const plain = messages.filter((message) => !message.proposalKind);
  const turns: TakeTurn[] = [];
  for (let index = 0; index < plain.length; index += 1) {
    const lawyer = plain[index];
    if (lawyer.role !== "lawyer") continue;
    const model = plain[index + 1];
    if (!model || model.role !== "model") continue;
    if (wantsFileTake(lawyer.body) || isFileTakeReply(model.body)) {
      index += 1;
      continue;
    }
    turns.push({
      lawyerId: lawyer.id,
      modelId: model.id,
      question: lawyer.body,
      answer: model.body,
      legal: /依据候选|主依据|查到这些|法条|案例/.test(model.body),
    });
    index += 1;
  }
  return turns;
}

export function defaultLawyerIds(turns: TakeTurn[]) {
  const legal = [...turns].reverse().find((turn) => turn.legal);
  if (legal) return [legal.lawyerId];
  const last = turns.at(-1);
  return last ? [last.lawyerId] : [];
}

function clip(text: string, max = 1_800) {
  const flat = text.trim();
  return flat.length > max ? `${flat.slice(0, max)}……` : flat;
}

export async function fileFromWorkbench(
  threadId: string,
  input: { clientName?: unknown; caseName?: unknown; lawyerIds?: unknown },
): Promise<Failure | { matterId: string; caseThreadId: string; brought: number; sources: number }> {
  await connection();
  const thread = await getThread(threadId);
  if (!thread) return { error: "没有这段对话。", status: 404 };
  if (thread.matterId) return { error: "这段对话已经挂在案子上。", status: 409 };

  const clientName = typeof input.clientName === "string" ? input.clientName.trim() : "";
  const caseName = typeof input.caseName === "string" ? input.caseName.trim() : "";
  if (!clientName) return { error: "请点明谁是客户。", status: 400 };
  if (!caseName) return { error: "请写下案件名称。", status: 400 };

  const turns = turnsFromMessages(thread.messages);
  if (turns.length === 0) return { error: "还没有可带走的问答。", status: 400 };

  const requested = Array.isArray(input.lawyerIds)
    ? input.lawyerIds.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  const selectedIds = requested.length > 0 ? requested : defaultLawyerIds(turns);
  const selected = turns.filter((turn) => selectedIds.includes(turn.lawyerId));
  if (selected.length === 0) return { error: "请勾选要带走的问答。", status: 400 };

  const draft = await createDraft({
    clientName,
    name: caseName,
    people: [],
    organs: [],
    cause: "",
    facts: "",
    mandate: "",
  });
  if ("error" in draft) return draft;

  const matterId = draft.id;
  const caseThreadId = crypto.randomUUID();
  const now = stamp();
  const title = `从工作台带走 · ${clientName}`.slice(0, 40);
  database()
    .prepare("INSERT INTO threads (id, matter_id, title, created_at) VALUES (?, ?, ?, ?)")
    .run(caseThreadId, matterId, title, now);

  const noteParts = selected.map(
    (turn, index) =>
      `【带走${index + 1}】\n问：${clip(turn.question, 600)}\n答：${clip(turn.answer, 2_000)}`,
  );
  const noted = await recordNote(matterId, "路径", `工作台带走：\n\n${noteParts.join("\n\n")}`.slice(0, 4_000));
  if ("error" in noted) return noted;

  let sourceCount = 0;
  const batch = await listCandidates(threadId);
  const selectedLawyer = new Set(selected.map((turn) => turn.lawyerId));
  if (batch && selectedLawyer.has(batch.messageId) && batch.items.length > 0) {
    const question = selected.find((turn) => turn.lawyerId === batch.messageId)?.question || selected[0].question;
    const saved = await saveHitsToMatter(matterId, question, batch.items);
    if (!("error" in saved)) sourceCount = saved.count;
  }

  const broughtLine = selected
    .map((turn) => `- ${clip(turn.question.replace(/\s+/g, " "), 40)}`)
    .join("\n");
  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '问答', ?, '', '', NULL, ?)`,
    )
    .run(
      crypto.randomUUID(),
      caseThreadId,
      `已从工作台带走 ${selected.length} 轮问答${sourceCount ? `，并收下 ${sourceCount} 条出处` : ""}。\n${broughtLine}`,
      now,
    );

  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '问答', ?, '', '', NULL, ?)`,
    )
    .run(
      crypto.randomUUID(),
      threadId,
      `已立案并带走 ${selected.length} 轮问答${sourceCount ? `、${sourceCount} 条出处` : ""}。[打开案子](/matters/${matterId})。工作台这段对话仍留在这里。`,
      stamp(),
    );

  return {
    matterId,
    caseThreadId,
    brought: selected.length,
    sources: sourceCount,
  };
}
