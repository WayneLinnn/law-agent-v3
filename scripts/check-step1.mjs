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
  const payload = await response.json();
  return { status: response.status, payload };
}

const before = await fetch(`${base}/api/matters`).then((response) => response.json());
const beforeCount = before.matters.length;

const missing = await postJson(`${base}/api/matters`, {
  name: "不该建成",
  people: [{ name: "甲建设有限公司", position: "原告", idNumber: "" }],
  cause: "建设工程施工合同纠纷",
});
assert.equal(missing.status, 400);
assert.equal(missing.payload.error, "请点明谁是客户。");

const joined = await postJson(`${base}/api/matters`, {
  clientName: "甲",
  people: "乙置业有限公司、丙贸易有限公司",
});
assert.equal(joined.status, 400);
assert.equal(joined.payload.error, "当事人要每人一行。");

const afterReject = await fetch(`${base}/api/matters`).then((response) => response.json());
assert.equal(afterReject.matters.length, beforeCount);

const emptyCard = await postJson(`${base}/api/matters`, { clientName: "李某" });
assert.equal(emptyCard.status, 201);
assert.ok(emptyCard.payload.id);

const emptyMatter = await fetch(`${base}/api/matters/${emptyCard.payload.id}`).then((response) =>
  response.json(),
);
assert.equal(emptyMatter.matter.name, "李某");
assert.equal(emptyMatter.matter.status, "草稿");
assert.equal(emptyMatter.matter.cause, "");
assert.equal(emptyMatter.matter.facts, "");
assert.equal(emptyMatter.matter.mandate, "");
assert.deepEqual(
  emptyMatter.matter.parties.map((party) => [party.role, party.name]),
  [["client", "李某"]],
);

const complaint = `原告：甲建设有限公司，统一社会信用代码91330100MA1234567X
被告：乙置业有限公司、丙贸易有限公司
委托代理人：王律师
案由：建设工程施工合同纠纷
诉讼请求：
判令支付工程款。
事实与理由：
甲公司承包了工程。
此致
杭州市西湖区人民法院
`;

const read = await postJson(`${base}/api/intake/read`, { text: complaint });
assert.equal(read.status, 200);
assert.deepEqual(
  read.payload.people.map((party) => party.name),
  ["甲建设有限公司", "乙置业有限公司", "丙贸易有限公司"],
);
assert.equal(read.payload.people[0].position, "原告");
assert.equal(read.payload.clientName, undefined);
assert.deepEqual(
  read.payload.organs.map((party) => party.name),
  ["杭州市西湖区人民法院"],
);

const created = await postJson(`${base}/api/matters`, {
  name: "乙置业与甲建设建设工程施工合同纠纷",
  clientName: "乙置业有限公司",
  people: read.payload.people,
  organs: read.payload.organs,
  cause: read.payload.cause,
  facts: read.payload.facts,
  mandate: read.payload.mandate,
});
assert.equal(created.status, 201);

const detail = await fetch(`${base}/api/matters/${created.payload.id}`).then((response) =>
  response.json(),
);
const roles = detail.matter.parties.map((party) => [party.role, party.name, party.position]);
assert.deepEqual(roles, [
  ["client", "乙置业有限公司", "被告"],
  ["opposing", "甲建设有限公司", "原告"],
  ["opposing", "丙贸易有限公司", "被告"],
  ["organ", "杭州市西湖区人民法院", ""],
]);
assert.equal(detail.matter.parties[1].idNumber, "91330100MA1234567X");
assert.equal(
  detail.matter.parties.some((party) => party.name.includes("、")),
  false,
);
assert.equal(detail.matter.status, "草稿");

const again = await fetch(`${base}/api/matters/${created.payload.id}`).then((response) =>
  response.json(),
);
assert.equal(again.matter.name, detail.matter.name);

const blank = await postJson(`${base}/api/intake/read`, { text: "这是一段闲聊。" });
assert.equal(blank.status, 200);
assert.deepEqual(blank.payload.people, []);
assert.equal(blank.payload.cause, "");
assert.equal(blank.payload.mandate, "");

const notText = new File([Uint8Array.from([0, 1, 2])], "photo.png");
const form = new FormData();
form.set("file", notText);
const rejectedFile = await fetch(`${base}/api/intake/read`, { method: "POST", body: form });
assert.equal(rejectedFile.status, 400);

const missingMatter = await fetch(`${base}/api/matters/missing`);
assert.equal(missingMatter.status, 404);

const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
const counts = db.prepare("SELECT COUNT(*) AS n FROM matters").get();
assert.equal(counts.n, beforeCount + 2);
const materials = db.prepare("SELECT COUNT(*) AS n FROM materials").get();
assert.equal(materials.n, 0);
const clients = db.prepare("SELECT name FROM clients ORDER BY name").all();
assert.deepEqual(
  clients.map((row) => row.name),
  ["乙置业有限公司", "李某"],
);
const plaintiff = db
  .prepare(
    "SELECT role FROM parties WHERE name = ? AND matter_id = ?",
  )
  .get("甲建设有限公司", created.payload.id);
assert.equal(plaintiff.role, "opposing");
db.close();

assert.equal(fs.existsSync(path.join(process.cwd(), "data", "law.sqlite")), false);
console.log("step1 api ok");
