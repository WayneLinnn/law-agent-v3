"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Row = {
  key: string;
  name: string;
  position: string;
  idNumber: string;
};

type ReadPayload = {
  filename?: string;
  people: Array<{ name: string; position: string; idNumber: string }>;
  organs: Array<{ name: string; position: string; idNumber: string }>;
  cause: string;
  facts: string;
  mandate: string;
  error?: string;
};

const fieldLabel = "mb-1 block text-xs text-muted";

function blankRow(): Row {
  return { key: crypto.randomUUID(), name: "", position: "", idNumber: "" };
}

function rowsFrom(list: ReadPayload["people"]) {
  return list.map((item) => ({ ...item, key: crypto.randomUUID() }));
}

export function CreateCard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [people, setPeople] = useState<Row[]>([]);
  const [organs, setOrgans] = useState<Row[]>([]);
  const [cause, setCause] = useState("");
  const [mandate, setMandate] = useState("");
  const [facts, setFacts] = useState("");
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<"read" | "create" | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);

  function applyRead(payload: ReadPayload) {
    setPeople(rowsFrom(payload.people));
    setOrgans(rowsFrom(payload.organs));
    setCause(payload.cause);
    setMandate(payload.mandate);
    setFacts(payload.facts);
    setClientName("");
    const empty =
      payload.people.length === 0 &&
      payload.organs.length === 0 &&
      !payload.cause &&
      !payload.mandate &&
      !payload.facts;
    const source = payload.filename ? `已看过${payload.filename}。` : "已看过贴进来的文本。";
    setNote(
      empty
        ? `${source}没有读出当事人、案由或请求，卡片空着。`
        : `${source}每个人单独一行。客户还要你点明。`,
    );
    setError("");
  }

  async function readResponse(response: Response) {
    const payload = (await response.json().catch(() => null)) as ReadPayload | null;
    if (!response.ok || !payload || payload.error) {
      setError(payload?.error ?? "没有读出这份文件。");
      return;
    }
    applyRead(payload);
  }

  async function readFile(file: File) {
    setPending("read");
    setError("");
    setNote("");
    setSourceFile(file);
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/intake/read", { method: "POST", body });
    setPending(null);
    await readResponse(response);
  }

  function takeFiles(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    if (list && list.length > 1) {
      setError("一次放入一份。");
      return;
    }
    void readFile(file);
  }

  async function readPaste() {
    setPending("read");
    setError("");
    setNote("");
    setSourceFile(null);
    const response = await fetch("/api/intake/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pasted }),
    });
    setPending(null);
    await readResponse(response);
  }

  function changeRow(
    kind: "people" | "organs",
    key: string,
    field: "name" | "position" | "idNumber",
    value: string,
  ) {
    const update = (rows: Row[]) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row));
    if (kind === "people") {
      const current = people.find((row) => row.key === key);
      setPeople(update);
      if (field === "name" && current && clientName === current.name) setClientName(value);
      return;
    }
    setOrgans(update);
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientName.trim()) {
      setError("请点明谁是客户。");
      return;
    }
    setPending("create");
    setError("");
    const response = await fetch("/api/matters", {
      method: "POST",
      body: sourceFile
        ? (() => {
            const form = new FormData();
            form.set(
              "card",
              JSON.stringify({
                name,
                clientName,
                people: people.map(({ name: partyName, position, idNumber }) => ({
                  name: partyName,
                  position,
                  idNumber,
                })),
                organs: organs.map(({ name: partyName, position, idNumber }) => ({
                  name: partyName,
                  position,
                  idNumber,
                })),
                cause,
                facts,
                mandate,
              }),
            );
            form.set("file", sourceFile);
            return form;
          })()
        : JSON.stringify({
            name,
            clientName,
            people: people.map(({ name: partyName, position, idNumber }) => ({
              name: partyName,
              position,
              idNumber,
            })),
            organs: organs.map(({ name: partyName, position, idNumber }) => ({
              name: partyName,
              position,
              idNumber,
            })),
            cause,
            facts,
            mandate,
          }),
      headers: sourceFile ? undefined : { "Content-Type": "application/json" },
    });
    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      error?: string;
    } | null;
    setPending(null);
    if (!payload?.id) {
      setError(payload?.error ?? "没有建成这件案子。");
      return;
    }
    router.push(`/matters/${payload.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={create} className="mt-8 flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <label
          className={`relative flex cursor-pointer flex-col gap-1 rounded-2xl border border-dashed px-4 py-6 text-sm ${
            dragOver ? "border-action bg-surface" : "border-line bg-surface"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            takeFiles(event.dataTransfer.files);
          }}
        >
          <span>{pending === "read" ? "正在读" : "把一份 txt、Word、PDF 或照片丢进来"}</span>
          <span className="text-muted">只预填这张卡，不创建案子。照片和扫描件会先认出文字。</span>
          <span className="mt-3 w-fit border border-line bg-background px-3 py-1.5">选择文件</span>
          <input
            className="file-input"
            type="file"
            accept=".txt,.md,.doc,.docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,text/plain"
            aria-label="选择一份 txt、Word、PDF 或照片"
            onChange={(event) => {
              takeFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label className={fieldLabel} htmlFor="pasted">
          或把文本贴进来
        </label>
        <textarea
          id="pasted"
          value={pasted}
          rows={5}
          onChange={(event) => setPasted(event.target.value)}
          placeholder="当事人、案由、请求。读不出就空着。"
        />
        <button
          type="button"
          className="w-fit border border-line bg-surface px-3 py-2 text-sm"
          disabled={pending !== null}
          onClick={() => void readPaste()}
        >
          {pending === "read" ? "正在读" : "按这段预填"}
        </button>
        {note ? (
          <p className="text-sm leading-6 text-muted">
            {clientName.trim() ? note.replace("客户还要你点明。", "客户已经点明。") : note}
          </p>
        ) : null}
      </section>

      <Field label="案件名称" hint="不填就用客户的名称">
        <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </Field>

      <Field label="客户" hint="要你点明。不会从原告、被告人里猜。">
        <input
          value={clientName}
          onChange={(event) => setClientName(event.target.value)}
          autoComplete="off"
          aria-label="客户"
        />
      </Field>

      <RowList
        title="当事人"
        empty="还没有读出或写下的人。"
        rows={people}
        clientName={clientName}
        onAdd={() => setPeople((rows) => [...rows, blankRow()])}
        addLabel="加一位"
        onChange={(key, field, value) => changeRow("people", key, field, value)}
        onRemove={(key) => setPeople((rows) => rows.filter((row) => row.key !== key))}
        onMark={(value) => setClientName((current) => (current === value ? "" : value))}
      />

      <RowList
        title="办案机关"
        empty="还没有读出或写下的办案机关。"
        rows={organs}
        onAdd={() => setOrgans((rows) => [...rows, blankRow()])}
        addLabel="加一个"
        onChange={(key, field, value) => changeRow("organs", key, field, value)}
        onRemove={(key) => setOrgans((rows) => rows.filter((row) => row.key !== key))}
      />

      <Field label="案由">
        <input value={cause} onChange={(event) => setCause(event.target.value)} autoComplete="off" />
      </Field>
      <Field label="请求" hint="记入委托事项">
        <textarea value={mandate} rows={4} onChange={(event) => setMandate(event.target.value)} />
      </Field>
      <Field label="基本事实">
        <textarea value={facts} rows={4} onChange={(event) => setFacts(event.target.value)} />
      </Field>

      {error ? <p className="text-sm text-seal">{error}</p> : null}
      <button
        type="submit"
        className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
        disabled={pending !== null}
      >
        {pending === "create" ? "正在创建" : "创建"}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className={fieldLabel}>
        {label}
        {hint ? <span className="ml-2">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function RowList({
  title,
  empty,
  rows,
  clientName,
  addLabel,
  onAdd,
  onChange,
  onRemove,
  onMark,
}: {
  title: string;
  empty: string;
  rows: Row[];
  clientName?: string;
  addLabel: string;
  onAdd: () => void;
  onChange: (key: string, field: "name" | "position" | "idNumber", value: string) => void;
  onRemove: (key: string) => void;
  onMark?: (name: string) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm">{title}</h2>
        <button type="button" className="border border-line bg-surface px-3 py-1.5 text-sm" onClick={onAdd}>
          {addLabel}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((row) => {
            const marked = Boolean(onMark && row.name && clientName === row.name);
            return (
              <li key={row.key} className="panel min-w-0 px-3 py-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="min-w-0">
                    <span className={fieldLabel}>名称</span>
                    <input
                      value={row.name}
                      onChange={(event) => onChange(row.key, "name", event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className="min-w-0">
                    <span className={fieldLabel}>诉讼地位</span>
                    <input
                      value={row.position}
                      onChange={(event) => onChange(row.key, "position", event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                </div>
                <label className="mt-2 block min-w-0">
                  <span className={fieldLabel}>统一社会信用代码</span>
                  <input
                    value={row.idNumber}
                    onChange={(event) => onChange(row.key, "idNumber", event.target.value)}
                    autoComplete="off"
                    className="break-all"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {onMark ? (
                    <button
                      type="button"
                      aria-pressed={marked}
                      disabled={!row.name.trim()}
                      className={`px-3 py-1.5 text-sm ${
                        marked
                          ? "bg-action text-white"
                          : "border border-line bg-background"
                      }`}
                      onClick={() => onMark(row.name)}
                    >
                      {marked ? "已点明为客户" : "点明为客户"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="border border-line bg-background px-3 py-1.5 text-sm"
                    onClick={() => onRemove(row.key)}
                  >
                    去掉
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
