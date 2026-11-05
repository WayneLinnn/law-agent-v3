import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export async function listMatterThreads(matterId: string) {
  await connection();
  const rows = database()
    .prepare(
      `SELECT id, title, created_at FROM threads
       WHERE matter_id = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(matterId) as Array<{ id: string; title: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title || "新对话",
    createdAt: row.created_at,
  }));
}

export async function openCaseThread(matterId: string) {
  await connection();
  const matter = database().prepare("SELECT id FROM matters WHERE id = ?").get(matterId);
  if (!matter) return { error: "没有这件案子。", status: 404 as const };
  const blank = database()
    .prepare(
      `SELECT t.id FROM threads t
       WHERE t.matter_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.proposal_kind = ''
         )
       ORDER BY t.created_at DESC, t.rowid DESC
       LIMIT 1`,
    )
    .get(matterId) as { id: string } | undefined;
  if (blank) return { id: blank.id, status: 200 as const };
  const id = crypto.randomUUID();
  database()
    .prepare("INSERT INTO threads (id, matter_id, title, created_at) VALUES (?, ?, '新对话', ?)")
    .run(id, matterId, stamp());
  return { id, status: 201 as const };
}
