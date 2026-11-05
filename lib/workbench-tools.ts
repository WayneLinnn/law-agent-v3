import { database } from "@/lib/db";
import { findAcross } from "@/lib/find";
import { parseIntake } from "@/lib/intake";
import { listJudges, saveJudge } from "@/lib/judges";
import { createDraft, listMatters } from "@/lib/matters";
import { acceptCaseName, acceptClient } from "@/lib/new-case";
import { asksAllPhotos, bundlePhotos, focusForQuestion } from "@/lib/long-text";
import { answerFromHits, answerFromRecord, type ToolSpec } from "@/lib/model";
import { asksUploadList, catalogUploads, listPhotos, materializeUpload, readUpload } from "@/lib/uploads";
import { runConsult } from "@/lib/consult-graph";
import { runFindCases } from "@/lib/find-cases-graph";
import { candidateLines, rememberCandidates, searchRetrieval } from "@/lib/retrieval";
import { listDue } from "@/lib/tasks";

const field = (description: string) => ({ type: "string", description });

export const workbenchTools: ToolSpec[] = [
  {
    name: "list_cases",
    description: "列出这个人已有的案子。问有哪些案子、案子列表时调用。返回名称、状态和客户。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_case",
    description:
      "新建一张草稿。开一张卡、新建案子时调用。clientName 和 caseName 都要有。给我、我、你不是客户。缺任何一个都不要调用。text 是起诉状或说明，只用来预填，原告不会自动变成客户。",
    parameters: {
      type: "object",
      properties: {
        clientName: field("客户名称"),
        caseName: field("案件名称"),
        text: field("起诉状或说明，没有就空着"),
      },
      required: ["clientName", "caseName"],
    },
  },
  {
    name: "list_todos",
    description: "列出各案已经确认、会出现在工作台上的待办。问待办或到期时调用。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "consult",
    description:
      "要法律结论、能否、有没有权、怎么主张，或要算出受理费、保全费、执行费、经济补偿、利息时调用。结果只留在这段对话，不写入任何案子。",
    parameters: {
      type: "object",
      properties: { question: field("要问的法律问题") },
      required: ["question"],
    },
  },
  {
    name: "find_cases",
    description:
      "要一批案例，包括按案号、案情、争议焦点、裁判口径、多年份和罪名找。只归纳案例，不另写法律结论，不写入任何案子。",
    parameters: {
      type: "object",
      properties: { question: field("要找的案例") },
      required: ["question"],
    },
  },
  {
    name: "ask_law",
    description:
      "只把法条和案例列出来时调用。要法律结论用 consult，要一批案例用 find_cases。对话不写入任何案子。",
    parameters: {
      type: "object",
      properties: { question: field("要问的法律问题") },
      required: ["question"],
    },
  },
  {
    name: "offer_file_take",
    description:
      "把这段工作台里已经有的问答收成一个新案子。律师说立案、带走、收进案子、把刚才的问答立成案件时调用，不要求原话是「立案并带走」。只是新开空卡、没有要带走的问答时不要调用。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "find",
    description:
      "按字查找已经建档的案子名称、客户和案卷材料。首页对话里放入、还没立案的文件不要用这个。",
    parameters: {
      type: "object",
      properties: { query: field("要找的字") },
      required: ["query"],
    },
  },
  {
    name: "judges",
    description:
      "法官通讯录。只问列表或查找时传 query。新增或改写时传 name，可选 court、division、contact、note。本案挂接用案子里的 link_judge。",
    parameters: {
      type: "object",
      properties: {
        query: field("查找关键字，只读时用"),
        name: field("法官姓名，新增或改写时必填"),
        court: field("法院"),
        division: field("庭室"),
        contact: field("联系方式"),
        note: field("备注"),
      },
      required: [],
    },
  },
  {
    name: "read_upload",
    description:
      "读取本段对话已经放入的一份文件，并按律师这句话作答。放入时只留原件，调用时才抽出文字。提到文件里的公司、人名，或要据此写起诉建议、总结时调用。问上传了哪些文件时也调用，filename 空着。filename 可以是文件名的一部分。空着就读最近一份。要汇总所有照片时也调用，程序会改成读完全部照片。",
    parameters: {
      type: "object",
      properties: { filename: field("文件名，可空") },
    },
  },
];

