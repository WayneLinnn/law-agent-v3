import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import { draftFromSources, revisePassage, type DraftSource } from "@/lib/model";
import {
  caseNumberKey,
  findCase,
  getArticle,
  PKULAW_DOWN,
  PkulawError,
} from "@/lib/pkulaw";

type Failure = { error: string; status: 400 | 404 | 409 | 502 };

export type DraftRecord = {
  id: string;
  kind: string;
  version: number;
  body: string;
  sourceIds: string[];
  warnings: string;
  final: boolean;
  basedOn: number | null;
  createdAt: string;
};

type SourceRow = { id: string; kind: "law" | "case"; title: string; text: string };

const LAW_RE =
  /《([^》\n]{1,80})》第([0-9０-９一二三四五六七八九十百零千]{1,12})条(?:之([0-9０-９一二三四五六七八九十]{1,4}))?/g;
const CASE_RE = /[（(]\d{4}[）)][^\s，。；、]{1,30}号/g;

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function compact(value: string) {
  return value.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")");
}

function matterStatus(matterId: string): Failure | { status: string } {
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  return matter;
}

function acceptedSources(matterId: string) {
  return database()
    .prepare("SELECT id, kind, title, text FROM sources WHERE matter_id = ? ORDER BY accepted_at, rowid")
    .all(matterId) as SourceRow[];
}

function asDraftSources(rows: SourceRow[]): DraftSource[] {
  return rows.map((row) => ({ kind: row.kind, title: row.title, text: row.text }));
}

type Citation =
  | { kind: "law"; raw: string; law: string; article: string }
  | { kind: "case"; raw: string; caseNumber: string };

function citationsIn(body: string): Citation[] {
  const found: Citation[] = [];
  for (const match of body.matchAll(LAW_RE)) {
    const article = `第${match[2]}条${match[3] ? `之${match[3]}` : ""}`;
    found.push({ kind: "law", raw: match[0], law: match[1].trim(), article });
  }
  for (const match of body.matchAll(CASE_RE)) {
    found.push({ kind: "case", raw: match[0], caseNumber: match[0] });
  }
  return found;
}

function covered(citation: Citation, rows: SourceRow[]) {
  const hay = compact(rows.map((row) => `${row.title}\n${row.text}`).join("\n"));
  if (citation.kind === "law") {
    return hay.includes(compact(citation.law)) && hay.includes(compact(citation.article));
  }
  return hay.includes(compact(citation.caseNumber)) || hay.includes(caseNumberKey(citation.caseNumber));
}

async function lookup(citation: Citation): Promise<Failure | { found: boolean }> {
  try {
    if (citation.kind === "law") {
      const hit = await getArticle(citation.law, citation.article);
      if (!hit) return { found: false };
      const hay = compact(`${hit.title}\n${hit.text}`);
      return { found: hay.includes(compact(citation.law)) && hay.includes(compact(citation.article)) };
    }
    const hit = await findCase(citation.caseNumber);
    if (!hit) return { found: false };
    return { found: caseNumberKey(hit.caseNumber) === caseNumberKey(citation.caseNumber) };
  } catch (error) {
    if (error instanceof PkulawError) return { error: error.message, status: 502 };
    return { error: PKULAW_DOWN, status: 502 };
  }
}

async function review(body: string, rows: SourceRow[]): Promise<Failure | { body: string; warnings: string }> {
  let next = body;
  const warnings: string[] = [];
  const seen = new Set<string>();
  const pending = citationsIn(body)
    .filter((citation) => {
      if (seen.has(citation.raw)) return false;
      seen.add(citation.raw);
      return true;
    })
    .sort((left, right) => right.raw.length - left.raw.length);
  for (const citation of pending) {
    if (next.includes(`${citation.raw}（疑似编造）`)) {
      warnings.push(`${citation.raw}（疑似编造）`);
      continue;
    }
    if (covered(citation, rows)) continue;
    const looked = await lookup(citation);
    if ("error" in looked) return looked;
    if (looked.found) continue;
    const marked = `${citation.raw}（疑似编造）`;
    next = next.split(citation.raw).join(marked);
    warnings.push(marked);
  }
  return { body: next, warnings: warnings.join("\n") };
}

function mapDraft(row: {
  id: string;
  kind: string;
  version: number;
  body: string;
  source_ids: string;
  warnings: string;
  final: number;
  based_on: number | null;
  created_at: string;
}): DraftRecord {
  let sourceIds: string[] = [];
  try {
    const parsed = JSON.parse(row.source_ids) as unknown;
    if (Array.isArray(parsed)) sourceIds = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    sourceIds = [];
  }
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    body: row.body,
    sourceIds,
    warnings: row.warnings,
    final: row.final === 1,
    basedOn: row.based_on,
    createdAt: row.created_at,
  };
}

