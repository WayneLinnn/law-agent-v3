import Link from "next/link";

import { CreateCard } from "@/components/create-card";

export default function NewMatterPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-nav text-white">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-8">
          <Link href="/" className="text-sm text-white underline">
            工作台
          </Link>
          <h1 className="mt-3 font-serif text-3xl text-white">创建</h1>
        </div>
      </header>
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        开一张空卡，自己填写。也可以丢进一份 txt、Word、PDF 或照片，或把文本贴进来，只用来预填。每个人单独一行。点明客户之后才创建，原告和被告人不会变成客户。
      </p>
      <CreateCard />
    </main>
    </div>
  );
}
