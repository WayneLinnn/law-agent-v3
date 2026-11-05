import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import { proposeNotes, type NoteKind } from "@/lib/model";

const ORDER: NoteKind[] = ["时间线", "待核清单", "路径"];

export type NoteRecord = {
  id: string;
  kind: NoteKind;
  body: string;
  createdAt: string;
};

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function requestedNoteKinds(text: string): NoteKind[] {
  return ORDER.filter((kind) => text.includes(kind));
}

function labeledNotes(text: string): Partial<Record<NoteKind, string>> {
  const notes: Partial<Record<NoteKind, string>> = {};
  const timeline = text.match(/时间线[：:]\s*([^\n]+)/)?.[1]?.trim();
  const checklist = text.match(/待核清单[：:]\s*([^\n]+)/)?.[1]?.trim();
  const path = text.match(/路径[：:]\s*([^\n]+)/)?.[1]?.trim();
  if (timeline) notes.时间线 = timeline.slice(0, 4_000);
  if (checklist) notes.待核清单 = checklist.slice(0, 4_000);
  if (path) notes.路径 = path.slice(0, 4_000);
  return notes;
}

function pendingTexts(matterId: string) {
  const rows = database()
    .prepare(
      `SELECT read_text FROM materials
       WHERE matter_id = ? AND text_status = '待核对' AND read_text != ''`,
    )
    .all(matterId) as Array<{ read_text: string }>;
  return rows.map((row) => row.read_text.replace(/\s+/g, ""));
}

function usesPending(line: string, pending: string[]) {
  const value = line.replace(/（待核实）/g, "").replace(/\s+/g, "");
  if (value.length < 8) return false;
  return pending.some((text) => text.length >= 8 && (text.includes(value) || value.includes(text)));
}

function flagUnreviewed(body: string, pending: string[]) {
  if (pending.length === 0) return body;
  return body
    .split("\n")
    .map((line) => {
      if (!line.trim() || line.includes("待核实") || !usesPending(line, pending)) return line;
      return `${line}（待核实）`;
    })
    .join("\n");
}

function pathLine(text: string, label: "民事" | "刑事" | "行政") {
  const match = text.match(new RegExp(`${label}[：:]\\s*([\\s\\S]*?)(?=民事[：:]|刑事[：:]|行政[：:]|$)`));
  const value = match?.[1]
    ?.replace(/（待核验）|（待核实）|待核验/g, "")
    .replace(/[。；;\s]+$/g, "")
    .trim() || "给不出";
  if (!value || value === "待核实" || value === "给不出") return `${label}：给不出（待核验）`;
  if (value.includes("待核实")) return `${label}：${value}`;
  return `${label}：${value}（待核验）`;
}

function usableText(matterId: string) {
  const rows = database()
    .prepare(
      `SELECT usable_text FROM materials
       WHERE matter_id = ? AND text_status = '可用文字' AND usable_text != ''
       ORDER BY created_at, rowid`,
    )
    .all(matterId) as Array<{ usable_text: string }>;
  return rows
    .map((row) => row.usable_text.trim())
    .filter(Boolean)
    .join("\n");
}

function unknownNote(body: string) {
  return body.replace(/（待核验）|（待核实）|待核实|待核验|给不出/g, "").replace(/[\s：:。；;、，,]/g, "") === "";
}

export function formatPath(body: string) {
  const text = body.trim();
  if (!text || text === "待核实") return "待核实";
  if (!/民事|刑事|行政/.test(text)) {
    return ["民事", "刑事", "行政"]
      .map((label) => (label === "民事" ? pathLine(`民事：${text}`, "民事") : `${label}：给不出（待核验）`))
      .join("\n");
  }
  return (["民事", "刑事", "行政"] as const).map((label) => pathLine(text, label)).join("\n");
}

function insertProposal(threadId: string, kind: NoteKind, body: string) {
  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '问答', ?, ?, ?, NULL, ?)`,
    )
    .run(crypto.randomUUID(), threadId, body, kind, body, stamp());
}

export async function stageNotes(input: {
  threadId: string;
  matterId: string;
  kinds: NoteKind[];
  turns: Array<{ role: "lawyer" | "model"; body: string }>;
  brief: string;
}) {
  await connection();
  const lawyer = [...input.turns].reverse().find((turn) => turn.role === "lawyer")?.body ?? "";
  const labeled = labeledNotes(lawyer);
  const missing = input.kinds.filter((kind) => !labeled[kind]);
  const proposed = missing.length ? await proposeNotes(input.turns, input.brief, missing) : {};
  const seen = "error" in proposed ? {} : proposed;
  const pending = pendingTexts(input.matterId);
  const usable = usableText(input.matterId);
  for (const kind of input.kinds) {
    let body = labeled[kind] || seen[kind] || "待核实";
    if (kind === "时间线" && !labeled[kind] && unknownNote(body) && usable) body = usable;
    if (kind === "路径") body = formatPath(body);
    body = flagUnreviewed(body, pending);
    insertProposal(input.threadId, kind, body);
  }
}

export async function recordNote(
  matterId: string,
  kind: string,
  body: string,
): Promise<{ error: string; status: 400 | 404 | 409 } | { id: string }> {
  await connection();
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  if (!ORDER.includes(kind as NoteKind)) return { error: "这一项还不能记。", status: 400 };
  const text = body.trim().slice(0, 4_000);
  if (!text) return { error: "请写下要记的内容。", status: 400 };
  const id = crypto.randomUUID();
  database()
    .prepare("INSERT INTO notes (id, matter_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, matterId, kind, text, stamp());
  return { id };
}

export async function listNotes(matterId: string): Promise<NoteRecord[]> {
  await connection();
  const rows = database()
    .prepare(
      `SELECT id, kind, body, created_at FROM notes
       WHERE matter_id = ? ORDER BY created_at, rowid`,
    )
    .all(matterId) as Array<{ id: string; kind: NoteKind; body: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
  }));
}
