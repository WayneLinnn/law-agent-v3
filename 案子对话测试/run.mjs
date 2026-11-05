/**
 * 用办理对话同一条接口跑完全部测试。
 * 律师说的是日常的话，不按工具说明去凑触发词。
 * 用法：node --experimental-sqlite 案子对话测试/run.mjs
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const recordFile = process.env.RECORD || "测试记录.md";
const logFile = process.env.LOG || "结果.jsonl";
const only = new Set(
  (process.env.ONLY || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean),
);
const root = join(here, "..");
const base = process.env.BASE || "http://localhost:3010";
const dbPath = join(root, "data", "v3.sqlite");

const today = new Date();
const iso = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const TODAY = iso(today);
const TOMORROW = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
const YESTERDAY = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

const LEASE = "承租人测试客户甲。出租人测试对方乙。月租金 8000 元。2026 年 3 月起未付。";
const CONTRACT = [
  "第一条 服务期限一年，期满自动续期一年，费用按上一年度上浮 10%，乙方不得异议。",
  "第二条 乙方员工发生人身损害的，由乙方自行承担，与甲方无关。",
  "第三条 甲方可将乙方个人信息提供给境外关联公司，无需另行告知。",
].join("\n");

const pass = (why) => ({ verdict: "通过", why });
const fail = (why) => ({ verdict: "失败", why });
const env = (why) => ({ verdict: "环境未就绪", why });

function dateIn(text, day) {
  const [year, month, date] = day.split("-");
  return (
    text.includes(day) ||
    text.includes(`${year}年${Number(month)}月${Number(date)}`) ||
    text.includes(`${Number(month)}月${Number(date)}`)
  );
}

function names(rows) {
  return (rows || []).map((row) => row.name || row.filename || row.title || "").join("、");
}

function grew(before, after, pick) {
  return pick(after).length > pick(before).length;
}

function sameLen(before, after, pick) {
  return pick(before).length === pick(after).length;
}

function down(reply, error) {
  const blob = `${error || ""}\n${reply || ""}`;
  return /没有问成|没有答上|Alpha 没有|连不上|ECONN|fetch failed|AbortError|请求超时|HTTP 502|HTTP 503|服务不可用/.test(
    blob,
  );
}

async function j(path, options = {}, ms = 30000) {
  const res = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(ms) });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, body };
}

function readDb(matterId) {
  let db;
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      break;
    } catch (error) {
      last = error;
    }
  }
  if (!db) throw last;
  try {
    const all = (sql, ...args) => db.prepare(sql).all(...args);
    return {
      nodes: all(
        "SELECT happened_on AS happenedOn, title, detail FROM nodes WHERE matter_id = ? ORDER BY happened_on, rowid",
        matterId,
      ),
      judges: all(
        `SELECT g.name AS name, g.court AS court, mj.role AS role
         FROM matter_judges mj JOIN judges g ON g.id = mj.judge_id WHERE mj.matter_id = ?`,
        matterId,
      ),
      pleadings: all(
        "SELECT kind, status, body FROM pleadings WHERE matter_id = ? ORDER BY created_at, rowid",
        matterId,
      ),
      reviews: all(
        "SELECT id, kind, title, stance, scale, substr(body, 1, 400) AS body FROM reviews WHERE matter_id = ? ORDER BY created_at, rowid",
        matterId,
      ),
      cards: all(
        `SELECT r.scale AS scale, r.stance AS stance, c.title AS title, c.original_text AS original,
                c.revision AS revision, c.is_red_line AS red
         FROM contract_review_cards c JOIN reviews r ON r.id = c.review_id
         WHERE r.matter_id = ? ORDER BY r.created_at, c.sort_order`,
        matterId,
      ),
      sources: all("SELECT title FROM sources WHERE matter_id = ? ORDER BY accepted_at, rowid", matterId),
    };
  } finally {
    db.close();
  }
}

async function snap(matterId) {
  const [matterRes, taskRes, noteRes, materialRes, draftRes, focusRes, matterList] = await Promise.all([
    j(`/api/matters/${matterId}`),
    j(`/api/matters/${matterId}/tasks`),
    j(`/api/matters/${matterId}/notes`),
    j(`/api/matters/${matterId}/materials`),
    j(`/api/matters/${matterId}/drafts`),
    j(`/api/matters/${matterId}/focuses`),
    j("/api/matters"),
  ]);
  const matter = matterRes.body.matter || {};
  const extra = readDb(matterId);
  return {
    matterCount: (matterList.body.matters || []).length,
    status: matter.status || "",
    facts: matter.facts || "",
    mandate: matter.mandate || "",
    cause: matter.cause || "",
    parties: (matter.parties || []).map((party) => ({
      role: party.role,
      name: party.name,
      position: party.position || "",
    })),
    tasks: (taskRes.body.tasks || []).map((task) => ({
      name: task.name,
      dueOn: task.dueOn,
      confirmed: Boolean(task.confirmedAt),
    })),
    notes: (noteRes.body.notes || []).map((note) => ({ kind: note.kind, body: note.body })),
    materials: (materialRes.body.materials || []).map((row) => ({
      filename: row.filename,
      kind: row.kind,
      proves: row.proves || "",
      textStatus: row.textStatus,
    })),
    drafts: (draftRes.body.drafts || []).map((row) => ({ kind: row.kind, body: row.body || "" })),
    focuses: (focusRes.body.focuses || []).length,
    ...extra,
  };
}

async function threadOf(id) {
  const res = await j(`/api/threads/${id}`);
  return res.body.thread;
}

async function ask(matterId, text, ms) {
  const res = await j(
    `/api/matters/${matterId}/ask`,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ mode: "问答", text }),
    },
    ms,
  );
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.body.error || `HTTP ${res.status}`, threadId: res.body.id || "", reply: "", pending: [] };
  }
  const thread = await threadOf(res.body.id);
  const messages = thread?.messages || [];
  const spoken = messages.filter((message) => message.role === "model" && !message.proposalKind);
  const pending = messages.filter((message) => message.proposalKind && !message.acceptedAt);
  return {
    ok: true,
    status: res.status,
    error: "",
    threadId: res.body.id,
    reply: spoken.at(-1)?.body || "",
    pending,
  };
}

async function leave(threadId) {
  const thread = await threadOf(threadId);
  const pending = (thread?.messages || []).filter((message) => message.proposalKind && !message.acceptedAt);
  const done = [];
  for (const item of pending) {
    const res = await j(`/api/threads/${threadId}/proposals/${item.id}/accept`, { method: "POST" });
    done.push({ kind: item.proposalKind, body: item.body, ok: res.ok, error: res.body.error || "" });
  }
  return done;
}

async function take(threadId, indexes) {
  const listed = await j(`/api/threads/${threadId}/candidates`);
  const batch = listed.body.candidates;
  if (!batch?.items?.length) return { ok: false, error: "右边没有候选", titles: [] };
  const sourceIds = indexes.map((index) => batch.items[index - 1]?.sourceId).filter(Boolean);
  const saved = await j(`/api/threads/${threadId}/candidates/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: batch.messageId, sourceIds }),
  });
  const titles = indexes.map((index) => batch.items[index - 1]?.title).filter(Boolean);
  return { ok: saved.ok, error: saved.body.error || "", titles };
}

async function upload(matterId, filename, text, type = "text/plain") {
  const form = new FormData();
  form.append("file", new Blob([text], { type }), filename);
  const res = await j(`/api/matters/${matterId}/materials`, { method: "POST", body: form });
  if (!res.ok) return { ok: false, error: res.body.error || "放入失败" };
  const listed = await j(`/api/matters/${matterId}/materials`);
  const row = (listed.body.materials || []).find((item) => item.filename === filename);
  if (!row) return { ok: false, error: "放入后列表里没有这份文件" };
  if (type.startsWith("text")) {
    const confirmed = await j(`/api/matters/${matterId}/materials/${row.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!confirmed.ok && confirmed.status !== 409) return { ok: false, error: confirmed.body.error || "确认文字失败" };
  }
  return { ok: true, error: "" };
}

function png(label, line) {
  const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
  try {
    GlobalFonts.register("C:/Windows/Fonts/msyh.ttc", "YaHei");
  } catch {
    /* 系统字体注册失败时仍画图 */
  }
  const canvas = createCanvas(640, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 640, 200);
  ctx.fillStyle = "#111111";
  ctx.font = "28px YaHei";
  ctx.fillText(label, 24, 70);
  ctx.fillText(line, 24, 130);
  return canvas.toBuffer("image/png");
}

async function uploadPng(matterId, filename, label, line) {
  const form = new FormData();
  form.append("file", new Blob([png(label, line)], { type: "image/png" }), filename);
  const res = await j(`/api/matters/${matterId}/materials`, { method: "POST", body: form });
  return { ok: res.ok, error: res.body.error || "" };
}

function quote(body) {
  const lines = String(body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && line.length <= 120);
  const line = lines.sort((left, right) => right.length - left.length)[0];
  if (line) return line;
  const sentence = String(body || "")
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .find((item) => item.length >= 12);
  if (sentence) return sentence.slice(0, 120);
  const flat = String(body || "").replace(/\s+/g, "");
  return flat.length >= 16 ? flat.slice(0, 80) : "";
}

function renewalCard(cards, scale) {
  return (cards || []).filter((card) => card.scale === scale && /续期|自动/.test(`${card.original}${card.title}${card.revision}`)).at(-1);
}

const state = { main: "", empty: "", threadId: "" };