export async function listDrafts(matterId: string): Promise<DraftRecord[]> {
  await connection();
  const rows = database()
    .prepare(
      `SELECT id, kind, version, body, source_ids, warnings, final, based_on, created_at
       FROM drafts WHERE matter_id = ? ORDER BY version, rowid`,
    )
    .all(matterId) as Array<{
    id: string;
    kind: string;
    version: number;
    body: string;
    source_ids: string;
    warnings: string;
    final: number;
    based_on: number | null;
    created_at: string;
  }>;
  return rows.map(mapDraft);
}

export async function currentDraft(matterId: string): Promise<DraftRecord | null> {
  const drafts = await listDrafts(matterId);
  if (drafts.length === 0) return null;
  const open = [...drafts].reverse().find((draft) => !draft.final);
  return open ?? drafts[drafts.length - 1];
}

export async function saveDraft(
  matterId: string,
  input: { kind?: unknown; body?: unknown },
): Promise<Failure | { id: string; status: 201 }> {
  await connection();
  const gate = matterStatus(matterId);
  if ("error" in gate) return gate;
  const sources = acceptedSources(matterId);
  if (sources.length === 0) return { error: "请先勾选出处。", status: 400 };
  if (typeof input.kind !== "string" || typeof input.body !== "string") {
    return { error: "没有读懂提交的内容。", status: 400 };
  }
  const kind = input.kind.trim();
  const body = input.body.trim();
  if (!kind) return { error: "请写下文书种类。", status: 400 };
  if (kind.length > 40 || body.length > 20_000) return { error: "这段太长。", status: 400 };
  if (!body) return { error: "请写下正文。", status: 400 };
  const reviewed = await review(body, sources);
  if ("error" in reviewed) return reviewed;

  const db = database();
  const now = stamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    const latest = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM drafts WHERE matter_id = ?").get(
      matterId,
    ) as { version: number };
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO drafts (
        id, matter_id, kind, version, body, source_ids, warnings, final, based_on, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      matterId,
      kind,
      latest.version + 1,
      reviewed.body,
      JSON.stringify(sources.map((source) => source.id)),
      reviewed.warnings,
      latest.version > 0 ? latest.version : null,
      now,
    );
    const after = db.prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as { status: string };
    if (after.status !== gate.status) {
      db.exec("ROLLBACK");
      return { error: "没有留下这一版。", status: 409 };
    }
    db.exec("COMMIT");
    return { id, status: 201 };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function finalizeDraft(matterId: string, draftId: string): Promise<Failure | { id: string; status: 200 }> {
  await connection();
  const gate = matterStatus(matterId);
  if ("error" in gate) return gate;
  const db = database();
  const draft = db
    .prepare("SELECT id, kind, warnings, final FROM drafts WHERE id = ? AND matter_id = ?")
    .get(draftId, matterId) as { id: string; kind: string; warnings: string; final: number } | undefined;
  if (!draft) return { error: "没有这一版。", status: 404 };
  if (draft.final === 1) return { error: "这一版已经定稿。", status: 409 };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE drafts SET final = 1 WHERE id = ? AND matter_id = ?").run(draftId, matterId);
    const after = db.prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as { status: string };
    if (after.status !== gate.status) {
      db.exec("ROLLBACK");
      return { error: "没有定稿。", status: 409 };
    }
    const thread = db
      .prepare("SELECT id FROM threads WHERE matter_id = ? ORDER BY created_at, rowid LIMIT 1")
      .get(matterId) as { id: string } | undefined;
    if (thread) {
      const stale = db
        .prepare(
          `SELECT id, body FROM messages
           WHERE thread_id = ? AND role = 'model' AND proposal_kind = '' AND body LIKE '%还没定稿%'`,
        )
        .all(thread.id) as Array<{ id: string; body: string }>;
      const update = db.prepare("UPDATE messages SET body = ? WHERE id = ?");
      for (const row of stale) {
        update.run(row.body.replaceAll("还没定稿。", "已定稿。").replaceAll("还没定稿", "已定稿"), row.id);
      }
      db.prepare(
        `INSERT INTO messages (
          id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
        ) VALUES (?, ?, 'model', '问答', ?, '', '', NULL, ?)`,
      ).run(crypto.randomUUID(), thread.id, `${draft.kind}已定稿。`, stamp());
    }
    db.exec("COMMIT");
    return { id: draftId, status: 200 };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function sourcesForDraft(matterId: string): Promise<Failure | { sources: DraftSource[] }> {
  const gate = matterStatus(matterId);
  if ("error" in gate) return gate;
  const sources = acceptedSources(matterId);
  if (sources.length === 0) return { error: "请先勾选出处。", status: 400 };
  return { sources: asDraftSources(sources) };
}

export async function reviseDraft(
  matterId: string,
  input: { body?: unknown; passage?: unknown; instruction?: unknown },
): Promise<Failure | { body: string; status: 200 }> {
  await connection();
  const ready = await sourcesForDraft(matterId);
  if ("error" in ready) return ready;
  if (typeof input.body !== "string" || typeof input.passage !== "string" || typeof input.instruction !== "string") {
    return { error: "没有读懂提交的内容。", status: 400 };
  }
  const body = input.body;
  const passage = input.passage.trim();
  const instruction = input.instruction.trim();
  if (!passage) return { error: "请写下要改的一段。", status: 400 };
  if (!instruction) return { error: "请写下要改的地方。", status: 400 };
  if (!body.includes(passage)) return { error: "稿子里没有这一段。", status: 400 };
  const thread = database()
    .prepare("SELECT id FROM threads WHERE matter_id = ? ORDER BY created_at, rowid LIMIT 1")
    .get(matterId) as { id: string } | undefined;
  if (!thread) return { error: "请先分析成文。", status: 400 };
  const revised = await revisePassage(instruction, passage, ready.sources);
  if ("error" in revised) return { error: revised.error, status: 502 };
  const again = matterStatus(matterId);
  if ("error" in again) return again;
  const next = body.replace(passage, revised.text);
  const now = stamp();
  const db = database();
  db.prepare(
    `INSERT INTO messages (
      id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
    ) VALUES (?, ?, 'lawyer', '分析成文', ?, '', '', NULL, ?)`,
  ).run(crypto.randomUUID(), thread.id, `把这一段改一下：${passage}\n${instruction}`, now);
  db.prepare(
    `INSERT INTO messages (
      id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
    ) VALUES (?, ?, 'model', '分析成文', ?, '文书底稿', ?, NULL, ?)`,
  ).run(crypto.randomUUID(), thread.id, next, next, stamp());
  return { body: next, status: 200 };
}

export async function writeDraftMessage(
  threadId: string,
  instruction: string,
  matterId: string,
  kind = "文书",
) {
  const ready = await sourcesForDraft(matterId);
  if ("error" in ready) return ready;
  const drafted = await draftFromSources(instruction, ready.sources);
  if ("error" in drafted) return { error: drafted.error, status: 502 as const };
  const saved = await saveDraft(matterId, { kind: kind.trim() || "文书", body: drafted.text });
  if ("error" in saved) return saved;
  const now = stamp();
  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '分析成文', ?, '文书底稿', ?, NULL, ?)`,
    )
    .run(crypto.randomUUID(), threadId, drafted.text, drafted.text, now);
  return { status: 200 as const, body: drafted.text, id: saved.id, kind: kind.trim() || "文书" };
}

export async function reviseCurrentDraft(
  matterId: string,
  input: { passage: string; instruction: string; kind?: string },
): Promise<Failure | { body: string; id: string; status: 200 }> {
  const current = await currentDraft(matterId);
  if (!current) return { error: "还没有文书。先写一份。", status: 400 };
  if (current.final) return { error: "这一份已经定稿。", status: 409 };
  const revised = await reviseDraft(matterId, {
    body: current.body,
    passage: input.passage,
    instruction: input.instruction,
  });
  if ("error" in revised) return revised;
  const saved = await saveDraft(matterId, {
    kind: input.kind?.trim() || current.kind,
    body: revised.body,
  });
  if ("error" in saved) return saved;
  return { body: revised.body, id: saved.id, status: 200 };
}

export async function draftFileText(matterId: string, body?: string, kind?: string) {
  await connection();
  const matter = database().prepare("SELECT id FROM matters WHERE id = ?").get(matterId);
  if (!matter) return { error: "没有这件案子。", status: 404 as const };
  const current = await currentDraft(matterId);
  const text = (body ?? current?.body ?? "").trim();
  if (!text) return { error: "还没有稿子。", status: 400 as const };
  if (text.length > 20_000) return { error: "这段太长。", status: 400 as const };
  const sources = acceptedSources(matterId);
  const tail =
    sources.length === 0
      ? ""
      : `\n\n已勾出处\n${sources
          .map((source, index) => {
            const label = source.kind === "law" ? "法条" : "案例";
            return `${index + 1}. ${label} ${source.title}\n${source.text.trim()}`;
          })
          .join("\n\n")}`;
  const name = (kind ?? current?.kind ?? "文书").trim().slice(0, 40) || "文书";
  return { text: `${text}${tail}`, name };
}
