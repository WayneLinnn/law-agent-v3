# AlphaGPT 法律咨询 Pro

记录 2026-10-25 打开的页面：

`https://gpt.alphalawyer.cn/#/AlphaGPT/index?appId=LAW_SEARCH_COLUMN&tab=BUSINESS_EFFECT`

这是 iCourt Alpha 里的 AlphaGPT。当前落在「法律咨询 Pro」首页。页头文案是「层层拆解，直达方案」。产品自己的说明是：让 Pro 智能拆解任务、协同专业能力，形成完整解决方案。页脚声明生成内容仅供参考，不代表 iCourt 立场，不构成正式法律意见。

本文只记界面上能用到的功能和前后端怎么配合。没有实际提交咨询，避免消耗账号算力。回答页是同一前端路由里已经写好的交互，不是某一次真实生成的结果。

## 壳怎么拼起来

浏览器里看到的是三层。

1. 最外层是 React 宿主，用 qiankun 挂载名为 `main` 的微应用（页面上的版本号是 2.9.2）。
2. 微应用是 AngularJS，路由状态叫 `AlphaGPT.index`。地址栏的 `appId`、`tab` 由它接收。
3. 每个具体能力再开一个 iframe。法律咨询 Pro 的 iframe 是 `CHAT_COLUMN_iframe_name`，地址是 `https://gpt.alphalawyer.cn/similar-web/#/casePro`。

`tab=BUSINESS_EFFECT` 是这个工作台的默认业务页签。壳里跳进 AlphaGPT 时，默认就是 `appId=LAW_SEARCH_COLUMN`、`tab=BUSINESS_EFFECT`。它不是咨询页内部的子标签。

iframe 里是 Vue 3.5.13，路由用 hash，状态用 Pinia，组件库是 Ant Design Vue。和本页直接相关的 store：

| store | 管什么 |
| --- | --- |
| `case-pro-home-store` | 首页附件、示例问题、是否有知识库权限 |
| `case-pro-memory-store` | 记忆开关是否已拉取、当前是否开启 |
| `case-pro-detail-store` | 回答页的会话、任务计划、参考资料、生成状态 |

请求成功时后端包一层 `{ isSuccess, resultMsg, data }`。`isSuccess === false` 时前端把 `resultMsg` 抛出来，页面上直接提示。流式接口另走 SSE，不走这层 JSON。

## 左侧能进哪些能力

侧栏分组来自当前账号的产品权限，渲染成菜单。点一项就显示对应 iframe，其余 iframe 先空着，点到才加载。

| 分组 | 菜单 | appId | iframe 页面 |
| --- | --- | --- | --- |
| AI法律检索 | 法律咨询 Pro | `LAW_SEARCH_COLUMN` | `similar-web/#/casePro` |
| AI法律检索 | 类案检索 Pro | `SIMILAR_CASE_GPT_COLUMN` | `similar-web/#/similarGpt/index` |
| AI法律审查 | 合同审查 | `CONTRACT_REVIEW_COLUMN` | `gpt-contract-review/#/main/review` |
| AI法律审查 | 模板审查 | `TEMPLATE_REVIEW_COLUMN` | 同上，权限不同 |
| AI法律审查 | 补充协议审查 | `AGREEMENT_REVIEW_COLUMN` | 同上 |
| AI法律审查 | 制度审查 | `REGULATION_REVIEW_COLUMN` | 同上 |
| AI法律审查 | 合同比对审查 | `CONTRACT_COMPARE_REVIEW_COLUMN` | 同上 |
| AI法律文书 | 文书起草 | `WRITING_DRAFT_COLUMN` | `gpt-writing/#/` |
| AI法律文书 | 要素式文书起草 | `WRITING_TABLE_GPT_COLUMN` | `gpt-writing/#/` |
| AI法律文书 | 合同起草 | `CONTRACT_DRAFT_GPT_COLUMN` | `gpt-writing/#/` |
| AI法律文书 | 法律意见 | `CASE_GPT_COLUMN` | `similar-web/#/caseGpt/index`（侧栏当前折叠，不在首屏） |
| AI法律阅卷 | 法律阅卷 | `DOC_GPT_COLUMN` | `alphadoc.alphalawyer.cn/#/main` |
| AI应用商店 | 专项阅卷 | `ADVANCED_LEVEL_DOC_GPT_COLUMN` | `alphadoc.alphalawyer.cn/#/v3-main` |
| AI应用商店 | 法治体检 | `LEGAL_EXAMINATION_COLUMN` | `legal-examination/#/` |
| AI应用商店 | 深度报告 | `DEEP_REPORT_COLUMN` | `gpt-layout/#/business/deep-report/home?inline=true` |
| AI应用商店 | 证据阅卷 | `EVIDENCE_REVIEW_COLUMN` | `evidence-review/` |

法律咨询这一列在权限数据里还挂着几种子能力，首页默认走咨询 Pro（`CHAT_PRO`）：进阶分析、咨询 Pro、法律咨询快捷版、法研全析、法律咨询实务版、DS 满血版专线。当前这块首页只露出 Pro。

顶栏还有：

- **历史记录**：打开历史抽屉，按标题搜索，分页加载这一产品的会话。
- **切回旧版**：回到旧咨询，并把当前草稿交接过去。
- **记忆**：开关。咨询提交时会把当前状态写进 `enableMemory`。
- **免费领算力 / 试用 AlphaClaw**：试用和领取入口，不参与咨询本身。
- **1 分钟上手法律咨询 Pro**：向 `GET /ai/api/v1/user/operation/config` 要 `appId=CHAT_PRO` 的视频地址再打开。

侧栏底部有北京网信办独立大模型备案说明，备案号 `Beijing-AlphaGPT-202503180080`。

## 首页上有什么

路由是 `/casePro`。中间一块空态输入区。

标题逐字动画是「层层拆解，直达方案」，旁边一块橙色 PRO 标。副标题是「让 Pro 为您智能拆解任务、协同专业能力，形成完整解决方案」。

