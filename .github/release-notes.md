# PaperQuay v{{VERSION}}

This release fixes the RAG badge and sidebar-QA regressions introduced in 0.4.38/0.4.39, and changes index rebuilding so the old index stays usable while a new one is built.

## What's Fixed

- **Library RAG badge covers the whole library**: badges are built from the index status list instead of the papers that happen to be open. Papers that were indexed but never opened no longer show “RAG Not Indexed” after launch, and the settings-page counts plus the “Index Unindexed Papers” candidates now cover the full library (loaded on demand when settings open).
- **Sidebar QA no longer swallows answers**: opening a tab could let the parent component overwrite restored chat history with a fresh empty session, leaving the QA-ready flag unset; the submitted answer was then discarded silently. History readiness is now decided by the tab slice's `workspaceId`, and a stale request removes the empty placeholder and tells the user to send again.
- **Rebuilds no longer delete the old index first**: when the signature, embedding model or extractor version changes, new chunks are staged first and swapped in one transaction. The old index stays searchable during the rebuild, a failed rebuild keeps it (only `rebuild_error` is recorded), interrupted rebuilds resume from staging, and chunks with identical text reuse their existing vectors (about 68% in a local sample).
- **Outdated indexes are visible and actionable**: a new “RAG Update Pending” badge marks indexes built by an older extractor or embedding model. The settings page adds “Update Outdated Indexes”; batch runs stop immediately on HTTP 401/402/403 instead of marking every remaining paper as failed. Indexes whose signature already matches but lack a version stamp only get the version backfilled, without re-embedding.
- **Ask first, rebuild in the background**: opening a paper or asking a question with an outdated index answers from the old index and shows “using the previous index version (the new index is rebuilding in the background)”; the rebuild is deduplicated per paper and source.
- **Compact index storage**: a new settings action rebuilds the vector tables with `chunk_size=128` and runs `VACUUM`, reclaiming deleted pages and the slots wasted by small partitions, and shows the current database size and reclaimable bytes.

## Database Changes

- `rag_indexes` gains `extractor_version`, `rebuild_error`, `rebuild_attempted_at`.
- New staging tables `rag_index_staging` and `rag_index_staging_meta`.
- New vector tables use `chunk_size=128`; existing tables migrate only when “Compact Index Storage” is run.

Old versions ignore the new columns and tables, so downgrading needs no migration.

## Verification

- `npm run typecheck`: six tsc projects, 0 diagnostics.
- `npm run lint`: 0 errors / 206 warnings.
- `npm run build`: passed.
- `npm test`: 1,500 tests, 1,491 passed, 9 skipped, 0 failed. New tests cover staged rebuild (vector reuse, atomic swap, failure keeping the old index, staging invalidation, storage compaction) and QA-session restore lifecycle; badge aggregation tests now cover the stale state and `onlyStale` candidates.
- Real index-copy validation (7.79 GB `VACUUM INTO` snapshot): the new columns migrated, 307 index rows listed, “Compact Index Storage” migrated 221,893 vectors from `chunk_size=1024` to 128 in ~830 s and reduced the file to 4.56 GB (-3.22 GB) with all indexes/chunks/vectors preserved and `freelist_count=0`. A real paper’s staged rebuild reused all 133 vectors (43 ms), committed in 159 ms, removed old-signature hits, and an incomplete commit kept the previous index with `rebuild_error` recorded.

## Known Limitations

- The “RAG Update Pending” badge appears for MinerU indexes created before this version until they are rebuilt (lazily on open/ask, or via the batch update). Rebuilding calls the configured embedding API for changed chunks only.
- Outdated scan and index management data are loaded when the preferences window opens; the first open may take a moment on very large libraries.
- “Compact Index Storage” rewrites the vector tables and runs `VACUUM`; on an 8 GB index it takes several minutes and temporarily needs free disk roughly the size of the database.
- Only Windows x64 installers are published and maintained.
