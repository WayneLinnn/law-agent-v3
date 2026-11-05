import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import {
  extractCaseDraft,
  type ExtractedCase,
  type ExtractedParty,
} from "@/lib/model";
import { createDraft } from "@/lib/matters";
import { getThread } from "@/lib/threads";

type Failure = { error: string; status: 400 | 404 | 409 | 502 };

export type ProposalRecord = {
  id: string;
  kind: string;
  body: string;
  acceptedAt: string | null;
};

const KINDS = new Set([
  "当事人",
  "案由",
  "基本事实",
  "委托事项",
  "证明对象",
  "待办",
  "时间线",
  "待核清单",
  "路径",
  "节点",
]);
const NOTE_KINDS = new Set(["时间线", "待核清单", "路径"]);

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function organName(name: string) {
  return /人民法院|人民检察院|公安局|公安分局|复议机关|仲裁委员会/.test(name);
}

function readLabeled(text: string): ExtractedCase {
  const parties: ExtractedParty[] = [];
  for (const match of text.matchAll(
    /当事人(?:还有|是|为)?\s*([^，,。；\n]{1,40})(?:[，,]\s*诉讼地位\s*([^。；\n]{1,40}))?/g,
  )) {
    const position = keep(match[2] ?? "");
    const names = (match[1] ?? "")
      .split("、")
      .map((item) => keep(item))
      .filter(Boolean);
    names.forEach((name, index) => {
      if (parties.some((party) => party.name === name)) return;
      parties.push({
        name,
        position: index === 0 ? position : "",
        idNumber: "",
        role: organName(name) ? "organ" : "opposing",
      });
    });
  }
  const causeMatch = text.match(/案由(是|为|：|:|先按)?\s*([^。\n，,]{2,80})/);
  const cause = keep(causeMatch?.[2] ?? "");
  const facts = keep(text.match(/基本事实(是|为|：|:)?\s*([^。\n]{2,4000})/)?.[2] ?? "");
  return {
    parties,
    cause: causeMatch?.[1] === "先按" ? cause.replace(/记$/, "") : cause,
    facts,
  };
}

function keep(text: string) {
  const value = text.trim();
  if (!value || value === "待核实") return "";
  return value;
}

function mergeExtract(labeled: ExtractedCase, seen: ExtractedCase): ExtractedCase {
  const parties = [...labeled.parties];
  for (const party of seen.parties) {
    if (!parties.some((item) => item.name === party.name)) parties.push(party);
  }
  return {
    parties,
    cause: labeled.cause || seen.cause,
    facts: labeled.facts || seen.facts,
  };
}

function readableParties(parties: ExtractedParty[]) {
  return parties
    .map((party) => [party.name, party.position, party.idNumber].filter(Boolean).join(" "))
    .join("\n");
}

