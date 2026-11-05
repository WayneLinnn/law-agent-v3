import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";

const TEXT_LIMIT = 8_000;

export async function caseBrief(matterId: string): Promise<string | null> {
  await connection();
  const matter = database()
    .prepare("SELECT status, cause, facts, mandate, fee_received FROM matters WHERE id = ?")
    .get(matterId) as
    | { status: string; cause: string; facts: string; mandate: string; fee_received: number | null }
    | undefined;
  if (!matter) return null;

  const parties = database()
    .prepare("SELECT role, name, position FROM parties WHERE matter_id = ? ORDER BY rowid")
    .all(matterId) as Array<{ role: string; name: string; position: string }>;
  const tasks = database()
    .prepare("SELECT name, due_on, confirmed_at FROM tasks WHERE matter_id = ? ORDER BY due_on, rowid")
    .all(matterId) as Array<{ name: string; due_on: string; confirmed_at: string | null }>;
  const notes = database()
    .prepare("SELECT kind, body FROM notes WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ kind: string; body: string }>;
  const focuses = database()
    .prepare("SELECT body FROM focuses WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ body: string }>;
  const sources = database()
    .prepare("SELECT title FROM sources WHERE matter_id = ? ORDER BY rowid")
    .all(matterId) as Array<{ title: string }>;
  const draft = database()
    .prepare(
      `SELECT kind, final FROM drafts WHERE matter_id = ?
       ORDER BY CASE WHEN final = 0 THEN 0 ELSE 1 END, version DESC, rowid DESC LIMIT 1`,
    )
    .get(matterId) as { kind: string; final: number } | undefined;
  const closing = database()
    .prepare("SELECT outcome, outcome_on FROM closings WHERE matter_id = ?")
    .get(matterId) as { outcome: string; outcome_on: string } | undefined;

  const materials = database()
    .prepare(
      `SELECT filename, kind, proves, text_status, usable_text
       FROM materials WHERE matter_id = ? ORDER BY created_at, rowid`,
    )
    .all(matterId) as Array<{
    filename: string;
    kind: string;
    proves: string;
    text_status: string;
    usable_text: string;
  }>;

  const roleName = { client: "客户", opposing: "对方", organ: "办案机关" } as const;
  const lines = [
    `状态：${matter.status}`,
    `案由：${matter.cause || "还没写"}`,
    `委托事项：${matter.mandate || "还没写"}`,
    `基本事实：${matter.facts || "还没写"}`,
    `实收：${matter.fee_received == null ? "还没记" : matter.fee_received}`,
    "当事人：",
  ];
  if (parties.length === 0) lines.push("还没写。");
  for (const party of parties) {
    const role = roleName[party.role as keyof typeof roleName] ?? party.role;
    lines.push(`- ${role} ${party.name}${party.position ? `，诉讼地位 ${party.position}` : ""}`);
  }
  lines.push("待办：");
  if (tasks.length === 0) lines.push("还没写。");
  for (const task of tasks) {
    lines.push(`- ${task.name} ${task.due_on} ${task.confirmed_at ? "已确认" : "未确认"}`);
  }
  const nodes = database()
    .prepare("SELECT happened_on, title, detail FROM nodes WHERE matter_id = ? ORDER BY happened_on, created_at, rowid")
    .all(matterId) as Array<{ happened_on: string; title: string; detail: string }>;
  lines.push("节点：");
  if (nodes.length === 0) lines.push("还没写。");
  for (const node of nodes) {
    lines.push(`- ${node.happened_on} ${node.title}${node.detail ? `：${node.detail}` : ""}`);
  }
  lines.push("要点：");
  if (notes.length === 0) lines.push("还没写。");
  for (const note of notes) {
    const body = note.body.trim();
    lines.push(`- ${note.kind}：${body.length > 400 ? `${body.slice(0, 400)}……` : body}`);
  }
  lines.push("焦点：");
  if (focuses.length === 0) lines.push("还没写。");
  for (const focus of focuses) lines.push(`- ${focus.body}`);
  lines.push("已勾选出处：");
  if (sources.length === 0) lines.push("还没写。");
  for (const source of sources) lines.push(`- ${source.title}`);
  lines.push(`文书：${draft ? `${draft.kind}${draft.final ? "（已定稿）" : ""}` : "还没写"}`);
  lines.push(`办结：${closing ? `${closing.outcome} ${closing.outcome_on}` : "还没写"}`);
  lines.push("材料：");
  if (materials.length === 0) lines.push("本案还没有材料。");
  for (const material of materials) {
    lines.push(`- ${material.filename}（${material.text_status}）`);
    if (material.kind) lines.push(`  种类：${material.kind}`);
    lines.push(`  证明对象：${material.proves || "还没写"}`);
    const text = material.usable_text.trim();
    if (text) {
      lines.push(`  正文：${text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}……` : text}`);
    } else {
      lines.push("  还没读。");
    }
  }
  return lines.join("\n");
}
