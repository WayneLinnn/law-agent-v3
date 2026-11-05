const PERSON_ROLES = [
  "附带民事诉讼原告人",
  "附带民事诉讼被告人",
  "再审被申请人",
  "再审申请人",
  "被上诉人",
  "被申请人",
  "被执行人",
  "申请执行人",
  "犯罪嫌疑人",
  "复议申请人",
  "上诉人",
  "申请人",
  "第三人",
  "自诉人",
  "被害人",
  "被告人",
  "委托人",
  "发包人",
  "承包人",
  "原告",
  "被告",
].join("|");

const ORGAN_ROLES = ["复议机关", "公诉机关", "侦查机关"].join("|");

const SKIP_RE =
  /^(?:委托代理人|诉讼代理人|法定代理人|法定代表人|负责人|辩护人)(?:[（(][^）)]{0,24}[）)])?[0-9０-９一二三四五六七八九十]*[：:]/;

const ROLE_RE = new RegExp(
  `^(${ORGAN_ROLES}|${PERSON_ROLES})(?:[（(][^）)]{0,24}[）)])?[0-9０-９一二三四五六七八九十]*[：:]\\s*(.+)$`,
);

const CREDIT_RE =
  /(?:统一社会信用代码|社会信用代码|信用代码)[：:\s]*([0-9A-HJ-NPQRTUWXY]{18})/i;

const CAUSE_RE = /^案由[：:]\s*(.+)$/;

const SECTION_RE =
  /^(诉讼请求|仲裁请求|上诉请求|复议请求|委托事项|事实与理由|事实和理由|基本事实)[：:]?\s*(.*)$/;

const ORGAN_LINE_RE =
  /^([\u4e00-\u9fa5]{2,30}(?:人民法院|人民检察院|公安分局|公安局|仲裁委员会))[。．]?$/;

const MAX_BYTES = 1_000_000;

export type IntakeParty = {
  name: string;
  position: string;
  idNumber: string;
};

export type IntakeRead = {
  people: IntakeParty[];
  organs: IntakeParty[];
  cause: string;
  facts: string;
  mandate: string;
};

function namesOf(rest: string) {
  const head = rest.split(/[，,。；;]/)[0]?.trim().replace(/[。．]$/, "") ?? "";
  if (!head) return [];
  return head
    .split("、")
    .map((part) => part.trim())
    .filter(Boolean);
}

function addParty(list: IntakeParty[], party: IntakeParty) {
  if (!party.name) return null;
  const existing = list.find((item) => item.name === party.name);
  if (existing) {
    if (!existing.idNumber && party.idNumber) existing.idNumber = party.idNumber;
    if (!existing.position && party.position) existing.position = party.position;
    return existing;
  }
  list.push(party);
  return party;
}

function isStructured(line: string) {
  return (
    SKIP_RE.test(line) ||
    ROLE_RE.test(line) ||
    CAUSE_RE.test(line) ||
    SECTION_RE.test(line) ||
    line === "此致" ||
    /^此致[：:]/.test(line)
  );
}

export function parseIntake(text: string): IntakeRead {
  const people: IntakeParty[] = [];
  const organs: IntakeParty[] = [];
  let cause = "";
  const facts: string[] = [];
  const mandate: string[] = [];
  let section: "facts" | "mandate" | null = null;
  let expectOrgan = false;
  let creditTarget: IntakeParty | null = null;

  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (expectOrgan) {
      if (isStructured(line)) expectOrgan = false;
      else {
        addParty(organs, {
          name: line.replace(/[。．]$/, ""),
          position: "",
          idNumber: "",
        });
        expectOrgan = false;
        section = null;
        creditTarget = null;
        continue;
      }
    }

    if (line === "此致" || /^此致[：:]/.test(line)) {
      section = null;
      creditTarget = null;
      const rest = line.replace(/^此致[：:]?/, "").trim().replace(/[。．]$/, "");
      if (rest) {
        addParty(organs, { name: rest, position: "", idNumber: "" });
      } else {
        expectOrgan = true;
      }
      continue;
    }

    const causeMatch = line.match(CAUSE_RE);
    if (causeMatch) {
      section = null;
      creditTarget = null;
      if (!cause) cause = causeMatch[1].trim().replace(/[。．]$/, "");
      continue;
    }

    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      creditTarget = null;
      section = sectionMatch[1].includes("事实") ? "facts" : "mandate";
      if (sectionMatch[2]) (section === "facts" ? facts : mandate).push(sectionMatch[2]);
      continue;
    }

    if (SKIP_RE.test(line)) {
      creditTarget = null;
      continue;
    }

    const roleMatch = section === null ? line.match(ROLE_RE) : null;
    if (roleMatch) {
      const position = roleMatch[1];
      const organRole = ORGAN_ROLES.split("|").includes(position);
      const names = namesOf(roleMatch[2]);
      const credit =
        names.length === 1 ? line.match(CREDIT_RE)?.[1]?.toUpperCase() ?? "" : "";
      creditTarget = null;
      const added = names.map((name, index) =>
        addParty(organRole ? organs : people, {
          name,
          position,
          idNumber: index === 0 ? credit : "",
        }),
      );
      if (names.length === 1) creditTarget = added[0] ?? null;
      continue;
    }

    if (creditTarget && !creditTarget.idNumber && section === null) {
      const credit = line.match(CREDIT_RE)?.[1];
      if (credit) creditTarget.idNumber = credit.toUpperCase();
    }

    if (section === null) {
      const organLine = line.match(ORGAN_LINE_RE);
      if (organLine) {
        addParty(organs, { name: organLine[1], position: "", idNumber: "" });
        continue;
      }
    }

    if (section === "facts") facts.push(line);
    else if (section === "mandate") mandate.push(line);
  }

  return {
    people,
    organs,
    cause,
    facts: facts.join("\n").trim(),
    mandate: mandate.join("\n").trim(),
  };
}