function insertProposal(threadId: string, kind: string, body: string, payload: string) {
  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '问答', ?, ?, ?, NULL, ?)`,
    )
    .run(crypto.randomUUID(), threadId, body, kind, payload, stamp());
}

export async function openCase(
  threadId: string,
  clientName: unknown,
): Promise<Failure | { matterId: string; status: 201 }> {
  await connection();
  const thread = await getThread(threadId);
  if (!thread) return { error: "没有这段对话。", status: 404 };
  if (thread.matterId) return { error: "这段对话已经挂到案子上。", status: 409 };

  const created = await createDraft({
    clientName,
    name: "",
    cause: "",
    facts: "",
    mandate: "",
  });
  if ("error" in created && created.error) {
    return { error: created.error, status: created.status };
  }
  const matterId = created.id;
  if (!matterId) return { error: "没有建成这件案子。", status: 400 };

  const linked = database()
    .prepare("UPDATE threads SET matter_id = ? WHERE id = ? AND matter_id IS NULL")
    .run(matterId, threadId);
  if (linked.changes !== 1) return { error: "这段对话已经挂到案子上。", status: 409 };

  const talk = thread.messages
    .filter((message) => !message.proposalKind)
    .map((message) => ({ role: message.role, body: message.body }));
  const labeled = readLabeled(talk.filter((message) => message.role === "lawyer").map((message) => message.body).join("\n"));
  const seen = await extractCaseDraft(talk);
  const draft = mergeExtract(labeled, "error" in seen ? { parties: [], cause: "", facts: "" } : seen);

  if (draft.parties.length > 0) {
    insertProposal(threadId, "当事人", readableParties(draft.parties), JSON.stringify(draft.parties));
  }
  if (draft.cause) insertProposal(threadId, "案由", draft.cause, draft.cause);
  if (draft.facts) insertProposal(threadId, "基本事实", draft.facts, draft.facts);
  return { matterId, status: 201 };
}

export async function listCaseThread(matterId: string, threadId = "") {
  await connection();
  const thread = (
    threadId
      ? database()
          .prepare("SELECT id, title FROM threads WHERE id = ? AND matter_id = ?")
          .get(threadId, matterId)
      : database()
          .prepare(
            "SELECT id, title FROM threads WHERE matter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
          )
          .get(matterId)
  ) as { id: string; title: string } | undefined;
  if (!thread) return null;
  const proposals = database()
    .prepare(
      `SELECT id, proposal_kind, body, accepted_at
       FROM messages
       WHERE thread_id = ? AND proposal_kind != '' AND proposal_kind != '文书底稿'
       ORDER BY created_at, rowid`,
    )
    .all(thread.id) as Array<{
    id: string;
    proposal_kind: string;
    body: string;
    accepted_at: string | null;
  }>;
  return {
    id: thread.id,
    title: thread.title || "还没写标题",
    proposals: proposals.map((row) => ({
      id: row.id,
      kind: row.proposal_kind,
      body: row.body,
      acceptedAt: row.accepted_at || null,
    })),
  };
}

function applyParties(matterId: string, payload: string): Failure | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { error: "没有读懂这一项。", status: 400 };
  }
  if (!Array.isArray(parsed)) return { error: "没有读懂这一项。", status: 400 };
  const db = database();
  const client = db
    .prepare("SELECT name FROM parties WHERE matter_id = ? AND role = 'client' LIMIT 1")
    .get(matterId) as { name: string } | undefined;
  const insert = db.prepare(
    `INSERT INTO parties (id, matter_id, role, name, position, id_number, client_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  );
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<ExtractedParty>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name || name.includes("、")) return { error: "请每人一行。", status: 400 };
    const position = typeof row.position === "string" ? row.position.trim().slice(0, 200) : "";
    const idNumber = typeof row.idNumber === "string" ? row.idNumber.trim().slice(0, 40) : "";
    const role = row.role === "organ" || organName(name) ? "organ" : "opposing";
    if (client && name === client.name) {
      if (position || idNumber) {
        db.prepare(
          `UPDATE parties SET position = CASE WHEN ? != '' THEN ? ELSE position END,
             id_number = CASE WHEN ? != '' THEN ? ELSE id_number END
           WHERE matter_id = ? AND role = 'client' AND name = ?`,
        ).run(position, position, idNumber, idNumber, matterId, name);
      }
      continue;
    }
    const existing = db
      .prepare("SELECT id FROM parties WHERE matter_id = ? AND name = ?")
      .get(matterId, name) as { id: string } | undefined;
    if (existing) continue;
    insert.run(crypto.randomUUID(), matterId, role, name, position, idNumber);
  }
  return null;
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function applyTask(matterId: string, payload: string): Failure | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { error: "没有读懂这一项。", status: 400 };
  }
  if (!parsed || typeof parsed !== "object") return { error: "没有读懂这一项。", status: 400 };
  const row = parsed as { name?: unknown; dueOn?: unknown };
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const dueOn = typeof row.dueOn === "string" ? row.dueOn.trim() : "";
  if (!name) return { error: "请写下名称。", status: 400 };
  if (name.length > 200) return { error: "这段太长。", status: 400 };
  if (!validDay(dueOn)) return { error: "请写下到期日。", status: 400 };
  database()
    .prepare(
      `INSERT INTO tasks (id, matter_id, name, due_on, note, confirmed_at, created_at)
       VALUES (?, ?, ?, ?, '', NULL, ?)`,
    )
    .run(crypto.randomUUID(), matterId, name, dueOn, stamp());
  return null;
}

