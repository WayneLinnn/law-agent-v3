import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "丁公司";
const usableLine = "2024-03-01 签订租赁合同。租金已经付清。";
const hiddenLine = "秘密未核对句：对方承认欠租五万元。";

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

  const asked = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: [
      "请提出时间线、待核清单和路径。",
      "时间线：2024-03-01 签订租赁合同。",
      "待核清单：付款凭证还没核对。",
      "路径：民事：先核已经确认的合同。刑事：给不出。行政：给不出。",
    ].join("\n"),
  });
  assert.equal(asked.status, 201);
  threadId = asked.payload.id;

  let notes = await fetch(`${base}/api/matters/${matterId}/notes`).then((response) => response.json());
  assert.equal(notes.notes.length, 0);

  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const timeline = proposal(detail, "时间线");
  const checklist = proposal(detail, "待核清单");
  const route = proposal(detail, "路径");
  assert.equal(Boolean(timeline && checklist && route), true);
  assert.equal(timeline.acceptedAt, null);
  assert.equal(checklist.acceptedAt, null);
  assert.equal(route.acceptedAt, null);
  assert.equal(timeline.body, "2024-03-01 签订租赁合同。");
  assert.equal(checklist.body, "付款凭证还没核对。");
  assert.equal(route.body.includes("民事"), true);
  assert.equal(route.body.includes("刑事"), true);
  assert.equal(route.body.includes("行政"), true);
  assert.equal(route.body.includes("待核验"), true);
  assert.equal(route.body.includes("待核实"), false);
  assert.equal(route.body.includes(hiddenLine), false);

  const keptTimeline = await postJson(`${base}/api/threads/${threadId}/proposals/${timeline.id}/accept`, {});
  assert.equal(keptTimeline.status, 200);
  notes = await fetch(`${base}/api/matters/${matterId}/notes`).then((response) => response.json());
  assert.equal(notes.notes.length, 1);
  assert.equal(notes.notes[0].kind, "时间线");
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(proposal(detail, "待核清单").acceptedAt, null);
  assert.equal(proposal(detail, "路径").acceptedAt, null);

  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.facts, "");

  const keptChecklist = await postJson(`${base}/api/threads/${threadId}/proposals/${checklist.id}/accept`, {});
  assert.equal(keptChecklist.status, 200);
  const keptRoute = await postJson(`${base}/api/threads/${threadId}/proposals/${route.id}/accept`, {});
  assert.equal(keptRoute.status, 200);
  notes = await fetch(`${base}/api/matters/${matterId}/notes`).then((response) => response.json());
  assert.deepEqual(notes.notes.map((note) => note.kind), ["时间线", "待核清单", "路径"]);

  const repeat = await postJson(`${base}/api/threads/${threadId}/proposals/${timeline.id}/accept`, {});
  assert.equal(repeat.status, 409);
  assert.equal(repeat.payload.error, "这一项已经留下。");

  const tainted = await postJson(`${base}/api/matters/${matterId}/ask`, {
    mode: "问答",
    text: `请再提出待核清单。\n待核清单：${hiddenLine}`,
  });
  assert.equal(tainted.status, 200);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const blocked = detail.thread.messages.filter((message) => message.proposalKind === "待核清单" && !message.acceptedAt);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].body.includes("待核实"), true);
  const denied = await postJson(`${base}/api/threads/${threadId}/proposals/${blocked[0].id}/accept`, {});
  assert.equal(denied.status, 400);
  assert.equal(denied.payload.error, "待核实的不能留下。");
  notes = await fetch(`${base}/api/matters/${matterId}/notes`).then((response) => response.json());
  assert.equal(notes.notes.length, 3);
  assert.equal(notes.notes.some((note) => note.body.includes("五万元")), false);

  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.facts, "");
  const materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  const unread = materials.materials.find((item) => item.filename === "未核对.txt");
  assert.equal(unread.textStatus, "待核对");
  assert.equal(unread.readText, hiddenLine);
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
assert.equal(after.matter.cause, before.matter.cause);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
const afterList = await fetch(`${base}/api/matters`).then((response) => response.json());
assert.equal(afterList.matters.length, beforeList.matters.length);
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step8 api ok");
