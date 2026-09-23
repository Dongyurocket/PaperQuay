import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  attachCategoryCounts,
  createLibraryStore,
  paperMatches,
  sortPapers,
} = require('../electron/backend/libraryStore.cjs');

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-library-query-'));

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

function makePaper(index: number, overrides: Record<string, unknown> = {}) {
  const label = String(index).padStart(2, '0');

  return {
    id: `p${label}`,
    title: `paper ${label}`,
    titleZh: null,
    year: String(2000 + index),
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
    keywords: [] as string[],
    importedAt: 1_000_000 + index,
    updatedAt: 2_000_000 + index,
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: index % 7 === 0,
    userNote: null,
    aiSummary: null,
    citation: null,
    source: 'local',
    sortOrder: index,
    authors: [] as Array<Record<string, unknown>>,
    tags: [] as Array<Record<string, unknown>>,
    categoryIds: [] as string[],
    attachments: [] as Array<Record<string, unknown>>,
    ...overrides,
  };
}

function buildLibrary(appPaths: ReturnType<typeof createAppPaths>) {
  const store = createLibraryStore(appPaths);
  const library = store.load();
  const timestamp = 1;

  library.categories.push(
    {
      id: 'cat-parent',
      name: 'Parent',
      parentId: null,
      sortOrder: 10,
      isSystem: false,
      systemKey: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      paperCount: 0,
    },
    {
      id: 'cat-child',
      name: 'Child',
      parentId: 'cat-parent',
      sortOrder: 11,
      isSystem: false,
      systemKey: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      paperCount: 0,
    },
    {
      id: 'cat-other',
      name: 'Other',
      parentId: null,
      sortOrder: 12,
      isSystem: false,
      systemKey: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      paperCount: 0,
    },
  );

  const papers = [];
  for (let index = 1; index <= 32; index += 1) {
    papers.push(makePaper(index));
  }

  papers[2] = makePaper(3, {
    abstractText: 'mentions quantum tunneling',
    categoryIds: ['cat-parent', 'cat-child'],
  });
  papers[3] = makePaper(4, {
    keywords: ['graphene'],
    categoryIds: ['cat-child'],
  });
  papers[4] = makePaper(5, {
    authors: [{
      id: 'auth-alice',
      name: 'Alice Walker',
      givenName: 'Alice',
      familyName: 'Walker',
      sortOrder: 0,
    }],
    categoryIds: ['cat-other'],
  });
  papers[5] = makePaper(6, {
    tags: [{ id: 'tag-ml', name: 'machine-learning', color: null }],
  });
  papers[6] = makePaper(7, { categoryIds: ['cat-parent'] });
  papers.push(makePaper(33, { title: '100% yield study' }));
  papers.push(makePaper(34, { title: 'code a_b sample' }));

  library.papers = papers;
  store.save(library);

  return { store, library };
}

function oracleIds(library: { papers: unknown[]; categories: unknown[] }, request: Record<string, unknown>) {
  const matched = library.papers.filter((paper) => paperMatches(paper, request, library));
  return sortPapers(matched, request).map((paper: { id: string }) => paper.id);
}

function sqlIds(
  store: ReturnType<typeof createLibraryStore>,
  request: Record<string, unknown>,
) {
  const page = store.queryPapers({ limit: 5000, ...request });
  return page.papers.map((paper: { id: string }) => paper.id);
}

