import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import {
  emptySlots,
  isPleadKind,
  missingSlots,
  pleadKindFrom,
  PLEAD_FIELDS,
  PLEAD_KINDS,
  type PleadKind,
} from "@/lib/plead-fields";

export { PLEAD_FIELDS, PLEAD_KINDS, isPleadKind, pleadKindFrom, emptySlots, missingSlots };
export type { PleadKind };

export type PleadSlots = Record<string, string>;

export type Pleading = {
  id: string;
  matterId: string;
  kind: PleadKind;
  slots: PleadSlots;
  body: string;
  warnings: string;
  status: "缺槽位" | "已成文";
  version: number;
  createdAt: string;
};

type Failure = { error: string; status: 400 | 404 | 409 };

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function matterGate(matterId: string): Failure | null {
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  return null;
}

function parseSlots(raw: string, kind: PleadKind): PleadSlots {
  const slots = emptySlots(kind);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return slots;
    for (const field of PLEAD_FIELDS[kind]) {
      const value = parsed[field];
      if (typeof value === "string") slots[field] = value;
    }
  } catch {
    return slots;
  }
  return slots;
}

function mapRow(row: {
  id: string;
  matter_id: string;
  kind: PleadKind;
  slots: string;
  body: string;
  warnings: string;
  status: "缺槽位" | "已成文";
  version: number;
  created_at: string;
}): Pleading {
  return {
    id: row.id,
    matterId: row.matter_id,
    kind: row.kind,
    slots: parseSlots(row.slots, row.kind),
    body: row.body,
    warnings: row.warnings,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
  };
}

export async function latestPleading(matterId: string, kind: PleadKind): Promise<Pleading | null> {
  await connection();
  const row = database()
    .prepare(
      `SELECT id, matter_id, kind, slots, body, warnings, status, version, created_at
       FROM pleadings WHERE matter_id = ? AND kind = ?
       ORDER BY version DESC, created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(matterId, kind) as Parameters<typeof mapRow>[0] | undefined;
  return row ? mapRow(row) : null;
}

export async function pleadingPair(matterId: string) {
  const rows = await pleadingHistory(matterId);
  return {
    民事起诉状: rows.民事起诉状.at(-1) ?? null,
    民事上诉状: rows.民事上诉状.at(-1) ?? null,
    答辩状: rows.答辩状.at(-1) ?? null,
    代理词: rows.代理词.at(-1) ?? null,
  };
}

export async function pleadingHistory(matterId: string) {
  await connection();
  const grouped = Object.fromEntries(PLEAD_KINDS.map((kind) => [kind, [] as Pleading[]])) as Record<PleadKind, Pleading[]>;
  const rows = database()
    .prepare(
      `SELECT id, matter_id, kind, slots, body, warnings, status, version, created_at
       FROM pleadings WHERE matter_id = ?
       ORDER BY version, created_at, rowid`,
    )
    .all(matterId) as Array<Parameters<typeof mapRow>[0]>;
  for (const row of rows) {
    if (!isPleadKind(row.kind)) continue;
    grouped[row.kind].push(mapRow(row));
  }
  return grouped;
}

export async function savePleading(
  matterId: string,
  input: {
    kind: PleadKind;
    slots: PleadSlots;
    body?: string;
    warnings?: string;
    status: "缺槽位" | "已成文";
    fresh?: boolean;
  },
): Promise<Failure | Pleading> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const db = database();
  const current = await latestPleading(matterId, input.kind);
  const slots = { ...emptySlots(input.kind), ...input.slots };
  const body = input.body ?? "";
  const warnings = input.warnings ?? "";
  if (current && current.status === "缺槽位" && !input.fresh) {
    db.prepare("UPDATE pleadings SET slots = ?, body = ?, warnings = ?, status = ? WHERE id = ?").run(
      JSON.stringify(slots),
      body,
      warnings,
      input.status,
      current.id,
    );
    return (await latestPleading(matterId, input.kind)) as Pleading;
  }
  const version = (current?.version ?? 0) + 1;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pleadings (
      id, matter_id, kind, slots, body, warnings, status, version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, matterId, input.kind, JSON.stringify(slots), body, warnings, input.status, version, stamp());
  return (await latestPleading(matterId, input.kind)) as Pleading;
}
