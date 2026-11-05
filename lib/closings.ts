import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";

type Failure = { error: string; status: 400 | 404 | 409 };

export type ClosingView = {
  outcome: string;
  outcomeOn: string;
  outcomeNote: string;
  statement: string;
  confirmedAt: string | null;
  archivedAt: string | null;
};

export type ClosingTask = {
  id: string;
  name: string;
  dueOn: string;
  confirmedAt: string | null;
  result: string;
  note: string;
};

export type DossierItem = {
  id: string;
  section: string;
  label: string;
  refId: string | null;
  position: number;
};

const RESULTS = ["已完成", "不再适用"] as const;

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function cleanText(value: unknown, empty: string, max: number): Failure | { text: string } {
  if (typeof value !== "string") return { error: "没有读懂提交的内容。", status: 400 };
  const text = value.trim();
  if (!text) return { error: empty, status: 400 };
  if (text.length > max) return { error: "这段太长。", status: 400 };
  return { text };
}

function cleanNote(value: unknown): Failure | { note: string } {
  if (value == null) return { note: "" };
  if (typeof value !== "string") return { error: "没有读懂提交的内容。", status: 400 };
  const note = value.trim();
  if (note.length > 500) return { error: "这段太长。", status: 400 };
  return { note };
}

function cleanDay(value: unknown): Failure | { day: string } {
  if (typeof value !== "string") return { error: "没有读懂提交的内容。", status: 400 };
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "请写下办结日期。", status: 400 };
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(year, month - 1, date);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== date) {
    return { error: "请写下办结日期。", status: 400 };
  }
  return { day };
}

function clip(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? flat.slice(0, 200) : flat;
}

function promote(status: string, changed: boolean) {
  if (status === "草稿" || status === "待立案" || status === "办理中") return "结案中";
  if (status === "已结案" && changed) return "结案中";
  return status;
}

function transact<T extends Failure | { status: 200 }>(run: () => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    if ("error" in result) db.exec("ROLLBACK");
    else db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already closed */
    }
    throw error;
  }
}

function readStatus(matterId: string) {
  return database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
}

function closingRow(matterId: string) {
  return database()
    .prepare(
      `SELECT outcome, outcome_on, outcome_note, statement, confirmed_at, archived_at
       FROM closings WHERE matter_id = ?`,
    )
    .get(matterId) as
    | {
        outcome: string;
        outcome_on: string;
        outcome_note: string;
        statement: string;
        confirmed_at: string | null;
        archived_at: string | null;
      }
    | undefined;
}

