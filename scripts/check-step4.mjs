import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";

function ymd(offset) {
  const now = new Date();
  now.setDate(now.getDate() + offset);
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

const created = await postJson(`${base}/api/matters`, {
  clientName: "待办测试",
  facts: "原来的事实",
});
assert.equal(created.status, 201);
const matterId = created.payload.id;

const missingClient = await postJson(`${base}/api/matters`, {});
assert.equal(missingClient.status, 400);

const unnamed = await postJson(`${base}/api/matters/${matterId}/tasks`, { name: "  ", dueOn: ymd(10) });
assert.equal(unnamed.status, 400);
assert.equal(unnamed.payload.error, "请写下名称。");

const badDate = await postJson(`${base}/api/matters/${matterId}/tasks`, {
  name: "不该留下",
  dueOn: "2026-02-31",
});
assert.equal(badDate.status, 400);

const pending = await postJson(`${base}/api/matters/${matterId}/tasks`, {
  name: "还没确认",
  dueOn: ymd(10),
});
assert.equal(pending.status, 201);

let desk = await fetch(`${base}/api/workbench`).then((response) => response.json());
assert.equal(
  desk.due.some((task) => task.name === "还没确认"),
  false,
);
assert.equal(
  desk.prompts.some((task) => task.name === "还没确认"),
  false,
);

const far = await postJson(`${base}/api/matters/${matterId}/tasks`, {
  name: "很久以后",
  dueOn: ymd(120),
});
assert.equal(far.status, 201);
const farConfirmed = await fetch(`${base}/api/matters/${matterId}/tasks/${far.payload.id}/confirm`, {
  method: "POST",
});
assert.equal(farConfirmed.status, 200);
const again = await fetch(`${base}/api/matters/${matterId}/tasks/${far.payload.id}/confirm`, {
  method: "POST",
});
assert.equal(again.status, 409);

const late = await postJson(`${base}/api/matters/${matterId}/tasks`, {
  name: "已经过期",
  dueOn: ymd(-3),
});
assert.equal(late.status, 201);
const lateConfirmed = await fetch(`${base}/api/matters/${matterId}/tasks/${late.payload.id}/confirm`, {
  method: "POST",
});
assert.equal(lateConfirmed.status, 200);

desk = await fetch(`${base}/api/workbench`).then((response) => response.json());
const dueNames = desk.due.filter((task) => task.matterId === matterId).map((task) => task.name);
assert.deepEqual(dueNames, ["已经过期", "很久以后"]);
assert.equal(desk.due.find((task) => task.name === "已经过期").overdue, true);
assert.equal(
  desk.prompts.some((task) => task.name === "很久以后"),
  false,
);
assert.equal(
  desk.prompts.some((task) => task.name === "已经过期" && task.overdue),
  true,
);

const listed = await fetch(`${base}/api/matters/${matterId}/tasks`).then((response) => response.json());
assert.equal(listed.tasks.length, 3);
assert.equal(listed.tasks.filter((task) => task.confirmedAt).length, 2);

const fee = await postJson(`${base}/api/matters/${matterId}/fee`, {
  amount: "3500.50",
  receivable: "999",
});
assert.equal(fee.status, 200);
assert.equal(fee.payload.feeReceived, "3500.50");

let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
assert.equal(matter.matter.feeReceived, "3500.50");
assert.equal(matter.matter.status, "草稿");
assert.equal(matter.matter.facts, "原来的事实");
assert.equal("receivable" in matter.matter, false);

const cleared = await postJson(`${base}/api/matters/${matterId}/fee`, { amount: "" });
assert.equal(cleared.status, 200);
assert.equal(cleared.payload.feeReceived, null);

const negative = await postJson(`${base}/api/matters/${matterId}/fee`, { amount: "-1" });
assert.equal(negative.status, 400);
const extra = await postJson(`${base}/api/matters/${matterId}/fee`, { amount: "1.234" });
assert.equal(extra.status, 400);

const zero = await postJson(`${base}/api/matters/${matterId}/fee`, { amount: "0" });
assert.equal(zero.status, 200);
assert.equal(zero.payload.feeReceived, "0.00");

desk = await fetch(`${base}/api/workbench`).then((response) => response.json());
const line = desk.fees.matters.find((item) => item.id === matterId);
assert.equal(line.feeReceived, "0.00");
assert.ok(desk.fees.total);

const missing = await postJson(`${base}/api/matters/missing/tasks`, { name: "不存在", dueOn: ymd(1) });
assert.equal(missing.status, 404);

matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
assert.equal(matter.matter.status, "草稿");
assert.equal(matter.matter.facts, "原来的事实");

const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
db.exec("PRAGMA foreign_keys = ON");
db.prepare("DELETE FROM tasks WHERE matter_id = ?").run(matterId);
db.prepare("DELETE FROM parties WHERE matter_id = ?").run(matterId);
db.prepare("DELETE FROM matters WHERE id = ?").run(matterId);
db.prepare("DELETE FROM clients WHERE name = ?").run("待办测试");
db.close();
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step4 api ok");