test('SQL query matches JS filter sets and keeps a stable page order', () => {
  const appPaths = createAppPaths();
  const { store, library } = buildLibrary(appPaths);

  try {
    const requests: Array<Record<string, unknown>> = [
      { sortBy: 'manual', sortDirection: 'asc' },
      { sortBy: 'title', sortDirection: 'asc' },
      { sortBy: 'year', sortDirection: 'desc' },
      { categoryId: 'system-all' },
      { categoryId: 'all' },
      { categoryId: 'system-favorites' },
      { categoryId: 'system-uncategorized' },
      { categoryId: 'system-recent' },
      { categoryId: 'cat-parent' },
      { categoryId: 'cat-child' },
      { categoryId: 'missing-category' },
      { tagId: 'tag-ml' },
      { search: 'quantum' },
      { search: 'alice' },
      { search: 'graphene' },
      { search: 'machine' },
      { search: '100%' },
      { search: '_' },
    ];

    for (const request of requests) {
      const expected = oracleIds(library, request).sort();
      const actual = sqlIds(store, request).sort();
      assert.deepEqual(actual, expected, JSON.stringify(request));
    }

    const manual = oracleIds(library, { sortBy: 'manual', sortDirection: 'asc' });
    const titleAsc = oracleIds(library, { sortBy: 'title', sortDirection: 'asc' });
    const yearDesc = oracleIds(library, { sortBy: 'year', sortDirection: 'desc' });
    assert.deepEqual(sqlIds(store, { sortBy: 'manual', sortDirection: 'asc' }), manual);
    assert.deepEqual(sqlIds(store, { sortBy: 'title', sortDirection: 'asc' }), titleAsc);
    assert.deepEqual(sqlIds(store, { sortBy: 'year', sortDirection: 'desc' }), yearDesc);

    const collected: string[] = [];
    const pageSize = 7;
    for (let offset = 0; collected.length < manual.length; offset += pageSize) {
      const page = store.queryPapers({ sortBy: 'manual', sortDirection: 'asc', limit: pageSize, offset });
      assert.equal(page.total, manual.length);
      assert.equal(page.offset, offset);
      assert.equal(page.limit, pageSize);
      collected.push(...page.papers.map((paper: { id: string }) => paper.id));
      if (page.papers.length === 0) break;
    }
    assert.deepEqual(collected, manual);

    const beyond = store.queryPapers({ limit: 10, offset: 10_000 });
    assert.deepEqual(beyond.papers, []);
    assert.equal(beyond.total, library.papers.length);
    assert.equal(store.countPapers({ categoryId: 'system-all' }), library.papers.length);
    assert.equal(store.countPapers({ categoryId: 'all' }), library.papers.length);
    assert.equal(store.countPapers({ search: 'quantum' }), oracleIds(library, { search: 'quantum' }).length);
    assert.deepEqual(
      store.listPaperIds({ sortBy: 'manual', sortDirection: 'asc', limit: 5000 }),
      manual,
    );
    assert.deepEqual(
      store.listPaperIds({ categoryId: 'system-all', sortBy: 'manual', sortDirection: 'asc', limit: 5000 }),
      manual,
    );
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('category counts count a paper once even when it belongs to a parent and a child', () => {
  const appPaths = createAppPaths();
  const { store, library } = buildLibrary(appPaths);

  try {
    const expected = attachCategoryCounts(library);
    const actual = store.listCategoriesWithCounts();
    assert.deepEqual(
      actual.map((category: { id: string; paperCount: number }) => [category.id, category.paperCount]),
      expected.map((category: { id: string; paperCount: number }) => [category.id, category.paperCount]),
    );
    const parent = actual.find((category: { id: string }) => category.id === 'cat-parent');
    assert.equal(parent.paperCount, 3);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('savePaper updates one paper without rewriting references or other papers', () => {
  const appPaths = createAppPaths();
  const { store, library } = buildLibrary(appPaths);

  try {
    store.saveReferences('p01', [{ id: 'ref-1', title: 'Kept Reference', doi: '10.1000/kept' }]);
    const original = store.getPaper('p01');
    assert.ok(original);
    store.savePaper({ ...original, title: 'renamed paper' });

    const updated = store.getPaper('p01');
    assert.equal(updated.title, 'renamed paper');
    assert.equal(store.getPaper('p02').title, 'paper 02');
    assert.equal(store.loadReferences('p01')[0]?.title, 'Kept Reference');
    assert.equal(store.queryPapers({ search: 'renamed', limit: 10 }).total, 1);
    assert.equal(library.papers.length, store.countPapers({}));
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('deletePaper removes the paper and cascaded references', () => {
  const appPaths = createAppPaths();
  const { store } = buildLibrary(appPaths);

  try {
    store.saveReferences('p01', [{ id: 'ref-1', title: 'Gone Reference', doi: '10.1000/gone' }]);
    const before = store.countPapers({});
    store.deletePaper('p01');
    assert.equal(store.getPaper('p01'), null);
    assert.equal(store.countPapers({}), before - 1);
    assert.deepEqual(store.loadReferences('p01'), []);
    assert.equal(store.listPaperIds({ limit: 5000 }).includes('p01'), false);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
