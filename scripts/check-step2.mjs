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
  clientName: "材料测试",
  facts: "原来的基本事实",
});
assert.equal(created.status, 201);
const matterId = created.payload.id;

const missingClient = await postJson(`${base}/api/matters`, { name: "不该建成" });
assert.equal(missingClient.status, 400);
assert.equal(missingClient.payload.error, "请点明谁是客户。");

const file = new File(["承租人李某。\n租金未付。"], "房屋租赁合同.txt", { type: "text/plain" });
const body = new FormData();
body.set("file", file);
const uploaded = await fetch(`${base}/api/matters/${matterId}/materials`, { method: "POST", body });
const uploadedPayload = await uploaded.json();
assert.equal(uploaded.status, 201);

const listed = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
assert.equal(listed.materials.length, 1);
const material = listed.materials[0];
assert.equal(material.filename, "房屋租赁合同.txt");
assert.equal(material.textStatus, "待核对");
assert.equal(material.readText, "承租人李某。\n租金未付。");
assert.equal(material.usableText, "");

const matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
assert.equal(matter.matter.facts, "原来的基本事实");
assert.equal(matter.matter.status, "草稿");

const original = await fetch(`${base}/api/matters/${matterId}/materials/${material.id}/file`);
assert.equal(original.status, 200);
assert.equal(await original.text(), "承租人李某。\n租金未付。");
assert.equal(fs.existsSync(path.join("data", "v3-files", matterId, "房屋租赁合同.txt")), true);

const confirmed = await postJson(`${base}/api/matters/${matterId}/materials/${material.id}/confirm`, {
  text: "承租人李某。\n租金已经付清。",
});
assert.equal(confirmed.status, 200);

const after = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
assert.equal(after.materials[0].textStatus, "可用文字");
assert.equal(after.materials[0].usableText, "承租人李某。\n租金已经付清。");
assert.equal(after.materials[0].readText, "承租人李某。\n租金未付。");
const facts = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
assert.equal(facts.matter.facts, "原来的基本事实");

const again = await postJson(`${base}/api/matters/${matterId}/materials/${material.id}/confirm`, {
  text: "再改一次",
});
assert.equal(again.status, 409);
assert.equal(again.payload.error, "这份材料已经确认。");

const duplicate = new FormData();
duplicate.set("file", file);
const duplicated = await fetch(`${base}/api/matters/${matterId}/materials`, {
  method: "POST",
  body: duplicate,
});
assert.equal(duplicated.status, 409);

const empty = new FormData();
empty.set("file", new File([], "空.txt", { type: "text/plain" }));
const emptied = await fetch(`${base}/api/matters/${matterId}/materials`, { method: "POST", body: empty });
assert.equal(emptied.status, 400);

const png = new FormData();
png.set("file", new File([Uint8Array.from([1, 2, 3])], "扫描.png"));
const rejected = await fetch(`${base}/api/matters/${matterId}/materials`, { method: "POST", body: png });
assert.equal(rejected.status, 400);
assert.equal((await rejected.json()).error, "请放入一份 .txt 文本。");

const second = new FormData();
second.set("file", new File(["另一份文字。"], "补充说明.txt", { type: "text/plain" }));
const secondUpload = await fetch(`${base}/api/matters/${matterId}/materials`, {
  method: "POST",
  body: second,
});
const secondPayload = await secondUpload.json();
assert.equal(secondUpload.status, 201);
const blank = await postJson(
  `${base}/api/matters/${matterId}/materials/${secondPayload.id}/confirm`,
  { text: "   " },
);
assert.equal(blank.status, 400);
assert.equal(blank.payload.error, "请确认读出的文字。");
const stillPending = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) =>
  response.json(),
);
const pending = stillPending.materials.find((item) => item.id === secondPayload.id);
assert.equal(pending.textStatus, "待核对");

const missing = await fetch(`${base}/api/matters/missing/materials`, {
  method: "POST",
  body: (() => {
    const form = new FormData();
    form.set("file", file);
    return form;
  })(),
});
assert.equal(missing.status, 404);

const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
db.exec("PRAGMA foreign_keys = ON");
db.prepare("DELETE FROM materials WHERE matter_id = ?").run(matterId);
db.prepare("DELETE FROM parties WHERE matter_id = ?").run(matterId);
db.prepare("DELETE FROM matters WHERE id = ?").run(matterId);
db.prepare("DELETE FROM clients WHERE name = ?").run("材料测试");
db.close();
fs.rmSync(path.join("data", "v3-files", matterId), { recursive: true, force: true });
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step2 api ok");
