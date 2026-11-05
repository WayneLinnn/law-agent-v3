export type LegalTurn = "analyze" | "draft";

export type SearchChoice = "on" | "off" | "auto";

export function legalTurn(text: string): LegalTurn | null {
  if (/写成一份|写一份文书|写成文书|分析成文/.test(text)) return "draft";
  if (/分析法律问题/.test(text)) return "analyze";
  return null;
}

export function searchChoice(text: string): SearchChoice {
  if (/别查|不查|不要查|不用查|指定不查/.test(text)) return "off";
  if (/要查法宝|查法宝|查 ?Alpha|指定查/.test(text)) return "on";
  return "auto";
}