输入框占位符：「输入咨询需求，自动为您匹配技能」。空内容时发送按钮是禁用的。回车发送，框会随内容增高，大约 4 到 8 行。

输入框右侧四个动作：

| 按钮 | 作用 |
| --- | --- |
| 铅笔 | 优化提问。先改写框里的问题，改完才能发送。空问题、优化进行中、或当前状态不允许时会拦住。 |
| 回形针 | 上传附件。见下一节。 |
| 麦克风 | 语音转文字，走讯飞听写。浏览器要给麦克风权限。桌面客户端（Tauri）里不放这个按钮。 |
| 发送 | 创建一轮咨询并进入回答页。 |

输入框可以拖文件进去。桌面端拖文件时，父窗口用 `postMessage` 把文件字节送进 iframe。

### 上传

点回形针弹出三种来源：

1. **脱敏上传文件**。只收 `.doc`、`.docx`。上传时带 `secrecy`。
2. **上传源文件（本地）**。文案写支持各类文件、最多 200 个、单个不超过 100MB，可拖拽。代码实际接受的扩展名是 `.doc,.docx,.pdf,.md,.txt,.png,.jpg,.jpeg`。
3. **上传源文件（知识库）**。只有账号有知识库权限才出现，从知识库里选已有文件。

限制：

- 最多 200 个文件。
- 单个文件不超过 100MB。
- 图片不超过 7MB，最长边不超过 8192 像素。
- 文件名去掉扩展名后最多 100 个字符。
- 格式不对、过大、解析不出文字，都会在卡片上标红，不进入本次提问。

每张卡片的状态依次是：等待、上传中（带百分比）、解析中、解析成功、上传失败、解析失败、文件过大、图片过大、图片边长过大、未提取到文字。可以在发送前关掉某一张。

解析是异步的。前端把文件交给文件服务，拿到任务 id 后每 3 秒查一次结果，最多大约 201 次。解析成功后，正文长度记在这张卡片上，提交时只把解析成功且有文档 id 的附件带上。

如果有解析失败的附件还点发送，会先弹窗：「有解析失败的附件。建议先处理异常附件，以获得更完整、可靠的结果。」可以选择「完善附件」留下，或「继续提交」只带成功的那些。

### 三个场景

「您可以按照以下场景提问」下面三张图。图是接口下发的，点一下把完整问题填进输入框，不会直接发送。示例问题来自 `GET /ai/api/v1/chat/examples`，咨询 Pro 用的是 `type = 24` 这一组。

**快速法律判断。** 图上的副文案是「快速判断 · 说明适用边界」。

> 公司召开股东会会议，未通知某小股东参会就直接通过了决议，该股东能否请求法院撤销这个决议？

**复杂法律分析。** 图上的副文案是「多能力协同 · 完整分析」。

> 李某（女）与王某（男）2016年结婚，婚后育有一子（现8岁）。2024年初分居，李某2025年8月起诉离婚。
> 财产方面：婚后2018年男方父母出了60万首付、贷款200万（婚后共同还贷），在杭州买了套房登记在王某名下，现在值大概450万。王某名下还有婚后用夫妻存款50万买的未上市公司股权（现在估值120万左右）。李某名下有个股票账户婚后一直在操作，现在市值35万左右。两人银行存款加起来大概30万。还有一辆婚后买的家用轿车在王某名下，值12万左右。另外有几个情况：李某发现分居期间王某把一笔25万的定期转到了他母亲账户上；婚姻期间王某跟朋友借了50万说是投资，现在债权人起诉要求算夫妻共同债务；而且王某有出轨行为，李某手上有聊天记录和开房记录。
> 李某想争取离婚，想了解财产怎么分对自己最有利，特别是那套房子能不能归她？

**方案策略落地。** 图上的副文案是「风险深度识别 · 多维方案」。

> A公司是一家做新能源电池材料的有限公司，注册资本1,000万元（已全部实缴），目前有3个自然人股东：甲持股60%（创始人兼法定代表人）、乙持股30%（2018年以货币出资300万元认缴）、丙持股10%。公司2024年净利润约800万，净资产约2,200万。
> 现在乙想把他的30%股权全部转让给一个外部投资人丁，双方初步谈的转让价是300万元（对应公司估值1,000万）。甲书面同意放弃优先购买权。
> 但有几个复杂情况：
> 乙对A公司有50万元的股东借款没还，甲要求转让款必须先拿去还这笔钱。
> 乙名下的30%股权已经质押给了某银行（2023年借了一笔个人经营贷，还没还清），丁担心过户时质押解不了。
> 丁查了A公司的工商信息，发现有一笔对外担保500万元（为关联公司B做的连带责任担保），乙说「小事不用管」，但丁不放心。
> 丁不想一次性付全款，想留一部分钱作为交割后风险保证金。
> 乙坚持要签一份业绩承诺条款：如果A公司2025年净利润低于600万，丁要向乙补一笔钱。
> 丁委托你起草这份股权转让协议，重点解决：①交易价款怎么安排（含分期和共管）②税务怎么算、谁承担③质押怎么处理④那个对外担保怎么兜底⑤业绩承诺条款要不要签、如果签怎么设计才不会反过来坑了自己⑥整体交易结构和付款节奏怎么设计最安全？

和示例原文完全一致的提问会跳过一次使用校验。自己改过的问题要先过校验。

## 从首页到回答页

发送时前端做这几步：

1. 去掉首尾空白。空则提示「请输入内容」。
2. 附件还在上传或解析时，发送按钮不可用。
3. 有失败附件时先问要不要继续。
4. 校验当前账号能不能使用咨询 Pro。应用 id 是 `CHAT_PRO`。校验不通过就不创建任务。
5. 再读一次记忆开关。
6. `POST /alpha-ai-chat/api/v1/chat/chatPro/initTask`。
7. 拿到 `roundId` 后，路由换成 `/casePro/detail?roundId=...`。

创建任务的正文：

