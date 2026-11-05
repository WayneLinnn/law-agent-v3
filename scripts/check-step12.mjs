import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "辛公司";
const facts = "事实暗号-12。";
const usableLine = "材料暗号-12。";
const question = "问答暗号-12。只回答两个字：收到";
const retrieval = "房屋租赁合同约定租金已经付清，出租人能否再主张租金";
const statement = "结案说明暗号-12。";
const outcome = {
  outcome: "委托终止",
  outcomeOn: "2026-10-26",
  outcomeNote: "具体情况暗号-12。",
};

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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

function countMessages(threadId) {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const row = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?").get(threadId);
  db.close();
  return Number(row.n);
}

const before = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
const beforeFocuses = await fetch(`${base}/api/matters/${li}/focuses`).then((response) => response.json());
const beforeDrafts = await fetch(`${base}/api/matters/${li}/drafts`).then((response) => response.json());
const beforeMaterials = await fetch(`${base}/api/matters/${li}/materials`).then((response) => response.json());
const beforeTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
const beforeClosing = await fetch(`${base}/api/matters/${li}/closing`).then((response) => response.json());
assert.equal(beforeClosing.closing, null);
assert.equal(beforeClosing.dossier.length, 0);

let matterId = "";
let threadId = "";
let openTaskId = "";

