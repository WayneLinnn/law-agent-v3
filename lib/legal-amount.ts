const BANDS: Array<[number, number, number]> = [
  [10_000, 0, 50],
  [100_000, 0.025, 0],
  [200_000, 0.02, 0],
  [500_000, 0.015, 0],
  [1_000_000, 0.01, 0],
  [2_000_000, 0.009, 0],
  [5_000_000, 0.008, 0],
  [10_000_000, 0.007, 0],
  [20_000_000, 0.006, 0],
  [Number.POSITIVE_INFINITY, 0.005, 0],
];

const EXECUTION_BANDS: Array<[number, number, number]> = [
  [10_000, 0, 50],
  [500_000, 0.015, 0],
  [5_000_000, 0.01, 0],
  [10_000_000, 0.005, 0],
  [Number.POSITIVE_INFINITY, 0.001, 0],
];

export type AmountParams = {
  amount?: number;
  wage?: number;
  months?: number;
  days?: number;
  dailyRate?: number;
};

export type AmountResult = {
  calculationType: string;
  amount: number;
  result: number;
  steps: string[];
  warning: string;
};

function yuan(value: number) {
  return Math.round(value * 100) / 100;
}

function banded(amount: number, bands: Array<[number, number, number]>) {
  let left = amount;
  let cursor = 0;
  let total = 0;
  const steps: string[] = [];
  for (const [cap, rate, flat] of bands) {
    if (left <= 0) break;
    const slice = Math.min(left, cap - cursor);
    const part = flat > 0 ? flat : yuan(slice * rate);
    total += part;
    steps.push(
      flat > 0
        ? `不超过${cursor + slice}元：${part}元`
        : `${cursor}元至${cursor + slice}元：${slice}元 × ${rate * 100}% = ${part}元`,
    );
    left -= slice;
    cursor += slice;
  }
  return { result: yuan(total), steps };
}

function preservation(amount: number) {
  if (amount <= 1_000) return { result: 30, steps: ["不超过1000元：30元"] };
  const steps = ["不超过1000元：30元"];
  let total = 30;
  const mid = Math.min(amount, 100_000) - 1_000;
  const midFee = yuan(mid * 0.01);
  total += midFee;
  steps.push(`超过1000元至${Math.min(amount, 100_000)}元：${mid}元 × 1% = ${midFee}元`);
  if (amount > 100_000) {
    const high = amount - 100_000;
    const highFee = yuan(high * 0.005);
    total += highFee;
    steps.push(`超过10万元的部分：${high}元 × 0.5% = ${highFee}元`);
  }
  if (total > 5_000) {
    steps.push(`分段合计${yuan(total)}元，保全费上限5000元`);
    total = 5_000;
  }
  return { result: yuan(total), steps };
}

function serviceMonths(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const extra = rest >= 6 ? 1 : rest > 0 ? 0.5 : 0;
  return years + extra;
}

function done(
  calculationType: string,
  amount: number,
  result: number,
  steps: string[],
  warning = "",
): AmountResult {
  return { calculationType, amount, result: yuan(result), steps, warning };
}

export function calculateLegalAmount(
  calculationType: string,
  params: AmountParams,
): AmountResult | { error: string } {
  if (calculationType === "litigation_preservation_fee") {
    if (!params.amount || params.amount <= 0) return { error: "缺少保全金额。不要心算。" };
    const fee = preservation(params.amount);
    return done(calculationType, params.amount, fee.result, fee.steps);
  }
  if (calculationType === "litigation_enforcement_fee") {
    if (!params.amount || params.amount <= 0) return { error: "缺少执行金额。不要心算。" };
    const fee = banded(params.amount, EXECUTION_BANDS);
    return done(calculationType, params.amount, fee.result, fee.steps);
  }
  if (calculationType === "delayed_performance_interest") {
    if (!params.amount || params.amount <= 0 || !params.days || params.days <= 0) {
      return { error: "缺少本金或天数。不要心算。" };
    }
    const result = yuan(params.amount * 0.000175 * params.days);
    return done(
      calculationType,
      params.amount,
      result,
      [`加倍部分债务利息 = ${params.amount}元 × 日万分之1.75 × ${params.days}天 = ${result}元`],
      "这里只算加倍部分。一般债务利息另按生效文书确定的利率，没有利率就不要心算。",
    );
  }
  if (calculationType === "overdue_interest") {
    if (!params.amount || params.amount <= 0 || !params.days || params.days <= 0 || !params.dailyRate || params.dailyRate <= 0) {
      return { error: "缺少本金、日利率或天数。不要心算。" };
    }
    const result = yuan(params.amount * params.dailyRate * params.days);
    return done(calculationType, params.amount, result, [
      `${params.amount}元 × 日利率${params.dailyRate} × ${params.days}天 = ${result}元`,
    ]);
  }
  if (
    calculationType === "economic_compensation" ||
    calculationType === "illegal_termination_compensation" ||
    calculationType === "notice_pay"
  ) {
    if (!params.wage || params.wage <= 0) return { error: "缺少月工资。不要心算。" };
    if (calculationType !== "notice_pay" && (!params.months || params.months <= 0)) {
      return { error: "缺少工作月数。不要心算。" };
    }
    const units = calculationType === "notice_pay" ? 1 : serviceMonths(params.months ?? 0);
    const multiplier = calculationType === "illegal_termination_compensation" ? 2 : 1;
    const result = yuan(params.wage * units * multiplier);
    const warning = "未核当地社平工资三倍，年限未按十二年封顶。";
    return done(
      calculationType,
      params.wage,
      result,
      [
        calculationType === "notice_pay"
          ? `代通知金 = 月工资${params.wage}元`
          : `工作${params.months}个月，折合${units}个月工资；${multiplier === 2 ? "2N" : "N"} = ${params.wage}元 × ${units} × ${multiplier} = ${result}元`,
      ],
      calculationType === "notice_pay" ? "" : warning,
    );
  }
  if (calculationType !== "litigation_case_acceptance_fee") {
    return { error: "这个计算类型还没有接入。不要心算。" };
  }
  const amount = params.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { error: "缺少标的额。不要心算。" };
  }
  const fee = banded(amount, BANDS);
  return done(calculationType, amount, fee.result, fee.steps);
}

