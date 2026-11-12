import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
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
    lastReadAt: index % 2 === 0 ? 3_000_000 + index : null,
    readingProgress: index / 40,
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
    year: '2003',
    abstractText: 'mentions quantum tunneling',
    categoryIds: ['cat-parent', 'cat-child'],
  });
  papers[3] = makePaper(4, {
    publication: 'Journal of Graphene Systems',
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
    year: '2005',
    categoryIds: ['cat-other'],
  });
  papers[5] = makePaper(6, {
    itemType: 'report',
    isFavorite: true,
    tags: [{ id: 'tag-ml', name: 'machine-learning', color: null }],
    attachments: [{ id: 'att-original', paperId: 'p06', kind: 'pdf', storedPath: 'p06.pdf', fileName: 'p06.pdf', mimeType: 'application/pdf', fileSize: 1, createdAt: 1, missing: false }],
  });
  papers[6] = makePaper(7, { itemType: 'book', isFavorite: false, categoryIds: ['cat-parent'] });
  papers[7] = makePaper(8, {
    attachments: [{ id: 'att-translation', paperId: 'p08', kind: 'translated-pdf', storedPath: 'p08-zh.pdf', fileName: 'p08-zh.pdf', mimeType: 'application/pdf', fileSize: 1, createdAt: 1, missing: false }],
  });
  papers[8] = makePaper(9, {
    attachments: [{ id: 'att-missing', paperId: 'p09', kind: 'pdf', storedPath: 'p09.pdf', fileName: 'p09.pdf', mimeType: 'application/pdf', fileSize: 1, createdAt: 1, missing: true }],
  });
  papers.push(makePaper(33, { title: '100% yield study' }));
  papers.push(makePaper(34, { title: 'code a_b sample', year: '未知年份' }));
  papers.push(makePaper(35, {
    authors: [{ id: 'auth-unicode', name: 'Kelvin Author', givenName: 'Kelvin', familyName: 'Author', sortOrder: 0 }],
    publication: 'Engineering Review',
    keywords: ['Thermal Transfer'],
    tags: [{ id: 'tag-unicode', name: '\u00a0Finite Elements\u00a0', color: null }],
  }));
  papers.push(makePaper(36, { year: 'n.d.' }));
  papers.push(makePaper(37, { year: ' 2020' }));

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
      { itemType: 'report' },
      { itemType: 'book', isFavorite: false },
      { isFavorite: true },
      { isFavorite: false },
      { isRead: true },
      { isRead: false, progressFrom: 20, progressTo: 40 },
      { progressFrom: 0, progressTo: 2.5 },
      { importedAtFrom: 1_000_010, importedAtTo: 1_000_020 },
      { lastReadAtFrom: 3_000_010, lastReadAtTo: 3_000_020 },
      { lastReadAtFrom: 3_000_020 },
      { attachmentRole: 'original-pdf' },
      { attachmentRole: 'translated-pdf' },
      { attachmentRole: 'missing' },
      { attachmentRole: 'none' },
      { missingMetadataFields: ['doi'] },
      { missingMetadataFields: ['isbn'] },
      { missingMetadataFields: ['reportNumber', 'publication'] },
      { categoryId: 'cat-parent', itemType: 'report', isFavorite: true, ragEnabled: true },
      { yearFrom: 2003, yearTo: 2005 },
      { yearFrom: 2003 },
      { unknownYearOnly: true },
      { authorQuery: 'alice' },
      { authorQuery: 'kelvin' },
      { publicationQuery: 'graphene systems' },
      { publicationQuery: 'engineering review' },
      { keywordQuery: 'graphene' },
      { keywordQuery: 'thermal transfer' },
      { tagNames: [' MACHINE-LEARNING '] },
      { tagNames: ['finite elements'] },
      { yearFrom: 2003, authorQuery: 'alice', tagNames: ['machine-learning', 'other'] },
      { search: 'quantum' },
      { search: 'alice' },
      { search: 'graphene' },
      { search: 'machine' },
      { search: 'kelvin' },
      { search: '100%' },
      { search: '_' },
    ];

    for (const request of requests) {
      const orderedExpected = oracleIds(library, request);
      const expected = [...orderedExpected].sort();
      const actual = sqlIds(store, request).sort();
      assert.deepEqual(actual, expected, JSON.stringify(request));
      assert.equal(store.countPapers(request), orderedExpected.length, `count ${JSON.stringify(request)}`);
      assert.deepEqual(
        store.listPaperIds({ ...request, limit: 5000 }),
        sqlIds(store, request),
        `selected IDs ${JSON.stringify(request)}`,
      );
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
    assert.throws(() => store.queryPapers({ itemType: 'not-a-supported-type' }), /Unsupported itemType filter/);
    assert.throws(() => store.countPapers({ itemType: 'not-a-supported-type' }), /Unsupported itemType filter/);
    assert.throws(() => store.queryPapers({ yearFrom: 2025, yearTo: 2020 }), /yearFrom exceeds yearTo/);
    assert.throws(() => store.countPapers({ yearFrom: 0 }), /Invalid yearFrom year filter/);
    assert.throws(() => store.queryPapers({ progressFrom: 80, progressTo: 20 }), /progressFrom exceeds progressTo/);
    assert.throws(() => store.countPapers({ progressFrom: 101 }), /Invalid progressFrom reading progress filter/);
    assert.throws(() => store.queryPapers({ importedAtFrom: 1_000_020, importedAtTo: 1_000_010 }), /importedAt range: from exceeds to/);
    assert.throws(() => store.queryPapers({ lastReadAtFrom: -1 }), /Invalid lastReadAtFrom timestamp filter/);
    assert.throws(() => store.queryPapers({ attachmentRole: 'audio' }), /Unsupported attachmentRole filter/);
    assert.throws(() => store.queryPapers({ missingMetadataFields: ['madeUpField'] }), /Unsupported missing metadata field/);
    const missingDoiIds = sqlIds(store, { missingMetadataFields: ['doi'] });
    assert.equal(missingDoiIds.includes('p07'), false, 'books do not match a missing DOI filter because DOI is not applicable');
    const missingIsbnIds = sqlIds(store, { missingMetadataFields: ['isbn'] });
    assert.equal(missingIsbnIds.includes('p06'), false, 'reports do not match a missing ISBN filter');
    assert.deepEqual(sqlIds(store, { unknownYearOnly: true }).sort(), ['p34', 'p36', 'p37']);

    store.setPapersRagEnabled(['p01'], false);
    const excluded = library.papers.find((paper: { id: string }) => paper.id === 'p01');
    excluded.ragEnabled = false;
    assert.deepEqual(sqlIds(store, { ragEnabled: false }), ['p01']);
    assert.equal(sqlIds(store, { ragEnabled: true }).includes('p01'), false);
    assert.deepEqual(
      sqlIds(store, { ragEnabled: false }).sort(),
      oracleIds(library, { ragEnabled: false }).sort(),
    );
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('persisted MinerU status filters agree across query, count and ID enumeration and invalidate on source changes', () => {
  const appPaths = createAppPaths();
  const { store } = buildLibrary(appPaths);
  try {
    const initial = store.getMineruParseStatuses(['p01', 'p02', 'p03']);
    assert.deepEqual(initial.map((item: { status: string }) => item.status), ['unknown', 'unknown', 'unknown']);
    const byId = new Map(initial.map((item: { paperId: string }) => [item.paperId, item]));

    const checkedAt = Date.now();
    assert.deepEqual(store.saveMineruParseStatuses([
      { paperId: 'p01', sourceVersion: byId.get('p01').sourceVersion, status: 'available', checkedAt },
      { paperId: 'p02', sourceVersion: byId.get('p02').sourceVersion, status: 'missing', checkedAt },
    ]), { accepted: 2, stale: 0 });

    const availableRequest = { mineruParseStatus: 'available' };
    const query = store.queryPapers({ ...availableRequest, limit: 1000 });
    assert.deepEqual(query.papers.map((paper: { id: string }) => paper.id), ['p01']);
    assert.equal(query.total, 1);
    assert.equal(store.countPapers(availableRequest), 1);
    assert.deepEqual(store.listPaperIds(availableRequest), ['p01']);
    assert.deepEqual(store.queryPapers({ mineruParseStatus: 'unknown', limit: 1000 }).papers.map((paper: { id: string }) => paper.id).slice(0, 3), ['p03', 'p04', 'p05']);

    assert.deepEqual(store.saveMineruParseStatuses([
      { paperId: 'p01', sourceVersion: byId.get('p01').sourceVersion, status: 'available', checkedAt: Date.now() - 25 * 60 * 60 * 1000 },
    ]), { accepted: 1, stale: 0 });
    assert.equal(store.getMineruParseStatuses(['p01'])[0].status, 'unknown', 'expired checks return to the unverified state');
    assert.deepEqual(store.queryPapers({ mineruParseStatus: 'unknown', limit: 1000 }).papers.some((paper: { id: string }) => paper.id === 'p01'), true);
    assert.deepEqual(store.saveMineruParseStatuses([
      { paperId: 'p02', sourceVersion: byId.get('p02').sourceVersion, status: 'error', checkedAt: Date.now() },
    ]), { accepted: 1, stale: 0 });
    assert.equal(store.getMineruParseStatuses(['p02'])[0].status, 'error');
    assert.equal(store.countPapers({ mineruParseStatus: 'error' }), 1);
    assert.deepEqual(store.listPaperIds({ mineruParseStatus: 'error' }), ['p02']);

    const staleSourceVersion = byId.get('p01').sourceVersion;
    const paper = store.getPaper('p01');
    store.savePaper({ ...paper, title: 'renamed source' });
    const afterRename = store.getMineruParseStatuses(['p01'])[0];
    assert.equal(afterRename.status, 'unknown');
    assert.notEqual(afterRename.sourceVersion, staleSourceVersion);
    assert.deepEqual(store.saveMineruParseStatuses([
      { paperId: 'p01', sourceVersion: staleSourceVersion, status: 'available', checkedAt: Date.now() },
    ]), { accepted: 0, stale: 1 });
    assert.deepEqual(store.queryPapers({ mineruParseStatus: 'available', limit: 1000 }).papers, []);

    const deletedSourceVersion = byId.get('p03').sourceVersion;
    store.deletePaper('p03');
    assert.deepEqual(store.saveMineruParseStatuses([
      { paperId: 'p03', sourceVersion: deletedSourceVersion, status: 'missing', checkedAt: Date.now() },
    ]), { accepted: 0, stale: 1 }, 'a late filesystem result cannot recreate status for a deleted paper');
    assert.deepEqual(store.getMineruParseStatuses(['p03']), []);
    assert.throws(() => store.queryPapers({ mineruParseStatus: 'completed' }), /Unsupported mineruParseStatus/);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('MinerU status projection reconciles missing and stale rows across restart without losing valid failures', () => {
  const appPaths = createAppPaths();
  let store: ReturnType<typeof createLibraryStore> | null = createLibraryStore(appPaths);
  try {
    const library = store.load();
    for (let index = 100; index < 1110; index += 1) {
      library.papers.push(makePaper(index, { id: `projection-${index}` }));
    }
    store.save(library);

    const ids = ['projection-100', 'projection-500', 'projection-1109'];
    const snapshots = new Map(store.getMineruParseStatuses(ids).map((item: { paperId: string }) => [item.paperId, item]));
    assert.deepEqual(store.saveMineruParseStatuses([
      { paperId: 'projection-1109', sourceVersion: snapshots.get('projection-1109').sourceVersion, status: 'error', checkedAt: Date.now() },
      { paperId: 'projection-500', sourceVersion: snapshots.get('projection-500').sourceVersion, status: 'available', checkedAt: Date.now() },
    ]), { accepted: 2, stale: 0 });

    const changed = store.getPaper('projection-500');
    store.savePaper({ ...changed, title: `${changed.title} changed` });
    store.close();
    store = null;

    const db = new DatabaseSync(appPaths.libraryDatabasePath);
    db.exec("DELETE FROM paper_processing_status WHERE paper_id IN ('projection-100', 'projection-1109')");
    db.close();

    store = createLibraryStore(appPaths);
    assert.equal(store.countPapers({}), library.papers.length);
    assert.equal(store.getMineruParseStatuses(['projection-100'])[0].status, 'unknown');
    assert.equal(store.getMineruParseStatuses(['projection-1109'])[0].status, 'unknown', 'missing projection row is rebuilt for papers beyond the first page');
    assert.equal(store.getMineruParseStatuses(['projection-500'])[0].status, 'unknown', 'a stale source version is invalidated on startup');

    const repaired = store.getMineruParseStatuses(['projection-100', 'projection-1109', 'projection-500']);
    assert.deepEqual(repaired.map((item: { status: string }) => item.status), ['unknown', 'unknown', 'unknown']);
    assert.deepEqual(store.reconcileMineruStatusProjection(), {
      papers: library.papers.length,
      inserted: 0,
      invalidated: 0,
    }, 'reconciliation is idempotent');

    assert.deepEqual(store.saveMineruParseStatuses([
      { paperId: 'projection-1109', sourceVersion: repaired[1].sourceVersion, status: 'error', checkedAt: Date.now() },
    ]), { accepted: 1, stale: 0 });
    store.close();
    store = null;
    store = createLibraryStore(appPaths);
    assert.equal(store.getMineruParseStatuses(['projection-1109'])[0].status, 'error', 'valid failed checks survive restart for explicit retry');
    assert.deepEqual(store.listPaperIds({ mineruParseStatus: 'error' }), ['projection-1109']);
    store.deletePaper('projection-1109');
    assert.equal(store.getMineruParseStatuses(['projection-1109']).length, 0);
  } finally {
    store?.close();
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

test('schema startup replaces the early attachment-delete trigger before cascade deletes', () => {
  const appPaths = createAppPaths();
  let store: ReturnType<typeof createLibraryStore> | null = createLibraryStore(appPaths);
  try {
    const library = store.load();
    library.papers.push(makePaper(90, {
      id: 'trigger-migration-paper',
      attachments: [{
        id: 'trigger-migration-attachment', paperId: 'trigger-migration-paper', kind: 'pdf',
        originalPath: 'source.pdf', storedPath: 'source.pdf', relativePath: null,
        fileName: 'source.pdf', mimeType: 'application/pdf', fileSize: 1,
        contentHash: null, createdAt: 1, missing: false,
      }],
    }));
    store.save(library);
    store.close();
    store = null;

    const legacyDb = new DatabaseSync(appPaths.libraryDatabasePath);
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      DROP TRIGGER IF EXISTS invalidate_mineru_status_after_attachment_delete;
      CREATE TRIGGER invalidate_mineru_status_after_attachment_delete
      AFTER DELETE ON attachments BEGIN
        INSERT INTO paper_processing_status (paper_id, mineru_status, mineru_source_version, updated_at)
        VALUES (OLD.paper_id, 'unknown', '', CAST(strftime('%s','now') AS INTEGER) * 1000)
        ON CONFLICT(paper_id) DO UPDATE SET mineru_status='unknown', mineru_source_version='',
          mineru_checked_at=NULL, updated_at=excluded.updated_at;
      END;
      DELETE FROM paper_processing_status WHERE paper_id='trigger-migration-paper';
    `);
    legacyDb.close();

    store = createLibraryStore(appPaths);
    assert.doesNotThrow(() => store.deletePaper('trigger-migration-paper'));
    assert.equal(store.getPaper('trigger-migration-paper'), null);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
