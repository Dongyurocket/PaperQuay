import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-batch7-library-'));
  return {
    dataDir,
    configPath: path.join(dataDir, 'config.json'),
    libraryPath: path.join(dataDir, 'library.json'),
    libraryDatabasePath: path.join(dataDir, 'library.sqlite'),
    ragDatabasePath: path.join(dataDir, 'rag.sqlite'),
  };
}

async function seedLibrary(commands, appPaths, count = 3) {
  const paths = [];
  for (let index = 0; index < count; index += 1) {
    const pdf = path.join(appPaths.dataDir, `paper-${index}.pdf`);
    writeFileSync(pdf, `%PDF-1.7\npaper ${index}`);
    paths.push(pdf);
  }
  const imported = await commands.library_import_pdfs({
    request: {
      paths,
      importMode: 'keep',
      metadata: Object.fromEntries(paths.map((pdf, index) => [pdf, {
        title: `Paper ${index}`,
      }])),
    },
  });
  return imported.map((entry) => entry.paper);
}

test('library_init returns settings and category counts only, never the full library', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  let loadCalls = 0;
  const proxy = new Proxy(store, {
    get(target, property) {
      if (property === 'load') {
        return (...args) => {
          loadCalls += 1;
          return target.load(...args);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    const commands = createLibraryCommands({ appPaths, store: proxy });
    await seedLibrary(commands, appPaths, 3);
    loadCalls = 0;

    const snapshot = await commands.library_init();

    assert.equal('papers' in snapshot, false);
    assert.equal(Array.isArray(snapshot.categories), true);
    assert.equal(snapshot.settings.importMode, 'copy');
    assert.equal(snapshot.categories.find((category) => category.systemKey === 'all')?.paperCount, 3);
    assert.equal(loadCalls, 0, 'library_init must not hydrate the full library');

    const firstPage = await commands.library_query_papers({ request: { limit: 2, offset: 0 } });
    assert.equal(firstPage.papers.length, 2);
    assert.equal(firstPage.total, 3);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library_get_paper_summary returns list fields without heavy metadata', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  try {
    const commands = createLibraryCommands({ appPaths, store });
    const [paper] = await seedLibrary(commands, appPaths, 1);

    const summary = await commands.library_get_paper_summary({ paperId: paper.id });

    assert.equal(summary.id, paper.id);
    assert.equal(summary.title, paper.title);
    assert.equal(Array.isArray(summary.authors), true);
    assert.equal(Array.isArray(summary.tags), true);
    assert.equal(Array.isArray(summary.attachments), true);
    assert.equal('abstractText' in summary, false);
    assert.equal('doi' in summary, false);
    assert.equal('url' in summary, false);
    assert.equal('userNote' in summary, false);
    assert.equal('citation' in summary, false);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library_list_citation_keys returns only id/key pairs for duplicate checks', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  try {
    const commands = createLibraryCommands({ appPaths, store });
    const [paper] = await seedLibrary(commands, appPaths, 1);
    await commands.library_update_paper({ request: { paperId: paper.id, citationKey: 'Smith2024' } });

    const keys = await commands.library_list_citation_keys();

    assert.deepEqual(keys.map((entry) => ({ id: entry.id, citationKey: entry.citationKey })), [
      { id: paper.id, citationKey: 'Smith2024' },
    ]);
    assert.equal('title' in keys[0], false);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('batch favorite and move apply to every selected paper in one transaction', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  try {
    const commands = createLibraryCommands({ appPaths, store });
    const papers = await seedLibrary(commands, appPaths, 3);
    const category = await commands.library_create_category({ request: { name: 'Batch target' } });
    const ids = papers.map((paper) => paper.id);

    const favoriteResult = await commands.library_batch_update_papers({
      request: { paperIds: ids, isFavorite: true },
    });
    assert.equal(favoriteResult.updated, 3);
    assert.equal(ids.every((id) => store.getPaper(id).isFavorite), true);

    const moveResult = await commands.library_batch_update_papers({
      request: { paperIds: ids, addCategoryId: category.id },
    });
    assert.equal(moveResult.updated, 3);
    assert.equal(ids.every((id) => store.getPaper(id).categoryIds.includes(category.id)), true);

    await assert.rejects(
      commands.library_batch_update_papers({
        request: { paperIds: [ids[0], 'missing-paper'], isFavorite: false },
      }),
      /Paper does not exist/,
    );
    assert.equal(store.getPaper(ids[0]).isFavorite, true, 'failed batch must roll back');
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('batch delete removes all selected records and reports RAG cleanup failures', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const removed = [];
  const ragStore = {
    async removeDocumentIndex({ documentKey }) {
      if (documentKey === 'fail') throw new Error('index busy');
      removed.push(documentKey);
    },
  };
  try {
    const commands = createLibraryCommands({ appPaths, store, ragStore });
    const papers = await seedLibrary(commands, appPaths, 3);
    const ids = papers.map((paper) => paper.id);

    const result = await commands.library_batch_delete_papers({
      request: { paperIds: ids, deleteFiles: false },
    });

    assert.equal(result.deleted, 3);
    assert.deepEqual(result.ragFailures, []);
    assert.deepEqual([...removed].sort(), [...ids].sort());
    assert.equal(ids.every((id) => store.getPaper(id) === null), true);
    assert.equal((await commands.library_query_papers({ request: { limit: 10 } })).total, 0);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('category counts count nested descendants once per paper', async () => {
  const { attachCategoryCounts } = require('../electron/backend/libraryStore.cjs');
  const category = (id, parentId = null) => ({
    id, name: id, parentId, sortOrder: 0, isSystem: false, systemKey: null,
    createdAt: 1, updatedAt: 1,
  });
  const paper = (id, categoryIds, isFavorite = false) => ({
    id, title: id, categoryIds, isFavorite, authors: [], tags: [], attachments: [], keywords: [],
  });
  const library = {
    categories: [
      { id: 'all', name: 'All', parentId: null, sortOrder: 0, isSystem: true, systemKey: 'all', createdAt: 1, updatedAt: 1 },
      category('root'),
      category('child', 'root'),
      category('grandchild', 'child'),
    ],
    papers: [
      paper('p1', ['grandchild']),
      paper('p2', ['child', 'grandchild']),
      paper('p3', ['root'], true),
      paper('p4', []),
    ],
  };

  const counts = new Map(attachCategoryCounts(library).map((item) => [item.id, item.paperCount]));

  assert.equal(counts.get('all'), 4);
  assert.equal(counts.get('root'), 3);
  assert.equal(counts.get('child'), 2);
  assert.equal(counts.get('grandchild'), 2);
});

test('category counts stay fast for 5000 papers across 50 nested categories', () => {
  const { attachCategoryCounts } = require('../electron/backend/libraryStore.cjs');
  const categories = [{
    id: 'all', name: 'All', parentId: null, sortOrder: 0, isSystem: true, systemKey: 'all', createdAt: 1, updatedAt: 1,
  }];
  for (let index = 0; index < 50; index += 1) {
    categories.push({
      id: `cat-${index}`,
      name: `Category ${index}`,
      parentId: index === 0 ? null : `cat-${index - 1}`,
      sortOrder: index,
      isSystem: false,
      systemKey: null,
      createdAt: 1,
      updatedAt: 1,
    });
  }
  const papers = Array.from({ length: 5000 }, (_, index) => ({
    id: `paper-${index}`,
    title: `Paper ${index}`,
    categoryIds: [`cat-${index % 50}`, 'cat-0'],
    isFavorite: index % 3 === 0,
    authors: [],
    tags: [],
    attachments: [],
    keywords: [],
  }));

  const started = performance.now();
  const counted = attachCategoryCounts({ categories, papers });
  const elapsed = performance.now() - started;
  const counts = new Map(counted.map((category) => [category.id, category.paperCount]));

  assert.equal(counts.get('all'), 5000);
  assert.equal(counts.get('cat-0'), 5000, 'all papers also belong to the root');
  assert.equal(counts.get('cat-49'), 100, 'deepest category only sees its own papers');
  assert.equal(elapsed < 200, true, `category counts took ${elapsed.toFixed(1)}ms`);
  if (process.env.PAPERQUAY_PERF === '1') {
    console.log(`[perf] 5000 papers / 50 nested categories: ${elapsed.toFixed(2)}ms`);
  }
});

test('batch delete removes managed files only after the database transaction commits', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  try {
    const sourcePdf = path.join(appPaths.dataDir, 'source.pdf');
    writeFileSync(sourcePdf, '%PDF-1.7\nbatch delete ordering');
    const imported = await createLibraryCommands({ appPaths, store }).library_import_pdfs({
      request: {
        paths: [sourcePdf],
        importMode: 'copy',
        metadata: { [sourcePdf]: { title: 'Delete ordering' } },
      },
    });
    const paper = imported[0].paper;
    const storedPath = paper.attachments.find((attachment) => attachment.kind === 'pdf')?.storedPath;
    assert.ok(storedPath, 'import copy must store a managed PDF path');
    assert.equal(existsSync(storedPath), true);

    const failingStore = new Proxy(store, {
      get(target, property) {
        if (property === 'deletePapers') {
          return () => { throw new Error('simulated database failure'); };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const failingCommands = createLibraryCommands({ appPaths, store: failingStore });

    await assert.rejects(
      () => failingCommands.library_batch_delete_papers({ request: { paperIds: [paper.id], deleteFiles: true } }),
      /simulated database failure/,
    );
    assert.equal(existsSync(storedPath), true, 'a failed transaction must not delete the PDF first');
    assert.ok(store.getPaper(paper.id), 'the paper record must still exist after rollback');

    const commands = createLibraryCommands({ appPaths, store });
    const result = await commands.library_batch_delete_papers({ request: { paperIds: [paper.id], deleteFiles: true } });
    assert.equal(result.deleted, 1);
    assert.deepEqual(result.fileFailures, []);
    assert.equal(existsSync(storedPath), false, 'committed delete removes the managed file');
    assert.equal(store.getPaper(paper.id), null);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('attachment filters query only ids/attachments instead of hydrating the whole library', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  let loadCalls = 0;
  const proxy = new Proxy(store, {
    get(target, property) {
      if (property === 'load') {
        return (...args) => {
          loadCalls += 1;
          return target.load(...args);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    const commands = createLibraryCommands({ appPaths, store: proxy });
    await seedLibrary(commands, appPaths, 3);
    loadCalls = 0;

    const withPdf = await commands.library_query_papers({ request: { hasPdf: true } });
    assert.equal(withPdf.total, 3);
    assert.equal(loadCalls, 0, 'hasPdf filters must not call store.load()');

    const withoutPdf = await commands.library_query_papers({ request: { hasPdf: false } });
    assert.equal(withoutPdf.total, 0);
    assert.equal(loadCalls, 0);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
