import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const GATEWAY = "https://apim-gateway.pkulaw.com";

const PATHS = {
  fatiao: "/mcp-fatiao",
  "law-semantic": "/mcp-law-search-service",
  "case-semantic": "/mcp-case-search-service",
  "case-keyword": "/mcp-case",
} as const;

type Service = keyof typeof PATHS;

const CALL_TIMEOUT_MS = 30_000;

export const PKULAW_DOWN = "法宝暂不可用。";

export class PkulawError extends Error {}

export type LawHit = {
  kind: "law";
  sourceId: string;
  title: string;
  text: string;
  url: string;
  status: string;
  detail: string;
};

export type CaseHit = {
  kind: "case";
  sourceId: string;
  title: string;
  text: string;
  url: string;
  status: string;
  detail: string;
};

export type RetrievalHit = LawHit | CaseHit;

export type CaseLookup = { caseNumber: string; title: string; url: string };

const LOOKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const lookupStore = globalThis as unknown as {
  v3PkulawArticles?: Map<string, { at: number; value: LawHit | null }>;
  v3PkulawCases?: Map<string, { at: number; value: CaseLookup | null }>;
};
const articleCache = (lookupStore.v3PkulawArticles ??= new Map());
const caseCache = (lookupStore.v3PkulawCases ??= new Map());

export function caseNumberKey(caseNumber: string) {
  return caseNumber.replace(/（/g, "(").replace(/）/g, ")").replace(/\s+/g, "");
}

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function plainTitle(title: string) {
  return title.replace(/[（(](?:\d{4}[^（()）]*|[^（()）]*(?:修正|修订|修改))[）)]\s*$/, "").trim();
}

const ARTICLE_LABEL_RE =
  /^(?:第[零〇一二三四五六七八九十百千\d]+条(?:之[一二三四五六七八九十]+)?|[零〇一二三四五六七八九十百千]+、|\d+(?:\.\d+)*[.．、])/;

function lawHit(item: Record<string, unknown>): LawHit | null {
  const title = str(item.title);
  const article = str(item.article);
  const url = str(item.url);
  if (!title || !article || !url) return null;
  const label = article.match(ARTICLE_LABEL_RE)?.[0].replace(/[.．、]$/, "") ?? "";
  const law = plainTitle(title);
  return {
    kind: "law",
    sourceId: `${law}#${label || article.slice(0, 24)}`,
    title: label ? `${law} ${label}` : law,
    text: article,
    url,
    status: str(item.timeliness),
    detail: [str(item.effectiveness), str(item.doc_no), str(item.implementation_date) && `${str(item.implementation_date)} 施行`]
      .filter(Boolean)
      .join(" · "),
  };
}