```json
{
  "query": "咨询原文",
  "enableMemory": true,
  "docs": [
    { "docName": "文件名", "docId": "解析任务返回的文档 id" }
  ]
}
```

追问时还会带 `roundId`，以及上一轮的 `parentChatId`。没有附件就不要空的 `docs` 项；没有文档 id 的文件不会被放进去。

返回里至少要有 `roundId`，否则提示「未获取到会话ID」。`chatId` 一并返回，回答页用它去拉流。

地址上如果已经带着 `roundId`（或旧参数 `id`），首页会直接进回答页，不停留在空输入框。

## 回答页

路由 `/casePro/detail`。进入后按 `roundId` 拉这一轮的记录，再对当前 `chatId` 开一条流。

打开流：

`POST /alpha-ai-chat/api/v1/stream/chatPro`

请求头要 `token` 和 `Content-Type: application/json`，正文是 `{ "roundId", "chatId" }`。响应必须是 `text/event-stream`。前端按 SSE 的 `data` 行解析 JSON。隐藏标签页时也保持连接（`openWhenHidden`）。停止生成时中止这条连接，并另调停止接口。

流里出现的事件名：

| 事件 | 页面上的含义 |
| --- | --- |
| `TaskPlan` | 任务被拆开，左侧出现分析步骤 |
| `ToolCallStarted` | 某一步开始调工具 |
| `ToolCallCompleted` | 这一步完成 |
| `ToolCallError` | 这一步失败 |
| `RunResponse` | 一轮运行中的回复 |
| `FinalAnswerDelta` | 最终回答逐段往外补 |
| `RunFinished` | 这一轮结束 |
| `RunCancelled` | 用户或系统取消 |
| `Error` | 出错。人多时页面写「当前使用人数较多，请重新提问～」；网络失败写「当前网络异常，请刷新后重试～」 |

进入回答页时，固定开场是：「已收到您的问题。我会依次梳理事实与争议焦点、核验现行法规、匹配相似案例并形成综合建议。」拆任务阶段显示「正在拆解咨询任务…」。每一步有「等待分析中」「正在分析中」。步骤会继续追加，页面提示可以滚动看已完成和正在进行的内容，也可以「恢复默认自动滚动」。

生成过程中能看到「思考中」、深度分析步数，以及累计检索了多少条参考法规、参考案例、参考文章，并换算成「共节省阅读 N 分钟」。

工具在界面上被翻成中文。和咨询直接相关的有：

| 工具 | 界面称呼 |
| --- | --- |
| `write_todos` | 更新任务计划 |
| `search_uploaded_docs` | 上传文件检索 |
| `read_uploaded_doc` | 读取上传文件 |
| `regulation_semantic_search` | 法规语义检索 |
| `exact_regulation_search` | 精确法条检索 |
| `law_regu_keyword_search` | 法规关键词检索 |
| `case_semantic_search` | 案例语义检索 |
| `case_keyword_search` | 案例关键词检索 |
| `practice_article_search` | 实务文章检索 |
| `wechat_public_article_search` | 公众号文章检索 |
| `web_search` | 公开网络搜索 |
| `calculate_legal_amount` | 法律金额计算 |
| `update_memory` | 更新长期记忆 |

技能文件也被标了中文名，用来说明这一步在调用哪类能力：法律咨询专家、公司法、法律金额计算、劳动争议、刑事辩护、知识产权、婚姻家事，以及判断问题类型、准备法律数据检索、确认资料查询规则、加载法规解释方法、核对金额计算依据、匹配案件案由。

「自动匹配技能」发生在服务端这一轮拆解里，首页输入框只负责把原文和附件交出去。

### 参考资料

回答右侧（窄屏时改为展开）是依据区。生成中可以收起，完成后可以「查看本轮回答依据」。资料按类筛选：全部、现行有效、行政处罚、全网来源、国家卫健、实务文章、微信公众号。

一条资料里会分块展示：法规依据、来源、法院认为、裁判结果、来源观点、参考结论、法条内容、新旧对照、法条沿革、相关案例、案例来源。法规对照会标出保留文字、删除文字、新增文字，以及「本条未修改 / 本条已删除 / 本条为新增 / 实质性修订 / 文字性调整」。

引用分成专业、通用、案例、法规。点引用去打开案例、法规或实务文章时，壳负责在 Alpha 里开对应详情，不由咨询页自己跳走。没有引用时写「当前会话暂无参考资料引用」。

### 回答页上还能做的事

- **追问**。占位符是「描述你的法律问题，或上传相关材料」。生成没结束时不能追问，要等完成或先停止。示例会话写明「当前为示例，暂不支持提问」。
- **停止**。确认框是「是否终止任务？已经生成的回答将不会显示」。可以终止，也可以继续生成。对应 `POST /alpha-ai-chat/api/v1/chat/chatPro/stop`。
- **复制、导出**。导出走 `POST /alpha-ai-chat/api/v1/chat/chatPro/download`。
- **反馈**。问「这次回答解决了你的问题吗？」，四档是「问题较明显、体验有提升空间、能够满足需求、充分满足需求」，可再写补充原因，最多一段文字。稍后反馈或提交。同一回答不重复收。
- **推荐追问**。「接下来，你可以继续问」。点一条会当作新的追问。
- **返回首页**。生成还在跑时，提示返回后任务会继续，稍后到历史记录里看。

历史列表：

`POST /alpha-ai-chat/api/v1/chat/chatPro/rounds`

```json
{ "pageIndex": 1, "pageSize": 20, "title": "搜索词，可空" }
```

返回 `data.records` 和 `data.total`。滚到底再要下一页。搜索框输入停 1 秒再查。删除一条是 `POST /alpha-ai-chat/api/v1/chat/chatPro/round/delete`。改标题是 `POST /alpha-ai-chat/api/v1/chat/chatPro/title/update`，批量标题是 `POST /alpha-ai-chat/api/v1/chat/chatPro/title/batch`。

打开某一轮的消息正文：

`POST /alpha-ai-chat/api/v1/chat/chatPro/records`

