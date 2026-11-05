import "server-only";

import { linkHitsInText } from "@/lib/cite-links";
import { clockLine } from "@/lib/clock";

export { asksClock, clockLine } from "@/lib/clock";

const MODEL_URL = "https://api.deepseek.com/chat/completions";

const SYSTEM = [
  "你在帮一位律师思考。这一段对话还没有挂到具体案子上。",
  "只根据对话里已经写下的话回答。不要声称查过法条、案例或 Alpha，也不要复述这条限制。",
  "不要改待办、实收、基本事实或任何案件记录。没有调用工具就不要说已记下、已更新或已开卡。",
  "要新建案子但客户名称或案件名称不全时，直接说还缺哪一项。给我、我、你不是客户。",
  "用中文，尽量短。",
  "律师要把写好的内容存成 Word 或 PDF 时，不要说做不到。告诉他点「存为 Word」或「存为 PDF」，文件放进这件案子的材料。",
].join("\n");

function withClock(system: string) {
  if (system.includes("今天是 ")) return system;
  return `${clockLine()}\n${system}`;
}

function withEarlier(system: string, earlier: string) {
  if (!earlier.trim()) return system;
  return `${system}\n\n此前对话备忘（更早的原话已收起。照片、PDF 和案卷正文不在这条备忘里，需要时另取）：\n${earlier.trim()}`;
}

export async function completeChat(
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
  onDelta?: (text: string) => void,
  earlier = "",
): Promise<{ text: string } | { error: string }> {
  return chat(withEarlier(`${SYSTEM}\n${clockLine()}`, earlier), turns, 0.2, onDelta);
}

export async function answerFromRecord(
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
  record: string,
  onDelta?: (text: string) => void,
  limit = 8_000,
  writing = false,
): Promise<{ text: string } | { error: string }> {
  return chat(
    [
      writing
        ? "律师要一份新文书。只写这份新文书，从标题写起。"
        : "根据下面查到的本案记录，回答律师最后一句。",
      "没有正文的材料，不要编它的内容。",
      "人名、日期和金额只用记录里有的原词。",
      "不要把材料原文、目录或分页再贴进回答。原文在左侧材料里。",
      "不要说记录已经改好。",
      writing ? "写完整。不要在文书后面加说明。" : "用中文，尽量短。",
      "",
      record.slice(0, limit),
    ].join("\n"),
    turns.slice(-4),
    0,
    onDelta,
    writing ? 2_000 : 800,
  );
}

export async function answerOnCase(
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
  brief: string,
  onDelta?: (text: string) => void,
  earlier = "",
): Promise<{ text: string; next: string[] } | { error: string }> {
  let streamed = "";
  const answered = await chat(
    withEarlier(caseSystem(brief), earlier),
    turns,
    0,
    onDelta
      ? streamAnswerField((piece) => {
          streamed += piece;
          onDelta(piece);
        })
      : undefined,
    1_600,
  );
  if ("error" in answered) return answered;
  const parsed = parseCaseAnswer(answered.text);
  if (!parsed.text) return { error: "模型没有答上。" };
  if (onDelta && !streamed) onDelta(parsed.text);
  return parsed;
}

function caseSystem(brief: string) {
  return [
    "你在这件案子上帮律师思考。",
    "只根据下面的本案资料和对话里已经写下的话回答。",
    "没有附上正文的材料，不要写出它的内容，也不要补事实。",
    "基本事实若是还没写，不要把它写成已经确定的事实。",
    "律师查本案记录时，回答里保留资料中的原句。",
    "材料正文可以直接使用，不要说还没核对或这里不附。写新文书时不要把材料原文附在回答后面。",
    "裁判文书落款的审判长、审判员、法官助理、书记员就是审理人员。问承办法官时回答审判长的姓名，并列出同页的审判员。不要说没有写承办法官。",
    "节点已经直接写入。时间线就是这些节点按日期排列。不要说还没写入，也不要叫律师点留下。",
    "不要改待办、实收、材料或案件状态，也不要复述这些限制。",
    "不要声称查过法条、案例或 Alpha。",
    "用中文，尽量短。",
    "律师要把写好的内容存成 Word 或 PDF 时，不要说做不到。告诉他点「存为 Word」或「存为 PDF」，文件放进左侧材料。",
    "问今天几号或现在几点，按下面这一行回答。",
    clockLine(),
    '只返回 JSON：{"answer":"...","next":["下一句"]}',
    "next 最多三条。每条是律师可以接着输入的一句话，不要写成已经做完。",
    "",
    brief,
  ].join("\n");
}

export type NoteKind = "时间线" | "待核清单" | "路径";

