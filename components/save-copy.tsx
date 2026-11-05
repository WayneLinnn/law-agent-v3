"use client";

import { useState } from "react";

export function canSaveCopy(body: string, asked = "") {
  const text = body.trim();
  if (!text || /不能/.test(text) || /还没有节点/.test(text)) return false;
  if (/保存|导出|存成|存为/.test(asked) && /word|pdf|docx/i.test(asked)) {
    return /\d{4}-\d{2}-\d{2}/.test(text) || text.length >= 80;
  }
  if (text.length < 80) return false;
  if (/^#?\s*(民事起诉状|答辩状|代理词)/.test(text)) return true;
  if (/写|起草/.test(asked)) return true;
  return false;
}

function saveName(text: string) {
  if (text.includes("起诉状")) return "起诉状";
  if (text.includes("答辩")) return "答辩状";
  if (text.includes("代理词")) return "代理词";
  return "对话稿";
}

export function SaveCopy({
  text,
  matterId,
  name,
  onSaved,
}: {
  text: string;
  matterId: string;
  name?: string;
  onSaved?: () => void;
}) {
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"" | "docx" | "pdf">("");
  const label = name || saveName(text);

  async function save(format: "docx" | "pdf") {
    setPending(format);
    setError("");
    setNote("");
    const response = await fetch(`/api/matters/${matterId}/materials/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, name: label, text }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; filename?: string } | null;
    setPending("");
    if (!response.ok || !payload?.filename) {
      setError(payload?.error ?? "没有放进材料。");
      return;
    }
    setNote(`已放进材料：${payload.filename}`);
    onSaved?.();
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
      <button type="button" className="underline" disabled={pending !== ""} onClick={() => void save("docx")}>
        {pending === "docx" ? "正在放入" : "存为 Word"}
      </button>
      <button type="button" className="underline" disabled={pending !== ""} onClick={() => void save("pdf")}>
        {pending === "pdf" ? "正在放入" : "存为 PDF"}
      </button>
      {note ? <span className="text-done">{note}</span> : null}
      {error ? <span className="text-seal">{error}</span> : null}
    </div>
  );
}
