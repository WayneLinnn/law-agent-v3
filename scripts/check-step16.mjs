import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const base = "http://localhost:3010";
const li = "9563ceb2-aeeb-465c-ba26-390d139b0245";
const clientName = "寅公司";
const rent = "房屋租赁合同约定租金已经付清，出租人能否再主张租金";
const draftAsk = `写成一份文书：${rent}`;
const skipAsk = `分析法律问题：${rent}。不查法宝。`;
const judgeAsk = `分析法律问题：只根据已经勾选的出处看${rent}。不查法宝。`;
const writeAsk = "写成一份文书：只根据已经勾选的出处写两句。不查法宝。";
const forceAsk = `分析法律问题：${rent}。要查法宝。`;
const keptBody = "律师留下这一版。只写已经勾上的出处。";
const noSource = "没有勾选出处。这一问先不写结论，也不把法条和案号写成依据。";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, payload: await response.json() };
}

function snapshotLi() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  const matter = db
    .prepare("SELECT status, facts, mandate, fee_received FROM matters WHERE id = ?")
    .get(li);
  const messages = db
    .prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE matter_id = ?)",
    )
    .get(li);
  const drafts = db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE matter_id = ?").get(li);
  const focuses = db.prepare("SELECT COUNT(*) AS n FROM focuses WHERE matter_id = ?").get(li);
  const sources = db.prepare("SELECT COUNT(*) AS n FROM sources WHERE matter_id = ?").get(li);
  const tasks = db.prepare("SELECT name, due_on, confirmed_at FROM tasks WHERE matter_id = ?").all(li);
  const closing = db.prepare("SELECT outcome, archived_at FROM closings WHERE matter_id = ?").get(li);
  db.close();
  return {
    matter,
    messages: Number(messages.n),
    drafts: Number(drafts.n),
    focuses: Number(focuses.n),
    sources: Number(sources.n),
    tasks,
    closing,
  };
}

