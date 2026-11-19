<h1 align="center">PaperQuay</h1>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

<p align="center">
  <strong>An open-source AI paper workspace for PDF reading, full-text translation, structured overviews, inline notes, Zotero import, external agent access, and local RAG.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.4.35-2563eb?style=flat-square" alt="Version v0.4.35">
  <img src="https://img.shields.io/badge/maintained-Windows%20x64-4b5563?style=flat-square" alt="Maintained: Windows x64">
  <img src="https://img.shields.io/badge/built%20with-Electron-47848f?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-0f766e?style=flat-square" alt="React TypeScript">
  <img src="https://img.shields.io/badge/storage-local%20SQLite-111827?style=flat-square" alt="Local SQLite storage">
  <img src="https://img.shields.io/badge/editor-Tiptap-0d9488?style=flat-square" alt="Tiptap editor">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

<p align="center">
  <a href="./docs/USER_MANUAL.zh-CN.md">User Manual (Chinese)</a> |
  <a href="#recent-updates">Recent Updates</a> |
  <a href="#features">Features</a> |
  <a href="#download-and-install">Download</a> |
  <a href="#mcp-and-external-agents">MCP</a> |
  <a href="#local-development">Development</a> |
  <a href="./CHANGELOG.md">Changelog</a>
</p>

