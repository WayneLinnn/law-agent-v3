export type PanelLine = { role: string; name: string };

const ROLE = /^(代理审判员|人民陪审员|法官助理|承办法官|审判长|审判员|书记员)([\u4e00-\u9fff]{2,4})$/;
const NOT_NAME = new Set(["认为", "依法", "依照", "可以", "应当", "本院", "上述", "如下", "驳回"]);

export function asksPanel(text: string) {
  if (/挂|通讯录|新增|记下/.test(text)) return false;
  return /承办法官|审判长|审判员|人民陪审员|法官助理|书记员|合议庭|谁审|哪个法官/.test(text);
}

export function panelLines(text: string): PanelLine[] {
  const lines: PanelLine[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/[\s\u3000]/g, "");
    const match = line.match(ROLE);
    if (!match || NOT_NAME.has(match[2])) continue;
    const key = `${match[1]}${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ role: match[1], name: match[2] });
  }
  return lines;
}

export function panelReply(filename: string, lines: PanelLine[], asked: string) {
  if (lines.length === 0) return "";
  const named = lines.filter((line) => line.role === "承办法官");
  const chief = lines.filter((line) => line.role === "审判长");
  const lead = /承办法官/.test(asked)
    ? (named.length > 0 ? named : chief).map((line) => `${named.length > 0 ? "承办法官" : "审判长"}${line.name}`).join("、")
    : "";
  const body = lines.map((line) => `${line.role} ${line.name}`).join("\n");
  return [lead ? `${lead}。` : "", filename, body].filter(Boolean).join("\n");
}
