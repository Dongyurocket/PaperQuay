---
name: paperquay-knowledge-search
description: Search the local PaperQuay literature library, RAG evidence, and reading notes with page- and block-level citations. Use for questions about papers or notes already stored in PaperQuay.
---

# PaperQuay Knowledge Search

Use the read-only tools of the `paperquay` MCP server. Parameters are defined by `tools/list` and `docs/MCP_AGENT_INTEGRATION.md`.

Tools: `search_papers`, `get_paper_details`, `list_categories`, `search_knowledge_base`, `read_paper_content`, `search_notes`, `get_note`, `list_note_tags`, `list_note_folders`.

## Procedure

1. Use `search_papers` (optionally with `tag` or a `categoryId` from `list_categories`) to find paper IDs.
2. Use `get_paper_details` only when full metadata or attachments are needed. Papers with `ragEnabled: false` are excluded from the knowledge base.
3. Use `search_knowledge_base` for evidence. Keep each result's `paperId`, `paperTitle`, `pageNumber`, `blockId`, `channels`, and the response's `retrievalMode` and `warning`.
4. Use `read_paper_content` (`pageIndex` is 0-based) to read enough surrounding text before interpreting a snippet.
5. Use `search_notes` only for user-authored notes; filter with `paperId` or `pageKind` when useful. Use `get_note` to read a selected note and follow `nextOffset` when its text is truncated; respect the separately reported anchor limit.

## Evidence Rules

- Separate source text from your synthesis.
- Cite the paper title, page, and block where available.
- Never invent a source, page, block, or retrieval result.
- Say so when keyword retrieval or a `warning` limits confidence.
- Library writes belong to `paperquay-library-manage`, note writes to `paperquay-notes`, Zotero imports to `paperquay-zotero-sync`.
