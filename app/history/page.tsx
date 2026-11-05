import Link from "next/link";

import { DeskHeader } from "@/components/desk-header";
import { listThreads } from "@/lib/threads";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const threads = await listThreads();
  return (
    <div className="min-h-dvh bg-background">
      <DeskHeader current="history" />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <h1 className="text-lg">全部对话</h1>
        {threads.length === 0 ? (
          <p className="mt-4 text-sm text-muted">还没有。</p>
        ) : (
          <ul className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
            {threads.map((thread) => (
              <li key={thread.id} className="border-t border-line first:border-t-0">
                <Link href={`/?t=${thread.id}`} className="block px-4 py-3 text-sm underline">
                  {thread.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
