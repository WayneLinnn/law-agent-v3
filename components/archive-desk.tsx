"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ClosingView = {
  outcome: string;
  outcomeOn: string;
  outcomeNote: string;
  statement: string;
  confirmedAt: string | null;
  archivedAt: string | null;
};

type ClosingTask = {
  id: string;
  name: string;
  dueOn: string;
  confirmedAt: string | null;
  result: string;
  note: string;
};

type DossierItem = {
  id: string;
  section: string;
  label: string;
  position: number;
};

const SUGGESTIONS = ["生效裁判", "委托终止"];

function dayOf(stamp: string | null) {
  return stamp ? stamp.slice(0, 10) : "";
}

export function ArchiveDesk({
  matterId,
  matterStatus,
  closing,
  tasks,
  dossier,
}: {
  matterId: string;
  matterStatus: string;
  closing: ClosingView | null;
  tasks: ClosingTask[];
  dossier: DossierItem[];
}) {
  const router = useRouter();
  const locked = matterStatus === "已归档";
  const [outcome, setOutcome] = useState(closing?.outcome ?? "");
  const [outcomeOn, setOutcomeOn] = useState(closing?.outcomeOn ?? "");
  const [outcomeNote, setOutcomeNote] = useState(closing?.outcomeNote ?? "");
  const [statement, setStatement] = useState(closing?.statement ?? "");
  const [rows, setRows] = useState(tasks.map((task) => ({ result: task.result, note: task.note })));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function send(url: string, body?: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) return payload?.error ?? "没有记下。";
    return "";
  }

  async function run(action: () => Promise<string>) {
    setPending(true);
    setError("");
    const message = await action();
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    router.refresh();
  }

  function setRow(index: number, patch: { result?: string; note?: string }) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  const sections: Array<{ section: string; items: DossierItem[] }> = [];
  for (const item of dossier) {
    const last = sections[sections.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else sections.push({ section: item.section, items: [item] });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm leading-6 text-muted">
        写下办结结果、日期和具体情况后进入结案中。每条待办写下处理结果，保存并确认结案说明，再单独归档。归档后可以问答，不能检索后勾选，不能分析成文，也不能留下操作。解档回到已结案。
      </p>
      {locked ? <p className="text-sm text-muted">归档后只供查阅。办理上仍可以问答。</p> : null}
      {matterStatus === "结案中" ? <p className="text-sm text-muted">办结结果已记下。待办处理完，再确认结案说明。</p> : null}
      {matterStatus === "已结案" ? (
        <p className="text-sm text-done">结案说明已确认{closing?.confirmedAt ? ` ${dayOf(closing.confirmedAt)}` : ""}。可以归档。</p>
      ) : null}

      <form
        className="panel flex flex-col gap-3 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() =>
            send(`/api/matters/${matterId}/closing`, {
              outcome,
              outcomeOn,
              outcomeNote,
            }),
          );
        }}
      >
        <h2 className="text-sm">办结结果</h2>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className="border border-line px-3 py-1 text-sm disabled:opacity-60"
              disabled={locked || pending}
              onClick={() => setOutcome(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          办结结果
          <input
            aria-label="办结结果"
            value={outcome}
            disabled={locked}
            onChange={(event) => setOutcome(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          办结日期
          <input
            aria-label="办结日期"
            type="date"
            value={outcomeOn}
            disabled={locked}
            onChange={(event) => setOutcomeOn(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          具体情况
          <textarea
            aria-label="具体情况"
            rows={3}
            value={outcomeNote}
            disabled={locked}
            onChange={(event) => setOutcomeNote(event.target.value)}
          />
        </label>
        {locked ? null : (
          <button
            type="submit"
            className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending}
          >
            保存办结结果
          </button>
        )}
      </form>

      <section className="panel flex flex-col gap-3 px-4 py-4">
        <h2 className="text-sm">待办的处理结果</h2>
        {tasks.length === 0 ? <p className="text-sm text-muted">这件案子没有待办。</p> : null}
        {tasks.map((task, index) => (
          <form
            key={task.id}
            className="flex flex-col gap-2 border-t border-line pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              const row = rows[index];
              void run(() =>
                send(`/api/matters/${matterId}/closing/tasks/${task.id}`, {
                  result: row?.result ?? "",
                  note: row?.note ?? "",
                }),
              );
            }}
          >
            <p className="break-words text-sm">
              {task.name}
              <span className="text-muted"> · {task.dueOn}</span>
              {task.confirmedAt ? null : <span className="text-muted"> · 待确认</span>}
            </p>
            <label className="flex flex-col gap-1 text-sm">
              处理结果
              <select
                aria-label={`${task.name}的处理结果`}
                className="w-full min-w-0 border border-line bg-background px-3 py-2 text-sm"
                value={rows[index]?.result ?? ""}
                disabled={locked}
                onChange={(event) => setRow(index, { result: event.target.value })}
              >
                <option value="">请选择</option>
                <option value="已完成">已完成</option>
                <option value="不再适用">不再适用</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              说明
              <input
                aria-label={`${task.name}的说明`}
                value={rows[index]?.note ?? ""}
                disabled={locked}
                onChange={(event) => setRow(index, { note: event.target.value })}
              />
            </label>
            {locked ? null : (
              <button
                type="submit"
                className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
                disabled={pending}
              >
                记下处理结果
              </button>
            )}
          </form>
        ))}
      </section>

      <form
        className="panel flex flex-col gap-3 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => send(`/api/matters/${matterId}/closing/statement`, { statement }));
        }}
      >
        <h2 className="text-sm">结案说明</h2>
        <textarea
          aria-label="结案说明"
          rows={4}
          value={statement}
          disabled={locked}
          onChange={(event) => setStatement(event.target.value)}
        />
        {locked ? null : (
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="w-fit border border-line px-4 py-2 text-sm disabled:opacity-60"
              disabled={pending}
            >
              保存说明
            </button>
            <button
              type="button"
              className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
              disabled={pending}
              onClick={() => {
                void run(async () => {
                  const saved = await send(`/api/matters/${matterId}/closing/statement`, { statement });
                  if (saved) return saved;
                  return send(`/api/matters/${matterId}/closing/confirm`);
                });
              }}
            >
              确认结案说明
            </button>
          </div>
        )}
      </form>

      {error ? <p className="text-sm text-seal">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {locked ? (
          <button
            type="button"
            className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending}
            onClick={() => {
              void run(() => send(`/api/matters/${matterId}/closing/unarchive`));
            }}
          >
            解档
          </button>
        ) : (
          <button
            type="button"
            className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending}
            onClick={() => {
              void run(() => send(`/api/matters/${matterId}/closing/archive`));
            }}
          >
            归档
          </button>
        )}
      </div>

      <section className="panel flex flex-col gap-3 px-4 py-4">
        <h2 className="text-sm">目录</h2>
        {dossier.length === 0 ? <p className="text-sm text-muted">还没有目录。归档时才生成。</p> : null}
        {sections.map((group) => (
          <div key={group.section}>
            <h3 className="text-sm text-muted">{group.section}</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item.id} className="break-words text-sm leading-6">
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
