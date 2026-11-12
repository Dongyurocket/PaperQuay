# Long document compatibility cache publication recovery

- Date: 2026-11-12
- Scope: LD-L1a shared parse publication; supports W-P0-F and KG-P1 version-bound locations.
- Status: compatibility cache crash recovery implemented and tested; L1a remains in progress.

## Behavior

Paddle generation publication writes a durable journal under the selected compatibility cache root before moving or copying cache files. The journal records the source identity, generation ID, moved legacy targets, attempt-owned backups, and intended write targets. Each filesystem mutation is preceded by an atomic journal rewrite.

At the next parse invocation, recovery compares the journal generation with the current generation in `paperquay-knowledge.sqlite`:

- If SQLite did not publish the generation, recovery removes only the journaled attempt outputs and restores any attempt backup that still exists.
- If SQLite did publish the generation, recovery preserves the new cache and removes only that attempt's backups.
- Journal paths must remain relative to the journal's cache root. Unowned legacy backup files are never scanned or removed.

This handles interruption before and after the SQLite current-pointer transaction without treating filesystem and database changes as one atomic operation.

## Validation

- `node --test tests/paddleOcrLifecycle.test.ts tests/backupKnowledgeStore.test.mjs`: 7/7 passed. Includes interrupted pre-commit rollback and post-commit cleanup against a persistent isolated knowledge store.
- `npm run check` with `TEMP` and `TMP` set to `.codex-tmp/nov12-publication-journal-check`: production build passed; full test suite 1002/1002 passed, exit code 0.
- `node --check electron/backend/paddleOcrCommands.cjs`: passed.
- `git diff --check`: passed.
- The test cleanup helper reported `EPERM` for some isolated fixtures and skipped their cleanup; this did not affect the successful test exit code.
- Paddle responses were controlled fixtures. No external Paddle service or personal library was used.

## Remaining L1a work

Automatic polling/download recovery for persisted remote job IDs, cancellation reconciliation, reusable per-partition staging, knowledge-store backup round-trip for publication state, and retention of artifacts referenced by historical evidence remain unimplemented. No real long-document quality, memory, disk, or service-cost measurements were made in this increment.