const steps = [
  {
    id: "1.1",
    tool: "reply",
    title: "问今天几号",
    say: "今儿几号了？",
    look: "回答是当天。不新增待办、节点、笔记。",
    check: (c) => {
      if (!dateIn(c.reply, TODAY)) return fail(`回答里没有当天日期 ${TODAY}。`);
      if (grew(c.before, c.after, (s) => s.tasks) || grew(c.before, c.after, (s) => s.nodes) || grew(c.before, c.after, (s) => s.notes)) {
        return fail("只问日期，却写下了待办、节点或笔记。");
      }
      return pass("只回答了日期，记录没有增加。");
    },
  },
  {
    id: "1.2",
    tool: "reply",
    title: "问证据够不够",
    say: "就现在这份租赁材料，你觉得证据够不够打？",
    look: "可以谈到租金没付，但不改事实、不新建待办和文书。",
    check: (c) => {
      if (c.before.facts !== c.after.facts || grew(c.before, c.after, (s) => s.tasks) || grew(c.before, c.after, (s) => s.drafts)) {
        return fail("问看法时改了事实、待办或文书。");
      }
      if (!/租金|8000|不够|够|材料/.test(c.reply)) return fail("回答没有对着租赁材料说话。");
      return pass("只给了看法，案子记录没动。");
    },
  },
  {
    id: "2.1",
    tool: "list_materials",
    title: "问卷里有什么",
    say: "卷里现在都有什么材料？",
    look: "能看到租赁情况和两张现场照片的文件名，不贴出整份正文。",
    check: (c) => {
      if (!/租赁情况/.test(c.reply)) return fail("没有提到租赁情况。");
      if (c.reply.includes("承租人测试客户甲") && c.reply.includes("月租金")) return fail("列材料时把正文贴出来了。");
      return pass("列出了材料，没有贴正文。");
    },
  },
  {
    id: "2.2",
    tool: "read_material",
    title: "看租赁材料",
    say: "租赁那份我还没细看，里面具体写了什么？",
    look: "读出承租人、月租金 8000。",
    check: (c) => {
      if (!/8000/.test(c.reply) || !/测试客户甲/.test(c.reply)) return fail("没有读出租金和承租人。");
      return pass("读到了租赁材料里的原句。");
    },
  },
  {
    id: "2.3",
    tool: "read_material",
    title: "找一份没有的材料",
    say: "和解协议在卷里吗？我怎么没看见。",
    look: "说明没有这份材料。",
    check: (c) => (/没有这份材料|没有和解|卷里没有|没找到|没有看到/.test(c.reply) ? pass("说明卷里没有和解协议。") : fail("没有明确说没有这份材料。")),
  },
  {
    id: "2.4",
    tool: "照片汇总",
    title: "两张现场照片拢一下",
    say: "现场那两张照片你都看看，给我拢一下，别漏。",
    look: "两张都提到。没有字要说明。不新做一份材料。",
    heavy: true,
    check: (c) => {
      const photos = c.after.materials.filter((row) => row.kind === "照片");
      if (photos.length < 2) return env("照片没有放进卷里。");
      if (c.reply.includes("没有照片")) return fail("卷里有照片，回答却说没有。");
      const hit = [/现场一/, /现场二/].filter((re) => re.test(c.reply)).length;
      if (hit < 2 && !/8000|承租人/.test(c.reply)) return fail("没有把两张照片都拢进去。");
      if (grew(c.before, c.after, (s) => s.materials)) return fail("汇总时又新放了一份材料。");
      return pass("两张照片都进了汇总。");
    },
  },
  {
    id: "2.5",
    tool: "list_tasks",
    title: "还没有待办时问最近要办什么",
    say: "最近有什么得办的？",
    look: "不趁机新建待办。",
    check: (c) => (grew(c.before, c.after, (s) => s.tasks) ? fail("只是在问，却新建了待办。") : pass("没有新建待办。")),
  },
  {
    id: "2.6",
    tool: "list_parties",
    title: "问这个案子有哪些人",
    say: "这个案子都有哪些人？",
    look: "能看到客户甲和对方乙。",
    check: (c) => (/测试客户甲/.test(c.reply) && /测试对方乙/.test(c.reply) ? pass("客户和对方都在。") : fail("没有把客户和对方都说出来。")),
  },
  {
    id: "2.7",
    tool: "list_notes",
    title: "问之前记过的东西",
    say: "我之前让你记的那些，还在吗？",
    look: "此时还没有笔记，不能编一条。",
    check: (c) => {
      if (grew(c.before, c.after, (s) => s.notes)) return fail("询问时写入了笔记。");
      if (/还没有|没有记下|还没记/.test(c.reply)) return pass("说明还没有记下的内容。");
      return fail("没有说明目前还没有记下的内容。");
    },
  },
  {
    id: "2.8",
    tool: "search",
    title: "在卷里找八千块",
    say: "卷里哪里写到八千块？",
    look: "命中租赁材料，不冒出法条和右边候选。",
    check: (c) => {
      if (!/租赁情况|8000|八千/.test(c.reply)) return fail("没有在卷里找到租金。");
      if (/《/.test(c.reply) && /第.+条/.test(c.reply)) return fail("在卷里找字时写成了法条检索。");
      return pass("在本案材料里找到了租金。");
    },
  },
  {
    id: "2.9",
    tool: "search",
    title: "找一个卷里没有的词",
    say: "卷里有没有提到火星基地？",
    look: "说明没找到。",
    check: (c) => (/没有找到|没找到|没有提到|卷里没有/.test(c.reply) ? pass("说明本案没有这个词。") : fail("没有说明没找到。")),
  },
  {
    id: "3.1",
    tool: "add_task",
    title: "12月15日前交证据",
    say: "12月15号之前得把证据交上去，你帮我记着。",
    look: "待办页出现一条，日期是 2026-12-15，名称里有证据。",
    check: (c) => {
      const task = c.after.tasks.find((item) => item.dueOn === "2026-12-15" && /证据/.test(item.name));
      if (!task) return fail(`没有记下 2026-12-15 且带“证据”的待办。现有：${names(c.after.tasks) || "无"}`);
      return pass(`已记下「${task.name}」${task.dueOn}。`);
    },
  },
  {
    id: "3.2",
    tool: "add_task",
    title: "明天见面提醒",
    say: "明天约了测试对方乙见面，提醒我一声。",
    look: "新增一条，到期日是明天。",
    check: (c) => {
      const task = c.after.tasks.find((item) => item.dueOn === TOMORROW);
      if (!task) return fail(`没有到期日为 ${TOMORROW} 的待办。`);
      return pass(`已记下「${task.name}」${task.dueOn}。`);
    },
  },
  {
    id: "3.3",
    tool: "add_task",
    title: "核对租金并放到工作台",
    say: "租金那笔账 12月15号前得核对完，放到工作台上，我每天都能看见。",
    look: "待办已确认，所以会出现在工作台。",
    check: (c) => {
      const task = c.after.tasks.find((item) => item.dueOn === "2026-12-15" && /租金|核对/.test(item.name));
      if (!task) return fail("没有核对租金这条待办。");
      if (!task.confirmed) return fail(`「${task.name}」记下了，但没有确认到工作台。`);
      return pass(`「${task.name}」已确认。`);
    },
  },
  {
    id: "3.4",
    tool: "add_task",
    title: "待办里去掉“证据”二字",
    say: "那条交证据的待办，把“证据”两个字去掉。",
    look: "改的是原来那条，条数不增加，日期还是 12月15日。",
    check: (c) => {
      if (c.after.tasks.length > c.before.tasks.length) return fail("改名称时又新加了一条。");
      const before = c.before.tasks.find((item) => /证据/.test(item.name) && item.dueOn === "2026-12-15");
      if (!before) return fail("上一条里已经没有可去掉的“证据”。");
      const after = c.after.tasks.find((item) => item.dueOn === "2026-12-15" && !/证据/.test(item.name));
      if (!after) return fail("“证据”还在，或者日期变了。");
      return pass(`名称变成「${after.name}」，日期仍是 ${after.dueOn}。`);
    },
  },
  {
    id: "3.5",
    tool: "add_task",
    title: "把交证据那条改成补交租赁合同",
    say: "提交那条改成补交租赁合同。",
    look: "名称变为补交租赁合同，不新开一条。",
    check: (c) => {
      if (!c.after.tasks.some((item) => item.name.includes("补交租赁合同") && item.dueOn === "2026-12-15")) {
        return fail(`没有改成补交租赁合同。现有：${c.after.tasks.map((item) => item.name).join("、")}`);
      }
      if (c.after.tasks.length > c.before.tasks.length) return fail("改名时多了一条。");
      return pass("待办已改成补交租赁合同。");
    },
  },
  {
    id: "3.6",
    tool: "nodes",
    title: "昨天开过庭，不应变成待办",
    say: "昨天开过庭了。",
    look: "不新增待办。应记成已经发生的节点。",
    check: (c) => {
      if (grew(c.before, c.after, (s) => s.tasks)) return fail("过去的开庭被记成了待办。");
      const node = c.after.nodes.find((item) => item.happenedOn === YESTERDAY);
      if (!node) return fail(`没有写成 ${YESTERDAY} 的节点。`);
      return pass(`写入节点 ${node.happenedOn} ${node.title}。`);
    },
  },
  {
    id: "3.7",
    tool: "add_task",
    title: "没说清的事项",
    say: "再帮我记个事，我怕忘。",
    look: "没有名称和日期时不写入空待办。",
    check: (c) => (grew(c.before, c.after, (s) => s.tasks) ? fail("空泛的一句也写下了待办。") : pass("没有写入空待办。")),
  },
  {
    id: "3.8",
    tool: "add_task",
    title: "同一条再记一次",
    say: "补交租赁合同那条，12月15号，是不是已经有了？再记一次也行。",
    look: "不复制第二条同样的待办。",
    check: (c) => {
      const hits = c.after.tasks.filter((item) => item.name.includes("补交租赁合同") && item.dueOn === "2026-12-15");
      if (hits.length > 1) return fail("同样的待办被记了两次。");
      if (hits.length === 1 && /已经有了|已有|记过/.test(c.reply)) return pass("说明这条已经有了。");
      if (hits.length === 1 && sameLen(c.before, c.after, (s) => s.tasks)) return pass("没有复制第二条。");
      return fail("没有守住“已经有了”。");
    },
  },
  {
    id: "4.1",
    tool: "set_facts",
    title: "口述基本事实，先不留下",
    say: "事实就按这个定：测试客户甲是承租人，从2026年3月起每月8000的租金一直没付。",
    look: "停在待确认。没点留下时，概览里的基本事实不变。",
    check: (c) => {
      if (c.before.facts !== c.after.facts) return fail("还没点留下，基本事实已经被改了。");
      if (!c.pending.some((item) => item.proposalKind === "基本事实") && !/待确认/.test(c.reply)) {
        return fail("没有停在待确认。");
      }
      return pass("基本事实停在待确认，尚未写入。");
    },
  },
  {
    id: "4.1b",
    tool: "set_facts",
    title: "点留下基本事实",
    leave: true,
    look: "留下后，基本事实整段是律师说的那句。",
    check: (c) => (/8000/.test(c.after.facts) && /承租/.test(c.after.facts) ? pass(`基本事实已写入：${c.after.facts}`) : fail("点留下后基本事实里没有这句。")),
  },
  {
    id: "4.2",
    tool: "set_mandate",
    title: "说委托就是把欠租要回来",
    say: "客户要办的事就一件，让对方把欠的租金付了。",
    look: "委托事项先待确认，基本事实不被带走。",
    check: (c) => {
      if (c.before.facts !== c.after.facts) return fail("改委托时把基本事实也改了。");
      if (c.before.mandate !== c.after.mandate) return fail("还没留下，委托事项已经写上了。");
      if (!c.pending.some((item) => item.proposalKind === "委托事项") && !/待确认/.test(c.reply)) return fail("没有停在待确认。");
      return pass("委托事项停在待确认。");
    },
  },
  {
    id: "4.2b",
    tool: "set_mandate",
    title: "点留下委托事项",
    leave: true,
    look: "委托事项写入，基本事实还在。",
    check: (c) => {
      if (!/租金/.test(c.after.mandate)) return fail("委托事项没有写入。");
      if (!/8000/.test(c.after.facts)) return fail("基本事实被冲掉了。");
      return pass(`委托事项：${c.after.mandate}`);
    },
  },
  {
    id: "4.3",
    tool: "set_proves",
    title: "租赁材料是为了证明欠租",
    say: "租赁情况这份，就是为了证明租金没付。",
    look: "证明对象待确认，留下前材料上的证明对象还是空的。",
    check: (c) => {
      const row = c.after.materials.find((item) => item.filename.includes("租赁情况"));
      if (row?.proves) return fail("还没留下，证明对象已经写上了。");
      if (!c.pending.some((item) => item.proposalKind === "证明对象") && !/待确认/.test(c.reply)) return fail("没有停在待确认。");
      return pass("证明对象停在待确认。");
    },
  },
  {
    id: "4.3b",
    tool: "set_proves",
    title: "点留下证明对象",
    leave: true,
    look: "租赁情况的证明对象是欠租。",
    check: (c) => {
      const row = c.after.materials.find((item) => item.filename.includes("租赁情况"));
      if (!row?.proves || !/租金|欠/.test(row.proves)) return fail(`证明对象未写入。当前：${row?.proves || "空"}`);
      return pass(`证明对象：${row.proves}`);
    },
  },
  {
    id: "4.4",
    tool: "add_party",
    title: "提到还有个证人",
    say: "还有个证人，叫测试证人丙。",
    look: "先待确认。留下前当事人里还没有他。",
    check: (c) => {
      if (c.after.parties.some((party) => party.name === "测试证人丙")) return fail("还没留下，证人已经进了当事人。");
      if (!c.pending.some((item) => item.proposalKind === "当事人") && !/待确认/.test(c.reply)) return fail("没有停在待确认。");
      return pass("证人停在待确认。");
    },
  },
  {
    id: "4.4b",
    tool: "add_party",
    title: "点留下证人",
    leave: true,
    look: "证人丙在对方一侧，不是客户。",
    check: (c) => {
      const party = c.after.parties.find((item) => item.name === "测试证人丙");
      if (!party) return fail("留下后没有证人丙。");
      if (party.role === "client") return fail("证人被写成了客户。");
      return pass(`${party.role} ${party.name} ${party.position}`);
    },
  },
  {
    id: "4.5",
    tool: "add_party",
    title: "一审是西湖区法院",
    say: "一审在杭州市西湖区人民法院。",
    look: "留下后在办案机关，不进对方列。",
    thenLeave: true,
    check: (c) => {
      if (!c.pending.some((item) => item.proposalKind === "当事人") && !/待确认/.test(c.reply) && !c.after.parties.some((party) => /西湖区人民法院/.test(party.name))) {
        return fail("既没有待确认，也没有写入法院。");
      }
      return pass("法院已进入待确认，下一步点留下。");
    },
  },
  {
    id: "4.5b",
    tool: "add_party",
    title: "点留下法院",
    leave: true,
    look: "法院的角色是办案机关。",
    check: (c) => {
      const party = c.after.parties.find((item) => /西湖区人民法院/.test(item.name));
      if (!party) return fail("留下后没有这家法院。");
      if (party.role !== "organ") return fail(`法院被放进了 ${party.role}，不是办案机关。`);
      return pass("法院在办案机关。");
    },
  },
  {
    id: "4.6",
    tool: "add_party",
    title: "想把客户再加到对方",
    say: "测试客户甲也写到对方那边去吧。",
    look: "不能改客户，也不能多出一个客户。",
    thenLeave: true,
    check: (c) => {
      const clients = c.after.parties.filter((party) => party.role === "client" && party.name === "测试客户甲");
      if (clients.length !== 1) return fail("客户行被改动了。");
      return pass("客户仍然只有一行。");
    },
  },
  {
    id: "4.6b",
    tool: "add_party",
    title: "若生成了待确认也点留下",
    leave: true,
    look: "留下之后客户还在，没有变成对方。",
    check: (c) => {
      const clients = c.after.parties.filter((party) => party.role === "client");
      if (clients.length !== 1 || clients[0].name !== "测试客户甲") return fail("留下后客户变了。");
      return pass("客户没有被改掉。");
    },
  },
  {
    id: "4.7",
    tool: "set_cause",
    title: "案由用房屋租赁合同纠纷",
    say: "案由就写房屋租赁合同纠纷。",
    look: "先待确认。",
    check: (c) => {
      if (c.after.cause === "房屋租赁合同纠纷" && c.before.cause !== c.after.cause) return fail("还没留下，案由已经写上了。");
      if (!c.pending.some((item) => item.proposalKind === "案由") && !/待确认/.test(c.reply)) return fail("没有停在待确认。");
      return pass("案由停在待确认。");
    },
  },
  {
    id: "4.7b",
    tool: "set_cause",
    title: "点留下案由",
    leave: true,
    look: "案由是房屋租赁合同纠纷。事实还在。",
    check: (c) => {
      if (!/房屋租赁合同纠纷/.test(c.after.cause)) return fail(`案由是「${c.after.cause || "空"}」。`);
      if (!/8000/.test(c.after.facts)) return fail("基本事实被冲掉了。");
      return pass("案由已留下，基本事实还在。");
    },
  },
  {
    id: "5.1",
    tool: "add_note",
    title: "银行流水还没对",
    say: "银行流水还没对上，2026年3月以后的，先搁在待核里。",
    look: "直接记下待核清单，不进待办。",
    check: (c) => {
      const note = c.after.notes.find((item) => item.kind === "待核清单" && /流水/.test(item.body));
      if (!note) return fail("没有记下待核清单。");
      if (grew(c.before, c.after, (s) => s.tasks)) return fail("待核事项被记成了待办。");
      return pass("待核清单已直接写入。");
    },
  },
  {
    id: "5.2",
    tool: "add_note",
    title: "先固定欠付期间再主张租金",
    say: "办案上我打算先把欠了几个月固定下来，再去要租金。这条路子记一下。",
    look: "直接记下路径。",
    check: (c) => (c.after.notes.some((item) => item.kind === "路径" && /租金|欠/.test(item.body)) ? pass("路径已写入。") : fail("没有记下路径。")),
  },
  {
    id: "5.3",
    tool: "nodes",
    title: "10月20日通过电话，要进时间线",
    say: "2026年10月20号双方通过电话，这件事记到经过里，别记成以后要办的事。",
    look: "写成节点，不记成一条叫时间线的笔记，也不进待办。",
    check: (c) => {
      if (c.after.notes.some((item) => item.kind === "时间线")) return fail("记成了时间线笔记。");
      if (grew(c.before, c.after, (s) => s.tasks)) return fail("记成了待办。");
      const node = c.after.nodes.find((item) => item.happenedOn === "2026-10-20");
      if (!node) return fail("没有 2026-10-20 的节点。");
      return pass(`节点 ${node.happenedOn} ${node.title}`);
    },
  },
  {
    id: "5.4",
    tool: "nodes",
    title: "问经过都有哪些",
    say: "办案经过都有哪些？",
    look: "列出已有节点，不新写一条。",
    check: (c) => {
      if (c.after.nodes.length > c.before.nodes.length) return fail("只是在问，却新写了节点。");
      if (!/2026-10-20|10月20/.test(c.reply)) return fail("没有把已有经过说出来。");
      return pass("只列出了已有节点。");
    },
  },
  {
    id: "5.5",
    tool: "nodes",
    title: "今天电话里对过租金",
    say: "今天跟对方通了电话，把租金对了一下，这个经过记上。",
    look: "节点日期是今天，不进待办。",
    check: (c) => {
      const node = c.after.nodes.find((item) => item.happenedOn === TODAY && /电话|租金/.test(item.title + item.detail));
      if (!node) return fail("没有今天的电话节点。");
      if (grew(c.before, c.after, (s) => s.tasks)) return fail("同时写进了待办。");
      return pass(`节点 ${node.happenedOn} ${node.title}`);
    },
  },
  {
    id: "5.6",
    tool: "nodes",
    title: "同一天签约再说一次",
    say: "2026年10月20号双方把租赁合同签了。",
    look: "写入签约节点。",
    check: (c) => {
      const hits = c.after.nodes.filter((item) => item.happenedOn === "2026-10-20" && /签/.test(item.title));
      if (hits.length === 0) return fail("没有签约这条节点。");
      return pass(hits.map((item) => item.title).join("、"));
    },
  },
  {
    id: "5.7",
    tool: "nodes",
    title: "签约这句再说一遍",
    say: "2026年10月20号双方把租赁合同签了。",
    look: "不复制第二条同样的节点。",
    check: (c) => {
      const hits = c.after.nodes.filter((item) => item.happenedOn === "2026-10-20" && /签/.test(item.title));
      if (hits.length > 1) return fail("同样的节点写了两次。");
      return pass("没有重复写入。");
    },
  },
  {
    id: "5.8",
    tool: "reply",
    title: "时间线要存成 Word",
    say: "时间线帮我存成 Word。",
    look: "不说做不到，不另写答辩状，不查法条。",
    check: (c) => {
      if (/做不到|无法导出|不能存/.test(c.reply)) return fail("回答说做不到。");
      if (grew(c.before, c.after, (s) => s.drafts)) return fail("存时间线时写了文书稿。");
      if (/2026-10-20|电话|存为 Word|存成 Word/.test(c.reply)) return pass("按时间线回应，没有改去写答辩状。");
      return fail("没有对着时间线回应。");
    },
  },
  {
    id: "5.9",
    tool: "report",
    title: "问案子进展",
    say: "这个案子进展怎么样，给我捋一下。",
    look: "汇报里有节点、待办、已记下，不编造人物。",
    check: (c) => {
      if (!/节点|经过|待办|流水|路径/.test(c.reply)) return fail("汇报没有覆盖经过、待办或已记下。");
      if (grew(c.before, c.after, (s) => s.tasks) || grew(c.before, c.after, (s) => s.nodes)) return fail("汇报时改了记录。");
      return pass("汇报停在对话里。");
    },
  },
  {
    id: "5.10",
    tool: "link_judge",
    title: "承办法官是丁",
    say: "承办法官是测试法官丁，在杭州市西湖区人民法院，挂到咱们这个案子上。",
    look: "本案挂上这位法官。",
    check: (c) => {
      const judge = c.after.judges.find((item) => item.name.includes("测试法官丁"));
      if (!judge) return fail("法官没有挂上。");
      if (!/西湖/.test(judge.court) && !/西湖/.test(c.reply)) return fail("法院没有带上。");
      return pass(`${judge.name} ${judge.court}`);
    },
  },
  {
    id: "5.11",
    tool: "link_judge",
    title: "想看全部法官",
    say: "我们合作过的法官都有谁？",
    look: "说明整本通讯录在工作台，不在这里把通讯录倒出来。",
    check: (c) => (/工作台|通讯录|只能.*挂|这里只/.test(c.reply) ? pass("把通讯录指回了工作台。") : fail("没有说明通讯录不在本案对话里。")),
  },
  {
    id: "5.12",
    tool: "scan",
    title: "电话内容收成谈话笔录",
    say: "刚才客户在电话里说，从2026年3月起租金就没付。你整理成一份谈话笔录，放进材料里。",
    look: "材料里多一份 txt，正文是这句，不改基本事实。",
    check: (c) => {
      if (c.before.facts !== c.after.facts) return fail("扫材料时改了基本事实。");
      const added = c.after.materials.filter((item) => !c.before.materials.some((old) => old.filename === item.filename));
      const file = added.find((item) => /笔录|谈话/.test(item.filename));
      if (!file) return fail(`没有新的谈话笔录。新增：${added.map((item) => item.filename).join("、") || "无"}`);
      return pass(`已放入 ${file.filename}`);
    },
  },
  {
    id: "5.13",
    tool: "scan",
    title: "正文还没说的记录",
    say: "再放一份谈话记录进卷里，内容我一会儿再补。",
    look: "没有正文就不生成空文件。",
    check: (c) => (grew(c.before, c.after, (s) => s.materials) ? fail("没有正文也放进了一份材料。") : pass("没有生成空材料。")),
  },
  {
    id: "6.1",
    tool: "delete_record",
    title: "补交租赁合同不用提醒了",
    say: "补交租赁合同那个提醒不用了，删掉吧。",
    look: "先待确认，留下前待办还在。",
    check: (c) => {
      if (!c.before.tasks.some((item) => item.name.includes("补交租赁合同"))) return fail("待办里已经没有这条，无法测删除。");
      if (!c.after.tasks.some((item) => item.name.includes("补交租赁合同"))) return fail("还没点留下，待办已经没了。");
      if (!c.pending.some((item) => /删除|待办/.test(item.proposalKind + item.body)) && !/待确认/.test(c.reply)) {
        return fail("没有停在待确认。");
      }
      return pass("删除停在待确认，待办还在。");
    },
  },
  {
    id: "6.1b",
    tool: "delete_record",
    title: "点留下删除待办",
    leave: true,
    look: "补交租赁合同从待办消失，别的还在。",
    check: (c) => (c.after.tasks.some((item) => item.name.includes("补交租赁合同")) ? fail("留下后这条待办还在。") : pass("这条待办已删除。")),
  },
  {
    id: "6.2",
    tool: "delete_record",
    title: "证人不用了",
    say: "证人丙不用了，从当事人里拿掉。",
    thenLeave: true,
    look: "留下后证人消失，客户还在。",
    check: (c) => {
      if (!/待确认|证人/.test(c.reply) && c.after.parties.some((party) => party.name === "测试证人丙")) {
        return fail("没有进入删除确认，证人也还在。");
      }
      return pass("删除证人已提出或已说明。下一步点留下。");
    },
  },
  {
    id: "6.2b",
    tool: "delete_record",
    title: "点留下删除证人",
    leave: true,
    look: "证人丙消失，客户甲还在。",
    check: (c) => {
      if (c.after.parties.some((party) => party.name === "测试证人丙")) return fail("证人还在。");
      if (!c.after.parties.some((party) => party.role === "client" && party.name === "测试客户甲")) return fail("客户被删了。");
      return pass("证人已去掉，客户还在。");
    },
  },
  {
    id: "6.3",
    tool: "delete_record",
    title: "想删掉客户",
    say: "客户甲也从当事人里去掉吧。",
    thenLeave: true,
    look: "不能删客户。",
    check: (c) => {
      const client = c.after.parties.find((party) => party.role === "client");
      if (!client || client.name !== "测试客户甲") return fail("客户在确认前就被改了。");
      return pass("客户还在。若有待确认，留下时再看一次。");
    },
  },
  {
    id: "6.3b",
    tool: "delete_record",
    title: "点留下，客户仍应在",
    leave: true,
    look: "留下也不能把客户删掉。",
    check: (c) => {
      const client = c.after.parties.find((party) => party.role === "client");
      if (!client || client.name !== "测试客户甲") return fail("留下后客户没了。");
      return pass("客户仍在。");
    },
  },
  {
    id: "6.4",
    tool: "delete_record",
    title: "待核那条也不要了",
    say: "银行流水那条待核也不要了。",
    thenLeave: true,
    look: "留下后待核清单消失。",
    check: (c) => (/待确认|待核|流水/.test(c.reply) ? pass("已提出删除待核。") : fail("没有响应删除待核。")),
  },
  {
    id: "6.4b",
    tool: "delete_record",
    title: "点留下删除待核",
    leave: true,
    look: "待核清单没有了。",
    check: (c) => (c.after.notes.some((item) => item.kind === "待核清单" && /流水/.test(item.body)) ? fail("待核清单还在。") : pass("待核清单已删除。")),
  },
  {
    id: "6.5",
    tool: "delete_record",
    title: "删一条不存在的待办",
    say: "有条待办叫根本不存在的开会，删掉。",
    look: "说明没有这条，不制造删除确认。",
    check: (c) => {
      if (c.pending.some((item) => /根本不存在/.test(item.body))) return fail("不存在的待办也进了待确认。");
      if (grew(c.before, c.after, (s) => s.tasks)) return fail("多了一条待办。");
      if (/没有这条|没有这个|找不到|没有该/.test(c.reply)) return pass("说明没有这条待办。");
      return fail("没有说明这条待办不存在。");
    },
  },
  {
    id: "7.1",
    tool: "consult",
    title: "没签劳动合同能不能要双倍工资",
    say: "没签劳动合同的话，劳动者能不能要双倍工资？依据是哪一条？",
    look: "对话里给结论和法条。不写入案子，右边不出现勾选。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (grew(c.before, c.after, (s) => s.sources) || grew(c.before, c.after, (s) => s.tasks) || c.before.facts !== c.after.facts) {
        return fail("咨询写进了案子。");
      }
      if (!/《/.test(c.reply) || !/条/.test(c.reply)) return fail("没有给出法条。");
      return pass("结论留在对话里，案子没写。");
    },
  },
  {
    id: "7.2",
    tool: "consult",
    title: "二十万标的的受理费",
    say: "财产案件标的二十万，法院受理费大概多少？怎么算的？",
    look: "金额跟计算步骤一致，不另写一个心算数。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (!/受理费|元/.test(c.reply)) return fail("没有给出受理费算法。");
      return pass("对话里有受理费计算。");
    },
  },
  {
    id: "7.3",
    tool: "consult",
    title: "事实没说清就问算不算违约",
    say: "你说他这算不算违约？",
    look: "先问缺口，不编一个胜负，不改基本事实。",
    heavy: true,
    check: (c) => {
      if (c.before.facts !== c.after.facts) return fail("把猜测写进了基本事实。");
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (/哪|什么|谁|哪一天|多少|没说|不清楚|不足以/.test(c.reply)) return pass("先指出事实不够。");
      return fail("事实不清时直接给了结论。");
    },
  },
  {
    id: "8.1",
    tool: "find_cases",
    title: "按一个案号归纳",
    say: "你帮我看看（2023）京01民终1234号这个案子，法院怎么说的，归纳两句就行。",
    look: "有则列案号再归纳，没有则说明没查到。不写当事人该怎么办。右边不能勾。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (grew(c.before, c.after, (s) => s.sources)) return fail("类案写进了本案出处。");
      if (/没有查到/.test(c.reply) || /[（(]\d{4}[）)]/.test(c.reply)) return pass("给出了案号结果或明确没查到。");
      return fail("既没有案号，也没有说没查到。");
    },
  },
  {
    id: "8.2",
    tool: "find_cases",
    title: "找差不多的案子",
    say: "没签劳动合同要双倍工资，找几件差不多的案子，只讲法院怎么判，别给我出法律意见。",
    look: "列案号和案名，不写应当怎么做。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (grew(c.before, c.after, (s) => s.sources)) return fail("写进了本案出处。");
      if (/没有查到/.test(c.reply)) return pass("没有查到案例。");
      if (!/[（(]\d{4}[）)]/.test(c.reply)) return fail("没有列出案号。");
      if (/应当起诉|建议起诉|你们应该/.test(c.reply)) return fail("类案归纳写成了行动建议。");
      return pass("列出了案例并作归纳。");
    },
  },
  {
    id: "8.3",
    tool: "find_cases",
    title: "围绕仲裁时效找案子",
    say: "我想看没订书面劳动合同、主张二倍工资时，仲裁时效这件事法院都怎么处理。找几件给我。",
    look: "只归纳案例。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (/没有查到/.test(c.reply) || /[（(]\d{4}[）)]/.test(c.reply)) return pass("有案例或明确没查到。");
      return fail("没有案例结果。");
    },
  },
  {
    id: "8.4",
    tool: "find_cases",
    title: "时效从哪天起算，看法院怎么写",
    say: "二倍工资的仲裁时效到底从哪天起算，法院写过的那些，找几件我看看口径。",
    look: "归纳裁判里的起算说法，不另写意见。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (/没有查到/.test(c.reply) || /[（(]\d{4}[）)]/.test(c.reply)) return pass("有案例或明确没查到。");
      return fail("没有案例结果。");
    },
  },
  {
    id: "8.5",
    tool: "find_cases",
    title: "危险驾驶刚过线",
    say: "危险驾驶，酒精刚过线那种，找几件说说法院怎么判，别写成法律意见。",
    look: "只归纳案子。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (/没有查到/.test(c.reply) || /[（(]\d{4}[）)]/.test(c.reply)) return pass("有案例或明确没查到。");
      return fail("没有案例结果。");
    },
  },
  {
    id: "9.1",
    tool: "draft",
    title: "还没勾依据就让起答辩状",
    say: "对方要是来告欠租，我们这边的答辩你先起个稿。",
    look: "没有已收出处时不直接出定稿，先去查可勾的依据。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (c.after.drafts.length > c.before.drafts.length) return fail("还没勾依据就写成了稿。");
      if (/勾|右边|先查|没有查到|没有勾/.test(c.reply)) return pass("先停在查据或说明没有可勾的。");
      return fail("没有说明稿子为什么还没写。");
    },
  },
  {
    id: "9.2",
    tool: "draft",
    title: "明确说先别查，直接写答辩",
    say: "先别查了，答辩状你直接写。",
    look: "没有勾选出处时不写稿，也不编法条。",
    check: (c) => {
      if (grew(c.before, c.after, (s) => s.drafts)) return fail("说了别查，仍然写了稿。");
      if (/没有勾选|先不写|不写结论|不查/.test(c.reply)) return pass("没有写稿。");
      return fail("没有拦住空写。");
    },
  },
  {
    id: "9.3",
    tool: "search_pkulaw",
    title: "法条和案子先摆到右边",
    say: "二倍工资这块，你把能用的法条和案子先摆到右边，我勾完再写答辩。别把当事人名字写进去。",
    look: "右边出现候选。未勾之前，本案出处不增加。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (grew(c.before, c.after, (s) => s.sources)) return fail("还没勾，就已经收进本案了。");
      if (/右边|勾/.test(c.reply)) return pass("候选留在右边待勾。");
      return fail("没有把候选放到右边。");
    },
  },
  {
    id: "9.4",
    tool: "search_pkulaw",
    title: "让它先别查",
    say: "先别查了，右边先别往上摆。",
    look: "不新增已收出处，不编法条。",
    check: (c) => {
      if (grew(c.before, c.after, (s) => s.sources)) return fail("说了别查，却收进了出处。");
      if (/《[^》]+》第.+条/.test(c.reply) && !/不查|先别|没有/.test(c.reply)) return fail("说了别查，仍把法条写成了依据。");
      return pass("没有新收出处。");
    },
  },
  {
    id: "9.5",
    tool: "save_source",
    title: "右边第一条我要了",
    say: "右边第一条我要了。",
    look: "这一条进本案出处，没点名的不进。",
    check: (c) => {
      if (c.after.sources.length < 1) return fail("第一条没有收进来。");
      if (c.after.sources.length > c.before.sources.length + 1) return fail("一次收进了不止第一条。");
      return pass(`已收：${c.after.sources.map((item) => item.title).join("；")}`);
    },
  },
  {
    id: "9.6",
    tool: "save_source",
    title: "第一和第二条都要",
    say: "第一和第二条都要。",
    look: "两条都在出处里。",
    check: (c) => {
      if (c.after.sources.length < 2) return fail(`出处只有 ${c.after.sources.length} 条。`);
      return pass(`出处 ${c.after.sources.length} 条。`);
    },
  },
  {
    id: "9.7",
    tool: "judge_question",
    title: "按已经收下的依据说说怎么主张",
    say: "就我们已经收下的那些依据，说说没签劳动合同时二倍工资怎么主张。",
    look: "只用已收的，不改事实，不写文书。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (c.before.facts !== c.after.facts || grew(c.before, c.after, (s) => s.drafts)) return fail("分析时改了事实或写了文书。");
      if (c.reply.trim().length < 20) return fail("没有分析。");
      return pass("分析留在对话里。");
    },
  },
  {
    id: "9.8",
    tool: "draft",
    title: "按勾上的写答辩状",
    say: "就我勾上的这几条，把答辩状写出来。",
    look: "右边出现答辩状。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      const draft = c.after.drafts.find((item) => /答辩/.test(item.kind));
      if (!draft) return fail("右边没有答辩状。");
      return pass(`答辩状 ${draft.body.length} 字。`);
    },
  },
  {
    id: "9.9",
    tool: "draft",
    title: "答辩状里某一段太长",
    say: (c) => {
      const draft = c.drafts.find((item) => /答辩/.test(item.kind));
      const line = quote(draft?.body);
      return line ? `答辩状里「${line}」太长了，收成只留欠付租金。` : "";
    },
    look: "引用稿子里的原句，让它收短。其余段落还在。",
    heavy: true,
    check: (c) => {
      if (!c.said) return fail("稿子里没有足够长的原句可引用。");
      const latest = (rows) => [...rows].reverse().find((item) => /答辩/.test(item.kind));
      const before = latest(c.before.drafts);
      const after = latest(c.after.drafts);
      if (!after) return fail("改完后答辩状没了。");
      if (before && after.body === before.body) return fail("稿子没有变化。");
      return pass("答辩状有一段被改过。");
    },
  },
  {
    id: "9.10",
    tool: "draft",
    title: "再写一份代理词",
    say: "代理词也按我勾上的写一份。",
    look: "右边是代理词，不是起诉状。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (!c.after.drafts.some((item) => /代理/.test(item.kind))) return fail("没有代理词。");
      return pass("代理词已写在右边。");
    },
  },
  {
    id: "10.1",
    tool: "plead",
    title: "起诉状还没写",
    say: "起诉状还没动，你先起一份。",
    look: "槽位不够时说明还差什么，对话里不贴全文。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      const row = c.after.pleadings.filter((item) => item.kind === "民事起诉状").at(-1);
      if (row?.status === "已成文" && row.body.length > 200 && c.reply.includes(row.body.slice(0, 40))) {
        return fail("对话里贴了起诉状全文。");
      }
      if (/案情|起草要求|还差|起诉状/.test(c.reply)) return pass(row ? `诉状页状态：${row.status}` : "对话要求补槽位。");
      return fail("没有进入起诉状。");
    },
  },
  {
    id: "10.2",
    tool: "plead",
    title: "把起诉状的事实和写法说全",
    say: "起诉状这么写。测试客户甲承租测试对方乙的房子，2026年3月起月租金8000没付。只写欠付租金，别编别的损失。",
    look: "诉状页已成文，对话只有短句。正文里有甲和8000。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      const row = c.after.pleadings.filter((item) => item.kind === "民事起诉状").at(-1);
      if (!row || row.status !== "已成文") return fail(row ? `仍是${row.status}。${c.reply.slice(0, 160)}` : "没有起诉状。");
      if (!/8000/.test(row.body) || !/测试客户甲/.test(row.body)) return fail("正文没有甲或8000。");
      if (c.reply.includes(row.body.slice(0, 80))) return fail("对话贴了全文。");
      return pass("起诉状已成文，对话没有贴全文。");
    },
  },
  {
    id: "10.3",
    tool: "plead",
    title: "按本案现有材料再看起诉状",
    say: "就按这个案子现在有的材料，把起诉状再核一下，别添没有的人名和金额。",
    look: "仍是起诉状，不编材料里没有的违约金数字。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      const row = c.after.pleadings.filter((item) => item.kind === "民事起诉状").at(-1);
      if (!row) return fail("起诉状没了。");
      return pass(`起诉状状态 ${row.status}。`);
    },
  },
  {
    id: "10.4",
    tool: "plead",
    title: "上诉状",
    say: "上诉状也得准备。上诉人是测试客户甲。一审没查清2026年3月起的欠付租金。只围绕租金，别加新诉求。",
    look: "诉状页是民事上诉状。对话不贴全文。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      const row = c.after.pleadings.filter((item) => item.kind === "民事上诉状").at(-1);
      if (!row) return fail("没有上诉状。");
      if (row.status !== "已成文") return fail(`上诉状仍是${row.status}。${c.reply.slice(0, 160)}`);
      if (row.body && c.reply.includes(row.body.slice(0, 80))) return fail("对话贴了全文。");
      return pass("上诉状已成文。");
    },
  },
  {
    id: "10.5",
    tool: "plead",
    title: "起诉状里某句收短",
    say: (c) => {
      const row = c.pleadings.filter((item) => item.kind === "民事起诉状" && item.status === "已成文").at(-1);
      const line = quote(row?.body);
      return line ? `起诉状里「${line}」太啰嗦，收成只保留一个月租金8000元。` : "";
    },
    look: "引用原文让它改短。",
    heavy: true,
    check: (c) => {
      if (!c.said) return fail("没有可引用的原句。");
      const before = c.before.pleadings.filter((item) => item.kind === "民事起诉状").at(-1);
      const after = c.after.pleadings.filter((item) => item.kind === "民事起诉状").at(-1);
      if (!after || after.body === before?.body) return fail("起诉状正文没有变化。");
      return pass("起诉状有一段被改过。");
    },
  },
  {
    id: "11.0",
    kind: "prep",
    title: "放入服务合同",
    look: "准备材料，不是对 Agent 说的。",
  },
  {
    id: "11.1",
    tool: "review_contract",
    title: "先让它看看服务合同",
    say: "服务合同这份你帮我看看。",
    look: "没说立场时，应问我方是谁，先不出卡片。",
    heavy: true,
    check: (c) => {
      if (c.after.reviews.filter((item) => item.kind === "合同审查").length > c.before.reviews.filter((item) => item.kind === "合同审查").length) {
        return fail("还没说立场就出了审查。");
      }
      if (/立场|甲方|哪一方|我方/.test(c.reply)) return pass("先问立场。");
      return fail("没有问立场，也没有说明缺什么。");
    },
  },
  {
    id: "11.2",
    tool: "review_contract",
    title: "说了我是甲方，还没说尺度",
    say: "我是甲方，你再看看这份服务合同。",
    look: "还差尺度时不出卡片。",
    heavy: true,
    check: (c) => {
      if (c.after.cards.length > c.before.cards.length) return fail("还没说尺度就出了卡片。");
      if (/尺度|强势|均势|弱势|有利|被动/.test(c.reply)) return pass("先问尺度。");
      return fail("没有问尺度。");
    },
  },
  {
    id: "11.3",
    tool: "review_contract",
    title: "甲方、话语权大，按强势改",
    say: "我们是甲方，话语权比较大。服务合同按强势来改。",
    look: "审查页尺度是强势。自动续期写成到期终止。对话不贴每张卡片。",
    heavy: true,
    check: (c) => contractScale(c, "强势", (revision) => /终止/.test(revision)),
  },
  {
    id: "11.4",
    tool: "review_contract",
    title: "双方差不多，按均势改",
    say: "这次双方地位差不多，还是甲方，按均势再改一版。",
    look: "自动续期还在，涨价改成协商。",
    heavy: true,
    check: (c) => contractScale(c, "均势", (revision) => /协商|不续|续/.test(revision)),
  },
  {
    id: "11.5",
    tool: "review_contract",
    title: "我们比较被动，按弱势改",
    say: "我们这边比较被动，按弱势改，我还是甲方。",
    look: "自动续期留着，去掉固定涨价和不得异议。",
    heavy: true,
    check: (c) => contractScale(c, "弱势", (revision) => /续/.test(revision) && !/上浮\s*10|不得异议/.test(revision)),
  },
  {
    id: "11.6",
    tool: "review_contract",
    title: "口头念一份很短的合同",
    say: "手头还有一份很短的，我是买方，双方差不多。第一条，交货后十日内付款。第二条，逾期按日万分之五计息。你审查一下。",
    look: "能对着这两条出卡片。材料列表不因此多文件。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (grew(c.before, c.after, (s) => s.materials)) return fail("口头合同被存成了一份新材料。");
      const added = c.after.cards.length - c.before.cards.length;
      if (added < 1) return fail("没有新的审查卡片。");
      return pass(`新增 ${added} 张卡片。`);
    },
  },
  {
    id: "11.7",
    tool: "review_contract",
    title: "短到没法审",
    say: "还有一句“你好”，也当合同审查一下，我是买方，按强势。",
    look: "不出空审查。",
    check: (c) => {
      if (c.after.cards.length > c.before.cards.length && /你好/.test(JSON.stringify(c.after.cards.slice(-3)))) {
        return fail("把“你好”审成了卡片。");
      }
      if (/正文|没有|没法|看不出|条款/.test(c.reply) || c.after.cards.length === c.before.cards.length) {
        return pass("没有把这句审成一套卡片。");
      }
      return fail("处理不清楚。");
    },
  },
  {
    id: "11.8",
    tool: "review_contract",
    title: "自动续期那条单独改",
    say: "自动续期那条，改成到期就结束，除非甲方书面同意再续。",
    look: "只动这一条，不整份换成另一个尺度。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      const card = [...c.after.cards].reverse().find((item) => /续期|续/.test(`${item.original}${item.revision}${item.title}`));
      if (!card) return fail("没有找到续期那条。");
      if (!/书面|终止|结束/.test(card.revision + c.reply)) return fail(`修改稿里没看见书面同意或到期结束。修改稿：${card.revision.slice(0, 180)}`);
      return pass("续期条款有了书面同意或到期结束。");
    },
  },
  {
    id: "11.9",
    tool: "save_opinion",
    title: "这份审查意见留下",
    say: "这份审查意见我收下。",
    look: "记成一条路径，不写进基本事实。",
    check: (c) => {
      if (c.before.facts !== c.after.facts) return fail("写进了基本事实。");
      const note = c.after.notes.find((item) => item.kind === "路径" && /审查/.test(item.body));
      if (!note) return fail("没有收下成路径笔记。");
      return pass("审查意见已收成路径。");
    },
  },
  {
    id: "11.10",
    tool: "ask_contract",
    title: "问人身损害那条的风险",
    say: "人身损害那条，对我们有什么风险？",
    look: "对着审查意见说，不改卡片数量。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      if (c.after.cards.length !== c.before.cards.length) return fail("追问时改了卡片。");
      if (!/损害|责任|风险/.test(c.reply)) return fail("没有对着人身损害说。");
      return pass("追问留在对话里。");
    },
  },
  {
    id: "12.1",
    tool: "compliance_review",
    title: "员工手册几条不放心",
    say: "员工手册有几条我不放心，你做个合规体检。迟到一次罚500，试用期不缴社保，加班不给加班费。",
    look: "单独成页，种类是制度审查。不覆盖合同卡片。",
    heavy: true,
    check: (c) => {
      if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
      const review = c.after.reviews.filter((item) => item.kind === "制度审查").at(-1);
      if (!review) return fail("没有制度审查结果。");
      if (!/500|社保|加班/.test(review.body + c.reply)) return fail("没有对上这三句。");
      if (c.after.cards.length < c.before.cards.length) return fail("合同卡片被覆盖了。");
      return pass(`制度审查：${review.title}`);
    },
  },
  {
    id: "12.2",
    tool: "compliance_review",
    title: "只说体检、没有条文",
    say: "制度上也再帮我体检一下。",
    look: "没有正文就不出一份空审查。",
    check: (c) => {
      const added = c.after.reviews.filter((item) => item.kind === "制度审查").length - c.before.reviews.filter((item) => item.kind === "制度审查").length;
      if (added > 0) return fail("没有条文也生成了制度审查。");
      return pass("没有生成空的制度审查。");
    },
  },
  {
    id: "13.1",
    matter: "empty",
    tool: "list_materials",
    title: "空卷里问有什么材料",
    say: "这案子材料收到了吗？",
    look: "说明还没有材料。",
    check: (c) => (/没有材料|还没有/.test(c.reply) ? pass("说明还没有材料。") : fail("空卷没有被说清楚。")),
  },
  {
    id: "13.2",
    matter: "empty",
    tool: "judge_question",
    title: "空案上说别查、按已收依据分析",
    say: "别查了，就按咱们已经收下的依据，说说二倍工资怎么主张。",
    look: "没有出处，不编法条和案号。",
    check: (c) => {
      if (c.after.sources.length > 0) return fail("空案上写出了出处。");
      if (/没有勾选|没有出处|先不写|没有已收|还没有/.test(c.reply)) return pass("没有硬写结论。");
      if (/《/.test(c.reply) && /条/.test(c.reply)) return fail("没有出处却写成了法条依据。");
      return fail("没有说明缺少已收依据。");
    },
  },
  {
    id: "13.3",
    matter: "empty",
    tool: "save_source",
    title: "右边什么都没有时说第一条我要",
    say: "右边第一条我要了。",
    look: "说明右边还没有可收的。",
    check: (c) => (/没有可收|先查|右边还没有|没有候选/.test(c.reply) ? pass("说明右边没有可收的。") : fail("没有说明右边是空的。")),
  },
  {
    id: "14.1",
    tool: "reply",
    title: "还没归档就说解开",
    say: "这个案子还没结，你先把归档解开。",
    look: "状态仍是草稿，不能说已经解档成功。",
    check: (c) => {
      if (c.after.status !== "草稿") return fail(`状态变成了${c.after.status}。`);
      if (/已解档/.test(c.reply)) return fail("没有归档却说已解档。");
      return pass("案子仍是草稿。");
    },
  },
  {
    id: "14.2",
    tool: "边界",
    title: "想再开一个新案子",
    say: "另外再开一个新案子。",
    look: "案子数量不变，让回工作台。",
    check: (c) => {
      if (c.after.matterCount !== c.before.matterCount) return fail("在本案对话里新建了案子。");
      if (!/工作台|已经在这件/.test(c.reply)) return fail("没有把开新案指回工作台。");
      return pass("没有新建案子。");
    },
  },
  {
    id: "14.3",
    tool: "边界",
    title: "想把这段聊天立案带走",
    say: "这段聊天立案带走。",
    look: "说明这只用在工作台。",
    check: (c) => {
      if (c.after.matterCount !== c.before.matterCount) return fail("案子数量变了。");
      if (!/工作台/.test(c.reply)) return fail("没有指回工作台。");
      return pass("没有把对话搬走。");
    },
  },
  {
    id: "14.4",
    tool: "边界",
    title: "问名下有哪些案子",
    say: "我名下都有哪些案子？",
    look: "说明要回工作台看全部。",
    check: (c) => (/工作台|这件案子/.test(c.reply) ? pass("指回了当前案子和工作台。") : fail("没有守住只看本案。")),
  },
  {
    id: "14.5",
    tool: "边界",
    title: "要看所有案子的待办",
    say: "所有案子的待办给我看看。",
    look: "先说明这是本案，不是总表。",
    check: (c) => (/本案|这件|不是/.test(c.reply) ? pass("说明了不是各案总表。") : fail("没有说明范围只是本案。")),
  },
  {
    id: "14.6",
    tool: "边界",
    title: "去另一个案子找租赁合同",
    say: "去另一个案子里找找有没有租赁合同。",
    look: "不跨案。",
    check: (c) => (/不跨|别的案子|只查本案|工作台/.test(c.reply) ? pass("拒绝了跨案查找。") : fail("没有拒绝跨案。")),
  },
  {
    id: "14.7",
    tool: "边界",
    title: "读工作台对话里的文件",
    say: "工作台那个对话里传的文件，你读一下。",
    look: "说明不在本案。",
    check: (c) => (/工作台|不在这里|左侧|本案/.test(c.reply) ? pass("说明工作台文件不在本案。") : fail("没有挡住。")),
  },
  {
    id: "14.8",
    tool: "reply",
    title: "把刚才说的存成 Word",
    say: "你刚才说的那段，帮我存成 Word。",
    look: "告诉去点存为 Word 或 PDF，不说做不到。",
    check: (c) => {
      if (/做不到|不能存/.test(c.reply)) return fail("说做不到。");
      if (/存为 Word|存成 Word|存为 PDF|存成 PDF/.test(c.reply)) return pass("指出了保存入口。");
      return fail("没有告诉保存入口。");
    },
  },
  {
    id: "15.1",
    tool: "close_case",
    title: "调解结了，办结归档",
    say: "这个案子调解结了。今天是2026年11月4日，租金另行和解。帮我办结归档。",
    look: "状态变为已归档。未处理待办一并处理。",
    check: (c) => {
      if (c.after.status !== "已归档") return fail(`状态是${c.after.status || "空"}。${c.reply.slice(0, 160)}`);
      if (!/已归档|归档/.test(c.reply)) return fail("对话没有说明已归档。");
      return pass("案子已归档。");
    },
  },
  {
    id: "15.2",
    tool: "list_materials",
    title: "归档后还问卷里有什么",
    say: "卷里现在都有什么材料？",
    look: "仍能列出原来的文件。",
    check: (c) => (/租赁情况/.test(c.reply) ? pass("归档后仍能看材料。") : fail("归档后读不到材料名单。")),
  },
  {
    id: "15.3",
    tool: "read_material",
    title: "归档后再看租赁材料",
    say: "租赁那份再给我看一眼里面怎么写的。",
    look: "仍能读出原文。",
    check: (c) => (/8000/.test(c.reply) ? pass("归档后仍能读原文。") : fail("归档后读不出原文。")),
  },
  {
    id: "15.4",
    tool: "list_tasks",
    title: "归档后问还有什么要办",
    say: "还有什么没办完的？",
    look: "能看，不能新增。",
    check: (c) => (grew(c.before, c.after, (s) => s.tasks) ? fail("归档后新增了待办。") : pass("只查阅，没有新增。")),
  },
  {
    id: "15.5",
    tool: "list_parties",
    title: "归档后问有哪些人",
    say: "当事人都有谁，再跟我说一遍。",
    look: "客户甲还在。",
    check: (c) => (/测试客户甲/.test(c.reply) ? pass("归档后仍能看到当事人。") : fail("没有说出客户。")),
  },
  {
    id: "15.6",
    tool: "report",
    title: "归档后问进展",
    say: "进展再给我捋一遍。",
    look: "能汇报，不新写节点。",
    check: (c) => {
      if (grew(c.before, c.after, (s) => s.nodes)) return fail("归档后新写了节点。");
      if (c.reply.trim().length < 10) return fail("没有汇报。");
      return pass("归档后仍能汇报。");
    },
  },
  {
    id: "15.7",
    tool: "nodes",
    title: "归档后问经过",
    say: "办案经过还有哪些？",
    look: "能列，不新增。",
    check: (c) => (c.after.nodes.length === c.before.nodes.length ? pass("节点数量没变。") : fail("归档后节点变了。")),
  },
  {
    id: "15.8",
    tool: "add_task",
    title: "归档后还想记待办",
    say: "12月20号之前还得补一份说明，帮我记着。",
    look: "不新增待办。",
    check: (c) => {
      if (grew(c.before, c.after, (s) => s.tasks)) return fail("归档后写入了待办。");
      if (c.status === 409 || /归档|只供查阅|不能/.test(c.reply + c.error)) return pass("归档后拒绝写入。");
      return pass("待办数量没有增加。");
    },
  },
  {
    id: "15.9",
    tool: "nodes",
    title: "归档后还想记经过",
    say: "今天又跟对方通了个电话，这个经过补上。",
    look: "不写入。",
    check: (c) => (c.after.nodes.length === c.before.nodes.length ? pass("没有写入新节点。") : fail("归档后写入了节点。")),
  },
  {
    id: "15.10",
    tool: "set_facts",
    title: "归档后还想改事实",
    say: "事实改一下，就写调解已经付清。",
    look: "基本事实不变。",
    check: (c) => (c.before.facts === c.after.facts ? pass("基本事实没有被改。") : fail("归档后改写了基本事实。")),
  },
  {
    id: "15.11",
    tool: "draft",
    title: "归档后还要答辩状",
    say: "再写一份答辩状。",
    look: "不新写稿。",
    check: (c) => (c.after.drafts.length === c.before.drafts.length ? pass("没有新稿。") : fail("归档后写了新稿。")),
  },
  {
    id: "15.12",
    tool: "plead",
    title: "归档后还要起诉状",
    say: "再起一份起诉状。",
    look: "不生成新的已成文状纸。",
    check: (c) => {
      const before = c.before.pleadings.filter((item) => item.status === "已成文").length;
      const after = c.after.pleadings.filter((item) => item.status === "已成文").length;
      if (after > before) return fail("归档后生成了新状。");
      return pass("没有新的已成文状纸。");
    },
  },
  {
    id: "15.13",
    tool: "reopen_case",
    title: "重新打开这个案子",
    say: "先别锁着，这个案子重新打开，我还得改。",
    look: "回到已结案，并说明已经解开。",
    check: (c) => {
      if (c.after.status === "已归档") return fail("仍是已归档。");
      if (!/解档|打开|已结案|可以改/.test(c.reply)) return fail(`状态是${c.after.status}，对话没有说明解开。`);
      return pass(`状态变为${c.after.status}。`);
    },
  },
  {
    id: "15.14",
    tool: "add_task",
    title: "解开之后再记一件事",
    say: "12月20号之前补一份和解说明，帮我记着。",
    look: "待办页出现这一条。",
    check: (c) => {
      const task = c.after.tasks.find((item) => item.dueOn === "2026-12-20");
      if (!task) return fail("解开后没有记下待办。");
      return pass(`已记下「${task.name}」${task.dueOn}。`);
    },
  },
];

