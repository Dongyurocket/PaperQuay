import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  aggregateRagIndexStatus,
  groupRagIndexStatuses,
  isRagIndexStale,
  selectRagBatchTargets,
  selectRagIndexCandidates,
  summarizeRagIndexOverview,
} from '../src/services/ragIndexStatus.ts';
import type { RagDocumentIndexStatus } from '../src/types/reader.ts';
import { MINERU_RAG_EXTRACTOR_VERSION } from '../src/shared/ragIndexVersions.ts';

const require = createRequire(import.meta.url);
const { createRagStore } = require('../electron/backend/ragStore.cjs');
const sharedStatus = require('../src/shared/ragIndexStatus.cjs');

function createStore() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-rag-list-test-'));
  const store = createRagStore({
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
  });

  return { dataDir, store };
}

function makeStatus(overrides: Partial<RagDocumentIndexStatus>): RagDocumentIndexStatus {
  return {
    documentKey: 'doc',
    sourceType: 'mineru-markdown',
    sourceSignature: 'sig',
    embeddingModelKey: 'key',
    embeddingDimension: 4,
    totalChunkCount: 10,
    chunkCount: 10,
    indexedChunkCount: 10,
    indexedAt: 1,
    status: 'ready',
    extractorVersion: MINERU_RAG_EXTRACTOR_VERSION,
    ...overrides,
  };
}

test('shared CJS aggregation matches the renderer facade', () => {
  const cases: RagDocumentIndexStatus[][] = [
    [],
    [makeStatus({ status: 'ready' })],
    [makeStatus({ status: 'ready', extractorVersion: 'mineru-chunks-v2' })],
    [makeStatus({ status: 'ready' }), makeStatus({ status: 'failed', sourceType: 'pdf-text' })],
    [makeStatus({ status: 'ready' }), makeStatus({ status: 'pending', sourceType: 'pdf-text' })],
  ];

  for (const entries of cases) {
    assert.equal(
      sharedStatus.aggregateRagIndexStatus(entries, { embeddingModelKey: 'other-model' }),
      aggregateRagIndexStatus(entries, { embeddingModelKey: 'other-model' }),
    );
    assert.equal(
      sharedStatus.isRagIndexStale(entries[0] ?? makeStatus({}), { embeddingModelKey: 'other-model' }),
      isRagIndexStale(entries[0] ?? makeStatus({}), { embeddingModelKey: 'other-model' }),
    );
  }

  assert.deepEqual(
    Object.keys(sharedStatus.groupRagIndexStatuses([makeStatus({ documentKey: 'a' })])),
    Object.keys(groupRagIndexStatuses([makeStatus({ documentKey: 'a' })])),
  );
});

test('RAG store lists index statuses across documents and sources', () => {
  const { dataDir, store } = createStore();

  try {
    store.indexDocument({
      documentKey: 'doc-ready',
      title: 'Ready Doc',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-1',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      chunks: [{
        chunkId: 'c-1',
        chunkIndex: 0,
        pageIndex: 0,
        text: 'ready chunk',
        embedding: [0.1, 0.1, 0.1, 0.1],
      }],
    });
    store.reportFailure({
      documentKey: 'doc-failed',
      title: 'Failed Doc',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-2',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 5,
      errorMessage: 'Embedding HTTP 404',
      retryAfterMs: 60_000,
    });

    const statuses = store.listIndexStatuses();
    assert.equal(statuses.length, 2);

    const failed = statuses.find((row: RagDocumentIndexStatus) => row.documentKey === 'doc-failed');
    assert.ok(failed);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.lastError, 'Embedding HTTP 404');
    assert.ok(typeof failed.cooldownUntil === 'number' && failed.cooldownUntil > Date.now());

    const ready = statuses.find((row: RagDocumentIndexStatus) => row.documentKey === 'doc-ready');
    assert.ok(ready);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.indexedChunkCount, 1);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('aggregateRagIndexStatus prioritizes failed over pending and ready', () => {
  assert.equal(aggregateRagIndexStatus(undefined), 'none');
  assert.equal(aggregateRagIndexStatus([]), 'none');
  assert.equal(
    aggregateRagIndexStatus([
      makeStatus({ status: 'ready', sourceType: 'mineru-markdown' }),
      makeStatus({ status: 'ready', sourceType: 'pdf-text' }),
    ]),
    'ready',
  );
  assert.equal(
    aggregateRagIndexStatus([
      makeStatus({ status: 'ready' }),
      makeStatus({ status: 'pending', sourceType: 'pdf-text' }),
    ]),
    'pending',
  );
  assert.equal(
    aggregateRagIndexStatus([
      makeStatus({ status: 'ready' }),
      makeStatus({ status: 'failed', sourceType: 'pdf-text' }),
    ]),
    'failed',
  );
});