function unresolvedCount(matterId: string) {
  const row = database()
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks t
       WHERE t.matter_id = ?
         AND NOT EXISTS (SELECT 1 FROM task_resolutions r WHERE r.task_id = t.id)`,
    )
    .get(matterId) as { n: number };
  return Number(row.n);
}

function guard(matterId: string): Failure | { statusName: string } {
  const matter = readStatus(matterId);
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  if (matter.status === "已终止") return { error: "这件案子已经终止。", status: 400 };
  return { statusName: matter.status };
}

export async function getClosing(matterId: string): Promise<{
  closing: ClosingView | null;
  tasks: ClosingTask[];
  dossier: DossierItem[];
} | null> {
  await connection();
  if (!readStatus(matterId)) return null;
  const row = closingRow(matterId);
  const tasks = database()
    .prepare(
      `SELECT t.id, t.name, t.due_on, t.confirmed_at, COALESCE(r.result, '') AS result, COALESCE(r.note, '') AS note
       FROM tasks t
       LEFT JOIN task_resolutions r ON r.task_id = t.id
       WHERE t.matter_id = ?
       ORDER BY t.due_on, t.created_at, t.rowid`,
    )
    .all(matterId) as Array<{
    id: string;
    name: string;
    due_on: string;
    confirmed_at: string | null;
    result: string;
    note: string;
  }>;
  const dossier = database()
    .prepare(
      `SELECT id, section, label, ref_id, position
       FROM dossier_items WHERE matter_id = ? ORDER BY position, rowid`,
    )
    .all(matterId) as Array<{
    id: string;
    section: string;
    label: string;
    ref_id: string | null;
    position: number;
  }>;
  return {
    closing: row
      ? {
          outcome: row.outcome,
          outcomeOn: row.outcome_on,
          outcomeNote: row.outcome_note,
          statement: row.statement,
          confirmedAt: row.confirmed_at,
          archivedAt: row.archived_at,
        }
      : null,
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.name,
      dueOn: task.due_on,
      confirmedAt: task.confirmed_at,
      result: task.result,
      note: task.note,
    })),
    dossier: dossier.map((item) => ({
      id: item.id,
      section: item.section,
      label: item.label,
      refId: item.ref_id,
      position: item.position,
    })),
  };
}

export async function saveOutcome(
  matterId: string,
  input: { outcome?: unknown; outcomeOn?: unknown; outcomeNote?: unknown },
): Promise<Failure | { status: 200 }> {
  await connection();
  const gate = guard(matterId);
  if ("error" in gate) return gate;
  const outcome = cleanText(input.outcome, "请写下办结结果。", 80);
  if ("error" in outcome) return outcome;
  const outcomeOn = cleanDay(input.outcomeOn);
  if ("error" in outcomeOn) return outcomeOn;
  const outcomeNote = cleanText(input.outcomeNote, "请写下具体情况。", 2000);
  if ("error" in outcomeNote) return outcomeNote;

  return transact(() => {
    const again = guard(matterId);
    if ("error" in again) return again;
    const existing = closingRow(matterId);
    const changed =
      !existing ||
      existing.outcome !== outcome.text ||
      existing.outcome_on !== outcomeOn.day ||
      existing.outcome_note !== outcomeNote.text;
    const next = promote(again.statusName, changed);
    if (existing) {
      if (again.statusName === "已结案" && changed) {
        database()
          .prepare(
            `UPDATE closings
             SET outcome = ?, outcome_on = ?, outcome_note = ?, confirmed_at = NULL
             WHERE matter_id = ?`,
          )
          .run(outcome.text, outcomeOn.day, outcomeNote.text, matterId);
      } else {
        database()
          .prepare("UPDATE closings SET outcome = ?, outcome_on = ?, outcome_note = ? WHERE matter_id = ?")
          .run(outcome.text, outcomeOn.day, outcomeNote.text, matterId);
      }
    } else {
      database()
        .prepare(
          `INSERT INTO closings (
             matter_id, outcome, outcome_on, outcome_note, statement, confirmed_at, archived_at
           ) VALUES (?, ?, ?, ?, '', NULL, NULL)`,
        )
        .run(matterId, outcome.text, outcomeOn.day, outcomeNote.text);
    }
    if (next !== again.statusName) {
      database().prepare("UPDATE matters SET status = ? WHERE id = ?").run(next, matterId);
    }
    const after = readStatus(matterId);
    if (!after || after.status !== next) return { error: "没有记下办结结果。", status: 409 };
    return { status: 200 };
  });
}

export async function resolveTask(
  matterId: string,
  taskId: string,
  input: { result?: unknown; note?: unknown },
): Promise<Failure | { status: 200 }> {
  await connection();
  const gate = guard(matterId);
  if ("error" in gate) return gate;
  const result = typeof input.result === "string" ? input.result.trim() : "";
  if (!RESULTS.includes(result as (typeof RESULTS)[number])) return { error: "请写下处理结果。", status: 400 };
  const note = cleanNote(input.note);
  if ("error" in note) return note;

  return transact(() => {
    const again = guard(matterId);
    if ("error" in again) return again;
    if (!closingRow(matterId)) return { error: "请先写下办结结果。", status: 400 };
    const task = database().prepare("SELECT id FROM tasks WHERE id = ? AND matter_id = ?").get(taskId, matterId) as
      | { id: string }
      | undefined;
    if (!task) return { error: "没有这条待办。", status: 404 };
    const existing = database()
      .prepare("SELECT result, note FROM task_resolutions WHERE task_id = ?")
      .get(taskId) as { result: string; note: string } | undefined;
    const changed = !existing || existing.result !== result || existing.note !== note.note;
    const next = promote(again.statusName, changed);
    if (!existing) {
      database()
        .prepare(
          `INSERT INTO task_resolutions (task_id, matter_id, result, note, resolved_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(taskId, matterId, result, note.note, stamp());
    } else if (changed) {
      database()
        .prepare("UPDATE task_resolutions SET result = ?, note = ?, resolved_at = ? WHERE task_id = ?")
        .run(result, note.note, stamp(), taskId);
    }
    if (again.statusName === "已结案" && changed) {
      database().prepare("UPDATE closings SET confirmed_at = NULL WHERE matter_id = ?").run(matterId);
    }
    if (next !== again.statusName) {
      database().prepare("UPDATE matters SET status = ? WHERE id = ?").run(next, matterId);
    }
    const after = readStatus(matterId);
    if (!after || after.status !== next) return { error: "没有记下处理结果。", status: 409 };
    return { status: 200 };
  });
}