try {
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

  const opened = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(opened.closing, null);
  assert.equal(opened.status, "草稿");
  const still = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(still.matter.status, "草稿");

  const earlyResolve = await postJson(`${base}/api/matters/${matterId}/closing/tasks/missing`, {
    result: "已完成",
    note: "",
  });
  assert.equal(earlyResolve.status, 400);
  assert.equal(earlyResolve.payload.error, "请先写下办结结果。");
  const earlyArchive = await postJson(`${base}/api/matters/${matterId}/closing/archive`);
  assert.equal(earlyArchive.status, 400);
  assert.equal(earlyArchive.payload.error, "请先确认结案说明。");
  const earlyOpen = await postJson(`${base}/api/matters/${matterId}/closing/unarchive`);
  assert.equal(earlyOpen.status, 400);
  assert.equal(earlyOpen.payload.error, "这件案子没有归档。");

  const emptyOutcome = await postJson(`${base}/api/matters/${matterId}/closing`, {
    outcome: "  ",
    outcomeOn: "2026-10-26",
    outcomeNote: "有情况",
  });
  assert.equal(emptyOutcome.status, 400);
  assert.equal(emptyOutcome.payload.error, "请写下办结结果。");
  const badDay = await postJson(`${base}/api/matters/${matterId}/closing`, {
    outcome: "委托终止",
    outcomeOn: "2026-02-31",
    outcomeNote: "有情况",
  });
  assert.equal(badDay.status, 400);
  assert.equal(badDay.payload.error, "请写下办结日期。");
  const emptyNote = await postJson(`${base}/api/matters/${matterId}/closing`, {
    outcome: "委托终止",
    outcomeOn: "2026-10-26",
    outcomeNote: " ",
  });
  assert.equal(emptyNote.status, 400);
  assert.equal(emptyNote.payload.error, "请写下具体情况。");

  const usable = await upload(matterId, "材料-12.txt", usableLine);
  assert.equal(usable.status, 201);
  const confirmed = await postJson(`${base}/api/matters/${matterId}/materials/${usable.payload.id}/confirm`, {
    text: usableLine,
  });
  assert.equal(confirmed.status, 200);
  const keptTask = await postJson(`${base}/api/matters/${matterId}/tasks`, { name: "交状-12", dueOn: "2026-11-20" });
  assert.equal(keptTask.status, 201);
  const openTask = await postJson(`${base}/api/matters/${matterId}/tasks`, { name: "未确认-12", dueOn: "2026-12-15" });
  assert.equal(openTask.status, 201);
  openTaskId = openTask.payload.id;
  const confirmedTask = await postJson(`${base}/api/matters/${matterId}/tasks/${keptTask.payload.id}/confirm`);
  assert.equal(confirmedTask.status, 200);

  const savedOutcome = await postJson(`${base}/api/matters/${matterId}/closing`, outcome);
  assert.equal(savedOutcome.status, 200);
  let view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "结案中");
  assert.equal(view.closing.outcome, "委托终止");
  assert.equal(view.closing.outcomeOn, "2026-10-26");
  assert.equal(view.closing.outcomeNote, "具体情况暗号-12。");
  assert.equal(view.closing.statement, "");
  assert.equal(view.closing.confirmedAt, null);
  assert.equal(view.closing.archivedAt, null);
  assert.equal(view.dossier.length, 0);
  const matterNow = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matterNow.matter.facts, facts);
  assert.equal(matterNow.matter.feeReceived, null);
  assert.equal(matterNow.matter.parties.find((party) => party.role === "client").name, clientName);

  const badResult = await postJson(`${base}/api/matters/${matterId}/closing/tasks/${openTaskId}`, {
    result: "完成了",
    note: "",
  });
  assert.equal(badResult.status, 400);
  assert.equal(badResult.payload.error, "请写下处理结果。");
  const one = await postJson(`${base}/api/matters/${matterId}/closing/tasks/${keptTask.payload.id}`, {
    result: "已完成",
    note: "已经交过",
  });
  assert.equal(one.status, 200);
  const wrote = await postJson(`${base}/api/matters/${matterId}/closing/statement`, { statement });
  assert.equal(wrote.status, 200);
  const missingTask = await postJson(`${base}/api/matters/${matterId}/closing/confirm`);
  assert.equal(missingTask.status, 400);
  assert.equal(missingTask.payload.error, "请先处理每条待办。");
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "结案中");
  assert.equal(view.closing.confirmedAt, null);

  const other = await postJson(`${base}/api/matters/${matterId}/closing/tasks/${openTaskId}`, {
    result: "不再适用",
    note: "委托终止",
  });
  assert.equal(other.status, 200);
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  const openRow = view.tasks.find((task) => task.id === openTaskId);
  const keptRow = view.tasks.find((task) => task.id === keptTask.payload.id);
  assert.equal(openRow.result, "不再适用");
  assert.equal(openRow.confirmedAt, null);
  assert.equal(Boolean(keptRow.confirmedAt), true);
  const desk = await fetch(`${base}/`).then((response) => response.text());
  assert.equal(desk.includes("交状-12"), true);
  assert.equal(desk.includes("未确认-12"), false);

  const sealed = await postJson(`${base}/api/matters/${matterId}/closing/confirm`);
  assert.equal(sealed.status, 200);
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "已结案");
  assert.match(view.closing.confirmedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(view.closing.archivedAt, null);
  assert.equal(view.dossier.length, 0);
  const again = await postJson(`${base}/api/matters/${matterId}/closing/confirm`);
  assert.equal(again.status, 409);
  assert.equal(again.payload.error, "结案说明已经确认。");
  const sameOutcome = await postJson(`${base}/api/matters/${matterId}/closing`, outcome);
  assert.equal(sameOutcome.status, 200);
  const afterSame = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(afterSame.status, "已结案");
  assert.equal(afterSame.closing.confirmedAt, view.closing.confirmedAt);

  const edited = await postJson(`${base}/api/matters/${matterId}/closing`, {
    ...outcome,
    outcomeNote: "具体情况改过-12。",
  });
  assert.equal(edited.status, 200);
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "结案中");
  assert.equal(view.closing.confirmedAt, null);
  const blockedArchive = await postJson(`${base}/api/matters/${matterId}/closing/archive`);
  assert.equal(blockedArchive.status, 400);
  assert.equal(blockedArchive.payload.error, "请先确认结案说明。");
  await postJson(`${base}/api/matters/${matterId}/closing`, outcome);
  const resealed = await postJson(`${base}/api/matters/${matterId}/closing/confirm`);
  assert.equal(resealed.status, 200);

  const asked = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "问答", text: question });
  assert.equal(asked.status === 200 || asked.status === 201, true, JSON.stringify(asked.payload));
  assert.equal(asked.payload.prompted, false);
  threadId = asked.payload.id;
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "已结案");

  const searched = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "直接检索", text: retrieval });
  assert.equal(searched.status, 200, JSON.stringify(searched.payload));
  const candidates = await fetch(`${base}/api/threads/${threadId}/candidates`).then((response) => response.json());
  const law = candidates.candidates.items.find((item) => item.kind === "law");
  assert.equal(Boolean(law), true);
  const kept = await postJson(`${base}/api/threads/${threadId}/candidates/accept`, {
    messageId: candidates.candidates.messageId,
    sourceIds: [law.sourceId],
  });
  assert.equal(kept.status, 200);
  const focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  const source = focuses.focuses[0].sources[0];
  const citation = citationFrom(source);
  assert.equal(citation.length > 0, true);
  const drafted = await postJson(`${base}/api/matters/${matterId}/drafts`, {
    kind: "情况说明",
    body: `${citation}律师记下。`,
  });
  assert.equal(drafted.status, 201, JSON.stringify(drafted.payload));
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "已结案");

  const messagesBefore = countMessages(threadId);
  const archived = await postJson(`${base}/api/matters/${matterId}/closing/archive`);
  assert.equal(archived.status, 200);
  assert.equal(countMessages(threadId), messagesBefore);
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "已归档");
  assert.match(view.closing.archivedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.match(view.closing.confirmedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const labels = view.dossier.map((item) => `${item.section}:${item.label}`).join("\n");
  assert.equal(view.dossier.some((item) => item.section === "材料" && item.label.includes("材料-12.txt")), true);
  assert.equal(view.dossier.some((item) => item.section === "出处" && item.label.includes(source.title.slice(0, 12))), true);
  assert.equal(view.dossier.some((item) => item.section === "文书" && item.label === "情况说明 第1版"), true);
  assert.equal(view.dossier.some((item) => item.section === "待办" && item.label.includes("交状-12（已完成）")), true);
  assert.equal(view.dossier.some((item) => item.section === "待办" && item.label.includes("未确认-12（不再适用）")), true);
  assert.equal(view.dossier.some((item) => item.section === "结案说明" && item.label.includes(statement)), true);
  assert.equal(labels.includes("问答暗号-12"), false);
  assert.equal(labels.includes(facts), false);
  assert.equal(view.dossier.some((item) => item.section === "问答"), false);
  const dossierCount = view.dossier.length;
  const openStill = view.tasks.find((task) => task.id === openTaskId);
  assert.equal(openStill.confirmedAt, null);
  const matterArchived = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matterArchived.matter.facts, facts);
  assert.equal(matterArchived.matter.feeReceived, null);
  const materials = await fetch(`${base}/api/matters/${matterId}/materials`).then((response) => response.json());
  assert.equal(materials.materials[0].textStatus, "可用文字");
  assert.equal(materials.materials[0].usableText, usableLine);
  const deskArchived = await fetch(`${base}/`).then((response) => response.text());
  assert.equal(deskArchived.includes("交状-12"), true);
  assert.equal(deskArchived.includes("未确认-12"), false);

  const repeat = await postJson(`${base}/api/matters/${matterId}/closing/archive`);
  assert.equal(repeat.status, 409);
  assert.equal(repeat.payload.error, "已经归档。");

  const stillAsk = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "问答", text: "再问一句：收到" });
  assert.equal(stillAsk.status, 200, JSON.stringify(stillAsk.payload));
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "已归档");
  assert.equal(view.dossier.length, dossierCount);
  const afterAsk = countMessages(threadId);
  const compose = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "分析成文", text: "写成底稿" });
  assert.equal(compose.status, 409);
  assert.equal(compose.payload.error, "归档后只供查阅。");
  assert.equal(countMessages(threadId), afterAsk);
  const drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 1);
  const lockedSave = await postJson(`${base}/api/matters/${matterId}/drafts`, {
    kind: "情况说明",
    body: `${citation}不能留下。`,
  });
  assert.equal(lockedSave.status, 409);
  assert.equal(lockedSave.payload.error, "归档后只供查阅。");

  const lockedSearch = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "直接检索", text: retrieval });
  assert.equal(lockedSearch.status, 200, JSON.stringify(lockedSearch.payload));
  const lockedBatch = await fetch(`${base}/api/threads/${threadId}/candidates`).then((response) => response.json());
  const lockedLaw = lockedBatch.candidates.items.find((item) => item.kind === "law");
  const refused = await postJson(`${base}/api/threads/${threadId}/candidates/accept`, {
    messageId: lockedBatch.candidates.messageId,
    sourceIds: [lockedLaw.sourceId],
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.payload.error, "归档后只供查阅。");
  const focusesAfter = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focusesAfter.focuses.length, 1);
  assert.equal(focusesAfter.focuses[0].sources.length, 1);
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.dossier.length, dossierCount);

  const openedAgain = await postJson(`${base}/api/matters/${matterId}/closing/unarchive`);
  assert.equal(openedAgain.status, 200);
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "已结案");
  assert.equal(view.closing.archivedAt, null);
  assert.match(view.closing.confirmedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(view.dossier.length, 0);
  assert.equal(countMessages(threadId) > messagesBefore, true);
  const resumed = await postJson(`${base}/api/matters/${matterId}/drafts`, {
    kind: "情况说明",
    body: `${citation}解档后记下。`,
  });
  assert.equal(resumed.status, 201, JSON.stringify(resumed.payload));
  const afterDrafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(afterDrafts.drafts.length, 2);
  assert.equal(afterDrafts.drafts[1].body.includes("解档后记下。"), true);
  view = await fetch(`${base}/api/matters/${matterId}/closing`).then((response) => response.json());
  assert.equal(view.status, "已结案");
  const finalMatter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(finalMatter.matter.facts, facts);
  assert.equal(finalMatter.matter.feeReceived, null);
  assert.equal(finalMatter.matter.parties.find((party) => party.role === "client").name, clientName);
} finally {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  if (matterId) {
    db.prepare("DELETE FROM dossier_items WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM task_resolutions WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM closings WHERE matter_id = ?").run(matterId);
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

const gone = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
if (matterId) assert.equal(gone.prepare("SELECT id FROM matters WHERE id = ?").get(matterId), undefined);
gone.close();

const after = await fetch(`${base}/api/matters/${li}`).then((response) => response.json());
assert.equal(after.matter.status, before.matter.status);
assert.equal(after.matter.facts, before.matter.facts);
assert.equal(after.matter.mandate, before.matter.mandate);
assert.equal(after.matter.feeReceived, before.matter.feeReceived);
assert.equal(after.matter.parties.find((party) => party.role === "client").name, "李某");
const afterClosing = await fetch(`${base}/api/matters/${li}/closing`).then((response) => response.json());
assert.equal(afterClosing.closing, null);
assert.equal(afterClosing.dossier.length, 0);
const afterFocuses = await fetch(`${base}/api/matters/${li}/focuses`).then((response) => response.json());
assert.equal(afterFocuses.focuses.length, beforeFocuses.focuses.length);
const afterDrafts = await fetch(`${base}/api/matters/${li}/drafts`).then((response) => response.json());
assert.equal(afterDrafts.drafts.length, beforeDrafts.drafts.length);
const afterMaterials = await fetch(`${base}/api/matters/${li}/materials`).then((response) => response.json());
assert.equal(JSON.stringify(afterMaterials), JSON.stringify(beforeMaterials));
const afterTasks = await fetch(`${base}/api/matters/${li}/tasks`).then((response) => response.json());
assert.equal(JSON.stringify(afterTasks), JSON.stringify(beforeTasks));
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
console.log("step12 api ok");
