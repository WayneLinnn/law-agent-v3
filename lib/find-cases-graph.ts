import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { AlphaError, caseHolding, searchCaseRecords, searchCases } from "@/lib/alpha-search";
import { caseDimensions } from "@/lib/case-filters";
import { modelText } from "@/lib/model";

type Hit = { caseNumber: string; title: string; court: string; date: string; text: string };

const State = Annotation.Root({
  asked: Annotation<string>,
  entry: Annotation<string>,
  query: Annotation<string>,
  cause: Annotation<string>,
  dateStart: Annotation<string>,
  dateEnd: Annotation<string>,
  hits: Annotation<Hit[]>({ reducer: (_left, right) => right, default: () => [] }),
  widened: Annotation<boolean>,
  answer: Annotation<string>,
});

type Graph = typeof State.State;

const ENTRIES = ["案号", "案情", "争议焦点", "裁判口径", "多维度", "罪名"] as const;

function caseNumberIn(text: string) {
  return text.match(/[（(]\d{4}[）)][^\s，。；、]{2,30}号/)?.[0] ?? "";
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

async function routeNode(state: Graph): Promise<Partial<Graph>> {
  const numbered = caseNumberIn(state.asked);
  if (numbered) return { entry: "案号", query: numbered, cause: "", dateStart: "", dateEnd: "" };
  const dimensions = caseDimensions(state.asked);
  if (dimensions) return dimensions;
  const routed = await modelText(
    [
      "这句是在找案例。只返回 JSON。",
      '{"entry":"案号|案情|争议焦点|裁判口径|多维度|罪名","query":"检索句"}',
      "query 不要写法律结论。",
    ].join("\n"),
    state.asked,
    300,
  );
  if ("error" in routed) return { entry: "案情", query: state.asked.slice(0, 80) };
  const parsed = jsonObject(routed.text);
  const entry = ENTRIES.includes(parsed?.entry as (typeof ENTRIES)[number]) ? String(parsed?.entry) : "案情";
  const query = typeof parsed?.query === "string" && parsed.query.trim() ? parsed.query.trim() : state.asked.slice(0, 80);
  return { entry, query };
}

function recordArgs(state: Graph, wide: boolean) {
  if (state.entry === "案号") return { caseNumber: state.query, pageSize: 3 };
  if (state.entry === "多维度") {
    const text = (wide ? state.query.split(/\s+/).slice(0, 3).join(" ") : state.query).slice(0, 50);
    return {
      fullText: text,
      ...(wide || !state.cause ? {} : { cause: state.cause }),
      ...(state.dateStart && state.dateEnd ? { judgementDate: `${state.dateStart}TO${state.dateEnd}` } : {}),
      pageSize: 8,
    };
  }
  if (!wide && state.entry === "争议焦点") return { disputeFocus: state.query, pageSize: 8 };
  if (!wide && state.entry === "裁判口径") return { courtView: state.query, pageSize: 8 };
  if (!wide && state.entry === "罪名") return { cause: state.query, pageSize: 8 };
  const text = wide ? state.query.split(/\s+/).slice(0, 6).join(" ") : state.query;
  return { fullText: (text || state.query).slice(0, 50), pageSize: 8 };
}

function toHits(found: Awaited<ReturnType<typeof searchCaseRecords>>): Hit[] {
  return found.map((hit) => ({
    caseNumber: hit.caseNumber,
    title: hit.title,
    court: hit.court,
    date: hit.date,
    text: hit.snippet,
  }));
}

function fromSemantic(found: Awaited<ReturnType<typeof searchCases>>): Hit[] {
  return found.map((hit) => {
    const caseNumber = `${hit.detail} ${hit.title}`.match(/[（(]\d{4}[）)][^\s]{2,40}号/)?.[0] || "";
    const court = hit.detail.split(" · ").find((part) => part && part !== caseNumber) || "";
    const clean = hit.text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    const at = clean.search(/法院认为|裁判要旨|裁判观点/);
    return { caseNumber, title: hit.title, court, date: "", text: (at >= 0 ? clean.slice(at) : clean).slice(0, 220) };
  });
}

async function lookup(state: Graph, wide: boolean) {
  const rows = toHits(await searchCaseRecords(recordArgs(state, wide)));
  if (state.entry === "案号" || rows.length >= 3 || (rows.length > 0 && !wide && state.entry !== "案情")) return rows;
  const semantic = fromSemantic(await searchCases(wide ? state.query.slice(0, 24) : state.query, 8));
  const merged = [...rows];
  for (const hit of semantic) {
    if (merged.some((item) => item.caseNumber === hit.caseNumber && item.title === hit.title)) continue;
    merged.push(hit);
  }
  return merged.slice(0, 8);
}

async function searchNode(state: Graph): Promise<Partial<Graph>> {
  try {
    const hits = await lookup(state, false);
    if (state.entry === "案号" && hits[0]) {
      const found = await searchCaseRecords(recordArgs(state, false));
      if (found[0]?.id) {
        try {
          const holding = await caseHolding(found[0].id);
          if (holding) hits[0] = { ...hits[0], text: holding };
        } catch (error) {
          if (!(error instanceof AlphaError)) throw error;
        }
      }
    }
    return { hits };
  } catch (error) {
    if (error instanceof AlphaError) return { hits: [], answer: error.message };
    throw error;
  }
}

async function widenNode(state: Graph): Promise<Partial<Graph>> {
  if (state.entry === "案号" || state.widened || state.hits.length >= 3) return {};
  try {
    const hits = await lookup(state, true);
    const merged = [...state.hits];
    for (const hit of hits) {
      if (merged.some((item) => item.caseNumber === hit.caseNumber && item.title === hit.title)) continue;
      merged.push(hit);
    }
    return { hits: merged.slice(0, 8), widened: true };
  } catch (error) {
    if (error instanceof AlphaError) return { widened: true };
    throw error;
  }
}

async function writeNode(state: Graph): Promise<Partial<Graph>> {
  if (state.answer) return {};
  if (state.hits.length === 0) return { answer: state.entry === "案号" ? "没有查到这个案号。" : "没有查到案例。" };
  const list = state.hits
    .map((hit, index) => `${index + 1}. ${hit.caseNumber} ${hit.title}\n法院：${hit.court || "未返回"}\n日期：${hit.date || "未返回"}\n${hit.text}`)
    .join("\n\n");
  const listOnly = ["## 查回的案例", ...state.hits.map((hit, index) => `${index + 1}. ${hit.caseNumber}  ${hit.title}`)].join("\n");
  let written = await modelText(
    [
      "只做类案归纳。不要写法律结论，不要写当事人应当怎么做。",
      "按这个结构写：",
      "## 一、整体结论",
      "### 检索分析",
      "### 检索总结",
      "## 二、完全匹配案例",
      "每件写案号、法院、裁判日期、要点。要点只用下面给出的文字。不要另写案例列表，程序会放在前面。",
    ].join("\n"),
    `入口：${state.entry}\n问题：${state.asked}\n\n${list}`,
    1_600,
  );
  if ("error" in written) {
    const brief = state.hits
      .map((hit) => `${hit.title}（${hit.caseNumber}），${hit.court || "法院未返回"}，${hit.date || "日期未返回"}。${hit.text.slice(0, 180)}`)
      .join("\n");
    return { answer: `${listOnly}\n\n${brief}` };
  }
  return { answer: `${listOnly}\n\n${written.text.trim()}` };
}

const graph = new StateGraph(State)
  .addNode("route", routeNode)
  .addNode("search", searchNode)
  .addNode("widen", widenNode)
  .addNode("write", writeNode)
  .addEdge(START, "route")
  .addEdge("route", "search")
  .addEdge("search", "widen")
  .addEdge("widen", "write")
  .addEdge("write", END)
  .compile();

export async function runFindCases(asked: string) {
  const result = await graph.invoke({
    asked,
    entry: "",
    query: "",
    cause: "",
    dateStart: "",
    dateEnd: "",
    hits: [],
    widened: false,
    answer: "",
  });
  return { text: result.answer.trim() || "没有查到案例。" };
}
