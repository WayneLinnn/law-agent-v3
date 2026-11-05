import "server-only";

import { database } from "@/lib/db";
import { clipNote, coveredUntil, HISTORY_CHAR_TRIGGER, splitHistory, type HistoryTurn } from "@/lib/history-pack";
import { summarizeHistory } from "@/lib/model";

function dialogue(turns: HistoryTurn[]) {
  return turns.map((turn) => `${turn.role === "lawyer" ? "律师" : "Agent"}：${turn.body}`).join("\n");
}

async function fold(note: string, batch: HistoryTurn[]) {
  const asked = note ? `已有备忘：\n${note}\n\n新落下的对话：\n${dialogue(batch)}` : dialogue(batch);
  const answered = await summarizeHistory(asked);
  if ("error" in answered) return answered;
  const text = clipNote(answered.text);
  if (!text) return { error: "模型没有答上。" };
  return { text };
}

export async function packHistory(threadId: string, turns: HistoryTurn[]) {
  const split = splitHistory(turns);
  if (split.older.length === 0) return { turns, note: "" };
  const until = coveredUntil(split.older);
  const saved = database()
    .prepare("SELECT history_note, history_note_until FROM threads WHERE id = ?")
    .get(threadId) as { history_note: string; history_note_until: string } | undefined;
  if (saved?.history_note && until && saved.history_note_until === until) {
    return { turns: split.recent, note: saved.history_note };
  }
  let start = 0;
  let note = "";
  if (saved?.history_note && saved.history_note_until) {
    const at = split.older.findIndex((turn) => turn.id === saved.history_note_until);
    if (at >= 0) {
      start = at + 1;
      note = saved.history_note;
    }
  }
  const pending = split.older.slice(start);
  let batch: HistoryTurn[] = [];
  let size = 0;
  for (const turn of pending) {
    batch.push(turn);
    size += turn.body.length;
    if (size < HISTORY_CHAR_TRIGGER) continue;
    const folded = await fold(note, batch);
    if ("error" in folded) return { turns, note: "" };
    note = folded.text;
    batch = [];
    size = 0;
  }
  if (batch.length > 0) {
    const folded = await fold(note, batch);
    if ("error" in folded) return { turns, note: "" };
    note = folded.text;
  }
  if (until) {
    database()
      .prepare("UPDATE threads SET history_note = ?, history_note_until = ? WHERE id = ?")
      .run(note, until, threadId);
  }
  return { turns: split.recent, note };
}
