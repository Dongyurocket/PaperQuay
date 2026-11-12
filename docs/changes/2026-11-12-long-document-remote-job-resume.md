# Long document remote job resume on parse retry

- Date: 2026-11-12
- Scope: LD-L1a; uses the shared `paperquay-knowledge.sqlite` partition ledger.
- Status: same-source remote job resume on explicit parse retry implemented; automatic startup recovery remains incomplete.

## Behavior

When a user retries Paddle parsing for a document, the backend searches for a still-building generation with the same source ID, source version, partition count, physical page ranges, and per-partition input hashes (which include the selected model). A matching partition with a persisted remote job ID is polled and downloaded using that ID, without a second job submission. A completed partition in a still-building generation can be downloaded again to reconstruct local output if the process stopped before the whole generation was published.

Only a source-version-matching `building` generation is reusable. Published, failed, or stale-source generations are not reopened. Credentials are supplied by the current parse request and are not stored in the knowledge database.

## Validation

- `node --test tests/paddleOcrLifecycle.test.ts tests/backupKnowledgeStore.test.mjs tests/knowledgeGraphCommands.test.mjs`: 17/17 passed.
- The new lifecycle case closes and reopens the SQLite store, retries the same source, asserts GET of the persisted job ID and zero POST submissions, and verifies the result becomes the current generation.
- Prior journal recovery, page-coverage, artifact-integrity, and knowledge-store migration cases pass in the same focused run.
- `npm run check` with `TEMP` and `TMP` set to `.codex-tmp/nov12-job-resume-check`: production build passed; full test suite 1003/1003 passed, exit code 0. The test cleanup helper printed `EPERM` and skipped cleanup for some isolated fixtures; the command exited successfully.
- `node --check electron/backend/paddleOcrCommands.cjs` and `node --check electron/backend/knowledgeStore.cjs`: passed. `git diff --check`: passed.

## Limits

Resume is triggered by a new parse request; there is no automatic background polling on app startup yet. If the process stops after the remote service accepts a job but before its ID is persisted locally, the job cannot be identified reliably. Provider job retention, cancellation recovery, durable per-partition output artifacts, backup round-trip, and historical artifact reference protection remain open L1a work. This increment used controlled service responses and did not call Paddle.

Electron still exits with Windows status `-2147483645`; the existing local page on port 1420 is blank. Windows desktop interaction, dual-theme screenshots, scaling, and Explorer verification remain unverified.
