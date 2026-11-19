---
name: paperquay-library-manage
description: Safely import, categorize, update, and delete PaperQuay library records through guarded MCP write tools with previews and version checks.
---

# PaperQuay Library Management

Use the `paperquay` MCP server. Parameters are defined by `tools/list` and `docs/MCP_AGENT_INTEGRATION.md`.

- Discovery (read-only): `search_papers`, `get_paper_details`, `list_categories`, `preview_delete_papers`.
- Writes: `import_pdfs`, `manage_category`, `set_paper_categories`, `update_paper`, `delete_papers`, `attach_translated_pdf`, `remove_translated_pdf`.

## Procedure

1. Find target papers and categories with the discovery tools. Read `updatedAt` from `get_paper_details` / `list_categories`.
2. Before any broad or destructive change, show the user the paper IDs, the metadata or category changes, and any file consequences, and get confirmation.
3. Then call `import_pdfs`, `manage_category`, `set_paper_categories`, `update_paper`, or `attach_translated_pdf`.
4. For deletion, always call `preview_delete_papers` first, show the listed papers, attachments, shared/unmanaged files, then get a second explicit confirmation. Call `delete_papers` with the returned `previewVersion`. A stale preview rejects the whole delete; re-preview instead of forcing.
5. Re-read changed records with `get_paper_details` or `search_papers` and report successes, skips, and failures. If `attach_translated_pdf` returns `pageCountMismatch`, tell the user; the attachment is still made.

## Imports and duplicates

- `import_pdfs` writes one record at a time. `metadata` is keyed by the exact source path; `importMode` is `copy` (default), `move`, or `keep`. In `move` mode the source file is removed only after the database commit.
- A duplicate import returns `existingPaperId` and does not append the target category. Change categories separately with `set_paper_categories` and its version check.
- Report partial failures: the summary exposes `failedCount` and `partialFailureCount`; `errors` includes file-removal failures after a successful import.

## Metadata Updates

- `update_paper` rejects unknown fields. `authors`, `authorDetails`, `keywords`, and `tags` replace the whole list.
- `authors` is a string array. `authorDetails` items accept `name`, `givenName`, `familyName`, `affiliation`, and `orcid`; it takes precedence when both are given.
- `orcid` must match `0000-0000-0000-000X` and pass the MOD 11-2 check digit.
- `language` is a BCP 47 tag for the paper itself, not for a translated PDF.
- `citationKey` must match `^[A-Za-z0-9_:\-.]+$`; an empty value clears it. Duplicates are allowed.
- Pass `expectedUpdatedAt` (the value read from `get_paper_details`) for every update. A stale value returns `PAPER_CONFLICT` with the current version; re-read, merge, retry.

## Categories

- `manage_category` validates versions for rename/move/delete while the app is running. A cascading delete also accepts `expectedCategoryVersions` covering every affected descendant. Any changed version rejects the whole operation.
- Category delete only unlinks papers; it never deletes papers. The result reports `affectedCategoryCount` and `affectedPaperCount`.
- `set_paper_categories` is all-or-nothing across the batch; pass a number or `{paperId: updatedAt}` map as `expectedUpdatedAt`.

## PDF deletion

- `deleteFiles` defaults to false. Use `deleteFilePaperIds` to delete files for only some of the listed papers (must be a subset of `paperIds`).
- Only managed files inside the PaperQuay storage directories and not shared with another record are deleted. Shared/unmanaged files are kept and listed in the preview.
- If the database commit succeeds but a file cannot be removed, the result returns `partialFailure` and `fileErrors`; do not claim full success.

## Guardrails

- Writes are refused while the desktop app is running unless `allowWhileAppRunning: true` is passed. That mode is a checked parallel write: versions are mandatory and stale versions are rejected with `PAPER_CONFLICT` / `CATEGORY_CONFLICT`.
- `PAPERQUAY_MCP_WRITE=off` disables every write tool.
- Prefer previews over blind bulk changes.
- Report exactly which records changed, were skipped as duplicates, or failed.