export type ChangeKind = "待办" | "基本事实" | "委托事项" | "证明对象";

export type ProposedChange = {
  text: string;
  payload: string;
};

export async function proposeChanges(
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
  brief: string,
  kinds: ChangeKind[],
): Promise<Partial<Record<ChangeKind, ProposedChange>> | { error: string }> {
  if (kinds.length === 0) return {};
  const answered = await chat(changeSystem(brief, kinds), turns, 0);
  if ("error" in answered) return answered;
  return parseChanges(answered.text, kinds);
}

function changeSystem(brief: string, kinds: ChangeKind[]) {
  return [
    "只根据下面的本案资料和对话，准备律师还没点头的修改稿。",
    "不要编日期、金额、人物或法条。给不出的写待核实。",
    "待办只有名称和到期日，到期日写成 YYYY-MM-DD。",
    "证明对象写在某一份材料上，filename 用资料里的文件名。",
    "不要改案件状态、客户、可用文字或归档。",
    `只返回 JSON，而且只包含这些键：${kinds.join("、")}。`,
    '{"待办":{"name":"","dueOn":""},"基本事实":"","委托事项":"","证明对象":{"filename":"","proves":""}}',
    "",
    brief,
  ].join("\n");
}

function parseChanges(text: string, kinds: ChangeKind[]): Partial<Record<ChangeKind, ProposedChange>> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const changes: Partial<Record<ChangeKind, ProposedChange>> = {};
    for (const kind of kinds) {
      const parsed = changeItem(kind, data[kind]);
      if (parsed) changes[kind] = parsed;
    }
    return changes;
  } catch {
    return {};
  }
}

function changeItem(kind: ChangeKind, value: unknown): ProposedChange | null {
  if (kind === "待办") {
    if (!value || typeof value !== "object") return null;
    const row = value as { name?: unknown; dueOn?: unknown };
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const dueOn = typeof row.dueOn === "string" ? row.dueOn.trim() : "";
    if (!name && !dueOn) return null;
    if (!name || !dueOn || name === "待核实" || dueOn === "待核实") {
      return { text: "待核实", payload: "待核实" };
    }
    return { text: `${name}\n${dueOn}`, payload: JSON.stringify({ name, dueOn }) };
  }
  if (kind === "证明对象") {
    if (!value || typeof value !== "object") return null;
    const row = value as { filename?: unknown; proves?: unknown };
    const filename = typeof row.filename === "string" ? row.filename.trim() : "";
    const proves = typeof row.proves === "string" ? row.proves.trim() : "";
    if (!filename && !proves) return null;
    if (!filename || !proves || filename === "待核实" || proves === "待核实") {
      return { text: "待核实", payload: "待核实" };
    }
    return { text: `${filename}\n${proves}`, payload: JSON.stringify({ filename, proves }) };
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return { text, payload: text };
}

export async function proposeNotes(
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
  brief: string,
  kinds: NoteKind[],
): Promise<Partial<Record<NoteKind, string>> | { error: string }> {
  if (kinds.length === 0) return {};
  const answered = await chat(noteSystem(brief, kinds), turns, 0);
  if ("error" in answered) return answered;
  return parseNotes(answered.text, kinds);
}

function noteSystem(brief: string, kinds: NoteKind[]) {
  return [
    "只根据下面的本案资料和对话，准备律师还没点头的稿子。",
    "资料里已经写明的句子可以写入。不要补资料里没有的日期、金额、人物或法条。",
    "完全看不出的，正文只写待核实。",
    "没有附上正文的材料，不要写出它的内容。",
    "路径要并列民事、刑事、行政，每行以（待核验）结尾。没有依据就写「给不出（待核验）」。",
    `只返回 JSON，而且只包含这些键：${kinds.join("、")}。`,
    '{"时间线":"","待核清单":"","路径":""}',
    "",
    brief,
  ].join("\n");
}

function parseNotes(text: string, kinds: NoteKind[]): Partial<Record<NoteKind, string>> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const notes: Partial<Record<NoteKind, string>> = {};
    for (const kind of kinds) {
      const value = data[kind];
      if (typeof value !== "string") continue;
      const body = value.trim().slice(0, 4_000);
      if (body) notes[kind] = body;
    }
    return notes;
  } catch {
    return {};
  }
}

function parseCaseAnswer(text: string): { text: string; next: string[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { text: text.trim(), next: [] };
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as { answer?: unknown; next?: unknown };
    const answer = typeof data.answer === "string" ? data.answer.trim() : "";
    const next = Array.isArray(data.next)
      ? data.next
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 3)
          .map((item) => item.slice(0, 200))
      : [];
    return { text: answer, next };
  } catch {
    return { text: text.trim(), next: [] };
  }
}

