import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import { ALPHA_DOWN, AlphaError, searchCases, searchLaws } from "@/lib/alpha-search";
import type { RetrievalHit } from "@/lib/pkulaw";

const TTL_MS = 2 * 60 * 60 * 1000;
const SEARCH_SIZE = 4;
const MAX_TEXT = 12_000;

type Failure = { error: string; status: 400 | 404 | 409 | 502 };
type SearchFailure = { error: string; status: 400 | 502 };

export type Candidate = RetrievalHit;

type Batch = {
  at: number;
  threadId: string;
  messageId: string;
  question: string;
  query: string;
  items: Candidate[];
  focusId?: string;
};

export type CandidateBatch = {
  messageId: string;
  question: string;
  query: string;
  items: Candidate[];
};

export type SavedSource = {
  id: string;
  sourceId: string;
  kind: "law" | "case";
  title: string;
  text: string;
  url: string;
};

export function candidateLines(items: Candidate[]) {
  return items.map((item, index) => {
    const kind = item.kind === "law" ? "法条" : "案例";
    const title = item.url ? `[${item.title}](${item.url})` : item.title;
    return `- ${index + 1}. ${kind} ${title}`;
  });
}

export type SavedFocus = {
  id: string;
  body: string;
  confirmedAt: string | null;
  sources: SavedSource[];
};

const store = globalThis as unknown as { v3Retrieval?: Map<string, Batch> };
const batches: Map<string, Batch> = (store.v3Retrieval ??= new Map());

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function fresh(batch: Batch) {
  return Date.now() - batch.at < TTL_MS;
}

export function retrievalQuery(text: string, parties: Array<{ name: string; idNumber: string }>) {
  let query = text;
  const names = parties
    .map((party) => party.name.trim())
    .filter((name) => name.length >= 2)
    .sort((left, right) => right.length - left.length);
  for (const name of names) query = query.split(name).join(" ");
  for (const party of parties) {
    const idNumber = party.idNumber.trim();
    if (idNumber.length >= 6) query = query.split(idNumber).join(" ");
  }
  query = query
    .replace(/(?:住址|地址|联系地址|住所)[:：]?\s*[^，。；\n]{2,80}/g, " ")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, " ")
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return query;
}

function partiesOf(matterId: string) {
  return database()
    .prepare("SELECT name, id_number FROM parties WHERE matter_id = ?")
    .all(matterId) as Array<{ name: string; id_number: string }>;
}

export async function searchRetrieval(text: string, matterId: string | null): Promise<SearchFailure | { query: string; items: Candidate[] }> {
  await connection();
  const parties = matterId
    ? partiesOf(matterId).map((party) => ({ name: party.name, idNumber: party.id_number }))
    : [];
  const query = retrievalQuery(text, parties);
  if (query.length < 2) return { error: "检索句里只剩下当事人信息。", status: 400 };
  const [laws, cases] = await Promise.allSettled([searchLaws(query, SEARCH_SIZE), searchCases(query, SEARCH_SIZE)]);
  if (laws.status === "rejected" && cases.status === "rejected") {
    const reason = laws.reason instanceof AlphaError ? laws.reason.message : ALPHA_DOWN;
    return { error: reason, status: 502 };
  }
  const items = [
    ...(laws.status === "fulfilled" ? laws.value : []),
    ...(cases.status === "fulfilled" ? cases.value : []),
  ].map((item) => ({ ...item, text: item.text.slice(0, MAX_TEXT) }));
  const seen = new Set<string>();
  return {
    query,
    items: items.filter((item) => {
      if (seen.has(item.sourceId)) return false;
      seen.add(item.sourceId);
      return true;
    }),
  };
}

export function rememberCandidates(batch: Omit<Batch, "at">) {
  batches.set(batch.messageId, { ...batch, at: Date.now() });
}

export async function listCandidates(threadId: string): Promise<CandidateBatch | null> {
  await connection();
  let latest: Batch | null = null;
  for (const batch of batches.values()) {
    if (batch.threadId !== threadId || !fresh(batch)) continue;
    if (!latest || batch.at > latest.at) latest = batch;
  }
  if (!latest) return null;
  return {
    messageId: latest.messageId,
    question: latest.question,
    query: latest.query,
    items: latest.items,
  };
}

export async function listFocuses(matterId: string): Promise<SavedFocus[]> {
  await connection();
  const focuses = database()
    .prepare(
      `SELECT id, body, confirmed_at FROM focuses
       WHERE matter_id = ? ORDER BY position, created_at, rowid`,
    )
    .all(matterId) as Array<{ id: string; body: string; confirmed_at: string | null }>;
  const sources = database()
    .prepare(
      `SELECT id, focus_id, kind, source_id, title, text, url
       FROM sources WHERE matter_id = ? ORDER BY accepted_at, rowid`,
    )
    .all(matterId) as Array<{
    id: string;
    focus_id: string;
    kind: "law" | "case";
    source_id: string;
    title: string;
    text: string;
    url: string;
  }>;
  return focuses.map((focus) => ({
    id: focus.id,
    body: focus.body,
    confirmedAt: focus.confirmed_at,
    sources: sources
      .filter((source) => source.focus_id === focus.id)
      .map((source) => ({
        id: source.id,
        sourceId: source.source_id,
        kind: source.kind,
        title: source.title,
        text: source.text,
        url: source.url,
      })),
  }));
}