这一轮用到的引用来源：

`POST /alpha-ai-chat/api/v1/chat/chatPro/sources`

## 接口一览

下面都是法律咨询 Pro 这条链路上前端会打的接口。主机是 `https://gpt.alphalawyer.cn`。除文件解析外，聊天接口都在 `/alpha-ai-chat` 或 `/ai` 下面。

| 方法 | 路径 | 谁在用 | 要点 |
| --- | --- | --- | --- |
| GET | `/ai/api/v1/chat/examples` | 首页 | 按 type 分组的示例。咨询 Pro 读 `24`。每条有 `id`、`question`、`icon` |
| GET | `/ai/api/v1/chat/personalization/memory/enabled` | 首页、顶栏记忆 | 返回是否开启。`false` 才关掉，失败时保持默认开启 |
| POST | `/ai/api/v1/chat/personalization/save` | 记忆设置 | 保存个性化记忆 |
| GET | `/ai/api/v1/user/operation/config` | 「1 分钟上手」 | 取 `CHAT_PRO` 的视频地址 |
| POST | `/ai-file/api/v1/file/parsing/by/file` | 上传 | `multipart`：`version=v1`、`tempFileName`、`file` 或 `fileUrl`、`uploadOss=false`，脱敏再加 `secrecy`。应用 id 用会话里的二级 id，缺省是 `LAW_SEARCH_COLUMN` |
| GET | `/ai-file/api/v1/file/parsing/result/query?id=` | 上传 | 每 3 秒一次，直到 `data.code === 200` 或超时。成功返回抽出的正文 |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/initTask` | 发送、追问 | 见上一节正文。成功数据里要有 `roundId` |
| POST | `/alpha-ai-chat/api/v1/stream/chatPro` | 回答页 | SSE。正文 `{ roundId, chatId }` |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/stop` | 停止生成 | 终止当前任务 |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/rounds` | 历史 | 分页和标题搜索 |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/records` | 回答页 | 一轮里的消息 |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/sources` | 依据区 | 法规、案例、文章等引用 |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/download` | 导出 | 下载这一轮 |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/title/update` | 历史 | 改一条标题 |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/title/batch` | 历史 | 批量标题 |
| POST | `/alpha-ai-chat/api/v1/chat/chatPro/round/delete` | 历史 | 删除。确认文案写明无法撤回 |

壳在进入页面时还会为自己拉权限和账号，例如 `GET /ai/api/v1/user/product/permission`（决定侧栏有哪些入口）、`GET /ai/api/v1/user/valid`、`GET /ai/api/v1/chat/personalization/memory/enabled`。这些不产生咨询内容。

语音另有 `GET /ai/api/v1/config/xf/iat`，给讯飞听写用。

## 新旧版草稿

切回旧版，或从旧版切回来，草稿放在 `localStorage`，键名 `alpha_legal_consult_draft_handoff_v1`，一小时过期。结构是：

```json
{
  "app": "casePro 或 legacy",
  "text": "输入框里的字",
  "files": [],
  "createdAt": 0
}
```

只有解析成功且有文件 id 的附件会交接。读到对方留下的草稿后，写入自己的输入框，再把键改写成自己的，避免两边来回抢。

## 前端分工

```text
地址栏 appId / tab
        |
        v
qiankun 宿主 (React)
        |
        v
Angular 壳 AlphaGPT.index
  侧栏、历史抽屉、记忆、旧版切换、算力
        |
        v
iframe  similar-web/#/casePro
  Vue 首页：输入、上传、示例、创建 round
        |
        v
iframe  similar-web/#/casePro/detail
  Vue 回答页：SSE、任务计划、参考资料、追问、导出
```

首页 store 只留这一屏需要的东西：文件列表、拖进来还没处理的文件、示例缓存、用户是否有知识库。示例按 type 缓存，同一会话里不重复请求。

回答页 store 留 `roundId`、标题、消息组件列表、正在生成的 `chatId`、任务计划、推荐追问、右侧依据是否打开、按 `chatId` 存的依据内容。生成中的滚动和「依据跟着当前回答走」都读这里。

壳和 iframe 用 `postMessage` 配合：全屏、打开案例抽屉、高亮检索词、桌面端拖文件、以及「切回旧版前有没有还在上传的附件」。咨询页自己不直接改壳的 DOM。

## 使用时会碰到的边界

- 空问题不能发。
- 附件还在上传或解析时不能发。
- 示例原文可以免去使用校验；改一个字就要重新校验。
- 示例卡片点进去只是填字。示例会话在回答页不能再追问。
- 生成中不能追问，要先停止或等结束。停止后，已经生成的回答不保留。
- 返回首页不会取消已经在跑的任务，结果稍后在历史记录里。
- 记忆默认按开启处理；接口明确返回 `false` 才关闭，并在创建任务时传给后端。
- 知识库入口看 `hasKnowledgePermission`，没有权限就只有本地上传和脱敏上传。

## 资料库、咨询模型和合同审查

这三块不在同一个后端里。页面能看到目录、调用方式和审查流程。模型权重、系统提示词，以及裁判文书、法规的全文库，都在服务端，前端拿不到原文库。

### 法律资料库

壳里的检索库是一套目录，每个库有自己的结果页。咨询 Pro 回答时用的检索工具，对应的就是其中几类，不是另起一套库。

| 库 | 类型名 | 检索入口 |
| --- | --- | --- |
| Alpha 案例库 | `case` | 案例结果列表。权限点 `judgement` |
| Alpha 法规库 | `law` | 法规结果。权限点 `lawregu` |
| 司法观点库 | `judicialView` | 权限点 `judicialview` |
| 类案同判库 | `similarityCase` | 权限点 `similarity` |
| 优案评析库 | `excellentCase` | 权限点 `goodJudgement`。分类：民事、商事、刑事、知识产权、行政与国家赔偿、其他（含执行等） |
| 实务文章库 | `article` | 权限点 `article` |
| 公司主体库 | `subjectAnalysis` | 公司检索 |
| 行政处罚库 | `advSanction` | 权限点 `penalty` |
| 检察文书库 | `proDoc` | 权限点 `inspection`。按钮文案就是「检索检察文书库」 |
| 期刊论文 | `cnki` | 子库有期刊、博硕士、会议、专利 |

