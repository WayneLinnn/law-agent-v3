import "server-only";

type Saved =
  | { threadId: string; prompted: boolean; status: 200 | 201 }
  | { error: string; status: number; threadId?: string };

const noStore = { "Cache-Control": "no-store" };

export function respondAsk(
  request: Request,
  run: (delta: (text: string) => void, reset: () => void) => Promise<Saved>,
) {
  if (!(request.headers.get("accept") ?? "").includes("text/event-stream")) {
      return run(() => {}, () => {}).then((saved) => {
      if ("error" in saved) {
        return Response.json({ error: saved.error, id: saved.threadId }, { status: saved.status, headers: noStore });
      }
      return Response.json({ id: saved.threadId, prompted: saved.prompted }, { status: saved.status, headers: noStore });
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const saved = await run(
          (text) => {
            if (text) send("delta", { text });
          },
          () => send("reset", {}),
        );
        if ("error" in saved) send("error", { error: saved.error, id: saved.threadId ?? "" });
        else send("done", { id: saved.threadId, prompted: saved.prompted });
      } catch {
        send("error", { error: "没有问成。" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
