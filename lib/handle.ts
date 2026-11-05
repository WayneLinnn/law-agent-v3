import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";
import { ask } from "@/lib/threads";

export async function askMatter(
  matterId: string,
  input: { mode?: unknown; text?: unknown; insist?: unknown },
  onDelta?: (text: string) => void,
  onReset?: () => void,
) {
  await connection();
  const matter = database().prepare("SELECT id FROM matters WHERE id = ?").get(matterId) as
    | { id: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 as const };
  const thread = database()
    .prepare("SELECT id FROM threads WHERE matter_id = ? ORDER BY created_at, rowid LIMIT 1")
    .get(matterId) as { id: string } | undefined;
  return ask(
    {
      ...input,
      threadId: thread?.id,
      matterId: thread ? undefined : matterId,
    },
    onDelta,
    onReset,
  );
}