优案评析之外，案例结果页还能按地域、当事人、法院、法官、律所、律师做推荐。

咨询 Pro 回答时调用的是同一批资料的接口，工具名已经在上一节列过：法规语义检索、精确法条、法规关键词、案例语义、案例关键词、实务文章、公众号文章、公开网页。依据区再把命中的法规、案例、文章摊开。前端不保存这些库的底稿。

文书起草、要素式文书、合同起草是另一个应用 `gpt-writing`，和上面的检索库不是同一个服务。

### 法律咨询用的模型

咨询页创建任务时不传模型名。`initTask` 只交问题、记忆开关和附件。拆任务、选技能、调检索都在 `POST /alpha-ai-chat/api/v1/stream/chatPro` 这条流里完成。

前端能看见的「模型行为」是技能文件和工具，不是某个公开的模型商品名：

- 先用 `routing-matrix.md` 判断问题类型和处理路径。
- 再落到专项技能：法律咨询专家、公司法、劳动争议、刑事辩护、知识产权、婚姻家事、法律金额计算。
- 检索和计算走上一节那些工具。金额计算会再核对 `legal_basis.md`。

另一套名叫 Alpha 的模型挂在 AlphaClaw，接口是 `GET /ai-claw/api/v1/system/model/config`。这是 Claw 客户端的供应商配置，协议写成 OpenAI completions 兼容。当前下发的模型是：

| 供应商 | 模型 id | 上下文 | 输入 | 会思考 |
| --- | --- | --- | --- | --- |
| `alphaclaw-alphalawyer-cn` | `alpha-max` | 100 万 | 文本 | 是 |
| 同上 | `alpha-high` | 100 万 | 文本 | 是，思考格式标成 deepseek |
| 同上 | `alpha-medium` | 100 万 | 文本 | 是，思考格式标成 deepseek |
| 同上 | `AlphaGPT` | 20 万 | 文本和图片 | 是，思考格式标成 deepseek |
| 同上 | `alpha-v1` | 100 万 | 文本 | 是 |
| `openai` | `alpha-image` | 20 万 | 文本 | 否 |

咨询 Pro 的页面没有模型切换，也没有把上面这些 id 传给 `chatPro`。不能从这里断定咨询流内部用的是哪一个。

### 合同审查怎么做

合同审查是独立应用，入口 `gpt-contract-review/#/main/review`。模板审查、补充协议审查、制度审查、合同比对审查共用这一套页面，用不同的产品权限区分。接口都在 `/ai-contract`。

创建一份审查时，表单是：

- 上传合同。大小和字数超限会拦住。识别类型走 `POST /ai-contract/api/v1/contractReview/recognize/contractType`。上传任务是 `POST /ai-contract/api/v1/file/upload/contract/task`，补充协议、同步、脱敏会在查询串上加 `isAgreement`、`isSync`、`secrecy`。
- **合同类型**，字段 `contractType`。级联选择，提交时只传最后一级 id。目录来自 `GET /ai-contract/api/v1/contractReview/queryContractType`。
- **审查立场**，字段 `reviewPosition`。必须先选类型。`GET /ai-contract/api/v1/contractReview/queryReviewPositionByTypeId/{typeId}`。例如股权转让合同（id 5）的立场是转让方、受让方；劳动合同（id 3）是劳动者、用人单位。
- **审阅人**，字段 `reader`，最多 10 个字，会出现在批注位置。

提交 `POST /ai-contract/api/v3/contractReview/startTask`。正文是表单字段，再加上最后一级 `contractType`、`sourceFileUrl`、`fileName`，以及 `path: "/"`。开始前会算消耗次数：`GET /ai-contract/api/v1/contractReview/computeExpendGpt`。

当前账号能审的合同类型：

| 大类 | 具体类型 |
| --- | --- |
| 购销类合同 | 动产买卖、不动产买卖、销售代理 |
| 租赁类合同 | 房屋租赁、车辆租赁、融资租赁、设备租赁、土地租赁 |
| 委托类合同 | 委托经营、委托服务、其他委托 |
| 建工类合同 | 建设工程施工、建设工程设计、劳务分包、建设工程监理、建筑工程造价咨询服务 |
| 技术类合同 | 技术服务、技术开发 |
| 知识产权类合同 | 著作权许可使用、著作权转让 |
| 服务类合同 | 教育培训、物业、咨询、维修维护保养、中介、其他服务（通用）、活动承办 |
| 股权类合同 | 股权转让、股权代持 |
| 劳动用工类合同 | 劳动合同、劳动解除、劳务派遣协议 |
| 项目合作类合同 | 招商引资、联合制片（创作）、特许经营 |
| 公司章程 | 有限责任公司、股份有限公司 |
| 公司规章制度 | 人力资源管理、综合行政管理 |
| 单独列出的 | 合作经营（适用新公司法）、营销推广（直播/广告/社媒）、担保、借款、合伙、股东出资（新设公司）、土地承包经营、货物运输、保密协议、承揽、仓储、离婚协议、通用类合同 |

审查进行中用 `GET /ai-contract/api/v1/stream/contract/thinking?reviewId=` 拉思考流。结果用 `GET /ai-contract/api/v1/contractReview/queryContractReviewResult?id=` 取。详情页分成三块：

