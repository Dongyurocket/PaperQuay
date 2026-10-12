---
name: paperquay-library-manage
description: Safely import, categorize, update, and delete PaperQuay library records through guarded MCP write tools.
---

# PaperQuay Library Management

Use the `paperquay` MCP server. Refer to `docs/MCP_AGENT_INTEGRATION.md` for the current tool schemas.

## Procedure

1. Discover target papers and categories using `search_papers`, `get_paper_details`, and `list_categories`.
2. Before any destructive or broad operation, present the proposed paper IDs, metadata/category changes, and file consequences for confirmation.
3. Use `import_pdfs`, `manage_category`, `set_paper_categories`, `update_paper`, or `attach_translated_pdf` only after confirmation.
4. Use `delete_papers` or `remove_translated_pdf` only after an explicit second confirmation. Keep `deleteFiles` false unless the user expressly requests permanent file deletion. `remove_translated_pdf` defaults to deleting the stored translation copy, not the user's source file.
5. Before attaching a translation, read `get_paper_details` and tell the user if the result includes `pageCountMismatch`. A mismatch warns but does not reject the attach.

## Guardrails

- Never set `allowWhileAppRunning` unless the user explicitly accepts its lost-update risk.
- Prefer metadata/category previews over blind bulk changes.
- Report exactly which records changed, were skipped as duplicates, or failed.