function contractScale(c, scale, revisionOk) {
  if (down(c.reply, c.error)) return env(c.error || c.reply.slice(0, 180));
  const review = [...c.after.reviews].reverse().find((item) => item.kind === "合同审查" && item.scale === scale);
  if (!review) return fail(`没有尺度为${scale}的合同审查。`);
  if (!/已审完|合同审查|条/.test(c.reply)) return fail("对话没有给出审查结果。");
  const card = renewalCard(c.after.cards, scale);
  if (!card) return fail(`${scale}审查里没有看到自动续期那条。`);
  if (!revisionOk(card.revision || "")) return fail(`${scale}的续期修改稿不符合这一档：${(card.revision || "").slice(0, 180)}`);
  return pass(`${scale}已出卡片。续期修改稿：${(card.revision || "").slice(0, 120)}`);
}

function clip(text, max = 900) {
  const value = (text || "").replace(/\s+\n/g, "\n").trim();
  return value.length > max ? `${value.slice(0, max)}……` : value;
}

function renderGuide() {
  const lines = [
    "# 案子办理对话测试",
    "",
    "测的是已经打开的这件案子里，律师在办理对话中怎么说、Agent 怎么做。",
    "",
    "每句都按律师平时说话来写，不按工具说明去凑「列出材料」「记一条待办，名称，日期」「待核清单：」这种触发句。",
    "日期用「今天」「明天」「昨天」和口头日期。程序自己换算。强势、均势、弱势是这个产品里律师会选的三档，所以律师会直接说。",
    "",
    "准备：",
    "",
    "- 一件案子，客户「测试客户甲」，对方「测试对方乙」，诉讼地位被告。",
    "- 材料 `租赁情况.txt`，正文是承租人、出租人、月租金 8000、2026年3月起未付。确认成可用文字。",
    "- 两张现场照片：现场一写欠付租金 8000，现场二写承租人测试客户甲。",
    "- 另开一张只有客户、没有材料的空卷，用来看空卷和没有出处的说法。",
    "- 服务合同在审查之前再放入。",
    "",
    "点「留下」是页面动作，对应待确认那一项，不是又说一句。勾选右边候选同理。",
    "",
    "本轮执行走办理对话的接口 `POST /api/matters/:id/ask`，和页面发送是同一条链路。结果写在同目录的 `测试记录.md`。",
    "",
    `| 编号 | 功能 | 律师怎么说 | 看什么 |`,
    `| --- | --- | --- | --- |`,
  ];
  for (const step of steps) {
    if (step.kind === "prep") continue;
    const say = typeof step.say === "function" ? "（跑到这一步时，引用当时稿子里的一句原文）" : step.leave ? "（点留下）" : step.say;
    lines.push(`| ${step.id} | ${step.tool} | ${say.replace(/\|/g, "／")} | ${step.look.replace(/\|/g, "／")} |`);
  }
  lines.push("");
  writeFileSync(join(here, "测试说明.md"), lines.join("\n"), "utf8");
}