1. **风险审查。** 按审查点出卡片，可接受建议并修订。修订走 `POST /ai-contract/api/v1/contractReview/revise`，也有 `new/revise` 和 `malL/program/revise`。改完可以 `POST /ai-contract/api/v3/contractReview/revision/retrial` 重审。红线风险单独提示。没有接受任何建议时，不能导出修订稿。
2. **主体审查。** `GET /ai-contract/api/v3/contractReview/mainBody/progress?reviewId=` 看进度，结果在 `GET /ai-contract/api/v1/contractReview/queryCompanyReviewResult`。
3. **自由审查。** 在正文里划词，或直接提问。问答流是 `POST /ai-contract/api/v1/stream/contract/reviewQa`。记录和详情是 `POST /ai-contract/api/v3/contractReview/chat/record`、`POST /ai-contract/api/v3/contractReview/chat/detail`。页面上的例子包括：我方权利义务有哪些、重点看违约责任、把免责条款的适用范围写细。提问可以先用 `POST /ai-contract/api/v3/contractReview/prompt/optimize` 改写。

另外几条和审查方式绑在一起：

- **审查规则。** `GET /ai-contract/api/v2/contractReview/rule/list` 列规则，可以增删改，也可以在审查前或审查后加到这份合同上（`rule/review/add`）。
- **事前介入。** `POST /ai-contract/api/v2/contractReview/preIntervention` 和 v3 的同名接口。合同对比另有 `POST /ai-contract/api/v3/contractReview/compare/precheck`。
- **条款。** `GET /ai-contract/api/v3/contractReview/clauses?reviewId=`，修改用 `POST /ai-contract/api/v3/contractReview/clauses/update`。
- **批注和导出。** 合同正文套 WPS，配置来自 `GET /ai-contract/api/v2/contractReview/getWpsAppId` 和 `GET /ai-contract/api/v3/contractReview/wps/config`。可以自动接受意见、自动批注，审查完短信通知（`POST /ai-contract/api/v3/contractReview/finish/notice`）。导出审查意见书走 `POST /ai-contract/api/v3/contractReview/download`。比对审查只能导出比对审查意见书，普通审查模式导出审查意见书。
- **历史。** `POST /ai-contract/api/v1/contractReview/queryAllContactReviews`。删除、批量删除、改审阅人、改审查点名称都有单独接口。

审查尺度是 `position`：强势 0、均势 1、弱势 2。创建时随合同类型、审查立场一起提交。同一份采购合同的三档结果见下文实测。

## 实测：咨询 Pro 和检索 Pro 的提示词怎么写

两边都不是把整套法律规则塞进一条系统提示词。模型先读服务器上的技能 Markdown，再按文件里规定的工具和输出提纲干活。技能正文不在前端包里，工具完成事件也只回「已读取」，不回文件内容。下面是两次真实请求里能看到的写法。

### 法律咨询 Pro

用官方短例子「公司召开股东会会议，未通知某小股东参会就直接通过了决议，该股东能否请求法院撤销这个决议？」提交。请求是 `POST /alpha-ai-chat/api/v1/chat/chatPro/initTask`，正文 `{query, enableMemory:false, docs:[]}`，然后 `POST /alpha-ai-chat/api/v1/stream/chatPro`。

模型按这个顺序动：

1. `read_file`，路径 `/skills/law-consult/SKILL.md`，`limit: 1000`。页面显示为「调用 法律咨询专家 skill」。
2. `write_todos`，五步：加载 skill、检索公司法决议撤销法条、检索召集通知法条、检索案例和实务文章、组装法律分析意见。
3. 再读 `/skills/law-consult/domain-skills/SKILL-law-consult-corporate.md`（公司法专家）和 `/skills/law-consult/references/data-api.md`（准备法律数据检索）。
4. 按 data-api 里的参数名检索，而不是自由发挥：
   - `exact_regulation_search`：`law_name` + `item`（公司法第二十六条、第六十四条，后来又补了民法典第八十五条）
   - `law_regu_keyword_search`：`full_text_keyword` + `page_size`
   - `regulation_semantic_search`：`query` + `top_k`
   - `case_keyword_search`：`full_text`，日期窗 `2021-09-15` 到 `2026-09-15`，`page_size: 12`
   - `case_semantic_search`、`practice_article_search`、`wechat_public_article_search`
5. 再 `write_todos` 把前四步标完成，开始写意见。

输出提纲是固定的八段，正文里用圆括号数字对上参考资料：

- 一、核心结论（先给能否，再列制约变量）
- 二、具体分析：（一）法律依据分析；（二）案例与裁判口径，必须分成支持撤销和驳回两边
- 三、实务操作建议
- 四、证据和材料清单
- 五、风险提示和应对方案
- 六、通俗化输出
- 七、需要补充的信息（决议日期、知悉时间、公司类型、持股比例）
- 八、实务行动建议

参考资料按法规、案例、实务文章、微信公众号分组，和正文编号对应。

所以咨询 Pro 的提示词是三层：总技能规定先读哪份领域技能、先列任务；领域技能规定这类问题要查哪些法条、答案分几段；`data-api.md` 规定每个检索工具的字段名和条数。模型自己补了一次法条检索，说明检索清单不是一次写死的。

### 类案检索 Pro

用首页卡片「按案由/罪名检索」的原文「请筛选罪名为“以危险方法危害公共安全罪”的案例」。服务端把这次记成 `isExample: true`。结果页数据在 `POST /alpha-ai-chat/api/v1/case_pro/detail`，思考过程存在 `turns[0].thinking`，最长截到 32000 字。

思考过程开头写明规则：使用 `law-case-retrieval` 技能，先读 Case 模式的工作流程，第一次检索走自然语言入口，`query` 必须逐字使用用户原话，日期下界取近 10 年。

实际工具调用：

1. 读 `case_workflow.md`
2. 读 `tool_retrieve_law_cases_by_query.md`
3. `law-case-retrieval/retrieve_law_cases_by_query`，参数是 `{query: 用户原句, start_date: "2016-08-12"}`。页面上显示成「检索相关类案」。

技能说明里的案例字段是 `jid`、`case_name`、`case_number`、`court`、`region`、`judgment_date`、`causes`、`fact_summary`。这次账号里实际留下的列表只有案号、案名和内部编号，共 8 条；法院、地区、日期和要点写在回答正文里。思考日志在第一次检索之后就被 32000 字截断，后面如果还有第二次检索，保存下来的记录里看不到。案例列表和回答原文在 `alpha-records/检索pro.md`。

