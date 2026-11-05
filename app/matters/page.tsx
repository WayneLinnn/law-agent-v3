import Link from "next/link";

import { DeskHeader } from "@/components/desk-header";
import { listMatters } from "@/lib/matters";

export const dynamic = "force-dynamic";

export default async function MattersPage() {
  const matters = await listMatters();
  return (
    <div className="min-h-dvh bg-background">
      <DeskHeader current="matters" />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <h1 className="text-lg">全部案件</h1>
        <p className="mt-1 text-sm text-muted">含已结案。在办的案子在工作台的继续办案里。</p>
        {matters.length === 0 ? (
          <p className="mt-4 text-sm text-muted">还没有案子。</p>
        ) : (
          <ul className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
            {matters.map((matter) => {
              const client = matter.parties.find((party) => party.role === "client")?.name ?? "";
              return (
                <li key={matter.id} className="border-t border-line first:border-t-0">
                  <Link href={`/matters/${matter.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm no-underline hover:bg-aside">
                    <span className="font-medium text-foreground">{matter.name}</span>
                    <span className="text-muted">{matter.status}</span>
                    {client ? <span className="text-muted">客户 {client}</span> : null}
                    {matter.cause ? <span className="text-muted">{matter.cause}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