function asksFigure(text: string) {
  return /多少|怎么算|计算|算一下|算出|只算/.test(text);
}

function wan(text: string) {
  const hit = text.match(/(\d+(?:\.\d+)?)\s*万元/);
  if (!hit) return 0;
  return Math.round(Number(hit[1]) * 10_000);
}

function wageOf(text: string) {
  const hit = text.match(/月(?:工资|薪)\s*(\d+(?:\.\d+)?)\s*元?/);
  return hit ? Number(hit[1]) : 0;
}

function monthsOf(text: string) {
  const months = text.match(/(\d+)\s*个月/);
  if (months) return Number(months[1]);
  const years = text.match(/(\d+)\s*年/);
  return years ? Number(years[1]) * 12 : 0;
}

function daysOf(text: string) {
  const hit = text.match(/(\d+)\s*天/);
  return hit ? Number(hit[1]) : 0;
}

function plainNumber(raw: string) {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const digit: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (raw === "十") return 10;
  if (raw.startsWith("十")) return 10 + (digit[raw[1]] ?? 0);
  const [high, low] = raw.split("十");
  if (raw.includes("十")) return (digit[high] ?? 0) * 10 + (digit[low] ?? 0);
  return digit[raw] ?? Number.NaN;
}

function dailyRateOf(text: string) {
  const per = text.match(/日万分之\s*(\d+(?:\.\d+)?|[一二三四五六七八九十]+)/);
  if (per) return plainNumber(per[1]) / 10_000;
  const percent = text.match(/日利率\s*(\d+(?:\.\d+)?)\s*%/);
  if (percent) return Number(percent[1]) / 100;
  return 0;
}

export function quoteFee(text: string): AmountResult | { error: string } | null {
  if (!asksFigure(text)) return null;
  if (/能否|是否可以|有没有权|什么条件|怎么调整|能否调整/.test(text) && !/受理费|保全费|执行费/.test(text)) return null;
  const amount = wan(text);
  if (/保全/.test(text)) {
    return amount ? calculateLegalAmount("litigation_preservation_fee", { amount }) : { error: "缺少保全金额。不要心算。" };
  }
  if (/执行费|申请执行/.test(text)) {
    return amount ? calculateLegalAmount("litigation_enforcement_fee", { amount }) : { error: "缺少执行金额。不要心算。" };
  }
  if (/受理费/.test(text)) {
    return amount ? calculateLegalAmount("litigation_case_acceptance_fee", { amount }) : { error: "缺少标的额。不要心算。" };
  }
  if (/迟延履行/.test(text)) return calculateLegalAmount("delayed_performance_interest", { amount, days: daysOf(text) });
  if (/逾期利息|利息/.test(text)) {
    return calculateLegalAmount("overdue_interest", { amount, days: daysOf(text), dailyRate: dailyRateOf(text) });
  }
  const wage = wageOf(text);
  const months = monthsOf(text);
  if (/代通知金/.test(text)) return calculateLegalAmount("notice_pay", { wage });
  if (/违法解除|2N|二倍赔偿/.test(text)) return calculateLegalAmount("illegal_termination_compensation", { wage, months });
  if (/经济补偿|N\+1|N＋1/.test(text)) return calculateLegalAmount("economic_compensation", { wage, months });
  return null;
}

export function feeReport(result: AmountResult) {
  const shown = result.result.toLocaleString("en-US");
  const label =
    {
      litigation_case_acceptance_fee: "财产案件受理费",
      litigation_preservation_fee: "保全费",
      litigation_enforcement_fee: "执行申请费",
      delayed_performance_interest: "迟延履行加倍部分债务利息",
      overdue_interest: "逾期利息",
      economic_compensation: "经济补偿",
      illegal_termination_compensation: "违法解除赔偿金",
      notice_pay: "代通知金",
    }[result.calculationType] ?? "计算结果";
  const warning = result.warning ? `\n${result.warning}` : "";
  return [`${label} ${shown} 元。`, ...result.steps, warning, "结果供参考，以受理法院或仲裁机构认定为准。"]
    .filter(Boolean)
    .join("\n");
}
