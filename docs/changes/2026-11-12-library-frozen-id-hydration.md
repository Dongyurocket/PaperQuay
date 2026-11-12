# Frozen selection hydration by paper ID

## Implemented

Batch operations previously hydrated selected papers by paging through the currently active category, text query, RAG membership, and sort order. That made the captured selection depend on list state again during a later asynchronous fetch. A new main-process `library_get_papers_by_ids` command reads the captured identities directly, preserves request order, reports IDs that no longer exist, and caps each command call at 500 IDs. The renderer service batches requests in groups of 200 and reconstructs the original ID order. Batch operations now use this path; a deleted paper is skipped with an explicit status message.

The ID snapshot still determines the selected set. Current metadata is returned for each surviving ID, allowing batch operations to act on the latest saved record without silently substituting papers from a changed filter.

## Validation

- `npm run build` — passed (TypeScript and Vite production build; 2616 modules transformed).
- `node --test tests/libraryCommands.test.mjs` — latest run passed, 8 tests, 0 failures. Cases cover requested order, deleted IDs, malformed input, per-call bound, and 10,003 filtered IDs returned through several internal pages.
- `npm test` — latest full run passed, 989 tests, 0 failures, including the single-call ID enumeration addition.
- `git diff --check` — rerun after final documentation updates.

The full suite cleanup helper reported `EPERM` and skipped cleanup for some test directories under the isolated temporary root; the process exited successfully. No desktop interaction was run for this backend/service increment.

## Files

- `electron/backend/libraryCommands.cjs`
- `src/services/library.ts`
- `src/types/library.ts`
- `src/features/literature/LiteratureLibraryView.tsx`
- `tests/libraryCommands.test.mjs`
