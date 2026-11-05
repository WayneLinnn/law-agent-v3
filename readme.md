# Case desk

One lawyer, one account, one record per case. Product rules follow `agent-v3开发计划`. Development follows `开发指导`, one step at a time.

```bash
npm run dev
```

Open http://localhost:3010 in the browser. This version uses port 3010 so it does not take port 3000 from the previous version.

It reads and writes only `data/v3.sqlite`. It does not open or migrate `data/law.sqlite`. The database starts empty and does not import old cases. Original files live in `data/v3-files/`.

Quoted sentences below are the Chinese copy the product actually shows.

## Step 1

Open a blank card, name the client, and create it. A dropped or pasted text is only a prefill.

The record keeps one draft. The client goes into `clients`, the case into `matters`, and each party onto its own row in `parties`. The opposing side is not packed into one cell. Status is 草稿 (draft). No model call, no company lookup, and the text is not stored as a material.

How the lawyer uses it:

- On the workbench, click 「开一张空卡」. With no cases, the workbench says 「还没有案子。」
- A case can be created with no dropped text. The case name may be empty; an empty name uses the client's name. Cause, claim, facts, opposing party, and organ may all stay empty.
- The lawyer names the client, or types the client in that field. Creating without a client shows 「请点明谁是客户。」 and no case appears.
- Drop a `.txt`, or paste text and click 「按这段预填」. Each person read out is one row, with litigation position and unified social credit code on that row. It can be edited before create. A plaintiff or defendant is not turned into the client.
- People separated by a Chinese enumeration comma become separate rows. If no parties, cause, or claim are read, those fields stay empty.
- After 「创建」, the draft opens. Client, opposing party, and organ are three columns. The claim is stored as the mandate. It is still there after refresh, and the workbench can open it.

API:

- `POST /api/intake/read`: one `.txt`, or JSON `{ "text": "..." }`. Returns a prefill only. Does not write the database. A non-text file and empty text are each rejected.
- `POST /api/matters`: a draft is created only after the client is named. Without a client, 400, 「请点明谁是客户。」 If parties are one packed string, 400, 「当事人要每人一行。」
- `GET /api/matters`
- `GET /api/matters/:id`

Can be removed:

- Tables: `clients`, `matters`, `parties`. `lib/db.ts` creates every table this version needs; this step writes only those three.
- Files: `lib/intake.ts` only reads text. `lib/matters.ts` only reads and writes records.
- Routes: `app/api/intake/read/`, `app/api/matters/`.
- Panel: `components/create-card.tsx`. After the prefill is removed, creating a blank card still works.

### Tests

Browser and API were both walked. Two drafts were left in the database.

- Creating a blank card with no client shows 「请点明谁是客户。」 No new case.
- Naming only the client 「李某」, with a cause and a claim. The draft is created and the name is the client's name. The mandate is 「判令支付租金。」 Opposing party and organ are empty. It remains after refresh and opens from the workbench.
- Pasting a complaint prefills three rows: 甲建设有限公司, 乙置业有限公司, 丙贸易有限公司. The client field is empty; the plaintiff is not named as client. 杭州市西湖区人民法院 is the organ. Cause and claim are filled. No new case yet.
- After naming 乙置业有限公司 and creating, the draft's client is 乙置业 and the litigation position is 被告. The opposing parties are 甲建设 and 丙贸易, one row each, and 甲建设 carries the unified social credit code. The organ is its own column.
- Pasting small talk shows that no parties, cause, or claim were read, and the card stays empty.
- API: no client returns 400. Parties written as the string 「乙、丙」 also return 400, and the case count does not change. An empty read returns an empty list. A file that is not `.txt` returns 400. Read and create do not write materials. `data/law.sqlite` does not appear.

Responsive:

- Wide 1280: on the overview, client, opposing party, and organ sit in a row. The title and the three columns stay on screen. The workbench and the create card do not overflow horizontally.
- Narrow 390: the three columns stack. Inputs and buttons on the create card stay on screen. Page width is 390, with no horizontal overflow.

## Step 2

Put in one text material and confirm the text that was read.

The record keeps the original and two texts. The original is in that case's directory under `data/v3-files/`. `materials.read_text` is the machine copy and starts as 待核对 (to check). After the lawyer confirms, `usable_text` becomes the usable text and `text_status` becomes 可用文字. Confirming does not change the facts and does not change the case status. This step accepts only `.txt`. Photos, scans, and audio are not accepted yet.

How the lawyer uses it:

- Open the draft and click 「材料」.
- Choose a `.txt` and click 「放入材料」. With no file chosen, the page says 「请选择一份材料。」
- After it is in, the material says 待核对, with the read text beside it. The text can be edited.
- Click 「确认文字」. The material becomes 可用文字. The edited words stay; the machine original stays beside them.
- The original can be opened. After refresh, the status and both texts are still there. The overview also shows this material's status.

API:

- `POST /api/matters/:id/materials`: put in one `.txt`. A non-text file and empty text are each rejected. The same filename returns 409, 「本案已经有同名材料。」
- `POST /api/matters/:id/materials/:materialId/confirm`: submit the confirmed text. Blank returns 400, 「请确认读出的文字。」 Confirming again returns 409, 「这份材料已经确认。」
- `GET /api/matters/:id/materials`
- `GET /api/matters/:id/materials/:materialId/file`: open the original.

Can be removed:

- Table: `materials`. Originals directory: `data/v3-files/`.
- File: `lib/materials.ts`.
- Routes: `app/api/matters/[id]/materials/`.
- Panel: `components/material-desk.tsx`. After this block is removed, creating a blank card still works.

### Tests

The API walked one material through put-in, 待核对, edited confirm, and 可用文字. After confirm, the facts did not change, and confirming again returns 409. A duplicate name, an empty file, and a file that is not `.txt` are all rejected. A case still cannot be created without a named client.

The browser used 李某's draft. Clicking put-in with no file shows 「请选择一份材料。」 After 房屋租赁合同.txt is put on this case, the materials page says 待核对 and the text is 「承租人李某。租金未付。」 It was edited on the page to 「租金已经付清。」 and then confirmed. The page says 可用文字, and the machine read is still 「租金未付。」 It remains after refresh. On the overview, cause and mandate are unchanged, facts are still empty, and the material status is 可用文字. The case is still a draft. 乙置业's draft received no material.

Responsive:

- Wide 1280: the materials page does not overflow horizontally.
- Narrow 390: filename, 待核对 or 可用文字, confirm, and the original stay on screen. Page width is 390, with no horizontal overflow.

## Step 3

Fill in the litigation position, and treat the third column as the organ.

On the record, the litigation position is `parties.position`. The organ is still its own row, with `role` organ. The category is `matters.category` and may only be empty or one of 民事, 刑事, 行政诉讼, 非诉专项, 法律顾问, 其他. Changing the category, changing a litigation position, or adding another opposing party or organ does not change the case status or the facts. The client is still named only at create time.

How the lawyer uses it:

- Open the draft overview. The three columns, client, opposing party, and organ, stay. Switching the category to 刑事 or 行政诉讼 does not change this page.
- Choose a category and click 「记下种类」. Beside the title it becomes something like 「刑事 · 草稿」. Choosing 「还没写」 leaves only the status beside the title.
- For a person already there, change the litigation position and click 「记下」. In a criminal case the 被告人 can be written on the client row, and that row is still the client.
- The opposing column can take another person. A name that contains an enumeration comma shows 「请每人一行。」
- In the third column, write the organ's name and litigation position and click 「记下办案机关」. A reconsideration organ, a procuratorate, and a public-security organ go in this column.
- The client column has no place to add a person.