function caseHit(item: Record<string, unknown>): CaseHit | null {
  const title = str(item.title);
  const url = str(item.url);
  if (!title || !url) return null;
  const caseNumber = str(item.caseNumber);
  const reasoning = str(item.identified);
  const summary = str(item.content) || str(item.ascertain);
  const result = str(item.refereeResult);
  const text = [reasoning ? `本院认为：${reasoning}` : summary ? `基本案情：${summary}` : "", result ? `裁判结果：${result}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return {
    kind: "case",
    sourceId: caseNumber || url,
    title,
    text: text || title,
    url,
    status: str(item.caseGrade),
    detail: [str(item.courthouseName), caseNumber, str(item.decisionDate)].filter(Boolean).join(" · "),
  };
}

function listOf(data: unknown, key: string) {
  if (!data || typeof data !== "object") return [];
  const list = (data as Record<string, unknown>)[key];
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

async function gatewayFetch(url: string | URL, init?: RequestInit) {
  const response = await fetch(url, init);
  const type = response.headers.get("content-type");
  if (!type || !type.includes(",")) return response;
  const headers = new Headers(response.headers);
  headers.set("content-type", type.split(",")[0].trim());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function userMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("900001") || text.includes("积分不足")) return "北大法宝积分不足，请到控制台充值。";
  if (text.includes("900002") || text.includes("额度不足")) return "北大法宝额度不足，请到北大法宝控制台给这个 Token 分配额度。";
  if (text.includes("900908") || text.includes("关闭状态")) return "这项北大法宝服务没有开启。";
  if (text.includes("900902") || text.includes("Missing Credentials")) return "北大法宝不认这个 Token。";
  return null;
}

async function callOnce(service: Service, tool: string, args: Record<string, unknown>) {
  const token = process.env.PKULAW_TOKEN?.trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new PkulawError("没有设置北大法宝 Token。");
  const transport = new StreamableHTTPClientTransport(new URL(GATEWAY + PATHS[service]), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: gatewayFetch,
  });
  const client = new Client({ name: "law-agent-v3", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: CALL_TIMEOUT_MS });
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
    if (result.isError) {
      const content = result.content as { type: string; text?: string }[];
      return { error: content.find((part) => part.type === "text")?.text ?? "" };
    }
    if (result.structuredContent) return { data: result.structuredContent };
    const content = result.content as { type: string; text?: string }[];
    const text = content.find((part) => part.type === "text")?.text;
    return { data: text ? (JSON.parse(text) as unknown) : null };
  } finally {
    await client.close().catch(() => {});
  }
}

async function call(service: Service, tool: string, args: Record<string, unknown>) {
  try {
    return await callOnce(service, tool, args);
  } catch (first) {
    if (first instanceof PkulawError) throw first;
    const known = userMessage(first);
    if (known) throw new PkulawError(known);
    try {
      return await callOnce(service, tool, args);
    } catch (second) {
      if (second instanceof PkulawError) throw second;
      throw new PkulawError(userMessage(second) ?? PKULAW_DOWN);
    }
  }
}

export async function getArticle(law: string, articleLabel: string) {
  const key = `${law}#${articleLabel}`;
  const cached = articleCache.get(key);
  if (cached && Date.now() - cached.at < LOOKUP_TTL_MS) return cached.value;
  const response = await call("fatiao", "get_law_item_content", {
    lawTitle: law,
    articleNumber: articleLabel,
  });
  if ("error" in response) {
    const message = userMessage(response.error);
    if (message) throw new PkulawError(message);
    const text = typeof response.error === "string" ? response.error : "";
    if (/900\d{3}|暂不可用|timeout|fetch failed/i.test(text)) throw new PkulawError(PKULAW_DOWN);
    return null;
  }
  const data = (response.data ?? {}) as Record<string, unknown>;
  const content = str(data.content);
  const citation = (data.citation ?? {}) as Record<string, unknown>;
  const url = str(citation.url);
  let value: LawHit | null = null;
  if (content && url) {
    const title = plainTitle(str(data.lawTitle) || law);
    const label = str(data.articleLabel) || articleLabel;
    value = {
      kind: "law",
      sourceId: `${title}#${label}`,
      title: `${title} ${label}`,
      text: content,
      url,
      status: str(data.timeliness),
      detail: [
        Array.isArray(data.effectiveness) ? data.effectiveness.map(str).join("、") : "",
        str(data.documentNo),
        str(data.implementDate) && `${str(data.implementDate)} 施行`,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  articleCache.set(key, { at: Date.now(), value });
  return value;
}

export async function findCase(caseNumber: string) {
  const key = caseNumberKey(caseNumber);
  const cached = caseCache.get(key);
  if (cached && Date.now() - cached.at < LOOKUP_TTL_MS) return cached.value;
  const response = await call("case-keyword", "get_case_list", { caseFlag: caseNumber });
  if ("error" in response) throw new PkulawError(userMessage(response.error) ?? PKULAW_DOWN);
  const hit = listOf(response.data, "items").find((item) => caseNumberKey(str(item.caseFlag)) === key);
  const citation = (hit?.citation ?? {}) as Record<string, unknown>;
  const value: CaseLookup | null = hit
    ? { caseNumber: str(hit.caseFlag), title: str(hit.title), url: str(citation.url) }
    : null;
  caseCache.set(key, { at: Date.now(), value });
  return value;
}

export async function searchLaws(text: string, size: number) {
  const response = await call("law-semantic", "search_article", { text, timeliness: "现行有效", size });
  if ("error" in response) throw new PkulawError(userMessage(response.error) ?? PKULAW_DOWN);
  return listOf(response.data, "result")
    .map(lawHit)
    .filter((item): item is LawHit => item !== null);
}

export async function searchCases(text: string, size: number) {
  const response = await call("case-semantic", "search_case", { text, size });
  if ("error" in response) throw new PkulawError(userMessage(response.error) ?? PKULAW_DOWN);
  return listOf(response.data, "data")
    .map(caseHit)
    .filter((item): item is CaseHit => item !== null);
}
