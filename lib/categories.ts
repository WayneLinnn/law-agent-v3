export const CATEGORIES = ["民事", "刑事", "行政诉讼", "非诉专项", "法律顾问", "其他"] as const;

export function isCategory(value: string) {
  return value === "" || CATEGORIES.some((item) => item === value);
}
