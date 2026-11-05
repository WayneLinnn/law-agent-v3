import "server-only";

import { connection } from "next/server";

import {
  archiveMatter,
  confirmClosing,
  resolveTask,
  saveOutcome,
  saveStatement,
  unarchiveMatter,
} from "@/lib/closings";
import { database } from "@/lib/db";
import { currentDraft, reviseCurrentDraft, writeDraftMessage } from "@/lib/drafts";
import { asksPanel, panelLines, panelReply } from "@/lib/panel-sign";
import { searchChoice } from "@/lib/legal-turn";
import { addTextMaterial, listMaterials as loadMaterials, materializeMaterials, type MaterialRecord } from "@/lib/materials";
import { dayFromSpeech, relativeDay } from "@/lib/clock";
import { answerFromHits, answerFromRecord, clockLine, judgeFromSources, selectTool, type ToolSpec } from "@/lib/model";
import { asksAllPhotos, bundlePhotos, focusForQuestion } from "@/lib/long-text";
import { materialState } from "@/lib/material-state";
import { wantsFileTake, wantsNewCase } from "@/lib/new-case";
import { runConsult } from "@/lib/consult-graph";
import { runFindCases } from "@/lib/find-cases-graph";
import { runPlead } from "@/lib/plead-graph";
import { listNotes as loadNotes, recordNote } from "@/lib/notes";
import { addNode, listNodes, nodeDocument, writeNodesFromText, writeReport } from "@/lib/nodes";
import {
  acceptCandidates,
  candidateLines,
  listCandidates,
  rememberCandidates,
  searchRetrieval,
} from "@/lib/retrieval";
import { generateContractReview, isContractRevise, reviseContractCards } from "@/lib/contract-review";
import { isContractScale } from "@/lib/contract-scales";
import { complianceReview, getReview, listReviews } from "@/lib/reviews";
import { addTask, confirmTask, describeDue, listTasks as loadTasks, updateTask } from "@/lib/tasks";

const HINT =
  /列出|有哪些|读一下|读这份|材料|待办|当事人|开庭|日程|到期|改成|改为|改写|加上|增加|删掉|删除|去掉|记下|记一条|证明对象|已记下|时间线|待核清单|路径|找到|总结|经过|案情|提醒|会见|内容|起诉状|签证|查法宝|查 ?Alpha|查法条|查案例|法律问题|赔偿责任|收下|起草|答辩|代理词|写成文书|写一份|归档|解档|结案|汇报|节点|法官|扫描|扫入|审合同|合同审查|制度审查|合规/;

const DELETE_KINDS = new Set(["待办", "当事人", "时间线", "待核清单", "路径"]);
const READ_TOOLS = new Set([
  "list_materials",
  "read_material",
  "list_tasks",
  "list_parties",
  "list_notes",
  "search",
  "report",
]);
const LIST_ONLY = new Set(["list_materials", "list_tasks", "list_parties", "list_notes"]);
const ARCHIVED_OK = new Set([
  "list_materials",
  "read_material",
  "list_tasks",
  "list_parties",
  "list_notes",
  "search",
  "nodes",
  "report",
  "reply",
  "reopen_case",
]);
const MUTATING = new Set([
  "add_task",
  "set_facts",
  "set_mandate",
  "set_proves",
  "delete_record",
  "add_note",
  "add_party",
  "set_cause",
  "save_source",
  "draft",
  "plead",
  "judge_question",
  "close_case",
  "link_judge",
  "scan",
  "review_contract",
  "save_opinion",
  "ask_contract",
  "compliance_review",
]);
const NO_CHECKED_SOURCE = "没有勾选出处。这一问先不写结论，也不把法条和案号写成依据。";

const field = (description: string) => ({ type: "string", description });

export const caseTools: ToolSpec[] = [
  {
    name: "reply",
    description:
      "只回答，不写记录。闲聊、解释、问今天几号、证据够不够、用材料原句回答时调用。不要用它记下节点、待办或任何案件内容。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_materials",
    description: "列出或查找这件案子的材料。律师要找证据、找某类文件时也调用。只要文件名和文字状态。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_material",
    description:
      "读取一份材料。放入时只留原件，调用时才抽出文字。txt、md、Word、PDF、Excel、照片都可以。filename 可以是完整文件名，也可以是其中一段。要汇总所有照片时不要调用。",
    parameters: {
      type: "object",
      properties: { filename: field("材料文件名") },
      required: ["filename"],
    },
  },
  {
    name: "list_tasks",
    description: "列出待办的名称、到期日，以及已确认或未确认。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_parties",
    description: "列出当事人的角色、姓名和诉讼地位。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_notes",
    description: "列出已记下的时间线、待核清单和路径。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "search",
    description: "在本案的材料、待办和已记下里按字查找。query 用要找的字。不要拿来查法宝。",
    parameters: {
      type: "object",
      properties: { query: field("要找的字") },
      required: ["query"],
    },
  },
  {
    name: "add_task",
    description:
      "直接记下一条待办，待办页能看见。只有律师说待办、提醒、日程、到期，或还没到的开庭时才调用。日期已经过去的经过，包括一审开庭，不要调用，改用 nodes。name 写事项本身。昨天、明天、周几由程序换算，dueOn 可以不传。律师有没有说放到工作台，由系统自己看原句，不要另传字段。",
    parameters: {
      type: "object",
      properties: {
        name: field("待办名称"),
        dueOn: field("到期日 YYYY-MM-DD"),
      },
      required: ["name"],
    },
  },
  {
    name: "set_facts",
    description: "准备改写后的整段基本事实，先停在待确认。text 是改完后的整段，不是只写新增的一句。",
    parameters: {
      type: "object",
      properties: { text: field("改完后的整段基本事实") },
      required: ["text"],
    },
  },
  {
    name: "set_mandate",
    description: "准备改写后的整段委托事项，先停在待确认。text 是改完后的整段。",
    parameters: {
      type: "object",
      properties: { text: field("改完后的整段委托事项") },
      required: ["text"],
    },
  },
  {
    name: "set_proves",
    description: "准备某一份材料的证明对象，先停在待确认。filename 用清单里的文件名。",
    parameters: {
      type: "object",
      properties: {
        filename: field("材料文件名"),
        proves: field("证明对象"),
      },
      required: ["filename", "proves"],
    },
  },
  {
    name: "delete_record",
    description:
      "准备删除一条已有记录，先停在待确认。kind 只能是待办、当事人、时间线、待核清单、路径。待办和当事人的 name 必须和清单里已有的名称一致。不能删除客户。",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["待办", "当事人", "时间线", "待核清单", "路径"], description: "要删的种类" },
        name: field("待办或当事人的现有名称。时间线、待核清单、路径可以空着"),
      },
      required: ["kind"],
    },
  },
  {
    name: "add_note",
    description: "直接记下待核清单或路径。时间线不要用这个工具，改调用 nodes。text 用律师写的内容。",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["时间线", "待核清单", "路径"], description: "要记的种类" },
        text: field("要记的内容"),
      },
      required: ["kind", "text"],
    },
  },
  {
    name: "add_party",
    description: "准备增加一名对方或办案机关，先停在待确认。不能用来改客户。",
    parameters: {
      type: "object",
      properties: {
        name: field("姓名或名称"),
        position: field("诉讼地位，没有就空着"),
      },
      required: ["name"],
    },
  },
  {
    name: "set_cause",
    description: "准备改写案由，先停在待确认。text 用律师写的案由。",
    parameters: {
      type: "object",
      properties: { text: field("案由") },
      required: ["text"],
    },
  },
  {
    name: "consult",
    description:
      "要结论、要法条依据的法律问题。先查法规再回答，结果只留在对话里，不写入案子，不出现在右边。不要用于答辩状、代理词的勾选。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_cases",
    description:
      "要一批案例时调用，包括按案号、案情、争议焦点、裁判口径、罪名找。只列案例并归纳，不另写法律结论。不写入案子，不出现在右边的勾选列表。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_pkulaw",
    description:
      "只要把候选列到右边。query 写成检索句，不要带当事人姓名。写起诉状、上诉状、答辩状、代理词不要调用，那些走 plead。律师说不查时不要调用。",
    parameters: {
      type: "object",
      properties: { query: field("检索句或法律问题") },
      required: ["query"],
    },
  },
  {
    name: "save_source",
    description:
      "律师说收下右边第几条时调用。indexes 写序号，从 1 开始，多个用逗号，例如 1 或 1,2。",
    parameters: {
      type: "object",
      properties: { indexes: field("要收的序号，例如 1 或 1,2") },
      required: ["indexes"],
    },
  },
  {
    name: "draft",
    description:
      "旧文书框。起诉状、上诉状、答辩状、代理词不要调用，那些走 plead。",
    parameters: {
      type: "object",
      properties: {
        kind: field("文书种类，例如答辩状"),
        instruction: field("要写的内容，或怎么改"),
        passage: field("要改的原段落，新写时空着"),
      },
      required: ["kind"],
    },
  },
  {
    name: "plead",
    description:
      "写民事起诉状、民事上诉状、答辩状或代理词。律师只说种类、槽位没写全时也调用。不要用 draft。对话里不要贴全文。",
    parameters: {
      type: "object",
      properties: { kind: field("民事起诉状或民事上诉状") },
      required: [],
    },
  },
  {
    name: "judge_question",
    description:
      "按已经收进本案的出处分析。还没有出处时不要用它代替 consult。律师说不查时，不要编法条和案号。",
    parameters: {
      type: "object",
      properties: { question: field("要分析的问题") },
      required: ["question"],
    },
  },
  {
    name: "close_case",
    description:
      "结案并归档。说归档、结案、办结时调用。outcome 写办结结果，outcomeOn 写日期 YYYY-MM-DD，statement 写结案说明。未写齐时用合理默认并完成归档。",
    parameters: {
      type: "object",
      properties: {
        outcome: field("办结结果，例如已办结"),
        outcomeOn: field("办结日期 YYYY-MM-DD"),
        statement: field("结案说明"),
      },
      required: [],
    },
  },
  {
    name: "reopen_case",
    description: "解档。说解档、重新打开归档案子时调用。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "nodes",
    description:
      "读或记下一条办案节点。说加上今天……、电话核对、已经发生的经过、时间线时调用，不要当成待办。只问节点列表时不传 title。加上时 title 写事项，detail 可写补充。不要传 happenedOn，日期由程序按原话换算。调用后直接写入。",
    parameters: {
      type: "object",
      properties: {
        title: field("节点名称，只读时不传"),
        happenedOn: field("日期 YYYY-MM-DD"),
        detail: field("补充说明"),
      },
      required: [],
    },
  },
  {
    name: "report",
    description: "按节点、待办和已记下写本案汇报。说汇报、进展时调用。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "link_judge",
    description: "把法官挂到本案。name 写姓名，court 写法院。",
    parameters: {
      type: "object",
      properties: {
        name: field("法官姓名"),
        court: field("法院"),
        role: field("角色，默认承办法官"),
      },
      required: ["name"],
    },
  },
  {
    name: "scan",
    description: "把一段文字扫入本案材料，写成 .txt。filename 写文件名，text 写正文。",
    parameters: {
      type: "object",
      properties: {
        filename: field("文件名，例如 谈话笔录.txt"),
        text: field("要扫入的正文"),
      },
      required: ["filename", "text"],
    },
  },
  {
    name: "review_contract",
    description:
      "要按尺度出审查卡片时调用。filename 指向本案材料，或 text 写律师贴进对话的合同正文。stance 写我方在合同里的称呼。scale 只能是强势、均势、弱势。缺立场或尺度也调用。改点名的某一条也调用。对话里不要贴卡片全文。",
    parameters: {
      type: "object",
      properties: {
        filename: field("本案材料文件名"),
        text: field("贴进对话的合同正文"),
        stance: field("我方在合同中的称呼，例如买方"),
        scale: field("强势、均势或弱势"),
      },
      required: [],
    },
  },
  {
    name: "save_opinion",
    description: "收下最近一份合同审查意见。reviewId 可写编号，不写就收最近一份。",
    parameters: {
      type: "object",
      properties: { reviewId: field("审查结果编号") },
      required: [],
    },
  },
  {
    name: "ask_contract",
    description: "就最近一份合同审查结果追问。question 写问题。",
    parameters: {
      type: "object",
      properties: { question: field("问题") },
      required: ["question"],
    },
  },
  {
    name: "compliance_review",
    description: "制度或合规体检。title 写制度名，text 写正文。结果单独成页。",
    parameters: {
      type: "object",
      properties: {
        title: field("制度名称"),
        text: field("制度正文"),
      },
      required: ["text"],
    },
  },
];

