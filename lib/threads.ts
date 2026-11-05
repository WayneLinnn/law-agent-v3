import "server-only";

import { connection } from "next/server";

import { caseBrief } from "@/lib/case-brief";
import { runCaseTool, wantsConsult, wantsFindCases } from "@/lib/case-tools";
import { database } from "@/lib/db";
import { writeDraftMessage } from "@/lib/drafts";
import { packHistory } from "@/lib/history";
import { searchChoice } from "@/lib/legal-turn";
import { answerFromHits, answerFromRecord, answerOnCase, clockLine, completeChat, judgeFromSources, selectTool } from "@/lib/model";
import { candidateLines, rememberCandidates, searchRetrieval } from "@/lib/retrieval";
import { listUploads } from "@/lib/uploads";
import { acceptCaseName, acceptClient, fileTakeFields, fileTakePrompt, hasTakeableTalk, newCaseFrom } from "@/lib/new-case";
import { workbenchTools, runWorkbenchTool } from "@/lib/workbench-tools";

const MAX_TEXT = 8_000;

function writingAsk(text: string) {
  return /写一份|写一个|起草|起诉状|上诉状|答辩|申请书|裁定书|代理词/.test(text);
}

function plainAnswer(text: string, onCase: boolean) {
  const trimmed = text.trim();
  if (/^(已记下|已更新|已改|已加|已挂|已扫|已解档|已开出|已收下|已开一张|时间线已|案由已|基本事实已|待办名称已|委托事项已)/.test(trimmed)) {
    return "没有写入。";
  }
  if (onCase && /别的案子|全部待办|已查全部|全部案子|各案待办/.test(trimmed)) {
    return "现在打开的就是这件案子。要看别的案子或各案待办，回工作台。";
  }
  return text;
}

function filledCaseArgs(raw: string, pieces: string[]) {
  let clientName = "";
  let caseName = "";
  let pasted = "";
  try {
    const parsed = JSON.parse(raw) as { clientName?: unknown; caseName?: unknown; text?: unknown };
    if (parsed && typeof parsed === "object") {
      clientName = acceptClient(typeof parsed.clientName === "string" ? parsed.clientName : "");
      caseName = acceptCaseName(typeof parsed.caseName === "string" ? parsed.caseName : "");
      pasted = typeof parsed.text === "string" ? parsed.text : "";
    }
  } catch {
    clientName = "";
  }
  const fields = newCaseFrom(pieces);
  return JSON.stringify({
    clientName: clientName || fields.clientName,
    caseName: caseName || fields.caseName,
    text: pasted,
  });
}

const NO_CHECKED_SOURCE = "没有勾选出处。这一问先不写结论，也不把法条和案号写成依据。";

type Failure = { error: string; status: 400 | 404 | 409 | 502; threadId?: string };

export type ThreadSummary = {
  id: string;
  title: string;
  createdAt: string;
};

