import "server-only";

import { intakeFromModelText, intakeNeedsModel, mergeIntake, type IntakeRead } from "@/lib/intake";
import { extractIntake } from "@/lib/model";

export async function fillIntake(
  text: string,
  rules: IntakeRead,
): Promise<IntakeRead | { error: string; status: number }> {
  if (!intakeNeedsModel(rules, text)) return rules;
  const answered = await extractIntake(text);
  if ("error" in answered) return { error: answered.error, status: 502 };
  const seen = intakeFromModelText(answered.text, text);
  if (!seen) return { error: "没有读出这份文本。", status: 502 };
  return mergeIntake(rules, seen);
}
