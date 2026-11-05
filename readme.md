# Law desk

A local case desk for one lawyer. The interface is in Chinese. Cases, files, and API keys stay on the machine that runs it.

## Run

```bash
npm install
copy .env.example .env
npm run dev
```

Open http://localhost:3010.

Put your own keys in `.env`. The names are `DEEPSEEK_API_KEY`, `PKULAW_TOKEN`, and `alpha_API`. Leave a name empty and that feature stops. Nothing in this repository contains a key.

The case database is `data/v3.sqlite`. Original files go in `data/v3-files/`. Both are ignored by git.

## What it does

- Workbench for open cases, pending items, and a question box.
- A case page with materials, chat, todos, and a timeline.
- Statute and case search, a legal consult, and a batch of similar cases.
- Pleadings: civil complaint, appeal, answer, and advocacy brief, with Word export.
- Contract review with three stances. The lawyer edits the suggested rewrite.

## Reading files

Text files, Markdown, Word (`.docx`), and Excel are read directly. Old `.doc` files are not.

A PDF is read with [unpdf](https://github.com/unjs/unpdf). A page that already has a text layer is kept as text. A page with fewer than 20 non-space characters is treated as a scan.

Photos and those thin PDF pages use Windows OCR, language `zh-Hans`:

- A photo is drawn to PNG with `@napi-rs/canvas`, longest edge at most 2000 pixels, then `scripts/ocr-image.ps1` calls `Windows.Media.Ocr`.
- A thin PDF page is rendered by `Windows.Data.Pdf` at 1600 pixels wide, then the same OCR engine runs in `scripts/ocr-pdf-pages.ps1`.

OCR runs when the file is read, on Windows, and needs the Simplified Chinese OCR language pack. The recognized text is marked for the lawyer to check.
