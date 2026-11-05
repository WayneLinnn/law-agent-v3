"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Task = {
  id: string;
  name: string;
  dueOn: string;
  confirmedAt: string | null;
};

export function TaskDesk({
  matterId,
  tasks,
  feeReceived,
  locked,
}: {
  matterId: string;
  tasks: Task[];
  feeReceived: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("请写下名称。");
      return;
    }
    if (!dueOn) {
      setError("请写下到期日。");
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, dueOn }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有记下这条待办。");
      return;
    }
    setName("");
    setDueOn("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-6 text-muted">
        一条待办只记名称和到期日。确认后才出现在工作台。实收按本案记下。这里不推算答辩、上诉、保全，也不算时效、利息、受理费，不记应收。
      </p>
      {locked ? (
        <p className="text-sm text-muted">归档后只供查阅。</p>
      ) : (
        <form onSubmit={add} className="panel flex flex-col gap-3 px-4 py-4">
          <h2 className="text-sm">记下待办</h2>
          <label className="flex flex-col gap-1 text-sm">
            名称
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            到期日
            <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </label>
          {error ? <p className="text-sm text-seal">{error}</p> : null}
          <button
            type="submit"
            className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending}
          >
            {pending ? "正在记下" : "记下"}
          </button>
        </form>
      )}

      {tasks.length === 0 ? (
        <p className="text-sm text-muted">还没有待办。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => (
            <li key={`${task.id}:${task.confirmedAt ?? ""}`} className="panel min-w-0 px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="min-w-0 break-words text-sm">{task.name}</h2>
                <p className={task.confirmedAt ? "text-sm text-done" : "text-sm text-seal"}>
                  {task.confirmedAt ? "已确认" : "待确认"}
                </p>
              </div>
              <p className="mt-2 text-sm">{task.dueOn}</p>
              {!locked ? <ConfirmTask matterId={matterId} taskId={task.id} confirmed={Boolean(task.confirmedAt)} /> : null}
            </li>
          ))}
        </ul>
      )}

      {locked ? null : <FeeForm key={feeReceived ?? ""} matterId={matterId} feeReceived={feeReceived} />}
    </div>
  );
}

function FeeForm({ matterId, feeReceived }: { matterId: string; feeReceived: string | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState(feeReceived ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function saveFee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(`/api/matters/${matterId}/fee`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有记下实收。");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={saveFee} className="panel flex flex-col gap-3 px-4 py-4">
      <h2 className="text-sm">实收</h2>
      <label className="flex flex-col gap-1 text-sm">
        实收（元）
        <input
          inputMode="decimal"
          value={amount}
          placeholder="还没记"
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-seal">{error}</p> : null}
      <button
        type="submit"
        className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "正在记下" : "记下实收"}
      </button>
    </form>
  );
}

function ConfirmTask({
  matterId,
  taskId,
  confirmed,
}: {
  matterId: string;
  taskId: string;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"" | "confirm" | "cancel">("");

  async function confirm() {
    setPending("confirm");
    setError("");
    const response = await fetch(`/api/matters/${matterId}/tasks/${taskId}/confirm`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending("");
    if (!response.ok) {
      setError(payload?.error ?? "没有确认这条待办。");
      return;
    }
    router.refresh();
  }

  async function cancel() {
    setPending("cancel");
    setError("");
    const response = await fetch(`/api/matters/${matterId}/tasks/${taskId}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending("");
    if (!response.ok) {
      setError(payload?.error ?? "没有取消这条待办。");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {error ? <p className="text-sm text-seal">{error}</p> : null}
      <div className="flex items-center gap-3">
        {confirmed ? null : (
          <button
            type="button"
            className="w-fit bg-action px-4 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending !== ""}
            onClick={confirm}
          >
            {pending === "confirm" ? "正在确认" : "确认"}
          </button>
        )}
        <button type="button" className="text-sm underline disabled:opacity-60" disabled={pending !== ""} onClick={cancel}>
          {pending === "cancel" ? "正在取消" : "取消"}
        </button>
      </div>
    </div>
  );
}
