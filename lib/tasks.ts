import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";

const MAX_NAME = 200;
const PROMPT_DAYS = 90;

type Failure = { error: string; status: 400 | 404 | 409 };

export type TaskRecord = {
  id: string;
  name: string;
  dueOn: string;
  confirmedAt: string | null;
  createdAt: string;
};

export type DueTask = {
  id: string;
  matterId: string;
  matterName: string;
  name: string;
  dueOn: string;
  overdue: boolean;
};

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function localDay(offset = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offset);
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

function cleanName(value: unknown): Failure | { name: string } {
  if (typeof value !== "string") return { error: "没有读懂提交的内容。", status: 400 };
  const name = value.trim();
  if (!name) return { error: "请写下名称。", status: 400 };
  if (name.length > MAX_NAME) return { error: "这段太长。", status: 400 };
  return { name };
}

function cleanDate(value: unknown): Failure | { dueOn: string } {
  if (typeof value !== "string") return { error: "没有读懂提交的内容。", status: 400 };
  const dueOn = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { error: "请写下到期日。", status: 400 };
  const [year, month, day] = dueOn.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { error: "请写下到期日。", status: 400 };
  }
  return { dueOn };
}

export async function listTasks(matterId: string): Promise<TaskRecord[]> {
  await connection();
  const rows = database()
    .prepare(
      `SELECT id, name, due_on, confirmed_at, created_at
       FROM tasks WHERE matter_id = ? ORDER BY due_on, created_at, rowid`,
    )
    .all(matterId) as Array<{
    id: string;
    name: string;
    due_on: string;
    confirmed_at: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    dueOn: row.due_on,
    confirmedAt: row.confirmed_at || null,
    createdAt: row.created_at,
  }));
}

export async function addTask(
  matterId: string,
  input: { name?: unknown; dueOn?: unknown },
): Promise<Failure | { id: string; status: 201 }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const name = cleanName(input.name);
  if ("error" in name) return name;
  const dueOn = cleanDate(input.dueOn);
  if ("error" in dueOn) return dueOn;
  const existing = database()
    .prepare("SELECT id FROM tasks WHERE matter_id = ? AND name = ? AND due_on = ?")
    .get(matterId, name.name, dueOn.dueOn) as { id: string } | undefined;
  if (existing) return { error: "这条待办已经有了。", status: 409 };

  const id = crypto.randomUUID();
  database()
    .prepare(
      `INSERT INTO tasks (id, matter_id, name, due_on, note, confirmed_at, created_at)
       VALUES (?, ?, ?, ?, '', NULL, ?)`,
    )
    .run(id, matterId, name.name, dueOn.dueOn, stamp());
  return { id, status: 201 };
}

export async function updateTask(
  matterId: string,
  taskId: string,
  input: { name?: string; dueOn?: string },
): Promise<Failure | { id: string; name: string; dueOn: string }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const task = database()
    .prepare("SELECT id, name, due_on FROM tasks WHERE id = ? AND matter_id = ?")
    .get(taskId, matterId) as { id: string; name: string; due_on: string } | undefined;
  if (!task) return { error: "没有这条待办。", status: 404 };
  const name = input.name === undefined ? { name: task.name } : cleanName(input.name);
  if ("error" in name) return name;
  const dueOn = input.dueOn === undefined ? { dueOn: task.due_on } : cleanDate(input.dueOn);
  if ("error" in dueOn) return dueOn;
  const clash = database()
    .prepare("SELECT id FROM tasks WHERE matter_id = ? AND name = ? AND due_on = ? AND id != ?")
    .get(matterId, name.name, dueOn.dueOn, taskId) as { id: string } | undefined;
  if (clash) return { error: "这条待办已经有了。", status: 409 };
  database()
    .prepare("UPDATE tasks SET name = ?, due_on = ? WHERE id = ? AND matter_id = ?")
    .run(name.name, dueOn.dueOn, taskId, matterId);
  return { id: taskId, name: name.name, dueOn: dueOn.dueOn };
}

