import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-library-settings-upsert-'));
  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    screenshotDir: path.join(dataDir, '.screenshots'),
  };
}

function readSettingRows(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare('SELECT rowid, key, value_json FROM library_settings ORDER BY key').all();
  } finally {
    db.close();
  }
}

test('saving library settings upserts rows instead of deleting and reinserting the table', () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    store = createLibraryStore(appPaths);
    const settings = store.load().settings;
    store.saveSettings(settings);
    const first = readSettingRows(appPaths.libraryDatabasePath);
    assert.ok(first.length > 5);

    store.saveSettings({ ...settings, autoRenameFiles: false });
    const second = readSettingRows(appPaths.libraryDatabasePath);
    assert.equal(second.length, first.length);

    const firstRowIds = new Map(first.map((row) => [row.key, row.rowid]));
    for (const row of second) {
      assert.equal(
        row.rowid,
        firstRowIds.get(row.key),
        `${row.key} must keep its rowid (UPSERT, not DELETE+INSERT)`,
      );
    }

    const autoRename = second.find((row) => row.key === 'autoRenameFiles');
    assert.equal(JSON.parse(autoRename.value_json), false);
  } finally {
    try {
      store?.close();
    } catch {}
    rmSync(appPaths.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
