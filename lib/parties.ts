import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";

const MAX_NAME = 200;

type Failure = { error: string; status: 400 | 404 | 409 };

function matterGate(matterId: string): Failure | null {
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  return null;
}

function cleanName(value: unknown): Failure | { name: string } {
  if (typeof value !== "string") return { error: "没有读懂提交的内容。", status: 400 as const };
  const name = value.trim();
  if (!name) return { error: "请写下名称。", status: 400 as const };
  if (name.includes("、")) return { error: "请每人一行。", status: 400 as const };
  if (name.length > MAX_NAME) return { error: "这段太长。", status: 400 as const };
  return { name };
}

function cleanPosition(value: unknown): Failure | { position: string } {
  if (typeof value !== "string") return { error: "没有读懂提交的内容。", status: 400 as const };
  const position = value.trim();
  if (position.length > MAX_NAME) return { error: "这段太长。", status: 400 as const };
  return { position };
}

export async function addParty(
  matterId: string,
  input: { role?: unknown; name?: unknown; position?: unknown },
): Promise<Failure | { id: string; status: 201 }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  if (input.role !== "opposing" && input.role !== "organ") {
    return { error: "客户要在创建时点明。", status: 400 };
  }
  const name = cleanName(input.name);
  if ("error" in name) return name;
  const position = cleanPosition(input.position ?? "");
  if ("error" in position) return position;

  const db = database();
  const duplicate = db
    .prepare("SELECT id FROM parties WHERE matter_id = ? AND name = ?")
    .get(matterId, name.name) as { id: string } | undefined;
  if (duplicate) return { error: "这位已经在本案。", status: 409 };

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO parties (id, matter_id, role, name, position, id_number, client_id)
     VALUES (?, ?, ?, ?, ?, '', NULL)`,
  ).run(id, matterId, input.role, name.name, position.position);
  return { id, status: 201 };
}

export async function savePosition(
  matterId: string,
  partyId: string,
  position: unknown,
): Promise<Failure | { id: string; status: 200 }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const cleaned = cleanPosition(position);
  if ("error" in cleaned) return cleaned;

  const db = database();
  const party = db
    .prepare("SELECT id, role FROM parties WHERE id = ? AND matter_id = ?")
    .get(partyId, matterId) as { id: string; role: string } | undefined;
  if (!party) return { error: "没有这位当事人。", status: 404 };
  db.prepare("UPDATE parties SET position = ? WHERE id = ? AND matter_id = ?").run(
    cleaned.position,
    partyId,
    matterId,
  );
  return { id: partyId, status: 200 };
}
