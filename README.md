# Interview Prep Dashboard

A lightweight static interview-preparation dashboard designed for GitHub Pages. There is no backend; a small Node.js script generates the content indexes before publishing.

## Pages

- `index.html` — overview metrics and compact progress charts only.
- `tracker.html` — course progress tracker for the 18 October 2026–31 January 2027 preparation plan.
- `courses/index.json` — list of course CSVs loaded by the tracker on published/static pages.
- `subjects/index.json` — generated subject registry that drives the header menu, dashboard cards, CSV paths, and optional interview shortcuts. Do not maintain the subject list by hand.
- `subjects/<subject>/<subject>.html` — the subject's topic page.
- `subjects/<subject>/<subject>_interview.html` — optional interview question page; its header link is omitted when the HTML page does not exist.
- `subjects/<subject>/<subject>.csv` — that subject's CSV question bank, kept inside its folder.
- `subjects/<subject>/topics/` — the subject's topic folders, Markdown notes, images, and topic manifest.
- `tracker.html` — course progress overview and chapter-level status/completion-date editor.
- `subjects/<subject>/topics/` — topic-specific Markdown and image folders for that subject; C# has a sample manifest and notes.
- `js/topics.js` and `css/topics.css` — read-only topic library rendering and topic/document/image interactions.
- `js/subject.js` — add/edit/delete controls and direct CSV saving for question-bank updates.
- `css/question-admin.css` — responsive question editor and media styles.

## Question bank CSV

Each subject has its own CSV beside its HTML pages (for example, `subjects/csharp/csharp.csv`). Keep this exact six-column header and order:

```csv
Question,Answer,CoreConcept,LanguageTag,Status,Importance
```

- `Question`, `Answer`, `CoreConcept`, and `LanguageTag` are required text.
- `Status` must be `Not Started`, `Learning`, or `Revised`.
- `Importance` must be an integer from `1` to `5`.
- CSV values containing commas, quotes, or line breaks must be enclosed in double quotes. A quote inside a quoted value is doubled (`""`).

The original `.NET` CSV is header-only; each requested demo subject has one starter interview question in its CSV. Add question rows to the appropriate subject folder's CSV. To add a subject, create a folder under `subjects/` with a `topics/` directory and a topic-page shell named `<subject-id>.html`. Add `<subject-id>.csv` to enable its interview bank; an interview page named `<subject-id>_interview.html` is optional and linked only when both files exist. Optional `subject.json` in the folder supplies its display label and description; otherwise the folder name supplies the label. Do not add subjects manually to the generated registry.

### Demo subject content

The demo set covers Azure, Kubernetes, Claude, Design Patterns, GitHub, .NET Core, Microservices, React, SQL, Terraform, C#, and System Design. Each has a topic page, an interview page, one sample question, and at least one Markdown note with an original SVG diagram. The existing `.NET` subject remains separate from `.NET Core`. Regenerate `subjects/index.json` and each topic manifest with `node scripts/generate-content-indexes.mjs` after changing these files.

After changing subject/topic folders or topic Markdown/images, click **Refresh indexes** in the header and choose the project root folder. This is also the shared checkout selector used by the tracker and question editor. The browser scans it and writes `subjects/index.json` plus each subject's `topics/index.json`; review and commit those files with your content. This requires Chrome or Edge on localhost/HTTPS and permission to write to the selected folder. Alternatively, run `node scripts/generate-content-indexes.mjs` from the project root. Existing topic/page titles, descriptions, and image alt text are retained; new titles derive from folder names or Markdown headings. Static hosting cannot enumerate directories at runtime, so the generated JSON must be published with the content.

### Manage questions from a subject page

Each interview page has **Add question**, **Edit**, **Delete**, and study-status controls. Use **Refresh indexes** in the shared header on localhost/HTTPS in current Chrome or Edge to select the project checkout; the selection is shared across pages and restored in this browser. The header button and its edit hint are hidden on mobile and tablet widths, so select the checkout from a desktop-sized browser. Save the CSV from the page, then review and commit `subjects/<subject>/<subject>.csv` to publish changes. If this browser has older locally saved questions, connecting offers to import them into the selected checkout or load the checkout CSV instead. Question editing is disabled until a local checkout is connected; clearing browser site data can discard older unexported local edits.

