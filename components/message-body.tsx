import Link from "next/link";

import { linkCitedBooks } from "@/lib/cite-links";

const LINK =
  /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/matters\/[0-9a-fA-F-]{36}(?:\/[^)\s]*)?)\)/g;

export function MessageBody({ text, className }: { text: string; className?: string }) {
  const linked = linkCitedBooks(text);
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(LINK.source, "g");
  while ((match = pattern.exec(linked)) !== null) {
    if (match.index > last) parts.push(linked.slice(last, match.index));
    const href = match[2];
    const label = match[1];
    if (href.startsWith("http")) {
      parts.push(
        <a
          key={`${match.index}-${href}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {label}
        </a>,
      );
    } else {
      parts.push(
        <Link key={`${match.index}-${href}`} href={href} className="underline">
          {label}
        </Link>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < linked.length) parts.push(linked.slice(last));
  return <p className={className ?? "mt-2 whitespace-pre-wrap break-words text-sm leading-6"}>{parts}</p>;
}
