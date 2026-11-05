export const CONTRACT_SCALES = [
  { id: "强势", text: "全力争取我方利益，主动增加权利条款，规避潜在义务风险" },
  { id: "均势", text: "平衡合规与公平性，优化条款可执行性，调整明显不利内容" },
  { id: "弱势", text: "以促成合作为目标，保障我方关键权益，提示重大风险条款" },
] as const;

export type ContractScale = (typeof CONTRACT_SCALES)[number]["id"];

export function isContractScale(value: string): value is ContractScale {
  return value === "强势" || value === "均势" || value === "弱势";
}
