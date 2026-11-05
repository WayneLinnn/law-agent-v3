"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { LiveTurn } from "@/components/live-turn";
import { readTalkStream } from "@/components/read-talk-stream";

export type LiveTalk = { lawyer: string; answer: string };

export function ThreadComposer({
  threadId,
  matterId,
  prompted,
  text,
  onTextChange,
  stayHome = false,
  files = [],
  onLive,
}: {
  threadId?: string;
  matterId?: string;
  prompted?: boolean;
  text?: string;
  onTextChange?: (value: string) => void;
  stayHome?: boolean;
  files?: Array<{ id: string; filename: string; kind: string; note: string; stored?: boolean }>;
  onLive?: (live: LiveTalk | null) => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [localText, setLocalText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"send" | "insist" | "file" | null>(null);
  const [over, setOver] = useState(false);
  const [openFile, setOpenFile] = useState("");
  const sending = useRef(false);
  const value = text ?? localText;

  function showLive(live: LiveTalk | null) {
    if (onLive) onLive(live);
    else setLocalLive(live);
  }

  function setValue(next: string) {
    if (onTextChange) onTextChange(next);
    else setLocalText(next);
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || pending !== null) return;
    if (!value.trim()) {
      setError("请写下要问的话。");
      return;
    }
    sending.current = true;
    setPending("send");
    setError("");
    const sent = value;
    let answer = "";
    showLive({ lawyer: sent, answer: "" });
    try {
      const response = await fetch(
        threadId ? `/api/threads/${threadId}/messages` : matterId ? `/api/matters/${matterId}/ask` : "/api/threads",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ text: sent }),
        },
      );
      const payload = await readTalkStream(
        response,
        (piece) => {
          answer += piece;
          showLive({ lawyer: sent, answer });
        },
        () => {
          answer = "";
          showLive({ lawyer: sent, answer: "" });
        },
      );
      if (payload.error || !payload.id) {
        showLive(null);
        setError(payload.error ?? "没有问成。");
        if (!threadId && !matterId && payload.id) {
          if (stayHome) {
            router.replace(`/?t=${payload.id}`);
            router.refresh();
          } else router.push(`/threads/${payload.id}`);
        }
        if (matterId) router.refresh();
        return;
      }
      setValue("");
      if (threadId || matterId) router.refresh();
      else if (stayHome) {
        router.replace(`/?t=${payload.id}`);
        router.refresh();
      } else router.push(`/threads/${payload.id}`);
    } catch {
      showLive(null);
      setError("没有问成。");
    } finally {
      sending.current = false;
      setPending(null);
    }
  }

  async function insist() {
    if (!threadId) return;
    setPending("insist");
    setError("");
    const response = await fetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insist: true }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(null);
    if (!response.ok) {
      setError(payload?.error ?? "没有问成。");
      return;
    }
    router.refresh();
  }

  async function takeFiles(list: FileList | File[]) {
    const picked = [...list];
    if (picked.length === 0 || pending !== null) return;
    setPending("file");
    setError("");
    const body = new FormData();
    if (threadId) body.append("threadId", threadId);
    for (const file of picked) body.append("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body });
    const payload = (await response.json().catch(() => null)) as { error?: string; threadId?: string } | null;
    setPending(null);
    if (!response.ok) {
      setError(payload?.error ?? "没有放进去。");
      return;
    }
    if (stayHome && payload?.threadId) router.replace(`/?t=${payload.threadId}`);
    router.refresh();
  }

  const onCase = Boolean(matterId);

  return (
    <form
      onSubmit={send}
      className={stayHome ? "flex min-w-0 flex-col gap-3" : "panel flex min-w-0 flex-col gap-3 px-4 py-4"}
      onDragOver={(event) => {
        if (!stayHome) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!stayHome) return;
        event.preventDefault();
        setOver(false);
        void takeFiles(event.dataTransfer.files);
      }}
    >
      {!onLive && localLive ? (
        <ol className="flex flex-col gap-3">
          <LiveTurn lawyer={localLive.lawyer} answer={localLive.answer} />
        </ol>
      ) : null}
      {stayHome ? (
        <div>
          <button
            type="button"
            className={`w-full border border-dashed px-3 py-4 text-left text-sm leading-6 ${over ? "border-action bg-aside" : "border-line bg-surface"}`}
            onClick={() => fileRef.current?.click()}
            disabled={pending !== null}
          >
            {pending === "file" ? "正在放入" : "把文件拖到这里，或点此选择。txt、md、Word、PDF、Excel、照片。原件留在这段对话里，点开可预览。"}
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            multiple
            accept=".txt,.md,.csv,.doc,.docx,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.bmp"
            onChange={(event) => {
              const list = event.target.files;
              if (list) void takeFiles(list);
              event.target.value = "";
            }}
          />
          {files.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2 text-sm leading-6">
              {files.map((file) => {
                const open = openFile === file.id;
                const preview = file.stored && (file.kind === "照片" || file.kind === "PDF");
                return (
                  <li key={file.id} className="min-w-0 text-muted">
                    {preview ? (
                      <button
                        type="button"
                        className="underline"
                        aria-expanded={open}
                        onClick={() => setOpenFile(open ? "" : file.id)}
                      >
                        {file.filename}
                      </button>
                    ) : file.stored ? (
                      <a className="underline" href={`/api/uploads/${file.id}/file`} download={file.filename}>
                        {file.filename}
                      </a>
                    ) : (
                      <span>{file.filename}</span>
                    )}
                    {` · ${file.stored ? file.note || file.kind : "原件没有留下"}`}
                    {open && file.kind === "照片" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/uploads/${file.id}/file`}
                        alt={file.filename}
                        className="mt-1 max-h-80 max-w-full border border-line bg-surface"
                      />
                    ) : null}
                    {open && file.kind === "PDF" ? (
                      <iframe
                        title={file.filename}
                        src={`/api/uploads/${file.id}/file`}
                        className="mt-1 h-96 w-full border border-line bg-surface"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      <textarea
        rows={onCase ? 3 : 4}
        id="ask-box"
        value={value}
        aria-label="要问的话"
        placeholder={onCase ? "说要办的事" : "写下要问的话，回车发送"}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
      {prompted && !onCase ? (
        <p className="text-sm leading-6 text-seal">
          这是在问法条或案例。仍要只作问答，点「仍要问答」。
        </p>
      ) : null}
      {prompted && onCase ? (
        <p className="text-sm leading-6 text-seal">再发一次会去查 Alpha。仍要只问答，点「仍要问答」。</p>
      ) : null}
      {error ? <p className="text-sm text-seal">{error}</p> : null}
      {!stayHome || prompted ? (
      <div className="flex flex-wrap items-center gap-2">
        {stayHome ? null : (
          <button
            type="submit"
            className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending !== null}
          >
            {pending === "send" ? "正在办" : "交给它"}
          </button>
        )}
        {prompted ? (
          <button
            type="button"
            className="w-fit border border-line bg-surface px-4 py-2 text-sm disabled:opacity-60"
            disabled={pending !== null}
            onClick={insist}
          >
            {pending === "insist" ? "正在问" : "仍要问答"}
          </button>
        ) : null}
      </div>
      ) : null}
    </form>
  );
}
