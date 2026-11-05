# agent-v3 开发计划

2026-10-25。2026-10-26 改定：先做每个案子的三栏和中栏的 agent，再设计工作台。本文件从已经走通的记录出发，定案子界面怎么收，以及记录里哪些只适合民事的部分收掉。

一个律师、一个账号、一件案子一条记录。先做每个案子的界面和流程，再设计工作台。点进一件案子就是三栏：左边材料，中间是这件案子的 agent，右边是待确认、时间提醒或出处。问答都保存在这段对话里。问答不改案件记录。agent 在本案里增删改查，一次点头写入一项。它不另存一份案子。

## 1. 目标

民事、刑事、行政用同一套页面。种类只是案子上的标签。

记录负责留下确认过的内容。案子界面负责把这一份记录摊开，并让 agent 在这一份里面办事。工作台负责到期、实收，以及还没挂到案子上的对话，版面等案子界面走通后再设计。agent 办案时读律师打开的这一份记录。生成文书、分析法律问题或做本案判断时，有必要就查北大法宝，律师也可以选择查或不查。都只通过律师点头写回这一份记录。工作台不读其他案子。

关掉中间的 agent、检索、起草，从草稿走到归档仍然成立。

## 2. 记录

状态线不变：

```
草稿 → 待立案 → 办理中 → 结案中 → 已结案 → 已归档
```

草稿、待立案、办理中可以改为已终止。已归档可以解档，回到已结案。

待立案的意思是律师已经建档、还没开始办。页面上写明这句话。它不是法院立案，也不是公安机关立案。这说的是案子走到哪一步。洽谈时证据还不确定能不能赢，也可以在这件案子上讨论。讨论和留下都不把状态改成办理中。

点进案子不再以概览、材料、待办、文书、归档做入口。这些内容分别落在左栏、右栏和结案里。案子一旦创建，点进去就是三栏，不接到「办理中」才出现。

### 工作台

工作台后做。现在先维持已有的到期、实收和未挂案子的对话，不在这一阶段改它的版面。

工作台在案子外面。上面是到期和实收，下面是对话历史。每段对话都能找回，也能接着问。

输入框旁由律师点选这一轮的用法。工作台可以选问答或直接检索。分析成文可以在对话里出稿，留下文书之前必须先有案子。

选了问答，却是在问法条或案例时，先提示改去直接检索。律师仍要问答，回答照样保存，法条和案号标未经核对，不能拿去定稿。

直接检索只把候选放在右侧。候选不入库。还没挂案子时，勾选会先要求建成案子。

律师点「建成案子」并点明客户后，只把这段对话的 `threads.matter_id` 补上。对话里看得出的当事人、案由、基本事实，作为待确认的稿子，点头才写入。也可以开一张空卡建案。丢文本只负责预填，不是创建的前提。

工作台不读取全部案子的材料，也不在这里改某一件已经存在的案子。

v3 使用自己的新库 `data/v3.sqlite`，不打开、不迁移 `data/law.sqlite`。旧库留给当前这一版。新库启动时是空的，不写入旧的种子案件。材料原件放在 `data/v3-files/`。一个案子一个库不做，全部案子仍在这一个新库里。

### 概览

留下客户、对方、办案机关、案由、基本事实、委托事项、种类、程序、案号。现在当事人第三列的文案是「法院」，改为「办案机关」。检察院、公安机关、复议机关放在这一列。

诉讼地位由律师填写，不再限定原告、被告、第三人、上诉人、被上诉人。

种类沿用现在的民事、刑事、行政诉讼、非诉专项、法律顾问、其他。种类不切换页面，不切换期限算法，不切换文书结构。

客户必须律师点明。材料里写着原告或被告人，不会自动建成客户。

已有的承办法官、审级、程序、另开下一程序留在概览，由律师填写。审级和程序允许律师写下清单以外的名称，例如侦查、审查起诉、复议、速裁、死刑复核。另开下一程序仍是一件新草稿，原案状态不变。

### 材料

原件永远留着。证明对象由律师写。

文字分三种状态：

| 状态 | 含义 |
| --- | --- |
| 没有可用文字 | 只有原件。模型只知道文件名、种类和证明对象 |
| 待核对 | 机器读出了文字，还不是事实 |
| 可用文字 | 律师看过或改过。模型和检索可以用 |