const before = snapshotLi();
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

  const searched = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "问答", text: draftAsk });
  assert.equal(searched.status, 201, JSON.stringify(searched.payload));
  threadId = searched.payload.id;
  let focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses.length, 0);
  let drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 0);
  let detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.messages.length, 1);
  assert.equal(detail.thread.messages[0].mode, "问答");
  assert.equal(detail.thread.messages[0].role, "lawyer");
  const candidates = await fetch(`${base}/api/threads/${threadId}/candidates`).then((response) => response.json());
  const batch = candidates.candidates;
  assert.equal(batch.question, draftAsk);
  assert.equal(batch.items.length >= 2, true);
  const keptId = batch.items[0].sourceId;
  const skippedId = batch.items[1].sourceId;

  const skipped = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "问答", text: skipAsk });
  assert.equal(skipped.status, 200, JSON.stringify(skipped.payload));
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.messages.at(-1).body, noSource);
  const still = await fetch(`${base}/api/threads/${threadId}/candidates`).then((response) => response.json());
  assert.equal(still.candidates.question, draftAsk);
  assert.equal(still.candidates.messageId, batch.messageId);
  focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses.length, 0);

  const accepted = await postJson(`${base}/api/threads/${threadId}/candidates/accept`, {
    messageId: batch.messageId,
    sourceIds: [keptId],
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload));
  focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses.length, 1);
  assert.equal(focuses.focuses[0].sources.length, 1);
  assert.equal(focuses.focuses[0].sources[0].sourceId, keptId);
  assert.equal(
    focuses.focuses.some((focus) => focus.sources.some((source) => source.sourceId === skippedId)),
    false,
  );

  const judged = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "问答", text: judgeAsk });
  assert.equal(judged.status, 200, JSON.stringify(judged.payload));
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const judgment = detail.thread.messages.at(-1);
  assert.equal(judgment.role, "model");
  assert.equal(judgment.proposalKind, "");
  assert.equal(judgment.body.length > 0, true);
  assert.equal(judgment.body.includes(noSource), false);
  focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses[0].sources.length, 1);

  const written = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "问答", text: writeAsk });
  assert.equal(written.status, 200, JSON.stringify(written.payload));
  drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 0);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const draftMessage = detail.thread.messages.at(-1);
  assert.equal(draftMessage.proposalKind, "文书底稿");
  assert.equal(draftMessage.body.length > 0, true);

  const saved = await postJson(`${base}/api/matters/${matterId}/drafts`, { kind: "情况说明", body: keptBody });
  assert.equal(saved.status, 201, JSON.stringify(saved.payload));
  drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 1);
  assert.equal(drafts.drafts[0].kind, "情况说明");
  assert.equal(drafts.drafts[0].body, keptBody);
  let matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "草稿");
  assert.equal(matter.matter.feeReceived, null);
  assert.equal(matter.matter.parties.find((party) => party.role === "client").name, clientName);

  const forced = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "问答", text: forceAsk });
  assert.equal(forced.status, 200, JSON.stringify(forced.payload));
  const forcedBatch = await fetch(`${base}/api/threads/${threadId}/candidates`).then((response) => response.json());
  assert.equal(forcedBatch.candidates.question, forceAsk);
  assert.equal(forcedBatch.candidates.items.length > 0, true);
  focuses = await fetch(`${base}/api/matters/${matterId}/focuses`).then((response) => response.json());
  assert.equal(focuses.focuses.length, 1);
  assert.equal(focuses.focuses[0].sources.length, 1);
  drafts = await fetch(`${base}/api/matters/${matterId}/drafts`).then((response) => response.json());
  assert.equal(drafts.drafts.length, 1);
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  const beforeArchive = detail.thread.messages.length;

  const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
  db.prepare("UPDATE matters SET status = '已归档' WHERE id = ?").run(matterId);
  db.close();
  const archived = await postJson(`${base}/api/matters/${matterId}/ask`, { mode: "问答", text: forceAsk });
  assert.equal(archived.status, 409);
  assert.equal(archived.payload.error, "归档后只供查阅。");
  detail = await fetch(`${base}/api/threads/${threadId}`).then((response) => response.json());
  assert.equal(detail.thread.messages.length, beforeArchive);
  matter = await fetch(`${base}/api/matters/${matterId}`).then((response) => response.json());
  assert.equal(matter.matter.status, "已归档");
  assert.equal(matter.matter.feeReceived, null);
} finally {
  if (matterId) {
    const db = new DatabaseSync(path.join(process.cwd(), "data", "v3.sqlite"));
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare("DELETE FROM sources WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM focuses WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM drafts WHERE matter_id = ?").run(matterId);
    const rows = db.prepare("SELECT id FROM threads WHERE matter_id = ?").all(matterId);
    for (const row of rows) {
      db.prepare("DELETE FROM messages WHERE thread_id = ?").run(row.id);
      db.prepare("DELETE FROM threads WHERE id = ?").run(row.id);
    }
    db.prepare("DELETE FROM parties WHERE matter_id = ?").run(matterId);
    db.prepare("DELETE FROM matters WHERE id = ?").run(matterId);
    const client = db.prepare("SELECT id FROM clients WHERE name = ?").get(clientName);
    if (client) {
      const used = db.prepare("SELECT id FROM parties WHERE client_id = ?").get(client.id);
      if (!used) db.prepare("DELETE FROM clients WHERE id = ?").run(client.id);
    }
    db.close();
  }
}

const after = snapshotLi();
assert.equal(JSON.stringify(after), JSON.stringify(before));
assert.equal(fs.existsSync(path.join("data", "law.sqlite")), false);
const home = await fetch(base).then((response) => response.text());
assert.equal(home.includes(clientName), false);
assert.equal(home.includes("提交证据"), true);
assert.equal(home.includes("李某"), true);
console.log("step16 api ok");