function argsOf(raw: string) {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function questionOf(raw: string) {
  const args = argsOf(raw);
  if (!args) return "";
  return textOf(args.question);
}

export async function runWorkbenchTool(
  name: string,
  raw: string,
  asked = "",
  threadId?: string,
  onDelta?: (text: string) => void,
): Promise<{ text: string } | { error: string; status: 400 | 502 }> {
  if (name === "list_cases") return { text: await formatCases() };
  if (name === "list_todos") return { text: await formatTodos() };
  if (name === "create_case") return openCase(raw);
  if (name === "consult") return { text: (await runConsult(asked)).text };
  if (name === "find_cases") return { text: (await runFindCases(asked)).text };
  if (name === "ask_law") return askLaw(questionOf(raw) || asked, threadId, onDelta);
  if (name === "find") {
    const args = argsOf(raw) ?? {};
    return { text: await findAcross(textOf(args.query) || asked) };
  }
  if (name === "judges") return handleJudges(raw);
  if (name === "read_upload") return answerUpload(raw, asked, threadId, onDelta);
  return { error: "这个工作台工具还没接上。", status: 400 };
}

function lawyerMessageId(threadId: string) {
  const row = database()
    .prepare(
      `SELECT id FROM messages
       WHERE thread_id = ? AND role = 'lawyer' AND proposal_kind = ''
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(threadId) as { id: string } | undefined;
  return row?.id ?? "";
}

async function handleJudges(raw: string) {
  const args = argsOf(raw) ?? {};
  const name = textOf(args.name);
  if (name) {
    const saved = await saveJudge({
      name,
      court: textOf(args.court),
      division: textOf(args.division),
      contact: textOf(args.contact),
      note: textOf(args.note),
    });
    if ("error" in saved) return { error: saved.error, status: saved.status };
    return { text: `已记下法官：${name}${textOf(args.court) ? `（${textOf(args.court)}）` : ""}。` };
  }
  const rows = await listJudges(textOf(args.query));
  if (rows.length === 0) return { text: "通讯录还没有法官。" };
  return {
    text: [
      "法官：",
      ...rows.map(
        (row) =>
          `- ${row.name}${row.court ? ` · ${row.court}` : ""}${row.division ? ` · ${row.division}` : ""}${row.contact ? ` · ${row.contact}` : ""}`,
      ),
    ].join("\n"),
  };
}

async function answerUpload(raw: string, asked: string, threadId?: string, onDelta?: (text: string) => void) {
  if (!threadId) return { error: "还没有对话，文件没处可放。", status: 400 as const };
  if (asksAllPhotos(asked)) return answerAllPhotos(asked, threadId, onDelta);
  if (asksUploadList(asked)) return { text: catalogUploads(threadId) };
  const args = argsOf(raw) ?? {};
  const file = readUpload(threadId, textOf(args.filename));
  if (!file) return { text: "这段对话里还没有对上的文件。先把文件放进下面的框。" };
  await materializeUpload(threadId, file.filename);
  const ready = readUpload(threadId, file.filename);
  if (!ready?.text) return { text: `${file.filename}：${ready?.note || file.note || "没有抽出文字。"}` };
  const focused = focusForQuestion(ready.text, asked);
  const record = [
    `文件《${ready.filename}》（${ready.kind}）正文如下。`,
    ready.note ? `识别说明：${ready.note}` : "",
    "律师要总结、写起诉建议或要点时，按正文整理，可以写。",
    "事实、人名、金额、日期只用正文里有的。正文没写的标成待核实，不要编，也不要拒绝起草。",
    "若有文末主文，回答涉及裁判结果时必须用到。",
    focused,
  ]
    .filter(Boolean)
    .join("\n");
  const answered = await answerFromRecord(
    [{ role: "lawyer", body: asked || "请根据这份文件说一下要点。" }],
    record,
    onDelta,
    record.length,
  );
  if ("error" in answered) return { error: answered.error, status: 502 as const };
  return { text: answered.text };
}

export async function answerAllPhotos(asked: string, threadId?: string, onDelta?: (text: string) => void) {
  if (!threadId) return { error: "还没有对话，文件没处可放。", status: 400 as const };
  const photos = listPhotos(threadId);
  if (photos.length === 0) return { text: "这段对话里没有照片。" };
  await materializeUpload(threadId, "", "照片");
  const ready = listPhotos(threadId);
  const record = [
    "律师要求把这段对话里的照片都读完再汇总。",
    "每一张有字的都要写进汇总，每张至少一句，不要因为求短漏掉任何一张。没有字的要点明是哪一张。",
    "事实、人名、金额、日期只用各张正文里有的。没有的标成待核实，不要编。",
    bundlePhotos(ready),
  ].join("\n");
  const answered = await answerFromRecord(
    [{ role: "lawyer", body: asked || "请把这些照片汇总一下。" }],
    record,
    onDelta,
    record.length,
  );
  if ("error" in answered) return { error: answered.error, status: 502 as const };
  return { text: answered.text };
}

async function askLaw(question: string, threadId?: string, onDelta?: (text: string) => void) {
  const text = question.trim();
  if (!text) return { error: "请写下要问的话。", status: 400 as const };
  const found = await searchRetrieval(text, null);
  if ("error" in found) return { error: found.error, status: found.status };
  if (found.items.length === 0) return { text: "没有查到可依据的法条或案例。" };
  if (threadId) {
    const messageId = lawyerMessageId(threadId);
    if (messageId) {
      rememberCandidates({
        threadId,
        messageId,
        question: text,
        query: found.query,
        items: found.items,
      });
    }
  }
  const answered = await answerFromHits(
    text,
    found.items.map((item) => ({
      kind: item.kind,
      title: item.title,
      text: item.text,
      url: item.url,
    })),
    onDelta,
  );
  if ("error" in answered) return { error: answered.error, status: 502 as const };
  const extra = `\n\n依据候选：\n${candidateLines(found.items).join("\n")}`;
  onDelta?.(extra);
  return { text: `${answered.text}${extra}` };
}

async function formatCases() {
  const matters = await listMatters();
  if (matters.length === 0) return "还没有案子。";
  const lines = ["案子："];
  for (const matter of matters) {
    const client = matter.parties.find((party) => party.role === "client");
    lines.push(
      `- [${matter.name}](/matters/${matter.id}) · ${matter.status} · 客户 ${client?.name || "还没写"}`,
    );
  }
  return lines.join("\n");
}

async function formatTodos() {
  const desk = await listDue();
  if (desk.due.length === 0) return "还没有确认的待办。";
  const lines = ["待办："];
  for (const task of desk.due) {
    lines.push(
      `- ${task.name} · ${task.dueOn} · [${task.matterName}](/matters/${task.matterId})${task.overdue ? " · 已过期" : ""}`,
    );
  }
  return lines.join("\n");
}

async function openCase(raw: string) {
  const args = argsOf(raw);
  if (!args) return { error: "没有读懂提交的内容。", status: 400 as const };
  const clientName = acceptClient(textOf(args.clientName));
  const caseName = acceptCaseName(textOf(args.caseName));
  if (!clientName || !caseName) {
    const missing = [clientName ? "" : "客户名称", caseName ? "" : "案件名称"].filter(Boolean).join("和");
    return { text: `要新建案子，还缺${missing}。客户名称和案件名称都要有。` };
  }
  const pasted = textOf(args.text);
  const read = pasted ? parseIntake(pasted) : null;
  const saved = await createDraft({
    clientName,
    name: caseName,
    people: read?.people ?? [],
    organs: read?.organs ?? [],
    cause: read?.cause ?? "",
    facts: read?.facts ?? "",
    mandate: read?.mandate ?? "",
  });
  if ("error" in saved) return saved;
  return {
    text: `已开一张草稿。[打开案子](/matters/${saved.id})。客户是${clientName}，案件名称是${caseName}。`,
  };
}
