export type TalkDone = { id?: string; prompted?: boolean; error?: string };

export async function readTalkStream(
  response: Response,
  onDelta: (text: string) => void,
  onReset?: () => void,
): Promise<TalkDone> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !response.body) {
    const payload = (await response.json().catch(() => null)) as { id?: string; prompted?: boolean; error?: string } | null;
    if (!response.ok || payload?.error) return { error: payload?.error ?? "没有问成。", id: payload?.id };
    return { id: payload?.id, prompted: payload?.prompted };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const done: TalkDone = {};
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = part.match(/^event: (.+)$/m)?.[1]?.trim() ?? "message";
      const dataLine = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!dataLine) continue;
      let data: { text?: string; id?: string; prompted?: boolean; error?: string };
      try {
        data = JSON.parse(dataLine) as { text?: string; id?: string; prompted?: boolean; error?: string };
      } catch {
        continue;
      }
      if (event === "delta" && data.text) onDelta(data.text);
      if (event === "reset") onReset?.();
      if (event === "done") {
        done.id = data.id;
        done.prompted = data.prompted;
      }
      if (event === "error") {
        done.error = data.error ?? "没有问成。";
        done.id = data.id;
      }
    }
  }
  return done;
}
