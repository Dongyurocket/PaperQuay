---
name: paperquay-library-manage
description: Safely import, categorize, update, and delete PaperQuay library records through guarded MCP write tools.
---

# PaperQuay Library Management

Use the `paperquay` MCP server. Parameters are defined by `tools/list` and `docs/MCP_AGENT_INTEGRATION.md`.

- Discovery (read-only): `search_papers`, `get_paper_details`, `list_categories`.
- Writes: `import_pdfs`, `manage_category`, `set_paper_categories`, `update_paper`, `delete_papers`, `attach_translated_pdf`, `remove_translated_pdf`.

## Procedure

1. Find target papers and categories with the discovery tools.
2. Before any broad or destructive change, show the user the paper IDs, the metadata or category changes, and any file consequences, and get confirmation.
3. Then call `import_pdfs`, `manage_category`, `set_paper_categories`, `update_paper`, or `attach_translated_pdf`.
4. Call `delete_papers` or `remove_translated_pdf` only after a second explicit confirmation. Keep `deleteFiles` false unless the user asks for permanent file deletion. `remove_translated_pdf` deletes the stored translation copy by default, not the user's source file.
5. If `attach_translated_pdf` returns `pageCountMismatch`, tell the user. The attachment is still made.

## Metadata Updates

- `update_paper` rejects unknown fields. `authors`, `authorDetails`, `keywords`, and `tags` replace the whole list.
- `authors` is a string array. `authorDetails` items accept `name`, `givenName`, `familyName`, `affiliation`, and `orcid`; it takes precedence when both are given.
- `orcid` must match `0000-0000-0000-000X` and pass the MOD 11-2 check digit.
- `language` is a BCP 47 tag for the paper itself, not for a translated PDF.
- `citationKey` must match `^[A-Za-z0-9_:\-.]+$`; an empty value clears it. Duplicates are allowed.

## Guardrails

- Writes are refused while the desktop app is running or its state is unknown. Ask the user to close PaperQuay. Set `allowWhileAppRunning` only if the user accepts that the app's next save may overwrite the change.
- Prefer previews over blind bulk changes.
- Report exactly which records changed, were skipped as duplicates, or failed.
