export const MAX_STORED = 80_000;
export const ANSWER_BUDGET = 16_000;

const ENDING = /判决如下|裁定如下|调解协议如下|决定如下/;
const STOP = new Set([
  "这些",
  "所有",
  "全部",
  "照片",
  "图片",
  "相片",
  "汇总",
  "总结",
  "读完",
  "一下",
  "什么",
  "怎么",
  "是否",
  "可以",
  "给我",
]);

export type StoredPage = { text: string; folded?: boolean };

export function asksAllPhotos(text: string) {
  const value = text.replace(/\s/g, "");
  if (/这[一]?张/.test(value) && !/所有|全部|这些|每张|每一张|都读|一起/.test(value)) return false;
  return /所有(?:的)?(?:照片|图片|相片)|全部(?:的)?(?:照片|图片|相片)|这些(?:照片|图片|相片)|每(?:一)?张(?:照片|图片|相片)|(?:照片|图片|相片)都|(?:都|一起)读完?(?:这些|所有|全部)?(?:照片|图片|相片)|读完(?:这些|所有|全部|了)?(?:照片|图片|相片)|(?:照片|图片|相片).{0,8}(?:汇总|总结)|(?:汇总|总结).{0,8}(?:照片|图片|相片)/.test(
    value,
  );
}

export function storePages(pages: StoredPage[]) {
  const rows = pages.map((page) => ({
    text: page.folded ? "" : page.text.replace(/\u0000/g, "").trim(),
    folded: Boolean(page.folded),
  }));
  const map = rows
    .map((page, index) => {
      if (page.folded) return `第${index + 1}页 （未展开）`;
      const line = page.text.replace(/\s+/g, " ").slice(0, 40);
      return `第${index + 1}页 ${line || "（空白）"}`;
    })
    .join("\n");
  const blocks = rows.map((page, index) => (page.folded ? "" : `【第${index + 1}页】\n${page.text}`));
  const body = blocks.filter(Boolean).join("\n\n");
  const mapBlock = `【目录】\n${map}`;
  if (`${mapBlock}\n\n${body}`.length <= MAX_STORED) {
    return { text: `${mapBlock}\n\n${body}`.trim(), note: "" };
  }
  const ending = endingOf(rows.map((page) => page.text).join("\n"));
  const endingBlock = ending ? `【文末主文】\n${ending}` : "";
  let budget = MAX_STORED - mapBlock.length - endingBlock.length - 80;
  const kept: string[] = [];
  let skippedFrom = 0;
  blocks.forEach((block, index) => {
    if (!block) return;
    if (skippedFrom) return;
    if (block.length + 2 > budget) {
      skippedFrom = index + 1;
      return;
    }
    kept.push(block);
    budget -= block.length + 2;
  });
  const skipped = skippedFrom ? `【未展开】第${skippedFrom}页起只保留目录中的一行。` : "";
  return {
    text: [mapBlock, kept.join("\n\n"), skipped, endingBlock].filter(Boolean).join("\n\n"),
    note: "正文较长，已保留各页目录和文末主文。",
  };
}

export function focusForQuestion(stored: string, asked: string) {
  const pages = [...stored.matchAll(/【第(\d+)页】\n([\s\S]*?)(?=\n\n【|$)/g)].map((match) => ({
    index: Number(match[1]),
    body: (match[2] ?? "").trim(),
  }));
  const markedEnding = stored.match(/【文末主文】\n([\s\S]*)$/)?.[1]?.trim() ?? "";
  const ending = (markedEnding || endingOf(pages.map((page) => page.body).join("\n") || stored)).slice(0, 6_000);
  const map = stored.match(/【目录】\n([\s\S]*?)(?=\n\n【|$)/)?.[1]?.trim() ?? "";
  if (pages.length === 0) {
    const head = stored.slice(0, Math.max(0, ANSWER_BUDGET - ending.length - 20));
    if (!ending || head.includes(ending.slice(0, 24))) return stored.slice(0, ANSWER_BUDGET);
    return `${head}\n\n【文末主文】\n${ending}`.slice(0, ANSWER_BUDGET);
  }
  const tokens = (asked.match(/[\u4e00-\u9fff]{2,12}/g) ?? []).filter((token) => !STOP.has(token));
  const scored = pages.map((page) => {
    let score = page.index === 1 ? 1 : 0;
    for (const token of tokens) if (page.body.includes(token)) score += token.length;
    if (ENDING.test(page.body)) score += 20;
    return { ...page, score };
  });
  const picked = new Set<number>();
  if (scored[0]) picked.add(scored[0].index);
  for (const page of [...scored].sort((a, b) => b.score - a.score)) {
    if (page.score <= 0) continue;
    picked.add(page.index);
    if (picked.size >= 4) break;
  }
  const mapText = map ? `【目录】\n${map.slice(0, 2_500)}` : "";
  const endingText = ending ? `【文末主文】\n${ending}` : "";
  let room = ANSWER_BUDGET - mapText.length - endingText.length - 8;
  const kept: string[] = [];
  for (const page of scored) {
    if (!picked.has(page.index) || room < 80) continue;
    const block = `【第${page.index}页】\n${page.body}`.slice(0, room);
    kept.push(block.length < `【第${page.index}页】\n${page.body}`.length ? `${block}\n（此页后文略）` : block);
    room -= block.length + 2;
  }
  return [mapText, ...kept, endingText].filter(Boolean).join("\n\n");
}

export function bundlePhotos(
  photos: Array<{ filename: string; text: string; note: string }>,
  budget = ANSWER_BUDGET,
) {
  const lead = `共 ${photos.length} 张照片，按放入顺序。`;
  const headers = photos.map(
    (photo, index) => `【照片${index + 1}/${photos.length}】${photo.filename}`,
  );
  const overhead = lead.length + headers.join("\n").length + photos.length * 8;
  const share = Math.max(80, Math.floor((budget - overhead) / Math.max(photos.length, 1)));
  const blocks = photos.map((photo, index) => {
    const body = photo.text.trim();
    if (!body) return `${headers[index]}\n${photo.note || "没有识别出文字。"}`;
    if (body.length <= share) return `${headers[index]}\n${body}`;
    return `${headers[index]}\n${body.slice(0, share)}\n（此张后文略）`;
  });
  return [lead, ...blocks].join("\n\n");
}

function endingOf(text: string) {
  const match = ENDING.exec(text);
  if (!match || match.index == null) return "";
  return text.slice(match.index).replace(/[ \t]+\n/g, "\n").trim().slice(0, 6_000);
}
