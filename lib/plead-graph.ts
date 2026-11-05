import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { database } from "@/lib/db";
import { modelText } from "@/lib/model";
import {
  emptySlots,
  isPleadKind,
  latestPleading,
  missingSlots,
  pleadKindFrom,
  savePleading,
  type PleadKind,
  type PleadSlots,
} from "@/lib/pleadings";
import { caseNumberKey, findCase, getArticle, PkulawError } from "@/lib/pkulaw";
import { searchRetrieval } from "@/lib/retrieval";

type Hit = { kind: "law" | "case"; title: string; text: string };

type Citation =
  | { kind: "law"; raw: string; law: string; article: string }
  | { kind: "case"; raw: string; caseNumber: string };

const LAW_RE =
  /《([^》\n]{1,80})》第([0-9０-９一二三四五六七八九十百零千]{1,12})条(?:之([0-9０-９一二三四五六七八九十]{1,4}))?/g;
const CASE_RE = /[（(]\d{4}[）)][^\s，。；、]{1,30}号/g;

const GraphState = Annotation.Root({
  matterId: Annotation<string>,
  kind: Annotation<string>,
  asked: Annotation<string>,
  materialText: Annotation<string>,
  slots: Annotation<Record<string, string>>,
  missing: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  hits: Annotation<Hit[]>({ reducer: (_left, right) => right, default: () => [] }),
  body: Annotation<string>,
  warnings: Annotation<string>,
  gap: Annotation<string>,
  retry: Annotation<number>,
  allowRetry: Annotation<boolean>,
  again: Annotation<boolean>,
  passage: Annotation<string>,
  instruction: Annotation<string>,
  skipFill: Annotation<boolean>,
});

type Graph = typeof GraphState.State;

function compact(value: string) {
  return value.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")");
}

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

function covered(citation: Citation, hits: Hit[], source: string) {
  const hay = compact(`${hits.map((hit) => `${hit.title}\n${hit.text}`).join("\n")}\n${source}`);
  if (!hay) return false;
  if (citation.kind === "law") return hay.includes(compact(citation.law)) && hay.includes(compact(citation.article));
  return hay.includes(compact(citation.caseNumber)) || hay.includes(caseNumberKey(citation.caseNumber));
}

async function confirmed(citation: Citation) {
  try {
    if (citation.kind === "law") {
      const hit = await getArticle(citation.law, citation.article);
      if (!hit) return false;
      const hay = compact(`${hit.title}\n${hit.text}`);
      return hay.includes(compact(citation.law)) && hay.includes(compact(citation.article));
    }
    const hit = await findCase(citation.caseNumber);
    if (!hit) return false;
    return caseNumberKey(hit.caseNumber) === caseNumberKey(citation.caseNumber);
  } catch (error) {
    if (error instanceof PkulawError) return false;
    return false;
  }
}

function jsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function labeledSlots(kind: PleadKind, asked: string, prior: PleadSlots) {
  const slots = { ...emptySlots(kind), ...prior };
  for (const field of Object.keys(slots)) {
    const match = asked.match(new RegExp(`${field}[：:]\\s*([^\\n]+)`));
    if (match?.[1]?.trim()) slots[field] = match[1].trim();
  }
  return slots;
}

async function fillNode(state: Graph): Promise<Partial<Graph>> {
  const kind = state.kind as PleadKind;
  let slots = labeledSlots(kind, state.asked, state.slots);
  const still = missingSlots(kind, slots);
  const bare = state.asked.replace(/请|帮我|写一份|写|民事起诉状|民事上诉状|起诉状|上诉状/g, "").trim();
  if (still.length > 0 && bare.length >= 8) {
    const asked = await modelText(
      [
        `从律师原话里抽出${kind}的槽位。`,
        `只填这些键：${Object.keys(slots).join("、")}。`,
        "原话里没有的键返回空字符串。不要编造案情、人名、金额。",
        "只返回 JSON。",
      ].join("\n"),
      state.asked,
      800,
    );
    if (!("error" in asked)) {
      const parsed = jsonObject(asked.text);
      if (parsed) {
        for (const field of Object.keys(slots)) {
          const value = parsed[field];
          if (typeof value === "string" && value.trim() && !slots[field]?.trim()) slots[field] = value.trim();
        }
      }
    }
  }
  return { slots, missing: missingSlots(kind, slots) };
}

