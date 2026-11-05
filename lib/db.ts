import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const globalForDb = globalThis as unknown as { v3Db?: DatabaseSync };

export const dataDir = path.join(process.cwd(), "data");
export const dbPath = path.join(dataDir, "v3.sqlite");

const schema = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS matters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    '草稿', '待立案', '办理中', '结案中', '已结案', '已归档', '已终止'
  )),
  category TEXT NOT NULL DEFAULT '',
  cause TEXT NOT NULL,
  facts TEXT NOT NULL,
  mandate TEXT NOT NULL,
  case_number TEXT NOT NULL DEFAULT '',
  instance TEXT NOT NULL DEFAULT '',
  procedure TEXT NOT NULL DEFAULT '',
  parent_matter_id TEXT REFERENCES matters(id),
  fee_received REAL,
  created_at TEXT NOT NULL,
  opened_at TEXT
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  role TEXT NOT NULL CHECK (role IN ('client', 'opposing', 'organ')),
  name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  client_id TEXT REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS officers (
  matter_id TEXT PRIMARY KEY REFERENCES matters(id),
  judge TEXT NOT NULL DEFAULT '',
  assistant TEXT NOT NULL DEFAULT '',
  clerk TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  filename TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  proves TEXT NOT NULL DEFAULT '',
  submitted_by TEXT REFERENCES parties(id),
  text_status TEXT NOT NULL CHECK (text_status IN ('没有可用文字', '待核对', '可用文字')),
  read_text TEXT NOT NULL DEFAULT '',
  usable_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (matter_id, filename)
);

