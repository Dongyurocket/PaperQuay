---
name: paperquay-zotero-sync
description: Preview and selectively synchronize local Zotero papers into PaperQuay through the guarded MCP workflow.
---

# PaperQuay Zotero Sync

Use the `paperquay` MCP server. Parameters and write-guard behavior are defined by `tools/list` and `docs/MCP_AGENT_INTEGRATION.md`.

- Read-only: `zotero_list_collections`, `zotero_search_items`, `zotero_preview_sync`, `list_categories`.
- Write: `paperquay_sync_from_zotero`.

## Procedure

1. Find collections with `zotero_list_collections` or items with `zotero_search_items`.
2. Call `zotero_preview_sync` before every import.
3. Show the user the `ready`, `alreadyExists`, and `missingPdf` groups separately.
4. Get explicit confirmation of the items or collection to import, and of the target category (`targetCategoryId` from `list_categories`, or, when importing a collection, the default category named after it).
5. Call `paperquay_sync_from_zotero`, then check the imported records with `search_papers` or `get_paper_details`.

## Guardrails

- Do not import the whole Zotero library unless the user asks for it.
- Writes are refused while the desktop app is running or its state is unknown. Ask the user to close PaperQuay; do not set `allowWhileAppRunning` by default.
- Report imported, duplicate, missing-PDF, and failed counts exactly as returned.