function applyProves(matterId: string, payload: string): Failure | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { error: "没有读懂这一项。", status: 400 };
  }
  if (!parsed || typeof parsed !== "object") return { error: "没有读懂这一项。", status: 400 };
  const row = parsed as { filename?: unknown; proves?: unknown };
  const filename = typeof row.filename === "string" ? row.filename.trim() : "";
  const proves = typeof row.proves === "string" ? row.proves.trim() : "";
  if (!filename || !proves) return { error: "请写下证明对象。", status: 400 };
  const material = database()
    .prepare("SELECT id, text_status, usable_text FROM materials WHERE matter_id = ? AND filename = ?")
    .get(matterId, filename) as { id: string; text_status: string; usable_text: string } | undefined;
  if (!material) return { error: "没有这份材料。", status: 404 };
  database().prepare("UPDATE materials SET proves = ? WHERE id = ? AND matter_id = ?").run(proves, material.id, matterId);
  const after = database()
    .prepare("SELECT text_status, usable_text FROM materials WHERE id = ?")
    .get(material.id) as { text_status: string; usable_text: string };
  if (after.text_status !== material.text_status || after.usable_text !== material.usable_text) {
    return { error: "没有留下这一项。", status: 409 };
  }
  return null;
}

function deleteOp(payload: string) {
  try {
    const parsed = JSON.parse(payload) as { op?: unknown; name?: unknown };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.op !== "delete") return null;
    return { name: typeof parsed.name === "string" ? parsed.name.trim() : "" };
  } catch {
    return null;
  }
}

function recordLocks(matterId: string) {
  const db = database();
  const matter = db.prepare("SELECT status, fee_received FROM matters WHERE id = ?").get(matterId);
  const clients = db
    .prepare("SELECT name FROM parties WHERE matter_id = ? AND role = 'client' ORDER BY rowid")
    .all(matterId);
  const materials = db
    .prepare("SELECT id, text_status, usable_text FROM materials WHERE matter_id = ? ORDER BY id")
    .all(matterId);
  return JSON.stringify({ matter, clients, materials });
}

function applyDeleteTask(matterId: string, name: string): Failure | null {
  if (!name) return { error: "没有这条待办。", status: 404 };
  const task = database()
    .prepare("SELECT id FROM tasks WHERE matter_id = ? AND name = ? ORDER BY created_at, rowid LIMIT 1")
    .get(matterId, name) as { id: string } | undefined;
  if (!task) return { error: "没有这条待办。", status: 404 };
  database().prepare("DELETE FROM task_resolutions WHERE task_id = ?").run(task.id);
  const removed = database().prepare("DELETE FROM tasks WHERE id = ? AND matter_id = ?").run(task.id, matterId);
  if (removed.changes !== 1) return { error: "没有这条待办。", status: 404 };
  return null;
}

function applyDeleteParty(matterId: string, name: string): Failure | null {
  if (!name) return { error: "没有这个人。", status: 404 };
  const client = database()
    .prepare("SELECT id FROM parties WHERE matter_id = ? AND role = 'client' AND name = ?")
    .get(matterId, name);
  if (client) return { error: "这一项不能改客户。", status: 400 };
  const party = database()
    .prepare(
      "SELECT id FROM parties WHERE matter_id = ? AND name = ? AND role != 'client' ORDER BY rowid LIMIT 1",
    )
    .get(matterId, name) as { id: string } | undefined;
  if (!party) return { error: "没有这个人。", status: 404 };
  const removed = database().prepare("DELETE FROM parties WHERE id = ? AND matter_id = ?").run(party.id, matterId);
  if (removed.changes !== 1) return { error: "没有这个人。", status: 404 };
  return null;
}

