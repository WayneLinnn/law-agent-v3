import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "子公司";
const near = { name: "近到期-15", dueOn: "2026-11-20" };
const far = { name: "远到期-15", dueOn: "2027-08-01" };
const open = { name: "未确认-15", dueOn: "2026-12-01" };
const late = { name: "过期-15", dueOn: "2026-01-01" };

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

function reminderSlice(html) {
  const dueAt = html.indexOf('aria-label="待办"');
  const pendingAt = html.indexOf(">待确认<");
  assert.ok(dueAt >= 0 && pendingAt > dueAt);
  return html.slice(dueAt, pendingAt);
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
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

  const asked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `记一条待办：${near.name}，到期日 ${near.dueOn}。`,
  });
  assert.equal(asked.status, 201);
  threadId = asked.payload.id;
  let tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 0);
  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const pending = proposals(detail, "待办").find((item) => item.body.includes(near.name));
  assert.equal(pending.body, `${near.name}\n${near.dueOn}`);
  let page = await fetch(`${base}/matters/${matterId}`).then((response) => response.text());
  assert.equal(reminderSlice(page).includes(near.name), false);

  const kept = await postJson(`${base}/api/threads/${threadId}/proposals/${pending.id}/accept`);
  assert.equal(kept.status, 200);
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  const nearRow = tasks.tasks.find((task) => task.name === near.name);
  assert.equal(nearRow.dueOn, near.dueOn);
  assert.equal(nearRow.confirmedAt, null);
  assert.equal(Object.hasOwn(nearRow, "note"), false);
  page = await fetch(`${base}/matters/${matterId}`).then((response) => response.text());
  assert.equal(reminderSlice(page).includes(near.name), true);
  assert.equal(reminderSlice(page).includes("未确认"), true);

  const confirmed = await postJson(`${base}/api/matters/${matterId}/tasks/${nearRow.id}/confirm`);
  assert.equal(confirmed.status, 200);
  page = await fetch(`${base}/matters/${matterId}`).then((response) => response.text());
  const shown = reminderSlice(page);
  assert.equal(shown.includes(near.name), true);
  assert.equal(shown.includes(near.dueOn), true);

  async function record(item) {
    const response = await postJson(`${base}/api/matters/${matterId}/ask`, {
      mode: "问答",
      text: `记一条待办：${item.name}，到期日 ${item.dueOn}。`,
    });
    assert.equal(response.status, 200);
    const view = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
    const proposal = proposals(view, "待办").find((entry) => entry.body.includes(item.name));
    const saved = await postJson(`${base}/api/threads/${threadId}/proposals/${proposal.id}/accept`);
    assert.equal(saved.status, 200);
    const listed = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
    return listed.tasks.find((task) => task.name === item.name);
  }

  const farRow = await record(far);
  const openRow = await record(open);
  const lateRow = await record(late);
  assert.equal(farRow.confirmedAt, null);
  assert.equal(openRow.confirmedAt, null);
  assert.equal(lateRow.confirmedAt, null);
  await postJson(`${base}/api/matters/${matterId}/tasks/${farRow.id}/confirm`);
  await postJson(`${base}/api/matters/${matterId}/tasks/${lateRow.id}/confirm`);

  const looked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "看一下已有待办的到期。",
  });
  assert.equal(looked.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const lookedAnswer = answerText(detail);
  for (const item of [near, far, open, late]) {
    assert.equal(lookedAnswer.includes(item.name), true, lookedAnswer);
    assert.equal(lookedAnswer.includes(item.dueOn), true, lookedAnswer);
  }
  assert.equal(lookedAnswer.includes("已过期"), true);
  assert.equal(lookedAnswer.includes(`${far.name} ${far.dueOn}`), true);
  const reminderLine = lookedAnswer.split("\n").find((line) => line.startsWith("右栏提醒："));
  assert.equal(reminderLine.includes(near.name), true, lookedAnswer);
  assert.equal(reminderLine.includes(late.name), true, lookedAnswer);
  assert.equal(reminderLine.includes(far.name), false, lookedAnswer);
  assert.equal(reminderLine.includes(open.name), false, lookedAnswer);
  assert.equal(proposals(detail, "待办").some((item) => item.body.includes("看一下")), false);

  page = await fetch(`${base}/matters/${matterId}`).then((response) => response.text());
  const reminder = reminderSlice(page);
  assert.equal(reminder.includes(near.name), true);
  assert.equal(reminder.includes(late.name), true);
  assert.equal(reminder.includes("已过期"), true);
  assert.equal(reminder.includes(far.name), true);
  assert.equal(reminder.includes(open.name), true);
  assert.equal(reminder.includes("未确认"), true);

  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const notes = db.prepare("SELECT name, due_on, note FROM tasks WHERE matter_id = ?").all(matterId);
  db.close();
  assert.equal(notes.length, 4);
  for (const row of notes) assert.equal(row.note, "");

  const matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.feeReceived, null);
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);

  const home = await fetch(base).then((response) => response.text());
  const promptAt = home.indexOf(">提示<");
  const dueAt = home.indexOf(">到期<");
  const feeAt = home.indexOf(">实收<");
  const prompts = home.slice(promptAt, dueAt);
  const dues = home.slice(dueAt, feeAt);
  assert.equal(prompts.includes(near.name), true);
  assert.equal(prompts.includes(late.name), true);
  assert.equal(prompts.includes(far.name), false);
  assert.equal(prompts.includes(open.name), false);
  assert.equal(dues.includes(far.name), true);
  assert.equal(dues.includes(near.name), true);
  assert.equal(dues.includes(open.name), false);
  assert.equal(prompts.includes("提交证据"), true);
  assert.equal(dues.includes("提交证据"), true);
} finally {
  if (matterId) {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
    db.exec("PRAGMA foreign_keys = ON");
    const rows = db.prepare("SELECT id FROM threads WHERE matter_id = ?").all(matterId);
    for (const row of rows) {
      db.prepare("DELETE FROM messages WHERE thread_id = ?").run(row.id);
      db.prepare("DELETE FROM threads WHERE id = ?").run(row.id);
    }
    db.prepare("DELETE FROM tasks WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM parties WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM matters WHERE id = ?").run(matterId);
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
assert.equal(after.matter.mandate, before.matter.mandate);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
const afterTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
assert.equal(JSON.stringify(afterTasks.tasks), JSON.stringify(beforeTasks.tasks));
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step15 api ok");
