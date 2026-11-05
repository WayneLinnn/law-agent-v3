import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeMaterials = await fetch(`${base}/api/matters/${li}/materials`).then((response) =>
  response.json(),
);
const beforeTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
const beforeThreads = await fetch(`${base}/api/threads`).then((response) => response.json());

const empty = await postJson(`${base}/api/threads`, { mode: "问答", text: "  " });
assert.equal(empty.status, 400);
assert.equal(empty.payload.error, "请写下要问的话。");

const drafted = await postJson(`${base}/api/threads`, { mode: "分析成文", text: "写成底稿" });
assert.equal(drafted.status, 400);
assert.equal(drafted.payload.error, "先建成案子。");

let threadId = "";
try {
  const opened = await postJson(`${base}/api/threads`, { mode: "问答", text: "只回答两个字：收到" });
  threadId = opened.payload.id ?? "";
  assert.equal(opened.status, 201);
  assert.equal(opened.payload.prompted, false);
  threadId = opened.payload.id;

  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.matterId, null);
  assert.equal(detail.thread.messages.length, 2);
  assert.equal(detail.thread.messages[0].role, "lawyer");
  assert.equal(detail.thread.messages[0].mode, "问答");
  assert.equal(detail.thread.messages[1].role, "model");
  assert.equal(detail.thread.prompted, false);

  const follow = await postJson(`${base}/api/threads/${threadId}/messages`, {
    mode: "问答",
    text: "只回答两个字：还在",
  });
  assert.equal(follow.status, 200);
  assert.equal(follow.payload.prompted, false);

  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.messages.length, 4);
  assert.equal(detail.thread.matterId, null);

  const statute = await postJson(`${base}/api/threads/${threadId}/messages`, {
    mode: "问答",
    text: "《民法典》第五百七十七条怎么规定？有没有相近案例？",
  });
  assert.equal(statute.status, 200);
  assert.equal(statute.payload.prompted, true);

  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.prompted, true);
  assert.equal(detail.thread.messages.at(-1).role, "lawyer");
  assert.equal(
    detail.thread.messages.filter((message) => message.role === "model").length,
    2,
  );

  const insisted = await postJson(`${base}/api/threads/${threadId}/messages`, {
    mode: "问答",
    insist: true,
  });
  assert.equal(insisted.status, 200);
  assert.equal(insisted.payload.prompted, false);

  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const answer = detail.thread.messages.at(-1);
  assert.equal(answer.role, "model");
  assert.equal(answer.mode, "问答");
  assert.equal(answer.body.includes("未经核对"), true);
  assert.equal(detail.thread.matterId, null);

  const listed = await fetch(`${base}/api/threads`).then((response) => response.json());
  assert.equal(
    listed.threads.some((thread) => thread.id === threadId),
    true,
  );
} finally {
  if (threadId) {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
    db.exec("PRAGMA foreign_keys = ON");
    const row = db.prepare("SELECT matter_id FROM threads WHERE id = ?").get(threadId);
    assert.equal(row.matter_id, null);
    db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
    db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
    db.close();
  }
}

const after = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
assert.equal(after.matter.status, before.matter.status);
assert.equal(after.matter.facts, before.matter.facts);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
const afterMaterials = await fetch(`${base}/api/matters/${li}/materials`).then((response) =>
  response.json(),
);
assert.equal(afterMaterials.materials.length, beforeMaterials.materials.length);
assert.equal(afterMaterials.materials[0].textStatus, "可用文字");
const afterTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
assert.equal(afterTasks.tasks.length, beforeTasks.tasks.length);
assert.equal(afterTasks.tasks[0].name, "提交证据");
const afterThreads = await fetch(`${base}/api/threads`).then((response) => response.json());
assert.equal(afterThreads.threads.length, beforeThreads.threads.length);
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step5 api ok");
