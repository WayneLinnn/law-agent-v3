const NOT_NAME =
  /^(我|你|他|她|它|我们|咱们|你们|他们|她们|本人|自己|人家|这个|那个|给我|为我|帮我|什么|哪个|哪些|怎么|如何|客户|名称|案子|案件|新案子|新案件)$/;

export function wantsNewCase(text: string) {
  return /开一张卡|(?:创建|新建|开)(?:一)?(?:个|张)?新?(?:案子|案件)/.test(text);
}

export function wantsFileTake(text: string) {
  return /立案并带走|立案带走|带走(?:这|刚才|上面|这段)|收进案|据此立案/.test(text);
}

export function isFileTakeReply(text: string) {
  return text.includes("可以立案并带走") || text.includes("还没有可带走的问答");
}

export function fileTakeFields(pieces: string[]) {
  let clientName = "";
  let caseName = "";
  for (const piece of pieces) {
    const client = clientFrom(piece);
    const name = caseNameFrom(piece);
    if (client) clientName = client;
    if (name) caseName = name;
  }
  return { clientName, caseName };
}

export function fileTakePrompt(clientName: string, caseName: string, hasTurns: boolean) {
  if (!hasTurns) return "还没有可带走的问答。先在这里问一轮，再说立案并带走。";
  const held = [
    clientName ? `客户已记下：${clientName}` : "",
    caseName ? `案件名称已记下：${caseName}` : "",
  ].filter(Boolean);
  const lead = held.length > 0 ? `${held.join("。")}。` : "";
  return `${lead}可以立案并带走。下面点明客户和案件名称，勾上要进案的问答，再确认。不会自动建卡。`;
}

export function hasTakeableTalk(messages: Array<{ role: string; body: string }>) {
  for (let index = 0; index < messages.length; index += 1) {
    const lawyer = messages[index];
    if (lawyer.role !== "lawyer") continue;
    const model = messages[index + 1];
    if (!model || model.role !== "model") continue;
    if (!wantsFileTake(lawyer.body)) return true;
    index += 1;
  }
  return false;
}

export function leavesNewCase(text: string) {
  return /[？?]/.test(text) || /吗$|怎么|是否|能否|为什么|哪些/.test(text);
}

export function clientFrom(text: string) {
  const labeled = text.match(/客户(?:名称)?(?:是|为|叫|：|:)\s*([^\s，,。；;]{1,40})/);
  if (labeled?.[1]) return keepName(labeled[1]);
  const mine = text.match(/我的客户(?:是|为|叫|：|:)?\s*([^\s，,。；;]{1,40})/);
  if (mine?.[1]) return keepName(mine[1]);
  const given = text.match(/(?:给|为)([^\s，,。；;]{1,20}?)(?:开一张卡|新建|创建)/);
  if (given?.[1]) return keepName(given[1]);
  return "";
}

export function caseNameFrom(text: string) {
  const labeled = text.match(/(?:案件名称|案子名称|案件名|案名)(?:是|为|叫|：|:)\s*([^\s，,。；;]{1,80})/);
  if (labeled?.[1]) return keepName(labeled[1]);
  const called = text.match(/(?:案子|案件)(?:叫|名为|名称是)\s*([^\s，,。；;]{1,80})/);
  if (called?.[1]) return keepName(called[1]);
  return "";
}

export function acceptClient(value: string) {
  return keepName(value);
}

export function acceptCaseName(value: string) {
  return keepName(value);
}

export function newCaseFrom(pieces: string[]) {
  let clientName = "";
  let caseName = "";
  for (const piece of pieces) {
    const client = clientFrom(piece);
    const name = caseNameFrom(piece);
    if (client) clientName = client;
    if (name) caseName = name;
    const bare = bareName(piece);
    if (!bare || client || name) continue;
    if (!clientName) clientName = bare;
    else if (!caseName) caseName = bare;
  }
  return { clientName, caseName };
}

export function missingCasePrompt(clientName: string, caseName: string) {
  const missing = [clientName ? "" : "客户名称", caseName ? "" : "案件名称"].filter(Boolean);
  const held = [
    clientName ? `客户已记下：${clientName}` : "",
    caseName ? `案件名称已记下：${caseName}` : "",
  ].filter(Boolean);
  const hint =
    missing.length === 2
      ? "说一下客户是谁、案子叫什么。"
      : missing[0] === "客户名称"
        ? "说一下客户是谁。"
        : "说一下这件案子叫什么。";
  const lead = held.length > 0 ? `${held.join("。")}。` : "";
  return `${lead}要新建案子，还缺${missing.join("和")}。${hint}`;
}

function bareName(text: string) {
  const value = text.trim();
  if (!value || value.length > 40) return "";
  if (/[。？?！!]/.test(value)) return "";
  if (wantsNewCase(value) || leavesNewCase(value)) return "";
  if (/不用|取消|算了|先不|客户|案件|案子|名称/.test(value)) return "";
  return keepName(value);
}

function keepName(raw: string) {
  const value = raw.trim();
  if (!value || NOT_NAME.test(value)) return "";
  if (/^(一张|一个|新的?|这个|那个)?(案子|案件|卡)$/.test(value)) return "";
  return value;
}
