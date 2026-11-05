"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CATEGORIES } from "@/lib/categories";

const fieldLabel = "mb-1 block text-xs text-muted";

type Party = {
  id: string;
  name: string;
  position: string;
  idNumber: string;
};

export function OverviewEditor({
  matterId,
  category,
  locked,
  clients,
  opposing,
  organs,
}: {
  matterId: string;
  category: string;
  locked: boolean;
  clients: Party[];
  opposing: Party[];
  organs: Party[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <CategoryField matterId={matterId} category={category} locked={locked} />
      <p className="text-sm leading-6 text-muted">
        诉讼地位由你填写。第三列是办案机关，复议机关、检察院、公安机关写在这里。换成刑事或行政，这一页还是这三列。
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <PartyColumn matterId={matterId} title="客户" parties={clients} locked={locked} />
        <PartyColumn
          matterId={matterId}
          title="对方"
          parties={opposing}
          locked={locked}
          addRole="opposing"
          addLabel="加一位对方"
        />
        <PartyColumn
          matterId={matterId}
          title="办案机关"
          parties={organs}
          locked={locked}
          addRole="organ"
          addLabel="记下办案机关"
        />
      </div>
    </div>
  );
}

function CategoryField({
  matterId,
  category,
  locked,
}: {
  matterId: string;
  category: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(category);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: value }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有记下种类。");
      return;
    }
    router.refresh();
  }

  return (
    <div className="panel flex min-w-0 flex-col gap-2 px-4 py-4">
      <label className={fieldLabel} htmlFor="category">
        种类
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          id="category"
          value={value}
          disabled={locked}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 border border-line bg-background px-3 py-2 text-sm sm:max-w-xs"
        >
          <option value="">还没写</option>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        {locked ? null : (
          <button
            type="button"
            className="w-fit bg-action px-3 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending}
            onClick={() => void save()}
          >
            {pending ? "正在记下" : "记下种类"}
          </button>
        )}
      </div>
      {error ? <p className="text-sm text-seal">{error}</p> : null}
    </div>
  );
}

function PartyColumn({
  matterId,
  title,
  parties,
  locked,
  addRole,
  addLabel,
}: {
  matterId: string;
  title: string;
  parties: Party[];
  locked: boolean;
  addRole?: "opposing" | "organ";
  addLabel?: string;
}) {
  return (
    <section className="panel min-w-0 px-4 py-4">
      <h2 className="text-xs text-muted">{title}</h2>
      {parties.length === 0 ? <p className="mt-2 text-sm text-muted">还没写</p> : null}
      <ul className="mt-2 flex flex-col gap-4">
        {parties.map((party) => (
          <li key={`${party.id}:${party.position}`}>
            <PositionRow matterId={matterId} party={party} locked={locked} />
          </li>
        ))}
      </ul>
      {addRole && addLabel && !locked ? (
        <AddParty matterId={matterId} role={addRole} label={addLabel} />
      ) : null}
    </section>
  );
}

function PositionRow({
  matterId,
  party,
  locked,
}: {
  matterId: string;
  party: Party;
  locked: boolean;
}) {
  const router = useRouter();
  const [position, setPosition] = useState(party.position);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/parties/${party.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有记下诉讼地位。");
      return;
    }
    router.refresh();
  }

  return (
    <div className="min-w-0">
      <p className="break-words text-sm">{party.name}</p>
      {party.idNumber ? (
        <p className="mt-1 break-all text-xs text-muted">统一社会信用代码 {party.idNumber}</p>
      ) : null}
      <label className={`${fieldLabel} mt-2`} htmlFor={`position-${party.id}`}>
        诉讼地位
      </label>
      <input
        id={`position-${party.id}`}
        value={position}
        disabled={locked}
        onChange={(event) => setPosition(event.target.value)}
        autoComplete="off"
      />
      {locked ? null : (
        <button
          type="button"
          className="mt-2 w-fit border border-line bg-background px-3 py-1.5 text-sm disabled:opacity-60"
          disabled={pending}
          onClick={() => void save()}
        >
          {pending ? "正在记下" : "记下"}
        </button>
      )}
      {error ? <p className="mt-2 text-sm text-seal">{error}</p> : null}
    </div>
  );
}

function AddParty({
  matterId,
  role,
  label,
}: {
  matterId: string;
  role: "opposing" | "organ";
  label: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    if (!name.trim()) {
      setError("请写下名称。");
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/parties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, name, position }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有记下。");
      return;
    }
    setName("");
    setPosition("");
    router.refresh();
  }

  return (
    <div className="mt-4 flex min-w-0 flex-col gap-2 border-t border-line pt-3">
      <label className={fieldLabel}>{role === "organ" ? "办案机关" : "对方"}</label>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label={role === "organ" ? "办案机关名称" : "对方名称"}
        autoComplete="off"
        placeholder={role === "organ" ? "复议机关、检察院、公安机关" : "名称"}
      />
      <input
        value={position}
        onChange={(event) => setPosition(event.target.value)}
        aria-label="诉讼地位"
        autoComplete="off"
        placeholder="诉讼地位"
      />
      {error ? <p className="text-sm text-seal">{error}</p> : null}
      <button
        type="button"
        className="w-fit border border-line bg-background px-3 py-1.5 text-sm disabled:opacity-60"
        disabled={pending}
        onClick={() => void save()}
      >
        {pending ? "正在记下" : label}
      </button>
    </div>
  );
}
