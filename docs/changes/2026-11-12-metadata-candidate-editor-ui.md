# Metadata candidate comparison in the literature editor

## Implemented

The literature details editor now calls the read-only metadata candidate API while editing a paper. It shows provider status, candidate identity, each returned value, and the field source beside the current draft value. Users can apply individual fields to the draft and undo the most recent application for that field. Applying a candidate does not write to the library; the existing Save Changes action remains the only persistence path and continues to use field-level concurrency checks.

Candidate requests are associated with the current paper ID and a monotonically increasing request ID. Switching papers invalidates pending responses; starting a newer request also prevents an earlier response from replacing its result. Search uses the current draft DOI or title, so the comparison reflects unsaved edits.

## Validation

- `npm run build` — passed (TypeScript and Vite production build; 2616 modules transformed).
- `npm test` — passed, 987 tests, 0 failures.
- `git diff --check` — passed after the source and documentation updates.

The test cleanup helper reported `EPERM` and skipped cleanup for some directories under the isolated temporary root; the test process exited successfully. This change did not receive a Windows desktop interaction run or a new component-level async race test. PDF-extracted candidates and LLM-derived candidates are not part of this UI increment.

## Files

- `src/features/literature/components/LiteraturePaperDetails.tsx`
- `docs/implementation/joint-execution-ledger.md`
- `docs/plans/2026-11-11-literature-workspace-ui-and-metadata-plan.md`
