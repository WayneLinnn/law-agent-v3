import "server-only";

import { connection } from "next/server";

import { AlphaError, searchLaws } from "@/lib/alpha-search";
import { isContractScale, type ContractScale } from "@/lib/contract-scales";
import { database } from "@/lib/db";
import { modelText } from "@/lib/model";

type Failure = { error: string; status: 400 | 404 | 409 | 502 };

export type ContractCard = {
  id: string;
  position: string;
  result: "修改" | "提示";
  redLine: boolean;
  title: string;
  comment: string;
  original: string;
  revision: string;
};

type Draft = Omit<ContractCard, "id"> & { statute: string };

const RED = [
  "红线只标违法或不可留的条款。",
  "强势的红线集中在用工、人身损害、责任限制、违法成本转嫁。",
  "均势的红线是个人信息和商业礼品。",
  "弱势的红线集中在质量标准、个人信息、数据出境、原产地、法定合规。",
].join("\n");

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

function pageLink(matterId: string) {
  return `[合同审查](/matters/${matterId}/contract-review)`;
}

export function contractStatus(matterId: string, count: number, redLines: number) {
  return `已审完，${count} 条，红线 ${redLines} 条。\n${pageLink(matterId)}`;
}

function splitClauses(text: string) {
  const marked = text.split(/(?=第[一二三四五六七八九十百零〇0-9]+条)/).map((part) => part.trim()).filter(Boolean);
  const articles = marked.filter((part) => /^第[一二三四五六七八九十百零〇0-9]+条/.test(part));
  const source = articles.length > 0 ? articles : text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const units: Array<{ label: string; text: string }> = [];
  source.forEach((part, index) => {
    const label = part.match(/^第[一二三四五六七八九十百零〇0-9]+条/)?.[0] ?? `第${index + 1}段`;
    const body = part.replace(/^第[一二三四五六七八九十百零〇0-9]+条[^\n]*\n*/, "").trim();
    const pieces = (body || part).split(/\n+/).map((item) => item.trim()).filter((item) => item.length > 12);
    for (const piece of pieces.length > 0 ? pieces : [part]) units.push({ label, text: piece.slice(0, 1_500) });
  });
  return units;
}

function ourParty(stance: string, sample: string) {
  const named = [...sample.matchAll(/([甲乙丙丁])方[（(]([^）)]{1,16})[）)]/g)];
  const hit = named.find((item) => stance.includes(item[2]) || item[2].includes(stance) || stance.includes(`${item[1]}方`));
  if (hit) return `${hit[1]}方`;
  if (/甲方|买方|采购/.test(stance)) return "甲方";
  if (/乙方|卖方|供货|供应/.test(stance)) return "乙方";
  const gagged = sample.match(/([甲乙])方不得/)?.[1];
  return gagged ? `${gagged}方` : "我方";
}

function otherParty(ours: string) {
  if (ours === "甲方") return "乙方";
  if (ours === "乙方") return "甲方";
  return "对方";
}

function isRenewal(text: string) {
  return /自动续期/.test(text) && /上浮|不得异议|不得因续期/.test(text);
}

function renewalDraft(text: string, label: string, stance: string, scale: ContractScale): Draft {
  const ours = ourParty(stance, text);
  const other = otherParty(ours);
  const gagged = text.match(/([甲乙])方不得/)?.[1];
  const weHoldThePen = !gagged || `${gagged}方` === ours;
  const kept = "本合同自双方盖章之日起生效，有效期一年。期限届满前三十日任何一方未书面反对的，自动续期一年。";
  let revision = kept;
  let comment = "删掉固定涨价和不得异议，自动续期留下。";
  if (scale === "强势" && weHoldThePen) {
    revision = "本合同自双方盖章之日起生效，有效期一年。期限届满前三十日，任何一方均有权书面通知对方不续期，无需说明理由；未经双方书面确认续期的，合同期限届满后终止。双方同意续期的，续期价格由双方另行协商确定。";
    comment = "未经双方书面确认就到期终止。续期价格改为协商。";
  } else if (scale === "强势") {
    revision = text;
    comment = "自动续期和涨价有利于我方，建议保留。";
  } else if (scale === "均势") {
    revision = `本合同自双方盖章之日起生效，有效期一年。${ours}有权在期限届满前六十日书面通知${other}不再续期，无需说明理由；如${ours}未发出不再续期通知且${other}未在期限届满前六十日书面反对的，合同自动续期一年，续期价格由双方另行协商确定。`;
    comment = "保留自动续期，涨价改为协商，并给我方不续期的权利。";
  }
  return {
    title: "续期和价格",
    result: scale === "强势" && !weHoldThePen ? "提示" : "修改",
    position: label,
    redLine: false,
    comment,
    original: text.slice(0, 500),
    revision: scale === "强势" && !weHoldThePen ? "" : revision,
    statute: "",
  };
}

