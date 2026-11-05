import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const clientName = `核对客户${Date.now()}`;
const filename = "付款凭证.txt";
const line = "核对暗号-已付清-8821。";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, payload: await response.json() };
}

function proposals(detail, kind) {
  return detail.thread.messages.filter((message) => message.proposalKind === kind && !message.acceptedAt);
}

function answerText(detail) {
  const answers = detail.thread.messages.filter((message) => message.role === "model" && !message.proposalKind);
  return answers.at(-1)?.body ?? "";
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
  const form = new FormData();
  form.set("file", new File([line], filename, { type: "text/plain" }));
  const uploaded = await fetch(`${base}/api/matters/${matterId}/materials`, { method: "POST", body: form });
  const material = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(material));
  const confirmed = await postJson(`${base}/api/matters/${matterId}/materials/${material.id}/confirm`, { text: line });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.payload));

  const read = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "总结一下付款凭证的内容。",
  });
  assert.equal(read.status, 201, JSON.stringify(read.payload));
  let detail = await fetch(`${base}/api/threads/${read.payload.id}`).then((response) => response.json());
  const readAnswer = answerText(detail);
  assert.equal(readAnswer.includes(line), true, readAnswer);
  assert.equal(readAnswer.includes("还没核对"), false, readAnswer);
  assert.equal(readAnswer.includes("这里不附"), false, readAnswer);

  const reminded = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "11月25日上午10点会见客户，提醒我。",
  });
  assert.equal(reminded.status, 200);
  let tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 0);
  detail = await fetch(`${base}/api/threads/${read.payload.id}`).then((response) => response.json());
  const meeting = proposals(detail, "待办").find((item) => item.body.includes("2026-11-25"));
  assert.ok(meeting, answerText(detail));
  assert.equal(meeting.body.includes("会见客户"), true, meeting.body);
  const page = await fetch(`${base}/matters/${matterId}`).then((response) => response.text());
  const dueAt = page.indexOf('aria-label="待办"');
  const confirmAt = page.indexOf(">待确认<");
  const pendingSlice = page.slice(confirmAt, confirmAt + 500);
  assert.equal(pendingSlice.includes("会见客户"), true, page.slice(dueAt, confirmAt + 800));
  assert.equal(pendingSlice.includes("2026-11-25"), true, pendingSlice);

  const month = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "提醒我27年1月份续封。",
  });
  assert.equal(month.status, 200);
  detail = await fetch(`${base}/api/threads/${read.payload.id}`).then((response) => response.json());
  const seal = proposals(detail, "待办").find((item) => item.body.includes("2027-01-01"));
  assert.ok(seal, answerText(detail));
  assert.equal(seal.body.includes("续封"), true, seal.body);
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 0);
} finally {
  if (matterId) {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
    db.exec("PRAGMA foreign_keys = ON");
    const rows = db.prepare("SELECT id FROM threads WHERE matter_id = ?").all(matterId);
    for (const row of rows) {
      db.prepare("DELETE FROM messages WHERE thread_id = ?").run(row.id);
      db.prepare("DELETE FROM threads WHERE id = ?").run(row.id);
    }
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

console.log("read and reminder ok");