function searchQuery(state: Graph) {
  const matter = database().prepare("SELECT cause FROM matters WHERE id = ?").get(state.matterId) as
    | { cause: string }
    | undefined;
  const facts = [state.slots.案情概要, state.slots.上诉理由, state.slots.答辩意见, state.slots.争议焦点, state.slots.起草要求]
    .filter(Boolean)
    .join("。");
  const sentences = facts
    .split(/[。；\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8 && item.length <= 80);
  const focused = sentences.filter((item) =>
    /合同|借款|股权|劳动|侵权|违约|赔偿|解除|利息|质量|租赁|运输|决议|保证|票据|保险/.test(item),
  );
  const picked = (focused.length > 0 ? focused : sentences).slice(0, 2).join("。");
  return [matter?.cause?.trim(), picked, state.gap].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 180);
}

async function searchNode(state: Graph): Promise<Partial<Graph>> {
  const query = searchQuery(state);
  const found = await searchRetrieval(query || state.asked, state.matterId);
  if ("error" in found) return { gap: found.error, hits: state.hits };
  const hits = [...state.hits];
  for (const item of found.items) {
    if (hits.some((hit) => hit.title === item.title)) continue;
    hits.push({ kind: item.kind, title: item.title, text: item.text.slice(0, 1_500) });
  }
  return { hits: hits.slice(0, 8), again: false };
}

function writingGuide(kind: PleadKind) {
  return readFileSync(join(process.cwd(), "plead-guides", `${kind}.md`), "utf8");
}

function trimLawList(body: string) {
  const at = body.search(/\n附[：:]/);
  if (at < 0) return body.trim();
  const extra = body.slice(at);
  if (/《|法条|案例|第.{1,8}条/.test(extra)) return body.slice(0, at).trim();
  return body.trim();
}

function closingSentence(body: string, kind: PleadKind) {
  if (kind === "民事起诉状" && !body.includes("为维护原告合法权益")) {
    return body.replace(/\n此致/, "\n为维护原告合法权益，特向贵院提起诉讼，望判如所请。\n\n此致");
  }
  if (kind === "民事上诉状" && !body.includes("恳请撤销原判")) {
    return body.replace(/\n此致/, "\n综上所述，一审判决认定事实和适用法律有误，恳请撤销原判，依法改判。\n\n此致");
  }
  if (kind === "答辩状" && !body.includes("驳回原告")) {
    return body.replace(/\n此致/, "\n综上所述，请依法驳回原告的诉讼请求。\n\n此致");
  }
  if (kind === "代理词" && !body.includes("请法庭予以考虑")) {
    const dated = body.trimEnd();
    return dated.includes("以上代理意见") ? dated : `${dated}\n\n以上代理意见，请法庭予以考虑。`;
  }
  return body;
}

function unsignedDate(body: string) {
  return body.replace(/(具状人|上诉人|答辩人|代理人)[：:][^\n]*\n+\d{4}年\d{1,2}月\d{1,2}日/g, (chunk) =>
    chunk.replace(/\d{4}年\d{1,2}月\d{1,2}日/, "XXXX年XX月XX日"),
  );
}

function keepKnownEvidence(body: string, names: string[]) {
  const stems = names.map((name) => name.replace(/\.[^.]+$/, "")).filter((name) => name.length >= 2);
  if (stems.length === 0) return body;
  const at = body.indexOf("证据和证据来源");
  if (at < 0) return body;
  const after = body.slice(at);
  const end = after.search(/\n(?:为维护|综上所述|此致)/);
  const block = end > 0 ? after.slice(0, end) : after;
  const rest = end > 0 ? after.slice(end).trim() : "";
  const kept = block
    .split(/\n/)
    .filter((line) => !/^\s*\d+[.、]/.test(line) || stems.some((name) => line.includes(name)));
  return `${body.slice(0, at)}${kept.join("\n").trim()}\n\n${rest}`.trim();
}

const WRITE_GUARDS = [
  "下面四条必须遵守。起草要求里写了「不要新增请求、不要编造金额和案号」时同样遵守。",
  "事实里没有的费用和职务不要写进请求或当事人。事实没有「取回费用」就不要写。事实没有「执行董事」「总经理」就不要写。",
  "天数不要按每月 30 天算。",
  "事实里已经写明的条款，不要写成「材料中未见约定」。",
  "证据只写已经给出的材料文件名。没有单独文件的，不要另编证据名称。",
  "不要在同一份文书里既要求重算一个金额，又写不要算出一个新数额。",
].join("\n");