输出提纲：

- 一、整体结论
  - 检索分析：写出检索目标、核心法律关系、完全匹配标准。这次的标准写的是生效判决认定该罪，且 `causes` 包含该罪名。
  - 检索总结：用一两段把行为类型和量刑幅度收束。
- 二、完全匹配案例：每条给案号、法院、地区、裁判日期、要点。
- 类案对照表：序号、案号、案名、案情概要、争议焦点、裁判观点、参考要点。

检索 Pro 的提示词是「一份流程文件 + 一份工具说明」。流程文件规定入口类型、query 不许改写、时间窗和答案分几级（完全匹配才进第二节）。工具说明规定函数名和参数。它不走咨询 Pro 那套法规、文章、公众号多工具。

## 实测原文存放

2026-11-02 从仍登录的账号把能取回的测试原文另存到 `alpha-records/`。裁判文书全文、技能文件正文、账号姓名、文件下载地址没有写入。过长的审查卡片和合同正文在单独文件里，本节只记测试怎么做、取回了什么、没取回什么。

| 功能 | 原文 | 地址 |
| --- | --- | --- |
| 类案检索 Pro | 8 条案例的案号、案名，以及回答原文 | `alpha-records/检索pro.md` |
| 法律咨询 Pro | 工具参数、回答、短法条、案例标题、文章短摘 | `alpha-records/咨询pro.md` |
| 合同审查 | 待审合同解析正文、58 张卡片 | `alpha-records/合同审查.md` |
| 合同审查输入 | 甲稿全文（虚构） | `alpha-records/合同测试稿-甲稿.md` |
| 合同比对 | 修订稿解析正文、36 张卡片（含改前、改后） | `alpha-records/合同比对.md` |
| 合同比对输入 | 乙稿全文（虚构） | `alpha-records/合同测试稿-乙稿.md` |
| 制度审查 | 违法员工手册，正文和 20 张卡片 | `alpha-records/制度审查-违法员工手册.md` |
| 制度审查 | 合规员工手册，正文和 10 张卡片 | `alpha-records/制度审查-合规员工手册.md` |
| 制度审查 | 综合行政制度，正文和 9 张卡片 | `alpha-records/制度审查-综合行政.md` |
| 制度审查 | 同一行政制度加参考文件，11 张卡片；参考文件正文是测试时写入的底线，服务器没有回传 | `alpha-records/制度审查-行政加参考文件.md` |
| 文书起草 | 四份文书只剩档案名称，正文接口返回空 | 未另存正文 |

### 类案检索 Pro

问题用首页卡片原文：请筛选罪名为“以危险方法危害公共安全罪”的案例。检索编号 `404be702296d4faeaf2bf8d6f939c8bc`，`POST /alpha-ai-chat/api/v1/case_pro/detail` 仍返回成功。回答约 4198 字，结构是整体结论、完全匹配案例、类案对照表。8 个案号都在回答里，也在案例列表里。思考日志正好 32000 字，是工具事件流，截断在第一次检索的候选结果中间，没有另存。裁判文书正文没有随列表返回。

8 个案号：（2017）闽06刑初23号、（2021）晋1181刑初3号、（2020）京0106刑初785号、（2019）吉0104刑初726号、（2019）津0105刑初36号、（2018）湘0525刑初106号、（2017）豫0782刑初423号、（2016）桂1023刑初181号。最后一条案名是交通肇事，回答仍把它放进完全匹配，理由是醉驾逃逸后继续冲撞被认定为本罪。

### 法律咨询 Pro

问题：公司召开股东会会议，未通知某小股东参会就直接通过了决议，该股东能否请求法院撤销这个决议？轮次 `dedde6e8297b473788722bec3e0ae560`。`POST /alpha-ai-chat/api/v1/chat/chatPro/records` 仍可取回。记录里的 `answer` 字段是空字符串，回答在事件流的 `RunResponse`，约 4297 字。工具顺序、法条短文、19 个案例标题和文章短摘都在 `alpha-records/咨询pro.md`。案例的裁判全文没有抄入，当时来源事件里裁判意见合计约 5.5 万字。

### 合同审查与合同比对

测试合同是虚构的零部件采购框架合同。甲方宁波青岚电器有限公司，乙方温州南屿塑胶制品有限公司。甲稿是供货商版本，把订单优先、自动续期涨价、付款免责、驻场用工、个人信息永久保存、礼品一万以下不视为违约等写成对供货商有利。乙稿是买方修订稿。

- 合同审查：编号 `bc3898a3a88c4db183c7bf5e98c7b297`，类型 27，模板标记 0，立场甲方，审查尺度当时选的是均势。58 张卡片，其中 2 条标成红线：个人信息收集保存、商业礼品。结果类型是修改或提示。主体审查对这两家虚构公司返回 0 条。
- 合同比对：编号 `15e3e2b2aedc4bb7baa853b0b613bcda`，模板标记 4，同一甲方立场。36 张卡片，结果类型是有利、不利、中性，没有红线。比对接口只回传修订稿正文；甲稿在 `alpha-records/合同测试稿-甲稿.md`。思考流已另存 `alpha-records/完整测试/合同比对-过程.md`，是逐条对照，没有检索事件，卡片法条列表为 0。
- 读卡片的口径：合同审查回答「这一条能不能留」；比对的「不利」是相对上一稿，所选立场让出了合同利益，其中有几条是法律上必须让出的，不能直接当成合规问题。

上传时的 Word 在本机临时目录：`%TEMP%\alpha-contract-A.docx`、`%TEMP%\alpha-contract-B.docx`。仓库里的两份 markdown 是同一套段落。

### 制度审查

