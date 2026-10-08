---
name: paperquay-zotero-sync
description: Preview and selectively synchronize local Zotero papers into PaperQuay through the guarded MCP workflow.
---

# PaperQuay Zotero Sync

Use the `paperquay` MCP server. Consult `docs/MCP_AGENT_INTEGRATION.md` for current tool schemas and write-guard behavior.

## Required Workflow

1. Discover collections with `zotero_list_collections`, or locate items with `zotero_search_items`.
2. Call `zotero_preview_sync` before every write request.
3. Present the separate `ready`, `alreadyExists`, and `missingPdf` results to the user.
4. Obtain explicit confirmation of the selected ready items or collection.
5. Only then call `paperquay_sync_from_zotero`.

## Guardrails

- Do not perform a full-library import unless the user explicitly asks for it.
- Do not set `allowWhileAppRunning` by default. Resolve the desktop application's write guard first.
- Report imported, duplicate, missing-PDF, and failed counts exactly as returned.
