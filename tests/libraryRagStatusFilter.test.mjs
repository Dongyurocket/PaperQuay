import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  applyRagStatusFilter,
  normalizeRagStatus,
} = require('../electron/backend/libraryRagStatusFilter.cjs');
const { MINERU_RAG_EXTRACTOR_VERSION } = require('../src/shared/ragIndexVersions.cjs');

function makeStatus(documentKey, overrides = {}) {
  return {
    documentKey,
    sourceType: 'mineru-markdown',
    status: 'ready',
    embeddingModelKey: 'embedding-a',
    extractorVersion: MINERU_RAG_EXTRACTOR_VERSION,
    ...overrides,
  };
}

const papers = [
  { id: 'ready', ragEnabled: true },
  { id: 'stale', ragEnabled: true },
  { id: 'failed', ragEnabled: true },
  { id: 'pending', ragEnabled: true },
  { id: 'missing', ragEnabled: true },
  { id: 'excluded', ragEnabled: false },
  { id: 'excluded-ready', ragEnabled: false },
];

const statuses = [
  makeStatus('ready'),
  makeStatus('stale', { extractorVersion: 'mineru-chunks-v2' }),
  makeStatus('failed', { status: 'failed' }),
  makeStatus('pending', { status: 'pending' }),
  makeStatus('excluded-ready'),
];

test('normalizeRagStatus only accepts the supported statuses', () => {
  assert.equal(normalizeRagStatus('failed'), 'failed');
  assert.equal(normalizeRagStatus(' ALL '), null);
  assert.equal(normalizeRagStatus(''), null);
  assert.equal(normalizeRagStatus(null), null);
});

test('filters papers by aggregate RAG status and skips excluded members', () => {
  const cases = /** @type {Array<[string, string[]]>} */ ([
    ['ready', ['ready']],
    ['stale', ['stale']],
    ['failed', ['failed']],
    ['pending', ['pending']],
    ['none', ['missing']],
  ]);
  for (const [ragStatus, expected] of cases) {
    const result = applyRagStatusFilter(
      { ragStatus },
      { papers, statuses, ragAvailable: true, embeddingModelKey: 'embedding-a' },
    );
    assert.deepEqual(result.paperIds, expected, ragStatus);
  }
});

test('existing paperIds are intersected with the RAG status result', () => {
  const result = applyRagStatusFilter(
    { ragStatus: 'none', paperIds: ['missing', 'ready'] },
    { papers, statuses, ragAvailable: true, embeddingModelKey: 'embedding-a' },
  );
  assert.deepEqual(result.paperIds, ['missing']);

  const empty = applyRagStatusFilter(
    { ragStatus: 'none', paperIds: [] },
    { papers, statuses, ragAvailable: true, embeddingModelKey: 'embedding-a' },
  );
  assert.deepEqual(empty.paperIds, []);
});

test('a changed embedding model turns ready indexes into stale', () => {
  const result = applyRagStatusFilter(
    { ragStatus: 'stale' },
    { papers, statuses, ragAvailable: true, embeddingModelKey: 'embedding-b' },
  );
  assert.ok(result.paperIds.includes('ready'));
  assert.ok(result.paperIds.includes('stale'));
  assert.ok(!result.paperIds.includes('failed'));
});

test('unavailable RAG database reports none for enabled papers and nothing else', () => {
  const none = applyRagStatusFilter(
    { ragStatus: 'none' },
    { papers, statuses: null, ragAvailable: false },
  );
  assert.deepEqual(none.paperIds, ['ready', 'stale', 'failed', 'pending', 'missing']);

  const failed = applyRagStatusFilter(
    { ragStatus: 'failed' },
    { papers, statuses: null, ragAvailable: false },
  );
  assert.deepEqual(failed.paperIds, []);
});

test('requests without a valid ragStatus are returned unchanged', () => {
  const request = { favorite: true };
  assert.equal(applyRagStatusFilter(request, { papers, statuses }), request);
  const withNull = { ragStatus: null };
  assert.equal(applyRagStatusFilter(withNull, { papers, statuses }), withNull);
});
