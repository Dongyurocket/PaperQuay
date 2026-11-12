# Shared knowledge store: first durable slice

## Scope

- Added `paperquay-knowledge.sqlite` as the single runtime writer for custom and AI-approved graph relations.
- Added shared storage foundations for source documents, document generations, units, physical/printed page mappings, and parse partitions. These tables establish storage boundaries for KG P1 and long-document L1a; they are not yet wired to extraction or publication workflows.
- Startup imports legacy `paperquay-knowledge-graph-relations.json` rows in one transaction and records completion in `knowledge_meta`. The legacy file is retained. Malformed input leaves migration unmarked and closes the database handle so a later startup can retry after repair.
- New backups snapshot the knowledge database as `databaseKind: knowledge`. Import validates SQLite integrity and accepts the database as optional for older packages. Existing `knowledge-graph` JSON entries still restore to the legacy path and are imported on next startup.
- New backups omit the legacy JSON when the shared store is active, avoiding a stale duplicate authority.

## Verification

- `node --test tests/knowledgeGraphCommands.test.mjs tests/backupPackage.test.ts tests/backupRestorePaths.test.ts`: 22/22 passed before adding the dedicated export inventory case.
- `node --test tests/backupKnowledgeStore.test.mjs`: 1/1 passed; production source collection emits an integrity-checked SQLite snapshot with the relation row.
- `npm run check` with `TEMP` and `TMP` under `.codex-tmp/knowledge-check`: production build passed; full test suite 996/996 passed.
- `git diff --check`: passed.
- Tests use isolated temporary databases and legacy fixtures. No personal library was migrated.

## Remaining work

- Both export inventory and encrypted package restore are covered: source collection emits the knowledge snapshot, and a controlled encrypted package passes staging, integrity validation, application restore, and row-level recovery. The package writer's final encrypted output for a package produced through the production export command is not covered end-to-end.
- KG P1 still needs source identity/version invalidation, evidence spans, candidate extraction, human review events, and version-safe publication.
- L1a still needs persistent partition task writers, staged artifact verification, crash/cancel recovery, atomic `current` publication, and old-artifact protection.
- The initial shared schema is intentionally a foundation and does not mark either work package complete.
