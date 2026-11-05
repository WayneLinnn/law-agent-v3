const CAUSES = ["劳动争议", "民间借贷", "买卖合同", "房屋租赁", "公司决议", "商标", "著作权", "交通肇事", "危险驾驶"];

export type CaseDimensions = {
  entry: "多维度";
  query: string;
  cause: string;
  dateStart: string;
  dateEnd: string;
};

export function caseDimensions(text: string): CaseDimensions | null {
  const years = text.match(/(20\d{2})\s*[-–—~到至]\s*(20\d{2})/);
  if (!years) return null;
  if (!/判决|案例|争议|劳动|合同|罪/.test(text)) return null;
  const cause = CAUSES.find((item) => text.includes(item)) || (/劳动/.test(text) ? "劳动争议" : "");
  const words = ["未订立书面劳动合同", "未签劳动合同", "二倍工资", "双倍工资", "经济补偿", "驳回", "改判", "无罪", "自首"].filter(
    (item) => text.includes(item),
  );
  const query = (words.length > 0 ? words : text.replace(/20\d{2}/g, "").trim().split(/[，,。]/).slice(0, 2))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
  return {
    entry: "多维度",
    query: query || cause || "判决",
    cause,
    dateStart: `${years[1]}-01-01`,
    dateEnd: `${years[2]}-12-31`,
  };
}