export async function confirmTask(
  matterId: string,
  taskId: string,
): Promise<Failure | { id: string; status: 200 }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const db = database();
  const task = db
    .prepare("SELECT id, confirmed_at FROM tasks WHERE id = ? AND matter_id = ?")
    .get(taskId, matterId) as { id: string; confirmed_at: string | null } | undefined;
  if (!task) return { error: "没有这条待办。", status: 404 };
  if (task.confirmed_at) return { error: "这条待办已经确认。", status: 409 };
  db.prepare("UPDATE tasks SET confirmed_at = ? WHERE id = ? AND matter_id = ?").run(
    stamp(),
    taskId,
    matterId,
  );
  return { id: taskId, status: 200 };
}

export async function dropTask(
  matterId: string,
  taskId: string,
): Promise<Failure | { id: string; status: 200 }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const task = database()
    .prepare("SELECT id, confirmed_at FROM tasks WHERE id = ? AND matter_id = ?")
    .get(taskId, matterId) as { id: string; confirmed_at: string | null } | undefined;
  if (!task) return { error: "没有这条待办。", status: 404 };
  const db = database();
  db.prepare("DELETE FROM task_resolutions WHERE task_id = ?").run(taskId);
  db.prepare("DELETE FROM tasks WHERE id = ? AND matter_id = ?").run(taskId, matterId);
  return { id: taskId, status: 200 };
}

export async function listOpenTasks(limit = 5): Promise<DueTask[]> {
  await connection();
  const today = localDay();
  const rows = database()
    .prepare(
      `SELECT t.id, t.matter_id, m.name AS matter_name, t.name, t.due_on
       FROM tasks t
       JOIN matters m ON m.id = t.matter_id
       WHERE t.confirmed_at IS NOT NULL AND t.confirmed_at != ''
         AND m.status NOT IN ('已归档', '已终止')
         AND NOT EXISTS (SELECT 1 FROM task_resolutions r WHERE r.task_id = t.id)
       ORDER BY t.due_on, t.created_at, t.rowid
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    matter_id: string;
    matter_name: string;
    name: string;
    due_on: string;
  }>;
  return rows.map((row) => ({
    id: String(row.id),
    matterId: String(row.matter_id),
    matterName: String(row.matter_name),
    name: String(row.name),
    dueOn: String(row.due_on),
    overdue: String(row.due_on) < today,
  }));
}

export async function listDue(): Promise<{ prompts: DueTask[]; due: DueTask[] }> {
  await connection();
  const today = localDay();
  const horizon = localDay(PROMPT_DAYS);
  const rows = database()
    .prepare(
      `SELECT t.id, t.matter_id, m.name AS matter_name, t.name, t.due_on
       FROM tasks t
       JOIN matters m ON m.id = t.matter_id
       WHERE t.confirmed_at IS NOT NULL AND t.confirmed_at != ''
       ORDER BY t.due_on, t.created_at, t.rowid`,
    )
    .all() as Array<{
    id: string;
    matter_id: string;
    matter_name: string;
    name: string;
    due_on: string;
  }>;
  const due = rows.map((row) => ({
    id: row.id,
    matterId: row.matter_id,
    matterName: row.matter_name,
    name: row.name,
    dueOn: row.due_on,
    overdue: row.due_on < today,
  }));
  return { prompts: due.filter((task) => task.dueOn <= horizon), due };
}

export function reminderOf(tasks: TaskRecord[]) {
  const today = localDay();
  const horizon = localDay(PROMPT_DAYS);
  return tasks
    .filter((task) => task.confirmedAt && task.dueOn <= horizon)
    .map((task) => ({
      id: task.id,
      name: task.name,
      dueOn: task.dueOn,
      overdue: task.dueOn < today,
    }));
}

export async function describeDue(matterId: string) {
  await connection();
  const tasks = await listTasks(matterId);
  if (tasks.length === 0) return "还没有待办。";
  const today = localDay();
  const lines = ["待办只有名称和到期日。"];
  for (const task of tasks) {
    const state = task.confirmedAt ? "已确认" : "未确认";
    const overdue = task.confirmedAt && task.dueOn < today ? "，已过期" : "";
    lines.push(`${task.name} ${task.dueOn} ${state}${overdue}`);
  }
  const remind = reminderOf(tasks);
  lines.push(
    remind.length === 0
      ? "右栏提醒：九十天内没有要提示的。"
      : `右栏提醒：${remind.map((task) => `${task.name} ${task.dueOn}${task.overdue ? " 已过期" : ""}`).join("、")}`,
  );
  return lines.join("\n");
}