API:

- `POST /api/matters/:id/category`: JSON `{ "category": "刑事" }`. A value off the list returns 400, 「种类要写在清单里。」
- `POST /api/matters/:id/parties`: JSON `{ "role": "organ", "name": "杭州市人民政府", "position": "复议机关" }`. `role` can only be opposing or organ. Writing client returns 400, 「客户要在创建时点明。」 A name with an enumeration comma returns 400, 「请每人一行。」
- `POST /api/matters/:id/parties/:partyId`: JSON `{ "position": "被告人" }`. This changes only the litigation position, not whether the row is client, opposing, or organ.

Can be removed:

- Columns: `parties.position`, `matters.category`.
- Files: `lib/parties.ts` reads and writes parties. `lib/categories.ts` is the category list, shared by the page and the API.
- Routes: `app/api/matters/[id]/category/`, `app/api/matters/[id]/parties/`.
- Panel: `components/overview-editor.tsx`. After this block is removed, blank-card create and material confirm still work.

### Tests

The API used a temporary draft. Category 「专利」 returns 400. Adding a person as client returns 400, 「客户要在创建时点明。」 Changing the client's litigation position to 被告人 leaves that row as the client. The organ 「杭州市人民政府」 with position 「复议机关」 is its own row. The case is still a draft, the facts did not change, and the material count is 0. The draft was deleted after the test. A case still cannot be created without a named client. Step 2's material API was walked again and still passed. `data/law.sqlite` does not appear.

The browser used 乙置业's draft. The category was first saved as 刑事, and the three columns remained. The client 乙置业有限公司 had its position changed to 被告人 and saved. The category was then changed to 行政诉讼, and the page was still those three columns. 杭州市人民政府 was added in the organ column with position 复议机关. The original 杭州市西湖区人民法院 was still there, on its own row. All of it remained after refresh. Cause and mandate were unchanged, facts were still empty, this case had no materials, and the case was still a draft.

李某's draft was not changed. The category was still unwritten, the status was still a draft, the facts were still empty, and 房屋租赁合同.txt was still 可用文字. Both cases were on the workbench, with opposing parties and organs one row each.

Responsive:

- Wide 1280: the three columns sit in a row on the overview. The overview and the workbench do not overflow horizontally.
- Narrow 390: the three columns stack. Overview, materials page, and workbench are all width 390, with no horizontal overflow.

## Step 4

Save one todo that has only a name and a due date, and confirm it. Record the fee received.

On the record, a todo goes into `tasks`. The name and due date are saved first, `confirmed_at` is empty, and that is 待确认. After the lawyer confirms, the confirm time is written and it appears on the workbench. The fee received is `matters.fee_received`, in yuan, two decimal places. Empty means not recorded yet. There is no receivable. It does not infer an answer deadline, an appeal deadline, or a preservation deadline, and it does not calculate limitation, interest, or a court fee. Confirming a todo and recording the fee received do not change the case status or the facts.

How the lawyer uses it:

- Open the draft and click 「待办」.
- Write a name and a due date and click 「记下」. No name shows 「请写下名称。」 No date shows 「请写下到期日。」
- After it is saved, the todo says 待确认 and is not yet in the workbench due list.
- Click 「确认」. The todo becomes 已确认. It remains after refresh. The workbench due list shows the name, the date, and the case. Items due within ninety days, or already overdue, also appear in the reminders. An overdue item is marked 已过期.
- Write the fee received and click 「记下实收」. Write it to the cent. A value that is not an amount shows 「金额写到分。」
- The top of the workbench is reminders, due items, and fees received. Fees received are listed per case, with a total. A case with none recorded says 「还没记」.

API:

- `POST /api/matters/:id/tasks`: JSON `{ "name": "提交证据", "dueOn": "2026-11-20" }`. It starts as 待确认.
- `POST /api/matters/:id/tasks/:taskId/confirm`: confirm. Confirming again returns 409, 「这条待办已经确认。」
- `GET /api/matters/:id/tasks`
- `POST /api/matters/:id/fee`: JSON `{ "amount": "3500.50" }`. An empty string means not recorded yet.
- `GET /api/workbench`: reminders, due items, and fees received. Unconfirmed todos are not included.

Can be removed:

- `tasks`, `matters.fee_received`.
- File: `lib/tasks.ts`. The fee received is written in `lib/matters.ts`.
- Routes: `app/api/matters/[id]/tasks/`, `app/api/matters/[id]/fee/`, `app/api/workbench/`.
- Panel: `components/task-desk.tsx`. After this block is removed, the blank card, material confirm, and litigation position still work.

### Tests

The API used a temporary draft. A missing name, and a date that is not a real day, are both rejected. An unconfirmed todo does not enter the workbench. After confirm, a todo more than ninety days out is only in the due list. An overdue todo is also in the reminders and is marked 已过期. Confirming again returns 409. Fee received `3500.50` is saved. The case is still a draft and the facts did not change. A receivable sent along with it has no field to write. Clearing the fee received returns it to not recorded. A negative number and three decimal places return 400, 「金额写到分。」 `0` is saved as `0.00` and counts in the total. The draft was deleted after the test. A case still cannot be created without a named client. Step 2's material API and step 3's position API were walked again and still passed. `data/law.sqlite` does not appear.

The browser used 李某's draft. Clicking save with no name shows 「请写下名称。」 「提交证据」 was written with due date 2026-11-20. After save it is 待确认, it is not in the workbench due list, and the fee received is still 还没记. After confirm it is 已确认. The fee was first written as `1.234` and the page said 「金额写到分。」 It was changed to `3500.50` and saved. The amount remained after refresh. The workbench reminder and due list both have this item, dated 2026-11-20, on 李某. The fee total is `3500.50 元`. 乙置业 says 还没记. Clicking this todo from the workbench returns to 李某's todo page.

李某's overview was not changed. The category was still unwritten, the status was still a draft, cause and mandate were unchanged, facts were still empty, and 房屋租赁合同.txt was still 可用文字. 乙置业 was still a draft, with opposing parties and organs one row each.

Responsive:

- Wide 1280: the todo page and the workbench do not overflow horizontally.
- Narrow 390: name, due date, confirm, and fee received stay on screen. The todo page, the materials page, and the workbench are all width 390, with no horizontal overflow.

## Step 5

Start a new conversation on the workbench, choose Q&A, then ask a follow-up.

On the record, a conversation goes into `threads` with `matter_id` empty, so it is not attached to a case yet. Each turn goes into `messages`: the lawyer's words have `role` lawyer, the answer is model, and `mode` is 问答. When the question is about a statute or a case, the model is not called yet. After the lawyer clicks 仍要问答, the answer is written, and statutes and case numbers are marked 未经核对. This conversation does not change todos, the fee received, the facts, or materials.

How the lawyer uses it:

- In the workbench 「对话」, choose 问答 for this turn, write the question, and click 「问」.
- Open the conversation. What was already asked is above. Write another sentence and click 「问」 to continue. Both remain after refresh. Back on the workbench, the conversation list can find it again.
- Asking about a statute or a case shows 「这是在问法条或案例。改去直接检索。仍要问答，点「仍要问答」。」 After 「仍要问答」, statutes and case numbers in the answer carry 未经核对.
- Choosing 直接检索 and clicking 「问」 shows 「直接检索还不查。」 It does not start a conversation and does not write the database.