test('groupRagIndexStatuses groups entries by document key', () => {
  const grouped = groupRagIndexStatuses([
    makeStatus({ documentKey: 'a' }),
    makeStatus({ documentKey: 'a', sourceType: 'pdf-text' }),
    makeStatus({ documentKey: 'b' }),
  ]);

  assert.equal(grouped.a.length, 2);
  assert.equal(grouped.b.length, 1);
});

test('selectRagIndexCandidates picks unindexed and failed MinerU-parsed papers', () => {
  const items = [
    { documentKey: 'ready-doc', workspaceId: 'w1', title: 'A' },
    { documentKey: 'failed-doc', workspaceId: 'w2', title: 'B' },
    { documentKey: 'none-doc', workspaceId: 'w3', title: 'C' },
    { documentKey: 'unparsed-doc', workspaceId: 'w4', title: 'D' },
  ];
  const mineruParsedByWorkspaceId = { w1: true, w2: true, w3: true, w4: false };
  const statusByDocumentKey = {
    'ready-doc': [makeStatus({ documentKey: 'ready-doc', status: 'ready' })],
    'failed-doc': [makeStatus({ documentKey: 'failed-doc', status: 'failed' })],
  };

  const candidates = selectRagIndexCandidates({
    items,
    mineruParsedByWorkspaceId,
    statusByDocumentKey,
  });
  assert.deepEqual(
    candidates.map((item) => item.documentKey).sort(),
    ['failed-doc', 'none-doc'],
  );

  const failedOnly = selectRagIndexCandidates({
    items,
    mineruParsedByWorkspaceId,
    statusByDocumentKey,
    onlyFailed: true,
  });
  assert.deepEqual(
    failedOnly.map((item) => item.documentKey),
    ['failed-doc'],
  );
});

test('summarizeRagIndexOverview counts parsed papers by aggregate status', () => {
  const overview = summarizeRagIndexOverview({
    items: [
      { documentKey: 'ready-doc', workspaceId: 'w1', title: 'A' },
      { documentKey: 'pending-doc', workspaceId: 'w2', title: 'B' },
      { documentKey: 'failed-doc', workspaceId: 'w3', title: 'C' },
      { documentKey: 'none-doc', workspaceId: 'w4', title: 'D' },
      { documentKey: 'unparsed-doc', workspaceId: 'w5', title: 'E' },
    ],
    mineruParsedByWorkspaceId: { w1: true, w2: true, w3: true, w4: true, w5: false },
    statusByDocumentKey: {
      'ready-doc': [makeStatus({ documentKey: 'ready-doc', status: 'ready' })],
      'pending-doc': [makeStatus({ documentKey: 'pending-doc', status: 'pending' })],
      'failed-doc': [makeStatus({ documentKey: 'failed-doc', status: 'failed' })],
    },
  });

  assert.deepEqual(overview, { ready: 1, stale: 0, pending: 1, failed: 1, unindexed: 1, excluded: 0 });
});

test('outdated extractor versions are aggregated as stale, not ready', () => {
  assert.equal(
    aggregateRagIndexStatus([
      makeStatus({ status: 'ready', extractorVersion: null }),
      makeStatus({ status: 'ready', sourceType: 'pdf-text' }),
    ]),
    'stale',
  );
  assert.equal(
    aggregateRagIndexStatus([
      makeStatus({ status: 'ready', extractorVersion: 'mineru-chunks-v2' }),
    ], { embeddingModelKey: 'other-model' }),
    'stale',
  );
  assert.equal(
    aggregateRagIndexStatus([
      makeStatus({ status: 'ready' }),
    ]),
    'ready',
  );
});