const RED_LINE: Record<ContractScale, RegExp> = {
  强势: /用工|劳动关系|工伤|人身|伤亡|责任限制|累计不超过|免责|转嫁|违法|加班|竞业/,
  均势: /个人信息|身份证|人脸|指纹|家庭住址|定位轨迹|礼品|购物卡|行贿|贿赂/,
  弱势: /质量标准|出厂标准|强制性|个人信息|身份证|人脸|指纹|出境|境外|原产地|出口管制|制裁|法定/,
};

function applyRedLine(card: Draft, scale: ContractScale) {
  card.redLine = RED_LINE[scale].test(`${card.title}\n${card.original}\n${card.comment}`);
}

function jsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart < 0 || arrayEnd <= arrayStart) return null;
  try {
    return { cards: JSON.parse(text.slice(arrayStart, arrayEnd + 1)) };
  } catch {
    return null;
  }
}

function asCards(text: string): Draft[] {
  const parsed = jsonObject(text);
  const rows = Array.isArray(parsed?.cards) ? parsed.cards : [];
  const cards: Draft[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const original = typeof item.original === "string" ? item.original.trim() : "";
    const comment = typeof item.comment === "string" ? item.comment.trim() : "";
    if (!title || !comment || !original) continue;
    const result = item.result === "提示" ? "提示" : "修改";
    cards.push({
      title: title.slice(0, 80),
      result,
      position: typeof item.position === "string" && item.position.trim() ? item.position.trim().slice(0, 40) : "",
      redLine: item.redLine === true || item.redLine === "是",
      comment: comment.slice(0, 600),
      original: original.slice(0, 500),
      revision: result === "提示" ? "" : typeof item.revision === "string" ? item.revision.trim().slice(0, 800) : "",
      statute: typeof item.statute === "string" ? item.statute.trim().slice(0, 80) : "",
    });
  }
  return cards;
}

async function verifyStatute(statute: string) {
  const named = statute.match(/《?([^》第]{2,40})》?\s*第([^条]{1,12})条/);
  if (!named) return "";
  try {
    const hits = await searchLaws(`${named[1]} ${named[2]}`, 2);
    const hit = hits.find((item) => item.title.includes(named[1]) && item.text.includes(`第${named[2]}条`));
    if (!hit) return "";
    const title = hit.title.replace(/\s*第[^条]{1,12}条\s*$/, "");
    return `《${title}》第${named[2]}条`;
  } catch (error) {
    if (error instanceof AlphaError) return "";
    throw error;
  }
}

function reviewPrompt(stance: string, scale: ContractScale) {
  const scaleLine =
    scale === "强势"
      ? "强势：一段里每件对我方不利的事都出一张修改卡，可以补上我方权利。"
      : scale === "均势"
        ? "均势：只改明显不利的。轻微问题用提示，提示不写 revision。"
        : "弱势：只出重大风险和关键权益。一般商业让步不要出卡。";
  return [
    "为这些段落出审查卡片。只返回 JSON：{\"cards\":[{\"title\":\"\",\"result\":\"修改或提示\",\"position\":\"第一条\",\"comment\":\"\",\"original\":\"被审原句\",\"revision\":\"建议改写\",\"statute\":\"\"}]}",
    "一段里有两件不同的事，就出两张卡。没有要改的段落，cards 为空。",
    "original 必须是段落里的原句。改写维护我方，把对方风险写清楚。",
    "正文不要写条号。只有必须援引时才填 statute，格式为法规名加第X条。",
    `我方是${stance}。`,
    scaleLine,
    RED,
  ].join("\n");
}

async function draftClauses(clauses: Array<{ label: string; text: string }>, stance: string, scale: ContractScale) {
  const drafts: Draft[] = [];
  const pending = clauses.filter((clause) => {
    if (!isRenewal(clause.text)) return true;
    drafts.push(renewalDraft(clause.text, clause.label, stance, scale));
    return false;
  });
  const system = reviewPrompt(stance, scale);
  let modelDown = "";
  for (let index = 0; index < pending.length; index += 4) {
    const batch = pending.slice(index, index + 4);
    const user = batch.map((clause) => `${clause.label}\n${clause.text}`).join("\n\n");
    let written = await modelText(system, user, 2_200);
    if ("error" in written) written = await modelText(system, user, 2_200);
    if ("error" in written) {
      modelDown = written.error;
      continue;
    }
    for (const card of asCards(written.text)) {
      const home =
        batch.find(
          (clause) =>
            clause.label === card.position ||
            clause.text.includes(card.original) ||
            clause.text.replace(/\s+/g, "").includes(card.original.replace(/\s+/g, "").slice(0, 24)),
        ) ?? (batch.length === 1 ? batch[0] : undefined);
      if (!home || isRenewal(home.text)) continue;
      const original = home.text.includes(card.original) ? card.original : home.text.slice(0, 500);
      drafts.push({ ...card, position: home.label, original });
    }
  }
  if (drafts.length === 0 && modelDown) return { error: modelDown };
  return drafts;
}