> **About this repository**: a personal fork of [WangQrkkk/PaperQuay](https://github.com/WangQrkkk/PaperQuay), maintained by [@Dongyurocket](https://github.com/Dongyurocket) under the same `AGPL-3.0-only` license. Besides tracking upstream, it adds typography cleanup, raw PDF slice (BBox Crop) comparison, AI block re-parsing, splitting of very long documents with multi-key rotation, local RAG index management, hybrid knowledge-base MCP search (KNN + FTS5 + RRF), and selective Zotero sync. Fork workflow, upstream sync, and builds are covered in the [Development Manual](./docs/DEVELOPMENT.zh-CN.md) (Chinese).

<p align="center">
  <img src="./docs/assets/readme-hero.svg" alt="PaperQuay feature overview" width="920">
</p>

---

## What It Is

PaperQuay is a local-first, free and open-source desktop AI paper workspace for graduate students, researchers, and anyone who reads many papers. Importing, reading, translating, overviews, annotations, notes, organization, and knowledge-base search all happen in one app. Zotero can be an import source but is not required.

| Pain point | Common approach | PaperQuay |
| ---------- | --------------- | --------- |
| Translation interrupts reading | Select text and wait for an API call | MinerU blocks are translated and cached ahead of time; click the original to jump to the translation |
| Side-by-side reading is distracting | Scan back and forth across two columns that lose formatting | Keep the original PDF and jump to the matching translation when needed |
| Notes lose context | Notes live in another app without PDF positions | Notes, tags, wiki links, and paper references live in the local library and jump back to the source |
| Screening many papers is slow | Upload PDFs to an LLM again and again | Generate and save structured overviews inside the library |
| Limited model choice | Only built-in models | Any OpenAI-compatible endpoint, model, and parameters |
| Library upkeep is manual | Rename, tag, and categorize by hand | External agents batch-fill metadata, tags, and categories through MCP with previews and read-back |

<p align="center">
  <img src="./docs/assets/show.gif" alt="PaperQuay workflow demo" width="1200">
</p>

---

## Recent Updates

- **v0.4.35**: full-document translation persists its cache more reliably: app-data and approved cache directories are trusted directly, transient `EPERM` / `EBUSY` failures are retried and fall back to an overwrite, and a task is no longer marked failed when every translation is already on disk.
- **v0.4.34**: batch MinerU parsing skips only the papers whose cached index carries an older extractor signature instead of queueing the whole library for re-embedding; rebuilding is left to opening a paper, lazy Q&A indexing, or a manual rebuild.
- **v0.4.33**: settings copy matches actual behavior: Vault sync runs only on manual or scheduled sync, model roles no longer mention the Agent, and backup scope no longer claims Agent memory or history.
- **v0.4.32**: external agents are the only agent path: the in-app standalone agent workspace, agent memory, and note AI polish are removed; PaddleOCR-VL is retired and MinerU OCR retry is the only parsing fallback; MCP writes become versioned per-record writes with new `preview_delete_papers` and `read_paper_figure`; reader Q&A supports current paper / selected papers / whole library scopes.
- **v0.4.31**: the survey-writing workspace and AI graph relation suggestions are removed, leaving cross-paper synthesis to external-agent evidence search and `synthesis` notes; reader Q&A can stop generation, and MCP adds read-only `get_note`.
- **v0.4.30**: the reader top bar is a single row; the PDF toolbar is a single row with page jump and an overflow menu; new immersive reading mode (`Ctrl+Shift+F`); the "collapse status bar" option, the bottom bar, and the onboarding guide are removed; AI overview headings are shown in Chinese when the UI is Chinese.
- **v0.4.29**: redesigned paper overview. Parsing, translation, and overview generation move into a "Process" menu; the overview is split into section tabs, and a files card lists the original PDF, translated PDF, and MinerU result.

See [CHANGELOG.md](./CHANGELOG.md) for the full history and [Releases](https://github.com/Dongyurocket/PaperQuay/releases) for installers.

---

## Features

| Module | Capabilities |
| ------ | ------------ |
| Local library | SQLite stores papers, authors, categories, tags, attachments, notes, annotations, and settings; import PDFs by drag and drop or file picker and confirm metadata first; copy / move / keep-in-place import modes and naming rules; multi-select batch actions; composable filters and sorting |
| Metadata | Lookup by DOI or title, OpenAlex first with Crossref fallback; an LLM extracts metadata from the first page of Chinese papers that are not found; paper language, citation key, author affiliation and ORCID; BibTeX export |
| Categories and tags | Nested categories, drag-and-drop ordering, tags, favorites |
| Document parsing | MinerU cloud parsing (multi-key rotation and failover; very long documents are split and merged automatically; automatic OCR retry when non-OCR parsing returns no usable structure); forced re-parsing; self-healing image references in the parse cache |
| Reader | Linked PDF and block views, annotations, reading heatmap and reading-time chart, windowed rendering for long documents, immersive mode; typography cleanup (ligatures, fake superscripts, drop caps, glossaries); BBox raw-slice fallback and per-block AI re-parsing |
| Translation | Full-text translation with block-level cache, selection translation, batch title translation; Chinese papers skip translation; attach translated PDFs and set their language |
| Paper overview | Background, problem, method, experiments, findings, conclusions, and limitations saved by section; cached overviews open instantly |
| Reader Q&A | Evidence-grounded answers from the local RAG index, scoped to the current paper, selected papers, or the whole library; citations carry paper, page, and evidence type; generation can be stopped and the answer saved as a note |
| Notes | Tiptap rich text; 8 page kinds and 11 templates; `[[wiki links]]`, `#tags`, and `@paper` references that jump back to the source; excerpt cards; GB/T 7714 / APA 7 / IEEE citation styles; note graph and health check; two-way sync with an Obsidian-compatible Markdown vault. Conventions: [notes-charter.md](./docs/notes-charter.md) |
| Local RAG | Hybrid vector KNN + FTS5 BM25 + RRF retrieval; index management panel (stats, batch build, pause / resume / cancel); status badges in the paper list; individual papers can be removed from the knowledge base |
| Knowledge graph | Paper, note, tag, category, and citation nodes; semantic-similarity, reference, co-author, and custom relations; PNG / JSON export |
| Zotero | Reads a temporary copy of `zotero.sqlite` and never modifies the original; full import, or browse by collection and filter, preview, then sync selectively |
| Backup | Password-protected single-file `.pqbackup` export and import; import replaces data after a restart and keeps a rollback point |
| Other | Light / dark themes; command palette (`Ctrl+K`); in-app update check and automatic updates for the Windows installer |

The [User Manual](./docs/USER_MANUAL.zh-CN.md) (Chinese) explains each feature.

<p align="center">
  <img src="./docs/assets/main.png" alt="PaperQuay literature library workspace" width="1200">
</p>

---

## Download and Install

Download the Windows x64 `.exe` installer from [GitHub Releases](https://github.com/Dongyurocket/PaperQuay/releases).

Since 0.4.24 only Windows x64 is released, maintained, and tested. macOS, Linux, and other platforms can be built from source but are not maintained or tested by the author; older installers for other platforms remain in Releases.

## Quick Start

1. In Settings, configure an OpenAI-compatible endpoint (Base URL, API key, model). Translation, overviews, and Q&A need it.
2. Set the paper storage folder and import mode.
3. Enter a MinerU API token for structured parsing; configure an embedding endpoint if you want local RAG.
4. Drop in PDFs, confirm metadata, then create categories, add tags, and start reading.
5. If you already use Zotero, select the Zotero data directory in Settings to import it.

The recommended setup order and what each setting does are in [User Manual section 1.2](./docs/USER_MANUAL.zh-CN.md#12-首次启动建议按顺序配置) (Chinese).

Optional external services: MinerU (structure parsing), an OpenAI-compatible API (overviews, translation, Q&A), an embedding API (RAG and semantic note search), and OpenAlex / Crossref (metadata, needs internet; an OpenAlex API key and `mailto` address are optional).

---

## MCP and External Agents

PaperQuay ships a standard MCP stdio server that lets external agents read the local SQLite data directly. It exposes 28 tools:

- **Read-only search**: `search_papers`, `get_paper_details`, `search_knowledge_base` (`auto` / `hybrid` / `keyword` modes), `read_paper_content`, `read_paper_figure`, `search_notes`, `get_note`, `list_note_tags`, `list_note_folders`, `list_categories`, `preview_delete_papers`
- **Zotero sync**: `zotero_list_collections`, `zotero_search_items`, `zotero_preview_sync`, `paperquay_sync_from_zotero`
- **Library writes**: `import_pdfs`, `manage_category`, `set_paper_categories`, `update_paper`, `delete_papers`, `attach_translated_pdf`, `remove_translated_pdf`
- **Note maintenance**: `create_note`, `update_note`, `delete_note`, `create_note_folder`, `rename_note_folder`, `delete_note_folder`

Write tools refuse to write by default while the desktop app is running; pass `allowWhileAppRunning: true` for checked parallel writes with read versions; stale versions are rejected instead of silently overwritten. Set `PAPERQUAY_MCP_WRITE=off` to make the server read-only, and `PAPERQUAY_MCP_EMBEDDING=off` to disable network requests for vector search.

**Setup**: in the installed app, copy the Proma / Claude / Codex config snippet from **Settings → MCP Service**. The installed build runs `resources/paperquay-mcp/server.cjs` with `PaperQuay.exe` and `ELECTRON_RUN_AS_NODE=1`, so no separate Node.js install is needed. In development, use `node bin/paperquay-mcp.cjs`.

The [`skills/`](./skills) folder contains four companion Agent Skills: `paperquay-knowledge-search` (evidence search), `paperquay-notes` (note maintenance), `paperquay-zotero-sync` (preview, then sync), and `paperquay-library-manage` (library writes).

Tool parameters, client configuration, data directories, and search modes are documented in the [MCP Integration Guide](./docs/MCP_AGENT_INTEGRATION.md) (Chinese).

---

## Architecture

The Electron main process handles the filesystem, IPC, SQLite persistence, Zotero import, updates, and packaging; the React renderer handles the UI. PDF.js renders PDFs, Tiptap / ProseMirror powers the note editor, SQLite (sql.js) with sqlite-vec stores data, and AI features use OpenAI-compatible APIs.

| Path | Responsibility |
| ---- | -------------- |
| `src/features/literature/` | Library, import, category tree, paper details |
| `src/features/reader/` | Reader, linked reading, overview, and AI reading actions |
| `src/features/pdf/` | PDF rendering, overlays, and annotations |
| `src/features/blocks/` | MinerU block rendering |
| `src/features/notes/` | Tiptap notes workspace and extensions |
| `src/services/`, `src/platform/electron/` | Renderer wrappers around Electron IPC |
| `electron/` | Main process, preload, and backend commands (`electron/backend/`) |
| `bin/paperquay-mcp.cjs`, `electron/mcp/` | MCP server |
| `skills/` | Companion Agent Skills |
| `tests/` | Automated tests |

The note editor's `WikiLink`, `HashTag`, and `PaperReference` extensions follow the architecture of Tiptap's official `Mention` node and `@tiptap/suggestion`; component blocks follow the official React NodeView examples.

---

## Local Development

Requirements: Node.js 22.18 or newer (CI uses Node.js 24).

```bash
npm ci                   # install dependencies
npm run dev              # start the desktop app in development mode
npm run build            # type-check and build the frontend
npm test                 # run tests
npm run electron:build   # build the desktop installer
```

Upstream sync, release flow, and documentation conventions are in the [Development Manual](./docs/DEVELOPMENT.zh-CN.md), [UPSTREAM.md](./docs/UPSTREAM.md), and [RELEASE.md](./docs/RELEASE.md); see [CONTRIBUTING.md](./CONTRIBUTING.md) to contribute.

---

## Data and Privacy

PaperQuay is local-first. The library, notes, and RAG indexes are stored in local SQLite databases, and PDFs are stored in the paper storage folder you configure. AI and embedding requests go to the endpoints you configure.

The full `.pqbackup` migration archive contains configuration and API keys, the three databases, PDFs referenced by the library, knowledge-graph relations, reading state and annotations, the notes vault, and MinerU / translation / summary caches; the smaller daily backup leaves out the RAG database and MinerU caches. A forgotten password cannot be recovered. New versions cannot read old WebDAV backups; to keep that data, restore it locally with 0.4.18 or earlier before upgrading.

Do not commit local data, API keys, PDFs, parser output, databases, or backup archives to the repository. Report security issues as described in [SECURITY.md](./SECURITY.md).

---

## Roadmap

- **Metadata enrichment**: add arXiv and Semantic Scholar alongside OpenAlex / Crossref, with lookup by arXiv ID or title and a merge prompt when a preprint and its published version both match.
- **Cover pages without a text layer**: first-page extraction depends on the PDF text layer, so scanned covers currently yield nothing; add OCR for those pages and surface the evidence when candidates conflict.
- **Two-way annotation and note navigation**: notes already jump to PDF anchors, but the reverse lookup is missing. Let an annotation list the notes that reference it, and let excerpt cards target a specific annotation rather than only a page.
- **Import automation**: watch a folder, import new PDFs automatically, and keep failed items in a retryable queue with their reasons.
- **Writing hand-off**: export Markdown / LaTeX drafts with citation keys and BibTeX, then finish the manuscript in an external agent or a local LaTeX toolchain instead of rebuilding a survey-writing workspace in the app.
- **Optional cloud sync**: revisit opt-in end-to-end encrypted sync once the local-first model is stable; local-only stays the default.

---

## Acknowledgements

- **Upstream**: thanks to [WangQrkkk/PaperQuay](https://github.com/WangQrkkk/PaperQuay) for the architecture and features of this local-first AI paper workspace.
- **Community**: many design and polish decisions were inspired by discussion and feedback in the [LinuxDo community](https://linux.do/).
- **Editor framework**: the notes workspace is built on [Tiptap](https://github.com/ueberdosis/tiptap); thanks to its maintainers for the framework and examples.

---

## License

PaperQuay Community Edition is licensed under `AGPL-3.0-only`.

If you distribute modified versions or provide modified versions over a network, keep the license and copyright notices, mark your changes, and provide the corresponding source code under AGPL terms. For closed-source commercial licensing, commercial support, or brand-name permission, contact the maintainer separately. See [TRADEMARKS.md](./TRADEMARKS.md) for brand-use notes.
