"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CaseDetail } from "@/components/case-card";
import { DeskHeader } from "@/components/desk-header";
import { FileTake } from "@/components/file-take";
import { hasTakeableTalk } from "@/lib/new-case";
import { LiveTurn } from "@/components/live-turn";
import { MessageBody } from "@/components/message-body";
import { ThreadComposer, type LiveTalk } from "@/components/thread-composer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CaseCard } from "@/lib/case-board";

type TalkMessage = {
  id: string;
  role: "lawyer" | "model";
  mode: string;
  body: string;
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

type ThreadItem = { id: string; title: string };

type DeskTask = {
  id: string;
  matterId: string;
  matterName: string;
  name: string;
  dueOn: string;
  overdue: boolean;
};

export function WorkbenchDesk({
  threadId,
  prompted,
  messages,
  threads,
  cases,
  tasks,
  uploads = [],
}: {
  threadId?: string;
  prompted: boolean;
  uploads?: Array<{ id: string; filename: string; kind: string; note: string }>;
  messages: TalkMessage[];
  threads: ThreadItem[];
  cases: CaseCard[];
  tasks: DeskTask[];
}) {
  const router = useRouter();
  const bottom = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveTalk | null>(null);
  const recent = threads.slice(0, 4);
  let fileOfferId = "";
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "model" && message.body.includes("可以立案并带走") && hasTakeableTalk(messages.slice(0, index))) {
      fileOfferId = message.id;
    }
  }
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
    if (messages.length > 0 || live) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, threadId, live?.answer]);

  return (
    <div className="min-h-dvh bg-background">
      <DeskHeader current="home" />
      <div className="mx-auto grid w-full max-w-7xl items-start gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.7fr)_18rem] sm:px-6">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-lg border border-line bg-surface px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm">提问</h2>
              <Badge className="border-transparent bg-agent text-white">Agent</Badge>
              {messages.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => {
                    router.push("/");
                    router.refresh();
                  }}
                >
                  新对话
                </Button>
              ) : null}
            </div>
            {messages.length > 0 || (live && !liveCaught) ? (
              <ScrollArea className="mb-3 h-[min(42vh,22rem)]">
                <ol className="flex flex-col gap-8 pr-3 pb-2">
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
                          <div key={message.id} className="mr-auto max-w-[92%] border-l-2 border-agent pl-3">
                            <p className="text-xs text-agent">Agent</p>
                            <MessageBody
                              text={message.body}
                              className="mt-1 whitespace-pre-wrap break-words text-sm leading-6"
                            />
                            {message.id === fileOfferId && threadId ? (
                              <FileTake key={message.id} threadId={threadId} messages={messages} />
                            ) : null}
                          </div>
                        ),
                      )}
                    </li>
                  ))}
                  {live && !liveCaught ? <LiveTurn lawyer={live.lawyer} answer={live.answer} /> : null}
                </ol>
                <div ref={bottom} />
              </ScrollArea>
            ) : null}
            <ThreadComposer threadId={threadId} prompted={prompted} stayHome files={uploads} onLive={setLive} />
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-sm">继续办案</h2>
              <p className="mt-1 text-xs text-muted">点一行展开。已结案的不排在这里。</p>
            </div>
            {cases.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">
                没有在办的案子。
                <Link href="/matters/new" className="ml-2 underline">
                  新建案件
                </Link>
              </p>
            ) : (
              <ul>
                {cases.map((matter) => {
                  const open = openId === matter.id;
                  const client = matter.clients[0] || "还没写";
                  const recentAction = matter.node?.title || "立卡";
                  const due = matter.tasks[0];
                  return (
                    <li key={matter.id} className="border-t border-line">
                      <button
                        type="button"
                        className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3 text-left text-sm hover:bg-aside"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : matter.id)}
                      >
                        <span className="min-w-0 font-medium break-words">
                          {matter.name}
                          {matter.cause ? ` · ${matter.cause}` : ""}
                        </span>
                        <span className="text-muted">客户 {client}</span>
                        <Badge variant={matter.status === "办理中" ? "default" : "secondary"}>{matter.status}</Badge>
                        <span className="text-muted">最近 {recentAction}</span>
                        {due ? (
                          <span className={due.overdue ? "text-seal" : "text-muted"}>
                            期限 {due.dueOn.slice(5)} {due.name}
                            {due.overdue ? " 已过期" : ""}
                          </span>
                        ) : null}
                      </button>
                      {open ? <CaseDetail matter={matter} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className="rounded-lg border border-line bg-surface px-4 py-4">
            <h2 className="text-sm">待处理</h2>
            {tasks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">没有待处理事项。</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <Link href={`/matters/${task.matterId}`} className="underline">
                      {task.dueOn.slice(5)} {task.name}
                    </Link>
                    <span className="text-muted"> · {task.matterName}</span>
                    {task.overdue ? <span className="text-seal"> 已过期</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-lg border border-line bg-surface px-4 py-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm">最近对话</h2>
              {threads.length > 0 ? (
                <Link href="/history" className="text-xs underline">
                  查看全部
                </Link>
              ) : null}
            </div>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-muted">还没有。</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {recent.map((thread) => (
                  <li key={thread.id}>
                    <Link
                      href={`/?t=${thread.id}`}
                      className={`block break-words text-sm leading-5 ${
                        thread.id === threadId ? "font-medium underline" : "underline"
                      }`}
                    >
                      {thread.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