export type ToolRun =
  | { status: "skip" }
  | { status: "done"; text: string; reply: boolean }
  | { status: "archived" };

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function wantsCaseTool(text: string) {
  return HINT.test(text);
}

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundArguments(raw: string) {
  const args = argsOf(raw);
  if (!args) return raw;
  delete args.matterId;
  delete args.matter_id;
  return JSON.stringify(args);
}

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

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function archived(matterId: string) {
  const row = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  return row?.status === "已归档";
}

function toolsFor(matterId: string) {
  if (archived(matterId)) return caseTools.filter((tool) => ARCHIVED_OK.has(tool.name));
  return caseTools;
}

function today() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function insertProposal(threadId: string, kind: string, body: string, payload: string) {
  database()
    .prepare(
      `INSERT INTO messages (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      ) VALUES (?, ?, 'model', '问答', ?, ?, ?, NULL, ?)`,
    )
    .run(crypto.randomUUID(), threadId, body, kind, payload, stamp());
}

function pendingTexts(matterId: string) {
  const rows = database()
    .prepare(
      `SELECT read_text FROM materials
       WHERE matter_id = ? AND text_status = '待核对' AND read_text != ''`,
    )
    .all(matterId) as Array<{ read_text: string }>;
  return rows.map((row) => row.read_text.replace(/\s+/g, "")).filter((text) => text.length >= 8);
}

function guard(matterId: string, text: string) {
  const pending = pendingTexts(matterId);
  if (pending.length === 0 || text.includes("待核实")) return text;
  const compact = text.replace(/\s+/g, "");
  const hit = pending.some((item) => item.includes(compact) || compact.includes(item));
  return hit ? `${text}（待核实）` : text;
}

