import "server-only";

import { connection } from "next/server";

import { database } from "@/lib/db";

type Failure = { error: string; status: 400 | 404 | 409 };

export type JudgeRecord = {
  id: string;
  name: string;
  court: string;
  division: string;
  contact: string;
  note: string;
};

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export async function listJudges(query = ""): Promise<JudgeRecord[]> {
  await connection();
  const needle = query.trim();
  const rows = (
    needle
      ? database()
          .prepare(
            `SELECT id, name, court, division, contact, note FROM judges
             WHERE name LIKE ? OR court LIKE ? OR division LIKE ?
             ORDER BY name, rowid`,
          )
          .all(`%${needle}%`, `%${needle}%`, `%${needle}%`)
      : database()
          .prepare("SELECT id, name, court, division, contact, note FROM judges ORDER BY name, rowid")
          .all()
  ) as Array<{ id: string; name: string; court: string; division: string; contact: string; note: string }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    court: row.court,
    division: row.division,
    contact: row.contact,
    note: row.note,
  }));
}

export async function saveJudge(input: {
  name?: string;
  court?: string;
  division?: string;
  contact?: string;
  note?: string;
}): Promise<Failure | { id: string }> {
  await connection();
  const name = (input.name ?? "").trim().slice(0, 80);
  if (!name) return { error: "请写下法官姓名。", status: 400 };
  const existing = database().prepare("SELECT id FROM judges WHERE name = ? AND court = ?").get(
    name,
    (input.court ?? "").trim(),
  ) as { id: string } | undefined;
  if (existing) {
    database()
      .prepare("UPDATE judges SET division = ?, contact = ?, note = ? WHERE id = ?")
      .run(
        (input.division ?? "").trim().slice(0, 80),
        (input.contact ?? "").trim().slice(0, 120),
        (input.note ?? "").trim().slice(0, 500),
        existing.id,
      );
    return { id: existing.id };
  }
  const id = crypto.randomUUID();
  database()
    .prepare(
      `INSERT INTO judges (id, name, court, division, contact, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      (input.court ?? "").trim().slice(0, 120),
      (input.division ?? "").trim().slice(0, 80),
      (input.contact ?? "").trim().slice(0, 120),
      (input.note ?? "").trim().slice(0, 500),
      stamp(),
    );
  return { id };
}

export async function linkJudge(
  matterId: string,
  input: { name?: string; court?: string; role?: string },
): Promise<Failure | { id: string; text: string }> {
  await connection();
  const matter = database().prepare("SELECT status FROM matters WHERE id = ?").get(matterId) as
    | { status: string }
    | undefined;
  if (!matter) return { error: "没有这件案子。", status: 404 };
  if (matter.status === "已归档") return { error: "归档后只供查阅。", status: 409 };
  const name = (input.name ?? "").trim();
  if (!name) return { error: "请写下法官姓名。", status: 400 };
  const court = (input.court ?? "").trim();
  let judge = database()
    .prepare("SELECT id, name, court FROM judges WHERE name = ? AND (? = '' OR court = ?)")
    .get(name, court, court) as { id: string; name: string; court: string } | undefined;
  if (!judge) {
    const saved = await saveJudge({ name, court });
    if ("error" in saved) return saved;
    judge = { id: saved.id, name, court };
  }
  const role = (input.role ?? "承办法官").trim().slice(0, 40) || "承办法官";
  database()
    .prepare(
      `INSERT INTO matter_judges (matter_id, judge_id, role)
       VALUES (?, ?, ?)
       ON CONFLICT(matter_id, judge_id) DO UPDATE SET role = excluded.role`,
    )
    .run(matterId, judge.id, role);
  database()
    .prepare(
      `INSERT INTO officers (matter_id, judge, assistant, clerk, division, contact)
       VALUES (?, ?, '', '', '', '')
       ON CONFLICT(matter_id) DO UPDATE SET judge = excluded.judge`,
    )
    .run(matterId, judge.name);
  return { id: judge.id, text: `已挂上${role}：${judge.name}${judge.court ? `（${judge.court}）` : ""}。` };
}

export async function listMatterJudges(matterId: string) {
  await connection();
  return database()
    .prepare(
      `SELECT j.id, j.name, j.court, j.division, j.contact, mj.role
       FROM matter_judges mj
       JOIN judges j ON j.id = mj.judge_id
       WHERE mj.matter_id = ?
       ORDER BY mj.role, j.name`,
    )
    .all(matterId) as Array<{
    id: string;
    name: string;
    court: string;
    division: string;
    contact: string;
    role: string;
  }>;
}
