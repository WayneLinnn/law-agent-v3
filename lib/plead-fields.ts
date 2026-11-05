export const PLEAD_KINDS = ["民事起诉状", "民事上诉状", "答辩状", "代理词"] as const;
export type PleadKind = (typeof PLEAD_KINDS)[number];

export const PLEAD_FIELDS: Record<PleadKind, string[]> = {
  民事起诉状: ["案情概要", "起草要求"],
  民事上诉状: ["上诉人", "上诉理由", "起草要求"],
  答辩状: ["答辩意见", "起草要求"],
  代理词: ["争议焦点", "起草要求"],
};

export function isPleadKind(value: string): value is PleadKind {
  return (PLEAD_KINDS as readonly string[]).includes(value);
}

export function pleadKindFrom(text: string): PleadKind | "" {
  if (/代理词/.test(text)) return "代理词";
  if (/答辩/.test(text)) return "答辩状";
  if (/上诉状/.test(text)) return "民事上诉状";
  if (/起诉状/.test(text)) return "民事起诉状";
  return "";
}

const LAW_CITE = /《[^》\n]{1,80}》第[0-9０-９一二三四五六七八九十百零千]{1,12}条(?:之[0-9０-９一二三四五六七八九十]{1,4})?/g;
const CASE_CITE = /[（(]\d{4}[）)][^\s，。；、\n]{1,30}号/g;

export function citationsIn(text: string) {
  return [...new Set([...(text.match(LAW_CITE) ?? []), ...(text.match(CASE_CITE) ?? [])])];
}

export function inventedCitations(warnings: string) {
  return warnings
    .split("\n")
    .map((line) => line.replace(/（疑似编造）\s*$/, "").trim())
    .filter((line) => line && !line.startsWith("有法律结论"));
}

export function emptySlots(kind: PleadKind) {
  return Object.fromEntries(PLEAD_FIELDS[kind].map((field) => [field, ""])) as Record<string, string>;
}

export function missingSlots(kind: PleadKind, slots: Record<string, string>) {
  return PLEAD_FIELDS[kind].filter((field) => !slots[field]?.trim());
}
