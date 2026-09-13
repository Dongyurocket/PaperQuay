import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  aggregateRagIndexStatus,
  groupRagIndexStatuses,
  selectRagIndexCandidates,
  summarizeRagIndexOverview,
} from '../src/services/ragIndexStatus.ts';
import type { RagDocumentIndexStatus } from '../src/types/reader.ts';

const require = createRequire(import.meta.url);
const { createRagStore } = require('../electron/backend/ragStore.cjs');

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
    ...overrides,
  };
}

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

  assert.deepEqual(overview, { ready: 1, pending: 1, failed: 1, unindexed: 1 });
});