API:

- `POST /api/threads`: JSON `{ "mode": "问答", "text": "..." }`. Starts a conversation, not attached to a case.
- `POST /api/threads/:id/messages`: continue. JSON `{ "mode": "问答", "insist": true }` means 仍要问答.
- `GET /api/threads`
- `GET /api/threads/:id`
- An empty question returns 400, 「请写下要问的话。」 Choosing 直接检索 returns 400, 「直接检索还不查。」

Can be removed:

- Tables: `threads`, `messages`.
- Files: `lib/threads.ts` reads and writes conversations. `lib/model.ts` only calls the model. It does not read the database and does not search pkulaw.
- Routes: `app/api/threads/`.
- Panel: `components/thread-composer.tsx`. After this block is removed, the blank card, materials, positions, todos, and the fee received still work.

### Tests

The API used a temporary conversation. An empty question is rejected. 直接检索 is rejected, and no new conversation is created. Q&A asked one sentence, then a follow-up. All four messages are there, and `matter_id` is empty. The follow-up about 《民法典》 article 577 and a case stops at the prompt, with no new answer yet. After 仍要问答, the answer is written and the body contains 未经核对. The conversation was deleted after the test. 李某's status, facts, fee received, usable text, and 「提交证据」 did not change. `data/law.sqlite` does not appear.

The browser used the workbench. Choosing 直接检索, writing 「查一下合同」, and clicking ask shows 「直接检索还不查。」 The conversation list is still empty. Switching back to 问答 and asking 「承租人说租金已经付清。接下来先核对哪一版文字？」 opens the conversation, and the page says it is not attached to a case. Asking again 「如果机器读出的是未付，律师改成了付清，先信哪一版？」 leaves two questions and two answers. They remain after refresh. Asking 「《民法典》第五百七十七条怎么规定？有没有相近案例？」 first shows the prompt to switch to 直接检索, and there is no answer under that question yet. After 「仍要问答」, 《民法典》 article 577 in the answer is marked 未经核对. Back on the workbench, the conversation list can open it. 提交证据 and the fee total of 3500.50 yuan are still there. 李某 is still a draft.

Responsive:

- Wide 1280: the workbench and the conversation page do not overflow horizontally.
- Narrow 390: 问答, 直接检索, the input, and ask stay on screen. The workbench and the conversation page are both width 390, with no horizontal overflow.

## Step 6

Turn this conversation into a case, and name the client.

On the record, after 「建成案子」 and naming the client, a new draft is opened and only `threads.matter_id` is filled for this conversation. Parties, cause, and facts visible in the conversation are written as 待确认: `messages.proposal_kind`, `proposal_body`, with `accepted_at` empty. Clicking 「留下」 writes that one item onto the case. If it is not clicked, the case stays a blank card plus this conversation. Status stays 草稿. The client must be named separately. A person the model noticed does not become the client. Each person is still one row.

How the lawyer uses it:

- Open a conversation that is not attached to a case. Write the client and click 「建成案子」. With no client, the page says 「请点明谁是客户。」
- After it is created, the page says it is attached to this draft. The noticed parties, cause, and facts stay in 待确认.
- Open the draft first: cause and facts are not written yet, the opposing side is not written yet, and the only party is the named client. Status is 草稿.
- Click 「留下」 on only one item. That item is written. The other two stay 待确认.
- Back on the workbench, 「对话」 no longer lists this conversation. The case list can open the new draft.

API:

- `POST /api/threads/:id/case`: JSON `{ "clientName": "..." }`. Creates a new draft and attaches this conversation.
- `POST /api/threads/:id/proposals/:messageId/accept`: keep this item.
- No named client returns 400, 「请点明谁是客户。」 Already attached returns 409, 「这段对话已经挂到案子上。」
- An item marked 待核实 returns 400, 「待核实的不能留下。」 A todo item returns 400, 「这一项还不能留下。」 Keeping the same item again returns 409, 「这一项已经留下。」

Can be removed:

- Files: `lib/proposals.ts` creates the case and keeps one item. `lib/model.ts` only extracts the draft to confirm. It does not read the database and does not change records.
- Routes: `app/api/threads/[id]/case/`, `app/api/threads/[id]/proposals/[messageId]/accept/`.
- Panel: `components/case-from-thread.tsx`. After this block is removed, the blank card, materials, positions, todos, the fee received, and Q&A still work.

### Tests

The API used a temporary conversation. Without a named client, no case is created. After naming 乙公司, the new draft's cause and facts are both empty, and the only party is that client. Keeping the cause writes only the cause. Keeping the parties makes 甲公司 the opposing party. The client is still 乙公司, and there is no second client. Not keeping the facts leaves the facts empty, and the status is still 草稿. Creating again returns 409. 待核实 and a todo cannot be kept. The conversation and the draft were deleted after the test. 李某's status, cause, facts, and fee received did not change. Step 4's todo and fee API was walked again and still passed. `data/law.sqlite` does not appear.

The browser used the conversation already on the workbench. Clicking 「建成案子」 with an empty client shows 「请点明谁是客户。」 Then asking 「当事人还有出租人，案由先按房屋租赁合同纠纷记，基本事实是承租人称租金已经付清。」, writing the client 王某, and clicking 「建成案子」 again. When the new draft opens, cause and facts both say not written, the opposing side is not written, the only client is 王某, and the status is 草稿. 待确认 contains the lessor, the lessee, the cause, and the facts. Only the cause was kept. The cause becomes 已留下 and is written on the draft. Parties and facts stay 待确认, the facts stay empty, the opposing side stays empty, and the status stays 草稿. Back on the workbench, conversations say 「还没有对话。」 The reminder and the due list are still 提交证据, 2026-11-20, 李某. The fee total is 3500.50 yuan. 李某 is still a draft. 乙置业 is still an 行政诉讼 draft, with opposing parties and organs one row each.

Responsive:

- Wide 1280: the workbench, 王某's overview, and this conversation do not overflow horizontally.
- Narrow 390: client, 建成案子, and 留下 stay on screen. The workbench, the overview, and the conversation page are all width 390, with no horizontal overflow.

## Step 7

Open a draft or a case waiting to be filed, choose Q&A, ask whether the evidence is enough, then click one next step.

On the record, this question and answer are written in this case's `threads` and `messages`. If the case already has a conversation, it continues that one. If it does not, the first question starts one and attaches it to this case. Opening the handling page itself writes nothing. A next step is only a sentence under the answer. Clicking it fills the input and does not write another message. Q&A does not change the facts, materials, todos, the fee received, or the status. The model sees only usable text, plus proof targets, facts, and mandate the lawyer has written. The body of a material still 待核对, and a body with no usable text, are not attached.

How the lawyer uses it:

- Open the draft and click 「办理」. The left side is materials, marked with text status. The middle is this conversation. The right side is 待确认, in progress, and done. In progress may be empty.
- Choose 问答 for this turn, write 「证据够不够？」, and click 「问」. The question and answer remain after refresh.
- At most three next steps sit under the answer. Clicking one puts that sentence in the input. It has not been sent. Without clicking 「问」, the record does not change.
- Choosing 直接检索 and clicking 「问」 shows 「直接检索还不查。」

API:

- `POST /api/matters/:id/ask`: JSON `{ "mode": "问答", "text": "..." }`. Written into this case's conversation.
- When the case already has a conversation, continuing can still use `POST /api/threads/:id/messages`.
- 直接检索 returns 400, 「直接检索还不查。」 分析成文 returns 400, 「工作台不能分析成文。」 Neither opens a conversation first.

Can be removed:

- Files: `lib/handle.ts` attaches Q&A to this case. `lib/case-brief.ts` assembles only usable text. `lib/model.ts` answers and gives next steps. It does not read the database.
- Route: `app/api/matters/[id]/ask/`.
- Page: `app/matters/[id]/handle/`, `components/handle-desk.tsx`. After this page is removed, the blank card, materials, positions, todos, the fee received, and creating a case from a conversation still work.

### Tests

The API used a temporary draft. Opening handling does not yet create a conversation. 直接检索 and 分析成文 are both rejected and are not stored. Two texts were put in and only one was confirmed. After asking whether the evidence is enough, the answer does not contain the unconfirmed text. There are at most three next steps. The facts stay empty, material status does not change, and the status stays 草稿. After the status is changed to 待立案 and another question is asked, the status is still 待立案 and the facts are still empty. This conversation does not appear in the workbench list of unattached conversations. The draft and the originals were deleted after the test. 李某's status, cause, facts, and fee received did not change. Step 5's Q&A API was walked again and still passed. `data/law.sqlite` does not appear.

The browser used 李某's draft. The overview is a draft, and 房屋租赁合同.txt is 可用文字. Clicking 办理 shows that material on the left. Choosing 问答 and asking 「证据够不够？」, the answer relies on 「租金已经付清」 in the usable text and does not switch to the machine read 「租金未付」. Three next steps sit below. Clicking the first fills the input with that sentence, the button is still 「问」, and there is no new question. After refresh the Q&A and the next steps are still there, and the unsent sentence is not in the input. Back on the overview, the facts still say not written, the mandate is still 判令支付租金, and the status is still 草稿. Workbench conversations still say 「还没有对话。」 提交证据 and the fee total of 3500.50 yuan are still there. 王某's handling continues the original conversation: the cause is done, parties and facts are still 待确认, and the status is still 草稿.

Responsive:

- Wide 1280: 李某's handling page does not overflow horizontally.
- Narrow 390: materials, Q&A, next steps, and 待确认 stay on screen. Handling, overview, and workbench are all width 390, with no horizontal overflow. 王某's handling page is also 390, with no horizontal overflow.

## Step 8

Keep a timeline and a checklist, then keep a path.

On the record, these three items first stop in the conversation's 待确认. Clicking 「留下」 writes one item at a time into `notes`. What is not clicked is not stored. A body that contains 待核实 cannot be kept. If the body of a material still 待核对 is written into an item, that item is marked 待核实. The path lists civil, criminal, and administrative side by side, and every line is marked 待核验. What cannot be given is not invented as fact. Status, facts, and material text are not changed.

How the lawyer uses it:

- In handling, choose 问答, ask for a timeline, a checklist, and a path, and click 「问」.
- The three items appear in 待确认. 「已记下」 above still says there is nothing.
- Keep the timeline first. 已记下 contains only the timeline. The other two stay 待确认.
- Then keep the checklist, then the path. After refresh all three are there. The path is one line each for civil, criminal, and administrative, all marked 待核验.

API:

- Still use `POST /api/matters/:id/ask` to ask for the three items.
- `POST /api/threads/:id/proposals/:messageId/accept` keeps one item and writes `notes`.
- `GET /api/matters/:id/notes`
- A body containing 待核实 returns 400, 「待核实的不能留下。」 Keeping the same item again returns 409, 「这一项已经留下。」

Can be removed:

- Table: `notes`.
- Files: `lib/notes.ts` prepares the draft to confirm and lists what has been kept. Keeping still lives in `lib/proposals.ts`. `lib/model.ts` only drafts. It does not read the database.
- Route: `app/api/matters/[id]/notes/`.
- 「已记下」 on the handling page. After this block is removed, Q&A and next steps still work.

### Tests

The API used a temporary draft. One text was confirmed as usable text, and another stayed 待核对. After asking for a timeline, a checklist, and a path, `notes` is still empty. Keeping the timeline first stores only that one. Then the checklist and the path are kept. The path contains civil, criminal, and administrative and is marked 待核验. Keeping the timeline again returns 409. Writing the unchecked body into the checklist marks it 待核实, keeping it returns 400, and the notes are still three. The status is still 草稿, the facts are still empty, and the unchecked material did not become usable text. The draft and the originals were deleted after the test. 李某's status, cause, facts, and fee received did not change. `data/law.sqlite` does not appear.

The browser used 李某's handling page. 已记下 first says there is nothing. Asking 「请再提出时间线、待核清单和路径。只根据已经核对的文字。」 leaves the three items in 待确认. The timeline is 「承租人李某。租金已经付清。」 from the usable text. The timeline was kept first, and 已记下 has only that one. Then the checklist, then the path. The path is three lines, civil, criminal, and administrative, all marked 待核验. All of it remained after refresh. The overview facts still say not written, and the status is still 草稿. 房屋租赁合同.txt is still 可用文字.

Responsive:

- Wide 1280: 李某's handling page does not overflow horizontally.
- Narrow 390: 已记下, 待确认, and 留下 stay on screen. The handling page and the overview are both width 390, with no horizontal overflow.

## Step 9

Let it propose one todo, or a change to the facts, the mandate, or a proof target.

On the record, these items first stop in 待确认. Clicking 「留下」 writes them, one item at a time. A todo goes into `tasks` with only a name and a due date. It starts as 待确认 and appears in the workbench due list only after confirm. Facts are written to this case's facts, the mandate to the mandate, and the proof target to the named material. The next item is not stored until it is clicked. A body that contains 待核实 cannot be kept. A due date that is not a real day cannot be kept. Status, client, usable text, and archive are not changed.

How the lawyer uses it:

- In handling, choose 问答, ask for one todo and drafts of the facts, the mandate, and the proof target, and click 「问」.
- After refresh, the items are still in 待确认. The facts, mandate, and proof target on the overview have not changed.
- Keep the todo first. The todo page shows this one, marked 待确认. The other items stay 待确认. It is not in the workbench due list yet.
- Then keep the facts. The overview facts become this draft. The mandate and the proof target stay as they were.
- Then keep the mandate, then the proof target. The proof target is written on the named material.

API:

- Still use `POST /api/matters/:id/ask` to propose these items.
- `POST /api/threads/:id/proposals/:messageId/accept` keeps one item.
- Todos are read with `GET /api/matters/:id/tasks`. Facts and mandate are read with `GET /api/matters/:id`. Proof targets are read with `GET /api/matters/:id/materials`.
- A body containing 待核实 returns 400, 「待核实的不能留下。」 A due date that does not exist returns 400, 「请写下到期日。」 Keeping the same item again returns 409, 「这一项已经留下。」

Can be removed:

- Files: `lib/changes.ts` prepares the draft to confirm. Keeping still lives in `lib/proposals.ts`. `lib/model.ts` only drafts. It does not read the database.
- The proof target is visible on the handling page, the overview, and the materials page. After this block is removed, Q&A, next steps, and the timeline still work.

### Tests

