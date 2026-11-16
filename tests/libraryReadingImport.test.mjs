import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

function fixture() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-reading-import-'));
  const appPaths = {
    dataDir,
    configPath: path.join(dataDir, 'config.json'),
    libraryPath: path.join(dataDir, 'library.json'),
    libraryDatabasePath: path.join(dataDir, 'library.sqlite'),
    ragDatabasePath: path.join(dataDir, 'rag.sqlite'),
  };
  const store = createLibraryStore(appPaths);
  return { appPaths, store, commands: createLibraryCommands({ appPaths, store }) };
}

test('desktop Zotero imports keep their source without changing existing duplicates', async () => {
  const { appPaths, store, commands } = fixture();
  try {
    const local = path.join(appPaths.dataDir, 'local.pdf');
    const zotero = path.join(appPaths.dataDir, 'zotero.pdf');
    writeFileSync(local, '%PDF-1.7\nlocal');
    writeFileSync(zotero, '%PDF-1.7\nzotero');
    const [localResult] = await commands.library_import_pdfs({ request: { paths: [local], importMode: 'keep' } });
    const [zoteroResult] = await commands.library_import_pdfs({ request: { paths: [zotero], importMode: 'keep', source: 'zotero' } });
    assert.equal(localResult.paper.source, 'local');
    assert.equal(zoteroResult.paper.source, 'zotero');
    assert.deepEqual((await commands.library_query_papers({ request: { source: 'zotero' } })).papers.map((p) => p.id), [zoteroResult.paper.id]);

    const [duplicate] = await commands.library_import_pdfs({ request: { paths: [local], importMode: 'keep', source: 'zotero' } });
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.paper.source, 'local');
    assert.equal(store.getPaper(localResult.paper.id).source, 'local');
    assert.equal(store.getPaper(zoteroResult.paper.id).source, 'zotero');
    await assert.rejects(commands.library_import_pdfs({ request: { paths: [], source: 'invalid' } }), /Invalid import source/);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('reading updates survive reopening and drive real library filters without overwriting metadata', async () => {
  const { appPaths, store, commands } = fixture();
  let reopened;
  try {
    const pdf = path.join(appPaths.dataDir, 'paper.pdf');
    writeFileSync(pdf, '%PDF-1.7\nreading');
    const [result] = await commands.library_import_pdfs({ request: { paths: [pdf], importMode: 'keep' } });
    const paperId = result.paper.id;
    const timestamp = Date.now() - 10_000;
    assert.equal((await commands.library_query_papers({ request: { readStatus: 'unread' } })).total, 1);
    await commands.library_update_paper({ request: { paperId, title: 'New title', tags: ['test-tag'] } });
    const before = store.getPaper(paperId);
    const staleSnapshot = store.load();
    assert.equal(await commands.library_record_reading({ request: { paperId, lastReadAt: timestamp } }), true);
    assert.equal((await commands.library_query_papers({ request: { readStatus: 'reading', readAfter: timestamp } })).total, 1);
    await commands.library_record_reading({ request: { paperId, lastReadAt: timestamp + 500, readingProgress: 0.5 } });
    await commands.library_record_reading({ request: { paperId, lastReadAt: timestamp + 100, readingProgress: 0.1 } });
    store.savePaper(before);
    store.save(staleSnapshot);
    assert.equal(store.getPaper(paperId).readingProgress, 0.5);
    assert.equal(store.getPaper(paperId).lastReadAt, timestamp + 500);
    await commands.library_record_reading({ request: { paperId, lastReadAt: timestamp + 1000, readingProgress: 1 } });
    assert.equal((await commands.library_query_papers({ request: { readStatus: 'finished' } })).total, 1);
    assert.equal(await commands.library_record_reading({ request: { paperId: 'missing', lastReadAt: timestamp } }), false);
    for (const invalid of [-0.1, 1.1, NaN, Infinity, '0.5']) {
      await assert.rejects(commands.library_record_reading({ request: { paperId, lastReadAt: timestamp, readingProgress: invalid } }), /Invalid reading progress/);
    }
    await assert.rejects(commands.library_record_reading({ request: { paperId, lastReadAt: Date.now() + 600_000 } }), /Invalid reading timestamp/);
    store.close();
    reopened = createLibraryStore(appPaths);
    const persisted = reopened.getPaper(paperId);
    assert.equal(persisted.lastReadAt, timestamp + 1000);
    assert.equal(persisted.readingProgress, 1);
    assert.equal(persisted.title, 'New title');
    assert.equal(persisted.tags[0].name, 'test-tag');
    assert.equal(persisted.updatedAt, before.updatedAt);
    assert.equal(persisted.attachments[0].storedPath, pdf);
  } finally {
    reopened?.close();
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
