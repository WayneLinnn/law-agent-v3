export const KEEP_ROUNDS = 12;
export const HISTORY_CHAR_TRIGGER = 12_000;
export const HISTORY_NOTE_MAX = 1_200;

export type HistoryTurn = {
  id?: string;
  role: "lawyer" | "model";
  body: string;
};

export function conversationRounds(turns: HistoryTurn[]) {
  const rounds: HistoryTurn[][] = [];
  let index = 0;
  while (index < turns.length) {
    const current = turns[index];
    const next = turns[index + 1];
    if (current?.role === "lawyer" && next?.role === "model") {
      rounds.push([current, next]);
      index += 2;
      continue;
    }
    if (current) rounds.push([current]);
    index += 1;
  }
  return rounds;
}

export function splitHistory(turns: HistoryTurn[]) {
  const rounds = conversationRounds(turns);
  const chars = turns.reduce((sum, turn) => sum + turn.body.length, 0);
  const over = rounds.length > KEEP_ROUNDS || chars > HISTORY_CHAR_TRIGGER;
  if (!over || rounds.length <= KEEP_ROUNDS) {
    return { older: [] as HistoryTurn[], recent: turns };
  }
  return {
    older: rounds.slice(0, -KEEP_ROUNDS).flat(),
    recent: rounds.slice(-KEEP_ROUNDS).flat(),
  };
}

export function clipNote(text: string) {
  const flat = text.replace(/^```[\w]*\n?|```$/g, "").trim();
  if (flat.length <= HISTORY_NOTE_MAX) return flat;
  return flat.slice(0, HISTORY_NOTE_MAX);
}

export function coveredUntil(turns: HistoryTurn[]) {
  return turns.at(-1)?.id ?? "";
}
