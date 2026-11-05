import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";

export type FindMatterHit = {
  id: string;
  name: string;
  status: string;
  clientName: string;
};

export type FindMaterialHit = {
  matterId: string;
  matterName: string;
  filename: string;
  snippet: string;
};

export type FindHits = {
  matters: FindMatterHit[];
  materials: FindMaterialHit[];
};

export async function findHits(query: string): Promise<FindHits> {
  await connection();
  const needle = query.trim();
  if (!needle) return { matters: [], materials: [] };

  const matters = database()
    .prepare(
      `SELECT m.id, m.name, m.status,
              COALESCE((SELECT p.name FROM parties p WHERE p.matter_id = m.id AND p.role = 'client' LIMIT 1), '') AS client_name
       FROM matters m
       WHERE m.name LIKE ?
          OR EXISTS (
            SELECT 1 FROM parties p
            WHERE p.matter_id = m.id AND p.role = 'client' AND p.name LIKE ?
          )
       ORDER BY COALESCE(m.opened_at, m.created_at) DESC LIMIT 20`,
    )
    .all(`%${needle}%`, `%${needle}%`) as Array<{
    id: string;
    name: string;
    status: string;
    client_name: string;
  }>;

  const materials = database()
    .prepare(
      `SELECT m.id AS matter_id, m.name AS matter_name, mat.filename,
              COALESCE(NULLIF(mat.usable_text, ''), mat.read_text) AS text
       FROM materials mat
       JOIN matters m ON m.id = mat.matter_id
       WHERE mat.filename LIKE ?
          OR mat.usable_text LIKE ?
          OR mat.read_text LIKE ?
       ORDER BY mat.created_at DESC LIMIT 20`,
    )
    .all(`%${needle}%`, `%${needle}%`, `%${needle}%`) as Array<{
    matter_id: string;
    matter_name: string;
    filename: string;
    text: string;
  }>;

  return {
    matters: matters.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      clientName: row.client_name || "还没写",
    })),
    materials: materials.map((item) => {
      const flat = item.text.replace(/\s+/g, " ").trim();
      const at = flat.indexOf(needle);
      const snippet =
        at >= 0 ? flat.slice(Math.max(0, at - 20), at + needle.length + 40) : flat.slice(0, 80);
      return {
        matterId: item.matter_id,
        matterName: item.matter_name,
        filename: item.filename,
        snippet: `${snippet}${flat.length > 80 ? "……" : ""}`,
      };
    }),
  };
}

export async function findAcross(query: string): Promise<string> {
  const needle = query.trim();
  if (!needle) return "请写下要找的字。";
  const hits = await findHits(needle);
  const lines: string[] = [];
  lines.push("案子：");
  if (hits.matters.length === 0) lines.push("没有名称或客户对上的案子。");
  for (const matter of hits.matters) {
    lines.push(
      `- [${matter.name}](/matters/${matter.id})（${matter.status}，客户 ${matter.clientName}）`,
    );
  }
  lines.push("", "材料：");
  if (hits.materials.length === 0) lines.push("没有文件名或正文对上的材料。");
  for (const item of hits.materials) {
    lines.push(
      `- [${item.matterName}](/matters/${item.matterId}) / ${item.filename}：${item.snippet}`,
    );
  }
  return lines.join("\n");
}
