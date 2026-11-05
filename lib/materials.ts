import "server-only";

import fs from "node:fs";
import path from "node:path";

import { connection } from "next/server";

import { dataDir, database } from "@/lib/db";
import { extractUpload } from "@/lib/extract-text";
import { materialState } from "@/lib/material-state";
import { kindOf } from "@/lib/uploads";

const MAX_BYTES = 1_000_000;
const DROP_BYTES = 8_000_000;
const DROP_COUNT = 5;

export type TextStatus = "没有可用文字" | "待核对" | "可用文字";

export type MaterialRecord = {
  id: string;
  filename: string;
  kind: string;
  proves: string;
  textStatus: TextStatus;
  readText: string;
  usableText: string;
  note: string;
  stored: boolean;
  createdAt: string;
};

type Failure = { error: string; status: 400 | 404 | 409 };

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function safeFilename(filename: string) {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "";
  if (!base || base === "." || base === ".." || /[<>:"|?*\u0000-\u001f]/.test(base)) return "";
  return base;
}

function matterDir(matterId: string) {
  return path.join(dataDir, "v3-files", matterId);
}

function storedFile(matterId: string, filename: string) {
  const dir = path.resolve(matterDir(matterId));
  const full = path.resolve(dir, filename);
  const relative = path.relative(dir, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return full;
}

function decodeTxt(bytes: Uint8Array): Failure | { text: string } {
  if (bytes.byteLength === 0) return { error: "这份文本是空的。", status: 400 as const };
  if (bytes.byteLength > MAX_BYTES) return { error: "这份文本太大。", status: 400 as const };
  if (bytes.includes(0)) return { error: "读不出文字。", status: 400 as const };
  try {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .trim();
    if (!text) return { error: "这份文本是空的。", status: 400 as const };
    return { text };
  } catch {
    return { error: "读不出文字。", status: 400 as const };
  }
}

function matterGate(matterId: string): Failure | null {
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  return null;
}

export async function listMaterials(matterId: string) {
  await connection();
  const db = database();
  const rows = db
    .prepare(
      `SELECT id, filename, kind, proves, text_status, read_text, usable_text, note, created_at
       FROM materials WHERE matter_id = ? ORDER BY created_at, rowid`,
    )
    .all(matterId) as Array<{
    id: string;
    filename: string;
    kind: string;
    proves: string;
    text_status: TextStatus;
    read_text: string;
    usable_text: string;
    note: string;
    created_at: string;
  }>;
  return rows.map((row) => {
    const full = storedFile(matterId, row.filename);
    const stored = Boolean(full && fs.existsSync(full));
    return {
      id: row.id,
      filename: row.filename,
      kind: row.kind || kindOf(row.filename),
      proves: row.proves,
      textStatus: row.text_status,
      readText: row.read_text,
      usableText: row.usable_text,
      note: row.note ?? "",
      stored,
      createdAt: row.created_at,
    };
  });
}

export { materialState } from "@/lib/material-state";

export async function addTextMaterial(
  matterId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<Failure | { id: string; status: 201 }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const name = safeFilename(filename);
  if (!name.toLowerCase().endsWith(".txt")) {
    return { error: "请放入一份 .txt 文本。", status: 400 as const };
  }
  const decoded = decodeTxt(bytes);
  if ("error" in decoded) return decoded;

  const db = database();
  const duplicate = db
    .prepare("SELECT id FROM materials WHERE matter_id = ? AND filename = ?")
    .get(matterId, name) as { id: string } | undefined;
  if (duplicate) return { error: "本案已经有同名材料。", status: 409 as const };

  const id = crypto.randomUUID();
  const full = storedFile(matterId, name);
  if (!full) return { error: "请放入一份 .txt 文本。", status: 400 as const };

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO materials (
        id, matter_id, filename, kind, proves, submitted_by,
        text_status, read_text, usable_text, created_at
      ) VALUES (?, ?, ?, '', '', NULL, '可用文字', ?, ?, ?)`,
    ).run(id, matterId, name, decoded.text, decoded.text, stamp());
    fs.mkdirSync(matterDir(matterId), { recursive: true });
    fs.writeFileSync(full, bytes);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (fs.existsSync(full)) fs.unlinkSync(full);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      return { error: "本案已经有同名材料。", status: 409 as const };
    }
    throw error;
  }

  return { id, status: 201 as const };
}

export async function addMaterials(
  matterId: string,
  files: File[],
): Promise<Failure | { ids: string[]; status: 201 }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  if (files.length === 0) return { error: "请放入文件。", status: 400 as const };
  if (files.length > DROP_COUNT) return { error: "一次最多放 5 份。", status: 400 as const };
  const prepared: Array<{ id: string; name: string; full: string; kind: string; bytes: Uint8Array }> = [];
  for (const file of files) {
    const name = safeFilename(file.name).slice(0, 180);
    if (!name) return { error: "文件名不能用。", status: 400 as const };
    if (file.size > DROP_BYTES) return { error: `${name} 超过 8MB。`, status: 400 as const };
    const full = storedFile(matterId, name);
    if (!full) return { error: "文件名不能用。", status: 400 as const };
    prepared.push({
      id: crypto.randomUUID(),
      name,
      full,
      kind: kindOf(name),
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  if (new Set(prepared.map((item) => item.name)).size !== prepared.length) {
    return { error: "这几份里有同名文件。", status: 400 as const };
  }
  const db = database();
  const taken = new Set(
    (db.prepare("SELECT filename FROM materials WHERE matter_id = ?").all(matterId) as Array<{ filename: string }>).map(
      (row) => row.filename,
    ),
  );
  const clash = prepared.find((item) => taken.has(item.name));
  if (clash) return { error: "本案已经有同名材料。", status: 409 as const };

  db.exec("BEGIN IMMEDIATE");
  const written: string[] = [];
  try {
    fs.mkdirSync(matterDir(matterId), { recursive: true });
    for (const item of prepared) {
      db.prepare(
        `INSERT INTO materials (
          id, matter_id, filename, kind, proves, submitted_by,
          text_status, read_text, usable_text, created_at
        ) VALUES (?, ?, ?, ?, '', NULL, '没有可用文字', '', '', ?)`,
      ).run(item.id, matterId, item.name, item.kind, stamp());
      fs.writeFileSync(item.full, item.bytes);
      written.push(item.full);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    for (const full of written) {
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { error: "本案已经有同名材料。", status: 409 as const };
    throw error;
  }
  return { ids: prepared.map((item) => item.id), status: 201 as const };
}

export async function materializeMaterials(matterId: string, filename = "", kind = "") {
  await connection();
  const rows = database()
    .prepare(
      `SELECT id, filename, kind, read_text, usable_text, note
       FROM materials WHERE matter_id = ? ORDER BY created_at, rowid`,
    )
    .all(matterId) as Array<{
    id: string;
    filename: string;
    kind: string;
    read_text: string;
    usable_text: string;
    note: string;
  }>;
  const wanted = filename.trim();
  const targets = rows.filter((row) => {
    const fileKind = row.kind || kindOf(row.filename);
    if (kind && fileKind !== kind) return false;
    if (!wanted) return true;
    return row.filename === wanted || row.filename.includes(wanted) || wanted.includes(row.filename);
  });
  for (const row of targets) {
    if (row.usable_text.trim() || row.read_text.trim()) continue;
    const full = storedFile(matterId, row.filename);
    if (!full || !fs.existsSync(full)) {
      if (row.note !== "原件没有留下，不能再读。") {
        database()
          .prepare("UPDATE materials SET note = ? WHERE id = ? AND matter_id = ?")
          .run("原件没有留下，不能再读。", row.id, matterId);
      }
      continue;
    }
    if (row.note.trim()) continue;
    const extracted = await extractUpload(row.filename, new Uint8Array(fs.readFileSync(full)));
    const text = extracted.text.trim();
    database()
      .prepare(
        `UPDATE materials
         SET kind = ?, text_status = ?, read_text = ?, usable_text = ?, note = ?
         WHERE id = ? AND matter_id = ?`,
      )
      .run(
        extracted.kind || kindOf(row.filename),
        text ? "可用文字" : "没有可用文字",
        text,
        text,
        extracted.note || (text ? "" : "没有抽出文字。"),
        row.id,
        matterId,
      );
  }
}

export async function confirmMaterial(
  matterId: string,
  materialId: string,
  text?: unknown,
): Promise<Failure | { id: string; status: 200 }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const row = database()
    .prepare("SELECT id, filename, text_status, read_text, usable_text FROM materials WHERE id = ? AND matter_id = ?")
    .get(materialId, matterId) as
    | { id: string; filename: string; text_status: TextStatus; read_text: string; usable_text: string }
    | undefined;
  if (!row) return { error: "没有这份材料。", status: 404 as const };
  if (row.text_status === "可用文字" && row.usable_text.trim()) {
    return { id: materialId, status: 200 as const };
  }
  let usable = row.usable_text.trim() || row.read_text.trim();
  if (!usable && typeof text === "string") usable = text.trim();
  if (!usable) {
    await materializeMaterials(matterId, row.filename);
    const again = database()
      .prepare("SELECT read_text, usable_text FROM materials WHERE id = ? AND matter_id = ?")
      .get(materialId, matterId) as { read_text: string; usable_text: string } | undefined;
    usable = again?.usable_text.trim() || again?.read_text.trim() || "";
  }
  if (!usable) return { error: "这份材料没有可用文字。", status: 400 as const };
  database()
    .prepare(
      `UPDATE materials
       SET read_text = CASE WHEN trim(read_text) = '' THEN ? ELSE read_text END,
           usable_text = ?, text_status = '可用文字'
       WHERE id = ? AND matter_id = ?`,
    )
    .run(usable, usable, materialId, matterId);
  return { id: materialId, status: 200 as const };
}

export async function openMaterialFile(matterId: string, materialId: string) {
  await connection();
  const row = database()
    .prepare("SELECT filename FROM materials WHERE id = ? AND matter_id = ?")
    .get(materialId, matterId) as { filename: string } | undefined;
  if (!row) return null;
  const full = storedFile(matterId, row.filename);
  if (!full || !fs.existsSync(full)) return null;
  return { filename: row.filename, bytes: fs.readFileSync(full) };
}
