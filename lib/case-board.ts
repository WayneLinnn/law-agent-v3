import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";

export type CaseCard = {
  id: string;
  name: string;
  status: string;
  category: string;
  cause: string;
  caseNumber: string;
  instance: string;
  feeReceived: string | null;
  openedOn: string;
  clients: string[];
  opposing: string[];
  organs: string[];
  judge: string;
  assistant: string;
  clerk: string;
  division: string;
  tasks: Array<{ name: string; dueOn: string; overdue: boolean }>;
  node: { happenedOn: string; title: string; detail: string } | null;
};

function dayStamp(value: string) {
  return value.slice(0, 10);
}

function today() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function money(value: unknown) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return (Math.round(amount * 100) / 100).toFixed(2);
}

export async function listCaseCards(limit = 8, openOnly = false): Promise<CaseCard[]> {
  await connection();
  const db = database();
  const matters = db
    .prepare(
      `SELECT id, name, status, category, cause, case_number, instance, fee_received, created_at
       FROM matters
       ${openOnly ? "WHERE status NOT IN ('已结案', '已归档', '已终止')" : ""}
       ORDER BY COALESCE(opened_at, created_at) DESC, rowid DESC
       LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
  if (matters.length === 0) return [];
  const ids = matters.map((matter) => String(matter.id));
  const marks = ids.map(() => "?").join(", ");
  const parties = db
    .prepare(`SELECT matter_id, role, name FROM parties WHERE matter_id IN (${marks}) ORDER BY rowid`)
    .all(...ids) as Array<Record<string, unknown>>;
  const officers = db
    .prepare(
      `SELECT matter_id, judge, assistant, clerk, division FROM officers WHERE matter_id IN (${marks})`,
    )
    .all(...ids) as Array<Record<string, unknown>>;
  const tasks = db
    .prepare(
      `SELECT t.matter_id, t.name, t.due_on
       FROM tasks t
       WHERE t.matter_id IN (${marks})
         AND t.confirmed_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM task_resolutions r WHERE r.task_id = t.id)
       ORDER BY t.due_on, t.rowid`,
    )
    .all(...ids) as Array<Record<string, unknown>>;
  const nodes = db
    .prepare(
      `SELECT matter_id, happened_on, title, detail
       FROM nodes WHERE matter_id IN (${marks})
       ORDER BY happened_on DESC, rowid DESC`,
    )
    .all(...ids) as Array<Record<string, unknown>>;
  const due = today();

  return matters.map((matter) => {
    const id = String(matter.id);
    const mine = parties.filter((party) => String(party.matter_id) === id);
    const officer = officers.find((row) => String(row.matter_id) === id);
    const node = nodes.find((row) => String(row.matter_id) === id);
    return {
      id,
      name: String(matter.name),
      status: String(matter.status),
      category: String(matter.category ?? ""),
      cause: String(matter.cause ?? ""),
      caseNumber: String(matter.case_number ?? ""),
      instance: String(matter.instance ?? ""),
      feeReceived: money(matter.fee_received),
      openedOn: dayStamp(String(matter.created_at ?? "")),
      clients: mine.filter((party) => party.role === "client").map((party) => String(party.name)),
      opposing: mine.filter((party) => party.role === "opposing").map((party) => String(party.name)),
      organs: mine.filter((party) => party.role === "organ").map((party) => String(party.name)),
      judge: String(officer?.judge ?? ""),
      assistant: String(officer?.assistant ?? ""),
      clerk: String(officer?.clerk ?? ""),
      division: String(officer?.division ?? ""),
      tasks: tasks
        .filter((task) => String(task.matter_id) === id)
        .slice(0, 3)
        .map((task) => ({
          name: String(task.name),
          dueOn: String(task.due_on),
          overdue: String(task.due_on) < due,
        })),
      node: node
        ? {
            happenedOn: String(node.happened_on),
            title: String(node.title),
            detail: String(node.detail ?? ""),
          }
        : null,
    };
  });
}
