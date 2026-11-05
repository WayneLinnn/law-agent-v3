function flatLaw(value: string) {
  return value.replace(/[《》\s（）()]/g, "");
}

function articleOf(value: string) {
  return value.match(/第[0-9０-９一二三四五六七八九十百零千]+条(?:之[0-9０-９一二三四五六七八九十]+)?/)?.[0] ?? "";
}

export function linkHitsInText(text: string, hits: Array<{ title: string; url?: string; text?: string }>) {
  const usable = hits
    .filter((hit) => hit.url && hit.title.trim().length >= 2)
    .map((hit) => ({
      title: hit.title.trim(),
      url: hit.url as string,
      body: hit.text ?? "",
    }));
  const spans = [
    ...text.matchAll(/《[^》\n]{2,40}》(?:第[0-9０-９一二三四五六七八九十百零千]+条(?:之[0-9０-９一二三四五六七八九十]+)?)?/g),
  ];
  const replacements: Array<{ start: number; end: number; url: string; label: string }> = [];
  for (const span of spans) {
    const label = span[0];
    const start = span.index ?? 0;
    const book = flatLaw(label.match(/《([^》]+)》/)?.[1] ?? "");
    const article = articleOf(label);
    if (book.length < 2) continue;
    const ranked = usable
      .map((hit) => {
        const title = flatLaw(hit.title);
        const blob = `${hit.title}\n${hit.body}`;
        let score = 0;
        if (title.includes(book) || book.includes(title)) score += 3;
        if (article && blob.includes(article)) score += 4;
        return { hit, score };
      })
      .filter((item) => item.score >= 3)
      .sort((left, right) => right.score - left.score);
    const best = ranked[0]?.hit;
    if (!best) continue;
    if (text[start - 1] === "[") continue;
    replacements.push({ start, end: start + label.length, url: best.url, label });
  }
  let out = text;
  for (const item of replacements.sort((left, right) => right.start - left.start)) {
    out = `${out.slice(0, item.start)}[${item.label}](${item.url})${out.slice(item.end)}`;
  }
  for (const hit of [...usable].sort((left, right) => right.title.length - left.title.length)) {
    const escaped = hit.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "g"), (found, offset: number, whole: string) => {
      const opened = whole.lastIndexOf("[", offset);
      const closed = whole.indexOf("](", offset);
      if (opened >= 0 && opened <= offset && closed > offset) return found;
      return `[${found}](${hit.url})`;
    });
  }
  return out;
}

export function linkCitedBooks(text: string) {
  const hits = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => ({
    title: match[1] ?? "",
    url: match[2] ?? "",
  }));
  if (hits.length === 0) return text;
  return linkHitsInText(text, hits);
}
