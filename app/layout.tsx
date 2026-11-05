import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "办案",
  description: "一件案子一条记录",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
