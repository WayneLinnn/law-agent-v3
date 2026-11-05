import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "丙公司";
const usableLine = "可用凭证甲乙丙-7f3a。租金已经付清。";
const hiddenLine = "未核对暗号丁戊己-7f3a。租金未付。";

function readNext(body) {
  if (!body) return [];
  const data = JSON.parse(body);
  return Array.isArray(data.next) ? data.next : [];
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

async function upload(matterId, filename, text) {
  const form = new FormData();
  form.set("file", new File([text], filename, { type: "text/plain" }));
  const response = await fetch(`${base}/api/matters/${matterId}/materials`, { method: "POST", body: form });
  return { status: response.status, payload: await response.json() };
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeThreads = await fetch(`${base}/api/threads`).then((response) => response.json());
const beforeList = await fetch(`${base}/api/matters`).then((response) => response.json());

let matterId = "";
let threadId = "";

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
  assert.equal(created.status, 201);
  matterId = created.payload.id;

  const opened = await fetch(`${base}/matters/${matterId}/handle`);
  assert.equal(opened.status, 200);
  const html = await opened.text();
  assert.equal(html.includes("材料"), true);
  assert.equal(html.includes("待确认"), true);
  assert.equal(html.includes(">概览<"), false);

  const dbEarly = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const none = dbEarly.prepare("SELECT id FROM threads WHERE matter_id = ?").get(matterId);
  dbEarly.close();
  assert.equal(none, undefined);

  const drafted = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "分析成文",
    text: "写成底稿",
  });
  assert.equal(drafted.status, 400);
  assert.equal(drafted.payload.error, "请先勾选出处。");
  const dbStill = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const stillNone = dbStill.prepare("SELECT id FROM threads WHERE matter_id = ?").get(matterId);
  dbStill.close();
  assert.equal(stillNone, undefined);

  const usable = await upload(matterId, "可用凭证.txt", usableLine);
  assert.equal(usable.status, 201);
  const hidden = await upload(matterId, "待核对.txt", hiddenLine);
  assert.equal(hidden.status, 201);
  const confirmed = await postJson(`${base}/api/matters/${matterId}/materials/${usable.payload.id}/confirm`, {
    text: usableLine,
  });
  assert.equal(confirmed.status, 200);

  const asked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "证据够不够？用两三句话，只根据可用文字。",
  });
  assert.equal(asked.status, 201);
  threadId = asked.payload.id;
  assert.equal(asked.payload.prompted, false);

  const detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.matterId, matterId);
  const talk = detail.thread.messages.filter((message) => !message.proposalKind);
  assert.equal(talk.length, 2);
  assert.equal(talk[0].role, "lawyer");
  assert.equal(talk[1].role, "model");
  assert.equal(talk[1].body.includes(hiddenLine), false);
  assert.equal(talk[1].body.includes("丁戊己"), false);
  const next = readNext(talk[1].proposalBody);
  assert.equal(next.length <= 3, true);
  assert.equal(next.length >= 1, true);
  assert.equal(talk[1].proposalKind, "");

  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.facts, "");
  assert.equal(matter.matter.feeReceived, null);
  const materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  const kept = materials.materials.find((item) => item.filename === "可用凭证.txt");
  const unread = materials.materials.find((item) => item.filename === "待核对.txt");
  assert.equal(kept.textStatus, "可用文字");
  assert.equal(kept.usableText, usableLine);
  assert.equal(unread.textStatus, "待核对");
  assert.equal(unread.readText, hiddenLine);
  assert.equal(unread.usableText, "");

  const listed = await fetch(`${base}/api/threads`).then((response) => response.json());
  assert.equal(listed.threads.some((thread) => thread.id === threadId), false);

  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  db.prepare("UPDATE matters SET status = '待立案' WHERE id = ?").run(matterId);
  db.close();

  const again = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "就现有文字，再答一句够不够。",
  });
  assert.equal(again.status, 200);
  assert.equal(again.payload.id, threadId);

  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "待立案");
  assert.equal(matter.matter.facts, "");
  const afterDetail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const answers = afterDetail.thread.messages.filter((message) => message.role === "model" && !message.proposalKind);
  assert.equal(answers.length, 2);
  assert.equal(answers.every((message) => !message.body.includes("丁戊己")), true);
} finally {
  if (matterId || threadId) {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
    db.exec("PRAGMA foreign_keys = ON");
    if (!threadId && matterId) {
      const row = db.prepare("SELECT id FROM threads WHERE matter_id = ?").get(matterId);
      threadId = row?.id ?? "";
    }
    if (threadId) {
      db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
      db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
    }
    if (matterId) {
      db.prepare("DELETE FROM materials WHERE matter_id = ?").run(matterId);
      db.prepare("DELETE FROM parties WHERE matter_id = ?").run(matterId);
      db.prepare("DELETE FROM matters WHERE id = ?").run(matterId);
      fs.rmSync(path.join(process.cwd(), "data", "v3-files", matterId), { recursive: true, force: true });
    }
    const client = db.prepare("SELECT id FROM clients WHERE name = ?").get(clientName);
    if (client) {
      const used = db.prepare("SELECT id FROM parties WHERE client_id = ?").get(client.id);
      if (!used) db.prepare("DELETE FROM clients WHERE id = ?").run(client.id);
    }
    db.close();
  }
}

const after = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
assert.equal(after.matter.status, before.matter.status);
assert.equal(after.matter.facts, before.matter.facts);
assert.equal(after.matter.cause, before.matter.cause);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
const afterThreads = await fetch(`${base}/api/threads`).then((response) => response.json());
assert.equal(afterThreads.threads.length, beforeThreads.threads.length);
const afterList = await fetch(`${base}/api/matters`).then((response) => response.json());
assert.equal(afterList.matters.length, beforeList.matters.length);
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step7 api ok");
