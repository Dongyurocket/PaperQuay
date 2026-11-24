import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createRagStore } = require('../electron/backend/ragStore.cjs');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');

function createStore() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-rag-staged-'));
  const store = createRagStore({ ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite') });
  return { dataDir, store };
}

function chunk(chunkId: string, index: number, text: string, embedding: number[]) {
  return { chunkId, chunkIndex: index, pageIndex: 0, text, embedding };
}

const BASE = {
  documentKey: 'doc-1',
  title: 'Doc',
  sourceType: 'mineru-markdown',
  embeddingModelKey: 'model-a',
};

function seedReady(store: ReturnType<typeof createStore>['store']) {
  store.indexDocument({
    ...BASE,
    sourceSignature: 'sig-old',
    extractorVersion: 'mineru-chunks-v2',
    totalChunkCount: 2,
    chunks: [
      chunk('c-1', 0, 'same text', [1, 0, 0, 0]),
      chunk('c-2', 1, 'changed text', [0, 1, 0, 0]),
    ],
  });
  const status = store.getDocumentIndexStatus({ documentKey: 'doc-1', sourceType: 'mineru-markdown' });
  assert.equal(status.status, 'ready');
  assert.equal(status.extractorVersion, 'mineru-chunks-v2');
}

test('staged rebuild reuses unchanged vectors and swaps atomically', () => {
  const { dataDir, store } = createStore();

  try {
    seedReady(store);

    const prepared = store.prepareStagedRebuild({
      ...BASE,
      sourceSignature: 'sig-new',
      extractorVersion: 'mineru-chunks-v3',
      totalChunkCount: 2,
    });
    assert.deepEqual(prepared.stagedChunkIds, []);

    const reused = store.stageReusedChunks({
      documentKey: 'doc-1',
      sourceType: 'mineru-markdown',
      embeddingModelKey: 'model-a',
      chunks: [
        { chunkId: 'c-1', chunkIndex: 0, pageIndex: 0, text: 'same text' },
        { chunkId: 'c-2', chunkIndex: 1, pageIndex: 0, text: 'new text' },
      ],
    });
    assert.deepEqual(reused.stagedChunkIds, ['c-1']);
    assert.deepEqual(reused.missingChunkIds, ['c-2']);

    store.stageEmbeddedChunks({
      documentKey: 'doc-1',
      sourceType: 'mineru-markdown',
      chunks: [chunk('c-2', 1, 'new text', [0, 0, 1, 0])],
    });

    // 提交前旧索引仍可检索。
    const beforeSwap = store.retrieveDocumentChunks({
      documentKey: 'doc-1',
      sourceType: 'mineru-markdown',
      embeddingModelKey: 'model-a',
      sourceSignature: 'sig-old',
      queryEmbedding: [1, 0, 0, 0],
      queryText: 'same text',
      topK: 5,
    });
    assert.equal(beforeSwap[0]?.chunkId, 'c-1');

    const status = store.commitStagedRebuild({
      ...BASE,
      sourceSignature: 'sig-new',
      extractorVersion: 'mineru-chunks-v3',
      totalChunkCount: 2,
    });
    assert.equal(status.status, 'ready');
    assert.equal(status.sourceSignature, 'sig-new');
    assert.equal(status.extractorVersion, 'mineru-chunks-v3');
    assert.equal(status.indexedChunkCount, 2);

    // 旧签名的行已被删除，新签名下复用的向量仍然命中「same text」。
    assert.equal(
      store.retrieveDocumentChunks({
        documentKey: 'doc-1',
        sourceType: 'mineru-markdown',
        embeddingModelKey: 'model-a',
        sourceSignature: 'sig-old',
        queryEmbedding: [1, 0, 0, 0],
        queryText: 'same text',
        topK: 5,
      }).length,
      0,
    );
    const results = store.retrieveDocumentChunks({
      documentKey: 'doc-1',
      sourceType: 'mineru-markdown',
      embeddingModelKey: 'model-a',
      sourceSignature: 'sig-new',
      queryEmbedding: [1, 0, 0, 0],
      queryText: 'same text',
      topK: 5,
    });
    assert.equal(results[0]?.chunkId, 'c-1');

    // 暂存已清空。
    assert.deepEqual(
      store.prepareStagedRebuild({
        ...BASE,
        sourceSignature: 'sig-new',
        extractorVersion: 'mineru-chunks-v3',
        totalChunkCount: 2,
      }).stagedChunkIds,
      [],
    );
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('failed or incomplete staged rebuild keeps the old index intact', () => {
  const { dataDir, store } = createStore();

  try {
    seedReady(store);

    store.prepareStagedRebuild({
      ...BASE,
      sourceSignature: 'sig-new',
      extractorVersion: 'mineru-chunks-v3',
      totalChunkCount: 2,
    });
    store.stageEmbeddedChunks({
      documentKey: 'doc-1',
      sourceType: 'mineru-markdown',
      chunks: [chunk('c-1', 0, 'same text', [1, 0, 0, 0])],
    });

    assert.throws(() =>
      store.commitStagedRebuild({
        ...BASE,
        sourceSignature: 'sig-new',
        extractorVersion: 'mineru-chunks-v3',
        totalChunkCount: 2,
      }),
    );

    const status = store.getDocumentIndexStatus({ documentKey: 'doc-1', sourceType: 'mineru-markdown' });
    assert.equal(status.status, 'ready');
    assert.equal(status.sourceSignature, 'sig-old');
    assert.equal(status.indexedChunkCount, 2);

    store.failStagedRebuild({
      documentKey: 'doc-1',
      sourceType: 'mineru-markdown',
      errorMessage: 'Embedding HTTP 402',
    });
    const failed = store.getDocumentIndexStatus({ documentKey: 'doc-1', sourceType: 'mineru-markdown' });
    assert.equal(failed.status, 'ready');
    assert.equal(failed.rebuildError, 'Embedding HTTP 402');

    // 暂存仍在，可以续跑。
    const resumed = store.prepareStagedRebuild({
      ...BASE,
      sourceSignature: 'sig-new',
      extractorVersion: 'mineru-chunks-v3',
      totalChunkCount: 2,
    });
    assert.deepEqual(resumed.stagedChunkIds, ['c-1']);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('staging is discarded when the signature or model changes', () => {
  const { dataDir, store } = createStore();

  try {
    seedReady(store);

    store.prepareStagedRebuild({
      ...BASE,
      sourceSignature: 'sig-new',
      extractorVersion: 'mineru-chunks-v3',
      totalChunkCount: 2,
    });
    store.stageEmbeddedChunks({
      documentKey: 'doc-1',
      sourceType: 'mineru-markdown',
      chunks: [chunk('c-1', 0, 'same text', [1, 0, 0, 0])],
    });

    const reprepared = store.prepareStagedRebuild({
      ...BASE,
      sourceSignature: 'sig-newer',
      extractorVersion: 'mineru-chunks-v3',
      totalChunkCount: 2,
    });
    assert.deepEqual(reprepared.stagedChunkIds, []);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('compactStorage keeps all vectors reachable', () => {
  const { dataDir, store } = createStore();

  try {
    seedReady(store);
    const before = store.storageStats();
    assert.ok(before.fileBytes > 0);

    const result = store.compactStorage();
    assert.ok(result.afterBytes > 0);

    const readOnly = new DatabaseSync(path.join(dataDir, 'paperquay-rag.sqlite'), { readOnly: true });
    const vectorSql = readOnly
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'rag_vec_4'")
      .get()?.sql ?? '';
    readOnly.close();
    assert.match(vectorSql, /chunk_size=128/);

    const results = store.retrieveDocumentChunks({
      documentKey: 'doc-1',
      sourceType: 'mineru-markdown',
      embeddingModelKey: 'model-a',
      sourceSignature: 'sig-old',
      queryEmbedding: [1, 0, 0, 0],
      queryText: 'same text',
      topK: 5,
    });
    assert.equal(results[0]?.chunkId, 'c-1');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