function applyDeleteNote(matterId: string, kind: string): Failure | null {
  const note = database()
    .prepare(
      "SELECT id FROM notes WHERE matter_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(matterId, kind) as { id: string } | undefined;
  if (!note) return { error: "没有这一项。", status: 404 };
  const removed = database().prepare("DELETE FROM notes WHERE id = ? AND matter_id = ?").run(note.id, matterId);
  if (removed.changes !== 1) return { error: "没有这一项。", status: 404 };
  return null;
}

function applyNode(matterId: string, payload: string): Failure | null {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "没有读懂这一项。", status: 400 };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "没有读懂这一项。", status: 400 };
  const record = data as { happenedOn?: unknown; title?: unknown; detail?: unknown };
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 200) : "";
  const happenedOn = typeof record.happenedOn === "string" ? record.happenedOn.trim() : "";
  const detail = typeof record.detail === "string" ? record.detail.trim().slice(0, 4_000) : "";
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(happenedOn)) return { error: "没有读懂这一项。", status: 400 };
  database()
    .prepare(
      `INSERT INTO nodes (id, matter_id, happened_on, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), matterId, happenedOn, title, detail, stamp());
  return null;
}

export async function acceptProposal(
  threadId: string,
  messageId: string,
): Promise<Failure | { id: string; status: 200 }> {
  await connection();
  const db = database();
  const row = db
    .prepare(
      `SELECT m.proposal_kind, m.proposal_body, m.accepted_at, t.matter_id
       FROM messages m
       JOIN threads t ON t.id = m.thread_id
       WHERE m.id = ? AND m.thread_id = ?`,
    )
    .get(messageId, threadId) as
    | {
        proposal_kind: string;
        proposal_body: string;
        accepted_at: string | null;
        matter_id: string | null;
      }
    | undefined;
  if (!row || !row.proposal_kind) return { error: "没有这一项。", status: 404 };
  if (!row.matter_id) return { error: "先建成案子。", status: 400 };
  if (row.accepted_at) return { error: "这一项已经留下。", status: 409 };
  if (!KINDS.has(row.proposal_kind)) return { error: "这一项还不能留下。", status: 400 };
  if (row.proposal_body.includes("待核实")) return { error: "待核实的不能留下。", status: 400 };

  const matter = db.prepare("SELECT status, cause, facts FROM matters WHERE id = ?").get(row.matter_id) as
    | { status: string; cause: string; facts: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  const beforeLocks = recordLocks(row.matter_id);

  db.exec("BEGIN IMMEDIATE");
  try {
    const removal = deleteOp(row.proposal_body);
    let failed: Failure | null = null;
    if (removal && row.proposal_kind === "待办") {
      failed = applyDeleteTask(row.matter_id, removal.name);
    } else if (removal && row.proposal_kind === "当事人") {
      failed = applyDeleteParty(row.matter_id, removal.name);
    } else if (removal && NOTE_KINDS.has(row.proposal_kind)) {
      failed = applyDeleteNote(row.matter_id, row.proposal_kind);
    } else if (row.proposal_kind === "案由") {
      db.prepare("UPDATE matters SET cause = ? WHERE id = ?").run(row.proposal_body, row.matter_id);
    } else if (row.proposal_kind === "基本事实") {
      db.prepare("UPDATE matters SET facts = ? WHERE id = ?").run(row.proposal_body, row.matter_id);
    } else if (row.proposal_kind === "委托事项") {
      db.prepare("UPDATE matters SET mandate = ? WHERE id = ?").run(row.proposal_body, row.matter_id);
    } else if (row.proposal_kind === "待办") {
      failed = applyTask(row.matter_id, row.proposal_body);
    } else if (row.proposal_kind === "证明对象") {
      failed = applyProves(row.matter_id, row.proposal_body);
    } else if (NOTE_KINDS.has(row.proposal_kind)) {
      db.prepare(
        "INSERT INTO notes (id, matter_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(crypto.randomUUID(), row.matter_id, row.proposal_kind, row.proposal_body, stamp());
    } else if (row.proposal_kind === "节点") {
      failed = applyNode(row.matter_id, row.proposal_body);
    } else {
      failed = applyParties(row.matter_id, row.proposal_body);
    }
    if (failed) {
      db.exec("ROLLBACK");
      return failed;
    }
    if (recordLocks(row.matter_id) !== beforeLocks) {
      db.exec("ROLLBACK");
      return { error: "没有留下这一项。", status: 409 };
    }
    const saved = db
      .prepare(
        "UPDATE messages SET accepted_at = ? WHERE id = ? AND thread_id = ? AND accepted_at IS NULL",
      )
      .run(stamp(), messageId, threadId);
    if (saved.changes !== 1) {
      db.exec("ROLLBACK");
      return { error: "这一项已经留下。", status: 409 };
    }
    const after = db.prepare("SELECT status FROM matters WHERE id = ?").get(row.matter_id) as {
      status: string;
    };
    if (after.status !== matter.status) {
      db.exec("ROLLBACK");
      return { error: "没有留下这一项。", status: 409 };
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { id: messageId, status: 200 };
}
