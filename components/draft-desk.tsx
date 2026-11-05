"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SaveCopy } from "@/components/save-copy";

export type DraftView = {
  id: string;
  kind: string;
  body: string;
  warnings: string;
  final: boolean;
};

export function DraftDesk({
  matterId,
  current,
  seedBody = "",
  locked = false,
}: {
  matterId: string;
  current: DraftView | null;
  seedBody?: string;
  locked?: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState(current?.kind || "");
  const [body, setBody] = useState(current?.body || seedBody);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"save" | "final" | "">("");
  const final = Boolean(current?.final);
  const empty = !body.trim();
  const [open, setOpen] = useState(Boolean(current || seedBody.trim()));

  async function save() {
    if (locked || final) return;
    setPending("save");
    setError("");
    const response = await fetch(`/api/matters/${matterId}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: kind.trim() || "文书", body }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending("");
    if (!response.ok) {
      setError(payload?.error ?? "没有留下。");
      return;
    }
    router.refresh();
  }

  async function finalize() {
    if (locked || final) return;
    setPending("final");
    setError("");
    let draftId = current?.id ?? "";
    if (!draftId || body !== current?.body || (kind.trim() || "文书") !== current.kind) {
      const response = await fetch(`/api/matters/${matterId}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: kind.trim() || "文书", body }),
      });
      const payload = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !payload?.id) {
        setPending("");
        setError(payload?.error ?? "没有留下。");
        return;
      }
      draftId = payload.id;
    }
    const response = await fetch(`/api/matters/${matterId}/drafts/${draftId}/final`, { method: "POST" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending("");
    if (!response.ok) {
      setError(payload?.error ?? "没有定稿。");
      return;
    }
    router.refresh();
  }

  return (
    <section className="panel min-w-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-aside"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>其他文书{kind.trim() ? ` · ${kind.trim()}` : ""}</span>
        <span className="text-xs text-muted">{open ? "收起" : final ? "已定稿" : empty ? "展开" : "当前稿"}</span>
      </button>
      <div className="reveal" data-open={open ? "true" : "false"}>
        <div className="reveal-inner">
      <div className="border-t border-line px-4 py-4">
      <p className="text-xs leading-5 text-muted">情况说明这类短稿写在这里。起诉状、上诉状、答辩状和代理词在文书起草。</p>
      <label className="mt-3 block text-sm">
        种类
        <input
          className="mt-1"
          aria-label="文书种类"
          value={kind}
          disabled={locked || final}
          onChange={(event) => setKind(event.target.value)}
        />
      </label>
      <label className="mt-3 block text-sm">
        正文
        <textarea
          className="mt-1 min-h-64"
          rows={16}
          aria-label="文书正文"
          value={body}
          disabled={locked || final}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      {current?.warnings ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-seal">{current.warnings}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-seal">{error}</p> : null}
      {body.trim() ? (
        <SaveCopy
          text={body}
          matterId={matterId}
          name={kind.trim() || "文书"}
          onSaved={() => router.refresh()}
        />
      ) : null}
      {locked || final ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="w-fit border border-line bg-surface px-4 py-2 text-sm disabled:opacity-60"
            disabled={pending !== ""}
            onClick={save}
          >
            {pending === "save" ? "正在留下" : "留下"}
          </button>
          <button
            type="button"
            className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending !== ""}
            onClick={finalize}
          >
            {pending === "final" ? "正在定稿" : "定稿"}
          </button>
        </div>
      )}
      </div>
        </div>
      </div>
    </section>
  );
}