The API used a temporary draft. One text was confirmed as usable text, and another stayed 待核对. After asking for a todo, facts, mandate, and proof target, the todo table is still empty, facts and mandate are empty, and the proof target is not written. Keeping the todo first adds only one unconfirmed todo, and it is not in the workbench due list. Then keeping the facts changes only the facts. Then keeping the mandate changes only the mandate. Then keeping the proof target changes only the proof target of the named material. Usable text and the unchecked material do not change. Keeping the todo again returns 409. Keeping a due date that does not exist returns 400. Writing the unchecked body into the facts marks it 待核实, keeping it returns 400, and the facts stay the draft that was already kept. The status is still 草稿 and the client did not change. 直接检索 still returns 400. The draft and the originals were deleted after the test. 李某 was not changed before or after this API test. Step 8 was walked again and still passed. `data/law.sqlite` does not appear.

The browser used 李某's handling page. Asking 「请提出一条待办，并改基本事实、委托事项、证明对象。」 and stating the four drafts. After refresh all four are in 待确认. The facts are still empty, the mandate is still 判令支付租金。, the proof target still says not written, the status is still 草稿, and the client is still 李某. The todo was kept first. The todo page has 「核对付款凭证」, 2026-12-15, 待确认. 「提交证据」 is still 已确认. 核对付款凭证 is not in the workbench due list. Then the facts were kept, and the overview became 「承租人李某。租金已经付清。」 The mandate and the proof target stay 待确认. Then the mandate was kept, and the overview became 「先核对付款凭证。」 The proof target stays 待确认. Finally the proof target was kept. On the materials page, 房屋租赁合同.txt is still 可用文字, the usable text is still 「承租人李某。租金已经付清。」, and the machine read is still 「租金未付。」 The proof target is 「证明现有文字写明租金已经付清。」 The fee received is still 3500.50 yuan.

Responsive:

- Wide 1280: 李某's handling page and materials page do not overflow horizontally.
- Narrow 390: handling, todos, and the overview are all width 390, with no horizontal overflow.

## Step 10

Choose direct search, and check sources on the right.

On the record, this question becomes one confirmed focus, written in `focuses`. The snapshot of each checked original goes into `sources`, under that focus. What is not checked is not stored. Candidates stay only in server memory and are dropped when they expire. Q&A does not search pkulaw. 分析成文 still cannot be used. The search sentence strips this case's party names, ID numbers, phone numbers, and addresses. When the conversation is not attached to a case, checking asks for a case first and does not write sources.

How the lawyer uses it:

- In handling or on the workbench, choose 直接检索, write what to look up, and click 「问」.
- Statutes and cases appear on the right. Party names have already been removed from the search sentence. After refresh the candidates are still there, and the focus and the sources are still empty.
- Check one and click 「收下勾选的」. This question becomes the focus, and only the checked item is written as a source. The unchecked ones stay on the right.
- When the conversation is not attached to a case, clicking 「收下勾选的」 says 「先建成案子。」

API:

- `POST /api/matters/:id/ask` or `POST /api/threads`, JSON `{ "mode": "直接检索", "text": "..." }`. Writes only this question, not a model answer.
- `GET /api/threads/:id/candidates` reads candidates that are not stored yet.
- `POST /api/threads/:id/candidates/accept`, JSON `{ "messageId": "...", "sourceIds": ["..."] }`.
- `GET /api/matters/:id/focuses` reads focuses and sources that have been accepted.
- Not attached to a case returns 400, 「先建成案子。」 Accepting the same one again returns 409, 「这一条已经收下。」 Checking after archive returns 409, 「归档后只供查阅。」 A search sentence that is only party information returns 400, 「检索句里只剩下当事人信息。」 分析成文 still returns 400, 「工作台不能分析成文。」

Can be removed:

- Tables: `focuses`, `sources`.
- Files: `lib/pkulaw.ts` only searches pkulaw. `lib/retrieval.ts` strips party information, remembers candidates, and accepts the checked ones.
- Routes: `app/api/threads/[id]/candidates/`, `app/api/matters/[id]/focuses/`.
- Panel: `components/source-desk.tsx`. After this block is removed, Q&A, next steps, and keeping an item still work.

### Tests

The API first used a conversation not attached to a case. After 直接检索 there are candidates on the right, and the conversation has no model answer. Checking returns 400, and no source is written. Then a temporary draft was opened. The search sentence included the client's name, mobile number, ID number, and address, and the sentence that was actually searched contained none of them. Before any check, the focus is empty. Accepting only the first item makes the focus this question, the source is only that one item, and the next item is not in the database. Accepting the same one again returns 409. Checking another one after archive returns 409, and there is still one source. Searching with only the client's name returns 400, and there is no new question. 分析成文 is still rejected. Before archive the status is 草稿, the facts are still empty, and the client did not change. The conversation and the draft were deleted after the test. 李某's status, facts, mandate, fee received, and focus count were not changed by this API run. Step 5 was walked again and still passed. `data/law.sqlite` does not appear.

The browser used 李某's handling page. Opening handling, the right side is still 待确认 and it does not search on its own. Choosing 直接检索 and asking 「李某房屋租赁合同约定租金已经付清，出租人还能不能再主张租金」, the search sentence no longer contains 李某. Statutes and cases are on the right. Only 《民法典》 article 752 was checked, then 「收下勾选的」. After refresh, the focus is this question, and the only accepted source is that one statute. The other cases can still be checked and were not written. The status is still 草稿. Facts, mandate, proof target, and the fee received were not changed by this turn.

Responsive:

- Wide 1280: 李某's handling page does not overflow horizontally. Sources are on the right.
- Narrow 390: the search sentence, candidates, accept, and accepted sources stay on screen. Page width is 390, with no horizontal overflow.

## Step 11

Choose 分析成文, edit the draft beside the conversation, then keep it.

On the record, clicking 「留下」 writes a new version into `drafts`. The body is the lawyer's edited words, and the document kind is what the lawyer typed. Sources record only what was already checked. Statutes and case numbers in the body are first matched against the checked originals. What does not match is looked up in pkulaw. What cannot be found is marked 疑似编造, written in the body and in `warnings`, and that version cannot be finalized. Finalizing only marks this version final. It does not change the case status. Before 「留下」, the draft is only a document draft inside the conversation.

How the lawyer uses it:

- In handling, choose 分析成文, write what to write, and click 「出稿」. The draft appears beside the conversation. Words can be edited, and one passage can be named and revised.
- The lawyer writes the document kind. After 「留下」, this version appears below. It remains after refresh.
- A statute that matches stays in the body. One that does not match and cannot be found is marked 疑似编造 in the body. Clicking 「定稿」 says 「这一版有疑似编造，不能定稿。」
- A version with no 疑似编造 can be finalized. The status on the page stays what it was.

API:

- `POST /api/matters/:id/ask`, JSON `{ "mode": "分析成文", "text": "..." }`. Only the already checked sources are given to the model. Not attached to a case returns 400, 「先建成案子。」 No checked sources returns 400, 「请先勾选出处。」 After archive, 409, 「归档后只供查阅。」 None of the three writes a conversation or a document.
- `POST /api/matters/:id/drafts/revise`, JSON `{ "body": "...", "passage": "...", "instruction": "..." }`. A passage that is not in the draft returns 400, 「稿子里没有这一段。」
- `POST /api/matters/:id/drafts`, JSON `{ "kind": "...", "body": "..." }`. An empty kind returns 400, 「请写下文书种类。」
- `POST /api/matters/:id/drafts/:draftId/final` finalizes. 疑似编造 returns 400, 「这一版有疑似编造，不能定稿。」 Finalizing the same version again returns 409, 「这一版已经定稿。」
- `GET /api/matters/:id/drafts` reads the kept versions.

