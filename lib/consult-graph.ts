import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { AlphaError, searchCaseRecords, searchLaws } from "@/lib/alpha-search";
import { feeReport, quoteFee } from "@/lib/legal-amount";
import { modelText } from "@/lib/model";
import { getArticle, PkulawError } from "@/lib/pkulaw";

type LawHit = { id: string; title: string; text: string };
type CaseHit = { id: string; title: string; text: string; detail: string };

const CALL_CAP = 40;

const State = Annotation.Root({
  asked: Annotation<string>,
  domain: Annotation<string>,
  needCases: Annotation<boolean>,
  calc: Annotation<string>,
  laws: Annotation<LawHit[]>({ reducer: (_left, right) => right, default: () => [] }),
  cases: Annotation<CaseHit[]>({ reducer: (_left, right) => right, default: () => [] }),
  queries: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  exact: Annotation<Array<{ law: string; article: string }>>({ reducer: (_left, right) => right, default: () => [] }),
  gap: Annotation<string>,
  answer: Annotation<string>,
  calls: Annotation<number>,
  retry: Annotation<number>,
  again: Annotation<boolean>,
  stop: Annotation<string>,
});

type Graph = typeof State.State;

function skillText() {
  try {
    return readFileSync(join(process.cwd(), "alpha-records", "完整测试", "咨询-技能文件.md"), "utf8");
  } catch {
    return "";
  }
}

function sliceBetween(text: string, start: string, end: string, max: number) {
  const at = text.indexOf(start);
  if (at < 0) return "";
  const stop = text.indexOf(end, at + start.length);
  return text.slice(at, stop > at ? stop : at + max).slice(0, max);
}

const DOMAIN_FILE: Record<string, string> = {
  criminal: "刑事.md",
  ip: "知产.md",
  corporate: "公司法.md",
  construction: "建设工程.md",
  debt: "债权债务.md",
};

function domainSlice(text: string, domain: string) {
  const file = DOMAIN_FILE[domain];
  if (file) {
    try {
      return readFileSync(join(process.cwd(), "consult-guides", file), "utf8").slice(0, 1_800);
    } catch {
      return "";
    }
  }
  const heading =
    domain === "labor" ? "# 劳动争议专项" : domain === "family" ? "# 婚姻家事专项" : domain === "calculator" ? "金额计算专项" : "";
  if (!heading) return "";
  const at = text.indexOf(heading);
  return at < 0 ? "" : text.slice(at, at + 1_800);
}

function windowYears() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 5);
  const iso = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  return { start: iso(start), end: iso(end) };
}

function jsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function feeAsk(text: string) {
  const quoted = quoteFee(text);
  if (!quoted) return "";
  if ("error" in quoted) return quoted.error;
  return ["calculate_legal_amount", `calculation_type=${quoted.calculationType}`, `amount=${quoted.amount}`, `result=${quoted.result}`, ...quoted.steps, quoted.warning, "REPORT", feeReport(quoted)]
    .filter(Boolean)
    .join("\n");
}

function bump(state: Graph, count: number) {
  return Math.min(CALL_CAP, state.calls + count);
}

async function routeNode(state: Graph): Promise<Partial<Graph>> {
  const preset = feeAsk(state.asked);
  if (preset.startsWith("缺少") || preset.startsWith("这个计算")) return { stop: preset };
  if (preset) {
    const query = /保全/.test(state.asked)
      ? "申请保全措施交纳费用标准"
      : /执行费|申请执行/.test(state.asked)
        ? "申请执行交纳费用标准"
        : /迟延履行/.test(state.asked)
          ? "迟延履行期间债务利息加倍部分"
          : /经济补偿|代通知金|违法解除|2N/.test(state.asked)
            ? "劳动合同经济补偿和代通知金"
            : "财产案件受理费分段标准";
    return { calc: preset, domain: "calculator", needCases: false, queries: [query], calls: bump(state, 1) };
  }
  const routed = await modelText(
    [
      "判断这句法律咨询。只返回 JSON。",
      '{"domain":"labor|criminal|ip|family|corporate|construction|debt|","needCases":false,"queries":["法规检索句"],"exact":[{"law":"","article":""}],"stop":""}',
      "信息够或只少一两项：stop 为空，queries 最多 3 条。",
      "严重不足、无法判断请求权：stop 写最多两个问题，queries 为空。",
      "只要结论或规则、不要一批案例时 needCases 为 false。有裁判分歧或需要类案才为 true。",
      "不要安排金额心算。",
    ].join("\n"),
    state.asked,
    700,
  );
  if ("error" in routed) return { stop: routed.error };
  const parsed = jsonObject(routed.text);
  const domain = typeof parsed?.domain === "string" ? parsed.domain : "";
  const queries = Array.isArray(parsed?.queries) ? parsed.queries.filter((item): item is string => typeof item === "string" && item.trim()).slice(0, 3) : [];
  const exact = Array.isArray(parsed?.exact)
    ? parsed.exact
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as { law?: unknown; article?: unknown };
          if (typeof row.law !== "string" || typeof row.article !== "string" || !row.law.trim() || !row.article.trim()) return null;
          return { law: row.law.trim(), article: row.article.trim() };
        })
        .filter((item): item is { law: string; article: string } => Boolean(item))
        .slice(0, 4)
    : [];
  return {
    domain,
    needCases: parsed?.needCases === true,
    queries: queries.length > 0 ? queries : [state.asked.slice(0, 80)],
    exact,
    stop: typeof parsed?.stop === "string" ? parsed.stop.trim() : "",
    calls: bump(state, 1),
  };
}