读错的字停在该材料旁边。不进基本事实，也不进已留下的要点。

### 待办

一条待办只有名称和到期日。确认后先在本案右栏提醒：九十天内或已经过期的标出来，已过期写明已过期。工作台的到期和提示是同一批待办的汇总，等工作台那一阶段再排。

法定期间不再由系统计算。答辩、上诉、保全那套推算，以及从裁判送达日、生效日带入期限，从案子里拿掉。裁判日期、送达日、生效日可以继续记在裁判文书上，只作为记录。

实收律师费按案子留下，计入工作台。不记应收：阶段性风险代理，应收事先定不下来。诉讼时效按三年推算、利息、财产案件受理费，从待办页拿掉。

结案时每条待办仍要写下处理结果。

### 文书

检索从本案中栏发起。生成文书、分析法律问题或做本案判断时，有必要就查北大法宝；律师也可以指定这一轮查，或指定不查。这一问就是检索问题。勾选出处后，这一问成为焦点并确认。焦点和出处在右栏看得见。不必另开文书页写好焦点才能检索。

自动抽出「请求、事实、金额、日期」拿掉，包括按工程名称、签证、金额、日期给句子分类。律师在本案里留下的要点记在这件案子上。要点不是检索和起草的闸门。

北大法宝的候选不入库。律师勾选后，原文快照收进本案，挂在对应焦点下。

起草和分析法律问题都只用已经勾选的法条和案例。agent 少做自己的判断：不自己选定诉请、胜负或文书结构，把依据摊给律师。正文里的法条和案号逐条核对。对不上、又查不到的，标为疑似编造，这一版不能定稿。定稿不改变案件状态。

文书种类由律师填写。给模型的结构不再写死民事起诉状、原被告和致送法院。

### 归档

有实际办结结果，律师写下日期和具体情况，才进入结案中。办结结果由律师写。生效裁判、委托终止可以留在清单里。和解、撤诉不必单独占一项。

每条待办写下处理结果，保存并确认结案说明，再单独归档。归档后记录只供查阅。中栏可以继续问答，不能留下操作。解档回到已结案，更正后再归档。

## 3. 数据结构

只建下面这些表。不建要素表，不建法定期间的起算和推算字段，不建北大法宝候选表。一段对话写入 `threads`，每一轮写入 `messages`。还没点留下的操作不写入案件记录。

日期都是 `YYYY-MM-DD`。金额以元计，两位小数。空字符串表示还没填。`confirmed_at`、`archived_at` 为空表示还没确认。

```sql
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE matters (
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
  created_at TEXT NOT NULL
);

CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  role TEXT NOT NULL CHECK (role IN ('client', 'opposing', 'organ')),
  name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  client_id TEXT REFERENCES clients(id)
);

CREATE TABLE officers (
  matter_id TEXT PRIMARY KEY REFERENCES matters(id),
  judge TEXT NOT NULL DEFAULT '',
  assistant TEXT NOT NULL DEFAULT '',
  clerk TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT ''
);

CREATE TABLE materials (
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

CREATE TABLE rulings (
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

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  name TEXT NOT NULL,
  due_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  kind TEXT NOT NULL CHECK (kind IN ('时间线', '待核清单', '路径')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE focuses (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  body TEXT NOT NULL,
  position INTEGER NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sources (
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

CREATE TABLE drafts (
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

CREATE TABLE closings (
  matter_id TEXT PRIMARY KEY REFERENCES matters(id),
  outcome TEXT NOT NULL,
  outcome_on TEXT NOT NULL,
  outcome_note TEXT NOT NULL,
  statement TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  archived_at TEXT
);

CREATE TABLE task_resolutions (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  matter_id TEXT NOT NULL REFERENCES matters(id),
  result TEXT NOT NULL CHECK (result IN ('已完成', '不再适用')),
  note TEXT NOT NULL DEFAULT '',
  resolved_at TEXT NOT NULL
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  matter_id TEXT REFERENCES matters(id),
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  role TEXT NOT NULL CHECK (role IN ('lawyer', 'model')),
  mode TEXT NOT NULL CHECK (mode IN ('问答', '直接检索', '分析成文')),
  body TEXT NOT NULL,
  proposal_kind TEXT NOT NULL DEFAULT '' CHECK (proposal_kind IN (
    '', '时间线', '待核清单', '路径', '文书底稿', '待办', '基本事实', '委托事项', '证明对象', '当事人', '案由'
  )),
  proposal_body TEXT NOT NULL DEFAULT '',
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE dossier_items (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES matters(id),
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  ref_id TEXT,
  position INTEGER NOT NULL
);
```