Question answers accept paragraphs, Markdown bullet lists (`- item`), inline code (backticks), fenced code blocks, Markdown images (`![description](images/example.png)`), regular web links (`[reference](https://example.com)`), and YouTube video links. For example, a fenced code sample can contain ` ```csharp ` on its opening line and ` ``` ` on its closing line. A YouTube link can be a bare URL or Markdown link such as `[Watch the explanation](https://youtu.be/VIDEO_ID)`; recognized links embed responsively. Put image files in the published repository, for example under `images/`, and use a relative path like `![Architecture diagram](images/architecture.png)`. Missing images display a fallback instead of breaking the question card.

### Share an individual question

Expand a question to see **Copy question** and **Share options**. The share menu can open Facebook's share dialog, copy a direct question link, or copy the question and answer text. Each link points to that subject folder's interview page plus a question ID, for example `subjects/sql/sql_interview.html?id=abc123`. Opening that URL loads only the selected question, with its answer expanded.

Facebook receives a direct link to the specific question, but its link preview may show generic subject-page content because Facebook's crawler generally does not run the JavaScript that selects a question. GitHub Pages cannot generate per-question Open Graph metadata at runtime in this JavaScript-only page. A unique Facebook title, description, and image preview for every question would require generating a separate static HTML page for each question during deployment.

## Topic libraries

Every subject is organized into a folder with its topic page, optional interview page, CSV, and a `topics/` directory; for example, C# uses `subjects/csharp/csharp.html`, `subjects/csharp/csharp_interview.html`, `subjects/csharp/csharp.csv`, and `subjects/csharp/topics/`. Each child folder under a subject's `topics/` is one topic and contains its Markdown pages and optional images. C#'s first topic folder and Markdown page open by default. Demo notes and SVG illustrations are included under `subjects/csharp/topics/`.

The header loads discovered subject names and topic-page paths from generated `subjects/index.json`, not from hardcoded HTML links. Interview shortcuts appear only when an interview CSV and page are present. GitHub Pages does not expose a directory-listing API, so run the index generator or use the header refresh icon on localhost/HTTPS to scan a selected checkout and update the JSON indexes. Topic pages are view-only.

Put Markdown files anywhere inside a topic folder and image files in that folder (commonly an `images/` subfolder); the index refresh finds supported image extensions recursively. The carousel supports touch/trackpad swiping, the grid shows all images, and selecting an image opens its full-size viewer. Facebook previews may still use generic page metadata rather than unique image metadata.

To change published topic content, add or remove folders/files in the checkout, refresh the indexes, and commit both the content and generated JSON files.

## Course study tracker

The tracker treats every CSV listed in `courses/index.json` as a course and each non-empty `Section Name` as a chapter. Completion percentage is weighted by the chapter durations; if a course contains a chapter without a parseable duration, its progress falls back to chapter count. The overview displays every course and an overall workload summary on page load. Selecting a course shows chapter status, completion dates, and cumulative progress over time.

Published/static pages load course CSVs read-only. To edit progress, open `tracker.html` on localhost or HTTPS in current Chrome/Edge, choose the project checkout from the shared header, then update chapter statuses and completion dates. The selected checkout is shared across pages and restored in this browser. **Completed** status sets today's completion date; selecting another status clears it, and entering a completion date marks the chapter completed. Save the course CSV from its detail view. The tracker writes directly to that file in `courses/`; review and commit the changed CSV to publish progress. When adding a course CSV, add its filename to `courses/index.json` as well. The tracker does not use `data/tracker.json`.

## Progress and browser storage

Study-status overrides are stored in this browser's `localStorage`, keyed by subject and question identity. Interview-page status and question-bank editing require a checkout selected from the shared header; use **Save CSV** to write changes to the corresponding subject CSV. The dashboard calculates overall progress as the importance-weighted share of questions marked `Revised`; subject progress is the revised share within that subject. There are no proficiency or role-readiness ratings.

Because the app uses `fetch()` to load CSV, run it through a local web server or publish it to GitHub Pages; opening pages directly using `file://` may prevent CSV loading.

## GitHub Pages

1. Commit this folder's contents to the root of a repository (or configure Pages to publish this folder).
2. In GitHub, open **Settings → Pages** and choose the branch and root folder.
3. Visit the published `index.html` URL.


`Set-Location 'D:\Deepak\Office\src\plan'; python -m http.server 8765`
