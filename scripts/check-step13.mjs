import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";

const messagesSql = `SELECT COUNT(*) AS n FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE matter_id = ?)`;

function countsFor(db) {
  const one = (sql) => db.prepare(sql).get(li).n;
  return {
    messages: one(messagesSql),
    threads: one("SELECT COUNT(*) AS n FROM threads WHERE matter_id = ?"),
    drafts: one("SELECT COUNT(*) AS n FROM drafts WHERE matter_id = ?"),
    sources: one("SELECT COUNT(*) AS n FROM sources WHERE matter_id = ?"),
    tasks: one("SELECT COUNT(*) AS n FROM tasks WHERE matter_id = ?"),
    closings: one("SELECT COUNT(*) AS n FROM closings WHERE matter_id = ?"),
    dossier: one("SELECT COUNT(*) AS n FROM dossier_items WHERE matter_id = ?"),
    materials: one("SELECT COUNT(*) AS n FROM materials WHERE matter_id = ?"),
  };
}

function snapshot() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"), { readOnly: true });
  const row = db.prepare("SELECT status, facts, mandate, fee_received FROM matters WHERE id = ?").get(li);
  const tasks = db.prepare("SELECT name, due_on, confirmed_at FROM tasks WHERE matter_id = ? ORDER BY due_on").all(li);
  const counts = countsFor(db);
  db.close();
  return { row, tasks, counts };
}

const before = snapshot();
const opened = await fetch(`${base}/matters/${li}`);
assert.equal(opened.status, 200);
assert.equal(opened.url, `${base}/matters/${li}`);
const html = await opened.text();
assert.equal(html.includes(">概览<"), false);
assert.equal(html.includes(">办理<"), false);
assert.equal(html.includes(">归档<"), false);
assert.equal(html.includes('aria-current="page"'), false);
assert.equal(html.includes(">材料<"), true);
assert.equal(html.includes(">待确认<"), true);

const dueAt = html.indexOf('aria-label="待办"');
const pendingAt = html.indexOf(">待确认<");
assert.ok(dueAt >= 0 && pendingAt > dueAt);
const due = html.slice(dueAt, pendingAt);
assert.equal(due.includes("提交证据"), true);
assert.equal(due.includes("2026-11-20"), true);
assert.equal(due.includes("核对付款凭证"), true);
assert.equal(due.includes("未确认"), true);

const again = await fetch(`${base}/matters/${li}/handle`);
assert.equal(again.status, 200);
assert.equal(again.url, `${base}/matters/${li}`);

const after = snapshot();
assert.deepEqual(after, before);
console.log("step13 open ok");