test('selectRagIndexCandidates onlyStale picks outdated ready indexes', () => {
  const items = [
    { documentKey: 'current-doc', workspaceId: 'w1', title: 'A' },
    { documentKey: 'stale-doc', workspaceId: 'w2', title: 'B' },
    { documentKey: 'none-doc', workspaceId: 'w3', title: 'C' },
  ];
  const statusByDocumentKey = {
    'current-doc': [makeStatus({ documentKey: 'current-doc', status: 'ready' })],
    'stale-doc': [makeStatus({ documentKey: 'stale-doc', status: 'ready', extractorVersion: 'mineru-chunks-v2' })],
  };
  const stale = selectRagIndexCandidates({
    items,
    mineruParsedByWorkspaceId: { w1: true, w2: true, w3: true },
    statusByDocumentKey,
    onlyStale: true,
  });

  assert.deepEqual(stale.map((item) => item.documentKey), ['stale-doc']);
});

test('excluded papers skip indexing candidates and are counted separately', () => {
  const items = [
    { documentKey: 'kept', workspaceId: 'w1', title: 'A', ragEnabled: true },
    { documentKey: 'out', workspaceId: 'w2', title: 'B', ragEnabled: false },
  ];
  const candidates = selectRagIndexCandidates({
    items,
    mineruParsedByWorkspaceId: { w1: true, w2: true },
    statusByDocumentKey: {
      out: [makeStatus({ documentKey: 'out', status: 'failed' })],
    },
  });
  assert.deepEqual(candidates.map((item) => item.documentKey), ['kept']);

  const overview = summarizeRagIndexOverview({
    items,
    mineruParsedByWorkspaceId: { w1: true, w2: true },
    statusByDocumentKey: {},
  });
  assert.equal(overview.excluded, 1);
  assert.equal(overview.unindexed, 1);
});

test('batch targets honor each mode and report why papers were skipped', () => {
  const targets = [
    { paperId: 'ready', mineruParsed: true, status: 'ready' as const },
    { paperId: 'stale', mineruParsed: true, status: 'stale' as const },
    { paperId: 'failed', mineruParsed: true, status: 'failed' as const },
    { paperId: 'pending', mineruParsed: true, status: 'pending' as const },
    { paperId: 'missing', mineruParsed: true, status: 'none' as const },
    { paperId: 'unparsed', mineruParsed: false, status: 'none' as const },
    { paperId: 'excluded', ragEnabled: false, mineruParsed: true, status: 'failed' as const },
  ];

  assert.deepEqual(selectRagBatchTargets(targets, 'missing'), {
    candidateIds: ['missing'],
    skipped: { unparsed: 1, excluded: 1, ready: 1, pending: 1, other: 2 },
  });
  assert.deepEqual(selectRagBatchTargets(targets, 'failed').candidateIds, ['failed']);
  assert.deepEqual(selectRagBatchTargets(targets, 'stale').candidateIds, ['stale']);
  assert.deepEqual(selectRagBatchTargets(targets, 'rebuild').candidateIds, [
    'ready', 'stale', 'failed', 'pending', 'missing',
  ]);
  assert.deepEqual(selectRagBatchTargets(targets, 'all-legacy').candidateIds, [
    'stale', 'failed', 'pending', 'missing',
  ]);
  assert.deepEqual(selectRagBatchTargets(targets, 'missing').skipped, {
    unparsed: 1,
    excluded: 1,
    ready: 1,
    pending: 1,
    other: 2,
  });
  assert.deepEqual(selectRagBatchTargets([], 'missing'), {
    candidateIds: [],
    skipped: { unparsed: 0, excluded: 0, ready: 0, pending: 0, other: 0 },
  });
});

test('aggregate priority is failed > pending > stale > ready regardless of entry order', () => {
  const failed = makeStatus({ status: 'failed', sourceType: 'mineru-markdown' });
  const pending = makeStatus({ status: 'pending', sourceType: 'pdf-text' });
  const staleReady = makeStatus({ status: 'ready', extractorVersion: 'mineru-chunks-v2' });
  const currentReady = makeStatus({ status: 'ready' });

  for (const [entries, expected] of [
    [[pending, failed], 'failed'],
    [[staleReady, failed], 'failed'],
    [[currentReady, failed], 'failed'],
    [[staleReady, pending], 'pending'],
    [[currentReady, staleReady], 'stale'],
  ] as const) {
    assert.equal(aggregateRagIndexStatus([...entries]), expected);
  }

  assert.equal(aggregateRagIndexStatus([currentReady, staleReady]), 'stale');
  assert.equal(aggregateRagIndexStatus([currentReady, currentReady]), 'ready');
  assert.equal(aggregateRagIndexStatus([]), 'none');
});