Can be removed:

- Table: `drafts`.
- Files: `lib/drafts.ts` keeps, revises one passage, and finalizes. `lib/model.ts` drafts only from the checked originals. `lib/pkulaw.ts` checks statutes and case numbers that did not match.
- Routes: `app/api/matters/[id]/drafts/`.
- Panel: `components/draft-desk.tsx`. After this block is removed, Q&A, direct search, and checking sources still work.

### Tests

The API first used a conversation not attached to a case. 分析成文 returns 400, and there is no new conversation. Then a temporary draft was opened. With no checked sources, 分析成文 returns 400 and also does not write a conversation. One usable text and one unchecked text were put in. After search, only one statute was accepted. After drafting, the documents table is still empty. The draft does not contain the material original, the unchecked text, or the marker inside the facts, and it does not contain the title that was not checked. On keep, the kind was written as 代理词, and the lawyer's edited words were kept as written. A statute that matches the sources is not marked 疑似编造. Another version with a statute and a case number that cannot be found is marked 疑似编造 in the body, and finalize returns 400. A clean version finalizes. The status is still 草稿, and the facts, the fee received, and the client did not change. Finalizing the same version again returns 409. Naming a passage that is not in the draft returns 400. Revising one passage does not add a document version. After archive, drafting, keeping, and finalizing all return 409, and there are still two document versions. The draft and the originals were deleted after the test. 李某 was not changed before or after this API run. Steps 5, 7, 9, and 10 were walked again and still passed. `data/law.sqlite` does not appear.

The browser used 李某's handling page. Choosing 分析成文 and asking to write, from the already checked statute only, how the lessee should pay rent, and not to write any other statute or case number. The draft wrote only the sentence from article 752. The passage 「也可以解除合同并收回租赁物。」 was revised into a sentence with a comma, and the box showed the revised sentence. The kind was written as 代理词, the body added 「律师改过。」 and 《中华人民共和国民法典》 article 752, and it was kept. Version 1 is 代理词. The body contains 律师改过 and has no 疑似编造. Another version was kept, adding 《虚构测试条例》 article 999 and （2099）测民终1号. Version 2 marks both as 疑似编造. Finalizing that version shows 「这一版有疑似编造，不能定稿。」 After version 1 is finalized it is marked 已定稿. The status is still 草稿. The facts are still 「承租人李某。租金已经付清。」 The mandate is still 「先核对付款凭证。」 The fee received is still 3500.50 yuan. The material is still 可用文字, the usable text is still that the rent has been paid, the machine read is still that it has not, and the proof target did not change. The todo 「核对付款凭证」 is still 待确认. The only accepted source is still article 752. The four cases on the right were not written.

Responsive:

- Wide 1280: 李某's handling page does not overflow horizontally. The document, keep, and finalize sit beside the conversation.
- Narrow 390: draft, keep, version 1, and version 2 stay on screen. Page width is 390, with no horizontal overflow.

## Step 12

Write the outcome, resolve every todo, confirm the closing statement, then archive.

On the record, the outcome, the date, and the particulars go into `closings`, and the case enters 结案中. Each todo's resolution goes into `task_resolutions`, recorded only as 已完成 or 不再适用. An unconfirmed todo is not turned into a confirmed one. After the closing statement is confirmed, the case enters 已结案. Archive is a separate step. Only then are `dossier_items` generated from the materials, notes, sources, document versions, todos, and closing statement as they stand. Q&A does not enter the dossier. Unarchiving returns to 已结案, deletes the dossier, and does not delete the other records or the Q&A.

How the lawyer uses it:

- In the case navigation, click 「归档」. The outcome can be typed, or 「生效裁判」 or 「委托终止」 can be clicked to fill it. Then write the date and the particulars and click 「保存办结结果」. The status becomes 结案中.
- For each todo, choose 已完成 or 不再适用, optionally add a note, and click 「记下处理结果」. The closing statement cannot be confirmed until every todo is resolved.
- Write the closing statement and click 「确认结案说明」. The status becomes 已结案. There is no dossier yet.
- Click 「归档」. The status becomes 已归档 and the dossier appears. Q&A is still possible on the handling page. 分析成文 and keep say 「归档后只供查阅。」
- Click 「解档」 to return to 已结案, and the dossier disappears. Changing the outcome returns to 结案中. It returns to 已结案 only after another confirm.

API:

- `POST /api/matters/:id/closing`, JSON `{ "outcome": "...", "outcomeOn": "YYYY-MM-DD", "outcomeNote": "..." }`. An empty outcome, date, or particulars each return 400. After save, a case in 草稿, 待立案, or 办理中 enters 结案中.
- `POST /api/matters/:id/closing/tasks/:taskId`, JSON `{ "result": "已完成" | "不再适用", "note": "..." }`. With no outcome written, 400, 「请先写下办结结果。」
- `POST /api/matters/:id/closing/statement`, JSON `{ "statement": "..." }`. Empty returns 400, 「请写下结案说明。」
- `POST /api/matters/:id/closing/confirm`. A todo still unresolved returns 400, 「请先处理每条待办。」 Already confirmed returns 409, 「结案说明已经确认。」
- `POST /api/matters/:id/closing/archive`. Not yet confirmed returns 400, 「请先确认结案说明。」 Already archived returns 409, 「已经归档。」
- `POST /api/matters/:id/closing/unarchive`. Not archived returns 400, 「这件案子没有归档。」
- `GET /api/matters/:id/closing` reads the outcome, todo resolutions, dossier, and current status. Opening this page does not change the status.

Can be removed:

- Tables: `closings`, `task_resolutions`, `dossier_items`.
- File: `lib/closings.ts`.
- Routes: `app/api/matters/[id]/closing/`.
- Page: `app/matters/[id]/archive/page.tsx`, `components/archive-desk.tsx`. After this block is removed, Q&A, search, documents, and todo confirm still work. Not being able to keep after archive is still enforced by each record API itself.

### Tests

The API opened a temporary draft. Resolving a todo before an outcome is written returns 400. An empty outcome, date, or particulars, or a bad date, each return 400. After save the status is 结案中, the dossier is empty, and the facts, the fee received, and the client did not change. Confirming after only one todo is resolved returns 400, 「请先处理每条待办。」 Confirm is allowed only after both are written. The status becomes 已结案 and the dossier is still empty. Confirming the same statement again returns 409. Changing the particulars returns to 结案中, and archive then returns 400. It is changed back and confirmed again. Q&A does not change the status. After search, only one statute is checked and one document version is kept, and the status is still 已结案. Archive does not add a conversation. The dossier contains the material, the source, the document, both todos, and the closing statement. It does not contain the Q&A, and it does not contain the marker inside the facts. The unconfirmed todo is still 待确认 and does not appear on the workbench. The confirmed one is still in the reminders and the due list. Q&A after archive succeeds, the status is still 已归档, and the dossier row count does not change. 分析成文 and keep return 409, add no conversation, and add no document. Checking after 直接检索 returns 409, and there is still one source. Archiving again returns 409, 「已经归档。」 After unarchive the status is 已结案, the dossier is cleared, and the conversation is still there. Keeping another document version after unarchive succeeds, and the status is still 已结案. The draft and the originals were deleted after the test. 李某 was not changed before or after this API run. Step 11 was walked again and still passed. `data/law.sqlite` does not appear.