export function intakeFromBytes(filename: string, bytes: Uint8Array) {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "";
  if (!base.toLowerCase().endsWith(".txt")) {
    return { error: "请放入一份 .txt 文本。", status: 400 as const };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return {
      error: bytes.byteLength === 0 ? "这份文本是空的。" : "这份文本太大。",
      status: 400 as const,
    };
  }
  if (bytes.includes(0)) return { error: "读不出文字。", status: 400 as const };
  try {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .trim();
    if (!text) return { error: "这份文本是空的。", status: 400 as const };
    return { filename: base, text, ...parseIntake(text) };
  } catch {
    return { error: "读不出文字。", status: 400 as const };
  }
}

export function intakeFromText(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { error: "这份文本是空的。", status: 400 as const };
  if (trimmed.length > MAX_BYTES) return { error: "这份文本太大。", status: 400 as const };
  return { filename: "", text: trimmed, ...parseIntake(trimmed) };
}

export function intakeNeedsModel(read: IntakeRead, text: string) {
  const hasPeople = read.people.length > 0;
  const hasBody = Boolean(read.cause.trim() || read.facts.trim() || read.mandate.trim());
  if (hasPeople && hasBody) return false;
  const trimmed = text.trim();
  if (hasPeople && trimmed.length < 500) return false;
  if (trimmed.length < 200 && !/答辩人|被答辩人|此致|一案/.test(trimmed)) return false;
  return !hasPeople || !hasBody;
}

export function intakeFromModelText(raw: string, source: string): IntakeRead | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  return {
    people: peopleFromModel(record.people, source),
    organs: organsFromModel(record.organs, source),
    cause: sourceSpan(record.cause, source, 2),
    facts: factsFromModel(record, source),
    mandate: sourceSpan(record.mandate, source, 2),
  };
}

export function mergeIntake(rules: IntakeRead, seen: IntakeRead): IntakeRead {
  const organs = [...seen.organs];
  for (const organ of rules.organs) {
    if (!organs.some((item) => item.name === organ.name)) organs.push(organ);
  }
  return {
    people: seen.people.length > 0 ? seen.people : rules.people,
    organs,
    cause: seen.cause || rules.cause,
    facts: seen.facts || rules.facts,
    mandate: seen.mandate || rules.mandate,
  };
}

const ORGAN_TITLE = /^[\u4e00-\u9fa5]{2,40}(?:人民法院|人民检察院|公安分局|公安局|仲裁委员会|复议机关)$/;

function peopleFromModel(value: unknown, source: string) {
  const people: IntakeParty[] = [];
  for (const item of modelRows(value)) {
    const position = item.position.replace(/[：:]\s*$/, "");
    const credit = item.names.length === 1 ? creditIn(item.idNumber, source) : "";
    item.names.forEach((name, index) => {
      if (!captionParty(name, position, source)) return;
      addParty(people, {
        name,
        position,
        idNumber: index === 0 ? credit : "",
      });
    });
  }
  return people;
}

function organsFromModel(value: unknown, source: string) {
  const organs: IntakeParty[] = [];
  for (const item of modelRows(value)) {
    for (const name of item.names) {
      if (!ORGAN_TITLE.test(name) || !source.includes(name)) continue;
      addParty(organs, { name, position: "", idNumber: "" });
    }
  }
  return organs;
}

function modelRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  const rows: Array<{ names: string[]; position: string; idNumber: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const names = textOf(record.name, 200)
      .split("、")
      .map((part) => part.trim())
      .filter(Boolean);
    if (names.length === 0) continue;
    rows.push({
      names,
      position: textOf(record.position, 200),
      idNumber: textOf(record.idNumber, 40),
    });
  }
  return rows;
}

function captionParty(name: string, position: string, source: string) {
  if (!name || !position || !source.includes(name)) return false;
  return source.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith(position) && trimmed.includes(name);
  });
}

function creditIn(value: string, source: string) {
  const code = value.toUpperCase().replace(/\s+/g, "");
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(code)) return "";
  if (!source.toUpperCase().includes(code)) return "";
  return code;
}

function factsFromModel(record: Record<string, unknown>, source: string) {
  const sliced = spanBetween(source, textOf(record.factsStart, 80), textOf(record.factsEnd, 80), 8);
  if (!sliced || sliced.length > 2_500) return "";
  return sliced;
}

function sourceSpan(value: unknown, source: string, min: number) {
  if (typeof value !== "string") return "";
  return spanBetween(source, value, value, min).slice(0, 2_000);
}

function spanBetween(source: string, start: string, end: string, min: number) {
  const folded = fold(source);
  const startKey = compact(start);
  const endKey = compact(end);
  if (startKey.length < min || endKey.length < min) return "";
  const startAt = folded.compact.indexOf(startKey);
  if (startAt < 0) return "";
  const endAt = folded.compact.indexOf(endKey, startAt);
  if (endAt < 0) return "";
  const from = folded.map[startAt];
  const to = folded.map[endAt + endKey.length - 1];
  if (from === undefined || to === undefined) return "";
  return source.slice(from, to + 1).trim();
}

function fold(source: string) {
  let compactText = "";
  const map: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (/\s/.test(char)) continue;
    compactText += char;
    map.push(index);
  }
  return { compact: compactText, map };
}

function compact(value: string) {
  return value.replace(/\s+/g, "");
}

function textOf(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}
