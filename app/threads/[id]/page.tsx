import Link from "next/link";

import { OpenCase, ProposalList } from "@/components/case-from-thread";
import { DraftDesk } from "@/components/draft-desk";
import { MessageBody } from "@/components/message-body";
import { SourceDesk } from "@/components/source-desk";
import { ThreadComposer } from "@/components/thread-composer";
import { currentDraft } from "@/lib/drafts";
import { listCandidates, listFocuses } from "@/lib/retrieval";
import { getThread } from "@/lib/threads";

function talkRounds<T extends { role: "lawyer" | "model" }>(messages: T[]) {
  const rounds: T[][] = [];
  for (const message of messages) {
    const current = rounds[rounds.length - 1];
    if (!current || message.role === "lawyer") rounds.push([message]);
    else current.push(message);
  }
  return rounds;
}

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const thread = await getThread(id);
  if (!thread) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-6 sm:px-8">
        <Link href="/" className="text-sm underline">
          工作台
        </Link>
        <p className="mt-8 text-sm text-muted">没有这段对话。</p>
      </main>
    );
  }

  const batch = await listCandidates(thread.id);
  const saved = thread.matterId ? await listFocuses(thread.matterId) : [];
  const current = thread.matterId ? await currentDraft(thread.matterId) : null;
  const draftSeed = [...thread.messages].reverse().find((message) => message.proposalKind === "文书底稿");

  const width = batch ? "max-w-6xl" : "max-w-3xl";

  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-nav text-white">
        <div className={`mx-auto w-full px-4 py-4 sm:px-8 ${width}`}>
          <Link href="/" className="text-sm text-white underline">
            工作台
          </Link>
          <h1 className="mt-3 break-words font-serif text-3xl text-white">{thread.title}</h1>
        </div>
      </header>
    <main className={`mx-auto w-full px-4 py-6 sm:px-8 ${width}`}>
      {thread.matterId ? (
        <p className="mt-2 text-sm text-muted">
          已挂到这件草稿。
          <Link href={`/matters/${thread.matterId}`} className="ml-2 underline">
            打开这件草稿
          </Link>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">这段对话还没有挂到案子上。</p>
      )}
      <div className={`mt-6 grid min-w-0 gap-4 ${batch ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-4">
          <ol className="flex flex-col gap-8">
            {talkRounds(thread.messages.filter((message) => !message.proposalKind)).map((round) => (
              <li key={round[0].id} className="flex flex-col gap-2">
                {round.map((message) =>
                  message.role === "lawyer" ? (
                    <div key={message.id} className="panel ml-auto max-w-[85%] px-4 py-4">
                      <p className="text-right text-xs text-muted">你 · {message.mode}</p>
                      <MessageBody text={message.body} />
                    </div>
                  ) : (
                    <div key={message.id} className="panel mr-auto max-w-[92%] border-l-2 border-agent px-4 py-4">
                      <p className="text-xs text-agent">Agent · {message.mode}</p>
                      <MessageBody text={message.body} />
                    </div>
                  ),
                )}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-4">
            {thread.matterId ? (
              <ProposalList
                threadId={thread.id}
                proposals={thread.messages
                  .filter((message) => message.proposalKind && message.proposalKind !== "文书底稿")
                  .map((message) => ({
                    id: message.id,
                    kind: message.proposalKind,
                    body: message.body,
                    acceptedAt: message.acceptedAt,
                  }))}
              />
            ) : (
              <OpenCase threadId={thread.id} />
            )}
            <ThreadComposer threadId={thread.id} prompted={thread.prompted} />
            {thread.matterId ? (
              <DraftDesk
                key={`${current?.id ?? "none"}:${current?.body.length ?? 0}:${draftSeed?.id ?? ""}`}
                matterId={thread.matterId}
                current={
                  current
                    ? {
                        id: current.id,
                        kind: current.kind,
                        body: current.body,
                        warnings: current.warnings,
                        final: current.final,
                      }
                    : null
                }
                seedBody={draftSeed?.body ?? ""}
              />
            ) : null}
          </div>
        </div>
        {batch || saved.length > 0 ? (
          <SourceDesk
            threadId={thread.id}
            batch={
              batch
                ? {
                    messageId: batch.messageId,
                    query: batch.query,
                    items: batch.items.map((item) => ({
                      sourceId: item.sourceId,
                      kind: item.kind,
                      title: item.title,
                      text: item.text,
                      detail: item.detail,
                      status: item.status,
                      url: item.url,
                    })),
                  }
                : null
            }
            saved={saved.map((focus) => ({
              id: focus.id,
              body: focus.body,
              sources: focus.sources.map((source) => ({
                sourceId: source.sourceId,
                kind: source.kind,
                title: source.title,
                url: source.url,
              })),
            }))}
          />
        ) : null}
      </div>
    </main>
    </div>
  );
}