export async function saveStatement(
  matterId: string,
  input: { statement?: unknown },
): Promise<Failure | { status: 200 }> {
  await connection();
  const gate = guard(matterId);
  if ("error" in gate) return gate;
  const statement = cleanText(input.statement, "请写下结案说明。", 4000);
  if ("error" in statement) return statement;

  return transact(() => {
    const again = guard(matterId);
    if ("error" in again) return again;
    const existing = closingRow(matterId);
    if (!existing) return { error: "请先写下办结结果。", status: 400 };
    const changed = existing.statement !== statement.text;
    const next = promote(again.statusName, changed);
    if (again.statusName === "已结案" && changed) {
      database()
        .prepare("UPDATE closings SET statement = ?, confirmed_at = NULL WHERE matter_id = ?")
        .run(statement.text, matterId);
    } else {
      database().prepare("UPDATE closings SET statement = ? WHERE matter_id = ?").run(statement.text, matterId);
    }
    if (next !== again.statusName) {
      database().prepare("UPDATE matters SET status = ? WHERE id = ?").run(next, matterId);
    }
    const after = readStatus(matterId);
    if (!after || after.status !== next) return { error: "没有记下结案说明。", status: 409 };
    return { status: 200 };
  });
}

export async function confirmClosing(matterId: string): Promise<Failure | { status: 200 }> {
  await connection();
  const gate = guard(matterId);
  if ("error" in gate) return gate;

  return transact(() => {
    const again = guard(matterId);
    if ("error" in again) return again;
    const existing = closingRow(matterId);
    if (!existing) return { error: "请先写下办结结果。", status: 400 };
    if (!existing.statement.trim()) return { error: "请写下结案说明。", status: 400 };
    if (unresolvedCount(matterId) > 0) return { error: "请先处理每条待办。", status: 400 };
    if (existing.confirmed_at && again.statusName === "已结案") {
      return { error: "结案说明已经确认。", status: 409 };
    }
    const now = stamp();
    database().prepare("UPDATE closings SET confirmed_at = ? WHERE matter_id = ?").run(now, matterId);
    if (again.statusName !== "已结案") {
      database().prepare("UPDATE matters SET status = '已结案' WHERE id = ?").run(matterId);
    }
    const after = readStatus(matterId);
    const saved = closingRow(matterId);
    if (!after || after.status !== "已结案" || !saved?.confirmed_at || saved.archived_at) {
      return { error: "没有确认结案说明。", status: 409 };
    }
    return { status: 200 };
  });
}

