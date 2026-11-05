import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "壬公司";
const facts = "事实暗号-14。";
const mandate = "委托暗号-14。";
const nextMandate = "改后委托-14";
const partyName = "对方-14";
const keptTask = "留下的待办-14";
const addedTask = "待办-14";
const usableLine = "可用暗号-14。租金已经付清。";
const hiddenLine = "待核对暗号-14。租金未付。";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, payload: await response.json() };
}

async function upload(matterId, filename, text) {
  const form = new FormData();
  form.set("file", new File([text], filename, { type: "text/plain" }));
  const response = await fetch(`${base}/api/matters/${matterId}/materials`, { method: "POST", body: form });
  return { status: response.status, payload: await response.json() };
}

function proposals(detail, kind) {
  return detail.thread.messages.filter((message) => message.proposalKind === kind);
}

function answerText(detail) {
  const answers = detail.thread.messages.filter((message) => message.role === "model" && !message.proposalKind);
  return answers.at(-1)?.body ?? "";
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
const beforeDrafts = await fetch(`${base}/api/matters/${li}/drafts`).then((response) => response.json());
const beforeClosing = await fetch(`${base}/api/matters/${li}/closing`).then((response) => response.json());

let matterId = "";
let threadId = "";

try {
  const created = await postJson(`${base}/api/matters`, {
    clientName,
    name: "",
    cause: "",
    facts,
    mandate,
    people: [],
    organs: [],
  });
  assert.equal(created.status, 201);
  matterId = created.payload.id;
  const fee = await postJson(`${base}/api/matters/${matterId}/fee`, { amount: "12.50" });
  assert.equal(fee.status, 200);
  const usable = await upload(matterId, "可用-14.txt", usableLine);
  assert.equal(usable.status, 201);
  const hidden = await upload(matterId, "待核对-14.txt", hiddenLine);
  assert.equal(hidden.status, 201);
  const confirmed = await postJson(`${base}/api/matters/${matterId}/materials/${usable.payload.id}/confirm`, {
    text: usableLine,
  });
  assert.equal(confirmed.status, 200);
  const kept = await postJson(`${base}/api/matters/${matterId}/tasks`, { name: keptTask, dueOn: "2026-11-20" });
  assert.equal(kept.status, 201);
  const keptConfirmed = await postJson(`${base}/api/matters/${matterId}/tasks/${kept.payload.id}/confirm`);
  assert.equal(keptConfirmed.status, 200);

  const looked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "查一下这件案子。委托事项和客户名称用资料里的原句回答。",
  });
  assert.equal(looked.status, 201);
  threadId = looked.payload.id;
  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const lookedAnswer = answerText(detail);
  assert.equal(lookedAnswer.includes(mandate), true, lookedAnswer);
  assert.equal(lookedAnswer.includes(clientName), true, lookedAnswer);
  assert.equal(lookedAnswer.includes(hiddenLine), false, lookedAnswer);
  assert.equal(detail.thread.messages.some((message) => message.proposalKind), false);
  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.mandate, mandate);
  assert.equal(matter.matter.facts, facts);
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.feeReceived, "12.50");

  const edited = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `把委托事项改成：${nextMandate}。`,
  });
  assert.equal(edited.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.mandate, mandate);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const mandateProposal = proposals(detail, "委托事项").find((item) => !item.acceptedAt);
  assert.equal(mandateProposal.body, nextMandate);

  const added = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `增加当事人：${partyName}，诉讼地位 证人`,
  });
  assert.equal(added.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.parties.some((party) => party.name === partyName), false);
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const partyProposal = proposals(detail, "当事人").find((item) => !item.acceptedAt && item.body.includes(partyName));
  assert.ok(partyProposal);

  const keptMandate = await postJson(`${base}/api/threads/${threadId}/proposals/${mandateProposal.id}/accept`);
  assert.equal(keptMandate.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.mandate, nextMandate);
  assert.equal(matter.matter.facts, facts);
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.feeReceived, "12.50");
  assert.equal(matter.matter.parties.some((party) => party.name === partyName), false);
  let materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  const usableRow = materials.materials.find((item) => item.filename === "可用-14.txt");
  assert.equal(usableRow.textStatus, "可用文字");
  assert.equal(usableRow.usableText, usableLine);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(proposals(detail, "当事人").find((item) => item.id === partyProposal.id).acceptedAt, null);

  const keptParty = await postJson(`${base}/api/threads/${threadId}/proposals/${partyProposal.id}/accept`);
  assert.equal(keptParty.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.parties.find((party) => party.name === partyName).role, "opposing");
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);
  assert.equal(matter.matter.status, "草稿");

  const removing = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `删除当事人：${partyName}`,
  });
  assert.equal(removing.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.parties.some((party) => party.name === partyName), true);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const deleteParty = proposals(detail, "当事人").find((item) => !item.acceptedAt && item.body === `删除：${partyName}`);
  assert.ok(deleteParty);
  const removedParty = await postJson(`${base}/api/threads/${threadId}/proposals/${deleteParty.id}/accept`);
  assert.equal(removedParty.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.parties.some((party) => party.name === partyName), false);
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);

  const removeClient = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `删除当事人：${clientName}`,
  });
  assert.equal(removeClient.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const clientProposal = proposals(detail, "当事人").find((item) => !item.acceptedAt && item.body === `删除：${clientName}`);
  const refusedClient = await postJson(`${base}/api/threads/${threadId}/proposals/${clientProposal.id}/accept`);
  assert.equal(refusedClient.status, 400);
  assert.equal(refusedClient.payload.error, "这一项不能改客户。");
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);

  const taskAsk = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `请提出一条待办。\n待办：${addedTask}，到期日 2026-12-15。`,
  });
  assert.equal(taskAsk.status, 200);
  let tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.some((task) => task.name === addedTask), false);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const taskProposal = proposals(detail, "待办").find((item) => !item.acceptedAt && item.body.includes(addedTask));
  const keptAdded = await postJson(`${base}/api/threads/${threadId}/proposals/${taskProposal.id}/accept`);
  assert.equal(keptAdded.status, 200);
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  const addedRow = tasks.tasks.find((task) => task.name === addedTask);
  assert.equal(addedRow.confirmedAt, null);
  assert.equal(tasks.tasks.find((task) => task.name === keptTask).confirmedAt == null, false);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.feeReceived, "12.50");
  materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  assert.equal(materials.materials.find((item) => item.filename === "可用-14.txt").usableText, usableLine);
  assert.equal(materials.materials.find((item) => item.filename === "待核对-14.txt").textStatus, "待核对");

  const dropTask = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `删除待办：${addedTask}`,
  });
  assert.equal(dropTask.status, 200);
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.some((task) => task.name === addedTask), true);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const deleteTask = proposals(detail, "待办").find((item) => !item.acceptedAt && item.body === `删除：${addedTask}`);
  const removedTask = await postJson(`${base}/api/threads/${threadId}/proposals/${deleteTask.id}/accept`);
  assert.equal(removedTask.status, 200);
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.some((task) => task.name === addedTask), false);
  assert.equal(tasks.tasks.some((task) => task.name === keptTask), true);

  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const beforeCount = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?").get(threadId).n;
  db.prepare("UPDATE matters SET status = '已归档' WHERE id = ?").run(matterId);
  db.close();
  const blocked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "把委托事项改成：不该写上。",
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.payload.error, "归档后只供查阅。");
  const dbAfter = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const afterCount = dbAfter.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?").get(threadId).n;
  dbAfter.prepare("UPDATE matters SET status = '草稿' WHERE id = ?").run(matterId);
  dbAfter.close();
  assert.equal(afterCount, beforeCount);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.mandate, nextMandate);
  assert.equal(matter.matter.status, "草稿");
} finally {
  if (matterId) {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
    db.exec("PRAGMA foreign_keys = ON");
    const rows = db.prepare("SELECT id FROM threads WHERE matter_id = ?").all(matterId);
    for (const row of rows) {
      db.prepare("DELETE FROM messages WHERE thread_id = ?").run(row.id);
      db.prepare("DELETE FROM threads WHERE id = ?").run(row.id);
    }
    const taskIds = db.prepare("SELECT id FROM tasks WHERE matter_id = ?").all(matterId);
    for (const row of taskIds) db.prepare("DELETE FROM task_resolutions WHERE task_id = ?").run(row.id);
    db.prepare("DELETE FROM tasks WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM notes WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM materials WHERE matter_id = ?").run(matterId);
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

const after = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
assert.equal(after.matter.status, before.matter.status);
assert.equal(after.matter.facts, before.matter.facts);
assert.equal(after.matter.mandate, before.matter.mandate);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
const afterTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
assert.equal(JSON.stringify(afterTasks.tasks), JSON.stringify(beforeTasks.tasks));
const afterDrafts = await fetch(`${base}/api/matters/${li}/drafts`).then((response) => response.json());
assert.equal(afterDrafts.drafts.length, beforeDrafts.drafts.length);
const afterClosing = await fetch(`${base}/api/matters/${li}/closing`).then((response) => response.json());
assert.equal(afterClosing.status, beforeClosing.status);
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step14 api ok");
