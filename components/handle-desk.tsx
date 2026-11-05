"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MaterialDrop, type MaterialFile } from "@/components/material-drop";
import { ProposalList } from "@/components/case-from-thread";
import { DraftDesk, type DraftView } from "@/components/draft-desk";
import { MessageBody } from "@/components/message-body";
import { canSaveCopy, SaveCopy } from "@/components/save-copy";
import { SourceDesk, type SavedFocusView, type SourceChoice } from "@/components/source-desk";
import { LiveTurn } from "@/components/live-turn";
import { ThreadComposer, type LiveTalk } from "@/components/thread-composer";
import { TimelineSheet } from "@/components/timeline-sheet";

type TalkMessage = {
  id: string;
  role: "lawyer" | "model";
  mode: string;
  body: string;
  next: string[];
};

function talkRounds<T extends { role: "lawyer" | "model" }>(messages: T[]) {
  const rounds: T[][] = [];
  for (const message of messages) {
    const current = rounds[rounds.length - 1];
    if (!current || message.role === "lawyer") rounds.push([message]);
    else current.push(message);
  }
  return rounds;
}

type Proposal = {
  id: string;
  kind: string;
  body: string;
  acceptedAt: string | null;
};

export function HandleDesk({
  matterId,
  threadId,
  threads = [],
  prompted,
  messages,
  materials,
  notes,
  nodes,
  pending,
  batch,
  saved,
  tasks,
  canConfirm,
  draft,
  draftSeed = "",
  locked = false,
}: {
  matterId: string;
  threadId?: string;
  threads?: Array<{ id: string; title: string }>;
  prompted: boolean;
  messages: TalkMessage[];
  materials: MaterialFile[];
  notes: Array<{ id: string; kind: string; body: string }>;
  nodes: Array<{ id: string; happenedOn: string; title: string; detail: string }>;
  pending: Proposal[];
  batch: { messageId: string; query: string; items: SourceChoice[] } | null;
  saved: SavedFocusView[];
  tasks: Array<{ id: string; name: string; dueOn: string; confirmed: boolean; overdue: boolean }>;
  canConfirm: boolean;
  draft: DraftView | null;
  draftSeed?: string;
  locked?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [opening, setOpening] = useState(false);
  const [live, setLive] = useState<LiveTalk | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const threadEnd = useRef<HTMLDivElement>(null);
  const liveCaught =
    live != null &&
    messages.some(
      (message, index) =>
        message.role === "lawyer" &&
        message.body === live.lawyer &&
        messages.slice(index + 1).some((next) => next.role === "model"),
    );

  useEffect(() => {
    if (liveCaught) setLive(null);
  }, [liveCaught]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live?.answer]);

  async function openThread() {
    if (opening || messages.length === 0) return;
    setOpening(true);
    try {
      const response = await fetch(`/api/matters/${matterId}/threads`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { id?: string } | null;
      if (!response.ok || !payload?.id) return;
      router.push(`/matters/${matterId}?t=${payload.id}`);
      router.refresh();
    } finally {
      setOpening(false);
    }
  }

  function fill(step: string) {
    setText(step);
    document.getElementById("ask-box")?.focus();
  }

  return (
    <div
      className={`grid h-full min-h-0 overflow-hidden rounded-lg border border-line max-lg:grid-rows-[auto_minmax(0,1fr)_auto_auto] ${
        timelineOpen
          ? "lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,16rem)_minmax(0,18rem)]"
          : "lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,18rem)]"
      }`}
    >
      <aside className="min-h-0 min-w-0 overflow-y-auto border-line bg-rail px-4 py-4 max-lg:max-h-36 max-lg:border-b lg:border-r">
        <Link href={`/matters/${matterId}/plead`} className="text-sm underline">
          文书起草
        </Link>
        <Link href={`/matters/${matterId}/contract-review`} className="mt-2 block text-sm underline">
          合同审查
        </Link>
        <h2 className="mt-4 text-sm">材料</h2>
        <div className="mt-3">
          <MaterialDrop matterId={matterId} materials={materials} locked={locked} />
        </div>
        <h2 className="mt-4 text-sm">已记下</h2>
        {notes.filter((note) => note.kind !== "时间线").length === 0 ? (
          <p className="mt-2 text-sm text-muted">还没有。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {notes
              .filter((note) => note.kind !== "时间线")
              .map((note) => (
                <li key={note.id} className="min-w-0 text-sm">
                  <p className="text-muted">{note.kind}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words leading-6">{note.body}</p>
                </li>
              ))}
          </ul>
        )}
        <CaseAxis matterId={matterId} nodes={nodes} locked={locked} />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col bg-surface px-3 py-3">
        <div className="mb-2 flex shrink-0 items-center gap-2">
          {threads.length > 1 ? (
            <select
              aria-label="对话"
              value={threadId ?? threads[0]?.id ?? ""}
              onChange={(event) => {
                router.push(`/matters/${matterId}?t=${event.target.value}`);
                router.refresh();
              }}
              className="min-w-0 flex-1 truncate border border-line bg-background px-2 py-1 text-sm"
            >
              {threads.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          ) : (
            <p className="min-w-0 flex-1 truncate text-sm">{threads[0]?.title || "办理"}</p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={opening || messages.length === 0}
            onClick={() => void openThread()}
          >
            新对话
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {messages.length === 0 && !(live && !liveCaught) ? (
            <p className="text-sm text-muted">还没有办过。直接说要办的事。</p>
          ) : null}
          {messages.length > 0 || (live && !liveCaught) ? (
            <ol className="flex flex-col gap-8 pr-1">
              {talkRounds(messages).map((round, index, all) => (
                <li key={round[0].id} className={`flex flex-col gap-2 ${index === all.length - 1 ? "msg-in" : ""}`}>
                  {round.map((message) =>
                    message.role === "lawyer" ? (
                      <div key={message.id} className="ml-auto max-w-[85%] rounded-lg bg-[#F3F5F6] px-3 py-2">
                        <p className="text-right text-xs text-muted">你</p>
                        <MessageBody
                          text={message.body}
                          className="mt-1 whitespace-pre-wrap break-words text-sm leading-6"
                        />
                      </div>
                    ) : (
                      <div key={message.id} className="mr-auto max-w-[92%] border-l-2 border-agent px-3 py-2">
                        <p className="text-xs text-agent">Agent</p>
                        <MessageBody
                          text={message.body}
                          className="mt-1 whitespace-pre-wrap break-words text-sm leading-6"
                        />
                        {canSaveCopy(message.body, round.find((item) => item.role === "lawyer")?.body ?? "") ? (
                          <SaveCopy text={message.body} matterId={matterId} onSaved={() => router.refresh()} />
                        ) : null}
                        {message.next.length > 0 ? (
                          <div className="mt-2 flex flex-col gap-2">
                            {message.next.map((step, stepIndex) => (
                              <button
                                key={`${message.id}-${stepIndex}`}
                                type="button"
                                className="w-full break-words border border-line bg-surface px-3 py-2 text-left text-sm"
                                onClick={() => fill(step)}
                              >
                                {step}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ),
                  )}
                </li>
              ))}
              {live && !liveCaught ? <LiveTurn lawyer={live.lawyer} answer={live.answer} compact /> : null}
            </ol>
          ) : null}
          <div ref={threadEnd} />
        </div>
        <div className="shrink-0 pt-3">
          <ThreadComposer
            threadId={threadId}
            matterId={matterId}
            prompted={prompted}
            text={text}
            onTextChange={setText}
            onLive={setLive}
          />
        </div>
      </section>
      <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto border-line bg-aside px-3 py-3 max-lg:max-h-[45vh] max-lg:border-t lg:border-l">
        {timelineOpen ? null : (
          <button type="button" className="self-start text-sm underline" onClick={() => setTimelineOpen(true)}>
            时间线
          </button>
        )}
        <section
          aria-label="待办"
          key={tasks.map((task) => `${task.id}:${task.name}:${task.dueOn}:${task.confirmed}`).join("|")}
        >
          <h2 className="text-sm">待办</h2>
          {tasks.length === 0 ? (
            <p className="mt-2 text-sm text-muted">还没有待办。</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {tasks.map((task) => (
                <li key={task.id} className="flex flex-col items-start break-words text-sm leading-6">
                  {task.name}
                  <span className="text-muted"> · {task.dueOn}</span>
                  <span className="text-muted"> · {task.confirmed ? "已确认" : "未确认"}</span>
                  {task.overdue ? <span className="text-seal"> · 已过期</span> : null}
                  {canConfirm ? <ConfirmTask matterId={matterId} taskId={task.id} confirmed={task.confirmed} /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="text-sm">待确认</h2>
          <div className="mt-2">
            {threadId ? (
              <ProposalList threadId={threadId} proposals={pending} empty="没有待确认的。" />
            ) : (
              <p className="text-sm text-muted">没有待确认的。</p>
            )}
          </div>
        </section>
        {threadId && (batch || saved.length > 0) ? (
          <SourceDesk threadId={threadId} batch={batch} saved={saved} />
        ) : null}
        <DraftDesk
          key={`${draft?.id ?? "none"}:${draft?.body.length ?? 0}:${draftSeed.length}`}
          matterId={matterId}
          current={draft}
          seedBody={draftSeed}
          locked={locked}
        />
      </aside>
      {timelineOpen ? (
        <TimelineSheet
          key={nodes.map((node) => node.id).join("|")}
          matterId={matterId}
          rows={nodes}
          tasks={tasks}
          locked={locked}
          onClose={() => setTimelineOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ConfirmTask({
  matterId,
  taskId,
  confirmed,
}: {
  matterId: string;
  taskId: string;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"" | "confirm" | "cancel">("");

  async function confirm() {
    setPending("confirm");
    setError("");
    const response = await fetch(`/api/matters/${matterId}/tasks/${taskId}/confirm`, { method: "POST" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending("");
    if (!response.ok) {
      setError(payload?.error ?? "没有确认这条待办。");
      return;
    }
    router.refresh();
  }

  async function cancel() {
    setPending("cancel");
    setError("");
    const response = await fetch(`/api/matters/${matterId}/tasks/${taskId}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending("");
    if (!response.ok) {
      setError(payload?.error ?? "没有取消这条待办。");
      return;
    }
    router.refresh();
  }

  return (
    <span className="mt-1 flex flex-col items-start gap-1">
      {error ? <span className="text-sm text-seal">{error}</span> : null}
      <span className="flex items-center gap-3">
        {confirmed ? null : (
          <button
            type="button"
            className="bg-action px-3 py-1 text-sm text-white disabled:opacity-60"
            disabled={pending !== ""}
            onClick={confirm}
          >
            {pending === "confirm" ? "正在确认" : "确认"}
          </button>
        )}
        <button type="button" className="text-sm underline disabled:opacity-60" disabled={pending !== ""} onClick={cancel}>
          {pending === "cancel" ? "正在取消" : "取消"}
        </button>
      </span>
    </span>
  );
}

function localDay() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function CaseAxis({
  matterId,
  nodes,
  locked,
}: {
  matterId: string;
  nodes: Array<{ id: string; happenedOn: string; title: string; detail: string }>;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const today = localDay();
  const items = [
    ...nodes.map((node) => ({
      kind: "node" as const,
      id: node.id,
      date: node.happenedOn,
      title: node.title,
      detail: node.detail,
    })),
    { kind: "today" as const, id: "today", date: today, title: `今天 · ${today}`, detail: "" },
  ].sort((left, right) => left.date.localeCompare(right.date));
  const todayIndex = items.findIndex((item) => item.kind === "today");
  const from = Math.max(0, todayIndex - 2);
  const to = Math.min(items.length, todayIndex + 4);
  const shown = open || items.length <= 7 ? items : items.slice(from, to);
  const hidden = items.length - shown.length;

  return (
    <div className="mt-4">
      <h2 className="text-sm">时间线</h2>
      {nodes.length === 0 ? (
        <p className="mt-2 text-sm text-muted">还没有。</p>
      ) : (
        <>
          {hidden > 0 ? (
            <button type="button" className="mt-2 text-sm underline" onClick={() => setOpen((value) => !value)}>
              {open ? "收起" : `展开其余 ${hidden} 条`}
            </button>
          ) : null}
          <ol className="mt-3 ml-1 border-l-2 border-line">
            {shown.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="relative pb-3 pl-3 last:pb-0">
                <span
                  className={`absolute -left-[6px] top-1 size-2.5 rounded-full ${
                    item.kind === "today" ? "border-2 border-action bg-rail" : "bg-action"
                  }`}
                  aria-hidden="true"
                />
                {item.kind === "today" ? (
                  <p className="text-sm leading-6">{item.title}</p>
                ) : (
                  <>
                    <p className="text-xs text-muted">{item.date}</p>
                    <p className="break-words text-sm leading-6">{item.title}</p>
                    {item.detail ? <p className="break-words text-sm leading-6 text-muted">{item.detail}</p> : null}
                    {locked || item.kind !== "node" ? null : <RemoveNode matterId={matterId} nodeId={item.id} />}
                  </>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function RemoveNode({ matterId, nodeId }: { matterId: string; nodeId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/nodes/${nodeId}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有去掉这条节点。");
      return;
    }
    router.refresh();
  }

  return (
    <span className="mt-1 flex flex-col items-start">
      {error ? <span className="text-sm text-seal">{error}</span> : null}
      <button type="button" className="text-sm underline disabled:opacity-60" disabled={pending} onClick={remove}>
        {pending ? "正在去掉" : "去掉"}
      </button>
    </span>
  );
}
