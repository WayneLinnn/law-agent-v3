import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { CaseHit, LawHit } from "@/lib/pkulaw";

const ENDPOINTS = {
  law: "https://opendata.alphalawyer.cn/ai-plugin/mcp/law",
  case: "https://opendata.alphalawyer.cn/ai-plugin/mcp/case",
} as const;

const TOOLS = {
  law: "semantic_search_laws",
  case: "semantic_search_cases",
} as const;

const CALL_TIMEOUT_MS = 30_000;

export const ALPHA_DOWN = "Alpha 暂不可用。";

export class AlphaError extends Error {}

function apiKey() {
  const raw = process.env.alpha_API || process.env.ALPHA_API_KEY || "";
  return raw.trim().replace(/^Bearer\s+/i, "");
}

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function callNamed(kind: keyof typeof ENDPOINTS, name: string, args: Record<string, unknown>) {
  const key = apiKey();
  if (!key) throw new AlphaError("没有设置 Alpha 的 Key。");
  const client = new Client({ name: "law-agent-v3", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINTS[kind]), {
    requestInit: {
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${key}`,
      },
    },
  });
  try {
    await client.connect(transport, { timeout: CALL_TIMEOUT_MS });
    const listed = await client.listTools();
    if (!listed.tools.some((tool) => tool.name === name)) throw new AlphaError(`Alpha 没有公布 ${name}。`);
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
    if (result.isError) throw new AlphaError(ALPHA_DOWN);
    if (result.structuredContent && typeof result.structuredContent === "object") {
      return result.structuredContent as Record<string, unknown>;
    }
    const content = result.content as { type: string; text?: string }[];
    const text = content.find((part) => part.type === "text")?.text;
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AlphaError) throw error;
    throw new AlphaError(ALPHA_DOWN);
  } finally {
    await client.close().catch(() => {});
  }
}

function call(kind: keyof typeof ENDPOINTS, query: string) {
  return callNamed(kind, TOOLS[kind], { query });
}

function plain(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export type CaseRecord = {
  id: string;
  title: string;
  caseNumber: string;
  court: string;
  date: string;
  cause: string;
  snippet: string;
};

export async function searchCaseRecords(args: {
  caseNumber?: string;
  fullText?: string;
  disputeFocus?: string;
  courtView?: string;
  cause?: string;
  judgementDate?: string;
  pageSize?: number;
}) {
  const data = await callNamed("case", "search_cases", { pageSize: 8, ...args });
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const hits: CaseRecord[] = [];
  for (const item of cases) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = plain(str(row.title));
    const caseNumber = plain(str(row.caseNumber));
    if (!title && !caseNumber) continue;
    hits.push({
      id: str(row.jid),
      title,
      caseNumber,
      court: plain(str(row.courtName)),
      date: plain(str(row.judgementDate)),
      cause: plain(str(row.cause)),
      snippet: plain(str(row.hitResult)).slice(0, 500),
    });
  }
  return hits;
}

export async function caseHolding(caseId: string) {
  const data = await callNamed("case", "get_case_detail", { case_id: caseId });
  const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs : [];
  const parts = paragraphs
    .map((part) => {
      if (!part || typeof part !== "object") return null;
      const row = part as Record<string, unknown>;
      const label = str(row.lableName) || str(row.labelName) || str(row.name);
      const text = str(row.text);
      if (!text) return null;
      return { label, text };
    })
    .filter((part): part is { label: string; text: string } => Boolean(part));
  const holding = parts.find((part) => /法院认为|裁判要旨|裁判观点/.test(part.label));
  return plain(holding?.text || parts.map((part) => part.text).join("\n")).slice(0, 800);
}

export async function searchLaws(query: string, size: number) {
  const data = await call("law", query);
  const result = (data.result ?? {}) as Record<string, unknown>;
  const laws = Array.isArray(result.refLaws) ? result.refLaws : [];
  const hits: LawHit[] = [];
  for (const law of laws) {
    if (!law || typeof law !== "object") continue;
    const row = law as Record<string, unknown>;
    const title = str(row.title);
    const url = str(row["Alpha链接"]);
    const articles = Array.isArray(row.lawList) ? row.lawList : [];
    const detail = [str(row.dispatchAuthority), str(row.documentNumber)].filter(Boolean).join(" · ");
    const status = str(row.timeLimited);
    for (const article of articles) {
      if (hits.length >= size) return hits;
      if (!article || typeof article !== "object") continue;
      const item = article as Record<string, unknown>;
      const label = str(item.fullName);
      const text = str(item.text);
      if (!title || !text) continue;
      hits.push({
        kind: "law",
        sourceId: `${str(row.lid) || title}#${label || text.slice(0, 24)}`,
        title: label ? `${title} ${label}` : title,
        text,
        url,
        status,
        detail,
      });
    }
  }
  return hits;
}

export async function searchCases(query: string, size: number) {
  const data = await call("case", query);
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const hits: CaseHit[] = [];
  for (const item of cases) {
    if (hits.length >= size) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = str(row.all_caseinfo_casename);
    const url = str(row["Alpha链接"]);
    if (!title) continue;
    const paragraphs = Array.isArray(row.paragraphs) ? row.paragraphs : [];
    const text = paragraphs
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        const label = str(record.lableName);
        const body = str(record.text);
        if (!body) return "";
        return label ? `${label}：${body}` : body;
      })
      .filter(Boolean)
      .join("\n\n");
    const caseNumber = str(row.all_caseinfo_casenumber);
    hits.push({
      kind: "case",
      sourceId: str(row.jid) || caseNumber || url || title,
      title,
      text: text || title,
      url,
      status: "",
      detail: [str(row.all_caseinfo_court), caseNumber].filter(Boolean).join(" · "),
    });
  }
  return hits;
}