const EXTRACT = [
  "只根据对话里已经写下的话，抽出当事人、案由、基本事实。",
  "看不出的留空字符串，不要编，不要补。不要指定谁是客户。",
  "每个人单独一项，不要用顿号把几个人写成一个名字。",
  "复议机关、法院、检察院、公安机关的 role 写 organ，其余人写 opposing。",
  "只返回 JSON，不要其他字：",
  '{"parties":[{"name":"","position":"","idNumber":"","role":"opposing"}],"cause":"","facts":""}',
].join("");

export type ExtractedParty = {
  name: string;
  position: string;
  idNumber: string;
  role: "opposing" | "organ";
};

export type ExtractedCase = {
  parties: ExtractedParty[];
  cause: string;
  facts: string;
};

export type DraftSource = { title: string; kind: "law" | "case"; text: string; url?: string };

export async function draftFromSources(
  instruction: string,
  sources: DraftSource[],
): Promise<{ text: string } | { error: string }> {
  const answered = await chat(draftSystem(sources), [{ role: "lawyer", body: instruction }], 0);
  if ("error" in answered) return answered;
  const text = answered.text.replace(/^```[\w]*\n?|```$/g, "").trim();
  if (!text) return { error: "模型没有答上。" };
  return { text: text.slice(0, 8_000) };
}

export async function judgeFromSources(
  question: string,
  sources: DraftSource[],
  onDelta?: (text: string) => void,
): Promise<{ text: string } | { error: string }> {
  const answered = await chat(judgeSystem(sources), [{ role: "lawyer", body: question }], 0, onDelta);
  if ("error" in answered) return answered;
  const text = answered.text.replace(/^```[\w]*\n?|```$/g, "").trim();
  if (!text) return { error: "模型没有答上。" };
  return { text: linkHitsInText(text.slice(0, 4_000), sources) };
}

export async function answerFromHits(
  question: string,
  hits: Array<{ kind: "law" | "case" | string; title: string; text: string; url?: string }>,
  onDelta?: (text: string) => void,
): Promise<{ text: string } | { error: string }> {
  if (hits.length === 0) return { error: "没有查到可依据的法条或案例。" };
  const blocks = hits.map((hit, index) => {
    const kind = hit.kind === "law" ? "法条" : hit.kind === "case" ? "案例" : hit.kind;
    return `候选${index + 1}（${kind}）${hit.title}\n${hit.text.slice(0, 3_000)}`;
  });
  const answered = await chat(
    [
      "你在根据检索到的法条和案例回答律师的法律问题。",
      "只使用下面这些候选。候选里没有的法条和案号，不要写。",
      "先给结论。主依据点明 1 到 2 条最贴的法条，写成《法律名》第X条，法律名必须能在候选标题里对上。其余作补充。",
      "这批结果覆盖不到的，明说。",
      "不要选定诉请、胜负或文书结构。",
      "用中文，尽量短。只返回回答。",
      "",
      ...blocks,
    ].join("\n"),
    [{ role: "lawyer", body: question }],
    0,
    onDelta,
  );
  if ("error" in answered) return answered;
  const text = answered.text.replace(/^```[\w]*\n?|```$/g, "").trim();
  if (!text) return { error: "模型没有答上。" };
  return { text: linkHitsInText(text.slice(0, 4_000), hits) };
}

function judgeSystem(sources: DraftSource[]) {
  const blocks = sources.map((source, index) => {
    const kind = source.kind === "law" ? "法条" : "案例";
    return `出处${index + 1}（${kind}）${source.title}\n${source.text}`;
  });
  return [
    "你在根据律师已经勾选的出处分析一个法律问题。",
    "只使用下面这些原文。没有出现在原文里的法条和案号，不要写。",
    "不要选定诉请、胜负或文书结构。",
    "不要补充当事人的事实。",
    "用中文，尽量短。只返回回答。",
    "",
    ...blocks,
  ].join("\n");
}

export async function revisePassage(
  instruction: string,
  passage: string,
  sources: DraftSource[],
): Promise<{ text: string } | { error: string }> {
  const answered = await chat(
    draftSystem(sources),
    [
      {
        role: "lawyer",
        body: `只改写下面这一段。只返回改写后的这一段，不要返回全文。\n怎么改：${instruction}\n这一段：${passage}`,
      },
    ],
    0,
  );
  if ("error" in answered) return answered;
  const text = answered.text.replace(/^```[\w]*\n?|```$/g, "").trim();
  if (!text) return { error: "模型没有答上。" };
  return { text: text.slice(0, 4_000) };
}