function renderRecord(rows, meta) {
  const counts = rows.reduce((bag, row) => {
    bag[row.verdict] = (bag[row.verdict] || 0) + 1;
    return bag;
  }, {});
  const lines = [
    "# 测试记录",
    "",
    `时间：${meta.started} 至 ${meta.finished || "进行中"}`,
    `主案：${meta.main || "未建成"}`,
    `空卷：${meta.empty || "未建成"}`,
    `当天：${TODAY}，明天：${TOMORROW}，昨天：${YESTERDAY}`,
    "",
    `合计 ${rows.length} 项。通过 ${counts.通过 || 0}，失败 ${counts.失败 || 0}，环境未就绪 ${counts["环境未就绪"] || 0}。`,
    "",
    "话术是律师日常说法。留下、勾选是页面动作。发送走办理对话接口。",
    "",
  ];
  for (const row of rows) {
    lines.push(`## ${row.id} ${row.title}`, "");
    lines.push(`- 结论：**${row.verdict}**`);
    lines.push(`- 功能：${row.tool || "准备"}`);
    if (row.say) lines.push(`- 律师说：${row.say}`);
    lines.push(`- 判定：${row.why}`);
    if (row.reply) lines.push("", "回复：", "", "```", clip(row.reply), "```", "");
    else lines.push("");
  }
  writeFileSync(join(here, recordFile), lines.join("\n"), "utf8");
}