The browser used 李某. The outcome was clicked as 「委托终止」, date 2026-10-26, particulars 「委托人决定不再继续。」 After save the status is 结案中 and there is no dossier yet. 「提交证据」 was recorded as 已完成, and 「核对付款凭证」 as 不再适用. The page still marks the second one 待确认. The closing statement was 「本案委托已经终止。待办已分别写下处理结果。」 After confirm the status is 已结案. After archive the status is 已归档. The dossier has the material 「房屋租赁合同.txt」, the timeline, checklist, and path among the notes, the source 「中华人民共和国民法典 第七百五十二条」, the documents 「代理词 第1版」 and 「代理词 第2版」, both todos, and the closing statement. On the handling page, asking 「只回答两个字：收到」 is answered 「收到」, and the status is still 已归档. 分析成文 and keep both say 「归档后只供查阅。」 Both document versions are still there, and the four cases on the right were not written. After unarchive the status returns to 已结案 and the dossier disappears. Changing the particulars returns the status to 结案中. Changing it back to the original sentence and confirming returns the status to 已结案. The facts are still 「承租人李某。租金已经付清。」 The mandate is still 「先核对付款凭证。」 The fee received is still 3500.50 yuan. The material is still 可用文字, the usable text is still that the rent has been paid, the machine read is still that it has not, and the proof target did not change. The workbench reminders and due list still contain only 「提交证据」, not 「核对付款凭证」. 李某 is 已结案 in the case list.

Responsive:

- Wide 1280: 李某's archive page does not overflow horizontally. Content width is 1265, the same as the visible width.
- Narrow 390: outcome, todos, closing statement, unarchive, and the dossier stay on screen. Page width is 390, with no horizontal overflow.

## Step 13

Opening a case is the three columns directly. The left column is materials, the middle is this case's conversation, and the right is items waiting to be confirmed and the due dates of confirmed todos.

Nothing new is written on the record. Opening the page does not add a conversation, a document, a source, a todo, a closing, or a dossier entry.

How the lawyer uses it:

- Click a case in the workbench case list. The page head is the name and the status, and it can return to the workbench. There are no five entries for overview, materials, todos, handling, and archive.
- The left column lists materials, usable text or 待核对, and the proof target. Clicking the filename still opens the original and the text check.
- The middle is this case's existing conversation. Q&A, direct search, or 分析成文 can continue. The document is still edited, kept, and finalized beside the conversation.
- The right column writes due items first. It lists only confirmed todos and their due dates. Overdue ones are marked 已过期. Unconfirmed ones do not appear here. Below that is 待确认. When there are search candidates or checked sources, they are still in this column.
- Parties, cause, mandate, and facts are collected under the three columns and open when 「当事人」 is clicked. Closing stays on the original closing page, opened by address, and the page head can return to this case.
- The old handling address returns to this case. Opening handling writes nothing.

API: this step has no new route. `GET /matters/:id` is read-only.

Can be removed:

- Pages: `app/matters/[id]/page.tsx` is the three columns. `app/matters/[id]/handle/page.tsx` returns to this case.
- Panels: `components/matter-frame.tsx` no longer holds the five entries. `components/handle-desk.tsx` adds due items to the right column.

### Tests

李某's page was opened twice, once through the handling address. The row counts of conversations, documents, sources, todos, closing, dossier, and materials did not change. The status is still 已结案. Facts, mandate, and the fee received did not change. The page has no entries for overview, handling, or archive. The due column is 「提交证据 · 2026-11-20」, and it does not contain 「核对付款凭证」.

The browser clicked 李某 from the workbench case list. The left column is 「房屋租赁合同.txt」, usable text. The middle has the original Q&A, including 「收到」, and also 代理词 versions 1 and 2. The right due list has only 「提交证据 · 2026-11-20」, and 待确认 says 「没有待确认的。」 核对付款凭证 appears only among the kept todos.

Responsive:

- Wide 1280: the three columns sit side by side. Materials, the conversation, and due items are visible at once. Content width is 1265, the same as the visible width.
- Narrow 390: materials, the conversation, and due items stack from top to bottom. Page width is 390, with no horizontal overflow.

## Step 14

In the middle column, let the agent look up this case and propose one add, change, or delete. Only the item that is accepted is written. Without acceptance, the case record does not change. Acceptance writes only that one item. Status, client, usable text, the fee received, and archive are not changed by it.

Lookup answers from records this case already has: parties, cause, mandate, facts, todos, notes, focuses, titles of checked sources, document versions, and the closing. The body of a material still 待核对 is not sent in. An add, a change, or a delete first stops in the right-column 待确认. Deleting a todo deletes only the named one. When deleting a party, the client cannot be deleted. Proposing an add, change, or delete after archive returns 「归档后只供查阅。」 and does not add a conversation.

How the lawyer uses it:

- Choose 问答 in the middle column. Looking up this case, the answer carries the original sentence from the record, and the right column does not show a new 待确认.
- Write one change, for example changing the mandate to one sentence, adding one party, or deleting one todo or one opposing party. That item appears on the right, marked 待确认. The record is still the old one.
- Click 「留下」 on that item. Only that item is written. The other items waiting to be confirmed stay. Status, client, usable text, and the fee received do not change.
- Asking to delete the client is refused on keep, and the page says 「这一项不能改客户。」

The API is still the original Q&A and keep:

- `POST /api/matters/:id/ask`, `{ "mode": "问答", "text": "..." }`. A lookup only does not produce 待确认. Proposing one add, change, or delete adds one 待确认.
- `POST /api/threads/:id/proposals/:messageId/accept`. Acceptance writes that item. Already kept returns 409. 待核实 cannot be kept. After archive, 409.

Can be removed:

- Files: `lib/record-edits.ts` prepares one add or delete. `lib/case-brief.ts` gives this case's records to the model. `lib/proposals.ts` writes or deletes that item on acceptance.
- Q&A, direct search, and 分析成文 still use their original entries.

### Tests

The API opened a temporary draft. The client, the mandate, the fee received, one usable text, and one unchecked text were recorded first, plus one confirmed todo. Looking up the mandate and the client, the answer contains the original sentences, does not contain the unchecked body, and does not add 待确认. The mandate did not change. Then a mandate change and one added opposing party were proposed. Before acceptance, the mandate and the parties are still the old ones. Keeping only the mandate leaves the opposing party absent. The status is still 草稿, and the fee received and the usable text did not change. Then the opposing party was kept. Deleting that opposing party leaves the client. Deleting the client is rejected. Then one todo was proposed and kept. It is unconfirmed, and the original confirmed one is still there. Deleting the new one leaves the confirmed one. Changing the mandate again after archive returns 409, and the conversation row count does not change. The draft was deleted after the test. 李某's status, facts, mandate, fee received, todos, documents, and closing did not change. Steps 7, 8, and 9 were walked again and still passed. `data/law.sqlite` does not appear.

The browser used a temporary blank card. The client was written as 癸公司. Looking up the client in the middle column, the answer is 「客户名称：癸公司。」 待确认 is still empty. Then writing 「把委托事项改成：先看合同-14。」, that item appears in the right-column 待确认, and the mandate is still empty at that moment. After keep, the item becomes 已留下 and the mandate is 「先看合同-14。」 The status is still 草稿 and the client is still 癸公司. The temporary card was deleted after the test. 李某 is still 已结案, the mandate is still 「先核对付款凭证。」, and the fee received is still 3500.50 yuan.

## Step 15

