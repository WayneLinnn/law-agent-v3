"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type SourceChoice = {
  sourceId: string;
  kind: "law" | "case";
  title: string;
  text: string;
  detail: string;
  status: string;
  url: string;
};

export type SavedFocusView = {
  id: string;
  body: string;
  sources: Array<{ sourceId: string; kind: string; title: string; url: string }>;
};

export function SourceDesk({
  threadId,
  batch,
  saved,
}: {
  threadId: string;
  batch: { messageId: string; query: string; items: SourceChoice[] } | null;
  saved: SavedFocusView[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [openId, setOpenId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const kept = new Set(saved.flatMap((focus) => focus.sources.map((source) => source.sourceId)));
  const open = batch?.items.filter((item) => !kept.has(item.sourceId)) ?? [];

  function toggle(sourceId: string) {
    setPicked((current) =>
      current.includes(sourceId) ? current.filter((item) => item !== sourceId) : [...current, sourceId],
    );
  }

  async function accept() {
    if (!batch) return;
    if (picked.length === 0) {
      setError("请先勾上要写进文书的。");
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch(`/api/threads/${threadId}/candidates/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: batch.messageId, sourceIds: picked }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有收下。");
      return;
    }
    setPicked([]);
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {batch ? (
        <section className="panel min-w-0 px-4 py-4">
          <h2 className="text-sm">
            法条 {open.filter((item) => item.kind === "law").length} · 案例 {open.filter((item) => item.kind === "case").length}
          </h2>
          <p className="mt-2 truncate text-sm text-muted" title={batch.query}>
            {batch.query}
          </p>
          {open.length === 0 ? (
            <p className="mt-3 text-sm text-muted">没有还没勾的候选。</p>
          ) : (
            <ul className="mt-3 flex flex-col">
              {open.map((item) => {
                const shown = openId === item.sourceId;
                return (
                  <li key={item.sourceId} className="border-t border-line py-2">
                    <div className="flex min-w-0 items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        aria-label={`收下 ${item.title}`}
                        checked={picked.includes(item.sourceId)}
                        onChange={() => toggle(item.sourceId)}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 bg-transparent px-0 py-0 text-left"
                        aria-expanded={shown}
                        onClick={() => setOpenId(shown ? "" : item.sourceId)}
                      >
                        <span className="text-muted">{item.kind === "law" ? "法条" : "案例"}</span>
                        {item.status ? <span className="text-muted"> · {item.status}</span> : null}
                        <span className="mt-1 block break-words">{item.title}</span>
                      </button>
                    </div>
                    <div className="reveal" data-open={shown ? "true" : "false"}>
                      <div className="reveal-inner">
                        <div className="pt-2 pl-6 text-sm leading-6">
                          {item.detail ? <p className="break-words text-muted">{item.detail}</p> : null}
                          <p className="mt-1 whitespace-pre-wrap break-words">
                            {item.text.length > 360 ? `${item.text.slice(0, 360)}…` : item.text}
                          </p>
                          {item.url ? (
                            <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline">
                              打开原文
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {error ? <p className="mt-3 text-sm text-seal">{error}</p> : null}
          {open.length > 0 ? (
            <button
              type="button"
              className="mt-3 w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
              disabled={pending}
              onClick={accept}
            >
              {pending ? "正在收下" : "收下勾选的"}
            </button>
          ) : null}
        </section>
      ) : null}
      {saved.length > 0 ? (
        <section>
          <h2 className="text-sm">已勾上的</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {saved.map((focus) => (
              <li key={focus.id} className="panel min-w-0 px-4 py-4">
                {focus.body.trim() ? (
                  <details>
                    <summary className="text-xs text-muted">焦点</summary>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{focus.body}</p>
                  </details>
                ) : null}
                <ul className="mt-2 flex flex-col gap-2">
                  {focus.sources.map((source) => (
                    <li key={source.sourceId} className="break-words text-sm">
                      {source.kind === "law" ? "法条" : "案例"} ·{" "}
                      {source.url ? (
                        <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">
                          {source.title}
                        </a>
                      ) : (
                        source.title
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
