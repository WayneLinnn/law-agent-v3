import "server-only";

import fs from "node:fs";
import path from "node:path";

import { connection } from "next/server";

import { dataDir, database } from "@/lib/db";
import { extractUpload } from "@/lib/extract-text";

const MAX_BYTES = 8_000_000;
const MAX_FILES = 5;

export type UploadRow = {
  id: string;
  filename: string;
  kind: string;
  note: string;
  chars: number;
  stored: boolean;
};

const UNREAD = "还没读。";

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function safeFilename(filename: string) {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "";
  if (!base || base === "." || base === ".." || /[<>:"|?*\u0000-\u001f]/.test(base)) return "";
  return base.slice(0, 180);
}

export function kindOf(filename: string) {
  const lower = filename.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(lower)) return "照片";
  if (/\.pdf$/.test(lower)) return "PDF";
  if (/\.docx?$/.test(lower)) return "Word";
  if (/\.(xlsx|xls)$/.test(lower)) return "表格";
  if (/\.(txt|md|csv)$/.test(lower)) return "文本";
  return "其他";
}

function uploadFile(threadId: string, id: string, filename: string) {
  if (!/^[0-9a-f-]{36}$/i.test(threadId) || !/^[0-9a-f-]{36}$/i.test(id)) return "";
  const ext = path.extname(filename).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : "";
  const dir = path.resolve(dataDir, "v3-uploads", threadId);
  const full = path.resolve(dir, `${id}${safeExt}`);
  if (!full.startsWith(`${dir}${path.sep}`)) return "";
  return full;
}

export function ensureThread(threadId: string) {
  const existing = database().prepare("SELECT id, matter_id FROM threads WHERE id = ?").get(threadId) as
    | { id: string; matter_id: string | null }
    | undefined;
  if (existing?.matter_id) return { error: "文件先放在首页对话，不直接进案子。", status: 409 as const };
  if (!existing) {
    database()
      .prepare("INSERT INTO threads (id, matter_id, title, created_at) VALUES (?, NULL, '', ?)")
      .run(threadId, stamp());
  }
  return { threadId };
}

export async function listUploads(threadId: string): Promise<UploadRow[]> {
  await connection();
  const rows = database()
    .prepare(
      `SELECT id, filename, kind, note, length(text) AS chars
       FROM uploads WHERE thread_id = ? ORDER BY created_at, rowid`,
    )
    .all(threadId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const id = String(row.id);
    const filename = String(row.filename);
    const full = uploadFile(threadId, id, filename);
    return {
      id,
      filename,
      kind: String(row.kind),
      note: String(row.note ?? ""),
      chars: Number(row.chars ?? 0),
      stored: Boolean(full && fs.existsSync(full)),
    };
  });
}

export async function saveUploads(threadId: string, files: File[]) {
  await connection();
  const ready = ensureThread(threadId);
  if ("error" in ready) return ready;
  if (files.length === 0) return { error: "请放入文件。", status: 400 as const };
  if (files.length > MAX_FILES) return { error: "一次最多放 5 份。", status: 400 as const };
  const saved: UploadRow[] = [];
  for (const file of files) {
    const filename = safeFilename(file.name);
    if (!filename) return { error: "文件名不能用。", status: 400 as const };
    if (file.size > MAX_BYTES) return { error: `${filename} 超过 8MB。`, status: 400 as const };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = crypto.randomUUID();
    const full = uploadFile(threadId, id, filename);
    if (!full) return { error: "文件名不能用。", status: 400 as const };
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
    const kind = kindOf(filename);
    database()
      .prepare(
        `INSERT INTO uploads (id, thread_id, filename, kind, text, note, created_at)
         VALUES (?, ?, ?, ?, '', ?, ?)`,
      )
      .run(id, threadId, filename, kind, UNREAD, stamp());
    saved.push({
      id,
      filename,
      kind,
      note: UNREAD,
      chars: 0,
      stored: true,
    });
  }
  return { threadId, files: saved };
}

type KeptUpload = { id: string; filename: string; kind: string; text: string; note: string };

function keptRows(threadId: string) {
  return database()
    .prepare(
      `SELECT id, filename, kind, text, note FROM uploads
       WHERE thread_id = ? ORDER BY created_at, rowid`,
    )
    .all(threadId) as KeptUpload[];
}

async function fillUpload(threadId: string, row: KeptUpload) {
  if (row.text.trim()) return;
  const full = uploadFile(threadId, row.id, row.filename);
  if (!full || !fs.existsSync(full)) {
    if (row.note !== "原件没有留下，不能再读。") {
      database().prepare("UPDATE uploads SET note = ? WHERE id = ?").run("原件没有留下，不能再读。", row.id);
    }
    return;
  }
  if (row.note && row.note !== UNREAD) return;
  const extracted = await extractUpload(row.filename, new Uint8Array(fs.readFileSync(full)));
  database()
    .prepare("UPDATE uploads SET kind = ?, text = ?, note = ? WHERE id = ?")
    .run(extracted.kind, extracted.text, extracted.note || (extracted.text ? "" : "没有抽出文字。"), row.id);
}

export async function materializeUpload(threadId: string, filename = "", kind = "") {
  const rows = keptRows(threadId).filter((row) => !kind || row.kind === kind);
  const wanted = filename.trim();
  const targets = wanted
    ? rows.filter(
        (row) => row.filename === wanted || row.filename.includes(wanted) || wanted.includes(row.filename),
      )
    : rows;
  for (const row of targets) await fillUpload(threadId, row);
}