function draftSystem(sources: DraftSource[]) {
  const blocks = sources.map((source, index) => {
    const kind = source.kind === "law" ? "法条" : "案例";
    return `出处${index + 1}（${kind}）${source.title}\n${source.text}`;
  });
  return [
    "你在根据律师已经勾选的出处写一段短文。",
    "只使用下面这些原文。没有出现在原文里的法条、案号和事实，不要写。",
    "不要选定诉请、胜负或文书结构。文书种类由律师另填。",
    "不要套用起诉状、答辩状或固定的当事人格式。",
    "用中文，尽量短。只返回正文。",
    "",
    ...blocks,
  ].join("\n");
}

export async function extractCaseDraft(
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
): Promise<ExtractedCase | { error: string }> {
  const answered = await chat(EXTRACT, turns, 0);
  if ("error" in answered) return answered;
  return parseExtract(answered.text);
}

const INTAKE_READ = [
  "下面是一份法律文书。只根据原文抽出预填项。看不出的留空字符串，不要编，不要补。不要指定谁是客户。",
  "当事人只收文首用身份领起的人，例如原告、被告、答辩人、被答辩人、上诉人、申请人。事实叙述里提到的其他人不要列入。每个人单独一项。诉讼地位照原文。统一社会信用代码只有原文写了才填。",
  "法院、检察院、公安机关、复议机关、仲裁委员会写入 organs。其余人写入 people。",
  "案由写案由名称，不要写案号。案由、请求都必须是原文里连续出现的字，不要改写。",
  "请求 mandate 只抄向法院提出的那一句原文。",
  "基本事实不要重写，也不要整段抄回。factsStart 抄基本情况或事实与理由正文的开头约十五个字，factsEnd 抄这一节正文的结尾约十五个字。不要把后面的法律意见算进去。",
  "只返回 JSON，不要其他字：",
  '{"people":[{"name":"","position":"","idNumber":""}],"organs":[{"name":"","position":"","idNumber":""}],"cause":"","mandate":"","factsStart":"","factsEnd":""}',
].join("\n");

export async function extractIntake(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const body = trimmed.length <= 20_000 ? trimmed : `${trimmed.slice(0, 16_000)}\n\n${trimmed.slice(-4_000)}`;
  return chat(INTAKE_READ, [{ role: "lawyer", body }], 0, undefined, 2_000, true);
}

function streamAnswerField(onDelta: (text: string) => void) {
  let raw = "";
  let emitted = 0;
  let closed = false;
  return (chunk: string) => {
    if (closed) return;
    raw += chunk;
    const key = raw.search(/"answer"\s*:/);
    if (key < 0) return;
    const colon = raw.indexOf(":", key);
    let index = colon + 1;
    while (index < raw.length && /\s/.test(raw[index] ?? "")) index += 1;
    if (raw[index] !== '"') return;
    index += 1;
    let out = "";
    while (index < raw.length) {
      const char = raw[index] ?? "";
      if (char === "\\") {
        if (index + 1 >= raw.length) return;
        const next = raw[index + 1] ?? "";
        out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
        index += 2;
        continue;
      }
      if (char === '"') {
        closed = true;
        break;
      }
      out += char;
      index += 1;
    }
    if (out.length > emitted) {
      onDelta(out.slice(emitted));
      emitted = out.length;
    }
  };
}

export async function summarizeHistory(text: string): Promise<{ text: string } | { error: string }> {
  return chat(
    [
      "把更早的对话收成一条办案备忘，供后面接着回答。",
      "只保留：当事人、已确认的事实、待核实、已经定下的事、还没做完的事。",
      "不要抄照片、PDF、案卷或文件的大段正文。",
      "不要编对话里没有的内容。有新说法时，用新的替换备忘里过时的说法。",
      "用中文，不超过 1200 字。只返回备忘正文。",
    ].join("\n"),
    [{ role: "lawyer", body: text }],
    0,
    undefined,
    1_600,
  );
}

export async function modelText(
  system: string,
  user: string,
  maxTokens = 4_000,
): Promise<{ text: string } | { error: string }> {
  return chat(system, [{ role: "lawyer", body: user }], 0.2, undefined, maxTokens);
}

