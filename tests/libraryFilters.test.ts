import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIBRARY_FILTERS,
  buildPaperQuery,
  describeActiveFilters,
  parseLibraryFilters,
  removeLibraryFilter,
  serializeLibraryFilters,
} from '../src/features/literature/libraryFilters.ts';

const l = (zh: string, _en: string) => zh;
const filters = () => ({ ...DEFAULT_LIBRARY_FILTERS, tagIds: [] as string[], itemTypes: [] as string[] });

test('filter serialization round-trips all supported values', () => {
  const value = { ...filters(), favorite: true, yearFrom: 2020, yearTo: 2025, tagIds: ['a'], itemTypes: ['thesis'], readStatus: 'reading' as const, ragMembership: 'excluded' as const, mineruParsed: true };
  assert.deepEqual(parseLibraryFilters(serializeLibraryFilters(value)), value);
});

test('invalid or incomplete stored filters fall back to defaults', () => {
  for (const value of ['bad json', '{}', JSON.stringify({ ...filters(), yearFrom: '2020' }), JSON.stringify({ ...filters(), yearFrom: 2026, yearTo: 2020 }), JSON.stringify({ ...filters(), readStatus: 'unknown' }), JSON.stringify({ ...filters(), tagIds: [123] })]) {
    assert.deepEqual(parseLibraryFilters(value), filters());
  }
});

test('builds the same query for category, search, sort and all active filters', () => {
  const value = { ...filters(), favorite: true, tagIds: ['tag-a'], yearFrom: 2020, yearTo: 2025, itemTypes: ['thesis'], readStatus: 'finished' as const, hasPdf: true, hasTranslatedPdf: true, missingFile: true, hasSummary: true, source: 'zotero' as const, ragMembership: 'excluded' as const, mineruParsed: true };
  assert.deepEqual(buildPaperQuery(value, { sortBy: 'lastReadAt', sortDirection: 'desc' }, 'cat', 'term', ['p1']), {
    categoryId: 'cat', search: 'term', sortBy: 'lastReadAt', sortDirection: 'desc', favorite: true,
    tagIds: ['tag-a'], yearFrom: 2020, yearTo: 2025, itemTypes: ['thesis'], readStatus: 'finished',
    hasPdf: true, hasTranslatedPdf: true, missingFile: true, hasSummary: true, source: 'zotero', ragEnabled: false, ragStatus: null, paperIds: ['p1'],
  });
  assert.deepEqual(buildPaperQuery({ ...value, mineruParsed: true }, {}, null, '', []).paperIds, []);
  assert.equal(buildPaperQuery(filters(), {}, null, '').paperIds, undefined);
});

test('rag status survives serialization, drives the query and can be removed', () => {
  const legacy = { ...filters(), favorite: true };
  delete (legacy as Partial<typeof legacy>).ragStatus;
  const parsedLegacy = parseLibraryFilters(JSON.stringify(legacy));
  assert.equal(parsedLegacy.ragStatus, 'all');
  assert.equal(parsedLegacy.favorite, true);

  assert.equal(parseLibraryFilters(JSON.stringify({ ...filters(), ragStatus: 'unknown' })).ragStatus, 'all');

  const value = { ...filters(), ragStatus: 'failed' as const };
  assert.equal(buildPaperQuery(value, {}, null, '').ragStatus, 'failed');
  assert.deepEqual(describeActiveFilters(value, l).map((chip) => chip.label), ['RAG 索引失败']);
  assert.equal(removeLibraryFilter(value, 'ragStatus').ragStatus, 'all');
});

test('describes and individually removes active filters', () => {
  const value = { ...filters(), favorite: true, tagIds: ['tag-a'], itemTypes: ['thesis'], yearFrom: 2020, hasPdf: true };
  const chips = describeActiveFilters(value, l, [{ id: 'tag-a', name: '机器学习', color: null, count: 2 }]);
  assert.deepEqual(chips.map((chip) => chip.label), ['收藏', '2020–…', '机器学习', '学位论文', '有 PDF']);
  assert.deepEqual(removeLibraryFilter(value, 'tag:tag-a').tagIds, []);
  assert.deepEqual(removeLibraryFilter(value, 'type:thesis').itemTypes, []);
  assert.equal(removeLibraryFilter(value, 'year').yearFrom, null);
  assert.equal(removeLibraryFilter(value, 'favorite').favorite, false);
});

test('every RAG status value serializes, chips and clears', () => {
  const values = ['ready', 'stale', 'pending', 'failed', 'none'] as const;
  for (const ragStatus of values) {
    const value = { ...filters(), ragStatus };
    assert.equal(parseLibraryFilters(serializeLibraryFilters(value)).ragStatus, ragStatus);
    assert.equal(buildPaperQuery(value, {}, null, '').ragStatus, ragStatus);
    const chips = describeActiveFilters(value, l);
    assert.equal(chips.length, 1);
    assert.equal(chips[0].id, 'ragStatus');
    assert.equal(removeLibraryFilter(value, 'ragStatus').ragStatus, 'all');
  }
  assert.equal(buildPaperQuery({ ...filters(), ragStatus: 'all' }, {}, null, '').ragStatus, null);
});
