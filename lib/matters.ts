import "server-only";

import { connection } from "next/server";

import { isCategory } from "@/lib/categories";
import { database } from "@/lib/db";

export type PartyInput = {
  name: string;
  position: string;
  idNumber: string;
};

export type CreateDraftInput = {
  name?: unknown;
  clientName?: unknown;
  people?: unknown;
  organs?: unknown;
  cause?: unknown;
  facts?: unknown;
  mandate?: unknown;
};

export type PartyRecord = PartyInput & { id: string; role: "client" | "opposing" | "organ" };

export type MatterRecord = {
  id: string;
  name: string;
  status: string;
  category: string;
  cause: string;
  facts: string;
  mandate: string;
  feeReceived: string | null;
  createdAt: string;
  parties: PartyRecord[];
};

const MAX_FIELD = 20_000;
const MAX_ROWS = 50;

function textField(value: unknown) {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length > MAX_FIELD) return null;
  return text;
}

function partyList(value: unknown, label: string) {
  if (value == null) return [] as PartyInput[];
  if (typeof value === "string" || !Array.isArray(value)) {
    return { error: `${label}要每人一行。` };
  }
  if (value.length > MAX_ROWS) return { error: `${label}太多。` };
  const rows: PartyInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { error: `${label}要每人一行。` };
    const row = item as Record<string, unknown>;
    const name = textField(row.name);
    const position = textField(row.position);
    const idNumber = textField(row.idNumber);
    if (name == null || position == null || idNumber == null) {
      return { error: "没有读懂提交的内容。" };
    }
    if (!name) continue;
    if (rows.some((party) => party.name === name)) continue;
    rows.push({
      name,
      position,
      idNumber: idNumber.toUpperCase(),
    });
  }
  return rows;
}

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export async function createDraft(input: CreateDraftInput) {
  await connection();
  const clientName = textField(input.clientName);
  const name = textField(input.name);
  const cause = textField(input.cause);
  const facts = textField(input.facts);
  const mandate = textField(input.mandate);
  if (
    clientName == null ||
    name == null ||
    cause == null ||
    facts == null ||
    mandate == null
  ) {
    return { error: "没有读懂提交的内容。", status: 400 as const };
  }
  if (!clientName) return { error: "请点明谁是客户。", status: 400 as const };

  const people = partyList(input.people, "当事人");
  if ("error" in people) return { error: people.error, status: 400 as const };
  const organs = partyList(input.organs, "办案机关");
  if ("error" in organs) return { error: organs.error, status: 400 as const };

  const clientSource =
    people.find((party) => party.name === clientName) ??
    organs.find((party) => party.name === clientName);
  const opposing = people.filter((party) => party.name !== clientName);
  const organNames = new Set(organs.map((party) => party.name));
  const opposingOnly = opposing.filter((party) => !organNames.has(party.name));
  const organRows = organs.filter((party) => party.name !== clientName);

  const db = database();
  const matterId = crypto.randomUUID();
  const createdAt = stamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    const clientId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO clients (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
    ).run(clientId, clientName);
    const stored = db.prepare("SELECT id FROM clients WHERE name = ?").get(clientName) as {
      id: string;
    };
    db.prepare(
      `INSERT INTO matters (
        id, name, status, category, cause, facts, mandate,
        case_number, instance, procedure, parent_matter_id, fee_received, created_at, opened_at
      ) VALUES (?, ?, '草稿', '', ?, ?, ?, '', '', '', NULL, NULL, ?, ?)`,
    ).run(matterId, name || clientName, cause, facts, mandate, createdAt, createdAt);

    const insertParty = db.prepare(
      `INSERT INTO parties (
        id, matter_id, role, name, position, id_number, client_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertParty.run(
      crypto.randomUUID(),
      matterId,
      "client",
      clientName,
      clientSource?.position ?? "",
      clientSource?.idNumber ?? "",
      stored.id,
    );
    for (const party of opposingOnly) {
      insertParty.run(
        crypto.randomUUID(),
        matterId,
        "opposing",
        party.name,
        party.position,
        party.idNumber,
        null,
      );
    }
    for (const party of organRows) {
      insertParty.run(
        crypto.randomUUID(),
        matterId,
        "organ",
        party.name,
        party.position,
        party.idNumber,
        null,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { id: matterId, status: 201 as const };
}

type MatterRow = {
  id: string;
  name: string;
  status: string;
  category: string;
  cause: string;
  facts: string;
  mandate: string;
  fee_received: number | null;
  created_at: string;
};

type PartyRow = {
  id: string;
  matter_id: string;
  role: "client" | "opposing" | "organ";
  name: string;
  position: string;
  id_number: string;
};

function withParties(matters: MatterRow[], parties: PartyRow[]): MatterRecord[] {
  return matters.map((matter) => ({
    id: matter.id,
    name: matter.name,
    status: matter.status,
    category: matter.category,
    cause: matter.cause,
    facts: matter.facts,
    mandate: matter.mandate,
    feeReceived: formatFee(matter.fee_received),
    createdAt: matter.created_at,
    parties: parties
      .filter((party) => party.matter_id === matter.id)
      .map((party) => ({
        id: party.id,
        role: party.role,
        name: party.name,
        position: party.position,
        idNumber: party.id_number,
      })),
  }));
}

export async function listMatters() {
  await connection();
  const db = database();
  const matters = db
    .prepare(
      `SELECT id, name, status, category, cause, facts, mandate, fee_received, created_at
       FROM matters ORDER BY created_at DESC, rowid DESC`,
    )
    .all() as MatterRow[];
  if (matters.length === 0) return [];
  const parties = db
    .prepare(
      `SELECT id, matter_id, role, name, position, id_number
       FROM parties ORDER BY rowid`,
    )
    .all() as PartyRow[];
  return withParties(matters, parties);
}

export async function listRecentMatters(limit = 8) {
  await connection();
  const db = database();
  const matters = db
    .prepare(
      `SELECT id, name, status, category, cause, facts, mandate, fee_received, created_at
       FROM matters
       ORDER BY COALESCE(opened_at, created_at) DESC, rowid DESC
       LIMIT ?`,
    )
    .all(limit) as MatterRow[];
  if (matters.length === 0) return [];
  const parties = db
    .prepare(
      `SELECT id, matter_id, role, name, position, id_number
       FROM parties ORDER BY rowid`,
    )
    .all() as PartyRow[];
  return withParties(matters, parties);
}

export async function touchOpened(matterId: string) {
  await connection();
  database().prepare("UPDATE matters SET opened_at = ? WHERE id = ?").run(stamp(), matterId);
}

export async function getMatter(id: string) {
  await connection();
  const db = database();
  const matter = db
    .prepare(
      `SELECT id, name, status, category, cause, facts, mandate, fee_received, created_at
       FROM matters WHERE id = ?`,
    )
    .get(id) as MatterRow | undefined;
  if (!matter) return null;
  const parties = db
    .prepare(
      `SELECT id, matter_id, role, name, position, id_number
       FROM parties WHERE matter_id = ? ORDER BY rowid`,
    )
    .all(id) as PartyRow[];
  return withParties([matter], parties)[0];
}

export async function setCategory(matterId: string, category: unknown) {
  await connection();
  if (typeof category !== "string" || !isCategory(category.trim())) {
    return { error: "种类要写在清单里。", status: 400 as const };
  }
  const db = database();
  const matter = db.prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 as const };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 as const };
  db.prepare("UPDATE matters SET category = ? WHERE id = ?").run(category.trim(), matterId);
  return { category: category.trim(), status: 200 as const };
}

function formatFee(value: number | null) {
  if (value == null) return null;
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function feeTotal(fees: Array<string | null>) {
  let cents = 0;
  let any = false;
  for (const fee of fees) {
    if (fee == null) continue;
    any = true;
    cents += Math.round(Number(fee) * 100);
  }
  return any ? (cents / 100).toFixed(2) : null;
}

function parseFee(value: unknown): { error: string; status: 400 } | { amount: number | null } {
  if (value == null) return { amount: null };
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string") return { error: "没有读懂提交的内容。", status: 400 };
  const trimmed = text.trim();
  if (!trimmed) return { amount: null };
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(trimmed)) {
    return { error: "金额写到分。", status: 400 };
  }
  return { amount: Number(trimmed) };
}

export async function setFeeReceived(matterId: string, amount: unknown) {
  await connection();
  const parsed = parseFee(amount);
  if ("error" in parsed) return parsed;
  const db = database();
  const matter = db.prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 as const };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 as const };
  db.prepare("UPDATE matters SET fee_received = ? WHERE id = ?").run(parsed.amount, matterId);
  return { feeReceived: formatFee(parsed.amount), status: 200 as const };
}
