import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const clientName = `工具客户${Date.now()}`;
const usableName = "可用-工具.txt";
const hiddenName = "待核对-工具.txt";
const usableLine = "可用暗号-工具。租金已经付清。";
const hiddenLine = "待核对暗号-工具。租金未付。";
const dueOn = "2026-12-01";

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
  return detail.thread.messages.filter((message) => message.proposalKind === kind && !message.acceptedAt);
}

function answerText(detail) {
  const answers = detail.thread.messages.filter((message) => message.role === "model" && !message.proposalKind);
  return answers.at(-1)?.body ?? "";
}

function dueSlice(html) {
  const start = html.indexOf('aria-label="待办"');
  const end = html.indexOf(">待确认<");
  return html.slice(start, end < 0 ? html.length : end);
}

let matterId = "";

try {
  const created = await postJson(`${base}/api/matters`, {
    clientName,
    name: "",
    cause: "",
    facts: "原事实。",
    mandate: "原委托。",
    people: [],
    organs: [],
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  matterId = created.payload.id;
  const usable = await upload(matterId, usableName, usableLine);
  assert.equal(usable.status, 201);
  const hidden = await upload(matterId, hiddenName, hiddenLine);
  assert.equal(hidden.status, 201);
  const contractName = "建设工程施工合同.txt";
  const contractLine = "合同价款人民币1200万元。";
  const contract = await upload(matterId, contractName, contractLine);
  assert.equal(contract.status, 201);
  const confirmed = await postJson(`${base}/api/matters/${matterId}/materials/${usable.payload.id}/confirm`, {
    text: usableLine,
  });
  assert.equal(confirmed.status, 200);

  const added = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `帮我加一条开庭，到期日 ${dueOn}。`,
  });
  assert.equal(added.status, 201, JSON.stringify(added.payload));
  const threadId = added.payload.id;
  let tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.length, 0);
  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const pending = proposals(detail, "待办")[0];
  assert.ok(pending, answerText(detail));
  assert.equal(pending.body.includes("开庭"), true, pending.body);
  assert.equal(pending.body.includes(dueOn), true, pending.body);
  const parsed = JSON.parse(pending.proposalBody);
  assert.equal(parsed.dueOn, dueOn);
  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.facts, "原事实。");
  assert.equal(matter.matter.status, "草稿");

  const listed = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "列出这件案子的材料。",
  });
  assert.equal(listed.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const materialsAnswer = answerText(detail);
  assert.equal(materialsAnswer.includes(usableName), true, materialsAnswer);
  assert.equal(materialsAnswer.includes(hiddenName), true, materialsAnswer);
  assert.equal(materialsAnswer.includes("待核对"), true, materialsAnswer);
  assert.equal(materialsAnswer.includes(hiddenLine), false, materialsAnswer);

  const readUsable = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `读一下${usableName}。`,
  });
  assert.equal(readUsable.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const usableAnswer = answerText(detail);
  assert.equal(usableAnswer.includes(usableLine), true, usableAnswer);
  assert.equal(usableAnswer.includes(hiddenLine), false, usableAnswer);

  const readHidden = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `读一下${hiddenName}。`,
  });
  assert.equal(readHidden.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const hiddenAnswer = answerText(detail);
  assert.equal(hiddenAnswer.includes(hiddenLine), true, hiddenAnswer);
  assert.equal(hiddenAnswer.includes("还没核对"), true, hiddenAnswer);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.facts, "原事实。");

  const kept = await postJson(`${base}/api/threads/${threadId}/proposals/${pending.id}/accept`);
  assert.equal(kept.status, 200, JSON.stringify(kept.payload));
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  const task = tasks.tasks.find((item) => item.dueOn === dueOn);
  assert.ok(task);
  assert.equal(task.confirmedAt, null);
  let page = await fetch(`${base}/matters/${matterId}`).then((response) => response.text());
  let due = dueSlice(page);
  assert.equal(due.includes(task.name), true, due);
  assert.equal(due.includes("未确认"), true, due);
  assert.equal(due.includes(">确认<"), true, due);

  const looked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "列出待办。",
  });
  assert.equal(looked.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const taskAnswer = answerText(detail);
  assert.equal(taskAnswer.includes(task.name), true, taskAnswer);
  assert.equal(taskAnswer.includes(dueOn), true, taskAnswer);
  assert.equal(taskAnswer.includes("未确认"), true, taskAnswer);

  const confirmedTask = await postJson(`${base}/api/matters/${matterId}/tasks/${task.id}/confirm`);
  assert.equal(confirmedTask.status, 200, JSON.stringify(confirmedTask.payload));
  page = await fetch(`${base}/matters/${matterId}`).then((response) => response.text());
  due = dueSlice(page);
  assert.equal(due.includes("已确认"), true, due);
  assert.equal(due.includes("未确认"), false, due);
  assert.equal(due.includes(">确认<"), false, due);

  const lookedAgain = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "再列出待办。",
  });
  assert.equal(lookedAgain.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const confirmedAnswer = answerText(detail);
  assert.equal(confirmedAnswer.includes("已确认"), true, confirmedAnswer);
  assert.equal(confirmedAnswer.includes(task.name), true, confirmedAnswer);

  const removed = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `请删掉${task.name}。`,
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.payload));
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.some((item) => item.id === task.id), true);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const deletion = proposals(detail, "待办").find((item) => item.body.includes(task.name) && item.body.includes("删除"));
  assert.ok(deletion, answerText(detail));
  const dropped = await postJson(`${base}/api/threads/${threadId}/proposals/${deletion.id}/accept`);
  assert.equal(dropped.status, 200, JSON.stringify(dropped.payload));
  tasks = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
  assert.equal(tasks.tasks.some((item) => item.id === task.id), false);

  const summarized = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "读一下建设施工合同的内容，然后总结告诉我。",
  });
  assert.equal(summarized.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const summary = answerText(detail);
  assert.equal(summary.includes("1200"), true, summary);
  assert.equal(summary.includes("还没核对"), true, summary);

  const found = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "找到施工的证据材料。",
  });
  assert.equal(found.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const foundAnswer = answerText(detail);
  assert.equal(foundAnswer.includes("施工合同") || foundAnswer.includes(contractName), true, foundAnswer);

  const factsText = "工具事实已经写好";
  const factsAsk = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `请把案件经过改成${factsText}`,
  });
  assert.equal(factsAsk.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.facts, "原事实。");
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const factsProposal = proposals(detail, "基本事实").find((item) => item.body.includes(factsText));
  assert.ok(factsProposal, answerText(detail));
  const factsKept = await postJson(`${base}/api/threads/${threadId}/proposals/${factsProposal.id}/accept`);
  assert.equal(factsKept.status, 200, JSON.stringify(factsKept.payload));
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.facts.includes(factsText), true, matter.matter.facts);

  const mandateText = "新的委托一句";
  const mandateAsk = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `请把要办的事改成${mandateText}`,
  });
  assert.equal(mandateAsk.status, 200);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.mandate, "原委托。");
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const mandateProposal = proposals(detail, "委托事项").find((item) => item.body.includes(mandateText));
  assert.ok(mandateProposal, answerText(detail));
  const mandateKept = await postJson(`${base}/api/threads/${threadId}/proposals/${mandateProposal.id}/accept`);
  assert.equal(mandateKept.status, 200, JSON.stringify(mandateKept.payload));

  const provesText = "租金已付";
  const provesAsk = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `给${usableName}写上证明对象为${provesText}。`,
  });
  assert.equal(provesAsk.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const provesProposal = proposals(detail, "证明对象").find((item) => item.body.includes(provesText));
  assert.ok(provesProposal, answerText(detail));
  const provesKept = await postJson(`${base}/api/threads/${threadId}/proposals/${provesProposal.id}/accept`);
  assert.equal(provesKept.status, 200, JSON.stringify(provesKept.payload));
  const materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  assert.equal(materials.materials.find((item) => item.filename === usableName).proves.includes(provesText), true);

  const partyName = "对方工具人";
  const party = await postJson(`${base}/api/matters/${matterId}/parties`, {
    role: "opposing",
    name: partyName,
    position: "证人",
  });
  assert.equal(party.status, 201, JSON.stringify(party.payload));
  const listedParties = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "列出当事人。",
  });
  assert.equal(listedParties.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const partiesAnswer = answerText(detail);
  assert.equal(partiesAnswer.includes(clientName), true, partiesAnswer);
  assert.equal(partiesAnswer.includes(partyName), true, partiesAnswer);

  const deleteParty = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `请删掉${partyName}。`,
  });
  assert.equal(deleteParty.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const partyProposal = proposals(detail, "当事人").find(
    (item) => item.body.includes("删除") && item.body.includes(partyName),
  );
  assert.ok(partyProposal, answerText(detail));
  const partyDropped = await postJson(`${base}/api/threads/${threadId}/proposals/${partyProposal.id}/accept`);
  assert.equal(partyDropped.status, 200, JSON.stringify(partyDropped.payload));
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.parties.some((item) => item.name === partyName), false);
  assert.equal(matter.matter.parties.some((item) => item.name === clientName && item.role === "client"), true);

  const refuseClient = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `请删掉${clientName}。`,
  });
  assert.equal(refuseClient.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(answerText(detail).includes("不能改客户"), true, answerText(detail));
  assert.equal(
    proposals(detail, "当事人").some((item) => item.body.includes(clientName)),
    false,
  );

  const noted = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "记下时间线：开工已经记上一笔。",
  });
  assert.equal(noted.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const noteProposal = proposals(detail, "时间线").find((item) => item.body.includes("开工已经记上一笔"));
  assert.ok(noteProposal, answerText(detail));
  const noteKept = await postJson(`${base}/api/threads/${threadId}/proposals/${noteProposal.id}/accept`);
  assert.equal(noteKept.status, 200, JSON.stringify(noteKept.payload));
  const listedNotes = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: "列出已记下。",
  });
  assert.equal(listedNotes.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(answerText(detail).includes("开工已经记上一笔"), true, answerText(detail));

  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.mandate.includes(mandateText), true, matter.matter.mandate);
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

console.log("tools ok");
