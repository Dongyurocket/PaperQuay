<h1 align="center">PaperQuay</h1>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

<p align="center">
  <strong>An open-source AI paper workspace for PDF reading, translation, structured overviews, inline notes, Zotero import, Agent workflows, and local RAG.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.3.3-2563eb?style=flat-square" alt="Version v0.3.3">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-4b5563?style=flat-square" alt="Windows macOS Linux">
  <img src="https://img.shields.io/badge/built%20with-Electron-47848f?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-0f766e?style=flat-square" alt="React TypeScript">
  <img src="https://img.shields.io/badge/storage-local%20SQLite-111827?style=flat-square" alt="Local SQLite storage">
  <img src="https://img.shields.io/badge/editor-Tiptap-0d9488?style=flat-square" alt="Tiptap editor">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

<p align="center">
  <a href="#quick-navigation">Quick Navigation</a> |
  <a href="#paperquay---open-ai-paper-workspace-that-keeps-reading-flow-intact">Why PaperQuay</a> |
  <a href="#completed-features">Features</a> |
  <a href="#first-run-workflow">Quick Start</a> |
  <a href="#development">Development</a>
</p>

> 💡 **Project Background & Fork Notice**:
> This repository is a personalized fork and secondary development branch based on the upstream open-source project [WangQrkkk/PaperQuay](https://github.com/WangQrkkk/PaperQuay), maintained by [@Dongyurocket](https://github.com/Dongyurocket) under the `AGPL-3.0-only` license.
> While staying closely synchronized with the upstream core, this fork focuses on **scientific typography & OCR cleaning, raw PDF vector slice (BBox Crop) fallback, LLM-powered block re-parsing/restructuring, automated large document splitting with multi-Key rotation, local RAG index management & self-healing, native MCP hybrid vector retrieval (KNN+FTS5+RRF), and selective Zotero synchronization**. See the [Development Manual](./docs/DEVELOPMENT.zh-CN.md) for fork workflows, upstream sync, and local builds.

<p align="center">
  <img src="./docs/assets/readme-hero.svg" alt="PaperQuay feature overview" width="920">
</p>

---

## Quick Navigation

<p>
  <a href="#paperquay---open-ai-paper-workspace-that-keeps-reading-flow-intact">Problem & Positioning</a> |
  <a href="#latest-update">Latest Update</a> |
  <a href="#what-makes-paperquay-different">What Makes It Different</a> |
  <a href="#core-workflow">Core Workflow</a> |
  <a href="#completed-features">Completed Features</a> |
  <a href="#mcp-server--external-agent-integration">MCP Server</a> |
  <a href="#word-add-in-office-bridge">Word Add-in</a> |
  <a href="#authoring-agent-skills--workflow-collaboration">Skills Authoring</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#zotero-compatibility">Zotero Compatibility</a> |
  <a href="#todo-roadmap">Todo</a>
</p>

---

## Latest Update

### v0.3.3 - Word add-in usability fixes

- **Bibliography inserts at the cursor** (previously always appended at the end of the document), starting a new paragraph when the cursor sits inside a non-empty one; an existing bibliography refreshes in place.
- **Optional heading**: a new "include heading" toggle lets the bibliography be just the entry list, for templates that already ship their own heading.
- **Superscript citations**: new toggle to render numeric in-text citations as superscript; the choice is saved per document and applied on refresh.
- **No more control frames**: inserted citations and the bibliography no longer show Word's content-control bounding box (appearance set to Hidden) — they look like ordinary text while remaining refreshable fields.

### v0.3.2 - Word add-in settings entry fix

- **The "Word add-in (Office bridge)" section is now actually visible in settings**: in 0.3.0/0.3.1 it was mounted inside a legacy library-settings dialog that no longer renders anywhere. It now lives at Settings → Library & Zotero → bottom, where you can copy the connection info, start/stop/restart the bridge, and manage the certificate and page source.

### v0.3.1 - Word add-in certificate trust fix

- **Fixed certificate trust silently failing while reporting success**: the installer and the in-app "Trust local certificate" button only checked the PowerShell exit code, so declining the Windows security prompt still logged "imported" and Word kept showing certificate errors. The import now verifies the certificate store and reports the real cause. If Word still complains after trusting, click "Restart bridge" in settings (the page source reads the certificate only at startup).

### v0.3.0 - Word add-in (Office bridge)

- **Citations and a bibliography inside Word**: a new Office.js task pane add-in inserts citation fields in the body and a refreshable bibliography field at the end. GB/T 7714-2015 numeric is the default, with GB/T author-date, APA 7, and IEEE selectable; page locators, prefixes/suffixes, author suppression, unlinking, and "cited in this document" write-back are supported.
- **Local read-only bridge, data stays on this machine**: PaperQuay serves a token-protected read-only HTTP bridge on `127.0.0.1` (default port 23120). The only write path records which Word documents cite a paper, and can be disabled.
- **One formatting source of truth**: the notes workspace, Obsidian vault export, MCP, and the Word add-in now share `src/shared/citation/`; this also fixed the GB/T conference style (`[C]//proceedings`), added the missing place-of-publication field, and renders Western authors as "family + initials".
- See [docs/OFFICE_ADDIN.zh-CN.md](./docs/OFFICE_ADDIN.zh-CN.md) for install, usage, API contract, and limitations. Microsoft Word only; WPS and LibreOffice are not supported.

### v0.2.1 - Table inline-math fix and a Chinese user manual

- **Fixed: inline math inside Markdown tables degraded to literal `$`**: when a table cell contained bare LaTeX (e.g. `仅 T_i`), the inline-math wrapper's candidate run crossed the `|` cell delimiter and swallowed the neighbouring cell, so the inserted `$` landed in two different cells; remark-math never pairs across cells and the whole row rendered as literal `$`. Table rows are now wrapped cell by cell, while expressions containing `|` outside tables (`A = |x| < 1`, `P(A | B) = 0.5`) behave exactly as before.
- **New Chinese user manual ([docs/USER_MANUAL.zh-CN.md](./docs/USER_MANUAL.zh-CN.md))**: covers installation and first run, library and reader, note authoring and maintenance, the Agent workspace, knowledge graph, review drafting, local RAG, MCP integration, backups and privacy, settings reference and troubleshooting, plus keyboard-shortcut and FAQ appendices.

### v0.2.0 - Notes System Overhaul

- **Agents and MCP can read and write notes**: the built-in Agent gains note read tools and a `write_notes` tool behind a dedicated approval card (creates/updates/deletes land only after diff review); the Knowledge MCP server exposes `create_note` / `update_note` / `delete_note` / `list_note_tags` plus folder management, reusing the same write guardrails.
- **Structured note workspace**: folder tree moved into the database (survives reinstalls, syncs over WebDAV), 8 page types and 11 templates, notes graph and health report (orphans / broken links / untagged / stale 30+ days), and Obsidian-compatible Markdown vault two-way sync where anchor IDs survive the round trip.
- **Academic citations and excerpt cards**: inline `paperReference` nodes render as sequential `[n]` with a GB/T 7714 reference list in vault exports; "AI Distill to Card" runs a two-step CoT that cleans OCR noise before paraphrasing, keeps source anchors jumpable back to the exact PDF location, and appends multiple page segments onto one multi-anchor card.
- **Cleanup**: the legacy one-shot Agent path (~800 lines) and the `agentLegacyMode` toggle were removed; the multi-turn ReAct loop is now the only path.

### v0.1.51 - Fixed jump-to-position for note citations

- **Excerpt cards and reference locations jump again**: fixed anchor `blockId` / `pageIndex` being dropped on save, so the page button on note excerpt cards (e.g. `P20`) and the location chips in the reference list scroll to the matching position in the paper.
- **No migration for existing notes**: positions are recovered at click time from the anchor id (`…:mineru:page-20-block-3:0`) and the page label.
- **Resilient fallback**: exact MinerU block → same-page body block → whole-page highlight; papers without structure blocks no longer wait forever, and the notice only appears when there is genuinely no location.

### v0.1.50 - Note references, polish retrieval fix, and long-document reader windowing

- **Note references**: insert paper citations from the toolbar, slash menu, or `@`; clicking a citation opens the paper and can jump to a page or block. The sidebar and end-of-note list are derived live from the note JSON and are not stored separately.
- **AI polish retrieval fix**: queries now match both the bare `paper.id` and the `native-library:` prefix; evidence is ranked globally and truncated to the top 8. Dimension mismatches and missing model citations get explicit notices. Polish defaults to the note's linked papers.
- **Long-document reader windowing**: dual-pane reading windows structure blocks, thumbnails, and PDF overlay hosts to the viewport, unloads off-screen Markdown/KaTeX, and disables PDF.js eager `getPage`, so dissertations and textbooks no longer slow down linearly with page count.

### v0.1.49 - MCP Library Write & Category Management Tools

- **MCP toolset grows to 15 tools**: new `import_pdfs` (batch PDF import with content-hash dedupe, copy/move/keep modes and find-or-create categories by name), `list_categories`, `manage_category` (create/rename/move/delete with cycle detection and cascading unlink), `set_paper_categories` (batch assignment with all-or-nothing validation), `update_paper` (whitelisted metadata updates), and `delete_papers` (optional file removal) — write semantics fully aligned with the desktop app.
- **Write safety guard**: every write tool detects the running desktop app and explicitly refuses to write while it is active (the app's in-memory save would silently overwrite external writes); `allowWhileAppRunning: true` overrides, and `PAPERQUAY_MCP_WRITE=off` makes the server globally read-only. Zotero sync is covered by the same guard.
- **Read enhancements**: `search_papers` supports `categoryId` filtering (including descendant categories), and `get_paper_details` returns category IDs.

### v0.1.48 - Prose Rendering, PDF-image Reparsing and OCR Task State Fixes

- **Preserve prose**: ordinary paragraphs and inline mathematics are no longer automatically reconstructed as symbol tables.
- **Unified block reparsing**: use the original PDF crop as primary input with OCR as reference; show the actual image or explicit text-only fallback, and preview, save or restore local corrections.
- **Reliable PaddleOCR completion**: backend document tasks finish after results are saved, retain progress across reader-tab closure, and handle download timeouts and stale callbacks explicitly.

### v0.1.47 - PaddleOCR-VL 1.6 Engine, Forced Re-parsing & Image Reference Self-Healing

- **Fixed: PaddleOCR-VL submits wrongly reported as failures (v0.1.47 hotfix)**: the async Jobs API error envelope actually uses `code` / `msg`, but the implementation checked `errorCode` as documented for the synchronous service — so a **successful** submit was rejected and its `jobId` discarded, leaving the engine unusable in v0.1.46. Success is now determined by the presence of `data.jobId`, failures report the HTTP status, real `code` / `msg`, `traceId`, and a raw response snippet, and pasting the full job URL from the Baidu console no longer breaks the base URL.

- **PaddleOCR-VL 1.6 Structure Recognition Engine**: Settings → Document Parsing now offers an engine selector between MinerU and PaddleOCR-VL 1.6 (cloud async Jobs API), applied uniformly across the reader, library, and batch parsing paths. The adapter normalizes PaddleOCR-VL output into the existing MinerU cache contract, so structured reading, image rendering, PDF↔block geometry linking, translation, RAG, and cache self-healing are reused with zero changes; layout coordinates and page sizes map to `pdf`-space bboxes, figure/table captions attach to the adjacent visual block, assets support both Base64 and presigned URLs, and documents above 100 pages are split and merged automatically.
- **Forced Re-parsing (Ignore Cache)**: New "Re-parse / Re-recognize" entries in the reader toolbar and overview page; library parsing no longer unconditionally reuses existing results. Translations, summaries, and images are backed up before re-parsing, cleaned up on success, and retained for rollback on failure.
- **Parse Cache Image Reference Self-Healing**: A new idempotent repair command repoints image references that target missing files to the volume files that actually exist, without re-uploading the PDF or spending quota. It runs automatically when a document is opened, and Settings offers a full-library scan.
- **Fixed: All Images Broken After Split/Merge of Oversized Documents**: When long documents (>200 pages) are automatically split and merged, the `content_list_v2.json` "page array + per-page block dictionary" structure was not recognized, and asset paths actually live in the nested `content.image_source.path` rather than at block top level, so image references were never rewritten — images were renamed with a `part_N_` prefix and the Markdown was updated, but the structured JSON kept stale references, producing a flood of "No matching image asset was found" cards. References are now rewritten at any depth while preserving all three real-world shapes. Full-library reconciliation: all 2859 broken references across 9 oversized documents were recovered.

### v0.1.43 - Full Library RAG Pool Ingestion, Fixed-Point Resume Self-Healing & Large Thesis Compatibility

- **Full Library RAG Ingestion & State Synchronization**: Fixed issue where home library papers were omitted from RAG candidate pools, causing zero stats and inactive context menus; entire library entries are now actively synced with real-time MinerU status tracking.
- **RAG Resume Infinite-Loop Self-Healing**: Refactored resume logic to calculate chunk ID diffs against stored rows, thoroughly resolving fixed-point deadlocks caused by missing low-order chunks; added atomic state convergence and stale chunk cleanup.
- **Large Dissertation MinerU Page Dictionary Compatibility**: Handled `Array<Record<string, Block>>` page object structures produced by MinerU multi-volume merges for 200~300+ page dissertations, successfully restoring full-text structural blocks and RAG vector chunking.
- **Orphan Failure Cleanup & Error Propagation**: Automatically purges stale `pdf-text:failed` placeholder records when the primary `mineru-markdown` source is already ready. Added structured error notifications for single-paper and batch indexing.
- **Startup Hang Fix**: Resolved Electron IPC serialization hang caused by unawaited Promises in `paths_exist`, eliminating the bug where library items stayed permanently stuck on "Checking MinerU".

### v0.1.42 - Knowledge Base MCP Hybrid Vector Retrieval (KNN+FTS5+RRF) & RAG Indexing Management

- **MCP Knowledge Base Hybrid Vector Retrieval**: The stdio MCP service `search_knowledge_base` now vectors search queries and fuses vector KNN and FTS5 BM25 results using Reciprocal Rank Fusion (RRF), achieving full semantic parity with desktop in-app search; supports `auto`, `hybrid`, and `keyword` modes with result `channels` tracking and graceful degradation.
- **Local RAG Knowledge Base Management Console**: Settings panel now features an index management card displaying indexed / pending / failed counts, one-click "Index unindexed papers" and "Rebuild failed indexes" with a real-time progress bar and pause / resume / cancel controls.
- **Library RAG Status Badges & Context Menu Force-Retry**: Literature items now show dedicated RAG status badges (Indexed / Indexing / Unindexed / Failed); right-click menu provides "Build/Rebuild RAG Index" to force single-paper resume retries without re-spending embedding quota.

*For full historical releases (v0.1.32 - v0.1.45 including multi-key scheduling, large PDF split/merge, selective Zotero sync, BBox crop, and AI re-parsing), see [CHANGELOG.md](./CHANGELOG.md).*

---

## PaperQuay - Open AI Paper Workspace That Keeps Reading Flow Intact

**PaperQuay is more than a PDF reader, AI summary tool, or Zotero add-on.** It is a local-first, open-source AI paper workspace designed for graduate students, researchers, and heavy paper-reading users who want to import papers, read PDFs, translate, generate paper overviews, write inline research notes, organize tags, import Zotero libraries, use Agent-assisted literature management, and build a local RAG knowledge base without leaving the same desktop app.

Traditional paper reading often means switching between Zotero, a PDF reader, translation tools, ChatGPT, and a separate note app. PaperQuay brings those steps into one continuous desktop workflow so importing, reading, understanding, translating, annotating, note-taking, organizing, and knowledge-base building can happen in the same place while keeping Zotero compatibility optional rather than mandatory.

Technically, PaperQuay is built as an Electron + React + TypeScript/Vite desktop application. The React renderer implements the literature library, PDF reader, rich notes, Agent workspace, and settings UI; the Electron main process and local Node.js backend handle filesystem access, IPC, Zotero import, SQLite persistence, app updates, and cross-platform packaging. PDF rendering uses PDF.js, rich notes use Tiptap/ProseMirror, local data uses SQLite/sql.js and sqlite-vec, and AI features connect through OpenAI-compatible APIs for translation, paper overviews, Agent tool use, and RAG retrieval.

| Research workflow problem                 | Traditional tools                                                  | PaperQuay                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Translation latency interrupts reading    | Translate only after selecting text, often with visible API delay  | Pre-translate MinerU structural blocks and jump instantly to cached translations           |
| Side-by-side translation hurts focus      | Two columns require constant eye movement and can break formatting | Keep the original PDF visible while navigating to precise translated blocks on demand      |
| Pure translated files lose source context | Original wording, terminology, and academic expression are hidden  | Keep source text, parsed blocks, translation, notes, and overview linked together          |
| Paper notes become detached               | Notes live in a separate app and lose PDF position context         | Store rich notes, tags, links, paper references, and backlinks in the local library        |
| Fast paper screening is repetitive        | Upload PDFs to an LLM one by one and manually organize outputs     | Generate and store structured paper overviews inside the local library                     |
| AI model choices are locked down          | Built-in models or platform-specific token pricing                 | Bring your own OpenAI-compatible endpoint, model, and runtime parameters                   |
| Large libraries are hard to clean         | Manual renaming, tagging, metadata fixes, and classification       | Agent tools can assist with batch rename, metadata completion, tagging, and classification |
| Zotero migration is inconvenient          | Either stay locked in Zotero or rebuild everything manually        | Import Zotero collections, tags, and PDF attachments as an optional source                 |

---

## What Makes PaperQuay Different

<p align="center">
  <img src="./docs/assets/show.gif" alt="PaperQuay workflow demo" width="1200">
</p>

<p align="center">
  <em>Live workflow demo: browse the library, open papers, inspect structured reading, and move into the Agent workspace without leaving the same desktop flow.</em>
</p>

### Instant Block-Level Translation

PaperQuay uses a translation workflow designed for long paper reading sessions. It can translate and cache MinerU-parsed structural blocks in advance. Later, when reading, clicking a source block can instantly jump to its translated counterpart. Translation no longer needs to happen only after each click or selection.

### Tiptap-Based Notes Workspace

PaperQuay includes a dedicated Notes workspace built on Tiptap. Each note is stored locally as Tiptap JSON, rendered HTML, and searchable plain text. The editor supports headings, lists, task lists, code blocks, tables, images, math, highlights, links, slash-style insertions, folders, pin and favorite states, outline, backlinks, a derived reference list, and autosave.

Notes are designed to stay inline with the research workflow. You can connect ideas with `[[note]]` links, organize topics with `#tags`, cite library papers with `@paper`, and open the cited paper (jumping to a page or block when the reference carries a location). AI polishing defaults to retrieving the note's linked papers from the local knowledge base and writes locatable citations back into the note.

### Fast Paper Screening from the Overview Panel

PaperQuay is designed not only for deep reading, but also for screening large numbers of papers quickly. In the overview panel, each paper can directly surface AI-generated fields such as background, research question, method, experiment setup, key findings, conclusions, and limitations.

### Reading Time Visibility

PaperQuay records time spent across PDF positions and surfaces it as reading heat previews in the library and a dedicated reading-time chart in the paper detail panel. This makes it easier to see which parts of a paper have actually received attention.

### Literature Library, Not Just Import

PaperQuay can build an independent local library with PDF import, a configurable storage folder, categories, tags, metadata editing, search, filtering, notes, and local SQLite persistence. Zotero remains supported as an optional import source, not a required dependency.

### Agent Operations for Paper Management

The agent workspace is designed for library operations, not just conversation. It can assist with batch renaming, metadata completion, smart tagging, tag cleanup, automatic classification, and paper summarization while exposing tool calls and results for user review.

---

## Core Workflow

| Step                   | What happens                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- |
| 1. Import PDFs         | Drag PDFs into the app or choose files from the import dialog.                        |
| 2. Confirm metadata    | Review title, authors, year, venue, DOI, abstract, keywords, and duplicate warnings.  |
| 3. Organize library    | Create categories, drag papers into collections, add tags, and mark favorites.        |
| 4. Parse with MinerU   | Convert PDFs into structured blocks with page-region linkage.                         |
| 5. Generate overviews  | Produce reusable paper overviews for fast screening and later review.                 |
| 6. Translate full text | Cache translated blocks so reading can jump instantly between source and translation. |
| 7. Read and annotate   | Highlight, write, add notes, jump to annotations, and export annotated PDFs.          |
| 8. Review reading time | Inspect reading-time charts and heat previews to see which parts of the PDF were read. |
| 9. Write notes         | Create rich Tiptap notes, organize them in folders, link notes with `[[title]]`, add `#tags`, and jump through `@paper` references. |
| 10. Use the agent      | Ask the agent to rename, classify, tag, clean metadata, or summarize selected papers. |

---

## PaperQuay Screenshots

<p align="center">
  <img src="./docs/assets/main.png" alt="PaperQuay literature library workspace" width="1200">
</p>

<p align="center">
  <em>Main library workspace: manage papers, categories, metadata, reading progress, notes, and AI-generated overviews in one desktop view.</em>
</p>

<p align="center">
  <img src="./docs/assets/agent.png" alt="PaperQuay agent workspace" width="1200">
</p>

<p align="center">
  <em>Agent workspace: chat with the paper assistant, inspect execution traces, review tool calls, and run batch library operations with human confirmation.</em>
</p>

---

## Completed Features

These items are implemented in the current desktop app.

| Area              | Completed capabilities                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Local library     | Local SQLite storage for papers, authors, categories, tags, attachments, notes, annotations, import records, settings, and RAG indexes; full library actively ingested into RAG indexing pool with real-time MinerU status tracking; startup orphan failure record self-healing; async batch file-existence IPC optimization; multi-select and batch operations (delete, move to category, favorite) |
| Local RAG Index & Management | Vector KNN + FTS5 BM25 + RRF hybrid retrieval with Chinese trigram tokenization; settings panel indexing management console (stats, batch indexing, progress bar, pause/resume/cancel); real-time RAG status badges in literature list; right-click single-paper resume retry using chunk ID diffing and stale chunk cleanup |
| MinerU & Large Documents | MinerU cloud parsing with PDF region linkage; multi-key entry with Round-Robin scheduling and automatic failover; automated lossless splitting for documents > 200 pages (150-page safe margins) and local precise multi-part merging (page offset calibration, image namespace isolation, page dictionary unpacking); cross-page table stub hiding |
| PDF import        | File picker and drag-and-drop import with a confirmation screen before files enter the library                                                  |
| File management   | Configurable storage folder, copy / move / keep-path import modes, naming rules, original-path tracking, and private local file handling        |
| Metadata          | OpenAlex enrichment by DOI or title, optional OpenAlex API key / mailto settings, Crossref fallback, LLM-based extraction for Chinese papers when remote lookups miss, and manual editing before import |
| Categories        | System categories, custom categories, nested subcategories, collapsible branches, context menus, drag sorting, hierarchy changes, and favorites |
| Paper details     | Title, authors, year, venue, DOI, URL, abstract, keywords, tags, notes, citation, favorite state, and a reading-time chart                      |
| Notes workspace   | Dedicated Tiptap notes workspace with folders, search, tags, pinned notes, favorites, outline, backlinks, a derived reference list, and local autosave |
| Notes editor      | Rich text, headings, lists, task lists, code blocks, tables, images, math, highlights, links, component blocks, and slash-style insertions; insert paper references from the toolbar, `@`, or slash menu, and upsert an end-of-note reference list; AI polishing defaults to the note's linked papers |
| Inline note links | `[[note]]` wiki links, `#tag` references, `@paper` citations, autocomplete menus; clicking a citation opens the paper and can jump to a page or block |
| Reader & Typography | PDF reader with MinerU structured block views, region-based linkage, reading heat progress, reading-time recording, and annotation tools; long documents (theses/textbooks/reports) window structured blocks and page thumbnails to the viewport so dual-pane scrolling stays responsive; auto-cleans ligatures and cross-reference fake superscripts, renders semantic academic `<sup>`/`<sub>`, fixes drop-caps, and restructures nomenclature |
| Raw Crop & AI Re-parsing | PDF raw vector slice (BBox Crop) fallback with KaTeX formula failure safeguards; LLM-powered block re-parsing (smart typography, table/nomenclature, math extraction) with diff preview and one-click undo |
| Translation       | Full-text translation, cached block translations, and selection translation through OpenAI-compatible models, plus batch paper title translation; Chinese-dominant papers skip translation automatically and Chinese titles are adopted directly; centralized translated PDF storage |
| Citation export   | Batch Bib export for selected papers as one merged .bib file or one file per paper, with deduplicated citation keys and heuristic entry types       |
| Paper overview    | AI-generated screening fields for background, research questions, methods, experiment setup, findings, conclusions, and limitations              |
| Agent workspace   | Conversation UI with execution traces, tool call cards, paper selection, metadata tools, rename tools, tagging, classification, and summaries    |
| Zotero import & sync | Full import of local Zotero collections, tags, and available PDF attachments from `zotero.sqlite`; selective on-demand synchronization with collection browsing, conditional search, diff preview, and triple deduplication |
| MCP knowledge base | Built-in standard stdio MCP server (`bin/paperquay-mcp.cjs`) directly querying local SQLite; `search_knowledge_base` upgraded to vector hybrid retrieval (KNN + FTS5 + RRF) with mode options and channel attribution; full literature, chunk, note, and Zotero sync toolchain |
| Backup            | WebDAV backup and restore for the library database, notes database, and local RAG SQLite database                                                |
| Updates           | In-app update checks, Windows and Linux automatic update flow, and macOS release-page handoff                                                    |
| Knowledge graph   | Paper, note, tag, category, and reference nodes with semantic-similarity edges, Crossref reference syncing, co-author relations, custom and AI relations, fcose force-directed global layout, local concentric view, and PNG/JSON export |
| Review writing    | Outline blueprints, concurrent section drafting, RAG retrieval context, per-task failure reporting with resume, and Word export with OMML equations, localized headings, references, and inline figures |
| Word add-in       | Office.js task pane that inserts citation fields and a bibliography field in Word, defaults to GB/T 7714-2015 numeric (with GB/T author-date, APA 7, IEEE), refreshes and renumbers the whole document, supports locators/prefixes/suffixes/author suppression, unlinking, and "cited in this document" write-back; the add-in reaches the library through a local read-only bridge on `127.0.0.1` with a Bearer token, so data never leaves this machine; Microsoft Word only (no WPS / LibreOffice) — see [docs/OFFICE_ADDIN.zh-CN.md](./docs/OFFICE_ADDIN.zh-CN.md) |
| Themes            | Light and dark UI modes optimized for long desktop reading sessions                                                                               |

---

## Word Add-in (Office Bridge)

No more copying a reference list out of your notes by hand: PaperQuay ships a Microsoft Word add-in (Office.js task pane) that inserts citations in the body and a bibliography at the end, and renumbers the whole document on refresh.

- **GB/T by default**: GB/T 7714-2015 numeric (`[n]`, same paper same number, ranges collapsed to `[1-3]`), switchable to GB/T author-date, APA 7, or IEEE. The style is stored in the document itself.
- **Citations are fields, not dead text**: each citation is a ContentControl (`pq:c|<citeId>`), the bibliography is a single `pq:bib` control, and the item details live in document settings. "Unlink" turns the fields into plain text before submission.
- **Local read-only bridge**: the add-in runs in a browser sandbox and cannot read the database, so the PaperQuay main process serves a read-only HTTP bridge on `127.0.0.1` (default 23120; Zotero uses 23119) authenticated with a per-launch random Bearer token, advertised through `<userData>/PaperQuay/paperquay-office-bridge.json`. CORS echoes allowlisted origins only and never `*`. The single write path records "cited in this document" and can be disabled.
- **One formatting source of truth**: the add-in renders text produced by `src/shared/citation/`, the same module used by notes, vault export, and MCP.

Install (Windows desktop, sideloaded, no store account needed) — two routes:

- **exe installer (recommended)**: run `PaperQuay-OfficeAddin-Setup-<version>.exe` (double-click for the GUI, or `--silent` / `--uninstall` / `--diagnose` from the command line). It writes the certificate, manifest, and sideload registry key for the current user only (no admin rights needed); the add-in pages are hosted by the running PaperQuay app itself. Developers can compile it with `npm run office-addin:installer` (only needs the .NET Framework csc that ships with Windows).
- **Developer script route**:

```powershell
npm run build                # includes build:citation
npm run office-addin:build   # verify/copy add-in assets and generate icons
npm run office-addin:serve   # local HTTPS server (self-signed cert; --trust to trust it)
npm run office-addin:install # sideload into Word
```

Then open the "PaperQuay 引用" task pane in Word and paste the connection info from PaperQuay settings → "Word add-in (Office bridge)".

See [docs/OFFICE_ADDIN.zh-CN.md](./docs/OFFICE_ADDIN.zh-CN.md) for details (API contract, document model, limitations, troubleshooting).

---

## MCP Server & External Agent Integration

PaperQuay includes a built-in server adhering to the standard **Model Context Protocol (MCP)** (entry point: `bin/paperquay-mcp.cjs`). External AI Agents (such as Proma, Claude Desktop, Cursor, Pi Agent, and Codex) can connect via stdio to access the local PaperQuay SQLite knowledge base with millisecond read latency, retrieve grounded citations with page numbers, perform selective Zotero library imports, and execute guarded library writes (PDF import, metadata updates, category management, paper deletion).

### Highlights

1. **Zero Runtime Dependency**: Direct connection to SQLite databases via Node.js—**the PaperQuay desktop application does not need to be running**.
2. **Lock-Free Concurrency**: Operates under SQLite WAL mode; external Agent read queries never lock or block user operations in the desktop application.
3. **Hybrid Vector Retrieval (KNN + FTS5 + RRF)**: When an Embedding API is configured in PaperQuay reader settings, `search_knowledge_base` automatically vectors queries, retrieves candidates across both `sqlite-vec` vector index and FTS5 BM25 pools, and merges results via Reciprocal Rank Fusion (RRF); automatically falls back to keyword search if unconfigured or unreachable.
4. **Academic Evidence Chain with Absolute Page Numbers**: Returns structured evidence chunks with paper titles, 1-based page numbers (`pageNumber`), block IDs (`blockId`), and matched retrieval channels (`channels: ['vector', 'fts']`), enabling hallucination-free citations.
5. **Write Safety Guard**: Before every mutation, write tools detect whether the PaperQuay desktop app is running—if so, the write is explicitly refused (the app's in-memory save would silently overwrite external writes). Pass `allowWhileAppRunning: true` to override, or set `PAPERQUAY_MCP_WRITE=off` to make the server globally read-only.

### Available MCP Tools

The server registers 15 standard MCP tools across three operational domains:

#### 1. Knowledge Base Read-Only Tools (5 tools)
| Tool Name | Description | Key Parameters | Return Fields |
| :--- | :--- | :--- | :--- |
| `search_papers` | Search literature metadata | `query`, `tag`, `categoryId` (incl. descendant categories), `limit` | Paper ID, titles, authors, year, DOI, tags |
| `get_paper_details` | Full bibliographic metadata & details | `paperId` (required) | Bibliographic info, abstract, AI overview, notes, publication, category IDs |
| `search_knowledge_base` | **Hybrid vector retrieval** for RAG chunks | `query` (required), `paperId`, `limit`, `mode` (`auto`/`hybrid`/`keyword`) | Paper title, page number, text snippet, relevance score, `retrievalMode`, `channels` |
| `read_paper_content` | Read MinerU structured text by page | `paperId` (required), `pageIndex` (0-based), `limit` | Sequential structured markdown & text blocks |
| `search_notes` | Search user reading notes and highlights | `query`, `paperId`, `limit` | Reading notes, excerpt highlights, and thoughts |

#### 2. Zotero Selective Synchronization Tools (4 tools)
| Tool Name | Description | Key Parameters | Return Fields |
| :--- | :--- | :--- | :--- |
| `zotero_list_collections` | Read local Zotero collection tree | `dataDir` (optional) | Collections (key, name, parent), item counts, detected path |
| `zotero_search_items` | Search Zotero literature conditionally | `query`, `collectionKey`, `limit`, `dataDir` | Candidates, title, creators, year, DOI, local PDF availability |
| `zotero_preview_sync` | **Pre-sync diffing & deduplication** | `itemKeys`, `collectionKey`, `dataDir` | Diff report: `ready`, `alreadyExists`, `missingPdf` |
| `paperquay_sync_from_zotero` | **Execute safe sync & PDF copying** | `itemKeys`, `collectionKey`, `targetCategoryId`, `createCollectionCategory` | Import stats: succeeded count, skipped count, assigned categories |

#### 3. Library Write & Management Tools (6 tools, guarded)

These tools modify the local library database. Each one checks the desktop app process before writing and **explicitly refuses while it is running** (override with `allowWhileAppRunning: true`; disable all writes globally with `PAPERQUAY_MCP_WRITE=off`).

| Tool Name | Description | Key Parameters | Return Fields |
| :--- | :--- | :--- | :--- |
| `import_pdfs` | Batch-import local PDFs (content-hash dedupe) | `paths` (required), `metadata` (keyed by path), `targetCategoryId` or `categoryName`, `importMode` (`copy`/`move`/`keep`) | `imported`/`duplicates`/`errors` breakdown + summary |
| `list_categories` | Read category tree with paper counts (read-only) | — | Categories (incl. system ones, `parentId`, `paperCount` incl. descendants) |
| `manage_category` | Create/rename/move/delete categories | `action`, `categoryId`, `name`, `parentId` | Mutated category; delete cascades sub-categories and unlinks papers |
| `set_paper_categories` | Batch-assign paper categories | `paperIds`, `add`/`remove` or `replace` | Updated `categoryIds` per paper (all-or-nothing validation) |
| `update_paper` | Update paper metadata (whitelisted fields) | `paperId` + `title`/`authors`/`tags`/`isFavorite` etc. | Updated paper object |
| `delete_papers` | Batch-delete papers | `paperIds`, `deleteFiles` (default `false`) | Deletion report (`deletedFileCount`, `fileErrors`) |

### Hybrid Search Modes & Configuration

The `mode` parameter in `search_knowledge_base` governs retrieval execution:
- `auto` (default): Uses embedding settings stored in `<DataDir>/.settings/paperquay.config.json`. If valid, runs dual-channel hybrid retrieval; otherwise falls back gracefully to FTS5 keywords.
- `hybrid`: Forces hybrid retrieval. If embedding credentials are missing or dimension mismatch occurs, safely falls back to keyword search and returns a `warning` explaining the cause.
- `keyword`: Forces keyword-only search, generating zero network requests. Ideal for offline use or exact formula/symbol lookups.

*Privacy Note: Hybrid retrieval sends only the search query to your configured Embedding endpoint. Set environment variable `PAPERQUAY_MCP_EMBEDDING=off` to disable all vector network calls globally.*

### Client Configuration Examples

#### 1. Proma Agent
Add to `mcp.json` in your Proma workspace:
```json
{
  "servers": {
    "paperquay": {
      "type": "stdio",
      "command": "node",
      "args": ["<ABSOLUTE_PATH>/bin/paperquay-mcp.cjs"],
      "enabled": true
    }
  }
}
```

#### 2. Claude Desktop / Claude Code
Add to `claude_desktop_config.json` under `mcpServers`:
```json
{
  "mcpServers": {
    "paperquay": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH>/bin/paperquay-mcp.cjs"]
    }
  }
}
```

#### 3. Cursor
Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "paperquay": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH>/bin/paperquay-mcp.cjs"]
    }
  }
}
```

#### 4. Pi Coding Agent
Add to `~/.pi/agent/mcp.json`:
```json
{
  "mcpServers": {
    "paperquay": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH>/bin/paperquay-mcp.cjs"]
    }
  }
}
```

---

## Authoring Agent Skills & Workflow Collaboration

While raw MCP tools provide low-level endpoints, complex academic workflows require **Agent Skills** to orchestrate tools into dependable Standard Operating Procedures (SOPs), enforce evidence citation formatting, and protect against unintended database modifications.

PaperQuay provides two official, production-verified reference Skills:

### Official Skill Reference Architectures

#### 1. Literature Evidence Search Skill (`paperquay-knowledge-search`)
- **Trigger**: Activated when users ask "Does my library discuss X?", "Summarize topic X from my papers", or "What does page 5 of paper Y say?".
- **Execution Pipeline**:
  ```
  User Query ──> search_papers (filter metadata to locate paperId)
             ──> search_knowledge_base (extract semantic chunks with optional paperId scope)
             ──> read_paper_content (read continuous pages if deeper context needed)
             ──> Academic Answer (with strict citations: [1] (Title, P.x, blockId))
  ```
- **Guiding Rules**:
  - Check `channels`: `['vector', 'fts']` double-hits represent highest reliability; `['vector']`-only hits should be checked for topical drift.
  - Strict grounding: Answers must rely strictly on returned snippets. Provide citations in `[#] (Title, P.x)` format. If no evidence matches, report explicitly rather than hallucinating.

#### 2. Selective Zotero Synchronization Skill (`paperquay-zotero-sync`)
- **Trigger**: Activated when users ask "Sync collection X from Zotero" or "Import recent diffusion papers into PaperQuay".
- **Four-Stage Safe Sync SOP (Never write before preview)**:
  ```
  [1. Intent & Search]  ──> Call zotero_list_collections or zotero_search_items
  [2. Pre-sync Diff]    ──> Call zotero_preview_sync to detect ready / duplicate / missing-PDF items
  [3. Markdown Report]  ──> Present clear summary table and request user confirmation
  [4. Execute Sync]     ──> Call paperquay_sync_from_zotero upon confirmation and report results
  ```
- **Guiding Rules**:
  - Defense against unapproved writes: Sync is a write operation; the Agent must present a structured preview and receive explicit user consent before calling `paperquay_sync_from_zotero`.
  - Lifecycle awareness: Inform the user that newly synced papers must be opened in the desktop app to generate MinerU parsing and RAG vector indexes before full-text QA is possible.

### Authoring Your Own Academic Skill

To create custom skills (e.g., automated literature review writing, novelty comparative analysis), follow this standard template in `skills/<skill-name>/SKILL.md`:

```markdown
---
name: your-skill-name
description: Define explicit triggers (keywords, phrasing) and non-triggers (negative boundaries) so the Agent router dispatches accurately.
version: "1.0.0"
---

# Skill Title & Overview

Briefly explain the academic scenario and expected outcomes.

## 1. Tool Selection & Security Boundaries
- List required PaperQuay MCP tools;
- Enforce read-only bounds vs. write operations with human confirmation checkpoints.

## 2. Standard Operating Procedure (SOP)
Step-by-step workflow (Step 1 ➔ Step 2 ➔ Step 3) specifying input schemas, tool parameters, and decision criteria.

## 3. Output Guardrails
- Citation rules: enforce Paper Title, Authors, Year, and 1-based Page Number;
- Graceful fallbacks for empty search results or offline environments.
```

---

## First-Run Workflow

1. Open Settings and choose a default paper storage folder.
2. Import PDFs by drag and drop or by clicking the import button.
3. Confirm or edit metadata in the import confirmation dialog.
4. Let PaperQuay copy PDFs into its storage folder and save records in the local library.
5. Create categories and subcategories from the left sidebar.
6. Drag papers into categories, add tags, mark favorites, and open papers in the reader.
7. Open Notes to create rich-text notes, link related ideas, and connect notes to papers.
8. Configure an OpenAI-compatible endpoint and model if you want AI features.
9. Configure a MinerU API key if you want MinerU parsing.
10. Optionally connect a Zotero data directory and import existing Zotero collections and PDFs.

---

## Architecture

PaperQuay uses Electron as its desktop host. The React renderer talks to a local Electron backend through IPC for filesystem access, persistence, Zotero import, PDF handling, and packaging.

| Path                       | Responsibility                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/`                     | React + TypeScript UI, feature modules, state, and frontend services                                              |
| `src/features/literature/` | Local literature library UI, import workflow, category tree, and paper details                                    |
| `src/features/reader/`     | Reader shell, linked reading workspace, settings, and AI reading actions                                          |
| `src/features/pdf/`        | PDF rendering, overlays, annotation surface, and PDF-specific interactions                                        |
| `src/features/blocks/`     | MinerU block rendering and structured content views                                                               |
| `src/features/agent/`      | Agent chat UI, execution traces, tool cards, and library operation entry points                                   |
| `src/features/notes/`      | Tiptap-based notes workspace, editor toolbar, custom autocomplete extensions, outline, and backlinks              |
| `src/stores/useNotesStore.ts` | Zustand state for notes, tags, active note selection, autosave, and workspace errors                           |
| `src/services/`            | Frontend bridges to Electron IPC commands                                                                         |
| `src/platform/electron/`   | Renderer-side bridge wrappers for commands, events, window controls, and file-drop events                         |
| `electron/`                | Electron main process, preload bridge, command backend, packaging helpers, and local persistence                   |

The Notes editor uses the official Tiptap packages and was implemented against the upstream source at [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap). The local `WikiLink`, `HashTag`, and `PaperReference` extensions follow the same architecture as Tiptap's official `Mention` node and `@tiptap/suggestion` plugin: a Tiptap inline node stores structured attributes, and the Suggestion plugin handles matching, rendering, keyboard navigation, and insertion. The editor also follows Tiptap's React NodeView examples for component blocks: custom blocks are real Tiptap nodes rendered through `ReactNodeViewRenderer`, with `NodeViewWrapper` and `NodeViewContent` separating non-editable controls from editable content.

---

## Requirements

- Node.js 18 or newer
- Windows, macOS, or Linux

Optional external services:

- MinerU API key for cloud PDF structure parsing.
- OpenAI-compatible API key for paper overviews, translation, QA, and agent tasks.
- Internet access for OpenAlex and Crossref metadata enrichment.
- Optional OpenAlex premium API key and `mailto` polite-pool email for steadier batch metadata lookup.

---

## Development

Install dependencies:

```bash
npm install
```

Start the desktop app in development mode:

```bash
npm run dev
```

Build the frontend only:

```bash
npm run build
```

Preview the built web assets:

```bash
npm run preview
```

Build the desktop installer:

```bash
npm run electron:build
```

---

## Zotero Compatibility

PaperQuay can read a local Zotero data directory that contains `zotero.sqlite`. During import it copies the Zotero database to a temporary read-only working file and does not modify your original Zotero database.

Imported data enters PaperQuay's own local literature library. Zotero collections become local categories, and available local PDFs inside those collections are copied into the PaperQuay paper storage folder.

Zotero is an optional compatibility source, not a required dependency. You can build a complete library directly inside PaperQuay without using Zotero.

---

## Data and Privacy

PaperQuay is local-first. The literature library, notes, and local RAG indexes are stored in SQLite databases, and imported PDFs are stored in the paper storage folder you configure.

Optional WebDAV backup can upload the local library, notes, and RAG databases to the remote server you configure. API keys, local PDFs, parser outputs, and backups should stay out of source control.

Do not commit local data, API keys, PDFs, parser outputs, notes databases, or backups. The `.gitignore` excludes common local runtime folders, SQLite databases, legacy JSON library data, API key files, build output, backup archives, and private PDFs by default.

---

## Todo Roadmap

These items are planned or still being deepened beyond the completed features above.

- Better metadata extraction from PDF first pages.
- DOI / arXiv / Semantic Scholar enrichment options.
- Deeper two-way binding between PDF regions, annotations, and standalone notes.
- Citation style generation and export.
- Folder watching and automatic import queues.
- RAG-based knowledge-base QA across papers and notes.
- One-click survey generation and Word / LaTeX research draft generation.
- Signed macOS release flow for smoother installation and update checks.
- Optional cloud sync after the local-first model is stable.

---

## Acknowledgements

- **Upstream Project**: Sincere thanks to [WangQrkkk/PaperQuay](https://github.com/WangQrkkk/PaperQuay) for providing the outstanding architectural foundation and rich features of this local-first AI paper workbench.
- **Community**: PaperQuay is also shaped by discussions, feedback, and shared ideas from the [LinuxDo community](https://linux.do/).
- **Editor Framework**: The Notes workspace builds on [Tiptap](https://github.com/ueberdosis/tiptap). Thanks to the Tiptap maintainers for the extensible editor framework and examples that help power PaperQuay's note-taking experience.

---

## License

PaperQuay Community Edition is licensed under `AGPL-3.0-only`.

If you distribute modified versions or provide modified versions over a network, keep the license and copyright notices, mark your changes, and provide the corresponding source code under AGPL terms. For closed-source commercial licensing, commercial support, or brand-name permission, contact the maintainer separately. See [TRADEMARKS.md](./TRADEMARKS.md) for brand-use notes.
