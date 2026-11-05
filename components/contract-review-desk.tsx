"use client";

import { useState } from "react";

import { CONTRACT_SCALES, type ContractScale } from "@/lib/contract-scales";

type Card = {
  id: string;
  position: string;
  result: "修改" | "提示";
  redLine: boolean;
  title: string;
  comment: string;
  original: string;
  revision: string;
};

export function ContractReviewDesk({
  matterId,
  materials,
  initial,
}: {
  matterId: string;
  materials: Array<{ id: string; filename: string }>;
  initial: { stance: string; scale: ContractScale | ""; cards: Card[] } | null;
}) {
  const [materialId, setMaterialId] = useState("");
  const [text, setText] = useState("");
  const [stance, setStance] = useState(initial?.stance ?? "");
  const [scale, setScale] = useState<ContractScale | "">(initial?.scale ?? "");
  const [cards, setCards] = useState<Card[]>(initial?.cards ?? []);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const missing = [
    !stance.trim() ? "审查立场" : "",
    !scale ? "审查尺度" : "",
    !text.trim() && !materialId ? "合同正文" : "",
  ].filter(Boolean);

  async function generate() {
    if (missing.length > 0 || pending) return;
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/contract-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId, text, stance, scale }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; cards?: Card[] } | null;
    setPending(false);
    if (!response.ok || !payload?.cards) {
      setError(payload?.error ?? "没有审成。");
      return;
    }
    setCards(payload.cards);
  }

  async function saveRevision(card: Card, revision: string) {
    setCards((current) => current.map((item) => (item.id === card.id ? { ...item, revision } : item)));
    await fetch(`/api/matters/${matterId}/contract-review/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: card.id, revision }),
    });
  }

  const redLines = cards.filter((card) => card.redLine).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="panel flex flex-col gap-3 px-4 py-4">
        <h2 className="text-sm">合同审查</h2>
        <label className="flex flex-col gap-1 text-sm">
          合同
          <select
            value={materialId}
            className="w-full border border-line bg-surface px-2 py-2 text-sm"
            onChange={(event) => setMaterialId(event.target.value)}
          >
            <option value="">从材料里选一份</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.filename}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={text}
          rows={6}
          aria-label="合同正文"
          placeholder="或把合同正文贴在这里"
          className="w-full border border-line bg-surface px-2 py-2 text-sm leading-6"
          onChange={(event) => setText(event.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm">
          立场
          <input
            value={stance}
            aria-label="审查立场"
            placeholder="我方在合同中的称呼，例如买方"
            className="w-full border border-line bg-surface px-2 py-2 text-sm"
            onChange={(event) => setStance(event.target.value)}
          />
        </label>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend>尺度</legend>
          {CONTRACT_SCALES.map((item) => (
            <label key={item.id} className="flex items-start gap-2">
              <input
                type="radio"
                name="scale"
                className="mt-1"
                checked={scale === item.id}
                onChange={() => setScale(item.id)}
              />
              <span>
                {item.id}：{item.text}
              </span>
            </label>
          ))}
        </fieldset>
        {missing.length > 0 ? <p className="text-sm text-seal">还差{missing.join("、")}。</p> : null}
        {error ? <p className="text-sm text-seal">{error}</p> : null}
        <button
          type="button"
          className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
          disabled={pending || missing.length > 0}
          onClick={() => void generate()}
        >
          {pending ? "正在生成" : "生成"}
        </button>
      </section>
      {cards.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-sm">
            {cards.length} 条，红线 {redLines} 条
          </h2>
          {cards.map((card) => (
            <article key={card.id} className="panel min-w-0 px-4 py-4">
              <h3 className="text-sm">{card.title}</h3>
              <p className="mt-2 text-sm leading-6">
                {card.position} · {card.result}
                {card.redLine ? " · 红线" : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{card.comment}</p>
              {card.original.trim() ? (
                <details className="mt-2">
                  <summary className="text-xs text-muted">被审原文</summary>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{card.original}</p>
                </details>
              ) : null}
              <label className="mt-3 flex flex-col gap-1 text-sm">
                建议改写
                <textarea
                  value={card.revision}
                  rows={4}
                  aria-label={`${card.title}的建议改写`}
                  className="w-full border border-line bg-surface px-2 py-2 text-sm leading-6"
                  onChange={(event) =>
                    setCards((current) => current.map((item) => (item.id === card.id ? { ...item, revision: event.target.value } : item)))
                  }
                  onBlur={(event) => void saveRevision(card, event.target.value)}
                />
              </label>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