async function searchNode(state: Graph): Promise<Partial<Graph>> {
  if (state.calls >= CALL_CAP) return { again: false };
  const laws = [...state.laws];
  let calls = state.calls;
  for (const item of state.exact) {
    if (calls >= CALL_CAP || laws.length >= 6) break;
    calls += 1;
    try {
      const hit = await getArticle(item.law, item.article);
      if (!hit) continue;
      const title = hit.title || `${item.law} ${item.article}`;
      if (laws.some((law) => law.title === title)) continue;
      laws.push({ id: `law:${laws.length + 1}`, title, text: hit.text.slice(0, 1_200) });
    } catch (error) {
      if (!(error instanceof PkulawError)) throw error;
    }
  }
  const query = [state.gap, ...state.queries].filter(Boolean).join(" ").slice(0, 180);
  if (query && calls < CALL_CAP) {
    calls += 1;
    try {
      const found = await searchLaws(query, 4);
      for (const hit of found) {
        if (laws.length >= 8 || laws.some((law) => law.title === hit.title)) continue;
        laws.push({ id: `law:${laws.length + 1}`, title: hit.title, text: hit.text.slice(0, 1_200) });
      }
    } catch (error) {
      if (!(error instanceof AlphaError)) throw error;
    }
  }
  return { laws: laws.map((law, index) => ({ ...law, id: `law:${index + 1}` })), calls, again: false };
}

async function caseNode(state: Graph): Promise<Partial<Graph>> {
  if (!state.needCases || state.calls >= CALL_CAP) return {};
  const span = windowYears();
  try {
    const found = await searchCaseRecords({
      fullText: (state.queries[0] || state.asked).slice(0, 50),
      judgementDate: `${span.start}TO${span.end}`,
      pageSize: 6,
    });
    const cases = found.map((hit, index) => ({
      id: `case:${index + 1}`,
      title: `${hit.caseNumber} ${hit.title}`,
      text: hit.snippet,
      detail: `${hit.court} ${hit.date} ${span.start}至${span.end}`,
    }));
    return { cases, calls: bump(state, 1) };
  } catch (error) {
    if (error instanceof AlphaError) return { calls: bump(state, 1) };
    throw error;
  }
}

function calcAnswer(calc: string) {
  const at = calc.lastIndexOf("\nREPORT\n");
  return at >= 0 ? calc.slice(at + "\nREPORT\n".length).trim() : "";
}

