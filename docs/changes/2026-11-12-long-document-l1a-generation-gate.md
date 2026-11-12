# Long document L1a: generation publication gate

## Scope

The PaddleOCR-VL command path now binds an attempt to the PDF SHA-256, plans contiguous physical-page partitions, and persists generation and partition states in the shared knowledge database. Each partition must transition through the store's state guard before it can count as complete. Publication re-hashes the PDF, verifies every partition and complete physical-page coverage, writes the page map, and switches `current_generation` in one SQLite transaction. Failure leaves an earlier current generation untouched.

This is a first durable publication gate, not the complete L1a recovery protocol. The actual per-partition parse artifacts and remote job IDs are not yet persisted as verified staging entries, so the implementation cannot resume a remote job or safely reuse a completed partition after an application restart. Old artifact reference tracking and cleanup are also outstanding.

## Verification

- Isolated SQLite generation tests cover invalid page coverage, stale source versions, failed replacement preserving the old current pointer, and successful publication of a new version.
- Paddle lifecycle integration uses a local controlled PDF and a mocked service response. It confirms successful parsing publishes a persistent generation; it does not call the external Paddle service.
- `npm run check` with `TEMP` and `TMP` under `.codex-tmp/l1a-check`: production build passed; complete test suite 998/998 passed, exit code 0.
- `git diff --check`: passed.

The Windows Electron runtime still exits with `-2147483645`, so desktop interaction and Explorer verification remain pending. L0 engineering-document table extraction quality also remains below the plan's acceptance gate.