function indexOf(matterId: string) {
  const db = database();
  const materials = db
    .prepare("SELECT filename, text_status FROM materials WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ filename: string; text_status: string }>;
  const tasks = db
    .prepare("SELECT name, due_on, confirmed_at FROM tasks WHERE matter_id = ? ORDER BY due_on, rowid")
    .all(matterId) as Array<{ name: string; due_on: string; confirmed_at: string | null }>;
  const parties = db
    .prepare("SELECT role, name, position FROM parties WHERE matter_id = ? ORDER BY rowid")
    .all(matterId) as Array<{ role: string; name: string; position: string }>;
  const notes = db
    .prepare("SELECT kind FROM notes WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ kind: string }>;
  const roleName = { client: "客户", opposing: "对方", organ: "办案机关" } as const;
  const lines = ["材料："];
  if (materials.length === 0) lines.push("还没有。");
  for (const material of materials) lines.push(`- ${material.filename} ${material.text_status === "没有可用文字" ? "还没读" : material.text_status}`);
  lines.push("待办：");
  if (tasks.length === 0) lines.push("还没有。");
  for (const task of tasks) {
    lines.push(`- ${task.name} ${task.due_on} ${task.confirmed_at ? "已确认" : "未确认"}`);
  }
  lines.push("当事人：");
  if (parties.length === 0) lines.push("还没有。");
  for (const party of parties) {
    const role = roleName[party.role as keyof typeof roleName] ?? party.role;
    lines.push(`- ${role} ${party.name}${party.position ? ` ${party.position}` : ""}`);
  }
  lines.push("已记下：");
  if (notes.length === 0) lines.push("还没有。");
  for (const note of notes) lines.push(`- ${note.kind}`);
  return lines.join("\n");
}

export function outsideCaseReply(text: string) {
  if (wantsNewCase(text)) return "已经在这件案子里。要另开一张卡，回工作台。";
  if (wantsFileTake(text)) return "这段对话已经挂在案子上。立案并带走只用在工作台。";
  if (/各案待办|所有案子的待办|待办总表|全部待办/.test(text)) return "todos";
  if (/有哪些案子|案子列表|全部案子|所有案子|列出案子/.test(text)) {
    return "现在打开的就是这件案子。要看全部案子，回工作台。";
  }
  if (/别的案子|其他案子|另一个案子|跨案/.test(text) && /找|查|搜|材料|文件/.test(text)) {
    return "不跨案查找。这里只查本案左侧的材料。要找别的案子，回工作台。";
  }
  if (/工作台/.test(text) && /文件|上传|照片|放入/.test(text)) {
    return "工作台对话里的文件不在这里。本案只读左侧材料。";
  }
  if (/法官通讯录|有哪些法官|法官列表|全部法官|合作过的法官|法官都有谁/.test(text) && !/挂/.test(text)) {
    return "整本法官通讯录在工作台。这里只能把法官挂到本案。";
  }
  return "";
}

export function systemFor(matterId: string) {
  return [
    "你在这件案子里办事。每一句都要调用一个工具。闲聊和解释调用 reply，reply 不写记录。程序执行你选的工具，不另改类别。没有调用写入工具就不要说已记下。",
    "先看律师这一句，选一个工具。同一种列出只调用一次。读材料读到对上的那一份就停。改记录、加节点、查 Alpha、起草，做完一次就停。",
    "人已经在这件案子里。不要新建案子，不要立案并带走，不要列出别的案子，不要列各案待办，不要到别的案子里找，不要读工作台对话里的文件。",
    "列出或读取材料、待办、到期、当事人、已记下时，调用对应工具。读左侧材料时调用 read_material 一次。要汇总所有照片时不要调用 read_material。写新文书时不要把材料原文贴进回复。",
    "待办只列本案，调用 list_tasks 或 add_task。",
    "在本案材料、待办、已记下里按字查找时调用 search。",
    "说待办、提醒、日程、到期，以及还没到的开庭时，调用 add_task。name 用律师写的名称，不要改写。昨天、明天、周几由程序换算，不要自己填日期。调用后就写入待办页，回复只报这一条。日期已经过去的经过，包括一审开庭，调用 nodes。",
    "律师给出「日期前加事项」，或要改已有待办的名称时，由程序改右侧那一条。没有改到记录，就不要说已记下或已更新。上一条还没确认，也不挡住下一条。",
    "记待核清单、路径时调用 add_note，直接写入。已经发生的经过、时间线调用 nodes，直接写入节点。右侧时间线按日期列出这些节点。改基本事实、委托事项、证明对象、案由，删除一条，增加当事人，调用对应工具。写入的文字用律师写的那一句。",
    "民事起诉状、民事上诉状、答辩状、代理词调用 plead，不要调用 draft。槽位没写全也调用 plead。对话里不要贴全文。",
    "要结论、要法条依据的法律问题调用 consult。结果只留在对话里。",
    "要一批案例，包括按案号、案情、罪名找，调用 find_cases。只归纳案例，不另写法律结论，不写入案子。",
    "只要把候选列到右边时，调用 search_pkulaw。query 不要带当事人姓名。写文书走 plead，不在右边勾选。",
    "按已经收进本案的出处分析时，调用 judge_question。",
    "律师说收下右边第几条时调用 save_source，indexes 写序号。",
    "律师说不查、不要查、不用查时，不要调用 search_pkulaw。",
    "说归档、结案、办结时调用 close_case。说解档时调用 reopen_case。",
    "说加上今天……、节点、办案节点、电话核对、时间线这类已经发生的经过时，调用 nodes 一次，不要调用 add_task，也不要调用 add_note。title 写事项，不要传 happenedOn。只问有哪些节点时不要传 title。",
    "说出带日期的已经发生的事，调用 nodes，直接写入。不要说待确认，不要叫律师点留下。",
    "基本事实、委托事项、证明对象、当事人、案由先停在待确认。点留下才写入。回复只说这一次准备的那一项。",
    "要汇报、进展时调用 report。",
    "挂法官到本案时调用 link_judge。不要打开整本通讯录。把文字扫进材料时调用 scan。",
    "要按尺度出审查卡片时调用 review_contract。问法律结论走 consult，找一批案例走 find_cases，写起诉状走 plead，写答辩状走 draft。收下审查意见调用 save_opinion。就审查结果追问调用 ask_contract。",
    "制度审查、合规体检调用 compliance_review。",
    "闲聊、证据够不够、用资料里的原句回答时，不要调用工具。",
    "一次只调用一个。不要声称已经写入。",
    "工具只作用于当前打开的这件案子。不要填写别的案子编号。",
    "不要改客户、可用文字或实收。归档和解档只用 close_case、reopen_case。",
    "不要选定诉请、胜负或文书结构。",
    "不要编造金额或人物。不要自己填日期。昨天、明天、周几和几月几日由程序按原话换算。",
    "律师要把写好的内容存成 Word 或 PDF 时，调用 reply，不要说做不到。告诉他点「存为 Word」或「存为 PDF」，文件放进左侧材料。",
    "律师要把时间线存成 Word、PDF，或把时间线整理成文稿时，不要说做不到，不要调用 draft，不要查法条。",
    "问今天几号或现在几点时，调用 reply。",
    clockLine(),
    "",
    indexOf(matterId),
  ].join("\n");
}

function listMaterials(matterId: string) {
  const rows = database()
    .prepare("SELECT filename, text_status FROM materials WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ filename: string; text_status: string }>;
  if (rows.length === 0) return "本案还没有材料。";
  return ["材料：", ...rows.map((row) => `- ${row.filename} ${row.text_status === "没有可用文字" ? "还没读" : row.text_status}`)].join("\n");
}

function stem(filename: string) {
  return filename.replace(/\.[^.]+$/u, "").replace(/\s+/g, "");
}

function inOrder(haystack: string, needle: string) {
  if (!needle) return false;
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function findMaterial(
  matterId: string,
  filename: string,
): { row: { filename: string; text_status: string; read_text: string; usable_text: string } } | { error: string } {
  const name = filename.trim();
  if (!name) return { error: "请写上文件名。" };
  const rows = database()
    .prepare(
      "SELECT filename, text_status, read_text, usable_text FROM materials WHERE matter_id = ? ORDER BY created_at, rowid",
    )
    .all(matterId) as Array<{
    filename: string;
    text_status: string;
    read_text: string;
    usable_text: string;
  }>;
  const exact = rows.find((row) => row.filename === name);
  if (exact) return { row: exact };
  const needle = stem(name);
  if (needle.length < 2) return { error: "没有这份材料。" };
  const hits = rows.filter((row) => {
    const file = stem(row.filename);
    return file.includes(needle) || needle.includes(file) || inOrder(file, needle);
  });
  if (hits.length === 1) return { row: hits[0] };
  if (hits.length > 1) {
    return { error: `有多份接近的材料：${hits.map((row) => row.filename).join("、")}。请点明文件名。` };
  }
  return { error: "没有这份材料。" };
}

function clipText(text: string) {
  const value = text.trim();
  return value.length > 8_000 ? `${value.slice(0, 8_000)}……` : value;
}

function readMaterial(matterId: string, filename: string) {
  const found = findMaterial(matterId, filename);
  if ("error" in found) return found.error;
  const text = found.row.usable_text.trim() || found.row.read_text.trim();
  if (!text) return `${found.row.filename}\n还没读出文字。`;
  return `${found.row.filename}\n${clipText(text)}`;
}

function listTasks(matterId: string) {
  const rows = database()
    .prepare("SELECT name, due_on, confirmed_at FROM tasks WHERE matter_id = ? ORDER BY due_on, rowid")
    .all(matterId) as Array<{ name: string; due_on: string; confirmed_at: string | null }>;
  if (rows.length === 0) return "还没有待办。";
  return [
    "待办：",
    ...rows.map((row) => `- ${row.name} ${row.due_on} ${row.confirmed_at ? "已确认" : "未确认"}`),
  ].join("\n");
}

function listParties(matterId: string) {
  const rows = database()
    .prepare("SELECT role, name, position FROM parties WHERE matter_id = ? ORDER BY rowid")
    .all(matterId) as Array<{ role: string; name: string; position: string }>;
  if (rows.length === 0) return "还没有当事人。";
  const roleName = { client: "客户", opposing: "对方", organ: "办案机关" } as const;
  return [
    "当事人：",
    ...rows.map((row) => {
      const role = roleName[row.role as keyof typeof roleName] ?? row.role;
      return `- ${role} ${row.name}${row.position ? ` ${row.position}` : ""}`;
    }),
  ].join("\n");
}

function listNotes(matterId: string) {
  const rows = database()
    .prepare("SELECT kind, body FROM notes WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ kind: string; body: string }>;
  if (rows.length === 0) return "还没有记下的。";
  return [
    "已记下：",
    ...rows.map((row) => {
      const body = row.body.trim();
      return `- ${row.kind}：${body.length > 400 ? `${body.slice(0, 400)}……` : body}`;
    }),
  ].join("\n");
}

function stageText(threadId: string, matterId: string, kind: "基本事实" | "委托事项", text: string) {
  const body = guard(matterId, clipEnd(text).slice(0, 4_000));
  insertProposal(threadId, kind, body, body);
  return `${kind}先停在待确认。\n${body}`;
}

function stageProves(threadId: string, matterId: string, filename: string, proves: string) {
  const shown = guard(matterId, `${filename}\n${proves}`.slice(0, 4_000));
  if (shown.includes("待核实")) {
    insertProposal(threadId, "证明对象", shown, shown);
    return `证明对象先停在待确认。\n${shown}`;
  }
  insertProposal(threadId, "证明对象", `${filename}\n${proves}`, JSON.stringify({ filename, proves }));
  return `证明对象先停在待确认。\n${filename}\n${proves}`;
}

function stageDelete(threadId: string, matterId: string, kind: string, name: string) {
  if (!DELETE_KINDS.has(kind)) return "这一项还不能删。";
  if (kind === "待办") {
    if (!name) return "请写上要删的待办名称。";
    const task = database()
      .prepare("SELECT id FROM tasks WHERE matter_id = ? AND name = ?")
      .get(matterId, name);
    if (!task) return "没有这条待办。";
    const body = `删除：${name}`;
    insertProposal(threadId, "待办", body, JSON.stringify({ op: "delete", name }));
    return `删除先停在待确认。\n${body}`;
  }
  if (kind === "当事人") {
    if (!name) return "请写上要删的姓名。";
    const client = database()
      .prepare("SELECT id FROM parties WHERE matter_id = ? AND role = 'client' AND name = ?")
      .get(matterId, name);
    if (client) return "这一项不能改客户。";
    const party = database()
      .prepare("SELECT id FROM parties WHERE matter_id = ? AND name = ? AND role != 'client'")
      .get(matterId, name);
    if (!party) return "没有这个人。";
    const body = `删除：${name}`;
    insertProposal(threadId, "当事人", body, JSON.stringify({ op: "delete", name }));
    return `删除先停在待确认。\n${body}`;
  }
  const note = database()
    .prepare("SELECT id FROM notes WHERE matter_id = ? AND kind = ?")
    .get(matterId, kind);
  if (!note) return "没有这一项。";
  const body = `删除这条${kind}`;
  insertProposal(threadId, kind, body, JSON.stringify({ op: "delete" }));
  return `删除先停在待确认。\n${body}`;
}

function formatMaterialList(rows: MaterialRecord[]) {
  if (rows.length === 0) return "本案还没有材料。";
  return [
    "材料：",
    ...rows.map((row) => {
      const hasText = Boolean(row.usableText.trim() || row.readText.trim());
      return `- ${row.filename}${hasText ? "" : " 没有可用文字"}`;
    }),
  ].join("\n");
}

function genericFile(filename: string) {
  const name = filename.replace(/\s+/g, "");
  return !name || /^(这份|该份|这个|那个)?(材料|文件|证据)$/.test(name);
}

function showMaterial(row: MaterialRecord, asked = "") {
  const text = row.usableText.trim() || row.readText.trim();
  if (!text) return `${row.filename}\n${materialState(row)}`;
  const body = asked && text.length > 8_000 ? focusForQuestion(text, asked) : clipText(text);
  const note = row.note.trim();
  return note ? `${row.filename}\n识别说明：${note}\n${body}` : `${row.filename}\n${body}`;
}

function formatMaterialRead(rows: MaterialRecord[], filename: string, asked = "") {
  if (genericFile(filename)) {
    const withText = rows.filter((row) => row.usableText.trim() || row.readText.trim());
    if (withText.length === 0) return rows.length === 0 ? "本案还没有材料。" : "这些材料还没读出文字。";
    return withText.map((row) => showMaterial(row, asked)).join("\n\n");
  }
  const name = filename.trim();
  const exact = rows.find((row) => row.filename === name);
  if (exact) return showMaterial(exact, asked);
  const needle = stem(name);
  if (needle.length < 2) return "没有这份材料。";
  const hits = rows.filter((row) => {
    const file = stem(row.filename);
    return file.includes(needle) || needle.includes(file) || inOrder(file, needle);
  });
  if (hits.length === 1) return showMaterial(hits[0], asked);
  if (hits.length > 1) return `有多份接近的材料：${hits.map((row) => row.filename).join("、")}。请点明文件名。`;
  return "没有这份材料。";
}

function formatNoteList(rows: Array<{ kind: string; body: string }>) {
  if (rows.length === 0) return "还没有记下的。";
  return [
    "已记下：",
    ...rows.map((row) => {
      const body = row.body.trim();
      return `- ${row.kind}：${body.length > 400 ? `${body.slice(0, 400)}……` : body}`;
    }),
  ].join("\n");
}

async function searchCase(matterId: string, query: string) {
  const needle = query.trim();
  if (!needle) return "请写下要找的字。";
  const [materials, tasks, notes] = await Promise.all([
    loadMaterials(matterId),
    loadTasks(matterId),
    loadNotes(matterId),
  ]);
  const lines: string[] = [];
  for (const material of materials) {
    const blob = `${material.filename}\n${material.usableText}\n${material.readText}`;
    if (blob.includes(needle)) lines.push(`材料 ${material.filename}`);
  }
  for (const task of tasks) {
    if (`${task.name} ${task.dueOn}`.includes(needle)) lines.push(`待办 ${task.name} ${task.dueOn}`);
  }
  for (const note of notes) {
    if (`${note.kind} ${note.body}`.includes(needle)) lines.push(`笔记 ${note.kind}`);
  }
  if (lines.length === 0) return "本案没有找到。";
  return ["找到：", ...lines.map((line) => `- ${line}`)].join("\n");
}

function wantsDesk(asked: string) {
  return /工作台/.test(asked) || /确认(?:这条|该条)?待办/.test(asked) || /放到工作台|出现在工作台/.test(asked);
}

async function saveTodo(matterId: string, name: string, dueOn: string, asked: string) {
  const taskName = name.trim().slice(0, 200);
  if (!taskName || taskName === "待核实") return "请写下待办名称。";
  if (!validDay(dueOn)) return "请写下到期日，格式是 YYYY-MM-DD。";
  const saved = await addTask(matterId, { name: taskName, dueOn });
  if ("error" in saved) {
    if (saved.error === "这条待办已经有了。") return `这条待办已经有了。\n${taskName}\n${dueOn}`;
    return saved.error;
  }
  if (!wantsDesk(asked)) return `已记下待办。\n${taskName}\n${dueOn}`;
  const confirmed = await confirmTask(matterId, saved.id);
  if ("error" in confirmed) return confirmed.error;
  return `已记下待办，并出现在工作台。\n${taskName}\n${dueOn}`;
}

function spokenTodo(asked: string) {
  const labeled = asked.match(/待办[：:]\s*([^，,\n]{1,80})[，,]\s*到期日\s*(\d{4}-\d{2}-\d{2})/);
  if (labeled) return { name: labeled[1].trim(), dueOn: labeled[2] };
  const spoken = asked.match(/记(?:一条|个)待办[，,]\s*([^，,\n]+?)\s*[，,]\s*(\d{4}-\d{2}-\d{2})/);
  if (spoken) return { name: spoken[1].trim(), dueOn: spoken[2] };
  return null;
}

function instructedTodo(asked: string) {
  if (/[?？]|有哪些|列出|去哪|什么|编几个|去掉|改成|改为/.test(asked)) return null;
  const match = asked.match(/(\d{4}-\d{2}-\d{2})\s*前?\s*([\u4e00-\u9fffA-Za-z0-9][^\n]{0,80})/);
  if (!match) return null;
  const name = match[2].replace(/[。．\s]+$/g, "").trim();
  if (!name || name.length > 80) return null;
  return { dueOn: match[1], name };
}

function droppedWord(asked: string) {
  const quoted = asked.match(/[「“"']([^」”"']{1,20})[」”"']\s*(?:这两个字|两个字|二字|这几个字)?\s*去掉/);
  if (quoted) return quoted[1].trim();
  const plain = asked.match(/把([^，,。\n]{1,20}?)(?:这两个字|两个字|二字|这几个字)?去掉/);
  if (!plain) return "";
  return plain[1].replace(/^[「“"']|[」”"']$/g, "").replace(/待办|那条|这条/g, "").trim();
}

async function reviseTodo(matterId: string, asked: string) {
  if (/word|pdf|docx|对话稿/i.test(asked)) return "";
  if (/存成|存为|导出/.test(asked)) return "";
  if (!/去掉|改成|改为/.test(asked)) return "";
  const tasks = await loadTasks(matterId);
  const piece = droppedWord(asked);
  if (piece) {
    const task = tasks.find((item) => item.name.includes(piece));
    if (!task) return `没有含「${piece}」的待办。`;
    const name = task.name.replace(piece, "").replace(/\s+/g, "").trim();
    if (!name) return "去掉以后没有名称了。";
    const updated = await updateTask(matterId, task.id, { name });
    if ("error" in updated) return updated.error;
    return `已更新待办。\n${updated.name}\n${updated.dueOn}`;
  }
  const renamed =
    asked.match(/把(.+?)(?:改成|改为)\s*([^\n。]+)/) ||
    asked.match(/([^\s，,。]{2,40}?)(?:那条|这条)?(?:改成|改为)\s*([^\n。]+)/);
  if (!renamed) return "";
  const from = renamed[1].replace(/待办|那条|这条|剩下/g, "").trim();
  const name = renamed[2].replace(/待办/g, "").replace(/[。．\s]+$/g, "").trim();
  if (!from || !name) return "";
  const task = tasks.find((item) => item.name === from || item.name.includes(from) || from.includes(item.name));
  if (!task) return "";
  const updated = await updateTask(matterId, task.id, { name: name.slice(0, 200) });
  if ("error" in updated) return updated.error;
  return `已更新待办。\n${updated.name}\n${updated.dueOn}`;
}

function perform(threadId: string, matterId: string, name: string, raw: string) {
  const args = argsOf(raw);
  if (!args) return "没有读懂这一项。";
  if (name === "list_materials") return listMaterials(matterId);
  if (name === "read_material") return readMaterial(matterId, textOf(args.filename));
  if (name === "list_tasks") return listTasks(matterId);
  if (name === "list_parties") return listParties(matterId);
  if (name === "list_notes") return listNotes(matterId);

  if (archived(matterId)) return "";
  if (name === "add_task") return "记下待办请走本案工具。";
  if (name === "set_facts") {
    const text = textOf(args.text);
    if (!text) return "请写下基本事实。";
    return stageText(threadId, matterId, "基本事实", text);
  }
  if (name === "set_mandate") {
    const text = textOf(args.text);
    if (!text) return "请写下委托事项。";
    return stageText(threadId, matterId, "委托事项", text);
  }
  if (name === "set_proves") {
    const filename = textOf(args.filename);
    const proves = textOf(args.proves);
    if (!filename || !proves) return "请写下证明对象。";
    const found = findMaterial(matterId, filename);
    if ("error" in found) return found.error;
    return stageProves(threadId, matterId, found.row.filename, clipEnd(proves));
  }
  if (name === "delete_record") return stageDelete(threadId, matterId, textOf(args.kind), textOf(args.name));
  return "";
}

async function directRecord(matterId: string, text: string) {
  if (/读这份/.test(text) && /材料/.test(text)) {
    await materializeMaterials(matterId);
    return formatMaterialRead(await loadMaterials(matterId), "这份材料", text);
  }
  const read = text.match(/读一下\s*(.+)/);
  if (read) {
    const name = read[1].replace(/的内容[\s\S]*$/u, "").replace(/[。．\s]+$/u, "");
    if (name) {
      await materializeMaterials(matterId, genericFile(name) ? "" : name);
      return formatMaterialRead(await loadMaterials(matterId), name, text);
    }
  }
  if (/列出|有哪些|找到/.test(text) && /材料|证据/.test(text)) {
    return formatMaterialList(await loadMaterials(matterId));
  }
  if (/列出/.test(text) && /待办/.test(text)) return describeDue(matterId);
  if (/列出/.test(text) && /当事人/.test(text)) return listParties(matterId);
  if (/列出/.test(text) && /已记下|时间线|待核清单|路径/.test(text)) {
    return formatNoteList(await loadNotes(matterId));
  }
  if (/内容|总结|正文/.test(text)) {
    await materializeMaterials(matterId);
    return mentionedMaterial(matterId, text);
  }
  return "";
}

function mentionedMaterial(matterId: string, text: string) {
  const rows = database()
    .prepare("SELECT filename FROM materials WHERE matter_id = ? ORDER BY created_at, rowid")
    .all(matterId) as Array<{ filename: string }>;
  const hits = rows.filter((row) => {
    const file = stem(row.filename);
    if (file.length < 2 || text.includes(file)) return file.length >= 2 && text.includes(file);
    if (file.length < 4) return false;
    for (let index = 0; index <= file.length - 4; index += 1) {
      if (text.includes(file.slice(index, index + 4))) return true;
    }
    return false;
  });
  if (hits.length !== 1) return "";
  return readMaterial(matterId, hits[0].filename);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function fullYear(year: number) {
  return year >= 100 ? year : 2000 + year;
}

function asDay(year: number, month: number, day: number) {
  const value = `${year}-${pad(month)}-${pad(day)}`;
  return validDay(value) ? value : "";
}

function parseDue(text: string) {
  const now = new Date();
  const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso && validDay(iso[0])) return { dueOn: iso[0], phrase: iso[0], assumed: false };
  const ymd = text.match(/(\d{2,4})年(\d{1,2})月(\d{1,2})[日号]/);
  if (ymd) {
    const dueOn = asDay(fullYear(Number(ymd[1])), Number(ymd[2]), Number(ymd[3]));
    if (dueOn) return { dueOn, phrase: ymd[0], assumed: false };
  }
  const md = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    const year = month < today.m || (month === today.m && day < today.d) ? today.y + 1 : today.y;
    const dueOn = asDay(year, month, day);
    if (dueOn) return { dueOn, phrase: md[0], assumed: false };
  }
  const dot = text.match(/(?<!\d)(\d{1,2})[.](\d{1,2})(?!\d)/);
  if (dot) {
    const month = Number(dot[1]);
    const day = Number(dot[2]);
    const year = month < today.m || (month === today.m && day < today.d) ? today.y + 1 : today.y;
    const dueOn = asDay(year, month, day);
    if (dueOn) return { dueOn, phrase: dot[0], assumed: false };
  }
  const ym = text.match(/(\d{2,4})年(\d{1,2})月份/);
  if (ym) {
    const dueOn = asDay(fullYear(Number(ym[1])), Number(ym[2]), 1);
    if (dueOn) return { dueOn, phrase: ym[0], assumed: true };
  }
  const relative = relativeDay(text);
  if (relative) return { dueOn: relative, phrase: relative, assumed: false };
  return null;
}

function wantsReminder(text: string) {
  if (/列出|有哪些|找到|读一下|总结|正文/.test(text)) return false;
  return /提醒|日程|会见/.test(text) || (/待办|开庭/.test(text) && /加/.test(text));
}

function reminderName(text: string, phrase: string) {
  const name = text
    .replace(phrase, "")
    .replace(/提醒我|帮我|给我|请|加一个|加上|加一条|的日程|日程|待办|到期日/g, "")
    .replace(/[，,。．\s]/g, "")
    .trim();
  if (/开庭/.test(text) && !name.includes("开庭")) return (name ? `${name}开庭` : "开庭").slice(0, 80);
  return (name || "待办").slice(0, 80);
}

function paperKind(text: string) {
  if (/答辩/.test(text)) return "答辩状";
  if (/代理/.test(text)) return "代理词";
  if (/起诉/.test(text)) return "起诉状";
  return "文书";
}

function wantsDraft(text: string) {
  return /起草|写/.test(text) && /答辩|代理词|起诉状|文书/.test(text);
}

function draftSearchText(matterId: string, instruction: string) {
  const matter = database().prepare("SELECT cause, facts FROM matters WHERE id = ?").get(matterId) as
    | { cause: string; facts: string }
    | undefined;
  const rows = database()
    .prepare(
      "SELECT usable_text FROM materials WHERE matter_id = ? AND text_status = '可用文字' ORDER BY created_at, rowid",
    )
    .all(matterId) as Array<{ usable_text: string }>;
  const usable = rows
    .map((row) => row.usable_text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 240);
  const query = [matter?.cause, matter?.facts, usable].filter((part) => part && part.trim()).join(" ");
  return query.trim().length >= 2 ? query.replace(/\s+/g, " ").trim().slice(0, 300) : instruction;
}

async function passageFromAsked(matterId: string, asked: string) {
  if (!/改|收成|太长|太啰嗦/.test(asked)) return "";
  const current = await currentDraft(matterId);
  if (!current) return "";
  const quoted = asked.match(/[「“"]([^」”"]{4,200})[」”"]/);
  if (quoted && current.body.includes(quoted[1])) return sentenceAround(current.body, quoted[1]);
  const lines = current.body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12)
    .sort((left, right) => right.length - left.length);
  return lines.find((line) => asked.includes(line)) ?? "";
}

function sentenceAround(body: string, piece: string) {
  const at = body.indexOf(piece);
  if (at < 0) return piece;
  const start = Math.max(body.lastIndexOf("。", at), body.lastIndexOf("\n", at));
  const endDot = body.indexOf("。", at + piece.length);
  const endLine = body.indexOf("\n", at + piece.length);
  const end = [endDot, endLine].filter((index) => index >= 0).sort((left, right) => left - right)[0];
  const sentence = body.slice(start + 1, end === undefined ? body.length : end + 1).trim();
  if (sentence.includes(piece) && sentence.length <= 400) return sentence;
  return piece;
}

async function draftPaper(
  threadId: string,
  matterId: string,
  instruction: string,
  kind: string,
  asked: string,
  passage = "",
) {
  const label = kind.trim() || paperKind(instruction || asked);
  const clip = passage.trim() || (await passageFromAsked(matterId, asked));
  if (clip) {
    const current = await currentDraft(matterId);
    const how = instruction.trim() && instruction.trim() !== asked && !instruction.includes(clip)
      ? instruction.trim()
      : asked.replace(clip, "").replace(/^[\s，,。．：:]+|[\s，,。．：:]+$/g, "") || "改短一点";
    const revised = await reviseCurrentDraft(matterId, {
      passage: clip,
      instruction: how,
      kind: label,
    });
    if ("error" in revised) return revised.error;
    if (current && revised.body.trim() === current.body.trim()) return `${label}这一段没有改动。`;
    return `${label}已按你的话改了一段，看右边。`;
  }
  if (searchChoice(asked) === "off") {
    const counted = database().prepare("SELECT COUNT(*) AS n FROM sources WHERE matter_id = ?").get(matterId) as {
      n: number;
    };
    if (Number(counted.n) === 0) return NO_CHECKED_SOURCE;
  }
  const written = await writeDraftMessage(threadId, instruction.trim() || asked, matterId, label);
  if ("error" in written) {
    if (written.error !== "请先勾选出处。") return written.error;
    const looked = await fetchLawCandidates(threadId, matterId, draftSearchText(matterId, instruction || asked), asked);
    if (looked.startsWith("查到这些")) {
      const titles = looked.split("\n").slice(1).join("\n");
      return `还没查过 Alpha，这次先查了。右边可以勾法条和案例。勾过之后再说写${label}，稿子只用勾上的。\n${titles}`;
    }
    if (looked.startsWith("没有查到")) return "Alpha 没有查到法条或案例。右边还没有可勾的，稿子先不写。";
    if (looked === NO_CHECKED_SOURCE || looked === "这一问指定不查。") return NO_CHECKED_SOURCE;
    return `${looked}\n这次没有查到法条和案例，右边还没有可勾的，稿子先不写。`;
  }
  return `${label}已写在右边。定稿看右栏。`;
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

async function fetchLawCandidates(threadId: string, matterId: string, query: string, asked: string) {
  if (searchChoice(asked) === "off") return "这一问指定不查。";
  const found = await searchRetrieval(query, matterId);
  if ("error" in found) return found.error;
  const messageId = lawyerMessageId(threadId);
  if (messageId) {
    rememberCandidates({
      threadId,
      messageId,
      question: query,
      query: found.query,
      items: found.items,
    });
  }
  if (found.items.length === 0) return "没有查到可勾选的法条或案例。";
  return `查到这些，列在右边。勾上要写进文书的，再让我写。\n${candidateLines(found.items).join("\n")}`;
}

async function searchPkulaw(
  threadId: string,
  matterId: string,
  query: string,
  asked: string,
  onDelta?: (text: string) => void,
) {
  if (searchChoice(asked) === "off") return "这一问指定不查。";
  const question = query.trim() || asked;
  const found = await searchRetrieval(question, matterId);
  if ("error" in found) return found.error;
  const messageId = lawyerMessageId(threadId);
  if (messageId) {
    rememberCandidates({
      threadId,
      messageId,
      question,
      query: found.query,
      items: found.items,
    });
  }
  if (found.items.length === 0) return "没有查到可依据的法条或案例。";
  const answered = await answerFromHits(
    question,
    found.items.map((item) => ({
      kind: item.kind,
      title: item.title,
      text: item.text,
      url: item.url,
    })),
    onDelta,
  );
  if ("error" in answered) return answered.error;
  const tail = `\n\n查到这些，也列在右边，可收下：\n${candidateLines(found.items).join("\n")}`;
  onDelta?.(tail);
  return `${answered.text}${tail}`;
}

function parseIndexes(raw: string, asked: string) {
  const args = argsOf(raw) ?? {};
  const value = `${textOf(args.indexes)} ${asked}`;
  const numbers = [...value.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((value) => value >= 1);
  if (/第一/.test(value)) numbers.push(1);
  if (/第二/.test(value)) numbers.push(2);
  if (/第三/.test(value)) numbers.push(3);
  return [...new Set(numbers)];
}

async function saveSource(threadId: string, raw: string, asked: string) {
  const batch = await listCandidates(threadId);
  if (!batch || batch.items.length === 0) return "右边还没有可收的候选。先查 Alpha。";
  const indexes = parseIndexes(raw, asked);
  if (indexes.length === 0) return "请写上要收的序号，例如收下第一条。";
  const sourceIds = indexes
    .map((index) => batch.items[index - 1]?.sourceId)
    .filter((id): id is string => Boolean(id));
  if (sourceIds.length === 0) return "没有这些序号。";
  const saved = await acceptCandidates(threadId, { messageId: batch.messageId, sourceIds });
  if ("error" in saved) return saved.error;
  const titles = indexes
    .map((index) => batch.items[index - 1])
    .filter(Boolean)
    .map((item) => item.title);
  return `已收下：\n${titles.map((title) => `- ${title}`).join("\n")}`;
}

async function directSchedule(matterId: string, text: string) {
  if (!wantsReminder(text)) return "";
  if (archived(matterId)) return "archived";
  const due = parseDue(text);
  if (!due) return "";
  const saved = await saveTodo(matterId, reminderName(text, due.phrase), due.dueOn, text);
  return due.assumed ? `${saved}\n没写明几日，先按${due.dueOn}。` : saved;
}

function clipEnd(value: string) {
  return value.replace(/[。．\s]+$/u, "").trim();
}

function directWrite(matterId: string, text: string): { name: string; raw: string } | null {
  const facts = text.match(/(?:把|将)?(?:案件经过|基本事实|案情)(?:请)?(?:改成|改为|写成)[：:]?\s*([^\n]+)/);
  if (facts) {
    const value = clipEnd(facts[1]);
    if (value) return { name: "set_facts", raw: JSON.stringify({ text: value }) };
  }
  const mandate = text.match(/(?:把|将)?(?:要办的事|委托事项)(?:请)?(?:改成|改为|写成)[：:]?\s*([^\n]+)/);
  if (mandate) {
    const value = clipEnd(mandate[1]);
    if (value) return { name: "set_mandate", raw: JSON.stringify({ text: value }) };
  }
  const proves = text.match(/给\s*(\S+?)\s*写上证明对象为\s*([^\n。]+)/);
  if (proves) {
    const filename = clipEnd(proves[1]);
    const value = clipEnd(proves[2]);
    if (filename && value) return { name: "set_proves", raw: JSON.stringify({ filename, proves: value }) };
  }
  const removed = text.match(/(?:请)?删掉\s*([^\n。]+)/);
  if (removed) {
    const name = clipEnd(removed[1]);
    if (!name) return null;
    const db = database();
    if (db.prepare("SELECT id FROM tasks WHERE matter_id = ? AND name = ?").get(matterId, name)) {
      return { name: "delete_record", raw: JSON.stringify({ kind: "待办", name }) };
    }
    if (db.prepare("SELECT id FROM parties WHERE matter_id = ? AND name = ?").get(matterId, name)) {
      return { name: "delete_record", raw: JSON.stringify({ kind: "当事人", name }) };
    }
    if (DELETE_KINDS.has(name)) return { name: "delete_record", raw: JSON.stringify({ kind: name, name: "" }) };
  }
  return null;
}

function stageParty(threadId: string, matterId: string, name: string, position: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) return "请写下姓名。";
  const client = database()
    .prepare("SELECT id FROM parties WHERE matter_id = ? AND role = 'client' AND name = ?")
    .get(matterId, clean);
  if (client) return "这一项不能改客户。";
  const role = /人民法院|人民检察院|公安局|公安分局|复议机关|仲裁委员会/.test(clean) ? "organ" : "opposing";
  const party = { name: clean, position: position.trim().slice(0, 40), idNumber: "", role };
  const body = [party.name, party.position].filter(Boolean).join(" ");
  insertProposal(threadId, "当事人", body, JSON.stringify([party]));
  return `当事人先停在待确认。\n${body}`;
}

function stageCause(threadId: string, text: string) {
  const body = clipEnd(text).slice(0, 80);
  if (!body) return "请写下案由。";
  insertProposal(threadId, "案由", body, body);
  return `案由先停在待确认。\n${body}`;
}

async function judgeQuestion(
  threadId: string,
  matterId: string,
  question: string,
  asked: string,
  onDelta?: (text: string) => void,
) {
  const counted = database().prepare("SELECT COUNT(*) AS n FROM sources WHERE matter_id = ?").get(matterId) as {
    n: number;
  };
  const choice = searchChoice(asked);
  if (Number(counted.n) === 0) {
    if (choice === "off") return NO_CHECKED_SOURCE;
    return searchPkulaw(threadId, matterId, question || asked, asked, onDelta);
  }
  if (choice === "on") return searchPkulaw(threadId, matterId, question || asked, asked, onDelta);
  const rows = database()
    .prepare("SELECT kind, title, text, url FROM sources WHERE matter_id = ? ORDER BY accepted_at, rowid")
    .all(matterId) as Array<{ kind: "law" | "case"; title: string; text: string; url: string }>;
  const judged = await judgeFromSources(
    question || asked,
    rows.map((row) => ({ kind: row.kind, title: row.title, text: row.text, url: row.url })),
    onDelta,
  );
  if ("error" in judged) return judged.error;
  return judged.text;
}

async function execute(
  threadId: string,
  matterId: string,
  name: string,
  raw: string,
  asked: string,
  onDelta?: (text: string) => void,
) {
  if (name === "list_materials") {
    await materializeMaterials(matterId);
    return formatMaterialList(await loadMaterials(matterId));
  }
  if (name === "read_material") {
    const args = argsOf(raw) ?? {};
    const filename = textOf(args.filename);
    await materializeMaterials(matterId, genericFile(filename) ? "" : filename);
    return formatMaterialRead(await loadMaterials(matterId), filename, asked);
  }
  if (name === "list_notes") return formatNoteList(await loadNotes(matterId));
  if (name === "search") {
    const args = argsOf(raw) ?? {};
    return searchCase(matterId, textOf(args.query) || asked);
  }
  if (name === "list_tasks") return describeDue(matterId);
  if (name === "add_task") {
    const args = argsOf(raw);
    if (!args) return "没有读懂这一项。";
    const spoken = spokenTodo(asked);
    const parsed = parseDue(asked);
    const instructed = instructedTodo(asked);
    const taskName = (
      spoken?.name ||
      instructed?.name ||
      textOf(args.name) ||
      (parsed ? reminderName(asked, parsed.phrase) : "")
    ).slice(0, 200);
    const dueOn = spoken?.dueOn || instructed?.dueOn || parsed?.dueOn || "";
    const saved = await saveTodo(matterId, taskName, dueOn, asked);
    return parsed?.assumed && !spoken ? `${saved}\n没写明几日，先按${dueOn}。` : saved;
  }
  if (name === "plead") {
    const spoken = await runPlead(matterId, { asked });
    if ("error" in spoken) return spoken.error;
    return spoken.text;
  }
  if (name === "consult") {
    const spoken = await runConsult(asked);
    return spoken.text;
  }
  if (name === "find_cases") {
    const spoken = await runFindCases(asked);
    return spoken.text;
  }
  if (name === "search_pkulaw" || name === "save_source" || name === "draft" || name === "judge_question") {
    const args = argsOf(raw) ?? {};
    if (name === "search_pkulaw") return searchPkulaw(threadId, matterId, textOf(args.query) || asked, asked, onDelta);
    if (name === "save_source") return saveSource(threadId, raw, asked);
    if (name === "draft") {
      if (/答辩|代理词|起诉状|上诉状/.test(`${asked}\n${textOf(args.kind)}`)) {
        const spoken = await runPlead(matterId, { asked });
        if ("error" in spoken) return spoken.error;
        return spoken.text;
      }
      return draftPaper(
        threadId,
        matterId,
        textOf(args.instruction) || asked,
        textOf(args.kind) || paperKind(asked),
        asked,
        textOf(args.passage),
      );
    }
    return judgeQuestion(threadId, matterId, textOf(args.question) || asked, asked, onDelta);
  }
  if (name === "add_note" || name === "add_party" || name === "set_cause") {
    const args = argsOf(raw);
    if (!args) return "没有读懂这一项。";
    if (name === "add_note") {
      if (textOf(args.kind) === "时间线") {
        const saved = await writeNodesFromText(matterId, textOf(args.text) || asked);
        return "error" in saved ? saved.error : saved.text;
      }
      const saved = await recordNote(matterId, textOf(args.kind), textOf(args.text));
      if ("error" in saved) return saved.error;
      return `已记下${textOf(args.kind)}。\n${textOf(args.text).trim()}`;
    }
    if (name === "add_party") return stageParty(threadId, matterId, textOf(args.name), textOf(args.position));
    return stageCause(threadId, textOf(args.text));
  }
  if (name === "close_case") return closeCase(matterId, raw, asked);
  if (name === "reopen_case") {
    const done = await unarchiveMatter(matterId);
    if ("error" in done) return done.error;
    return "已解档。案子回到已结案，可以继续改。";
  }
  if (name === "nodes") return handleNodes(threadId, matterId, raw, asked);
  if (name === "report") return writeReport(matterId);
  if (name === "link_judge") {
    const args = argsOf(raw) ?? {};
    const spokenName = asked.match(/法官\s*(.{2,20}?)(?=挂|，|,|。|$)/)?.[1]?.trim() || "";
    const linked = await linkJudge(matterId, {
      name: spokenName || textOf(args.name),
      court: textOf(args.court),
      role: textOf(args.role),
    });
    if ("error" in linked) return linked.error;
    return linked.text;
  }
  if (name === "scan") return scanIn(matterId, raw, asked);
  if (name === "review_contract") return runContractReview(matterId, raw, asked);
  if (name === "save_opinion") return saveOpinion(matterId, raw);
  if (name === "ask_contract") return askContract(matterId, raw, asked, onDelta);
  if (name === "compliance_review") return runCompliance(matterId, raw);
  return perform(threadId, matterId, name, raw);
}

async function closeCase(matterId: string, raw: string, asked: string) {
  const args = argsOf(raw) ?? {};
  const outcome = textOf(args.outcome) || "已办结";
  const outcomeOn = textOf(args.outcomeOn) || today();
  const statement =
    textOf(args.statement) ||
    `结案说明：${outcome}（${outcomeOn}）。${asked.includes("归档") ? "律师要求归档。" : ""}`.trim();
  const outcomeNote = textOf(args.outcomeNote) || asked.slice(0, 500) || statement;
  const savedOutcome = await saveOutcome(matterId, { outcome, outcomeOn, outcomeNote });
  if ("error" in savedOutcome) return savedOutcome.error;
  const tasks = await loadTasks(matterId);
  for (const task of tasks) {
    const resolved = database()
      .prepare("SELECT task_id FROM task_resolutions WHERE task_id = ?")
      .get(task.id) as { task_id: string } | undefined;
    if (resolved) continue;
    const done = await resolveTask(matterId, task.id, { result: "已完成", note: "归档时一并处理" });
    if ("error" in done) return done.error;
  }
  const savedStatement = await saveStatement(matterId, { statement });
  if ("error" in savedStatement) return savedStatement.error;
  const confirmed = await confirmClosing(matterId);
  if ("error" in confirmed && confirmed.error !== "结案说明已经确认。") return confirmed.error;
  const archivedResult = await archiveMatter(matterId);
  if ("error" in archivedResult) return archivedResult.error;
  return "已归档。办结页可看说明；解档前只供查阅。";
}

async function handleNodes(threadId: string, matterId: string, raw: string, asked: string) {
  const args = argsOf(raw) ?? {};
  const title = textOf(args.title).slice(0, 200);
  if (!title) {
    const spoken = await writeNodesFromText(matterId, asked);
    if (!("error" in spoken)) return spoken.text;
    const rows = await listNodes(matterId);
    if (rows.length === 0) return "本案还没有节点。";
    return ["节点：", ...rows.map((row) => `- ${row.happenedOn} ${row.title}${row.detail ? `：${row.detail}` : ""}`)].join(
      "\n",
    );
  }
  if (archived(matterId)) return "归档后只供查阅。";
  const spoken = dayFromSpeech(asked);
  const day = spoken || today();
  const detail = (textOf(args.detail) || (asked.includes(title) ? "" : asked.slice(0, 200))).slice(0, 4_000);
  const rows = await listNodes(matterId);
  const same = rows.find(
    (row) => row.happenedOn === day && (row.title === title || (detail && row.detail === detail)),
  );
  if (same) return `已写入节点。\n${day} ${same.title}`;
  const saved = await addNode(matterId, { happenedOn: day, title, detail });
  if ("error" in saved) return saved.error;
  const assumed = spoken ? "" : "\n原话没有写哪一天，先按今天。";
  return `已写入节点。\n${day} ${title}${detail ? `\n${detail}` : ""}${assumed}`;
}

function spokenScan(asked: string) {
  if (!/笔录/.test(asked) || !/放进材料|放进卷|收进材料/.test(asked)) return null;
  const said = asked.match(/说[，,:：]?\s*([^。\n]+)/);
  const text = said?.[1]?.trim() || "";
  if (text.length < 4) return null;
  return { filename: "谈话笔录.txt", text };
}

async function scanIn(matterId: string, raw: string, asked = "") {
  if (/一会儿再补|以后再补|回头再补|内容还没|还没写|先空着/.test(asked)) return "请写下要扫入的正文。";
  const args = argsOf(raw) ?? {};
  const spoken = spokenScan(asked);
  let filename = textOf(args.filename) || spoken?.filename || "扫入材料.txt";
  if (!filename.toLowerCase().endsWith(".txt")) filename = `${filename}.txt`;
  const text = textOf(args.text) || spoken?.text || "";
  if (!text) return "请写下要扫入的正文。";
  const bytes = new TextEncoder().encode(text);
  const saved = await addTextMaterial(matterId, filename, bytes);
  if ("error" in saved) return saved.error;
  return `已扫入材料：${filename}。`;
}

function spokenStance(text: string, given: string) {
  const named = text.match(/(?:立场|我方|我是)(?:是|为)?\s*([^\s，。]{1,12})/);
  if (named && !/律师/.test(named[1])) return named[1];
  if (/买方/.test(text)) return "买方";
  if (/卖方/.test(text)) return "卖方";
  if (/甲方/.test(text)) return "甲方";
  if (/乙方/.test(text)) return "乙方";
  if (given.trim() && text.includes(given.trim())) return given.trim();
  return "";
}

function spokenScale(text: string, given: string) {
  if (/强势/.test(text)) return "强势";
  if (/均势/.test(text)) return "均势";
  if (/弱势/.test(text)) return "弱势";
  if (isContractScale(given) && text.includes(given)) return given;
  return "";
}

function pastedContract(text: string) {
  const marked = text.match(/(?:合同正文|正文|合同)[：:]\s*([\s\S]{20,})/);
  if (marked) return marked[1].trim();
  const at = text.search(/第[一二三四五六七八九十百0-9]+条/);
  if (at >= 0 && text.length > 40) return text.slice(Math.max(0, at - 40)).trim();
  return "";
}

async function runContractReview(matterId: string, raw: string, asked: string) {
  if (isContractRevise(asked)) {
    const revised = await reviseContractCards(matterId, asked);
    return "error" in revised ? revised.error : revised.text;
  }
  const args = argsOf(raw) ?? {};
  const stance = spokenStance(asked, textOf(args.stance));
  const scale = spokenScale(asked, textOf(args.scale));
  const link = `[合同审查](/matters/${matterId}/contract-review)`;
  if (!stance) return `还差审查立场。\n${link}`;
  if (!scale) return `还差审查尺度。\n${link}`;
  const done = await generateContractReview(matterId, {
    text: textOf(args.text) || pastedContract(asked),
    filename: textOf(args.filename),
    stance,
    scale,
  });
  if ("error" in done) return done.error;
  return done.text;
}

async function saveOpinion(matterId: string, raw: string) {
  const args = argsOf(raw) ?? {};
  const reviewId = textOf(args.reviewId);
  const review = reviewId
    ? await getReview(matterId, reviewId)
    : (await listReviews(matterId)).find((item) => item.kind === "合同审查") ?? null;
  if (!review) return "还没有合同审查结果。";
  const saved = await recordNote(matterId, "路径", `已收下${review.kind}：${review.title}\n${review.body.slice(0, 1_500)}`);
  if ("error" in saved) return saved.error;
  return `已收下审查意见：${review.title}。`;
}

async function askContract(
  matterId: string,
  raw: string,
  asked: string,
  onDelta?: (text: string) => void,
) {
  const args = argsOf(raw) ?? {};
  const question = textOf(args.question) || asked;
  const review = (await listReviews(matterId)).find((item) => item.kind === "合同审查");
  if (!review) return "还没有合同审查结果。";
  const answered = await answerFromHits(
    question,
    [{ kind: "材料", title: review.title, text: review.body }],
    onDelta,
  );
  if ("error" in answered) return answered.error;
  return answered.text;
}

async function runCompliance(matterId: string, raw: string) {
  const args = argsOf(raw) ?? {};
  const done = await complianceReview(matterId, {
    title: textOf(args.title),
    text: textOf(args.text),
  });
  if ("error" in done) return done.error;
  return `制度审查已完成。\n打开 /matters/${matterId}/reviews/${done.id} 看结果。\n\n${done.body.slice(0, 800)}`;
}

export async function answerAllCasePhotos(
  asked: string,
  matterId: string,
  onDelta?: (text: string) => void,
) {
  await materializeMaterials(matterId, "", "照片");
  const photos = (await loadMaterials(matterId)).filter((row) => row.kind === "照片");
  if (photos.length === 0) return { text: "这件案子里没有照片。" };
  const record = [
    "律师要求把这件案子里的照片都读完再汇总。",
    "每一张有字的都要写进汇总，每张至少一句，不要因为求短漏掉任何一张。没有字的要点明是哪一张。",
    "事实、人名、金额、日期只用各张正文里有的。没有的标成待核实，不要编。",
    bundlePhotos(
      photos.map((row) => ({
        filename: row.filename,
        text: row.usableText || row.readText,
        note: materialState(row),
      })),
    ),
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

function pastEvent(asked: string) {
  if (/[?？]|待办|提醒|到期|前/.test(asked)) return false;
  const day = dayFromSpeech(asked);
  const today = dayFromSpeech("今天");
  if (!day || !today) return false;
  return day < today;
}

function spokenEvent(asked: string) {
  if (/[?？]|有哪些|列出|什么|吗|呢|待办|提醒|日程|到期|前/.test(asked)) return null;
  const day = dayFromSpeech(asked);
  if (!day) return null;
  const today = dayFromSpeech("今天");
  if (today && day >= today && /开庭/.test(asked)) return null;
  const title = asked
    .replace(/\d{2,4}年\d{1,2}月\d{1,2}[日号]/g, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\d{1,2}月\d{1,2}[日号]/g, "")
    .replace(/昨天|今天|前天|大前天/g, "")
    .replace(/\s+/g, "")
    .replace(/^[我们你们他们大家]+/, "")
    .trim()
    .slice(0, 200);
  if (title.length < 2) return null;
  return { day, title };
}

async function recordFromSpeech(threadId: string, matterId: string, asked: string) {
  if (/^解档$|重新打开/.test(asked.trim())) {
    return execute(threadId, matterId, "reopen_case", "{}", asked);
  }
  if (/归档|结案|办结/.test(asked) && !/解档|归档前|归档后/.test(asked)) {
    return execute(threadId, matterId, "close_case", "{}", asked);
  }
  if (/制度审查|合规体检|合规审查/.test(asked)) {
    const text = asked.replace(/^[^：:]*[：:]/, "").trim() || asked;
    return execute(threadId, matterId, "compliance_review", JSON.stringify({ title: "制度审查", text }), asked);
  }
  const scanned = asked.match(/(?:扫入|扫描|扫进)(?:材料)?[：:\s]*([^\s：:]+?\.txt)[：:\s]*([\s\S]+)/i);
  if (scanned) {
    return execute(
      threadId,
      matterId,
      "scan",
      JSON.stringify({ filename: scanned[1], text: scanned[2].trim() }),
      asked,
    );
  }
  const labeled =
    /(时间线|待核清单|路径)[：:]/.test(asked) ||
    /基本事实|委托事项|案由|增加(?:对方|办案机关)?当事人|删除(?:待办|当事人)/.test(asked) ||
    (/去掉|改成|改为/.test(asked) && !/word|pdf|docx|材料|对话稿|文件/i.test(asked)) ||
    (/加上今天|办案节点|电话核对/.test(asked) && !/待办|提醒|日程|到期/.test(asked));
  const event = spokenEvent(asked);
  if (!labeled && !event) return null;
  if (archived(matterId)) return "archived";
  if (event && !labeled) {
    const rows = await listNodes(matterId);
    if (rows.some((row) => row.happenedOn === event.day && row.title === event.title)) {
      return `已写入节点。\n${event.day} ${event.title}`;
    }
    const saved = await addNode(matterId, { happenedOn: event.day, title: event.title });
    return "error" in saved ? saved.error : `已写入节点。\n${event.day} ${event.title}`;
  }
  if (/去掉|改成|改为/.test(asked) && !/基本事实|委托事项|案由|证明对象|word|pdf|docx|材料|对话稿|文件/i.test(asked)) {
    const revised = await reviseTodo(matterId, asked);
    if (revised.startsWith("已更新待办")) return revised;
  }
  const noted = asked.match(/(时间线|待核清单|路径)[：:]\s*([^\n]+)/);
  if (noted?.[1] === "时间线") {
    const saved = await writeNodesFromText(matterId, noted[2]);
    return "error" in saved ? saved.error : saved.text;
  }
  if (noted) {
    const saved = await recordNote(matterId, noted[1], noted[2]);
    return "error" in saved ? saved.error : `已记下${noted[1]}。\n${noted[2].trim()}`;
  }
  if (/加上今天|办案节点|电话核对/.test(asked) && !/待办|提醒|日程|到期/.test(asked)) {
    const title = asked.replace(/加上今天|节点|电话核对/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "办案节点";
    return execute(threadId, matterId, "nodes", JSON.stringify({ title }), asked);
  }
  const removed = asked.match(/删除(待办|当事人)[：:]\s*([^\n。]+)/);
  if (removed) {
    let name = clipEnd(removed[2]);
    if (removed[1] === "待办") {
      const tasks = await loadTasks(matterId);
      const hit = tasks.find((task) => task.name === name || task.name.includes(name) || name.includes(task.name));
      if (hit) name = hit.name;
    }
    return stageDelete(threadId, matterId, removed[1], name);
  }
  const written = directWrite(matterId, asked);
  if (written) {
    const text = perform(threadId, matterId, written.name, written.raw);
    if (text) return text;
  }
  const cause = asked.match(/案由(?:请)?(?:改成|改为|写成)[：:]?\s*([^\n。]+)/);
  if (cause) return stageCause(threadId, cause[1]);
  const party = asked.match(/增加(?:对方|办案机关)?当事人[：:]\s*([^，,\n。]+)(?:[，,]\s*([^\n。]+))?/);
  if (party) return stageParty(threadId, matterId, party[1], party[2] || "");
  return null;
}

export function wantsFindCases(text: string) {
  if (/右边|勾选|答辩|代理词|起诉状|上诉状/.test(text)) return false;
  if (/[（(]\d{4}[）)]/.test(text) && /归纳|总结|检索|找|查/.test(text)) return true;
  if (/类案|类似案情|裁判观点|裁判口径|罪名/.test(text)) return true;
  if (/调取|找案例|检索案例/.test(text)) return true;
  if (/20\d{2}/.test(text) && /判决书|裁判文书|案例/.test(text)) return true;
  return /找几件|差不多的案子|类似的案子|法院怎么判/.test(text);
}

export function wantsConsult(text: string) {
  if (wantsFindCases(text)) return false;
  if (/右边|勾选|答辩|代理词|起诉状|上诉状/.test(text)) return false;
  return /能否|是否可以|有没有权|双倍工资|受理费|法律依据|怎么主张/.test(text);
}

function wantsContractReview(text: string) {
  if (/制度|合规/.test(text)) return false;
  if (/审合同|审查合同|合同审查|审查这份合同/.test(text)) return true;
  return isContractRevise(text);
}

function wantsPlead(matterId: string, text: string) {
  const writing = /写|起草|生成|根据|改成|改为|收成|太长|太啰嗦/;
  if (/代理词/.test(text) && writing.test(text)) return true;
  if (/答辩/.test(text) && writing.test(text)) return true;
  if (/起诉状|上诉状/.test(text) && writing.test(text)) return true;
  const revise = text.match(/把(.{4,120}?)(?:改成|改为)/);
  if (revise) {
    const row = database()
      .prepare("SELECT id FROM pleadings WHERE matter_id = ? AND status = '已成文' AND instr(body, ?) > 0 LIMIT 1")
      .get(matterId, revise[1]) as { id: string } | undefined;
    if (row) return true;
  }
  if (/审合同|合同审查|待办|类案|受理费|时间线|加节点/.test(text)) return false;
  const open = database()
    .prepare("SELECT id FROM pleadings WHERE matter_id = ? AND status = '缺槽位' LIMIT 1")
    .get(matterId) as { id: string } | undefined;
  if (!open) return false;
  if (/能否|是否可以|有没有权|怎么算/.test(text) && !/案情|材料|理由|起诉|上诉/.test(text)) return false;
  return /案情|概要|理由|材料|根据|裁定|判决|自己总结|你总结|写上/.test(text);
}

function spokenCourt(asked: string) {
  if (/法官|案由|答辩|起诉|上诉|时间线/.test(asked) || asked.length > 80) return "";
  const named = asked.match(/([\u4e00-\u9fa5]{2,40}(?:人民法院|人民检察院|公安局|公安分局|仲裁委员会))/)?.[1] ?? "";
  return named.replace(/^(?:一审|二审|再审)?在/, "");
}

function noSourceConsult(matterId: string, asked: string) {
  if (searchChoice(asked) !== "off") return "";
  const counted = database().prepare("SELECT COUNT(*) AS n FROM sources WHERE matter_id = ?").get(matterId) as {
    n: number;
  };
  return Number(counted.n) === 0 ? NO_CHECKED_SOURCE : "";
}

function panelOnCase(matterId: string, asked: string) {
  const rows = database()
    .prepare(
      "SELECT filename, usable_text FROM materials WHERE matter_id = ? AND text_status = '可用文字' ORDER BY created_at, rowid",
    )
    .all(matterId) as Array<{ filename: string; usable_text: string }>;
  const found = rows
    .map((row) => ({ filename: row.filename, lines: panelLines(row.usable_text) }))
    .filter((row) => row.lines.length > 0);
  if (found.length === 0) return "";
  const named = found.filter((row) => {
    const stem = row.filename.replace(/\.[^.]+$/, "");
    return asked.includes(row.filename) || asked.includes(stem);
  });
  const use = named.length > 0 ? named : found;
  return use.map((row) => panelReply(row.filename, row.lines, asked)).join("\n\n");
}

function wantsTimelineFile(asked: string, earlier: string) {
  if (/起诉状|答辩状|代理词|异议函/.test(asked)) return false;
  const aboutTimeline = /时间线/.test(asked) || /时间线/.test(earlier);
  const asFile = /word|pdf|docx/i.test(asked) && /保存|存成|存为|导出|整理/.test(asked);
  return aboutTimeline && (asFile || (/时间线/.test(asked) && /word|pdf|docx|保存|存成|存为/i.test(asked)));
}

export async function runCaseTool(
  threadId: string,
  matterId: string,
  turns: Array<{ role: "lawyer" | "model"; body: string }>,
  ensure: () => void,
  onDelta?: (text: string) => void,
  onReset?: () => void,
): Promise<ToolRun> {
  await connection();
  const asked = turns.at(-1)?.body ?? "";
  const earlier = turns
    .slice(0, -1)
    .filter((turn) => turn.role === "lawyer")
    .at(-1)?.body ?? "";
  if (/去掉|改成|改为/.test(asked) && !/基本事实|委托事项|案由|证明对象|起诉|答辩|上诉|条款|续期|word|pdf/i.test(asked)) {
    const revised = await reviseTodo(matterId, asked);
    if (revised.startsWith("已更新待办")) {
      ensure();
      return { status: "done", text: revised, reply: false };
    }
  }
  const court = spokenCourt(asked);
  if (court) {
    ensure();
    const position = /一审/.test(asked) ? "一审" : /二审/.test(asked) ? "二审" : "";
    return { status: "done", text: stageParty(threadId, matterId, court, position), reply: false };
  }
  if (asksPanel(asked)) {
    const reply = panelOnCase(matterId, asked);
    if (reply) {
      ensure();
      return { status: "done", text: reply, reply: false };
    }
  }
  if (wantsTimelineFile(asked, earlier)) {
    ensure();
    const text = await nodeDocument(matterId);
    return {
      status: "done",
      text: text || "本案还没有节点。先在右侧时间线写上一行。",
      reply: false,
    };
  }
  const recent = turns.slice(-8).map((turn, index, all) => ({
    role: turn.role,
    body: index === all.length - 1 ? turn.body : turn.body.slice(0, 400),
  }));
  const system = systemFor(matterId);
  const allowed = toolsFor(matterId);
  let read = "";
  let started = false;
  let direct = "";
  for (let step = 0; step < 4; step += 1) {
    let selected = await selectTool(system, recent, allowed, onDelta, onReset, step === 0 ? "required" : "auto");
    if (step === 0 && !("error" in selected) && selected.calls.length === 0) {
      onReset?.();
      selected = await selectTool(system, recent, allowed, onDelta, onReset, "required");
    }
    if ("error" in selected || selected.calls.length === 0) {
      if (!("error" in selected) && selected.text) direct = selected.text;
      break;
    }
    const call = selected.calls[0];
    if (!allowed.some((tool) => tool.name === call.name)) break;
    const boundary = outsideCaseReply(asked);
    if (boundary) {
      if (!started) ensure();
      const spoken =
        boundary === "todos" ? `这是本案的待办，不是各案总表。\n${await describeDue(matterId)}` : boundary;
      return { status: "done", text: spoken, reply: false };
    }
    let chosen = call.name;
    let raw = boundArguments(call.arguments);
    const scanned = spokenScan(asked);
    if (scanned) {
      chosen = "scan";
      raw = JSON.stringify(scanned);
    } else if (wantsPlead(matterId, asked)) chosen = "plead";
    else if (wantsContractReview(asked)) chosen = "review_contract";
    else if (wantsFindCases(asked)) chosen = "find_cases";
    else if (wantsConsult(asked)) chosen = "consult";
    if (chosen === "consult") {
      const blocked = noSourceConsult(matterId, asked);
      if (blocked) {
        if (!started) ensure();
        return { status: "done", text: blocked, reply: false };
      }
    }
    if (chosen === "reply" || chosen === "draft") {
      const passage = await passageFromAsked(matterId, asked);
      if (passage && /答辩|代理/.test(asked)) chosen = "plead";
    }
    if (chosen === "reply") return { status: "skip" };
    if (chosen === "add_task" && /去掉|改成|改为/.test(asked)) {
      const revised = await reviseTodo(matterId, asked);
      if (revised) {
        if (!started) ensure();
        return { status: "done", text: revised, reply: false };
      }
    }
    if ((chosen === "read_material" || chosen === "list_materials") && asksAllPhotos(asked)) {
      if (!started) ensure();
      const ran = await answerAllCasePhotos(asked, matterId, onDelta);
      if ("error" in ran) return { status: "done", text: ran.error || "没有读出来。", reply: false };
      return { status: "done", text: ran.text, reply: false };
    }
    if (MUTATING.has(chosen) && archived(matterId) && chosen !== "reopen_case") {
      if (!started && !read) return { status: "archived" };
      break;
    }
    if (!started) {
      ensure();
      started = true;
    }
    const text = await execute(threadId, matterId, chosen, raw, asked, onDelta);
    if (!text) break;
    if (LIST_ONLY.has(chosen)) {
      return { status: "done", text: read ? `${read}\n\n${text}` : text, reply: false };
    }
    if (text === "这一项不能改客户。" && /删除当事人[：:]/.test(asked)) {
      const named = asked.match(/删除当事人[：:]\s*([^\n。]+)/);
      if (named) {
        const name = clipEnd(named[1]);
        const body = `删除：${name}`;
        insertProposal(threadId, "当事人", body, JSON.stringify({ op: "delete", name }));
        return { status: "done", text: `删除先停在待确认。\n${body}`, reply: false };
      }
    }
    if (READ_TOOLS.has(chosen)) {
      if (read && (read === text || read.includes(text) || text.includes(read))) {
        return { status: "done", text: read, reply: true };
      }
      read = read ? `${read}\n\n${text}` : text;
      recent.push({ role: "model", body: text.slice(0, 800) });
      continue;
    }
    return { status: "done", text: read ? `${read}\n\n${text}` : text, reply: false };
  }
  if (read) {
    if (wantsPlead(matterId, asked)) {
      onReset?.();
      const spoken = await runPlead(matterId, { asked });
      return { status: "done", text: "error" in spoken ? spoken.error : spoken.text, reply: false };
    }
    return { status: "done", text: read, reply: true };
  }
  const boundary = outsideCaseReply(asked);
  if (boundary) {
    if (direct) onReset?.();
    ensure();
    const spoken = boundary === "todos" ? `这是本案的待办，不是各案总表。\n${await describeDue(matterId)}` : boundary;
    return { status: "done", text: spoken, reply: false };
  }
  if (direct) {
    if (/待确认|点留下|点「留下」|已记下|已更新|已写入|已添加/.test(direct)) {
      onReset?.();
      return { status: "done", text: "没有写入。", reply: false };
    }
    if (wantsPlead(matterId, asked)) {
      onReset?.();
      const spoken = await runPlead(matterId, { asked });
      return { status: "done", text: "error" in spoken ? spoken.error : spoken.text, reply: false };
    }
    return { status: "done", text: direct, reply: false };
  }
  if (wantsContractReview(asked)) {
    ensure();
    return { status: "done", text: await runContractReview(matterId, "", asked), reply: false };
  }
  if (wantsFindCases(asked)) {
    ensure();
    const spoken = await runFindCases(asked);
    return { status: "done", text: spoken.text, reply: false };
  }
  if (wantsConsult(asked)) {
    ensure();
    const blocked = noSourceConsult(matterId, asked);
    if (blocked) return { status: "done", text: blocked, reply: false };
    const spoken = await runConsult(asked);
    return { status: "done", text: spoken.text, reply: false };
  }
  if (archived(matterId) && instructedTodo(asked)) return { status: "archived" };
  return { status: "skip" };
}
