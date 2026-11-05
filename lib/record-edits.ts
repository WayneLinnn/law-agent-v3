import "server-only";

import { connection } from "next/server";

import { requestedChangeKinds } from "@/lib/changes";
import { database } from "@/lib/db";
import { requestedNoteKinds } from "@/lib/notes";

const WRITE = /提出|改|增加|加上|删除|删掉|写成|记下|记一条/;
const DELETE = /删除|删掉/;
const ROW_KINDS = ["待办", "当事人", "时间线", "待核清单", "路径"] as const;

type RowKind = (typeof ROW_KINDS)[number];

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function mentionsRecord(text: string) {
  return /当事人|案由|时间线|待核清单|路径|待办|基本事实|委托事项|证明对象/.test(text);
}

export function isRecordWrite(text: string) {
  return WRITE.test(text) && mentionsRecord(text);
}

export function isDelete(text: string) {
  return DELETE.test(text) && mentionsRecord(text);
}

export function isDueLookup(text: string) {
  return /看|查/.test(text) && /待办|到期/.test(text) && !isRecordWrite(text);
}

function earliestKind(text: string): RowKind | null {
  let found: { kind: RowKind; at: number } | null = null;
  for (const kind of ROW_KINDS) {
    const at = text.indexOf(kind);
    if (at >= 0 && (!found || at < found.at)) found = { kind, at };
  }
  return found?.kind ?? null;
}

function named(text: string, kind: string) {
  const matched = text.match(new RegExp(`${kind}[：:]\\s*([^\\n，,。]{1,80})`));
  return matched?.[1]?.trim() ?? "";
}

function insertProposal(threadId: string, kind: string, body: string, payload: string) {
  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '问答', ?, ?, ?, NULL, ?)`,
    )
    .run(crypto.randomUUID(), threadId, body, kind, payload, stamp());
}

export async function stageDelete(threadId: string, text: string) {
  await connection();
  const kind = earliestKind(text);
  if (!kind) return;
  if (kind === "待办" || kind === "当事人") {
    const name = named(text, kind);
    if (!name) {
      insertProposal(threadId, kind, "待核实", "待核实");
      return;
    }
    insertProposal(threadId, kind, `删除：${name}`, JSON.stringify({ op: "delete", name }));
    return;
  }
  insertProposal(threadId, kind, `删除这条${kind}`, JSON.stringify({ op: "delete" }));
}

function partyProposal(text: string) {
  const matched = text.match(
    /(?:增加|加上)当事人[：:]\s*([^，,\n]{1,40})(?:[，,]\s*诉讼地位\s*([^，,\n]{1,40}))?/,
  );
  if (!matched) return null;
  const name = matched[1].trim();
  if (!name || name.includes("、")) return { body: "待核实", payload: "待核实" };
  const position = (matched[2] ?? "").trim();
  const role = /人民法院|人民检察院|公安局|公安分局|复议机关|仲裁委员会/.test(name) ? "organ" : "opposing";
  const party = { name, position, idNumber: "", role };
  return {
    body: [name, position].filter(Boolean).join(" "),
    payload: JSON.stringify([party]),
  };
}

function causeProposal(text: string) {
  const matched = text.match(/(?:把)?案由(?:改成|改为|写成)[：:]?\s*([^\n。]{1,80})/);
  const cause = matched?.[1]?.trim();
  if (!cause) return null;
  return { body: cause, payload: cause };
}

export async function stagePartyOrCause(threadId: string, text: string) {
  await connection();
  if (requestedNoteKinds(text).length > 0 || requestedChangeKinds(text).length > 0) return;
  const party = partyProposal(text);
  if (party) {
    insertProposal(threadId, "当事人", party.body, party.payload);
    return;
  }
  const cause = causeProposal(text);
  if (cause) insertProposal(threadId, "案由", cause.body, cause.payload);
}
