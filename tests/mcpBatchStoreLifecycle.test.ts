import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
const {
  PaperQuayKnowledgeService,
  resolveAppPaths,
} = require('../electron/mcp/knowledgeMcpService.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows 可能短暂持有临时目录句柄；残留目录不影响断言。
  }
}

function seedLibrary(appPaths: ReturnType<typeof resolveAppPaths>) {
  // Create the full schema through the real store once, then seed one row.
  createLibraryStore(appPaths).close();
  const db = new DatabaseSync(appPaths.libraryDatabasePath);
  try {
    db.prepare(`
      INSERT INTO papers (
        id, title, title_zh, year, publication, doi, abstract_text, item_type,
        imported_at, updated_at, reading_progress, is_favorite, source, sort_order, rag_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'paper-1',
      'Attention Is All You Need',
      '注意力即所需',
      '2017',
      'NeurIPS',
      '10.1000/transformer',
      'The dominant sequence transduction models rely on attention.',
      'journalArticle',
      1,
      1,
      0,
      0,
      'local',
      0,
      1,
    );
  } finally {
    db.close();
  }
}

function createFakeStore() {
  return {
    loadCalls: 0,
    closed: 0,
    getPaperCalls: [] as string[],
    listCategoriesWithCounts() {
      return [];
    },
    load() {
      this.loadCalls += 1;
      return { settings: {}, categories: [], papers: [] };
    },
    getPaper(paperId: string) {
      this.getPaperCalls.push(paperId);
      return null;
    },
    close() {
      this.closed += 1;
    },
  };
}

test('MCP read calls create at most one library store and id lookups never load()', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pq-mcp-store-lifecycle-'));
  const appPaths = resolveAppPaths(dataDir);
  seedLibrary(appPaths);

  const factoryCalls: string[] = [];
  const stores: Array<ReturnType<typeof createFakeStore>> = [];
  const service = new PaperQuayKnowledgeService({
    dataDir,
    isAppRunning: () => false,
    libraryStoreFactory: (paths: ReturnType<typeof resolveAppPaths>) => {
      factoryCalls.push(paths.libraryDatabasePath);
      const store = createFakeStore();
      stores.push(store);
      return store;
    },
  });

  try {
    // 100 id lookups + filtered list queries: the read-only SQL path must not
    // instantiate or hydrate the full-library store.
    for (let index = 0; index < 100; index += 1) {
      const details = service.getPaperDetails({ paperId: 'paper-1' });
      assert.equal(details?.id, 'paper-1');
      assert.equal(details?.title, 'Attention Is All You Need');
      const page = service.searchPapers({ query: 'attention', limit: 5 });
      assert.equal(page.papers.length, 1);
    }
    assert.equal(factoryCalls.length, 0, 'id lookups must not create a library store');

    // A store-backed read creates exactly one singleton across 100 calls.
    for (let index = 0; index < 100; index += 1) {
      const result = service.listCategories();
      assert.equal(result.total, 0);
    }
    assert.equal(factoryCalls.length, 1, 'singleton store must be created at most once');
    assert.equal(stores[0].loadCalls, 0, 'listing categories must not hydrate the full library');
    assert.equal(stores[0].closed, 0);

    // Interleaving id lookups must not create a second store nor call load().
    for (let index = 0; index < 20; index += 1) {
      service.getPaperDetails({ paperId: 'paper-1' });
      service.searchPapers({ query: 'transformer', limit: 5 });
      service.previewDeletePapers({ paperIds: ['paper-1'] });
    }
    assert.equal(factoryCalls.length, 1);
    assert.equal(stores[0].loadCalls, 0);

    // close()/dispose() release the singleton exactly once and are idempotent.
    service.close();
    assert.equal(stores[0].closed, 1);
    service.dispose();
    assert.equal(stores[0].closed, 1);
  } finally {
    service.close();
    cleanupDir(dataDir);
  }
});
