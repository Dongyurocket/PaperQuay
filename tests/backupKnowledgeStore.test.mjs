import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAppPaths, createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createKnowledgeStore } = require('../electron/backend/knowledgeStore.cjs');
const { collectBackupSources } = require('../electron/backend/backupSources.cjs');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');

test('knowledge store upgrades existing partition tables with durable job and staged artifact identity idempotently', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'paperquay-knowledge-partition-migration-'));
  const databasePath = path.join(directory, 'paperquay-knowledge.sqlite');
  const appPaths = { dataDir: directory, knowledgeDatabasePath: databasePath };
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb.exec(`CREATE TABLE parse_partitions (
    partition_id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, partition_index INTEGER NOT NULL,
    physical_start INTEGER NOT NULL, physical_end INTEGER NOT NULL, input_hash TEXT NOT NULL,
    status TEXT NOT NULL, staged_path TEXT, updated_at INTEGER NOT NULL
  )`);
  legacyDb.close();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const store = createKnowledgeStore(appPaths);
    try {
      const columns = new DatabaseSync(databasePath, { readOnly: true });
      try {
        assert.equal(columns.prepare("PRAGMA table_info(parse_partitions)").all()
          .filter((column) => column.name === 'remote_job_id').length, 1);
        assert.equal(columns.prepare("PRAGMA table_info(parse_partitions)").all()
          .filter((column) => column.name === 'staged_manifest').length, 1);
      } finally { columns.close(); }
    } finally { store.close(); }
  }

  await rm(directory, { recursive: true, force: true });
});

test('backup source collection emits a consistent knowledge database snapshot', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-backup-knowledge-'));
  const app = { getPath: () => userDataDir };
  const appPaths = createAppPaths(app);
  const store = createLibraryStore(appPaths);
  const noteStore = createNoteStore(appPaths);
  const knowledgeStore = createKnowledgeStore(appPaths);
  try {
    knowledgeStore.saveRelation({ id: 'backup-relation', source: 'paper:a', target: 'paper:b',
      type: 'custom_relation', label: 'derived_from', description: '', createdAt: 100, updatedAt: 100 });
    const result = await collectBackupSources({
      appPaths, store, noteStore, knowledgeStore,
      ragStore: { available: false },
    }, {
      stagingDir: path.join(userDataDir, 'staging'),
      options: { preset: 'custom', includeRag: false, includeDerived: false, includeVault: false,
        includePdfs: false, includeRendererState: false },
    });
    const entry = result.entries.find((item) => item.kind === 'database' && item.databaseKind === 'knowledge');
    assert.ok(entry);
    assert.equal(entry.packagePath, 'data/paperquay-knowledge.sqlite');
    assert.equal(entry.schemaVersion, 1);
    const snapshot = new (require('../electron/backend/nodeSqlite.cjs').DatabaseSync)(entry.sourcePath, { readOnly: true });
    try {
      assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(snapshot.prepare("SELECT label FROM kg_custom_relations WHERE id='backup-relation'").get().label, 'derived_from');
    } finally { snapshot.close(); }
  } finally {
    knowledgeStore.close(); noteStore.close(); store.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
