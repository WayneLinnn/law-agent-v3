import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "己公司";
const phone = "13800138000";
const idNumber = "330102199001011234";
const question = `${clientName}，电话${phone}，证件号${idNumber}，住址：杭州市西湖区某某路1号。房屋租赁合同约定租金已经付清，出租人能否再主张租金`;

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeFocuses = await fetch(`${base}/api/matters/${li}/focuses`).then((response) => response.json());

let looseThread = "";
let matterId = "";
let threadId = "";

try {
  const loose = await postJson(`${base}/api/threads`, {
    mode: "直接检索",
    text: "房屋租赁合同约定租金已经付清，出租人能否再主张租金",
  });
  assert.equal(loose.status, 201, JSON.stringify(loose.payload));
  looseThread = loose.payload.id;
  const looseCandidates = await fetch(`${base}/api/threads/${looseThread}/candidates`).then((response) => response.json());
  assert.equal(looseCandidates.candidates.items.length > 0, true);
  const blocked = await postJson(`${base}/api/threads/${looseThread}/candidates/accept`, {
    messageId: looseCandidates.candidates.messageId,
    sourceIds: [looseCandidates.candidates.items[0].sourceId],
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.payload.error, "先建成案子。");
  const looseDetail = await fetch(`${base}/api/threads/${looseThread}`).then((response) => response.json());
  assert.equal(looseDetail.thread.matterId, null);
  assert.equal(looseDetail.thread.messages.some((message) => message.role === "model"), false);

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

  const namedOnly = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "直接检索", text: clientName });
  assert.equal(namedOnly.status, 400);
  assert.equal(namedOnly.payload.error, "检索句里只剩下当事人信息。");

  const asked = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "直接检索", text: question });
  assert.equal(asked.status, 201, JSON.stringify(asked.payload));
  threadId = asked.payload.id;
  let focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses.length, 0);
  const candidates = await fetch(`${base}/api/threads/${threadId}/candidates`).then((response) => response.json());
  const batch = candidates.candidates;
  assert.equal(batch.items.length >= 2, true);
  assert.equal(batch.query.includes(clientName), false);
  assert.equal(batch.query.includes(phone), false);
  assert.equal(batch.query.includes(idNumber), false);
  assert.equal(batch.query.includes("某某路"), false);
  assert.equal(batch.query.includes("租金"), true);
  const detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.messages.length, 1);
  assert.equal(detail.thread.messages[0].mode, "直接检索");
  assert.equal(detail.thread.messages[0].body, question);

  const kept = await postJson(`${base}/api/threads/${threadId}/candidates/accept`, {
    messageId: batch.messageId,
    sourceIds: [batch.items[0].sourceId],
  });
  assert.equal(kept.status, 200);
  focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses.length, 1);
  assert.equal(focuses.focuses[0].body, question);
  assert.equal(Boolean(focuses.focuses[0].confirmedAt), true);
  assert.equal(focuses.focuses[0].sources.length, 1);
  assert.equal(focuses.focuses[0].sources[0].sourceId, batch.items[0].sourceId);
  assert.equal(focuses.focuses[0].sources[0].text.length > 0, true);
  assert.equal(focuses.focuses.some((focus) => focus.sources.some((source) => source.sourceId === batch.items[1].sourceId)), false);
  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.facts, "");
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);

  const repeat = await postJson(`${base}/api/threads/${threadId}/candidates/accept`, {
    messageId: batch.messageId,
    sourceIds: [batch.items[0].sourceId],
  });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.payload.error, "这一条已经收下。");

  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  db.prepare("UPDATE matters SET status = '已归档' WHERE id = ?").run(matterId);
  db.close();
  const archived = await postJson(`${base}/api/threads/${threadId}/candidates/accept`, {
    messageId: batch.messageId,
    sourceIds: [batch.items[1].sourceId],
  });
  assert.equal(archived.status, 409);
  assert.equal(archived.payload.error, "归档后只供查阅。");
  focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses[0].sources.length, 1);

  const dbDraft = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const messagesBefore = dbDraft.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?").get(threadId).n;
  dbDraft.close();
  const drafted = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "分析成文", text: "写成底稿" });
  assert.equal(drafted.status, 409);
  assert.equal(drafted.payload.error, "归档后只供查阅。");
  const drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 0);
  const dbAfter = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const messagesAfter = dbAfter.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?").get(threadId).n;
  dbAfter.close();
  assert.equal(messagesAfter, messagesBefore);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "已归档");
} finally {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  for (const id of [looseThread, threadId]) {
    if (!id) continue;
    db.prepare("DELETE FROM messages WHERE thread_id = ?").run(id);
    db.prepare("DELETE FROM threads WHERE id = ?").run(id);
  }
  if (matterId) {
    db.prepare("DELETE FROM drafts WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM sources WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM focuses WHERE matter_id = ?").run(matterId);
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

const after = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
assert.equal(after.matter.status, before.matter.status);
assert.equal(after.matter.facts, before.matter.facts);
assert.equal(after.matter.mandate, before.matter.mandate);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
const afterFocuses = await fetch(`${base}/api/matters/${li}/focuses`).then((response) => response.json());
assert.equal(afterFocuses.focuses.length, beforeFocuses.focuses.length);
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step10 api ok");