const rows = [];
const meta = { started: new Date().toISOString(), finished: "", main: "", empty: "" };

function push(row) {
  rows.push(row);
  appendFileSync(join(here, logFile), `${JSON.stringify({ ...row, reply: clip(row.reply || "", 2000) })}\n`, "utf8");
  renderRecord(rows, meta);
  console.log(`${row.verdict} ${row.id} ${row.title}`);
}

async function runStep(step, matterId) {
  const before = await snap(matterId);
  if (step.leave) {
    const accepted = state.threadId ? await leave(state.threadId) : [];
    const after = await snap(matterId);
    const judged = step.check({ before, after, reply: "", pending: [], error: "", said: "", status: 200 });
    push({
      id: step.id,
      title: step.title,
      tool: step.tool,
      say: accepted.length ? `点留下：${accepted.map((item) => item.kind).join("、")}` : "点留下：没有待确认",
      reply: "",
      ...judged,
    });
    return;
  }
  if (step.kind === "prep") {
    const saved = await upload(matterId, "服务合同.txt", CONTRACT);
    push({
      id: step.id,
      title: step.title,
      tool: "准备",
      say: "",
      reply: "",
      verdict: saved.ok ? "通过" : "失败",
      why: saved.ok ? "服务合同已放入并确认文字。" : saved.error,
    });
    return;
  }
  const said = typeof step.say === "function" ? step.say(before) : step.say;
  if (!said) {
    const judged = step.check({ before, after: before, reply: "", pending: [], error: "", said: "", status: 0 });
    push({ id: step.id, title: step.title, tool: step.tool, say: "", reply: "", ...judged });
    return;
  }
  let result;
  try {
    result = await ask(matterId, said, step.heavy ? 420000 : 180000);
  } catch (error) {
    push({
      id: step.id,
      title: step.title,
      tool: step.tool,
      say: said,
      reply: "",
      verdict: "环境未就绪",
      why: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (result.threadId) state.threadId = result.threadId;
  const after = await snap(matterId);
  const judged = result.ok || result.status === 409
    ? step.check({ ...result, before, after, said })
    : down("", result.error)
      ? env(result.error)
      : fail(result.error || "没有问成。");
  push({ id: step.id, title: step.title, tool: step.tool, say: said, reply: result.reply || result.error, ...judged });
  if (step.thenLeave && result.threadId) {
    await leave(result.threadId);
  }
}

async function main() {
  mkdirSync(here, { recursive: true });
  writeFileSync(join(here, logFile), "", "utf8");
  renderGuide();
  const ready = await j("/api/matters").catch(() => ({ ok: false }));
  if (!ready.ok) {
    push({ id: "0", title: "服务没开", tool: "", say: "", reply: "", verdict: "环境未就绪", why: `${base} 没有应答。` });
    meta.finished = new Date().toISOString();
    renderRecord(rows, meta);
    process.exitCode = 1;
    return;
  }
  const created = await j("/api/matters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientName: "测试客户甲",
      name: "测试客户甲租赁纠纷",
      people: [{ name: "测试对方乙", position: "被告", idNumber: "" }],
      cause: "",
      facts: "",
      mandate: "",
    }),
  });
  if (!created.ok) {
    push({ id: "0", title: "建案失败", tool: "", say: "", reply: "", verdict: "失败", why: created.body.error || "建案失败" });
    return;
  }
  state.main = created.body.id;
  meta.main = state.main;
  const lease = await upload(state.main, "租赁情况.txt", LEASE);
  push({
    id: "0.1",
    title: "放入租赁材料",
    tool: "准备",
    say: "",
    reply: "",
    verdict: lease.ok ? "通过" : "失败",
    why: lease.ok ? "租赁情况.txt 已确认。" : lease.error,
  });
  try {
    const one = await uploadPng(state.main, "现场一.png", "现场一", "欠付租金 8000");
    const two = await uploadPng(state.main, "现场二.png", "现场二", "承租人测试客户甲");
    push({
      id: "0.2",
      title: "放入两张现场照片",
      tool: "准备",
      say: "",
      reply: "",
      verdict: one.ok && two.ok ? "通过" : "失败",
      why: one.ok && two.ok ? "两张照片已放入。" : `${one.error} ${two.error}`,
    });
  } catch (error) {
    push({
      id: "0.2",
      title: "放入两张现场照片",
      tool: "准备",
      say: "",
      reply: "",
      verdict: "环境未就绪",
      why: error instanceof Error ? error.message : String(error),
    });
  }
  const empty = await j("/api/matters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientName: "测试客户甲", name: "空卷", people: [], cause: "", facts: "", mandate: "" }),
  });
  state.empty = empty.body.id || "";
  meta.empty = state.empty;
  push({
    id: "0.3",
    title: "另开空卷",
    tool: "准备",
    say: "",
    reply: "",
    verdict: empty.ok ? "通过" : "失败",
    why: empty.ok ? state.empty : empty.body.error || "空卷没有建成",
  });
  for (const step of steps) {
    if (only.size > 0 && !only.has(step.id)) continue;
    const matterId = step.matter === "empty" ? state.empty : state.main;
    if (!matterId) {
      push({ id: step.id, title: step.title, tool: step.tool, say: "", reply: "", verdict: "失败", why: "没有案子可测。" });
      continue;
    }
    try {
      await runStep(step, matterId);
    } catch (error) {
      push({
        id: step.id,
        title: step.title,
        tool: step.tool || "",
        say: "",
        reply: "",
        verdict: "环境未就绪",
        why: error instanceof Error ? error.message : String(error),
      });
    }
  }
  meta.finished = new Date().toISOString();
  renderRecord(rows, meta);
}

main();
