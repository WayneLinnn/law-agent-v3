import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import { proposeChanges, type ChangeKind, type ProposedChange } from "@/lib/model";

const ORDER: ChangeKind[] = ["待办", "基本事实", "委托事项", "证明对象"];

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function requestedChangeKinds(text: string): ChangeKind[] {
  return ORDER.filter((kind) => text.includes(kind));
}

function labeledChanges(text: string): Partial<Record<ChangeKind, ProposedChange>> {
  const changes: Partial<Record<ChangeKind, ProposedChange>> = {};
  const task = text.match(/待办[：:]\s*([^，,\n]{1,80})[，,]\s*到期日\s*(\d{4}-\d{2}-\d{2})/);
  if (task) {
    const name = task[1].trim();
    const dueOn = task[2];
    changes.待办 = { text: `${name}\n${dueOn}`, payload: JSON.stringify({ name, dueOn }) };
  }
  const facts = fieldValue(text, "基本事实");
  if (facts) changes.基本事实 = { text: facts, payload: facts };
  const mandate = fieldValue(text, "委托事项");
  if (mandate) changes.委托事项 = { text: mandate, payload: mandate };
  const proves = text.match(/证明对象[：:]\s*([^：:\n]{1,120})[：:]\s*([^\n]+)/);
  if (proves) {
    const filename = proves[1].trim();
    const textValue = proves[2].trim();
    changes.证明对象 = {
      text: `${filename}\n${textValue}`,
      payload: JSON.stringify({ filename, proves: textValue }),
    };
  }
  return changes;
}

function fieldValue(text: string, kind: "基本事实" | "委托事项") {
  const direct = text.match(new RegExp(`${kind}[：:]\\s*([^\\n]+)`))?.[1]?.trim();
  if (direct) return direct;
  return text
    .match(new RegExp(`(?:把)?${kind}(?:改成|改为|写成)[：:]?\\s*([^\\n]+)`))?.[1]
    ?.trim()
    .replace(/[。．]+$/u, "");
}

function pendingTexts(matterId: string) {
  const rows = database()
    .prepare(
      `SELECT read_text FROM materials
       WHERE matter_id = ? AND text_status = '待核对' AND read_text != ''`,
    )
    .all(matterId) as Array<{ read_text: string }>;
  return rows.map((row) => row.read_text.replace(/\s+/g, "")).filter((text) => text.length >= 8);
}

function guard(change: ProposedChange, pending: string[]): ProposedChange {
  if (pending.length === 0 || change.text.includes("待核实")) return change;
  const compact = change.text.replace(/\s+/g, "");
  const hit = pending.some((text) => text.includes(compact) || compact.includes(text));
  if (!hit) return change;
  const text = `${change.text}（待核实）`;
  return { text, payload: text };
}

function insertProposal(threadId: string, kind: ChangeKind, change: ProposedChange) {
  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '问答', ?, ?, ?, NULL, ?)`,
    )
    .run(crypto.randomUUID(), threadId, change.text, kind, change.payload, stamp());
}

export async function stageChanges(input: {
  threadId: string;
  matterId: string;
  kinds: ChangeKind[];
  turns: Array<{ role: "lawyer" | "model"; body: string }>;
  brief: string;
}) {
  await connection();
  const lawyer = [...input.turns].reverse().find((turn) => turn.role === "lawyer")?.body ?? "";
  const labeled = labeledChanges(lawyer);
  const missing = input.kinds.filter((kind) => !labeled[kind]);
  const proposed = missing.length ? await proposeChanges(input.turns, input.brief, missing) : {};
  const seen = "error" in proposed ? {} : proposed;
  const pending = pendingTexts(input.matterId);
  for (const kind of input.kinds) {
    const change = guard(labeled[kind] || seen[kind] || { text: "待核实", payload: "待核实" }, pending);
    insertProposal(input.threadId, kind, change);
  }
}
