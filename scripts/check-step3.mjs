import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

const created = await postJson(`${base}/api/matters`, {
  clientName: "地位测试",
  facts: "原来的事实",
});
assert.equal(created.status, 201);
const matterId = created.payload.id;

const refused = await postJson(`${base}/api/matters`, {});
assert.equal(refused.status, 400);

let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
const client = matter.matter.parties.find((party) => party.role === "client");
assert.equal(client.name, "地位测试");

for (const category of ["刑事", "行政诉讼"]) {
  const saved = await postJson(`${base}/api/matters/${matterId}/category`, { category });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.category, category);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.category, category);
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.facts, "原来的事实");
  assert.equal(matter.matter.parties.length, 1);
}

const badCategory = await postJson(`${base}/api/matters/${matterId}/category`, { category: "专利" });
assert.equal(badCategory.status, 400);

const asClient = await postJson(`${base}/api/matters/${matterId}/parties`, {
  role: "client",
  name: "不该成为客户",
  position: "被告人",
});
assert.equal(asClient.status, 400);
assert.equal(asClient.payload.error, "客户要在创建时点明。");

const position = await postJson(`${base}/api/matters/${matterId}/parties/${client.id}`, {
  position: "被告人",
});
assert.equal(position.status, 200);

const organ = await postJson(`${base}/api/matters/${matterId}/parties`, {
  role: "organ",
  name: "杭州市人民政府",
  position: "复议机关",
});
assert.equal(organ.status, 201);

const joined = await postJson(`${base}/api/matters/${matterId}/parties`, {
  role: "opposing",
  name: "甲、乙",
  position: "被告",
});
assert.equal(joined.status, 400);
assert.equal(joined.payload.error, "请每人一行。");

matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
assert.equal(matter.matter.status, "草稿");
assert.equal(matter.matter.category, "行政诉讼");
assert.equal(matter.matter.facts, "原来的事实");
assert.deepEqual(
  matter.matter.parties.map((party) => [party.role, party.name, party.position]),
  [
    ["client", "地位测试", "被告人"],
    ["organ", "杭州市人民政府", "复议机关"],
  ],
);
const materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) =>
  response.json(),
);
assert.equal(materials.materials.length, 0);

const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
db.exec("PRAGMA foreign_keys = ON");
db.prepare("DELETE FROM parties WHERE matter_id = ?").run(matterId);
db.prepare("DELETE FROM matters WHERE id = ?").run(matterId);
db.prepare("DELETE FROM clients WHERE name = ?").run("地位测试");
db.close();
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step3 api ok");