`parties.role` 的 `organ` 在页面上写成办案机关。`position` 是律师填写的诉讼地位。

`materials.read_text` 是机器读出的副本，对应待核对。`usable_text` 是律师确认后的文字。没有可用文字时两栏都空。模型和检索只读 `usable_text`。

`rulings` 只记裁判文书上的日期和结果，不参与待办计算。

`notes` 只在律师点留下时写入。`drafts.kind` 由律师填写，不限定文书种类。`drafts.source_ids` 和 `warnings` 存这一版用到的出处和核对结果。

`threads.matter_id` 为空表示这段对话还在工作台。建成案子时只补这一栏，不改已经写下的其他记录。`messages` 都挂在一段对话上。`mode` 是律师为这一轮点的用法。`proposal_kind` 为空表示这一轮没有待写入的稿子。有种类时，`proposal_body` 停在待确认。`accepted_at` 为空表示还没留下。律师在留下前改过的稿子，写在 `proposal_body` 里。

`sources` 只存律师勾选后的原文快照。检索候选留在服务端内存里，过期即弃。

归档时按当时的材料、要点、出处、文书版本、待办和结案说明生成 `dossier_items`。问答不生成目录行。解档删掉该案的目录行，不删其他表，也不删问答。

## 4. 材料怎么读

不是每份材料都读成文字。原件是证据。读出的文字是副本。

- 本来就是文字的，放进来时可以读出，状态为待核对。律师确认后成为可用文字。现在只收 `.txt`。这一版仍先收文本。PDF、Word 以后再加，加上之后也先落在待核对。
- 照片、扫描件、手写先只存原件，状态为没有可用文字。律师指定某一份时再读。读不出、读得断续，不补一句完整的话。
- 录音只存原件。转写若要做，结果是另一份待核对文字。录音仍是证据。

这一版不接图片识别和录音转写。页面先把「没有可用文字」和「指定后再读」留出来。

## 5. 案子界面

点进一件案子，就是这三栏。名称旁边写状态和种类。草稿、待立案、办理中、结案中、已结案、已终止、已归档都从这里进。打开案子、问答、点留下，都不改变案件状态。窄屏改成上下三截：材料、对话、待确认，三截都能点到。

洽谈时律师还不确定现有证据是否扎实、能不能赢，就在这件案子的中栏问。agent 按本案已有材料回答。

已归档可以再问答。已留下的结果和对话都还在。不能检索后勾选，不能分析成文，也不能增删改。解档回到已结案之后可以再办。

### 左栏

本案材料，标出文字状态。丢进一份材料、打开、确认读出的文字，都在这一栏。客户、对方、办案机关、案由、实收收在名称下面，律师自己改。诉讼地位仍由律师填写。

### 中栏

中栏是这件案子的 agent。它理解这一份记录：材料、当事人、待办、要点、焦点和出处、文书、结案。它只在这一件案子里办事，不读别的案子。

查随时可以。增、改、删走本案自己的接口，先停在右栏，律师点头才落库。删也单独点头。它不另存一份案子。

它能办的事：

- 时间线、待核清单、路径
- 一条待办，只有名称和到期日，并按到期日在右栏提醒
- 基本事实、委托事项、证明对象、当事人、案由的修改
- 文书底稿

生成文书、分析法律问题或做本案判断时，有必要就查北大法宝，律师也可以指定查，或指定不查。法宝只提供法条和案例，不提供当事人的事实。事实只来自可用文字和律师留下的基本事实。agent 少做自己的判断：不自己选定诉请、胜负或文书结构，把法条和案例摊给律师。没有勾选出处时，不把法条和案号写成依据。

问答仍只读可用文字，以及律师写的证明对象、基本事实和委托事项。问法条或案例时先去查法宝。律师坚持只问答，回答保存，法条和案号标未经核对，不能拿去定稿。

