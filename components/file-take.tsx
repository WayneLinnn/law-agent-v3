"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { fileTakeFields, isFileTakeReply, wantsFileTake } from "@/lib/new-case";

type TalkMessage = {
  id: string;
  role: "lawyer" | "model";
  body: string;
};

type Turn = {
  lawyerId: string;
  question: string;
  answer: string;
  legal: boolean;
};

function turnsOf(messages: TalkMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const lawyer = messages[index];
    if (lawyer.role !== "lawyer") continue;
    const model = messages[index + 1];
    if (!model || model.role !== "model") continue;
    turns.push({
      lawyerId: lawyer.id,
      question: lawyer.body,
      answer: model.body,
      legal: /依据候选|主依据|查到这些|法条|案例/.test(model.body),
    });
    index += 1;
  }
  return turns.filter((turn) => !wantsFileTake(turn.question) && !isFileTakeReply(turn.answer));
}

function defaultIds(turns: Turn[]) {
  const legal = [...turns].reverse().find((turn) => turn.legal);
  if (legal) return [legal.lawyerId];
  const last = turns.at(-1);
  return last ? [last.lawyerId] : [];
}

function clip(text: string, max = 48) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}……` : flat;
}

export function FileTake({ threadId, messages }: { threadId: string; messages: TalkMessage[] }) {
  const router = useRouter();
  const turns = useMemo(() => turnsOf(messages), [messages]);
  const seeded = useMemo(
    () => fileTakeFields(messages.filter((message) => message.role === "lawyer").map((message) => message.body)),
    [messages],
  );
  const [clientName, setClientName] = useState(seeded.clientName);
  const [caseName, setCaseName] = useState(seeded.caseName);
  const [picked, setPicked] = useState<string[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ matterId: string; brought: number; sources: number } | null>(null);

  useEffect(() => {
    setPicked(defaultIds(turns));
  }, [turns]);

  if (turns.length === 0) return null;

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!clientName.trim()) {
      setError("请点明谁是客户。");
      return;
    }
    if (!caseName.trim()) {
      setError("请写下案件名称。");
      return;
    }
    if (picked.length === 0) {
      setError("请勾选要带走的问答。");
      return;
    }
    setPending(true);
    setError("");
    setDone(null);
    try {
      const response = await fetch(`/api/threads/${threadId}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          caseName: caseName.trim(),
          lawyerIds: picked,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; matterId?: string; brought?: number; sources?: number }
        | null;
      if (!response.ok || !payload?.matterId) {
        setError(payload?.error ?? "没有立案成。");
        return;
      }
      setDone({
        matterId: payload.matterId,
        brought: payload.brought ?? picked.length,
        sources: payload.sources ?? 0,
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 border border-[#b7c6d0] bg-[#f7fafb] px-3 py-3">
      <p className="text-xs leading-5 text-muted">勾选要进案的问答。工作台这段对话仍留在这里。</p>
      <label className="text-sm">
        <span className="text-xs text-muted">客户名称</span>
        <input
          className="mt-1"
          value={clientName}
          onChange={(event) => setClientName(event.target.value)}
          placeholder="客户名称"
          aria-label="客户名称"
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-muted">案件名称</span>
        <input
          className="mt-1"
          value={caseName}
          onChange={(event) => setCaseName(event.target.value)}
          placeholder="案件名称"
          aria-label="案件名称"
        />
      </label>
        {turns.length > 2 ? (
          <button
            type="button"
            className="w-fit border border-line bg-surface px-2 py-1 text-xs"
            aria-expanded={showAll}
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? "收起" : `展开其余 ${turns.length - 2} 轮`}
          </button>
        ) : null}
        {!showAll && turns.slice(0, -2).some((turn) => picked.includes(turn.lawyerId)) ? (
          <p className="text-xs text-muted">还有更早的问答已勾选，在收起的部分里。</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {(showAll ? turns : turns.slice(-2)).map((turn) => {
            const open = openIds.includes(turn.lawyerId);
            return (
              <li key={turn.lawyerId} className="border border-[#d5e0e6] bg-white px-2 py-2">
                <div className="flex min-w-0 items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={picked.includes(turn.lawyerId)}
                    onChange={() => toggle(turn.lawyerId)}
                    aria-label={`带走：${clip(turn.question, 24)}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-muted">{turn.legal ? "法律问答" : "问答"}</span>
                    {open ? null : <span className="mt-0.5 block break-words">{clip(turn.question)}</span>}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 border border-line bg-surface px-2 py-1 text-xs"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenIds((current) =>
                        current.includes(turn.lawyerId)
                          ? current.filter((id) => id !== turn.lawyerId)
                          : [...current, turn.lawyerId],
                      )
                    }
                  >
                    {open ? "收起" : "展开"}
                  </button>
                </div>
                <div className={`grid transition-[grid-template-rows] duration-300 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="relative max-h-36 overflow-hidden bg-gradient-to-r from-[#f7fafb] to-white px-2 py-2">
                        <p className="text-xs text-muted">问</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{turn.question}</p>
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent" />
                      </div>
                      <div className="relative max-h-36 overflow-hidden bg-gradient-to-l from-[#f3f7f8] to-white px-2 py-2">
                        <p className="text-xs text-agent">答</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{turn.answer}</p>
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#f3f7f8] to-transparent" />
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {error ? <p className="text-sm text-seal">{error}</p> : null}
        {done ? (
          <p className="text-sm">
            已带走 {done.brought} 轮
            {done.sources ? `、${done.sources} 条出处` : ""}。
            <a href={`/matters/${done.matterId}`} className="ml-2 underline">
              打开案子
            </a>
          </p>
        ) : null}
        <button
          type="submit"
          className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
          disabled={pending}
        >
          {pending ? "正在立案" : "立案并带走"}
        </button>
    </form>
  );
}
