import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "戊公司";
const usableLine = "承租人称租金已经付清。";
const hiddenLine = "秘密未核对句：对方承认欠租五万元。";
const taskName = "核对付款凭证";
const dueOn = "2026-12-15";
const facts = "承租人称租金已经付清。";
const mandate = "先核对付款凭证。";
const proves = "证明租金已经付清。";

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

function proposal(detail, kind) {
  return detail.thread.messages.find((message) => message.proposalKind === kind);
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeMaterials = await fetch(`${base}/api/matters/${li}/materials`).then((response) => response.json());
const beforeTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
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

  const usable = await upload(matterId, "已核对.txt", usableLine);
  assert.equal(usable.status, 201);
  const hidden = await upload(matterId, "未核对.txt", hiddenLine);
  assert.equal(hidden.status, 201);
  const confirmed = await postJson(`${base}/api/matters/${matterId}/materials/${usable.payload.id}/confirm`, {
    text: usableLine,
  });
  assert.equal(confirmed.status, 200);

  const drafted = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "分析成文", text: "写成底稿" });
  assert.equal(drafted.status, 400);
  assert.equal(drafted.payload.error, "请先勾选出处。");
  const dbGate = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const noThread = dbGate.prepare("SELECT id FROM threads WHERE matter_id = ?").get(matterId);
  dbGate.close();
  assert.equal(noThread, undefined);

  const asked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: [
      "请提出一条待办，并改基本事实、委托事项、证明对象。",
      `待办：${taskName}，到期日 ${dueOn}。`,
      `基本事实：${facts}`,
      `委托事项：${mandate}`,
      `证明对象：已核对.txt：${proves}`,
    ].join("\n"),
  });
  assert.equal(asked.status, 201);
  threadId = asked.payload.id;

  let tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 0);
  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.facts, "");
  assert.equal(matter.matter.mandate, "");
  assert.equal(matter.matter.status, "草稿");
  let materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  assert.equal(materials.materials.find((item) => item.filename === "已核对.txt").proves, "");

  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const task = proposal(detail, "待办");
  const fact = proposal(detail, "基本事实");
  const duty = proposal(detail, "委托事项");
  const proof = proposal(detail, "证明对象");
  assert.equal(Boolean(task && fact && duty && proof), true);
  assert.equal(task.acceptedAt, null);
  assert.equal(fact.acceptedAt, null);
  assert.equal(duty.acceptedAt, null);
  assert.equal(proof.acceptedAt, null);
  assert.equal(task.body, `${taskName}\n${dueOn}`);
  assert.equal(fact.body, facts);
  assert.equal(duty.body, mandate);
  assert.equal(proof.body, `已核对.txt\n${proves}`);

  const keptTask = await postJson(`${base}/api/threads/${threadId}/proposals/${task.id}/accept`, {});
  assert.equal(keptTask.status, 200);
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 1);
  assert.equal(tasks.tasks[0].name, taskName);
  assert.equal(tasks.tasks[0].dueOn, dueOn);
  assert.equal(tasks.tasks[0].confirmedAt, null);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.facts, "");
  assert.equal(matter.matter.mandate, "");
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);
  materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  const usableRow = materials.materials.find((item) => item.filename === "已核对.txt");
  assert.equal(usableRow.proves, "");
  assert.equal(usableRow.textStatus, "可用文字");
  assert.equal(usableRow.usableText, usableLine);
  const desk = await fetch(`${base}/api/workbench`).then((response) => response.json());
  assert.equal(desk.due.some((item) => item.name === taskName), false);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(proposal(detail, "基本事实").acceptedAt, null);
  assert.equal(proposal(detail, "委托事项").acceptedAt, null);
  assert.equal(proposal(detail, "证明对象").acceptedAt, null);

  const keptFacts = await postJson(`${base}/api/threads/${threadId}/proposals/${fact.id}/accept`, {});
  assert.equal(keptFacts.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.facts, facts);
  assert.equal(matter.matter.mandate, "");
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 1);

  const keptDuty = await postJson(`${base}/api/threads/${threadId}/proposals/${duty.id}/accept`, {});
  assert.equal(keptDuty.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.mandate, mandate);
  assert.equal(matter.matter.facts, facts);
  materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  assert.equal(materials.materials.find((item) => item.filename === "已核对.txt").proves, "");

  const keptProof = await postJson(`${base}/api/threads/${threadId}/proposals/${proof.id}/accept`, {});
  assert.equal(keptProof.status, 200);
  materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  const proved = materials.materials.find((item) => item.filename === "已核对.txt");
  assert.equal(proved.proves, proves);
  assert.equal(proved.textStatus, "可用文字");
  assert.equal(proved.usableText, usableLine);
  const unread = materials.materials.find((item) => item.filename === "未核对.txt");
  assert.equal(unread.proves, "");
  assert.equal(unread.textStatus, "待核对");
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);

  const repeat = await postJson(`${base}/api/threads/${threadId}/proposals/${task.id}/accept`, {});
  assert.equal(repeat.status, 409);
  assert.equal(repeat.payload.error, "这一项已经留下。");

  const badDate = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "请再提出一条待办。\n待办：补一份材料，到期日 2026-02-31。",
  });
  assert.equal(badDate.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const invalid = detail.thread.messages.filter((message) => message.proposalKind === "待办" && !message.acceptedAt);
  assert.equal(invalid.length, 1);
  const deniedDate = await postJson(`${base}/api/threads/${threadId}/proposals/${invalid[0].id}/accept`, {});
  assert.equal(deniedDate.status, 400);
  assert.equal(deniedDate.payload.error, "请写下到期日。");
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 1);

  const tainted = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `请再改基本事实。\n基本事实：${hiddenLine}`,
  });
  assert.equal(tainted.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const blocked = detail.thread.messages.filter(
    (message) => message.proposalKind === "基本事实" && !message.acceptedAt,
  );
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].body.includes("待核实"), true);
  const denied = await postJson(`${base}/api/threads/${threadId}/proposals/${blocked[0].id}/accept`, {});
  assert.equal(denied.status, 400);
  assert.equal(denied.payload.error, "待核实的不能留下。");
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.facts, facts);
  assert.equal(matter.matter.facts.includes("五万元"), false);
} finally {
  if (matterId || threadId) {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
    db.exec("PRAGMA foreign_keys = ON");
    if (matterId) {
      const rows = db.prepare("SELECT id FROM threads WHERE matter_id = ?").all(matterId);
      for (const row of rows) {
        db.prepare("DELETE FROM messages WHERE thread_id = ?").run(row.id);
        db.prepare("DELETE FROM threads WHERE id = ?").run(row.id);
      }
      db.prepare("DELETE FROM tasks WHERE matter_id = ?").run(matterId);
      db.prepare("DELETE FROM notes WHERE matter_id = ?").run(matterId);
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
assert.equal(after.matter.mandate, before.matter.mandate);
assert.equal(after.matter.cause, before.matter.cause);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
const afterMaterials = await fetch(`${base}/api/matters/${li}/materials`).then((response) => response.json());
assert.equal(
  afterMaterials.materials.map((item) => `${item.filename}|${item.proves}|${item.textStatus}|${item.usableText}`).join("\n"),
  beforeMaterials.materials.map((item) => `${item.filename}|${item.proves}|${item.textStatus}|${item.usableText}`).join("\n"),
);
const afterTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
assert.equal(afterTasks.tasks.length, beforeTasks.tasks.length);
const afterList = await fetch(`${base}/api/matters`).then((response) => response.json());
assert.equal(afterList.matters.length, beforeList.matters.length);
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step9 api ok");