export type ThreadMessage = {
  id: string;
  role: "lawyer" | "model";
  mode: "问答" | "直接检索" | "分析成文";
  body: string;
  proposalKind: string;
  proposalBody: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type ThreadRecord = ThreadSummary & {
  matterId: string | null;
  messages: ThreadMessage[];
  prompted: boolean;
};

type MessageRow = {
  id: string;
  role: "lawyer" | "model";
  mode: "问答" | "直接检索" | "分析成文";
  body: string;
  proposal_kind: string;
  proposal_body: string;
  accepted_at: string | null;
  created_at: string;
};

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function asksStatute(text: string) {
  return /法条|法规|司法解释|案例|判例|案号|《[^》\n]{1,40}》|第[0-9０-９一二三四五六七八九十百零千]{1,12}条|[（(]\d{4}[）)]/.test(
    text,
  );
}

export function markUnchecked(text: string) {
  const tag = (match: string) => (match.includes("未经核对") ? match : `${match}（未经核对）`);
  const marked = text
    .replace(/[（(]\d{4}[）)][\u4e00-\u9fffA-Za-z0-9]{1,24}号/g, tag)
    .replace(
      /《[^》\n]{1,40}》第[0-9０-９一二三四五六七八九十百零千]+条(?:之[0-9０-９一二三四五六七八九十]+)?/g,
      tag,
    );
  if (marked.includes("未经核对")) return marked;
  return `${marked}\n\n法条和案号未经核对。`;
}

function cleanText(value: unknown): Failure | { text: string } {
  if (typeof value !== "string") return { error: "没有读懂提交的内容。", status: 400 };
  const text = value.trim();
  if (!text) return { error: "请写下要问的话。", status: 400 };
  if (text.length > MAX_TEXT) return { error: "这段太长。", status: 400 };
  return { text };
}

function mapMessage(row: MessageRow): ThreadMessage {
  return {
    id: row.id,
    role: row.role,
    mode: row.mode,
    body: row.body,
    proposalKind: row.proposal_kind,
    proposalBody: row.proposal_body,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at,
  };
}

function pendingLawyer(messages: ThreadMessage[]) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "lawyer") return null;
  return last;
}

export async function listThreads(): Promise<ThreadSummary[]> {
  await connection();
  const rows = database()
    .prepare(
      `SELECT t.id, t.title, t.created_at,
              COALESCE(MAX(m.created_at), t.created_at) AS updated_at
       FROM threads t
       LEFT JOIN messages m ON m.thread_id = t.id
       WHERE t.matter_id IS NULL
       GROUP BY t.id
       ORDER BY updated_at DESC, t.rowid DESC`,
    )
    .all() as Array<{ id: string; title: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title || "还没写标题",
    createdAt: row.created_at,
  }));
}

export async function getThread(id: string): Promise<ThreadRecord | null> {
  await connection();
  const thread = database()
    .prepare("SELECT id, title, matter_id, created_at FROM threads WHERE id = ?")
    .get(id) as
    | { id: string; title: string; matter_id: string | null; created_at: string }
    | undefined;
  if (!thread) return null;
  const messages = (
    database()
      .prepare(
        `SELECT id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
         FROM messages WHERE thread_id = ? ORDER BY created_at, rowid`,
      )
      .all(id) as MessageRow[]
  ).map(mapMessage);
  const pending = pendingLawyer(messages.filter((message) => !message.proposalKind));
  return {
    id: thread.id,
    title: thread.title || "还没写标题",
    createdAt: thread.created_at,
    matterId: thread.matter_id,
    messages,
    prompted: Boolean(pending && pending.mode === "问答" && asksStatute(pending.body)),
  };
}

function insertLawyer(
  threadId: string,
  text: string,
  created: boolean,
  matterId: string | null = null,
  mode: "问答" | "直接检索" | "分析成文" = "问答",
) {
  const db = database();
  const now = stamp();
  const messageId = crypto.randomUUID();
  const title = text.replace(/\s+/g, " ").trim().slice(0, 24);
  if (created) {
    db.prepare(
      "INSERT INTO threads (id, matter_id, title, created_at) VALUES (?, ?, ?, ?)",
    ).run(threadId, matterId, title, now);
  } else if (title) {
    db.prepare("UPDATE threads SET title = ? WHERE id = ? AND title IN ('', '新对话')").run(title, threadId);
  }
  db.prepare(
    `INSERT INTO messages (
      id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
    ) VALUES (?, ?, 'lawyer', ?, ?, '', '', NULL, ?)`,
  ).run(messageId, threadId, mode, text, now);
  return messageId;
}