In the middle column, let the agent record one todo, or look at the due dates of todos that already exist. A todo still has only a name and a due date.

A recorded todo first stops in 待确认. It is written only when kept, and it is still unconfirmed. It does not enter the right-column reminder, and it does not enter the workbench. After the lawyer confirms it on the todo page, one that is within ninety days or already overdue appears on the right, and an overdue one is marked 已过期. A confirmed todo beyond ninety days does not enter the right column. It stays in the workbench due list. An unconfirmed todo does not enter the reminder. The workbench layout was not changed.

How the lawyer uses it:

- Choose 问答 in the middle column and write 「记一条待办：名称，到期日 YYYY-MM-DD。」 That item appears on the right. Before keep, the todo table is still empty.
- Click keep. The todo records the name and the due date, and the status is still 待确认. The right column says 「九十天内没有要提示的。」
- Confirm it on the todo page. Back on this case, the right column lists this one and its due date.
- Then write 「看一下已有待办的到期。」 The answer lists each name and due date, and says whether it is confirmed or not. The right-column reminder contains only confirmed todos within ninety days and confirmed todos that are overdue.

The API is still the original Q&A, keep, and confirm:

- `POST /api/matters/:id/ask`. Recording one todo adds one 待确认. Looking at due dates only answers and does not write a new todo.
- `POST /api/threads/:id/proposals/:messageId/accept` writes this one and does not mark it confirmed.
- `POST /api/matters/:id/tasks/:taskId/confirm` is still the lawyer's confirm. It enters the reminder only after confirm.

Can be removed:

- `reminderOf` and `describeDue` in `lib/tasks.ts`. The right column uses the same ninety-day rule.
- The workbench reminders and due list were not changed.

### Tests

The API opened a temporary draft. Recording a todo within ninety days, before acceptance the table is empty and the right column does not show it. After keep it is still unconfirmed, and the right column still does not show it. After confirm the right column has the name and the due date. Then one beyond ninety days, one unconfirmed, and one overdue were kept. The due-date answer contains all four names and dates. The right column has only the one within ninety days and the overdue one. The overdue one is marked. The far one and the unconfirmed one are not there. All four notes are empty. The status is still 草稿, the fee received is not recorded, and the client did not change. The workbench reminders contain the near one and the overdue one, and not the far one or the unconfirmed one. The due list still has the far one, and still has 李某's 「提交证据」. The draft was deleted after the test. 李某's status, mandate, fee received, and todos did not change. `data/law.sqlite` does not appear.

The browser used a temporary blank card. The client was written as 丑公司. The middle column wrote 「记一条待办：庭前会议-15，到期日 2026-11-18。」 The name and date appear in the right-column 待确认, and the reminder is still 「九十天内没有要提示的。」 After keep, the todo page shows 待确认. After confirm and returning to the case, the right column is 「庭前会议-15 · 2026-11-18」. Looking at existing due dates again, the answer is 「待办只有名称和到期日。」 and this one confirmed item. The status is still 草稿. The temporary card was deleted after the test. 李某 is still 已结案, the mandate is still 「先核对付款凭证。」, the fee received is still 3500.50 yuan, and 「提交证据」 is still there.

## Step 16

In the middle column, let the agent analyze a legal question, or write it as a document. It searches pkulaw when that is needed. The lawyer can also write that pkulaw should be searched, or that it should not.

With no checked sources, writing a document or analyzing a legal question searches first. Candidates appear on the right. What is not checked is not stored. The snapshot of a checked original is written as a source, and this question becomes the focus. When checked sources already exist, analyzing and drafting without a pkulaw search use only those sources and do not search again. Asking to search pkulaw searches again, and still does not write what was not checked. With no sources and an instruction not to search, the answer is 「没有勾选出处。这一问先不写结论，也不把法条和案号写成依据。」 It does not write the document.

Documents and judgments use only the checked statutes and cases. It does not choose the claim, the outcome, or the document structure by itself. The document kind is still filled in by the lawyer. What is kept is a new document version. Status, client, usable text, the fee received, and archive are not changed by it. Analyzing or drafting after archive returns 409, 「归档后只供查阅。」

How the lawyer uses it:

- Stay on 问答 in the middle column. Write 「写成一份文书：……」. With no sources yet, the right column switches to candidates. Check one and click 「收下勾选的」. What was not checked stays in the candidates and does not enter the accepted sources.
- Then write 「分析法律问题：……。不查法宝。」 The answer uses only the checked sources. The search sentence on the right does not change, and what was not checked is still not stored.
- Then write 「写成一份文书：……。不查法宝。」 The draft appears beside the conversation. The lawyer writes the kind, for example 情况说明. Edit the body and click 「留下」. What is recorded is this version, and the status is still 草稿.

The API is still the original Q&A, check, and keep:

- `POST /api/matters/:id/ask`, `{ "mode": "问答", "text": "..." }`. This step runs only for writing a document or analyzing a legal question. Whether to search pkulaw is written in that sentence.
- `GET /api/threads/:id/candidates` reads candidates. Candidates are not stored.
- `POST /api/threads/:id/candidates/accept` accepts only what was checked.
- `POST /api/matters/:id/drafts` keeps a document version. The kind and the body are both submitted by the lawyer.

Can be removed:

- Files: `lib/legal-turn.ts` recognizes analysis and drafting, and whether to search. `lib/threads.ts` searches when there are no sources, and when there are sources it gives the model only what was checked.
- The radio buttons for direct search and 分析成文 are still there. The workbench layout was not changed.

### Tests

The API opened a temporary draft. Writing a document with no sources yet causes a search. The focus and the documents are both still empty, and there are at least two candidates. Then analyzing a legal question and writing not to search pkulaw, the answer is 「没有勾选出处。这一问先不写结论，也不把法条和案号写成依据。」 The candidates are still the previous ones, and the sources are still empty. Only the first item was accepted. Analyzing again and writing not to search pkulaw, the answer has content, and there is still one source. Writing a document again and writing not to search pkulaw, the conversation has a document draft and the documents table is still empty. The lawyer writes the kind as 情况说明 and keeps it. The body is the words the lawyer kept. The status is still 草稿 and the fee received is not recorded. Then asking to search pkulaw replaces the candidates with this question. There is still one source, and there is still one document version. Asking to search pkulaw again after archive returns 409, and the conversation row count does not change. The draft was deleted after the test. 李某's status, facts, mandate, fee received, todos, documents, focus, and sources did not change. Steps 7, 10, and 11 were walked again and still passed. The workbench does not have this temporary draft, and the reminders still contain 李某's 「提交证据」. `data/law.sqlite` does not appear.

The browser used a temporary blank card. The client was written as 卯公司. Staying on 问答, writing 「写成一份文书：房屋租赁合同约定租金已经付清，出租人能否再主张租金。」 Statutes and cases appear on the right. Only 「中华人民共和国民法典 第七百五十二条」 was checked and accepted. The four cases stay in the candidates, and the only accepted source is that one statute. Analyzing the legal question again and writing not to search pkulaw, the answer uses only article 752 and does not cite the unchecked cases. Writing a document again and writing not to search pkulaw, the body is the original text of article 752. The kind was written as 情况说明, 「律师改过。」 was added to the body, and it was kept. The page is 「第 1 版 · 情况说明」, and the status is still 草稿. The temporary card was deleted after the test. 李某 is still 已结案, the mandate is still 「先核对付款凭证。」, the fee received is still 3500.50 yuan, there are still two document versions, and there is still one source.
