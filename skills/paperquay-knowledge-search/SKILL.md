---
name: paperquay-knowledge-search
description: Search the local PaperQuay literature library, RAG evidence, figures/tables, and reading notes with page- and block-level citations. Use for questions about papers or notes already stored in PaperQuay.
---

# PaperQuay Knowledge Search

Use the read-only tools of the `paperquay` MCP server. Parameters are defined by `tools/list` and `docs/MCP_AGENT_INTEGRATION.md`.

Tools: `search_papers`, `get_paper_details`, `list_categories`, `search_knowledge_base`, `read_paper_content`, `read_paper_figure`, `search_notes`, `get_note`, `list_note_tags`, `list_note_folders`.

## Procedure

1. Use `search_papers` (optionally with `tag` or a `categoryId` from `list_categories`) to find paper IDs.
2. Use `get_paper_details` only when full metadata, `updatedAt`, or attachments are needed. Papers with `ragEnabled: false` are excluded from the knowledge base.
3. Use `search_knowledge_base` for evidence. Keep each result's `paperId`, `paperTitle`, `pageNumber`, `blockId`, `channels`, and the response's `retrievalMode` and `warning`.
4. Use `read_paper_content` (`pageIndex` is 0-based) to read enough surrounding text before interpreting a snippet.
5. Use `read_paper_figure` with the exact `blockId` when the answer depends on a figure or table. It returns the caption, page, block type and, for image blocks under 8 MB, one image content block. Tables return structured table text. With no image support in the client/model, rely on the caption and table text and say the image itself was not inspected.
6. Use `search_notes` only for user-authored notes; filter with `paperId` or `pageKind` when useful. Use `get_note` to read a selected note and follow `nextOffset` when its text is truncated; respect the separately reported anchor limit.

## Retrieval Scope

The desktop reader offers three scopes; MCP callers implement them by choosing their `paperId`:

- **Current paper**: pass one `paperId` to `search_knowledge_base`.
- **Selected papers**: call once per selected paper and keep each paper's own top results; do not merge away the paper identity.
- **Whole library**: omit `paperId` and use one global `limit`. Only indexed, `ragEnabled` papers participate.

If a paper has no ready index, report it as skipped instead of treating the silence as evidence. Never trigger a whole-library reindex from a search request.

## Evidence Rules

- Separate source text from your synthesis.
- Cite the paper title, page, block ID, and figure/table caption where available. Keep `paperId` on every citation so cross-paper answers remain traceable.
- Cross-paper citations only show the source identity (title, page, block); do not claim the reader switched papers or opened the source.
- Never invent a source, page, block, or retrieval result.
- Say so when keyword retrieval, a missing index, an oversized image, or a `warning` limits confidence.
- Library writes belong to `paperquay-library-manage`, note writes to `paperquay-notes`, Zotero imports to `paperquay-zotero-sync`.
