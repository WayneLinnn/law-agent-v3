const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function clockLine(now = new Date()) {
  return `今天是 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}，星期${WEEK[now.getDay()]}，现在是 ${pad(now.getHours())}:${pad(now.getMinutes())}。`;
}

export function asksClock(text: string) {
  const value = text.trim().replace(/[。？?！!，,\s]/g, "");
  return /^(今天(是)?几号|今天的日期|现在几点|现在是几点|今天星期几)$/.test(value);
}

function asDay(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shift(now: Date, days: number) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return asDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function fullYear(year: number) {
  return year >= 100 ? year : 2000 + year;
}

export function relativeDay(text: string, now = new Date()) {
  if (/大后天/.test(text)) return shift(now, 3);
  if (/后天/.test(text)) return shift(now, 2);
  if (/明天/.test(text)) return shift(now, 1);
  if (/大前天/.test(text)) return shift(now, -3);
  if (/前天/.test(text)) return shift(now, -2);
  if (/昨天/.test(text)) return shift(now, -1);
  if (/今天/.test(text)) return shift(now, 0);
  const week = text.match(/(上上|上|下下|下|本|这)?个?(?:周|星期)([日一二三四五六天])/);
  if (!week) return "";
  const name = week[2] === "天" ? "日" : week[2];
  const target = WEEK.indexOf(name);
  if (target < 0) return "";
  let delta = target - now.getDay();
  const prefix = week[1] ?? "";
  if (prefix === "上") delta -= 7;
  else if (prefix === "上上") delta -= 14;
  else if (prefix === "下") delta += 7;
  else if (prefix === "下下") delta += 14;
  else if (prefix !== "本" && prefix !== "这" && delta < 0) delta += 7;
  return shift(now, delta);
}

export function dayFromSpeech(text: string, now = new Date()) {
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) {
    const [year, month, day] = iso[0].split("-").map(Number);
    const value = asDay(year, month, day);
    if (value) return value;
  }
  const ymd = text.match(/(\d{2,4})年(\d{1,2})月(\d{1,2})[日号]/);
  if (ymd) {
    const value = asDay(fullYear(Number(ymd[1])), Number(ymd[2]), Number(ymd[3]));
    if (value) return value;
  }
  const md = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (md) {
    const value = asDay(now.getFullYear(), Number(md[1]), Number(md[2]));
    if (value) return value;
  }
  return relativeDay(text, now);
}
