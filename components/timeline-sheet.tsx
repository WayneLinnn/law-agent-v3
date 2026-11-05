"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SaveCopy } from "@/components/save-copy";

type Row = { happenedOn: string; title: string; detail: string };

function draftOf(rows: Row[]) {
  return rows
    .map((row) => `${row.happenedOn} ${row.title}${row.detail ? `：${row.detail}` : ""}`)
    .join("\n");
}

export function TimelineSheet({
  matterId,
  rows,
  tasks,
  locked = false,
  onClose,
}: {
  matterId: string;
  rows: Row[];
  tasks: Array<{ id: string; name: string; dueOn: string; confirmed?: boolean }>;
  locked?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(draftOf(rows));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/timeline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; rows?: Row[] } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有保存。");
      return;
    }
    setText(draftOf(payload?.rows ?? []));
    router.refresh();
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-line bg-surface px-3 py-3 max-lg:max-h-[45vh] max-lg:border-t lg:border-l">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm">时间线</h2>
        {onClose ? (
          <button type="button" className="text-sm text-muted underline" onClick={onClose}>
            收起
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">一行一条。日期可以用 2024年10月11日 或 2024-10-11。</p>
      <textarea
        value={text}
        disabled={locked}
        onChange={(event) => setText(event.target.value)}
        rows={12}
        className="mt-3 min-h-0 w-full flex-1 border border-line bg-surface px-2 py-2 text-sm leading-6"
        aria-label="时间线"
      />
      <h2 className="mt-3 text-sm">待办</h2>
      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-muted">还没有待办。</p>
      ) : (
        <ul className="mt-2 flex max-h-28 flex-col gap-1 overflow-y-auto">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-baseline justify-between gap-2 text-sm leading-6">
              <span>
                <span className="text-muted">{task.dueOn}</span> {task.name}
                <span className="text-muted"> · {task.confirmed ? "已确认" : "待办"}</span>
              </span>
              {locked ? null : <CancelTask matterId={matterId} taskId={task.id} />}
            </li>
          ))}
        </ul>
      )}
      {locked ? null : (
        <div className="mt-3 flex shrink-0 flex-col gap-2">
          {error ? <p className="text-sm text-seal">{error}</p> : null}
          <button
            type="button"
            className="self-start bg-action px-3 py-1 text-sm text-white disabled:opacity-60"
            disabled={pending}
            onClick={save}
          >
            {pending ? "正在保存" : "保存"}
          </button>
          {text.trim() ? (
            <SaveCopy text={text} matterId={matterId} name="时间线" onSaved={() => router.refresh()} />
          ) : null}
        </div>
      )}
    </aside>
  );
}

function CancelTask({ matterId, taskId }: { matterId: string; taskId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function cancel() {
    setPending(true);
    const response = await fetch(`/api/matters/${matterId}/tasks/${taskId}`, { method: "DELETE" });
    setPending(false);
    if (!response.ok) return;
    router.refresh();
  }

  return (
    <button type="button" className="shrink-0 text-sm underline disabled:opacity-60" disabled={pending} onClick={cancel}>
      {pending ? "正在取消" : "取消"}
    </button>
  );
}
