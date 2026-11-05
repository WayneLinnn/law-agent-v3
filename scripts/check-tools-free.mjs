import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const clientName = `自由客户${Date.now()}`;
const sourceTitle = "《中华人民共和国民法典》第五百零九条";
const sourceText = "当事人应当按照约定全面履行自己的义务。";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, payload: await response.json() };
}

function answerText(detail) {
  const answers = detail.thread.messages.filter((message) => message.role === "model" && !message.proposalKind);
  return answers.at(-1)?.body ?? "";
}

function openProposals(detail) {
  return detail.thread.messages.filter((message) => message.proposalKind && message.proposalKind !== "文书底稿" && !message.acceptedAt);
}

let matterId = "";

try {
  const created = await postJson(`${base}/api/matters`, {
    clientName,
    name: "",
    cause: "",
    facts: "",
    mandate: "",
    people: [],
    organs: [],
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  matterId = created.payload.id;

  const asked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "证据够不够？用两三句话，只根据可用文字。",
  });
  assert.equal(asked.status, 201, JSON.stringify(asked.payload));
  const threadId = asked.payload.id;
  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(openProposals(detail).length, 0, JSON.stringify(openProposals(detail)));

  const bare = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "请写答辩材料。",
  });
  assert.equal(bare.status, 200, JSON.stringify(bare.payload));
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const bareAnswer = answerText(detail);
  assert.equal(bareAnswer.includes("请先勾选出处"), false, bareAnswer);
  assert.equal(
    bareAnswer.includes("右边可以勾") || bareAnswer.includes("右边还没有可勾的") || bareAnswer.includes("没有查到"),
    true,
    bareAnswer,
  );
  assert.equal(detail.thread.messages.some((message) => message.proposalKind === "文书底稿"), false);

  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const focusId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const now = "2026-10-28T12:00:00";
  db.prepare(
    "INSERT INTO focuses (id, matter_id, body, position, confirmed_at, created_at) VALUES (?, ?, ?, 1, ?, ?)",
  ).run(focusId, matterId, "履行义务", now, now);
  db.prepare(
    `INSERT INTO sources (
      id, matter_id, focus_id, kind, source_id, title, text, url, status, detail, retrieved_at, accepted_at
    ) VALUES (?, ?, ?, 'law', ?, ?, ?, '', '', '', ?, ?)`,
  ).run(sourceId, matterId, focusId, `free-${sourceId}`, sourceTitle, sourceText, now, now);
  db.close();

  const drafted = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "帮我起草一份答辩状。",
  });
  assert.equal(drafted.status, 200, JSON.stringify(drafted.payload));
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const draftAnswer = answerText(detail);
  assert.equal(draftAnswer.includes("还没定稿"), true, draftAnswer);
  assert.equal(draftAnswer.length > 40, true, draftAnswer);
  assert.equal(detail.thread.messages.some((message) => message.proposalKind === "文书底稿"), true);
  const page = await fetch(`${base}/matters/${matterId}`).then((response) => response.text());
  assert.equal(page.includes("还没定稿"), true);
  const tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 0);

  const searched = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "查北大法宝里当事人应当按照约定全面履行自己的义务。",
  });
  assert.equal(searched.status, 200, JSON.stringify(searched.payload));
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const searchAnswer = answerText(detail);
  const candidates = await fetch(`${base}/api/threads/${threadId}/candidates`).then((response) => response.json());
  const found = (candidates.candidates?.items ?? []).length > 0;
  if (!found) assert.equal(searchAnswer.length > 0, true, "检索没有回话");
  const check = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const stored = check.prepare("SELECT COUNT(*) AS n FROM sources WHERE matter_id = ?").get(matterId);
  check.close();
  assert.equal(Number(stored.n), 1, searchAnswer);
} finally {
  if (matterId) {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
    db.exec("PRAGMA foreign_keys = ON");
    const rows = db.prepare("SELECT id FROM threads WHERE matter_id = ?").all(matterId);
    for (const row of rows) {
      db.prepare("DELETE FROM messages WHERE thread_id = ?").run(row.id);
      db.prepare("DELETE FROM threads WHERE id = ?").run(row.id);
    }
    db.prepare("DELETE FROM drafts WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM sources WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM focuses WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM materials WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM tasks WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM parties WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM matters WHERE id = ?").run(matterId);
    const client = db.prepare("SELECT id FROM clients WHERE name = ?").get(clientName);
    if (client) {
      const used = db.prepare("SELECT id FROM parties WHERE client_id = ?").get(client.id);
      if (!used) db.prepare("DELETE FROM clients WHERE id = ?").run(client.id);
    }
    db.close();
    fs.rmSync(path.join(process.cwd(), "data", "v3-files", matterId), { recursive: true, force: true });
  }
}

console.log("free tools ok");