待核对的文字若被用到，相关句子标「待核实」，并且这一轮操作不能留下。没有可用文字的材料只提供文件名、种类和证明对象。

下一步只填好下一句，不执行，也不改记录。

每一轮都写入 `messages`。刷新后还在。问答本身不改基本事实、要点、待办或文书。

### 右栏

没有检索候选时，右边是待确认、已留下，以及本案已确认待办的时间提醒。九十天内或已经过期的标出来。进行中可以空着。

有检索候选时，右边换成出处，律师勾选或筛掉。候选不入库。勾选后的原文快照写入 `sources`，这一问成为焦点。

律师要结案时，右边换成办结结果、每条待办的处理、结案说明和归档。归档后右边是目录。

操作先停在待确认，刷新后还在。留下或放弃都只针对这一项。点留下，才写入：

- 时间线、待核清单、路径，写入 `notes`
- 文书底稿写入 `drafts`，随后仍走核对和定稿。对不上、又查不到的，标为疑似编造，这一版不能定稿。稿子在对话旁边改，律师改过的字才是留下的正文
- 待办写入 `tasks`。确认后才进入本案的时间提醒
- 基本事实、委托事项、证明对象、当事人、案由，按律师点头的稿子改这件案子

状态、客户、材料是否成为可用文字、实收、归档，由律师在左栏或右栏自己做。agent 不改。这一段对话里的后续写入，不因为批准过一次就免掉下一次点头。

模型仍只在 `lib/model.ts` 里调用，密钥仍是 `.env` 的 `DEEPSEEK_API_KEY`。本案把这一段对话和这一份记录交给它。它不连接数据库，不自己持有北大法宝或企查查的密钥。要查法宝时，由本案的 agent 调用 `lib/pkulaw.ts`。

## 6. 外面的服务

| 服务 | 放在哪 | 写入 |
| --- | --- | --- |
| 企查查 | 只在创建卡。仍只准备在 `lib/qcc.ts` | 律师点明客户并创建之后，才有案子。这一版可以仍不接入 |
| 北大法宝 | 生成文书、分析法律问题或做本案判断时，有必要就查；律师也可以指定查或不查。仍只在 `lib/pkulaw.ts` | 候选不入库。勾选后的原文快照写入出处 |
| 模型 | 本案中栏的 agent。仍只在 `lib/model.ts` | 问答写入这段对话。点留下才写入要点、待办、本案修改或文书版本 |

检索句继续去掉本案当事人名称、证件号、电话和地址。没列进当事人的人，靠律师在检索句里不写姓名。

创建有三条路，都要律师点明客户。开一张空卡，自己填写。丢进一份文本，创建卡按读出的内容预填，每个读出的人单独一行，不把其余人用顿号收成一个对方。读不出当事人、案由或请求的，卡片空着。或者从一段工作台对话点「建成案子」。不点明客户不创建。

## 7. 不做

不按民事、刑事、行政拆三套页面、三套期限或三套文书结构。

不把照片、手写、录音自动读成事实。

不把待核对的文字写入基本事实或要点。

不为每个案子计算诉讼时效、利息、财产案件受理费。

不把法定期间算成待办。

不把问答直接写成基本事实、要点、待办或文书。

生成文书和分析法律问题时，不由模型凭空作法律判断。查不查北大法宝，可以由这一轮的需要决定，律师也可以指定。不把下一步自动执行。不因一次点头，就批准这段对话里后面的写入。

agent 不另存一份案件，也不跨案子检索或改写。

工作台不扫全部案子，也不在工作台改某一件已经存在的案子。

不做批量审表，不做写作风格库，不做网页检索。

仍不做：利冲、审批盖章、工时账单、人事会议室。

## 8. 开发顺序

沿用示踪弹。每一条都从律师能点的页面，写到这一份记录，再在页面上看得见。这一条没走通，不开下一条。第 1 条到第 12 条是记录层，已经走通。下一阶段先改案子界面和中栏的 agent，工作台的版面排在这之后。