export async function saveHitsToMatter(
  matterId: string,
  question: string,
  items: Candidate[],
): Promise<Failure | { focusId: string; count: number }> {
  await connection();
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  if (items.length === 0) return { error: "没有可收的出处。", status: 400 };

  const now = stamp();
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const focusId = crypto.randomUUID();
    const position = db.prepare("SELECT COALESCE(MAX(position), 0) AS position FROM focuses WHERE matter_id = ?").get(
      matterId,
    ) as { position: number };
    db.prepare(
      `INSERT INTO focuses (id, matter_id, body, position, confirmed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(focusId, matterId, question.slice(0, 2_000), position.position + 1, now, now);
    const insert = db.prepare(
      `INSERT INTO sources (
        id, matter_id, focus_id, kind, source_id, title, text, url, status, detail, retrieved_at, accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let count = 0;
    const seen = new Set<string>();
    for (const hit of items) {
      if (seen.has(hit.sourceId)) continue;
      seen.add(hit.sourceId);
      insert.run(
        crypto.randomUUID(),
        matterId,
        focusId,
        hit.kind,
        hit.sourceId,
        hit.title,
        hit.text,
        hit.url,
        hit.status,
        hit.detail,
        now,
        now,
      );
      count += 1;
    }
    db.exec("COMMIT");
    return { focusId, count };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function acceptCandidates(
  threadId: string,
  input: { messageId?: unknown; sourceIds?: unknown },
): Promise<Failure | { focusId: string; status: 200 }> {
  await connection();
  const messageId = typeof input.messageId === "string" ? input.messageId : "";
  const sourceIds = Array.isArray(input.sourceIds)
    ? input.sourceIds.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  if (!messageId || sourceIds.length === 0) return { error: "请勾选出处。", status: 400 };
  const batch = batches.get(messageId);
  if (!batch || batch.threadId !== threadId || !fresh(batch)) return { error: "这些候选已经不在。", status: 400 };
  const chosen = sourceIds.map((sourceId) => batch.items.find((item) => item.sourceId === sourceId));
  if (chosen.some((item) => !item)) return { error: "没有这一条出处。", status: 400 };
  const hits = chosen.filter((item): item is Candidate => Boolean(item));

  const db = database();
  const thread = db.prepare("SELECT matter_id FROM threads WHERE id = ?").get(threadId) as
    | { matter_id: string | null }
    | undefined;
  if (!thread) return { error: "没有这段对话。", status: 404 };
  if (!thread.matter_id) return { error: "先建成案子。", status: 400 };
  const matter = db.prepare("SELECT status FROM matters WHERE id = ?").get(thread.matter_id) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };

  const now = stamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    let focusId = batch.focusId;
    if (focusId) {
      const existing = db.prepare("SELECT id FROM focuses WHERE id = ? AND matter_id = ?").get(focusId, thread.matter_id);
      if (!existing) focusId = undefined;
    }
    if (!focusId) {
      focusId = crypto.randomUUID();
      const position = db.prepare("SELECT COALESCE(MAX(position), 0) AS position FROM focuses WHERE matter_id = ?").get(
        thread.matter_id,
      ) as { position: number };
      db.prepare(
        `INSERT INTO focuses (id, matter_id, body, position, confirmed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(focusId, thread.matter_id, batch.question, position.position + 1, now, now);
    }
    let added = 0;
    const insert = db.prepare(
      `INSERT INTO sources (
        id, matter_id, focus_id, kind, source_id, title, text, url, status, detail, retrieved_at, accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const hit of hits) {
      const already = db
        .prepare("SELECT id FROM sources WHERE focus_id = ? AND source_id = ?")
        .get(focusId, hit.sourceId);
      if (already) continue;
      insert.run(
        crypto.randomUUID(),
        thread.matter_id,
        focusId,
        hit.kind,
        hit.sourceId,
        hit.title,
        hit.text,
        hit.url,
        hit.status,
        hit.detail,
        now,
        now,
      );
      added += 1;
    }
    if (added === 0) {
      db.exec("ROLLBACK");
      return { error: "这一条已经收下。", status: 409 };
    }
    const after = db.prepare("SELECT status FROM matters WHERE id = ?").get(thread.matter_id) as { status: string };
    if (after.status !== matter.status) {
      db.exec("ROLLBACK");
      return { error: "没有收下这一条。", status: 409 };
    }
    db.exec("COMMIT");
    batch.focusId = focusId;
    return { focusId, status: 200 };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