async function chat(
  system: string,
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
  temperature: number,
  onDelta?: (text: string) => void,
  maxTokens = 800,
  json = false,
): Promise<{ text: string } | { error: string }> {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) return { error: "模型没有接上。" };
  if (turns.length === 0) return { error: "模型没有答上。" };

  let response: Response;
  try {
    response = await fetch(MODEL_URL, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature,
        max_tokens: maxTokens,
        stream: Boolean(onDelta),
        ...(json && !onDelta ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: withClock(system) },
          ...turns.map((turn) => ({
            role: turn.role === "lawyer" ? "user" : "assistant",
            content: turn.body,
          })),
        ],
      }),
    });
  } catch {
    return { error: "模型没有答上。" };
  }

  if (!response.ok) return { error: "模型没有答上。" };
  if (!onDelta) {
    const payload = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    } | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return { error: "模型没有答上。" };
    return { text: content.trim() };
  }
  if (!response.body) return { error: "模型没有答上。" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
        const piece = payload.choices?.[0]?.delta?.content;
        if (typeof piece !== "string" || !piece) continue;
        full += piece;
        onDelta(piece);
      } catch {
        continue;
      }
    }
  }
  if (!full.trim()) return { error: "模型没有答上。" };
  return { text: full.trim() };
}

export type ToolSpec = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export async function selectTool(
  system: string,
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
  tools: ToolSpec[],
  onDelta?: (text: string) => void,
  onReset?: () => void,
  choice: "auto" | "required" = "auto",
): Promise<{ calls: ModelToolCall[]; text: string } | { error: string }> {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) return { error: "模型没有接上。" };
  if (turns.length === 0 || tools.length === 0) return { calls: [], text: "" };

  let response: Response;
  try {
    response = await fetch(MODEL_URL, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0,
        max_tokens: 800,
        stream: true,
        tool_choice: choice,
        messages: [
          { role: "system", content: withClock(system) },
          ...turns.map((turn) => ({
            role: turn.role === "lawyer" ? "user" : "assistant",
            content: turn.body,
          })),
        ],
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      }),
    });
  } catch {
    return { error: "模型没有答上。" };
  }
  if (!response.ok || !response.body) return { error: "模型没有答上。" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let emitted = false;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  const take = (raw: string) => {
    const payload = JSON.parse(raw) as {
      choices?: Array<{
        delta?: {
          content?: unknown;
          tool_calls?: Array<{
            index?: unknown;
            id?: unknown;
            function?: { name?: unknown; arguments?: unknown };
          }>;
        };
      }>;
    };
    const delta = payload.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      if (calls.size === 0) {
        emitted = true;
        onDelta?.(delta.content);
      }
    }
    for (const call of delta.tool_calls ?? []) {
      const index = typeof call.index === "number" ? call.index : 0;
      const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (typeof call.id === "string" && call.id) current.id = call.id;
      if (typeof call.function?.name === "string") current.name += call.function.name;
      if (typeof call.function?.arguments === "string") current.arguments += call.function.arguments;
      calls.set(index, current);
    }
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        take(data);
      } catch {
        continue;
      }
    }
  }
  const parsed = [...calls.values()]
    .filter((call) => call.name.trim())
    .slice(0, 1)
    .map((call) => ({
      id: call.id || crypto.randomUUID(),
      name: call.name.trim(),
      arguments: call.arguments,
    }));
  if (parsed.length > 0) {
    if (emitted) onReset?.();
    return { calls: parsed, text: "" };
  }
  return { calls: [], text: text.trim() };
}

function parseExtract(text: string): ExtractedCase {
  const empty = { parties: [], cause: "", facts: "" };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return empty;
  }
  if (!data || typeof data !== "object") return empty;
  const record = data as Record<string, unknown>;
  return {
    parties: partyRows(record.parties),
    cause: plain(record.cause),
    facts: plain(record.facts),
  };
}

function plain(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text === "待核实") return "";
  return text.slice(0, 20_000);
}

function partyRows(value: unknown): ExtractedParty[] {
  if (!Array.isArray(value)) return [];
  const rows: ExtractedParty[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const position = plain(record.position).slice(0, 200);
    const idNumber = plain(record.idNumber).toUpperCase().slice(0, 40);
    const names = splitNames(plain(record.name));
    names.forEach((name, index) => {
      if (rows.some((row) => row.name === name) || rows.length >= 50) return;
      rows.push({
        name,
        position: index === 0 ? position : "",
        idNumber: names.length === 1 ? idNumber : "",
        role: organName(name) || record.role === "organ" ? "organ" : "opposing",
      });
    });
  }
  return rows;
}

function splitNames(name: string) {
  return name
    .split("、")
    .map((item) => item.trim())
    .filter((item) => item && item !== "待核实")
    .map((item) => item.slice(0, 200));
}

function organName(name: string) {
  return /人民法院|人民检察院|公安局|公安分局|复议机关|仲裁委员会/.test(name);
}
