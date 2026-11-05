import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-6 sm:px-8">
      <h1 className="font-serif text-3xl">没有这件案子</h1>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        工作台
      </Link>
    </main>
  );
}
