import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-library-commands-test-'));

  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    screenshotDir: path.join(dataDir, '.screenshots'),
  };
}

test('library_update_settings migrates stored PDFs into the new storage directory', async () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    const oldStorageDir = path.join(appPaths.dataDir, 'old-papers');
    const newStorageDir = path.join(appPaths.dataDir, 'new-papers');
    const relativePath = path.join('category-a', 'paper-1.pdf');
    const oldPdfPath = path.join(oldStorageDir, relativePath);
    const newPdfPath = path.join(newStorageDir, relativePath);

    await mkdir(path.dirname(oldPdfPath), { recursive: true });
    writeFileSync(oldPdfPath, '%PDF-1.7\npaper body\n');

    store = createLibraryStore(appPaths);
    const library = store.load();
    library.settings.storageDir = oldStorageDir;
    library.papers.push({
      id: 'paper-1',
      title: 'Migrated Paper',
      year: null,
      publication: null,
      doi: null,
      url: null,
      abstractText: null,
      keywords: [],
      importedAt: 1,
      updatedAt: 1,
      lastReadAt: null,
      readingProgress: 0,
      isFavorite: false,
      userNote: null,
      aiSummary: null,
      citation: null,
      source: 'local',
      sortOrder: 0,
      authors: [],
      tags: [],
      categoryIds: [],
      attachments: [{
        id: 'att-1',
        paperId: 'paper-1',
        kind: 'pdf',
        originalPath: oldPdfPath,
        storedPath: oldPdfPath,
        relativePath,
        fileName: 'paper-1.pdf',
        mimeType: 'application/pdf',
        fileSize: 20,
        contentHash: 'hash-1',
        createdAt: 1,
        missing: false,
      }],
    });
    await store.save(library);

    const commands = createLibraryCommands({ appPaths, store });
    const updatedSettings = await commands.library_update_settings({
      settings: {
        ...library.settings,
        storageDir: newStorageDir,
      },
    });

    assert.equal(updatedSettings.storageDir, newStorageDir);
    assert.equal(existsSync(newPdfPath), true);
    assert.equal(readFileSync(newPdfPath, 'utf8'), '%PDF-1.7\npaper body\n');

    const migrated = store.load().papers[0];
    assert.equal(migrated.attachments[0].storedPath, newPdfPath);
    assert.equal(migrated.attachments[0].relativePath, relativePath);
    assert.equal(migrated.attachments[0].missing, false);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library_delete_paper keeps managed files still referenced by another paper', async () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    const storageDir = path.join(appPaths.dataDir, 'papers');
    const sharedPath = path.join(storageDir, 'shared.pdf');
    await mkdir(storageDir, { recursive: true });
    writeFileSync(sharedPath, '%PDF-1.7\nshared body\n');
    store = createLibraryStore(appPaths);
    const library = store.load();
    library.settings.storageDir = storageDir;
    const makePaper = (paperId, attachmentId) => ({
      id: paperId, title: paperId, year: null, publication: null, doi: null, url: null,
      abstractText: null, keywords: [], importedAt: 1, updatedAt: 1, lastReadAt: null,
      readingProgress: 0, isFavorite: false, userNote: null, aiSummary: null, citation: null,
      source: 'local', sortOrder: 0, authors: [], tags: [], categoryIds: [],
      attachments: [{
        id: attachmentId, paperId, kind: 'pdf', originalPath: sharedPath, storedPath: sharedPath,
        relativePath: 'shared.pdf', fileName: 'shared.pdf', mimeType: 'application/pdf',
        fileSize: 20, contentHash: null, createdAt: 1, missing: false,
      }],
    });
    library.papers.push(makePaper('paper-a', 'att-a'), makePaper('paper-b', 'att-b'));
    await store.save(library);

    const commands = createLibraryCommands({ appPaths, store });
    await commands.library_delete_paper({ request: { paperId: 'paper-a', deleteFiles: true } });
    assert.equal(existsSync(sharedPath), true);
    assert.equal(store.load().papers.length, 1);

    await commands.library_delete_paper({ request: { paperId: 'paper-b', deleteFiles: true } });
    assert.equal(existsSync(sharedPath), false);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('category moves reject self/descendant/system/missing parents', async () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    store = createLibraryStore(appPaths);
    const commands = createLibraryCommands({ appPaths, store });
    const a = await commands.library_create_category({ request: { name: 'A' } });
    const b = await commands.library_create_category({ request: { name: 'B', parentId: a.id } });
    const c = await commands.library_create_category({ request: { name: 'C', parentId: b.id } });

    await assert.rejects(
      commands.library_update_category({ request: { id: a.id, parentId: a.id } }),
      /own parent/,
    );
    await assert.rejects(
      commands.library_update_category({ request: { id: a.id, parentId: b.id } }),
      /descendants/,
    );
    await assert.rejects(
      commands.library_update_category({ request: { id: a.id, parentId: c.id } }),
      /descendants/,
    );
    await assert.rejects(
      commands.library_update_category({ request: { id: a.id, parentId: 'cat-missing' } }),
      /does not exist/,
    );

    const systemCategory = store.listCategoriesWithCounts().find((item) => item.isSystem);
    await assert.rejects(
      commands.library_update_category({ request: { id: a.id, parentId: systemCategory.id } }),
      /System categories/,
    );

    // 合法移动仍然可用。
    const moved = await commands.library_update_category({ request: { id: c.id, parentId: a.id } });
    assert.equal(moved.parentId, a.id);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('legacy category cycles neither hang category queries nor survive restart', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const appPaths = createAppPaths();
  let store = null;

  try {
    store = createLibraryStore(appPaths);
    const commands = createLibraryCommands({ appPaths, store });
    const a = await commands.library_create_category({ request: { name: 'Cycle A' } });
    const b = await commands.library_create_category({ request: { name: 'Cycle B', parentId: a.id } });

    // 预热一次查询计划，计时只反映环存在时是否终止，而不是冷启动成本。
    store.listCategoriesWithCounts();
    await commands.library_query_papers({ request: { categoryId: a.id, limit: 1 } });

    // 模拟旧版本写坏的环：A → B → A。此时 store 未重启，不经过启动修复。
    const raw = new DatabaseSync(appPaths.libraryDatabasePath);
    raw.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(b.id, a.id);
    raw.close();

    const startList = Date.now();
    const categories = store.listCategoriesWithCounts();
    const listElapsed = Date.now() - startList;
    assert.equal(categories.length >= 2, true);
    assert.ok(listElapsed < 100, `category list took ${listElapsed}ms with a cycle present`);

    const startQuery = Date.now();
    const page = await commands.library_query_papers({ request: { categoryId: a.id, limit: 10 } });
    const queryElapsed = Date.now() - startQuery;
    assert.equal(Array.isArray(page.papers), true);
    assert.ok(queryElapsed < 100, `paper query took ${queryElapsed}ms with a cycle present`);

    // 重启：启动自检断开环，分类仍可用。
    store.close();
    store = createLibraryStore(appPaths);
    const repaired = store.listCategoriesWithCounts();
    const repairedA = repaired.find((item) => item.id === a.id);
    const repairedB = repaired.find((item) => item.id === b.id);
    assert.ok(
      (repairedA.parentId ?? null) === null || (repairedB.parentId ?? null) === null,
      'at least one edge in the cycle should be detached on startup',
    );
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library_get_paper exposes papers beyond the 1000-row list clamp', async () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    store = createLibraryStore(appPaths);
    const library = store.load();
    for (let index = 0; index < 1200; index += 1) {
      library.papers.push({
        id: `paper-${index}`,
        title: `Paper ${index}`,
        year: null,
        publication: null,
        doi: null,
        url: null,
        abstractText: null,
        keywords: [],
        importedAt: index,
        updatedAt: index,
        lastReadAt: null,
        readingProgress: 0,
        isFavorite: false,
        userNote: null,
        aiSummary: null,
        citation: null,
        source: 'local',
        sortOrder: index,
        authors: [],
        tags: [],
        categoryIds: [],
        attachments: [],
      });
    }
    await store.save(library);

    const commands = createLibraryCommands({ appPaths, store });
    const clamped = await commands.library_list_papers({ request: { limit: 5000 } });
    assert.equal(clamped.length, 1200, 'library_list_papers no longer truncates at 1000 rows');

    const paper = await commands.library_get_paper({ paperId: 'paper-1199' });
    assert.equal(paper?.id, 'paper-1199');
    assert.equal(await commands.library_get_paper({ paperId: 'paper-missing' }), null);

    const page = await commands.library_query_papers({ request: { limit: 1000, offset: 1000 } });
    assert.equal(page.total, 1200);
    assert.equal(page.papers.length, 200);
    assert.equal(page.papers.some((item) => item.id === 'paper-1199'), true);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('startup cycle repair detaches a cycle node and keeps innocent descendants attached', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const appPaths = createAppPaths();
  let store = null;

  try {
    store = createLibraryStore(appPaths);
    const commands = createLibraryCommands({ appPaths, store });
    const a = await commands.library_create_category({ request: { name: 'Cycle A' } });
    const b = await commands.library_create_category({ request: { name: 'Cycle B', parentId: a.id } });
    // X 只是挂在环下，本身不在环上：修复必须保留 X → A。
    const x = await commands.library_create_category({ request: { name: 'Innocent Child', parentId: a.id } });

    const raw = new DatabaseSync(appPaths.libraryDatabasePath);
    raw.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(b.id, a.id);
    raw.close();

    store.close();
    store = createLibraryStore(appPaths);
    // 重新创建 commands：旧实例绑定的是已关闭的 store。
    const reopenedCommands = createLibraryCommands({ appPaths, store });
    const categories = store.listCategoriesWithCounts();
    const byId = new Map(categories.map((item) => [item.id, item]));

    assert.equal(byId.get(x.id).parentId, a.id, 'a descendant outside the cycle must keep its parent');
    const aParent = byId.get(a.id).parentId ?? null;
    const bParent = byId.get(b.id).parentId ?? null;
    assert.ok(
      aParent === null || bParent === null,
      'exactly the cycle must be broken',
    );
    // 修复后仍能正常查询与移动。
    await reopenedCommands.library_query_papers({ request: { categoryId: a.id, limit: 1 } });
    await reopenedCommands.library_update_category({ request: { id: x.id, parentId: null } });
    assert.equal(store.listCategoriesWithCounts().find((item) => item.id === x.id).parentId, null);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library_import_pdfs rejects files over the configured size limit', async () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    store = createLibraryStore(appPaths);
    const commands = createLibraryCommands({ appPaths, store, importLimits: { maxPdfBytes: 8 } });
    const sourcePath = path.join(appPaths.dataDir, 'oversized.pdf');
    writeFileSync(sourcePath, `%PDF-1.7\n${'x'.repeat(64)}`);

    const results = await commands.library_import_pdfs({
      request: { paths: [sourcePath], source: 'local' },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'failed');
    assert.match(results[0].message, /size limit/i);
    assert.equal(store.load().papers.length, 0);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library_import_pdfs hashes the file while streaming and imports it', async () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    store = createLibraryStore(appPaths);
    const commands = createLibraryCommands({ appPaths, store });
    const content = `%PDF-1.7\n${'paper body\n'.repeat(200)}`;
    const sourcePath = path.join(appPaths.dataDir, 'streamed.pdf');
    writeFileSync(sourcePath, content);

    const results = await commands.library_import_pdfs({
      request: { paths: [sourcePath], source: 'local' },
    });

    assert.equal(results[0].status, 'imported');
    assert.equal(
      results[0].paper.attachments[0].contentHash,
      createHash('sha256').update(content).digest('hex'),
    );
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('lookup_literature_metadata gives metadata HTTP requests a timeout signal', async () => {
  const appPaths = createAppPaths();
  let store = null;
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = String(url).includes('openalex')
      ? { id: 'https://openalex.org/W1', title: 'Paper' }
      : { message: { title: ['Paper'] } };
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    store = createLibraryStore(appPaths);
    const commands = createLibraryCommands({ appPaths, store, httpLimits: { metadataTimeoutMs: 20 } });

    await commands.lookup_literature_metadata({ request: { doi: '10.1000/paper' } });

    assert.ok(calls.length >= 2);
    assert.ok(calls.every((call) => call.init?.signal instanceof AbortSignal));
  } finally {
    globalThis.fetch = originalFetch;
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