export async function openUpload(id: string) {
  await connection();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = database()
    .prepare("SELECT thread_id, filename, kind FROM uploads WHERE id = ?")
    .get(id) as { thread_id: string; filename: string; kind: string } | undefined;
  if (!row) return null;
  const full = uploadFile(row.thread_id, id, row.filename);
  if (!full || !fs.existsSync(full)) return null;
  return { filename: row.filename, kind: row.kind, bytes: new Uint8Array(fs.readFileSync(full)) };
}

export function uploadType(filename: string) {
  const lower = filename.toLowerCase();
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.bmp$/.test(lower)) return "image/bmp";
  if (/\.pdf$/.test(lower)) return "application/pdf";
  if (/\.(txt|md|csv)$/.test(lower)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function wantsUploadBody(text: string) {
  return /起诉建议|总结|汇总|依据|根据|读一下|读这份|读所有|分析案情|这些照片|所有照片|全部照片|这份材料|这份文件|这份判决|这份合同/.test(
    text,
  );
}

const PLAIN = new Set([
  "这个",
  "那个",
  "案子",
  "案件",
  "是否",
  "可以",
  "给我",
  "一个",
  "一份",
  "起诉",
  "建议",
  "对于",
  "我们",
  "你们",
  "什么",
  "怎么",
  "为什么",
  "没有",
  "材料",
  "文件",
  "文本",
  "一下",
  "出来",
  "根据",
  "依据",
  "按照",
  "合同",
  "纠纷",
  "法院",
  "原告",
  "被告",
  "诉讼",
  "请求",
  "判决",
  "责任",
  "公司",
  "股东",
  "决议",
  "租赁",
  "运输",
  "质量",
  "事实",
  "理由",
  "法律",
  "答辩",
  "总结",
]);

type StoredUpload = { filename: string; kind: string; text: string; note: string };

function uploadRows(threadId: string) {
  return database()
    .prepare(
      `SELECT filename, kind, text, note FROM uploads
       WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC`,
    )
    .all(threadId) as StoredUpload[];
}

function nameScore(filename: string, asked: string) {
  const stem = filename.replace(/\.[^.]+$/, "");
  let best = 0;
  const longest = Math.min(stem.length, 12);
  for (let size = longest; size >= 3; size -= 1) {
    for (let index = 0; index + size <= stem.length; index += 1) {
      const piece = stem.slice(index, index + size);
      if (asked.includes(piece)) best = Math.max(best, size + 10);
    }
    if (best > 0) break;
  }
  return best;
}

function textScore(text: string, asked: string) {
  const tokens = asked.match(/[\u4e00-\u9fff]{3,12}|[A-Za-z0-9]{3,}/g) ?? [];
  let best = 0;
  for (const token of tokens) {
    if (PLAIN.has(token) || !text.includes(token)) continue;
    best = Math.max(best, token.length);
  }
  return best;
}

export function listPhotos(threadId: string) {
  return database()
    .prepare(
      `SELECT filename, text, note FROM uploads
       WHERE thread_id = ? AND kind = '照片'
       ORDER BY created_at, rowid`,
    )
    .all(threadId) as Array<{ filename: string; text: string; note: string }>;
}

export function readUpload(threadId: string, filename = "") {
  const rows = uploadRows(threadId);
  if (rows.length === 0) return null;
  const wanted = filename.trim();
  const withText = rows.find((row) => row.text.trim()) ?? rows[0];
  if (!wanted) return withText;
  return (
    rows.find((row) => row.filename === wanted || row.filename.includes(wanted) || wanted.includes(row.filename)) ??
    rows.find((row) => row.text.includes(wanted)) ??
    null
  );
}

export function asksUploadList(text: string) {
  return /哪些文件|什么文件|文件列表|当前文件|上传了|放了哪些|放进去的|都传了|有没有文件|几份文件/.test(text);
}

export function catalogUploads(threadId: string) {
  const rows = database()
    .prepare(
      `SELECT filename, kind, note, length(text) AS chars
       FROM uploads WHERE thread_id = ? ORDER BY created_at, rowid`,
    )
    .all(threadId) as Array<{ filename: string; kind: string; note: string; chars: number }>;
  if (rows.length === 0) return "这段对话还没有放入文件。";
  const lines = ["这段对话里放入的文件："];
  for (const row of rows) {
    const state = row.chars > 0 ? `已读出 ${row.chars} 字${row.note ? `，${row.note}` : ""}` : row.note || "还没读。";
    lines.push(`- ${row.filename}（${row.kind}，${state}）`);
  }
  return lines.join("\n");
}

export function matchedUpload(threadId: string, asked: string) {
  const rows = uploadRows(threadId);
  if (rows.length === 0) return null;
  let best: { filename: string; score: number } | null = null;
  for (const row of rows) {
    const score = Math.max(nameScore(row.filename, asked), textScore(row.text, asked));
    if (!best || score > best.score) best = { filename: row.filename, score };
  }
  if (best && best.score >= 3) return { filename: best.filename };
  if (/分析案情|读一下|读这份|这份文件|刚放|放入的|这份判决|这份合同|这份表格|上传的|附件/.test(asked)) {
    const readable = rows.find((row) => row.text.trim());
    return { filename: (readable ?? rows[0]).filename };
  }
  return null;
}