| 条 | 律师做的事 | 记录上留下什么 | 走通的样子 |
| --- | --- | --- | --- |
| 1 | 开一张空卡，点明客户并创建；也可以丢文本预填 | 一件草稿 | 不丢文本也能创建。丢文本时每人一行，读不出就空着。不点明客户不创建，不猜客户 |
| 2 | 放入一份文字材料，并确认读出的文字 | 原件在，文字先待核对，确认后成为可用文字 | 未确认时，材料上写待核对。确认后写可用文字 |
| 3 | 填写诉讼地位，并把第三列当作办案机关 | 当事人按律师写的地位保存 | 刑事的被告人、行政的复议机关可以写下。种类不改变这一页 |
| 4 | 记下一条只有名称和日期的待办，并确认；记下实收 | 待办和实收挂在本案 | 确认后的待办出现在工作台到期里。实收计入工作台。页面上不再推算答辩、上诉、保全，也不再计算时效、利息、受理费，也不记应收 |
| 5 | 在工作台新开一段对话，选问答，再追问一句 | 一段 `threads` 和其中的 `messages`，不挂案子 | 历史里能找回，也能接着问。问法条时先提示改去直接检索。坚持问答的，法条和案号标未经核对 |
| 6 | 把这段对话建成案子，并点明客户 | 对话挂上新草稿。看出的当事人、案由、基本事实停在待确认 | 点头才写入。不点头，案子仍是空卡加这段对话。状态不变 |
| 7 | 点进草稿或待立案，选问答，问证据够不够，再点一个下一步 | 问答写在这段对话里 | 下一步只填好下一句，不执行。只用可用文字。基本事实不被这轮改写。状态不变 |
| 8 | 留下时间线、待核清单，再留下路径 | 写入 `notes` | 先停在待确认，一次留下一项。待核对的句子标待核实，留下不可用。路径可以民事、刑事、行政并列，都标待核验 |
| 9 | 让它提出一条待办，或改基本事实、委托事项、证明对象 | 点头的那一项写入待办或概览 | 刷新后待确认还在。批准这一项，不连带批准下一项。状态、客户、可用文字、归档都不由模型改 |
| 10 | 选直接检索，在右侧勾选出处 | 这一问成为焦点。勾选的原文写入 `sources` | 候选不入库。没勾的不留下。打开页面不自己查法宝 |
| 11 | 选分析成文，在对话旁改稿，再留下 | 新的文书版本写入 `drafts` | 只用勾选的出处。律师改过的字在留下的稿子里。对不上又查不到的标疑似编造，不能定稿。定稿不改变状态。文书种类由律师填写 |
| 12 | 写下办结结果，处理每条待办，确认结案说明，再归档 | 结案说明和目录 | 归档后可以问答，不能检索后勾选，不能分析成文，不能留下操作。解档回到已结案后可以再操作 |

下一阶段，仍一条一条走。先做界面，再把 agent 接到这三栏上。

| 条 | 律师做的事 | 记录上留下什么 | 走通的样子 |
| --- | --- | --- | --- |
| 13 | 点进一件案子 | 不新写记录 | 直接是三栏。左栏是材料，中栏是这件案子的对话，右栏是待确认和已确认待办的到期。没有概览、材料、待办、办理、归档五条入口。窄屏上下排开，没有横向溢出 |
| 14 | 在中栏让 agent 查这件案子，并提出一项增改或删除 | 点头的那一项写入本案 | 没点头，库不变。点头只写入这一项。状态、客户、可用文字、实收、归档都不由它改 |
| 15 | 让它记一条待办，或看已有待办的到期 | 待办仍只有名称和到期日 | 确认后的待办在右栏提醒。九十天内和已过期看得见。未确认的不进提醒。这一步不改工作台 |
| 16 | 让它分析一个法律问题，或写成一份文书 | 勾选的出处和留下的文书版本 | 有必要就查北大法宝，律师也可以指定查或不查。候选在右栏，没勾的不入库。文书和判断只用勾上的法条和案例。它不自己选定诉请、胜负或文书结构 |

第 13 条到第 16 条已经走通。工作台的版面还没设计。

v3 只读写 `data/v3.sqlite`。旧库里的案子、待办和要素不导入。

## 9. 这一版先不接

图片识别、录音转写、PDF 和 Word。左栏里这些材料保持没有可用文字。

企查查。创建卡仍只显示文本里读出的统一社会信用代码。

跨案件办事。agent 和工作台都不跨案件读取或改写。
