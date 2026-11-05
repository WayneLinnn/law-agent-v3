"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type FindHits = {
  matters: Array<{ id: string; name: string; status: string; clientName: string }>;
  materials: Array<{ matterId: string; matterName: string; filename: string; snippet: string }>;
};

export function DeskHeader({ current }: { current: "home" | "matters" | "history" }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FindHits | null>(null);
  const [error, setError] = useState("");
  const [finding, setFinding] = useState(false);

  async function find(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) {
      setError("请写下要找的字。");
      setHits(null);
      return;
    }
    setFinding(true);
    setError("");
    try {
      const response = await fetch(`/api/find?q=${encodeURIComponent(q)}`);
      const payload = (await response.json().catch(() => null)) as (FindHits & { error?: string }) | null;
      if (!response.ok || !payload || payload.error) {
        setError(payload?.error ?? "没有找成。");
        setHits(null);
        return;
      }
      setHits(payload);
    } finally {
      setFinding(false);
    }
  }

  const link = (key: "home" | "matters", href: string, label: string) => (
    <Link href={href} className={current === key ? "text-white underline" : "text-white/80 no-underline hover:text-white"}>
      {label}
    </Link>
  );

  return (
    <header className="bg-nav text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <nav className="flex items-center gap-4 text-sm">
          {link("home", "/", "工作台")}
          {link("matters", "/matters", "全部案件")}
        </nav>
        <form onSubmit={find} className="relative min-w-0 flex-1">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索案件或材料"
            aria-label="搜索案件或材料"
            className="h-9 bg-surface"
          />
          {(error || hits) && (
            <div className="absolute top-11 right-0 left-0 z-20 max-h-80 overflow-auto rounded-md border border-line bg-surface p-3 text-sm text-foreground shadow-sm">
              {error ? <p className="text-seal">{error}</p> : null}
              {hits ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted">案子</p>
                    {hits.matters.length === 0 ? (
                      <p className="mt-1 text-muted">没有对上的案子。</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-1">
                        {hits.matters.map((matter) => (
                          <li key={matter.id}>
                            <Link href={`/matters/${matter.id}`} className="underline">
                              {matter.name}
                            </Link>
                            <span className="text-muted">
                              {" "}
                              · {matter.status}
                              {matter.clientName ? ` · ${matter.clientName}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted">材料</p>
                    {hits.materials.length === 0 ? (
                      <p className="mt-1 text-muted">没有对上的材料。</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-2">
                        {hits.materials.map((item) => (
                          <li key={`${item.matterId}-${item.filename}`}>
                            <Link href={`/matters/${item.matterId}`} className="underline">
                              {item.matterName}
                            </Link>
                            <span className="text-muted"> / {item.filename}</span>
                            <p className="mt-0.5 break-words text-xs text-muted">{item.snippet}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
              {finding ? <p className="text-muted">正在找</p> : null}
            </div>
          )}
        </form>
        <Button asChild>
          <Link href="/matters/new" className="text-white no-underline">
            新建案件
          </Link>
        </Button>
      </div>
    </header>
  );
}