async function writeNode(state: Graph): Promise<Partial<Graph>> {
  const hits = state.hits
    .map((hit, index) => `${index + 1}. ${hit.kind === "law" ? "法条" : "案例"} ${hit.title}\n${hit.text}`)
    .join("\n\n");
  const revising = Boolean(state.passage.trim());
  const system = [
    revising
      ? `修改这份${state.kind}。只改律师点名的那一段，其余句子原样保留。改完仍从标题写到日期。`
      : `写一份${state.kind}。从标题写到日期。`,
    "只返回正文。",
    "按下面保存的写作要求写。",
    writingGuide(state.kind),
    WRITE_GUARDS,
    "起草要求里的限制原样遵守。",
    "人名、日期、金额、案号只用槽位和材料事实里有的。",
    "法条和案号只用下面命中的原文，或材料原文里已经写明的。没有就不要写具体条号和案号。",
    "正文在日期处结束。不要在日期后再附证据清单或法条清单。",
  ].join("\n");
  const files = database()
    .prepare("SELECT filename FROM materials WHERE matter_id = ? AND text_status = '可用文字' ORDER BY created_at, rowid")
    .all(state.matterId) as Array<{ filename: string }>;
  const names = files.map((file) => file.filename);
  const user = [
    `种类：${state.kind}`,
    ...Object.entries(state.slots).map(([field, value]) => `${field}：${value}`),
    state.materialText ? `材料事实：\n${state.materialText.slice(0, 8_000)}` : "",
    names.length > 0 ? `可用材料文件名：${names.join("、")}。证据只许使用这些文件名。` : "没有可用材料文件。证据部分写「请律师填写」。",
    hits ? `这次命中的原文：\n${hits}` : "这次没有命中法条或案例。正文不要写具体条号和案号。",
    revising ? `原稿：\n${state.body}` : "",
    revising ? `要改的原段：${state.passage}` : "",
    revising ? `怎么改：${state.instruction || state.asked}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const written = await modelText(system, user, 4_000);
  if ("error" in written) return { body: state.body, warnings: written.error };
  return { body: closingSentence(unsignedDate(keepKnownEvidence(trimLawList(written.text), names)), state.kind), warnings: "" };
}

function bareConclusions(body: string) {
  const weak = body
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(
      (item) =>
        item.length >= 80 &&
        /应当|无权|构成违约|承担赔偿责任|合同解除|有权/.test(item) &&
        !/《[^》\n]{1,80}》第[^条\n]{1,12}条/.test(item),
    );
  return weak.length > 0 ? "有法律结论的段落没有写上核对过的法条。" : "";
}

async function checkNode(state: Graph): Promise<Partial<Graph>> {
  const seen = new Set<string>();
  const pending = citationsIn(state.body).filter((citation) => {
    if (seen.has(citation.raw)) return false;
    seen.add(citation.raw);
    return true;
  });
  const missed: string[] = [];
  const source = `${Object.values(state.slots).join("\n")}\n${state.materialText}`;
  for (const citation of pending) {
    if (covered(citation, state.hits, source)) continue;
    const found = await confirmed(citation);
    if (!found) missed.push(citation.raw);
  }
  const bare = state.hits.some((hit) => hit.kind === "law") ? bareConclusions(state.body) : "";
  if (missed.length === 0) return { warnings: bare, again: false, gap: "" };
  if (state.allowRetry && state.retry < 1) {
    return { again: true, retry: state.retry + 1, gap: missed.join(" "), warnings: "" };
  }
  const invented = missed.map((item) => `${item}（疑似编造）`).join("\n");
  return { again: false, warnings: [invented, bare].filter(Boolean).join("\n") };
}

function routeStart(state: Graph) {
  if (state.passage.trim()) return "write";
  if (state.skipFill) return "search";
  return "fill";
}

function routeFill(state: Graph) {
  return state.missing.length > 0 ? END : "search";
}

function routeCheck(state: Graph) {
  return state.again ? "search" : END;
}

const pleadGraph = new StateGraph(GraphState)
  .addNode("fill", fillNode)
  .addNode("search", searchNode)
  .addNode("write", writeNode)
  .addNode("check", checkNode)
  .addConditionalEdges(START, routeStart)
  .addConditionalEdges("fill", routeFill)
  .addEdge("search", "write")
  .addEdge("write", "check")
  .addConditionalEdges("check", routeCheck)
  .compile();

function pageLink(matterId: string) {
  return `[文书起草](/matters/${matterId}/plead)`;
}

function shortName(kind: PleadKind) {
  if (kind === "民事起诉状") return "起诉状";
  if (kind === "民事上诉状") return "上诉状";
  return kind;
}

const FROM_CASE = /根据案情|按案情|依照案情|根据本案|按本案|用本案|根据现有|按现有|根据材料|按材料|根据案子/;

function caseStory(matterId: string) {
  const matter = database()
    .prepare("SELECT cause, facts, mandate FROM matters WHERE id = ?")
    .get(matterId) as { cause: string; facts: string; mandate: string } | undefined;
  if (!matter) return { text: "", client: "" };
  const parties = database()
    .prepare("SELECT role, name, position FROM parties WHERE matter_id = ? ORDER BY rowid")
    .all(matterId) as Array<{ role: string; name: string; position: string }>;
  const notes = database()
    .prepare("SELECT body FROM notes WHERE matter_id = ? AND kind = '基本事实' ORDER BY created_at, rowid")
    .all(matterId) as Array<{ body: string }>;
  const nodes = database()
    .prepare("SELECT happened_on, title, detail FROM nodes WHERE matter_id = ? ORDER BY happened_on, created_at, rowid")
    .all(matterId) as Array<{ happened_on: string; title: string; detail: string }>;
  const materials = database()
    .prepare(
      "SELECT filename, usable_text FROM materials WHERE matter_id = ? AND text_status = '可用文字' ORDER BY created_at, rowid",
    )
    .all(matterId) as Array<{ filename: string; usable_text: string }>;
  const roleName = { client: "客户", opposing: "对方", organ: "办案机关" } as const;
  const lines: string[] = [];
  if (matter.cause.trim()) lines.push(`案由：${matter.cause.trim()}`);
  if (matter.facts.trim()) lines.push(`基本事实：${matter.facts.trim()}`);
  if (matter.mandate.trim()) lines.push(`委托事项：${matter.mandate.trim()}`);
  const people = parties
    .filter((party) => party.name.trim())
    .map((party) => {
      const role = roleName[party.role as keyof typeof roleName] ?? party.role;
      return `${role} ${party.name.trim()}${party.position.trim() ? `，${party.position.trim()}` : ""}`;
    });
  if (people.length > 0) lines.push(`当事人：${people.join("；")}`);
  for (const note of notes) {
    if (note.body.trim()) lines.push(`已记事实：${note.body.trim()}`);
  }
  if (nodes.length > 0) {
    lines.push(
      `经过：${nodes
        .map((node) => `${node.happened_on} ${node.title}${node.detail.trim() ? ` ${node.detail.trim()}` : ""}`)
        .join("；")}`,
    );
  }
  let room = 6_000;
  for (const material of materials) {
    const text = material.usable_text.trim();
    if (!text || room <= 0) continue;
    const slice = text.slice(0, room);
    lines.push(`材料 ${material.filename}：${slice}`);
    room -= slice.length;
  }
  const client = parties.find((party) => party.role === "client" && party.name.trim())?.name.trim() ?? "";
  return { text: lines.join("\n").slice(0, 8_000), client };
}

function materialFor(matterId: string, asked: string, materialId = "") {
  const rows = database()
    .prepare("SELECT id, filename, text_status, usable_text FROM materials WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ id: string; filename: string; text_status: string; usable_text: string }>;
  const named = materialId
    ? rows.find((row) => row.id === materialId)
    : rows.find((row) => asked.includes(row.filename) || asked.includes(row.filename.replace(/\.[^.]+$/, "")));
  if (!named) return { text: "" };
  if (named.text_status !== "可用文字" || !named.usable_text.trim()) return { error: "这份材料还不能用。" };
  return { text: named.usable_text.trim().slice(0, 8_000) };
}

export async function runPlead(
  matterId: string,
  input: { asked?: string; kind?: string; slots?: PleadSlots; materialId?: string },
): Promise<{ error: string } | { text: string }> {
  const asked = input.asked?.trim() ?? "";
  const labeled = asked.match(/把(.{4,120}?)(?:改成|改为)\s*([^\n]+)/);
  const quoted = asked.match(/[「“"]([^」”"]{4,120})[」”"]/);
  const how = asked.match(/(?:改成|改为|收成)\s*([^\n]+)/);
  const revise = labeled
    ? { passage: labeled[1], instruction: labeled[2].trim() }
    : quoted && how
      ? { passage: quoted[1], instruction: how[1].trim() }
      : null;
  let kind = (input.kind && isPleadKind(input.kind) ? input.kind : pleadKindFrom(asked)) || "";
  if (!kind && revise) {
    const found = database()
      .prepare(
        "SELECT kind FROM pleadings WHERE matter_id = ? AND status = '已成文' AND instr(body, ?) > 0 ORDER BY version DESC, rowid DESC LIMIT 1",
      )
      .get(matterId, revise.passage) as { kind: string } | undefined;
    if (found && isPleadKind(found.kind)) kind = found.kind;
  }
  if (!kind) {
    const open = database()
      .prepare(
        "SELECT kind FROM pleadings WHERE matter_id = ? AND status = '缺槽位' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(matterId) as { kind: string } | undefined;
    if (open && isPleadKind(open.kind)) kind = open.kind;
  }
  if (!kind) return { text: "请说明是民事起诉状、民事上诉状、答辩状还是代理词。" };
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。" };
  if (matter.status === "已归档") return { error: "归档后只供查阅。" };
  const material = materialFor(matterId, asked, input.materialId);
  if ("error" in material) return { text: material.error };

  const current = await latestPleading(matterId, kind);
  if (revise) {
    if (!current?.body.includes(revise.passage)) return { text: "稿子里没有这一段。" };
    const result = await pleadGraph.invoke({
      matterId,
      kind,
      asked,
      materialText: material.text,
      slots: current.slots,
      missing: [],
      hits: [],
      body: current.body,
      warnings: "",
      gap: "",
      retry: 1,
      allowRetry: false,
      again: false,
      passage: revise.passage,
      instruction: revise.instruction,
      skipFill: true,
    });
    if (!result.body.trim()) return { text: result.warnings || "没有改出来。" };
    const saved = await savePleading(matterId, {
      kind,
      slots: result.slots,
      body: result.body,
      warnings: result.warnings,
      status: "已成文",
      fresh: true,
    });
    if ("error" in saved) return { error: saved.error };
    return { text: `${shortName(kind)}已改了一段。\n${pageLink(matterId)}` };
  }

  const prior = current?.status === "缺槽位" ? current.slots : {};
  const given = { ...emptySlots(kind), ...prior, ...(input.slots ?? {}) };
  if (FROM_CASE.test(asked)) {
    const story = caseStory(matterId);
    if (kind === "民事起诉状" && !given.案情概要?.trim() && story.text) given.案情概要 = story.text;
    if (kind === "民事上诉状" && !given.上诉人?.trim() && story.client) given.上诉人 = story.client;
    if (kind === "答辩状" && !given.答辩意见?.trim() && story.text) given.答辩意见 = story.text;
    if (!given.起草要求?.trim() && (story.text || story.client)) {
      given.起草要求 = "根据本案已有事实起草。不要编造没有的人名、日期和金额。";
    }
  }
  if (kind === "民事起诉状" && !given.案情概要?.trim() && material.text) {
    given.案情概要 = material.text.slice(0, 4_000);
  }
  if (kind === "答辩状" && !given.答辩意见?.trim() && material.text) {
    given.答辩意见 = material.text.slice(0, 4_000);
  }
  if (!given.起草要求?.trim() && material.text) {
    given.起草要求 = "根据指定材料起草。不要编造材料里没有的人名、日期和金额。";
  }
  const preset = missingSlots(kind, given);
  if (input.slots && preset.length > 0) {
    await savePleading(matterId, { kind, slots: given, status: "缺槽位" });
    return { text: `${shortName(kind)}还差${preset.join("、")}。\n${pageLink(matterId)}` };
  }

  const result = await pleadGraph.invoke({
    matterId,
    kind,
    asked,
    materialText: material.text,
    slots: given,
    missing: [],
    hits: [],
    body: "",
    warnings: "",
    gap: "",
    retry: 0,
    allowRetry: true,
    again: false,
    passage: "",
    instruction: "",
    skipFill: Boolean(input.slots),
  });
  if (result.missing.length > 0) {
    await savePleading(matterId, { kind, slots: result.slots, status: "缺槽位" });
    return { text: `${shortName(kind)}还差${result.missing.join("、")}。\n${pageLink(matterId)}` };
  }
  if (!result.body.trim()) return { text: result.warnings || "没有写出来。" };
  const saved = await savePleading(matterId, {
    kind,
    slots: result.slots,
    body: result.body,
    warnings: result.warnings,
    status: "已成文",
  });
  if ("error" in saved) return { error: saved.error };
  return { text: `${shortName(kind)}已写上。\n${pageLink(matterId)}` };
}