function insertAnswer(threadId: string, body: string) {
  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '问答', ?, '', '', NULL, ?)`,
    )
    .run(crypto.randomUUID(), threadId, body, stamp());
}

async function legalAsk(input: {
  threadId: string;
  created: boolean;
  matterId: string;
  text: string;
  turn: "analyze" | "draft";
}): Promise<Failure | { threadId: string; prompted: boolean; status: 200 | 201 }> {
  const matter = database().prepare("SELECT id, status FROM matters WHERE id = ?").get(input.matterId) as
    | { id: string; status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  const counted = database().prepare("SELECT COUNT(*) AS n FROM sources WHERE matter_id = ?").get(input.matterId) as {
    n: number;
  };
  const count = Number(counted.n);
  const choice = searchChoice(input.text);
  if (choice === "on" || (choice === "auto" && count === 0)) {
    const found = await searchRetrieval(input.text, input.matterId);
    if ("error" in found) return found;
    const messageId = insertLawyer(
      input.threadId,
      input.text,
      input.created,
      input.created ? input.matterId : null,
      "问答",
    );
    rememberCandidates({
      threadId: input.threadId,
      messageId,
      question: input.text,
      query: found.query,
      items: found.items,
    });
    return { threadId: input.threadId, prompted: false, status: input.created ? 201 : 200 };
  }
  if (input.turn === "draft") {
    return compose({
      threadId: input.created ? undefined : input.threadId,
      matterId: input.matterId,
      text: input.text,
    });
  }
  insertLawyer(input.threadId, input.text, input.created, input.created ? input.matterId : null, "问答");
  if (count === 0) {
    insertAnswer(input.threadId, NO_CHECKED_SOURCE);
    return { threadId: input.threadId, prompted: false, status: input.created ? 201 : 200 };
  }
  const rows = database()
    .prepare("SELECT kind, title, text, url FROM sources WHERE matter_id = ? ORDER BY accepted_at, rowid")
    .all(input.matterId) as Array<{ kind: "law" | "case"; title: string; text: string; url: string }>;
  const judged = await judgeFromSources(
    input.text,
    rows.map((row) => ({ kind: row.kind, title: row.title, text: row.text, url: row.url })),
  );
  if ("error" in judged) return { error: judged.error, status: 502, threadId: input.threadId };
  const again = database().prepare("SELECT status FROM matters WHERE id = ?").get(input.matterId) as {
    status: string;
  };
  if (again.status === "已归档") return { error: "归档后只供查阅。", status: 409, threadId: input.threadId };
  insertAnswer(input.threadId, judged.text);
  return { threadId: input.threadId, prompted: false, status: input.created ? 201 : 200 };
}

function echoes(spoken: string, record: string) {
  const flat = (value: string) => value.replace(/\s+/g, "");
  const left = flat(spoken);
  const right = flat(record);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const lines = record
    .split("\n")
    .map((line) => flat(line))
    .filter((line) => line.length >= 6);
  if (lines.length === 0) return false;
  const hit = lines.filter((line) => left.includes(line)).length;
  return hit >= Math.ceil(lines.length * 0.6);
}

function withoutStale(spoken: string, record: string) {
  if (/还没核对|待核对/.test(record)) return spoken;
  return spoken.replace(/[^。\n]*(?:还没核对|没核对过|尚未核对|这里不附)[^。\n]*[。]?/g, "").trim();
}

async function reply(
  threadId: string,
  statute: boolean,
  delta: (text: string) => void,
  speak: (threadId: string, body: string) => void,
): Promise<Failure | { threadId: string }> {
  const thread = await getThread(threadId);
  if (!thread) return { error: "没有这段对话。", status: 404 };
  const turns = thread.messages
    .filter((message) => !message.proposalKind)
    .map((message) => ({ id: message.id, role: message.role, body: message.body }));
  if (thread.matterId) return { error: "没有这段对话。", status: 404 };
  const packed = await packHistory(threadId, turns);
  const answered = await completeChat(packed.turns, delta, packed.note);
  if ("error" in answered) return { error: answered.error, status: 502 };
  speak(threadId, plainAnswer(statute ? markUnchecked(answered.text) : answered.text, false));
  return { threadId };
}

async function retrieve(
  input: {
    threadId?: string;
    matterId?: string;
    text?: unknown;
  },
  delta: (text: string) => void,
  speak: (threadId: string, body: string) => void,
): Promise<Failure | { threadId: string; prompted: boolean; status: 200 | 201 }> {
  const existing = input.threadId ? await getThread(input.threadId) : null;
  if (input.threadId && !existing) return { error: "没有这段对话。", status: 404 };
  const matterId = existing?.matterId ?? input.matterId ?? null;
  if (!existing && input.matterId) {
    const matter = database().prepare("SELECT id FROM matters WHERE id = ?").get(input.matterId);
    if (!matter) return { error: "没有这件案子。", status: 404 };
  }
  const typed = cleanText(input.text);
  if ("error" in typed) return typed;

  const found = await searchRetrieval(typed.text, matterId);
  if ("error" in found) return found;

  const threadId = existing?.id ?? crypto.randomUUID();
  const messageId = insertLawyer(threadId, typed.text, !existing, !existing ? matterId : null, "直接检索");
  rememberCandidates({
    threadId,
    messageId,
    question: typed.text,
    query: found.query,
    items: found.items,
  });
  if (found.items.length === 0) {
    speak(threadId, "没有查到可依据的法条或案例。");
    return { threadId, prompted: false, status: existing ? 200 : 201 };
  }
  const answered = await answerFromHits(
    typed.text,
    found.items.map((item) => ({
      kind: item.kind,
      title: item.title,
      text: item.text,
      url: item.url,
    })),
    delta,
  );
  if ("error" in answered) return { error: answered.error, status: 502, threadId };
  const extra = `\n\n依据候选：\n${candidateLines(found.items).join("\n")}`;
  delta(extra);
  speak(threadId, `${answered.text}${extra}`);
  return { threadId, prompted: false, status: existing ? 200 : 201 };
}

async function compose(input: {
  threadId?: string;
  matterId?: string;
  text?: unknown;
}): Promise<Failure | { threadId: string; prompted: boolean; status: 200 | 201 }> {
  const existing = input.threadId ? await getThread(input.threadId) : null;
  if (input.threadId && !existing) return { error: "没有这段对话。", status: 404 };
  const matterId = existing?.matterId ?? input.matterId ?? null;
  if (!matterId) return { error: "先建成案子。", status: 400 };
  const matter = database().prepare("SELECT id, status FROM matters WHERE id = ?").get(matterId) as
    | { id: string; status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  const sources = database().prepare("SELECT COUNT(*) AS n FROM sources WHERE matter_id = ?").get(matterId) as {
    n: number;
  };
  if (sources.n === 0) return { error: "请先勾选出处。", status: 400 };
  const typed = cleanText(input.text);
  if ("error" in typed) return typed;

  const threadId = existing?.id ?? crypto.randomUUID();
  insertLawyer(threadId, typed.text, !existing, !existing ? matterId : null, "分析成文");
  const written = await writeDraftMessage(threadId, typed.text, matterId);
  if ("error" in written) return { ...written, threadId };
  return { threadId, prompted: false, status: existing ? 200 : 201 };
}

export async function ask(
  input: {
    threadId?: string;
    matterId?: string;
    mode?: unknown;
    text?: unknown;
    insist?: unknown;
  },
  onDelta?: (text: string) => void,
  onReset?: () => void,
): Promise<Failure | { threadId: string; prompted: boolean; status: 200 | 201 }> {
  await connection();
  const heard = { n: 0 };
  const delta = (chunk: string) => {
    if (!chunk) return;
    heard.n += chunk.length;
    onDelta?.(chunk);
  };
  const reset = () => {
    heard.n = 0;
    onReset?.();
  };
  const speak = (id: string, body: string) => {
    if (heard.n === 0) delta(body);
    insertAnswer(id, body);
  };
  const insist = input.insist === true;
  const existing = input.threadId ? await getThread(input.threadId) : null;
  if (input.threadId && !existing) return { error: "没有这段对话。", status: 404 };
  if (!existing && input.matterId) {
    const matter = database().prepare("SELECT id FROM matters WHERE id = ?").get(input.matterId);
    if (!matter) return { error: "没有这件案子。", status: 404 };
  }

  const pending = existing
    ? pendingLawyer(existing.messages.filter((message) => !message.proposalKind))
    : null;
  const typed = input.text == null || input.text === "" ? null : cleanText(input.text);
  if (typed && "error" in typed) return typed;

  let text = typed && "text" in typed ? typed.text : "";
  const reusePending = Boolean(pending && (!text || text === pending.body));
  if (!text && pending) text = pending.body;
  if (!text) return { error: "请写下要问的话。", status: 400 };

  const threadId = existing?.id ?? crypto.randomUUID();
  const created = !existing;
  const boundId = existing?.matterId ?? input.matterId ?? null;
  if (!boundId && !insist && workbenchTools.length > 0) {
    const uploads = await listUploads(threadId);
    const priorTalk = (existing?.messages ?? []).filter((message) => !message.proposalKind);
    const recent = [
      ...priorTalk.slice(-7).map((message) => ({ role: message.role, body: message.body.slice(0, 400) })),
      { role: "lawyer" as const, body: text },
    ];
    const offerTake = () => {
      const pieces = priorTalk.filter((message) => message.role === "lawyer").map((message) => message.body);
      if (pieces[pieces.length - 1] !== text) pieces.push(text);
      const fields = fileTakeFields(pieces);
      if (!reusePending) insertLawyer(threadId, text, created, null);
      speak(threadId, fileTakePrompt(fields.clientName, fields.caseName, hasTakeableTalk(priorTalk)));
      return { threadId, prompted: false, status: created ? 201 : 200 } as const;
    };
    const picked = await selectTool(
      [
        "你在工作台，还没有打开某一件案子。",
        "只从给定的工具里选一个。名字、用途和参数以工具列表为准。",
        "问有哪些案子时调用 list_cases。开一张卡、新建案子时调用 create_case，clientName 写客户，caseName 写案件名称。两个都要有。给我、我、你不是客户。",
        "问待办或到期时调用 list_todos。",
        "要法律结论、能否、有没有权、怎么主张，或要算出受理费、保全费、执行费、补偿、利息时调用 consult。",
        "要一批案例、按案号归纳、调取某几年的判决时调用 find_cases。",
        "只把法条和案例列出来时调用 ask_law。",
        "按字找已经进案的案子或案卷材料时调用 find。问这段对话上传了哪些文件时不要调用 find。",
        "律师想把这段工作台问答收成新案子、带走、立案时调用 offer_file_take。不必出现「立案并带走」这几个字。只是新开一张空卡时才用 create_case。",
        uploads.length
          ? `本对话已放入：${uploads.map((file) => file.filename).join("、")}。提到其中的人、公司或文件，或要据此写起诉建议、总结、列出已放入的文件、汇总照片时，调用 read_upload，不要调用 find。`
          : "这段对话还没有放入文件，不要调用 read_upload。",
        "要新建案子但没说全客户名称和案件名称时，不要调用工具。",
        "没有点明客户和案件名称就不要调用 create_case。",
        "问今天几号或现在几点时，不要调用工具。",
        "要把写好的内容存成 Word 或 PDF 时，不要调用工具。告诉他点「存为 Word」或「存为 PDF」。",
        clockLine(),
      ].join("\n"),
      recent,
      workbenchTools,
      delta,
      reset,
    );
    if (!("error" in picked)) {
      const call = picked.calls[0];
      const steered = wantsFindCases(text) ? "find_cases" : wantsConsult(text) ? "consult" : "";
      const name = steered && (!call || call.name === "ask_law") ? steered : (call?.name ?? "");
      if (!name && picked.text) {
        if (!reusePending) insertLawyer(threadId, text, created, null);
        speak(threadId, picked.text);
        return { threadId, prompted: false, status: created ? 201 : 200 };
      }
      if (name && workbenchTools.some((tool) => tool.name === name)) {
        if (name === "offer_file_take") return offerTake();
        if (!reusePending) insertLawyer(threadId, text, created, null);
        const pieces = recent.filter((turn) => turn.role === "lawyer").map((turn) => turn.body);
        const raw = name === "create_case" ? filledCaseArgs(call?.arguments ?? "", pieces) : (call?.arguments ?? "");
        const ran = await runWorkbenchTool(name, raw, text, threadId, delta);
        if ("error" in ran) return ran;
        speak(threadId, ran.text);
        return { threadId, prompted: false, status: created ? 201 : 200 };
      }
    }
  }
  if (boundId) {
    const matter = database().prepare("SELECT id FROM matters WHERE id = ?").get(boundId);
    if (!matter) return { error: "没有这件案子。", status: 404 };
    const prior = (existing?.messages ?? [])
      .filter((message) => !message.proposalKind)
      .map((message) => ({ id: message.id, role: message.role, body: message.body }));
    const turns = reusePending ? prior : [...prior, { role: "lawyer" as const, body: text }];
    let saved = reusePending;
    const acted = await runCaseTool(
      threadId,
      boundId,
      turns,
      () => {
        if (saved) return;
        insertLawyer(threadId, text, created, created ? boundId : null);
        saved = true;
      },
      delta,
      reset,
    );
    if (acted.status === "archived") return { error: "归档后只供查阅。", status: 409 };
    if (!saved) insertLawyer(threadId, text, created, created ? boundId : null);
      if (acted.status === "done") {
      let spoken = acted.text;
      const writing = writingAsk(text);
      if (acted.reply) {
        const answered = await answerFromRecord(turns, acted.text, delta, writing ? 12_000 : 8_000, writing);
        const said = "error" in answered ? "" : withoutStale(answered.text.trim(), acted.text);
        const claimed = /^已记下|^已更新|^已开出|^已添加/.test(said) && !/^已记下|^已更新|^已开出/.test(acted.text.trim());
        if (writing) spoken = said || "没有写出来。";
        else if (!said || claimed) spoken = acted.text;
        else if (echoes(said, acted.text)) spoken = said.length > acted.text.length ? said : acted.text;
        else {
          spoken = `${said}\n\n${acted.text}`;
          delta(`\n\n${acted.text}`);
        }
      }
      if (heard.n === 0) delta(spoken);
      database()
        .prepare(
          `INSERT INTO messages (
            id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
          ) VALUES (?, ?, 'model', '问答', ?, '', ?, NULL, ?)`,
        )
        .run(crypto.randomUUID(), threadId, spoken, JSON.stringify({ next: [] }), stamp());
      return { threadId, prompted: false, status: created ? 201 : 200 };
    }
    const brief = await caseBrief(boundId);
    if (!brief) return { error: "没有这件案子。", status: 404 };
    const packed = await packHistory(threadId, turns);
    const answered = await answerOnCase(packed.turns, brief, delta, packed.note);
    if ("error" in answered) return { error: answered.error, status: 502, threadId };
    const spoken = plainAnswer(answered.text, true);
    if (heard.n === 0 && spoken) delta(spoken);
    database()
      .prepare(
        `INSERT INTO messages (
          id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
        ) VALUES (?, ?, 'model', '问答', ?, '', ?, NULL, ?)`,
      )
      .run(crypto.randomUUID(), threadId, spoken, JSON.stringify({ next: answered.next }), stamp());
    return { threadId, prompted: false, status: created ? 201 : 200 };
  }
  if (!reusePending) insertLawyer(threadId, text, created, created ? input.matterId ?? null : null);

  const answered = await reply(threadId, false, delta, speak);
  if ("error" in answered) return { ...answered, threadId };
  return { threadId, prompted: false, status: created ? 201 : 200 };
}