CREATE TABLE IF NOT EXISTS rulings (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  material_id TEXT NOT NULL UNIQUE REFERENCES materials(id),
  kind TEXT NOT NULL DEFAULT '',
  decided_on TEXT NOT NULL DEFAULT '',
  served_on TEXT NOT NULL DEFAULT '',
  effective_on TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  name TEXT NOT NULL,
  due_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  kind TEXT NOT NULL CHECK (kind IN ('时间线', '待核清单', '路径')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS focuses (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  body TEXT NOT NULL,
  position INTEGER NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  focus_id TEXT NOT NULL REFERENCES focuses(id),
  kind TEXT NOT NULL CHECK (kind IN ('law', 'case')),
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  retrieved_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  UNIQUE (focus_id, source_id)
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  source_ids TEXT NOT NULL,
  warnings TEXT NOT NULL,
  final INTEGER NOT NULL DEFAULT 0,
  based_on INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (matter_id, version)
);

CREATE TABLE IF NOT EXISTS closings (
  matter_id TEXT PRIMARY KEY REFERENCES matters(id),
  outcome TEXT NOT NULL,
  outcome_on TEXT NOT NULL,
  outcome_note TEXT NOT NULL,
  statement TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS task_resolutions (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  matter_id TEXT NOT NULL REFERENCES matters(id),
  result TEXT NOT NULL CHECK (result IN ('已完成', '不再适用')),
  note TEXT NOT NULL DEFAULT '',
  resolved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  matter_id TEXT REFERENCES matters(id),
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  role TEXT NOT NULL CHECK (role IN ('lawyer', 'model')),
  mode TEXT NOT NULL CHECK (mode IN ('问答', '直接检索', '分析成文')),
  body TEXT NOT NULL,
  proposal_kind TEXT NOT NULL DEFAULT '' CHECK (proposal_kind IN (
    '', '时间线', '待核清单', '路径', '文书底稿', '待办', '基本事实', '委托事项', '证明对象', '当事人', '案由', '节点'
  )),
  proposal_body TEXT NOT NULL DEFAULT '',
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dossier_items (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  ref_id TEXT,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  happened_on TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS judges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  court TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matter_judges (
  matter_id TEXT NOT NULL REFERENCES matters(id),
  judge_id TEXT NOT NULL REFERENCES judges(id),
  role TEXT NOT NULL DEFAULT '承办法官',
  PRIMARY KEY (matter_id, judge_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  kind TEXT NOT NULL CHECK (kind IN ('合同审查', '制度审查')),
  title TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  stance TEXT NOT NULL DEFAULT '',
  scale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_review_cards (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id),
  position_label TEXT NOT NULL,
  result_type TEXT NOT NULL CHECK (result_type IN ('修改', '提示')),
  is_red_line INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  comment TEXT NOT NULL,
  original_text TEXT NOT NULL,
  revision TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_sheets (
  matter_id TEXT PRIMARY KEY REFERENCES matters(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_rows (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  happened_on TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pleadings (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  kind TEXT NOT NULL CHECK (kind IN ('民事起诉状', '民事上诉状', '答辩状', '代理词')),
  slots TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '',
  warnings TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('缺槽位', '已成文')),
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;

function openDatabase() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "v3-files"), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(schema);
  const matterCols = db.prepare("PRAGMA table_info(matters)").all() as Array<{ name: string }>;
  if (!matterCols.some((col) => col.name === "opened_at")) {
    db.exec("ALTER TABLE matters ADD COLUMN opened_at TEXT");
  }
  db.prepare(
    `UPDATE materials
     SET usable_text = read_text, text_status = '可用文字'
     WHERE text_status = '待核对' AND read_text != ''`,
  ).run();
  ensureHistoryColumns(db);
  ensureNodeProposal(db);
  return db;
}

function ensureNodeProposal(db: DatabaseSync) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'").get() as
    | { sql: string }
    | undefined;
  if (row?.sql.includes("'节点'")) return;
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE messages_next (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      role TEXT NOT NULL CHECK (role IN ('lawyer', 'model')),
      mode TEXT NOT NULL CHECK (mode IN ('问答', '直接检索', '分析成文')),
      body TEXT NOT NULL,
      proposal_kind TEXT NOT NULL DEFAULT '' CHECK (proposal_kind IN (
        '', '时间线', '待核清单', '路径', '文书底稿', '待办', '基本事实', '委托事项', '证明对象', '当事人', '案由', '节点'
      )),
      proposal_body TEXT NOT NULL DEFAULT '',
      accepted_at TEXT,
      created_at TEXT NOT NULL
    )`);
    db.exec(
      `INSERT INTO messages_next (
        id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      )
      SELECT id, thread_id, role, mode, body, proposal_kind, proposal_body, accepted_at, created_at
      FROM messages`,
    );
    db.exec("DROP TABLE messages");
    db.exec("ALTER TABLE messages_next RENAME TO messages");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.exec("PRAGMA foreign_keys = ON");
    throw error;
  }
  db.exec("PRAGMA foreign_keys = ON");
}

function ensureHistoryColumns(db: DatabaseSync) {
  const cols = db.prepare("PRAGMA table_info(threads)").all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === "history_note")) {
    db.exec("ALTER TABLE threads ADD COLUMN history_note TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.some((col) => col.name === "history_note_until")) {
    db.exec("ALTER TABLE threads ADD COLUMN history_note_until TEXT NOT NULL DEFAULT ''");
  }
  const materialCols = db.prepare("PRAGMA table_info(materials)").all() as Array<{ name: string }>;
  if (!materialCols.some((col) => col.name === "note")) {
    db.exec("ALTER TABLE materials ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  }
}

export function database() {
  if (!globalForDb.v3Db) globalForDb.v3Db = openDatabase();
  ensureHistoryColumns(globalForDb.v3Db);
  ensureNodeProposal(globalForDb.v3Db);
  globalForDb.v3Db.exec(
    `CREATE TABLE IF NOT EXISTS timeline_sheets (
      matter_id TEXT PRIMARY KEY REFERENCES matters(id),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timeline_rows (
      id TEXT PRIMARY KEY,
      matter_id TEXT NOT NULL REFERENCES matters(id),
      happened_on TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS note_imports (
      note_id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS pleadings (
      id TEXT PRIMARY KEY,
      matter_id TEXT NOT NULL REFERENCES matters(id),
      kind TEXT NOT NULL CHECK (kind IN ('民事起诉状', '民事上诉状', '答辩状', '代理词')),
      slots TEXT NOT NULL DEFAULT '{}',
      body TEXT NOT NULL DEFAULT '',
      warnings TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('缺槽位', '已成文')),
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contract_review_cards (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id),
      position_label TEXT NOT NULL,
      result_type TEXT NOT NULL CHECK (result_type IN ('修改', '提示')),
      is_red_line INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      comment TEXT NOT NULL,
      original_text TEXT NOT NULL,
      revision TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      filename TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
  );
  const reviewCols = globalForDb.v3Db.prepare("PRAGMA table_info(reviews)").all() as Array<{ name: string }>;
  if (!reviewCols.some((col) => col.name === "stance")) {
    globalForDb.v3Db.exec("ALTER TABLE reviews ADD COLUMN stance TEXT NOT NULL DEFAULT ''");
  }
  if (!reviewCols.some((col) => col.name === "scale")) {
    globalForDb.v3Db.exec("ALTER TABLE reviews ADD COLUMN scale TEXT NOT NULL DEFAULT ''");
  }
  const pleadingSql = globalForDb.v3Db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pleadings'")
    .get() as { sql: string } | undefined;
  if (pleadingSql && !pleadingSql.sql.includes("'答辩状'")) {
    globalForDb.v3Db.exec("PRAGMA foreign_keys = OFF");
    globalForDb.v3Db.exec(`
      CREATE TABLE pleadings_next (
        id TEXT PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matters(id),
        kind TEXT NOT NULL CHECK (kind IN ('民事起诉状', '民事上诉状', '答辩状', '代理词')),
        slots TEXT NOT NULL DEFAULT '{}',
        body TEXT NOT NULL DEFAULT '',
        warnings TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('缺槽位', '已成文')),
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO pleadings_next (id, matter_id, kind, slots, body, warnings, status, version, created_at)
      SELECT id, matter_id, kind, slots, body, warnings, status, version, created_at FROM pleadings;
      DROP TABLE pleadings;
      ALTER TABLE pleadings_next RENAME TO pleadings;
    `);
    globalForDb.v3Db.exec("PRAGMA foreign_keys = ON");
  }
  return globalForDb.v3Db;
}
