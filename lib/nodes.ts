import "server-only";

import { connection } from "next/server";

import { dayFromSpeech } from "@/lib/clock";
import { database } from "@/lib/db";

type Failure = { error: string; status: 400 | 404 | 409 };

export type NodeRecord = {
  id: string;
  happenedOn: string;
  title: string;
  detail: string;
  createdAt: string;
};

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function today() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function matterGate(matterId: string): Failure | null {
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  return null;
}

export async function nodeDocument(matterId: string) {
  const rows = await listNodes(matterId);
  if (rows.length === 0) return "";
  return rows.map((row) => `${row.happenedOn} ${row.title}${row.detail ? `：${row.detail}` : ""}`).join("\n");
}

export async function listNodes(matterId: string): Promise<NodeRecord[]> {
  await connection();
  const rows = database()
    .prepare(
      `SELECT id, happened_on, title, detail, created_at
       FROM nodes WHERE matter_id = ? ORDER BY happened_on, created_at, rowid`,
    )
    .all(matterId) as Array<{
    id: string;
    happened_on: string;
    title: string;
    detail: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    happenedOn: row.happened_on,
    title: row.title,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

export async function addNode(
  matterId: string,
  input: { happenedOn?: string; title?: string; detail?: string },
): Promise<Failure | { id: string }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const title = (input.title ?? "").trim().slice(0, 200);
  if (!title) return { error: "请写下节点名称。", status: 400 };
  const happenedOn = (input.happenedOn ?? "").trim() || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(happenedOn)) return { error: "请写下日期 YYYY-MM-DD。", status: 400 };
  const existing = database()
    .prepare("SELECT id FROM nodes WHERE matter_id = ? AND happened_on = ? AND title = ?")
    .get(matterId, happenedOn, title) as { id: string } | undefined;
  if (existing) return { id: existing.id };
  const id = crypto.randomUUID();
  database()
    .prepare(
      `INSERT INTO nodes (id, matter_id, happened_on, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, matterId, happenedOn, title, (input.detail ?? "").trim().slice(0, 4_000), stamp());
  return { id };
}

function datedPieces(body: string) {
  const rows: Array<{ happenedOn: string; title: string }> = [];
  for (const match of body.matchAll(/(\d{4}-\d{2}-\d{2})\s*([^0-9\n]+)/g)) {
    const title = match[2].replace(/[。；;，,\s]+$/g, "").trim();
    if (title) rows.push({ happenedOn: match[1], title: title.slice(0, 200) });
  }
  return rows;
}

export async function absorbDatedNotes(matterId: string) {
  await connection();
  const notes = database()
    .prepare(
      `SELECT notes.id, notes.body
       FROM notes
       LEFT JOIN note_imports ON note_imports.note_id = notes.id
       WHERE notes.matter_id = ? AND notes.kind = '时间线' AND note_imports.note_id IS NULL
       ORDER BY notes.created_at, notes.rowid`,
    )
    .all(matterId) as Array<{ id: string; body: string }>;
  const have = new Set((await listNodes(matterId)).map((node) => `${node.happenedOn}|${node.title}`));
  const mark = database().prepare("INSERT INTO note_imports (note_id) VALUES (?)");
  for (const note of notes) {
    for (const piece of datedPieces(note.body)) {
      const key = `${piece.happenedOn}|${piece.title}`;
      if (have.has(key)) continue;
      const saved = await addNode(matterId, piece);
      if (!("error" in saved)) have.add(key);
    }
    mark.run(note.id);
  }
}

export async function writeNodesFromText(matterId: string, text: string): Promise<Failure | { text: string }> {
  await connection();
  const pieces = datedPieces(text);
  if (pieces.length === 0) return { error: "写下日期和事项，例如 2026-10-05 完成执行。", status: 400 };
  const have = new Set((await listNodes(matterId)).map((node) => `${node.happenedOn}|${node.title}`));
  const wrote: string[] = [];
  for (const piece of pieces) {
    const key = `${piece.happenedOn}|${piece.title}`;
    if (have.has(key)) {
      wrote.push(`${piece.happenedOn} ${piece.title}`);
      continue;
    }
    const saved = await addNode(matterId, piece);
    if ("error" in saved) return saved;
    have.add(key);
    wrote.push(`${piece.happenedOn} ${piece.title}`);
  }
  return { text: `已写入节点。\n${wrote.join("\n")}` };
}

export function nodeLine(line: string) {
  let source = line.trim();
  if (!source) return null;
  const slash = source.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  let happenedOn = "";
  if (slash) {
    const month = Number(slash[2]);
    const day = Number(slash[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      happenedOn = `${slash[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      source = source.replace(slash[0], " ");
    }
  }
  if (!happenedOn) happenedOn = dayFromSpeech(source);
  if (!happenedOn) return null;
  const iso = source.match(/\d{4}-\d{2}-\d{2}/);
  const ymd = source.match(/\d{2,4}年\d{1,2}月\d{1,2}[日号]/);
  const md = source.match(/\d{1,2}月\d{1,2}[日号]/);
  if (iso) source = source.replace(iso[0], " ");
  else if (ymd) source = source.replace(ymd[0], " ");
  else if (md) source = source.replace(md[0], " ");
  else source = source.replace(/昨天|今天|前天/, " ");
  const title = source.replace(/\s+/g, " ").trim();
  const [name, ...rest] = title.split(/[：:]/);
  return {
    happenedOn,
    title: (name ?? "").trim().slice(0, 200),
    detail: rest.join("：").trim().slice(0, 4_000),
  };
}

export async function saveNodeDocument(
  matterId: string,
  text: string,
): Promise<Failure | { rows: NodeRecord[] }> {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { error: "写上至少一行。空着保存不会改节点。", status: 400 };
  const rows: Array<{ id: string; happenedOn: string; title: string; detail: string }> = [];
  for (const line of lines) {
    const parsed = nodeLine(line);
    if (!parsed?.happenedOn || !parsed.title) return { error: `这一行要有日期和事项：${line}`, status: 400 };
    rows.push({ id: "", ...parsed });
  }
  return saveNodeList(matterId, { rows });
}

export async function saveNodeList(
  matterId: string,
  input: unknown,
): Promise<Failure | { rows: NodeRecord[] }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  if (!input || typeof input !== "object" || !Array.isArray((input as { rows?: unknown }).rows)) {
    return { error: "没有读懂提交的内容。", status: 400 };
  }
  const raw = (input as { rows: unknown[] }).rows;
  if (raw.length > 80) return { error: "一次最多 80 行。", status: 400 };
  const rows: Array<{ id: string; happenedOn: string; title: string; detail: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "没有读懂提交的内容。", status: 400 };
    const id = String((item as { id?: unknown }).id ?? "").trim();
    const happenedOn = String((item as { happenedOn?: unknown }).happenedOn ?? "").trim();
    const title = String((item as { title?: unknown }).title ?? "").trim();
    const detail = String((item as { detail?: unknown }).detail ?? "").trim();
    if (!happenedOn && !title && !detail) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(happenedOn)) return { error: `这一行要有日期和事项：${title || happenedOn}`, status: 400 };
    if (!title) return { error: "每一行都要有事项。", status: 400 };
    rows.push({ id, happenedOn, title: title.slice(0, 200), detail: detail.slice(0, 4_000) });
  }
  const db = database();
  const existing = new Set(
    (db.prepare("SELECT id FROM nodes WHERE matter_id = ?").all(matterId) as Array<{ id: string }>).map((row) => row.id),
  );
  const now = stamp();
  const update = db.prepare("UPDATE nodes SET happened_on = ?, title = ?, detail = ? WHERE id = ? AND matter_id = ?");
  const insert = db.prepare(
    `INSERT INTO nodes (id, matter_id, happened_on, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const remove = db.prepare("DELETE FROM nodes WHERE id = ? AND matter_id = ?");
  db.exec("BEGIN");
  try {
    const keep = new Set<string>();
    for (const row of rows) {
      if (row.id && existing.has(row.id)) {
        update.run(row.happenedOn, row.title, row.detail, row.id, matterId);
        keep.add(row.id);
      } else {
        const id = crypto.randomUUID();
        insert.run(id, matterId, row.happenedOn, row.title, row.detail, now);
        keep.add(id);
      }
    }
    for (const id of existing) {
      if (!keep.has(id)) remove.run(id, matterId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { rows: await listNodes(matterId) };
}

export async function dropNode(
  matterId: string,
  nodeId: string,
): Promise<Failure | { id: string }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const row = database().prepare("SELECT id FROM nodes WHERE id = ? AND matter_id = ?").get(nodeId, matterId) as
    | { id: string }
    | undefined;
  if (!row) return { error: "没有这条节点。", status: 404 };
  database().prepare("DELETE FROM nodes WHERE id = ? AND matter_id = ?").run(nodeId, matterId);
  return { id: nodeId };
}

export async function writeReport(matterId: string): Promise<string> {
  await connection();
  const matter = database().prepare("SELECT name, status FROM matters WHERE id = ?").get(matterId) as
    | { name: string; status: string }
    | undefined;
  if (!matter) return "没有这件案子。";
  const nodes = await listNodes(matterId);
  const tasks = database()
    .prepare("SELECT name, due_on, confirmed_at FROM tasks WHERE matter_id = ? ORDER BY due_on, rowid")
    .all(matterId) as Array<{ name: string; due_on: string; confirmed_at: string | null }>;
  const notes = database()
    .prepare("SELECT kind, body FROM notes WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ kind: string; body: string }>;
  const lines = [`案件汇报：${matter.name}`, `状态：${matter.status}`, "", "节点："];
  if (nodes.length === 0) lines.push("还没有节点。");
  for (const node of nodes) {
    lines.push(`- ${node.happenedOn} ${node.title}${node.detail ? `：${node.detail}` : ""}`);
  }
  lines.push("", "待办：");
  if (tasks.length === 0) lines.push("还没有待办。");
  for (const task of tasks) {
    lines.push(`- ${task.name} ${task.due_on} ${task.confirmed_at ? "已确认" : "未确认"}`);
  }
  lines.push("", "已记下：");
  const kept = notes.filter((note) => note.kind !== "时间线");
  if (kept.length === 0) lines.push("还没有。");
  for (const note of kept) {
    const body = note.body.trim();
    lines.push(`- ${note.kind}：${body.length > 200 ? `${body.slice(0, 200)}……` : body}`);
  }
  return lines.join("\n");
}