function dossierRows(matterId: string) {
  const db = database();
  const materials = db
    .prepare("SELECT id, filename FROM materials WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ id: string; filename: string }>;
  const notes = db
    .prepare(
      `SELECT id, kind, body FROM notes WHERE matter_id = ?
       ORDER BY CASE kind WHEN '时间线' THEN 1 WHEN '待核清单' THEN 2 WHEN '路径' THEN 3 ELSE 4 END,
                created_at, rowid`,
    )
    .all(matterId) as Array<{ id: string; kind: string; body: string }>;
  const sources = db
    .prepare("SELECT id, title FROM sources WHERE matter_id = ? ORDER BY accepted_at, rowid")
    .all(matterId) as Array<{ id: string; title: string }>;
  const drafts = db
    .prepare("SELECT id, kind, version FROM drafts WHERE matter_id = ? ORDER BY version, rowid")
    .all(matterId) as Array<{ id: string; kind: string; version: number }>;
  const tasks = db
    .prepare(
      `SELECT t.id, t.name, r.result
       FROM tasks t
       JOIN task_resolutions r ON r.task_id = t.id
       WHERE t.matter_id = ?
       ORDER BY t.due_on, t.created_at, t.rowid`,
    )
    .all(matterId) as Array<{ id: string; name: string; result: string }>;
  const closing = closingRow(matterId);
  const rows: Array<{ section: string; label: string; refId: string | null }> = [];
  for (const item of materials) rows.push({ section: "材料", label: clip(item.filename), refId: item.id });
  for (const item of notes) rows.push({ section: "要点", label: clip(`${item.kind} ${item.body}`), refId: item.id });
  for (const item of sources) rows.push({ section: "出处", label: clip(item.title), refId: item.id });
  for (const item of drafts) {
    rows.push({ section: "文书", label: clip(`${item.kind} 第${item.version}版`), refId: item.id });
  }
  for (const item of tasks) {
    rows.push({ section: "待办", label: clip(`${item.name}（${item.result}）`), refId: item.id });
  }
  if (closing) rows.push({ section: "结案说明", label: clip(closing.statement), refId: null });
  return rows;
}

export async function archiveMatter(matterId: string): Promise<Failure | { status: 200 }> {
  await connection();
  const current = readStatus(matterId);
  if (!current) return { error: "没有这件案子。", status: 404 };
  if (current.status === "已归档") return { error: "已经归档。", status: 409 };
  if (current.status === "已终止") return { error: "这件案子已经终止。", status: 400 };

  return transact(() => {
    const again = readStatus(matterId);
    if (!again) return { error: "没有这件案子。", status: 404 };
    if (again.status === "已归档") return { error: "已经归档。", status: 409 };
    if (again.status === "已终止") return { error: "这件案子已经终止。", status: 400 };
    const existing = closingRow(matterId);
    if (!existing || again.status !== "已结案" || !existing.confirmed_at) {
      return { error: "请先确认结案说明。", status: 400 };
    }
    if (!existing.statement.trim()) return { error: "请写下结案说明。", status: 400 };
    if (unresolvedCount(matterId) > 0) return { error: "请先处理每条待办。", status: 400 };
    const now = stamp();
    database().prepare("DELETE FROM dossier_items WHERE matter_id = ?").run(matterId);
    const insert = database().prepare(
      `INSERT INTO dossier_items (id, matter_id, section, label, ref_id, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    dossierRows(matterId).forEach((item, index) => {
      insert.run(crypto.randomUUID(), matterId, item.section, item.label, item.refId, index + 1);
    });
    database().prepare("UPDATE closings SET archived_at = ? WHERE matter_id = ?").run(now, matterId);
    database().prepare("UPDATE matters SET status = '已归档' WHERE id = ?").run(matterId);
    const after = readStatus(matterId);
    const saved = closingRow(matterId);
    if (!after || after.status !== "已归档" || !saved?.archived_at || !saved.confirmed_at) {
      return { error: "没有归档。", status: 409 };
    }
    return { status: 200 };
  });
}

export async function unarchiveMatter(matterId: string): Promise<Failure | { status: 200 }> {
  await connection();
  const current = readStatus(matterId);
  if (!current) return { error: "没有这件案子。", status: 404 };
  if (current.status !== "已归档") return { error: "这件案子没有归档。", status: 400 };

  return transact(() => {
    const again = readStatus(matterId);
    if (!again) return { error: "没有这件案子。", status: 404 };
    if (again.status !== "已归档") return { error: "这件案子没有归档。", status: 400 };
    database().prepare("UPDATE matters SET status = '已结案' WHERE id = ?").run(matterId);
    database().prepare("UPDATE closings SET archived_at = NULL WHERE matter_id = ?").run(matterId);
    database().prepare("DELETE FROM dossier_items WHERE matter_id = ?").run(matterId);
    const after = readStatus(matterId);
    const saved = closingRow(matterId);
    const left = database().prepare("SELECT COUNT(*) AS n FROM dossier_items WHERE matter_id = ?").get(matterId) as {
      n: number;
    };
    if (!after || after.status !== "已结案" || !saved?.confirmed_at || saved.archived_at || Number(left.n) !== 0) {
      return { error: "没有解档。", status: 409 };
    }
    return { status: 200 };
  });
}
