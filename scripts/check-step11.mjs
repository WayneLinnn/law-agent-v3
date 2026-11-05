import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "庚公司";
const facts = "事实暗号只在案子里-11c。";
const usableLine = "可用暗号只在材料里-11b。租金已经付清。";
const hiddenLine = "待核对暗号-11b。租金未付。";
const question = "房屋租赁合同约定租金已经付清，出租人能否再主张租金";
const instruction = "只根据勾选的出处写两句。不要补充别的事实，不要写材料里的句子。";

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

function citationFrom(source) {
  const packed = `${source.title}\n${source.text}`.replace(/\s+/g, "");
  const titled = source.title
    .replace(/\s+/g, "")
    .match(/^(.*?)(第[0-9０-９一二三四五六七八九十百零千]+条(?:之[0-9０-９一二三四五六七八九十]+)?)/);
  if (titled && packed.includes(titled[2])) return `《${titled[1]}》${titled[2]}`;
  const inText = `${source.title}\n${source.text}`.match(
    /《[^》\n]{1,40}》第[0-9０-９一二三四五六七八九十百零千]+条(?:之[0-9０-９一二三四五六七八九十]+)?/,
  );
  if (inText) return inText[0];
  const caseNo = `${source.title}\n${source.text}`.match(/[（(]\d{4}[）)][^\s，。；、]{1,30}号/);
  return caseNo ? caseNo[0] : "";
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeFocuses = await fetch(`${base}/api/matters/${li}/focuses`).then((response) => response.json());
const beforeDrafts = await fetch(`${base}/api/matters/${li}/drafts`).then((response) => response.json());
const beforeMaterials = await fetch(`${base}/api/matters/${li}/materials`).then((response) => response.json());
const beforeTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
const beforeThreads = await fetch(`${base}/api/threads`).then((response) => response.json());

let matterId = "";
let threadId = "";

try {
  const loose = await postJson(`${base}/api/threads`, { mode: "分析成文", text: "写成底稿" });
  assert.equal(loose.status, 400);
  assert.equal(loose.payload.error, "先建成案子。");
  assert.equal(loose.payload.id, undefined);
  const threadsNow = await fetch(`${base}/api/threads`).then((response) => response.json());
  assert.equal(threadsNow.threads.length, beforeThreads.threads.length);

  const created = await postJson(`${base}/api/matters`, {
    clientName,
    name: "",
    cause: "",
    facts,
    mandate: "",
    people: [],
    organs: [],
  });
  assert.equal(created.status, 201);
  matterId = created.payload.id;

  const blocked = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "分析成文", text: instruction });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.payload.error, "请先勾选出处。");
  const dbEarly = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const none = dbEarly.prepare("SELECT id FROM threads WHERE matter_id = ?").get(matterId);
  dbEarly.close();
  assert.equal(none, undefined);

  const usable = await upload(matterId, "可用.txt", usableLine);
  assert.equal(usable.status, 201);
  const hidden = await upload(matterId, "待核对.txt", hiddenLine);
  assert.equal(hidden.status, 201);
  const confirmed = await postJson(`${base}/api/matters/${matterId}/materials/${usable.payload.id}/confirm`, {
    text: usableLine,
  });
  assert.equal(confirmed.status, 200);

  const asked = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "直接检索", text: question });
  assert.equal(asked.status, 201, JSON.stringify(asked.payload));
  threadId = asked.payload.id;
  const candidates = await fetch(`${base}/api/threads/${threadId}/candidates`).then((response) => response.json());
  const batch = candidates.candidates;
  assert.equal(batch.items.length >= 2, true);
  const law = batch.items.find((item) => item.kind === "law");
  assert.equal(Boolean(law), true);
  const kept = await postJson(`${base}/api/threads/${threadId}/candidates/accept`, {
    messageId: batch.messageId,
    sourceIds: [law.sourceId],
  });
  assert.equal(kept.status, 200);
  const focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses.length, 1);
  assert.equal(focuses.focuses[0].sources.length, 1);
  const source = focuses.focuses[0].sources[0];
  const other = batch.items.find((item) => item.sourceId !== law.sourceId);

  const noneYet = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(noneYet.drafts.length, 0);
  const drafted = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "分析成文", text: instruction });
  assert.equal(drafted.status, 200, JSON.stringify(drafted.payload));
  const stillNone = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(stillNone.drafts.length, 0);
  const detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const modelDraft = detail.thread.messages.find((message) => message.proposalKind === "文书底稿");
  assert.equal(Boolean(modelDraft), true);
  assert.equal(modelDraft.body.includes(usableLine), false);
  assert.equal(modelDraft.body.includes(hiddenLine), false);
  assert.equal(modelDraft.body.includes("事实暗号只在案子里-11c"), false);
  if (!`${source.title}\n${source.text}`.includes(other.title)) {
    assert.equal(modelDraft.body.includes(other.title), false);
  }
  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.facts, facts);

  const emptyKind = await postJson(`${base}/api/matters/${matterId}/drafts`, { kind: "  ", body: "律师改过。" });
  assert.equal(emptyKind.status, 400);
  assert.equal(emptyKind.payload.error, "请写下文书种类。");

  const cited = citationFrom(source);
  assert.equal(cited.length > 0, true, source.title);
  const cleanBody = `${cited}。律师改过。`;
  assert.equal(cleanBody === modelDraft.body, false);
  const saved = await postJson(`${base}/api/matters/${matterId}/drafts`, { kind: "代理词", body: cleanBody });
  assert.equal(saved.status, 201, JSON.stringify(saved.payload));
  let drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 1);
  assert.equal(drafts.drafts[0].kind, "代理词");
  assert.equal(drafts.drafts[0].version, 1);
  assert.equal(drafts.drafts[0].basedOn, null);
  assert.equal(drafts.drafts[0].body, cleanBody);
  assert.equal(drafts.drafts[0].body.includes("疑似编造"), false);
  assert.equal(drafts.drafts[0].warnings, "");
  assert.equal(drafts.drafts[0].final, false);
  assert.deepEqual(drafts.drafts[0].sourceIds, [source.id]);

  const fakeBody = `${cleanBody}\n另见《虚构测试条例》第九百九十九条，（2099）测民终1号。`;
  const flagged = await postJson(`${base}/api/matters/${matterId}/drafts`, { kind: "代理词", body: fakeBody });
  assert.equal(flagged.status, 201, JSON.stringify(flagged.payload));
  drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 2);
  const second = drafts.drafts[1];
  assert.equal(second.version, 2);
  assert.equal(second.basedOn, 1);
  assert.equal(second.body.includes("《虚构测试条例》第九百九十九条（疑似编造）"), true);
  assert.equal(second.body.includes("（2099）测民终1号（疑似编造）"), true);
  assert.equal(second.body.includes("律师改过。"), true);
  assert.equal(second.warnings.includes("疑似编造"), true);
  assert.deepEqual(second.sourceIds, [source.id]);

  const refused = await postJson(`${base}/api/matters/${matterId}/drafts/${second.id}/final`, {});
  assert.equal(refused.status, 400);
  assert.equal(refused.payload.error, "这一版有疑似编造，不能定稿。");
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.facts, facts);
  assert.equal(matter.matter.feeReceived, null);
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);

  const final = await postJson(`${base}/api/matters/${matterId}/drafts/${drafts.drafts[0].id}/final`, {});
  assert.equal(final.status, 200);
  const again = await postJson(`${base}/api/matters/${matterId}/drafts/${drafts.drafts[0].id}/final`, {});
  assert.equal(again.status, 409);
  assert.equal(again.payload.error, "这一版已经定稿。");
  drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts[0].final, true);
  assert.equal(drafts.drafts[1].final, false);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");

  const missing = await postJson(`${base}/api/matters/${matterId}/drafts/revise`, {
    body: cleanBody,
    passage: "这段根本不在稿子里。",
    instruction: "删掉",
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.payload.error, "稿子里没有这一段。");
  const revised = await postJson(`${base}/api/matters/${matterId}/drafts/revise`, {
    body: cleanBody,
    passage: "律师改过。",
    instruction: "改成四个字：已改。",
  });
  assert.equal(revised.status, 200, JSON.stringify(revised.payload));
  assert.equal(typeof revised.payload.body, "string");
  drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 2);
  assert.equal(drafts.drafts[0].body, cleanBody);

  const materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  const keptFile = materials.materials.find((item) => item.filename === "可用.txt");
  const hiddenFile = materials.materials.find((item) => item.filename === "待核对.txt");
  assert.equal(keptFile.textStatus, "可用文字");
  assert.equal(keptFile.usableText, usableLine);
  assert.equal(hiddenFile.textStatus, "待核对");

  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const messagesBefore = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?").get(threadId).n;
  db.prepare("UPDATE matters SET status = '已归档' WHERE id = ?").run(matterId);
  db.close();
  const archivedDraft = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "分析成文", text: instruction });
  assert.equal(archivedDraft.status, 409);
  assert.equal(archivedDraft.payload.error, "归档后只供查阅。");
  const archivedSave = await postJson(`${base}/api/matters/${matterId}/drafts`, { kind: "代理词", body: cleanBody });
  assert.equal(archivedSave.status, 409);
  assert.equal(archivedSave.payload.error, "归档后只供查阅。");
  const archivedFinal = await postJson(`${base}/api/matters/${matterId}/drafts/${second.id}/final`, {});
  assert.equal(archivedFinal.status, 409);
  assert.equal(archivedFinal.payload.error, "归档后只供查阅。");
  drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 2);
  const dbAfter = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const messagesAfter = dbAfter.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?").get(threadId).n;
  dbAfter.close();
  assert.equal(messagesAfter, messagesBefore);
} finally {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  if (matterId) {
    db.prepare("DELETE FROM drafts WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM sources WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM focuses WHERE matter_id = ?").run(matterId);
    const threads = db.prepare("SELECT id FROM threads WHERE matter_id = ?").all(matterId);
    for (const thread of threads) {
      db.prepare("DELETE FROM messages WHERE thread_id = ?").run(thread.id);
      db.prepare("DELETE FROM threads WHERE id = ?").run(thread.id);
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

const after = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
assert.equal(after.matter.status, before.matter.status);
assert.equal(after.matter.facts, before.matter.facts);
assert.equal(after.matter.mandate, before.matter.mandate);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
assert.equal(after.matter.parties.find((party) => party.role === "client").name, "李某");
const afterFocuses = await fetch(`${base}/api/matters/${li}/focuses`).then((response) => response.json());
assert.equal(afterFocuses.focuses.length, beforeFocuses.focuses.length);
const afterDrafts = await fetch(`${base}/api/matters/${li}/drafts`).then((response) => response.json());
assert.equal(afterDrafts.drafts.length, beforeDrafts.drafts.length);
const afterMaterials = await fetch(`${base}/api/matters/${li}/materials`).then((response) => response.json());
assert.equal(JSON.stringify(afterMaterials), JSON.stringify(beforeMaterials));
const afterTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
assert.equal(JSON.stringify(afterTasks), JSON.stringify(beforeTasks));
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step11 api ok");