四次都是制度审查，模板标记 3。表单只有审阅人和参考文件，没有立场、审查尺度、类型选择。类型是上传后由服务端写成 46（人力资源管理）或 49（综合行政管理）。四次都没有红线。结果类型比合同审查多了「新增」。卡片不附法条，也没有「本条合规、建议保留」。参考文件只在结果里留下文件名，正文为空，所以底线原文写在 `alpha-records/制度审查-行政加参考文件.md` 末尾。四次思考原文在 `alpha-records/完整测试/制度审查-过程-*.md`。思考里会点条号，卡片法条列表仍是 0。加参考文件与不加参考文件的思考原文相同，卡片数量不同。

AlphaNote 未激活。本机命令要求单独的 Note 令牌，已登录页面请求模板列表返回 40101。没有逐字稿和纪要。记录在 `alpha-records/完整测试/Note-测试.md`。

| 测试 | 编号 | 卡片 |
| --- | --- | --- |
| 违法员工手册 | `8b09b366dafb47c4ab71bf2cdbe5d255` | 20：修改 14、提示 3、新增 3 |
| 合规员工手册 | `e01f24ef866e4d55b53b397a040802a6` | 10：修改 8、提示 2 |
| 综合行政 | `075f2a1855df4507b9738807daf3c908` | 9：修改 5、提示 2、新增 2 |
| 同一行政制度加参考文件 | `291985f34b084a029264eade9c92b4df` | 11：修改 5、提示 3、新增 3 |

违法手册的改写把试用期改回按期限分档，加班改回法定时长和加班费，罚款改成绩效扣减并加上月工资 20% 和最低工资底线，删掉放弃社保，收窄竞业限制，辞职改回 30 日或试用期 3 日。它额外写了「旺季 = 订单超过日常产能 120%」和调休 6 个月内安排，原文没有这两句。解释权仍留在人力资源部。

合规手册已经按法定试用期、工时、社保、女职工、竞业和公示来写，仍出了 10 张卡片。其中把「员工有权拒绝违法加班」扩成符合法定条件的加班员工应当服从，并把竞业补偿写成离职前 12 个月平均工资的 30%、低于当地最低工资时按最低工资。公示被补成满 7 个工作日。

综合行政从印章、采购、礼品、监控转到表见代理、关联采购、商业贿赂和个人信息。没有参考文件时：印章可以审批后外带、24 小时内归还；监控存 3 个月；2000 元以下礼品登记后可留；关联采购价格不高于公允价，比对 2 家；宣传品不超过 500 元。加上参考文件后：印章绝对不得离开公司；监控 30 天；礼品不论金额上交；关联价格必须低于全部独立第三方，比对 3 家；印有公司标识的宣传品仍允许，单价不超过 100 元。卡片正文不引用参考文件名。制度写明不涉及劳动纪律，卡片仍出现解除劳动合同。生效程序写成总经理办公会，没有写成职工代表大会。

### 文书起草

档案查询接口只返回标题，下载接口只给文件句柄。正文在起草页右侧编辑区，四份已经按页面原文存下：

- 民事起诉状，杭州澄川精密机械诉苏州北屿数控：`alpha-records/完整测试/诉状-起诉状-澄川诉北屿.md`
- 民事起诉状，上海浦西商业管理诉上海晚棠餐饮：`alpha-records/完整测试/诉状-起诉状-浦西诉晚棠.md`
- 民事上诉状，针对（2025）浙0106民初18821：`alpha-records/完整测试/诉状-上诉状-澄川.md`
- 民事上诉状，针对（2025）沪0104民初5520：`alpha-records/完整测试/诉状-上诉状-晚棠.md`

模板槽位是起诉状两格（案情概要、起草要求），上诉状三格（上诉人、上诉理由、起草要求）。

这四份正文里能对上的写法问题：澄川起诉状自行加上「承担全部取回费用」，事实里没有这项费用。浦西起诉状把双倍占用费按每月 30 天折算，1 月 11 日至 3 月 31 日算成 80 天、235200 元。澄川上诉状给双方法定代表人写了事实里没有的职务「执行董事/总经理」，迟延违约金的上诉请求没有写金额。晚棠上诉状把合同里已经写明的双倍占用费说成材料里未见约定，并推测出租房屋本身可能不符合消防要求；上诉请求第三项要求重算押金折抵，理由部分又写不要算出一个新租金。

## 补齐测试

按搭建同样效果所缺的要素，又跑了一轮，原文在 `alpha-records/完整测试/`。索引是 `alpha-records/完整测试/00-对照说明.md`。

这次从工具返回里拿到了咨询主技能和劳动、刑事、家事、知产、计算器子技能，以及检索参数说明。主技能版本是律师版 v7.1.3。输出不再强制八段，按问题长短决定板块。纯计算走 `calculate_legal_amount`，80 万元财产案件一审受理费的样例结果是 11800 元。

类案检索补了按案号、按案情、按争议焦点、按裁判口径、按多维度。合同自由审查在已完成的采购合同上单独问了驻场用工，审到的是自动修订后的条文。审查尺度三档文案是：强势全力争取我方利益，均势平衡合规与公平并调整明显不利，弱势以促成合作为目标、只守关键权益和重大风险。

同一份甲稿、同一买方立场又跑了两档。创建走 `preIntervention`，再 `startTask`，`position` 分别是 0 和 2。强势编号 `394539cae7044ce69ae1d863f28b150e`，54 张卡片，全部是修改，红线 5 条，原文在 `alpha-records/完整测试/合同审查-强势.md`。弱势编号 `2f815d8201604df68133b906700f9c5c`，33 张卡片，全部是修改，红线 5 条，原文在 `alpha-records/完整测试/合同审查-弱势.md`。均势那次是 58 张，其中 3 张提示，红线 2 条。

同一条自动续期：强势改成未经双方书面确认就到期终止；均势保留自动续期，但涨价改成协商，并给甲方单独的不续期权；弱势只删掉上浮 8% 和「甲方不得异议」，自动续期留着。质量标准三条都改成就高，强势写得更满，弱势把这一条标成红线。弱势的红线集中在质量标准、个人信息、数据出境、原产地和法定合规责任。强势的红线集中在用工责任、人身损害、责任限制和违法成本转嫁。诉状正文路径见上面文书起草一节。

