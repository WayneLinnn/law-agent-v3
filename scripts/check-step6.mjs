import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "乙公司";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

function proposal(detail, kind) {
  return detail.thread.messages.find((message) => message.proposalKind === kind);
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeList = await fetch(`${base}/api/matters`).then((response) => response.json());
const beforeThreads = await fetch(`${base}/api/threads`).then((response) => response.json());

let threadId = "";
let matterId = "";

try {
  const opened = await postJson(`${base}/api/threads`, {
    mode: "问答",
    text: "当事人甲公司，诉讼地位原告。案由是房屋租赁合同纠纷。基本事实是承租人称租金已经付清。",
  });
  assert.equal(opened.status, 201);
  threadId = opened.payload.id;

  const missing = await postJson(`${base}/api/threads/${threadId}/case`, { clientName: "  " });
  assert.equal(missing.status, 400);
  assert.equal(missing.payload.error, "请点明谁是客户。");
  const still = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(still.thread.matterId, null);
  const listAfterReject = await fetch(`${base}/api/matters`).then((response) => response.json());
  assert.equal(listAfterReject.matters.length, beforeList.matters.length);

  const created = await postJson(`${base}/api/threads/${threadId}/case`, { clientName });
  assert.equal(created.status, 201);
  matterId = created.payload.matterId;
  assert.equal(typeof matterId, "string");

  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.name, clientName);
  assert.equal(matter.matter.cause, "");
  assert.equal(matter.matter.facts, "");
  assert.equal(matter.matter.mandate, "");
  assert.equal(matter.matter.feeReceived, null);
  assert.equal(matter.matter.parties.length, 1);
  assert.equal(matter.matter.parties[0].role, "client");
  assert.equal(matter.matter.parties[0].name, clientName);

  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.matterId, matterId);
  const parties = proposal(detail, "当事人");
  const cause = proposal(detail, "案由");
  const facts = proposal(detail, "基本事实");
  assert.equal(Boolean(parties && cause && facts), true);
  assert.equal(parties.acceptedAt, null);
  assert.equal(cause.acceptedAt, null);
  assert.equal(facts.acceptedAt, null);
  assert.equal(cause.body, "房屋租赁合同纠纷");
  assert.equal(facts.body, "承租人称租金已经付清");
  assert.equal(parties.body.includes("甲公司"), true);
  assert.equal(parties.body.includes("、"), false);

  const listed = await fetch(`${base}/api/threads`).then((response) => response.json());
  assert.equal(listed.threads.some((thread) => thread.id === threadId), false);

  const again = await postJson(`${base}/api/threads/${threadId}/case`, { clientName });
  assert.equal(again.status, 409);
  assert.equal(again.payload.error, "这段对话已经挂到案子上。");

  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  const unverified = crypto.randomUUID();
  const blocked = crypto.randomUUID();
  const now = "2026-10-25T23:50:00";
  db.prepare(
    `INSERT INTO messages (
      id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
    ) VALUES (?, ?, 'model', '问答', ?, ?, ?, NULL, ?)`,
  ).run(unverified, threadId, "待核实", "基本事实", "待核实", now);
  db.prepare(
    `INSERT INTO messages (
      id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
    ) VALUES (?, ?, 'model', '问答', ?, ?, ?, NULL, ?)`,
  ).run(blocked, threadId, "下一步", "待办", "核对合同", now);
  db.close();

  const unverifiedSaved = await postJson(
    `${base}/api/threads/${threadId}/proposals/${unverified}/accept`,
    {},
  );
  assert.equal(unverifiedSaved.status, 400);
  assert.equal(unverifiedSaved.payload.error, "待核实的不能留下。");

  const blockedSaved = await postJson(
    `${base}/api/threads/${threadId}/proposals/${blocked}/accept`,
    {},
  );
  assert.equal(blockedSaved.status, 400);
  assert.equal(blockedSaved.payload.error, "这一项还不能留下。");

  const missingItem = await postJson(
    `${base}/api/threads/${threadId}/proposals/${crypto.randomUUID()}/accept`,
    {},
  );
  assert.equal(missingItem.status, 404);
  assert.equal(missingItem.payload.error, "没有这一项。");

  const acceptedCause = await postJson(
    `${base}/api/threads/${threadId}/proposals/${cause.id}/accept`,
    {},
  );
  assert.equal(acceptedCause.status, 200);

  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.cause, "房屋租赁合同纠纷");
  assert.equal(matter.matter.facts, "");
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.parties.length, 1);

  const repeat = await postJson(`${base}/api/threads/${threadId}/proposals/${cause.id}/accept`, {});
  assert.equal(repeat.status, 409);
  assert.equal(repeat.payload.error, "这一项已经留下。");

  const acceptedParties = await postJson(
    `${base}/api/threads/${threadId}/proposals/${parties.id}/accept`,
    {},
  );
  assert.equal(acceptedParties.status, 200);

  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.facts, "");
  assert.equal(matter.matter.cause, "房屋租赁合同纠纷");
  const clients = matter.matter.parties.filter((party) => party.role === "client");
  assert.equal(clients.length, 1);
  assert.equal(clients[0].name, clientName);
  const company = matter.matter.parties.find((party) => party.name === "甲公司");
  assert.equal(company.role, "opposing");
  assert.equal(company.position, "原告");
  assert.equal(
    matter.matter.parties.filter((party) => party.name === clientName).length,
    1,
  );

  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(proposal(detail, "案由").acceptedAt == null, false);
  assert.equal(proposal(detail, "当事人").acceptedAt == null, false);
  assert.equal(proposal(detail, "基本事实").acceptedAt, null);
} finally {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  if (threadId) {
    const row = db.prepare("SELECT matter_id FROM threads WHERE id = ?").get(threadId);
    matterId = matterId || row?.matter_id || "";
    db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
    db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  }
  if (matterId) {
    db.prepare("DELETE FROM parties WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM matters WHERE id = ?").run(matterId);
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
assert.equal(after.matter.cause, before.matter.cause);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
const afterList = await fetch(`${base}/api/matters`).then((response) => response.json());
assert.equal(afterList.matters.length, beforeList.matters.length);
const afterThreads = await fetch(`${base}/api/threads`).then((response) => response.json());
assert.equal(afterThreads.threads.length, beforeThreads.threads.length);
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step6 api ok");