function stripCites(text: string) {
  return text.replace(/《[^》]{2,40}》第[^条]{1,12}条/g, "").replace(/\s{2,}/g, " ").trim();
}

async function attachStatutes(cards: Draft[]) {
  const seen = new Map<string, string>();
  for (const card of cards) {
    card.comment = stripCites(card.comment);
    card.revision = stripCites(card.revision);
    if (!card.statute) continue;
    if (!seen.has(card.statute)) seen.set(card.statute, await verifyStatute(card.statute));
    const cite = seen.get(card.statute);
    if (cite && !card.comment.includes(cite)) card.comment = `${card.comment}${cite}`;
  }
}

function markScale(cards: Draft[], scale: ContractScale) {
  for (const card of cards) applyRedLine(card, scale);
}

function insertReview(input: {
  matterId: string;
  title: string;
  sourceName: string;
  stance: string;
  scale: ContractScale;
  cards: Draft[];
}) {
  const id = crypto.randomUUID();
  const redLines = input.cards.filter((card) => card.redLine).length;
  const body = `已审完，${input.cards.length} 条，红线 ${redLines} 条。`;
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO reviews (id, matter_id, kind, title, source_name, body, stance, scale, created_at)
       VALUES (?, ?, '合同审查', ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.matterId, input.title, input.sourceName, body, input.stance, input.scale, stamp());
    const insert = db.prepare(
      `INSERT INTO contract_review_cards (
        id, review_id, position_label, result_type, is_red_line, title, comment, original_text, revision, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.cards.forEach((card, index) => {
      insert.run(
        crypto.randomUUID(),
        id,
        card.position,
        card.result,
        card.redLine ? 1 : 0,
        card.title,
        card.comment,
        card.original,
        card.revision,
        index,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { id, count: input.cards.length, redLines };
}

export async function generateContractReview(
  matterId: string,
  input: { text?: string; materialId?: string; filename?: string; stance: string; scale: string },
): Promise<Failure | { id: string; count: number; redLines: number; text: string }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const stance = input.stance.trim();
  if (!stance) return { error: "还差审查立场。", status: 400 };
  if (!isContractScale(input.scale)) return { error: "还差审查尺度。", status: 400 };
  const loaded = await contractText(matterId, input);
  if ("error" in loaded) return loaded;
  const clauses = splitClauses(loaded.text);
  if (clauses.length === 0) return { error: "还差合同正文。", status: 400 };
  const drafted = await draftClauses(clauses, stance, input.scale);
  if ("error" in drafted) return { error: drafted.error, status: 502 };
  if (drafted.length === 0) return { error: "没有写出审查卡片。", status: 502 };
  await attachStatutes(drafted);
  markScale(drafted, input.scale);
  const saved = insertReview({
    matterId,
    title: (loaded.sourceName || "合同审查").slice(0, 120),
    sourceName: loaded.sourceName,
    stance,
    scale: input.scale,
    cards: drafted,
  });
  return { ...saved, text: contractStatus(matterId, saved.count, saved.redLines) };
}

async function contractText(
  matterId: string,
  input: { text?: string; materialId?: string; filename?: string },
): Promise<Failure | { text: string; sourceName: string }> {
  const pasted = (input.text ?? "").trim();
  if (pasted) return { text: pasted.slice(0, 20_000), sourceName: (input.filename ?? "").trim() };
  const materialId = (input.materialId ?? "").trim();
  const filename = (input.filename ?? "").trim();
  if (!materialId && !filename) return { error: "还差合同正文。", status: 400 };
  const row = database()
    .prepare(
      materialId
        ? `SELECT filename, text_status, usable_text FROM materials WHERE matter_id = ? AND id = ?`
        : `SELECT filename, text_status, usable_text FROM materials WHERE matter_id = ? AND filename LIKE ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(matterId, materialId || `%${filename}%`) as
    | { filename: string; text_status: string; usable_text: string }
    | undefined;
  if (!row) return { error: "没有这份材料。", status: 404 };
  if (row.text_status !== "可用文字" || !row.usable_text.trim()) return { error: "这份材料还不能用。", status: 400 };
  return { text: row.usable_text.trim().slice(0, 20_000), sourceName: row.filename };
}

function readCards(reviewId: string): ContractCard[] {
  const rows = database()
    .prepare(
      `SELECT id, position_label, result_type, is_red_line, title, comment, original_text, revision
       FROM contract_review_cards WHERE review_id = ? ORDER BY sort_order, rowid`,
    )
    .all(reviewId) as Array<{
    id: string;
    position_label: string;
    result_type: "修改" | "提示";
    is_red_line: number;
    title: string;
    comment: string;
    original_text: string;
    revision: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    position: row.position_label,
    result: row.result_type,
    redLine: row.is_red_line === 1,
    title: row.title,
    comment: row.comment,
    original: row.original_text,
    revision: row.revision,
  }));
}

