import Link from "next/link";

import { touchOpened } from "@/lib/matters";

export async function MatterFrame({
  matter,
  wide = false,
  desk = false,
  fill = false,
  children,
}: {
  matter: { id: string; name: string; status: string; category?: string };
  wide?: boolean;
  desk?: boolean;
  fill?: boolean;
  children: React.ReactNode;
}) {
  await touchOpened(matter.id);
  const width = desk ? "max-w-[100rem]" : wide ? "max-w-6xl" : "max-w-3xl";

  return (
    <div className={`flex min-h-dvh flex-col bg-background ${fill ? "h-dvh overflow-hidden" : ""}`}>
      <header className="shrink-0 bg-nav text-white">
        <div className={`mx-auto w-full px-4 py-4 sm:px-8 ${width}`}>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link href="/" className="text-white underline">
              工作台
            </Link>
            <Link href={`/matters/${matter.id}`} className="text-white underline">
              这件案子
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="min-w-0 break-words font-serif text-3xl text-white">{matter.name}</h1>
            <p className="text-sm text-white/80">
              {[matter.category, matter.status].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </header>
      <main
        className={`mx-auto w-full min-h-0 px-4 sm:px-8 ${width} ${
          fill ? "flex flex-1 flex-col overflow-hidden py-4" : "py-6"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
