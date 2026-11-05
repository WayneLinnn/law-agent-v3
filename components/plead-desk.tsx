"use client";

import { useState } from "react";

import { citationsIn, inventedCitations, PLEAD_FIELDS, PLEAD_KINDS, type PleadKind } from "@/lib/plead-fields";

type Version = {
  id: string;
  version: number;
  createdAt: string;
  body: string;
  warnings: string;
  slots: Record<string, string>;
  status: "缺槽位" | "已成文";
};

function finished(rows: Version[]) {
  return rows.filter((row) => row.status === "已成文" && row.body.trim());
}

function slotState(kind: PleadKind, rows: Version[], facts: string) {
  const latest = rows.at(-1);
  const slots = { ...Object.fromEntries(PLEAD_FIELDS[kind].map((field) => [field, ""])), ...(latest?.slots ?? {}) };
  if (kind === "民事起诉状" && !slots.案情概要?.trim() && facts.trim()) slots.案情概要 = facts.trim();
  return slots;
}

export function PleadDesk({
  matterId,
  materials,
  facts,
  initial,
}: {
  matterId: string;
  materials: Array<{ id: string; filename: string }>;
  facts: string;
  initial: Record<PleadKind, Version[]>;
}) {
  const [kind, setKind] = useState<PleadKind>("民事起诉状");
  const [history, setHistory] = useState(initial);
  const [slots, setSlots] = useState<Record<PleadKind, Record<string, string>>>(() =>
    Object.fromEntries(PLEAD_KINDS.map((item) => [item, slotState(item, initial[item], facts)])) as Record<
      PleadKind,
      Record<string, string>
    >,
  );
  const [bodies, setBodies] = useState<Record<PleadKind, string>>(() =>
    Object.fromEntries(PLEAD_KINDS.map((item) => [item, finished(initial[item]).at(-1)?.body ?? ""])) as Record<PleadKind, string>,
  );
  const [warnings, setWarnings] = useState<Record<PleadKind, string>>(() =>
    Object.fromEntries(PLEAD_KINDS.map((item) => [item, finished(initial[item]).at(-1)?.warnings ?? ""])) as Record<
      PleadKind,
      string
    >,
  );
  const [openId, setOpenId] = useState<Record<PleadKind, string>>(() =>
    Object.fromEntries(PLEAD_KINDS.map((item) => [item, finished(initial[item]).at(-1)?.id ?? ""])) as Record<PleadKind, string>,
  );
  const [materialId, setMaterialId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fields = PLEAD_FIELDS[kind];
  const missing = fields.filter((field) => !slots[kind][field]?.trim());
  const body = bodies[kind];
  const cited = citationsIn(body);
  const invented = inventedCitations(warnings[kind]);
  const versions = finished(history[kind]);
  const loose = warnings[kind]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("有法律结论"));

  function setField(field: string, value: string) {
    setSlots((current) => ({ ...current, [kind]: { ...current[kind], [field]: value } }));
  }

  function showVersion(row: Version) {
    setOpenId((current) => ({ ...current, [kind]: row.id }));
    setBodies((current) => ({ ...current, [kind]: row.body }));
    setWarnings((current) => ({ ...current, [kind]: row.warnings }));
    setSlots((current) => ({ ...current, [kind]: { ...slotState(kind, [row], ""), ...row.slots } }));
  }

  async function generate() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/plead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, slots: slots[kind], materialId }),
    });
    const payload = (await response.json().catch(() => null)) as
      | (Version & { error?: string; text?: string })
      | null;
    setPending(false);
    if (!response.ok || !payload) {
      setError(payload?.error ?? "没有生成。");
      return;
    }
    if (payload.status !== "已成文" || !payload.body) {
      setError(payload.text || `还差${missing.join("、")}。`);
      return;
    }
    const row: Version = {
      id: payload.id,
      version: payload.version,
      createdAt: payload.createdAt,
      body: payload.body,
      warnings: payload.warnings,
      slots: payload.slots,
      status: payload.status,
    };
    setHistory((current) => ({ ...current, [kind]: [...current[kind].filter((item) => item.id !== row.id), row] }));
    setBodies((current) => ({ ...current, [kind]: row.body }));
    setWarnings((current) => ({ ...current, [kind]: row.warnings }));
    setOpenId((current) => ({ ...current, [kind]: row.id }));
  }

  async function exportWord() {
    setExporting(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/plead/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body, name: kind }),
    });
    setExporting(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "没有导出。");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${kind}.docx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        {PLEAD_KINDS.map((item) => (
          <label key={item} className="flex items-center gap-2">
            <input type="radio" name="kind" checked={kind === item} onChange={() => setKind(item)} />
            {item}
          </label>
        ))}
        <button
          type="button"
          className="bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
          disabled={pending || missing.length > 0}
          onClick={() => void generate()}
        >
          {pending ? "正在生成" : "生成"}
        </button>
        <button
          type="button"
          className="border border-line bg-surface px-4 py-2 text-sm disabled:opacity-60"
          disabled={exporting || !body.trim()}
          onClick={() => void exportWord()}
        >
          {exporting ? "正在导出" : "导出 Word"}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {fields.map((field) => (
          <label key={field} className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            {field}
            <textarea
              value={slots[kind][field] ?? ""}
              rows={1}
              aria-label={field}
              className="w-full border border-line bg-surface px-2 py-1 text-sm leading-6"
              onChange={(event) => setField(field, event.target.value)}
            />
          </label>
        ))}
        <label className="flex w-full flex-col gap-1 text-sm sm:w-48">
          材料
          <select
            value={materialId}
            aria-label="作为事实的材料"
            className="w-full border border-line bg-surface px-2 py-1 text-sm"
            onChange={(event) => setMaterialId(event.target.value)}
          >
            <option value="">不附材料</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.filename}
              </option>
            ))}
          </select>
        </label>
      </div>
      {missing.length > 0 ? <p className="text-sm text-seal">还差{missing.join("、")}。</p> : null}
      {error ? <p className="text-sm text-seal">{error}</p> : null}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="panel min-w-0 px-4 py-4">
          <h2 className="text-sm">{kind}</h2>
          <textarea
            value={body}
            rows={Math.min(36, Math.max(16, body.split("\n").length + 2))}
            aria-label="正文"
            placeholder={kind}
            className="mt-3 w-full border border-line bg-surface px-3 py-3 text-sm leading-7"
            onChange={(event) => setBodies((current) => ({ ...current, [kind]: event.target.value }))}
          />
          {invented
            .filter((item) => body.includes(item))
            .map((mark) => (
              <p key={mark} className="mt-2 text-sm leading-6 text-seal">
                {mark}（疑似编造）
              </p>
            ))}
          {loose.map((line) => (
            <p key={line} className="mt-3 text-sm leading-6 text-seal">
              {line}
            </p>
          ))}
        </section>
        <aside className="flex min-w-0 flex-col gap-4">
          <section className="panel px-4 py-4">
            <h2 className="text-sm">法条和案例</h2>
            {cited.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-muted">这篇还没有写进法条或案例。</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-3">
                {cited.map((item) => {
                  const bad = invented.some((mark) => item.includes(mark) || mark.includes(item));
                  return (
                    <li key={item} className="text-sm leading-6">
                      <p className="break-words">{item}</p>
                      <p className={bad ? "text-seal" : "text-muted"}>{bad ? "疑似编造" : "已写入"}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="panel px-4 py-4">
            <h2 className="text-sm">历史</h2>
            {versions.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-muted">还没有成文。</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {versions.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="text-left text-sm leading-6 text-action"
                      aria-current={openId[kind] === row.id ? "true" : undefined}
                      onClick={() => showVersion(row)}
                    >
                      第{row.version}版 {row.createdAt.slice(0, 16).replace("T", " ")}
                    </button>
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