export async function latestContractReview(matterId: string) {
  await connection();
  const row = database()
    .prepare(
      `SELECT id, title, source_name, stance, scale FROM reviews
       WHERE matter_id = ? AND kind = '合同审查' AND scale != ''
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(matterId) as
    | { id: string; title: string; source_name: string; stance: string; scale: ContractScale }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    sourceName: row.source_name,
    stance: row.stance,
    scale: row.scale,
    cards: readCards(row.id),
  };
}

export async function saveCardRevision(matterId: string, cardId: string, revision: string): Promise<Failure | { ok: true }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const row = database()
    .prepare(
      `SELECT cards.id FROM contract_review_cards cards
       JOIN reviews ON reviews.id = cards.review_id
       WHERE cards.id = ? AND reviews.matter_id = ?`,
    )
    .get(cardId, matterId) as { id: string } | undefined;
  if (!row) return { error: "没有这张卡片。", status: 404 };
  database().prepare("UPDATE contract_review_cards SET revision = ? WHERE id = ?").run(revision.slice(0, 2_000), cardId);
  return { ok: true };
}

const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function clauseNumber(text: string) {
  const digit = text.match(/第\s*(\d+)\s*条/);
  if (digit) {
    const value = Number(digit[1]);
    const spoken = value <= 10 ? CN[value] : value < 20 ? `十${CN[value - 10] || ""}` : `${CN[Math.floor(value / 10)]}十${value % 10 ? CN[value % 10] : ""}`;
    return [`第${value}条`, `第${spoken}条`];
  }
  const spoken = text.match(/第\s*([一二三四五六七八九十]+)\s*条/);
  return spoken ? [`第${spoken[1]}条`] : [];
}

export function isContractRevise(text: string) {
  return /续期|第\s*[0-9一二三四五六七八九十]+\s*条/.test(text) && /再强|再弱|强一点|弱一点|按强势|按弱势|按均势|改成强势|改成弱势|改成均势/.test(text);
}

function reviseScale(text: string, current: string): ContractScale {
  if (/弱势|再弱|弱一点/.test(text)) return "弱势";
  if (/均势/.test(text)) return "均势";
  if (/强势|再强|强一点/.test(text)) return "强势";
  return isContractScale(current) ? current : "均势";
}

export async function reviseContractCards(matterId: string, asked: string): Promise<Failure | { text: string }> {
  await connection();
  const gate = matterGate(matterId);
  if (gate) return gate;
  const review = await latestContractReview(matterId);
  if (!review || review.cards.length === 0) return { error: "还没有合同审查结果。", status: 400 };
  const names = clauseNumber(asked);
  let picked = review.cards.filter((card) => {
    const byNumber = names.length === 0 || names.some((name) => card.position.includes(name));
    const byRenewal = !/续期/.test(asked) || /续期/.test(`${card.title}${card.original}${card.comment}`);
    return byNumber && byRenewal;
  });
  if (picked.length === 0 && names.length > 0) {
    picked = review.cards.filter((card) => names.some((name) => card.position.includes(name)));
  }
  if (picked.length === 0) return { error: "这次审查里没有这一条。", status: 400 };
  const scale = reviseScale(asked, review.scale);
  const rewritten = await draftClauses(
    picked.map((card) => ({ label: card.position, text: card.original })),
    review.stance || "我方",
    scale,
  );
  if ("error" in rewritten) return { error: rewritten.error, status: 502 };
  if (rewritten.length === 0) return { error: "没有写出审查卡片。", status: 502 };
  await attachStatutes(rewritten);
  markScale(rewritten, scale);
  const count = Math.min(picked.length, rewritten.length);
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    picked.slice(0, count).forEach((card, index) => {
      const next = rewritten[index];
      db.prepare(
        `UPDATE contract_review_cards
         SET title = ?, result_type = ?, is_red_line = ?, comment = ?, original_text = ?, revision = ?
         WHERE id = ?`,
      ).run(next.title, next.result, next.redLine ? 1 : 0, next.comment, next.original || card.original, next.revision, card.id);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { text: `已改 ${count} 条。\n${pageLink(matterId)}` };
}
