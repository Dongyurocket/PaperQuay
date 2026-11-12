# Long document L1a: artifact manifest integrity gate

PaddleOCR-VL publication now registers the parsed output directory and a manifest of every regular file's relative path, byte size, and SHA-256 in the shared knowledge database. The publish path rechecks the source PDF hash, computes and persists that manifest, validates the files again immediately before the SQLite current-generation transaction, and refuses publication if a path escapes the output root, a non-regular file is present, an artifact disappears or changes, or the generation/source guard fails. The previous published generation remains current on failure.

The SQLite schema upgrades existing `document_generations` tables by adding nullable artifact fields. Direct generation publication without a nonempty manifest is now rejected. Tests cover this fail-closed rule and mutate a real parsed `full.md` after manifest registration to prove a replacement generation cannot publish.

## Verification

- `node --test tests/knowledgeGraphCommands.test.mjs tests/paddleOcrLifecycle.test.ts`: 13/13 passed.
- `npm run check` with `TEMP` and `TMP` under `.codex-tmp/l1a-artifact-check`: build passed; full test suite 999/999 passed, exit code 0.
- `node --check electron/backend/knowledgeStore.cjs` and `node --check electron/backend/paddleOcrCommands.cjs`: passed.
- `git diff --check`: passed.

The tested service response was mocked and the PDF was local and isolated; no external Paddle service was called. The manifest currently covers the output directory produced by a parse attempt; remote job IDs, resume after process restart, unique per-attempt staging on disk, cancellation recovery, and old artifact reference-aware cleanup are still required for L1a completion.