async function writeNode(state: Graph): Promise<Partial<Graph>> {
  if (state.calc.includes("result=")) {
    const ready = calcAnswer(state.calc);
    if (ready) return { answer: ready, calls: bump(state, 1) };
  }
  const file = skillText();
  const main = sliceBetween(file, "# 法律咨询（律师版 v7.1.3）", "## /skills/law-consult/references", 4_500);
  const extra = domainSlice(file, state.calc ? "calculator" : state.domain);
  const laws = state.laws.map((hit) => `${hit.id} ${hit.title}\n${hit.text}`).join("\n\n");
  const cases = state.cases.map((hit) => `${hit.id} ${hit.title}\n${hit.text}`).join("\n\n");
  const written = await modelText(
    [
      "按法律咨询技能回答。只返回正文。",
      "决定性结论写成《法规完整名称》第X条，版本后缀留在书名号里。名称必须来自本轮法条标题。",
      "句末只用本轮的 [law:n]、[case:n]。不得编造条号、案号和金额。",
      "单点问题写短。信息有缺口时先答，末尾写出缺口。",
      "有计算工具结果时，金额只写工具给出的 result，并写出 steps。命中了条文时，写成《法规完整名称》第X条，名称用本轮标题原样。",
      "结论放在最前。单点问题写短。不要自己再写「法条摘录」或「案例」两节。",
      main,
      extra,
      state.domain ? `本轮领域：${state.domain}。` : "",
    ].join("\n"),
    [
      state.asked,
      state.calc ? `计算工具结果：\n${state.calc}` : "",
      laws ? `本轮法条：\n${laws}` : "本轮没有法条。不要写具体条号。",
      cases ? `本轮案例（裁判日期窗口已由程序限定为近五年）：\n${cases}` : "",
      state.gap ? `上一轮对不上的引用：${state.gap}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    2_200,
  );
  if ("error" in written) return { answer: written.error };
  return { answer: written.text.trim(), calls: bump(state, 1) };
}

function checkNode(state: Graph): Partial<Graph> {
  const marks = [...state.answer.matchAll(/\[(law|case):(\d+)\]/g)];
  const missed: string[] = [];
  for (const mark of marks) {
    const id = `${mark[1]}:${mark[2]}`;
    const pool = mark[1] === "law" ? state.laws : state.cases;
    if (!pool.some((item) => item.id === id)) missed.push(id);
  }
  for (const match of state.answer.matchAll(/《([^》]{2,80})》第([^条]{1,12})条/g)) {
    const hay = state.laws.map((item) => item.title + item.text).join("\n");
    if (!hay.includes(match[1]) || !hay.includes(`第${match[2]}条`)) missed.push(match[0]);
  }
  const amount = state.calc.match(/result=(\d+(?:\.\d+)?)/)?.[1];
  if (amount) {
    const grouped = Number(amount).toLocaleString("en-US");
    if (!state.answer.includes(amount) && !state.answer.includes(grouped)) missed.push("金额不是计算工具的结果");
  }
  if (missed.length === 0 || state.retry >= 1) return { again: false, gap: missed.join(" ") };
  return { again: true, retry: state.retry + 1, gap: missed.join(" ") };
}

function afterRoute(state: Graph) {
  return state.stop ? END : "search";
}

function afterSearch(state: Graph) {
  return state.needCases ? "caseSearch" : "write";
}

function afterCheck(state: Graph) {
  return state.again ? "search" : END;
}

const graph = new StateGraph(State)
  .addNode("route", routeNode)
  .addNode("search", searchNode)
  .addNode("caseSearch", caseNode)
  .addNode("write", writeNode)
  .addNode("check", checkNode)
  .addEdge(START, "route")
  .addConditionalEdges("route", afterRoute)
  .addConditionalEdges("search", afterSearch)
  .addEdge("caseSearch", "write")
  .addEdge("write", "check")
  .addConditionalEdges("check", afterCheck)
  .compile();

function sourceTail(laws: Array<{ id: string; title: string; text: string }>, cases: Array<{ id: string; title: string }>) {
  const lawBlock =
    laws.length === 0
      ? ""
      : ["## 法条摘录", ...laws.map((law) => `### ${law.id.replace("law:", "")}. ${law.title}\n\n${law.text.slice(0, 280)}`)].join("\n\n");
  const caseBlock =
    cases.length === 0
      ? ""
      : ["## 案例", ...cases.map((item) => `- ${item.id.replace("case:", "")}. ${item.title}`)].join("\n");
  return [lawBlock, caseBlock].filter(Boolean).join("\n\n");
}

export async function runConsult(asked: string) {
  const result = await graph.invoke({
    asked,
    domain: "",
    needCases: false,
    calc: "",
    laws: [],
    cases: [],
    queries: [],
    exact: [],
    gap: "",
    answer: "",
    calls: 0,
    retry: 0,
    again: false,
    stop: "",
  });
  const raw = (result.stop || result.answer).replace(/<!--\s*recommended_questions:start[\s\S]*?recommended_questions:end\s*-->/g, "");
  const cut = raw.search(/\n## (法条摘录|案例)/);
  const text = (cut >= 0 ? raw.slice(0, cut) : raw).trim();
  if (!text) return { text: "没有答上。" };
  if (result.stop) return { text };
  const tail = sourceTail(result.laws, result.cases);
  return { text: tail ? `${text}\n\n${tail}` : text };
}
