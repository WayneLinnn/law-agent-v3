"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OpenCase({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function open(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientName.trim()) {
      setError("请点明谁是客户。");
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch(`/api/threads/${threadId}/case`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientName }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有建成这件案子。");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={open} className="panel flex min-w-0 flex-col gap-3 px-4 py-4">
      <div>
        <h2 className="text-sm">建成案子</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          点明客户后，挂上这件新草稿。看出的当事人、案由、基本事实先停在待确认，点留下才写入。不点的话，案子仍是空卡，加上这段对话。
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        客户
        <input value={clientName} onChange={(event) => setClientName(event.target.value)} />
      </label>
      {error ? <p className="text-sm text-seal">{error}</p> : null}
      <button
        type="submit"
        className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "正在建成" : "建成案子"}
      </button>
    </form>
  );
}

export function ProposalList({
  threadId,
  proposals,
  empty = "没有待确认的当事人、案由或基本事实。",
}: {
  threadId: string;
  proposals: Array<{ id: string; kind: string; body: string; acceptedAt: string | null }>;
  empty?: string;
}) {
  if (proposals.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {proposals.map((proposal) => (
        <li key={proposal.id}>
          <ProposalItem threadId={threadId} proposal={proposal} />
        </li>
      ))}
    </ul>
  );
}

function ProposalItem({
  threadId,
  proposal,
}: {
  threadId: string;
  proposal: { id: string; kind: string; body: string; acceptedAt: string | null };
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/threads/${threadId}/proposals/${proposal.id}/accept`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有留下这一项。");
      return;
    }
    router.refresh();
  }

  return (
    <div className="panel min-w-0 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm">{proposal.kind}</h3>
        <p className={proposal.acceptedAt ? "text-sm text-done" : "text-sm text-seal"}>
          {proposal.acceptedAt ? "已留下" : "待确认"}
        </p>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{proposal.body}</p>
      {error ? <p className="mt-2 text-sm text-seal">{error}</p> : null}
      {proposal.acceptedAt ? null : (
        <button
          type="button"
          className="mt-3 w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
          disabled={pending}
          onClick={accept}
        >
          {pending ? "正在留下" : "留下"}
        </button>
      )}
    </div>
  );
}
