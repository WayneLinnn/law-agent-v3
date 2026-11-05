import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import { answerFromHits } from "@/lib/model";
import { searchRetrieval } from "@/lib/retrieval";

type Failure = { error: string; status: 400 | 404 | 409 | 502 };

export type ReviewRecord = {
  id: string;
  matterId: string;
  kind: "合同审查" | "制度审查";
  title: string;
  sourceName: string;
  body: string;
  createdAt: string;
};

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

export async function getReview(matterId: string, reviewId: string): Promise<ReviewRecord | null> {
  await connection();
  const row = database()
    .prepare(
      `SELECT id, matter_id, kind, title, source_name, body, created_at
       FROM reviews WHERE id = ? AND matter_id = ?`,
    )
    .get(reviewId, matterId) as
    | {
        id: string;
        matter_id: string;
        kind: "合同审查" | "制度审查";
        title: string;
        source_name: string;
        body: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    matterId: row.matter_id,
    kind: row.kind,
    title: row.title,
    sourceName: row.source_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listReviews(matterId: string): Promise<ReviewRecord[]> {
  await connection();
  const rows = database()
    .prepare(
      `SELECT id, matter_id, kind, title, source_name, body, created_at
       FROM reviews WHERE matter_id = ? ORDER BY created_at DESC, rowid DESC`,
    )
    .all(matterId) as Array<{
    id: string;
    matter_id: string;
    kind: "合同审查" | "制度审查";
    title: string;
    source_name: string;
    body: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    matterId: row.matter_id,
    kind: row.kind,
    title: row.title,
    sourceName: row.source_name,
    body: row.body,
    createdAt: row.created_at,
  }));
}

async function writeReview(input: {
  matterId: string;
  kind: "合同审查" | "制度审查";
  title: string;
  sourceName: string;
  text: string;
  question: string;
}): Promise<Failure | { id: string; body: string }> {
  const gate = matterGate(input.matterId);
  if (gate) return gate;
  const text = input.text.trim();
  if (!text) return { error: "请提供要审查的正文。", status: 400 };
  const found = await searchRetrieval(input.question || input.title, input.matterId);
  const hits =
    "error" in found
      ? []
      : found.items.map((item) => ({
          kind: item.kind,
          title: item.title,
          text: item.text,
          url: item.url,
        }));
  const answered = hits.length
    ? await answerFromHits(`${input.kind}：${input.question}\n\n正文：\n${text.slice(0, 6_000)}`, hits)
    : {
        text: [
          `${input.kind}要点（未检索到法条，仅按正文）：`,
          "1. 主体与签署是否完整。",
          "2. 权利义务与违约责任是否对等。",
          "3. 争议解决与管辖是否清楚。",
          "4. 与本案材料明显冲突之处需再核。",
          "",
          text.slice(0, 1_500),
        ].join("\n"),
      };
  if ("error" in answered) return { error: answered.error, status: 502 };
  const id = crypto.randomUUID();
  database()
    .prepare(
      `INSERT INTO reviews (id, matter_id, kind, title, source_name, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.matterId, input.kind, input.title, input.sourceName, answered.text, stamp());
  return { id, body: answered.text };
}

export async function reviewContract(
  matterId: string,
  input: { title?: string; text?: string; filename?: string },
): Promise<Failure | { id: string; body: string }> {
  await connection();
  let text = (input.text ?? "").trim();
  let sourceName = (input.filename ?? "").trim();
  if (!text && sourceName) {
    const row = database()
      .prepare(
        `SELECT filename, usable_text, read_text FROM materials
         WHERE matter_id = ? AND filename LIKE ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(matterId, `%${sourceName}%`) as { filename: string; usable_text: string; read_text: string } | undefined;
    if (row) {
      text = row.usable_text.trim() || row.read_text.trim();
      sourceName = row.filename;
    }
  }
  return writeReview({
    matterId,
    kind: "合同审查",
    title: ((input.title ?? "").trim() || sourceName || "合同审查").slice(0, 120),
    sourceName,
    text,
    question: "合同审查要点 权利义务 违约责任 管辖",
  });
}

export async function complianceReview(
  matterId: string,
  input: { title?: string; text?: string },
): Promise<Failure | { id: string; body: string }> {
  await connection();
  return writeReview({
    matterId,
    kind: "制度审查",
    title: (input.title ?? "制度审查").trim().slice(0, 120) || "制度审查",
    sourceName: "",
    text: (input.text ?? "").trim(),
    question: "企业制度合规审查 劳动法 公司治理",
  });
}
