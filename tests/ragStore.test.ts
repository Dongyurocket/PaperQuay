import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildFtsMatchQuery, createRagStore, rrfFuse } = require('../electron/backend/ragStore.cjs');

function createStore(options = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-rag-test-'));
  const store = createRagStore({
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
  }, options);

  return { dataDir, store };
}

test('RAG store appends chunk batches and retrieves inside the requested document', () => {
  const { dataDir, store } = createStore();

  try {
    store.indexDocument({
      documentKey: 'doc-a',
      title: 'Document A',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-a',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      chunks: [{
        chunkId: 'a-1',
        chunkIndex: 0,
        pageIndex: 0,
        blockId: null,
        text: 'distant document chunk',
        embedding: [0.1, 0.1, 0.1, 0.1],
      }],
    });

    assert.equal(
      store.getDocumentIndexStatus({ documentKey: 'doc-a', sourceType: 'pdf-text' }).status,
      'pending',
    );

    store.indexDocument({
      documentKey: 'doc-a',
      title: 'Document A',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-a',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      chunks: [{
        chunkId: 'a-2',
        chunkIndex: 1,
        pageIndex: 1,
        blockId: 'block-a-2',
        text: 'nearest document chunk',
        embedding: [0.8, 0.8, 0.8, 0.8],
      }],
    });

    store.indexDocument({
      documentKey: 'doc-b',
      title: 'Document B',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-b',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      chunks: [{
        chunkId: 'b-1',
        chunkIndex: 0,
        pageIndex: 0,
        text: 'wrong document chunk',
        embedding: [0.79, 0.79, 0.79, 0.79],
      }],
    });

    const status = store.getDocumentIndexStatus({ documentKey: 'doc-a', sourceType: 'pdf-text' });
    assert.equal(status.status, 'ready');
    assert.equal(status.indexedChunkCount, 2);

    const results = store.retrieveDocumentChunks({
      documentKey: 'doc-a',
      sourceType: 'pdf-text',
      queryEmbedding: [0.78, 0.78, 0.78, 0.78],
      topK: 3,
    });

    assert.equal(results.length, 2);
    assert.equal(results[0].chunkId, 'a-2');
    assert.equal(results[0].sourceType, 'pdf-text');
    assert.equal(results[0].blockId, 'block-a-2');
    assert.ok(results.every((result) => result.chunkId.startsWith('a-')));
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG failure status clears partial vectors for that source', () => {
  const { dataDir, store } = createStore();

  try {
    store.indexDocument({
      documentKey: 'doc-failed',
      title: 'Failed Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-before',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      chunks: [{
        chunkId: 'partial',
        chunkIndex: 0,
        pageIndex: null,
        text: 'partial chunk',
        embedding: [0.2, 0.2, 0.2, 0.2],
      }],
    });

    store.reportFailure({
      documentKey: 'doc-failed',
      title: 'Failed Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-before',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      errorMessage: 'embedding unavailable',
      retryAfterMs: 1000,
    });

    const status = store.getDocumentIndexStatus({
      documentKey: 'doc-failed',
      sourceType: 'mineru-markdown',
    });
    assert.equal(status.status, 'failed');
    assert.equal(status.indexedChunkCount, 0);
    assert.equal(status.lastError, 'embedding unavailable');

    assert.deepEqual(
      store.retrieveDocumentChunks({
        documentKey: 'doc-failed',
        sourceType: 'mineru-markdown',
        queryEmbedding: [0.2, 0.2, 0.2, 0.2],
        topK: 3,
      }),
      [],
    );
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG store snapshots and restores the embedding database', async () => {
  const source = createStore();
  const target = createStore();
  const snapshotPath = path.join(source.dataDir, 'snapshots', 'paperquay-rag.sqlite');

  try {
    source.store.indexDocument({
      documentKey: 'doc-snapshot',
      title: 'Snapshot Document',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-snapshot',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      chunks: [{
        chunkId: 'snap-1',
        chunkIndex: 0,
        pageIndex: 3,
        blockId: 'block-snap',
        text: 'restored embedding chunk',
        embedding: [0.9, 0.1, 0.1, 0.1],
      }],
    });

    source.store.snapshotTo(snapshotPath);
    await target.store.replaceWithSnapshot(snapshotPath);

    const status = target.store.getDocumentIndexStatus({
      documentKey: 'doc-snapshot',
      sourceType: 'pdf-text',
    });
    assert.equal(status.status, 'ready');
    assert.equal(status.indexedChunkCount, 1);

    const results = target.store.retrieveDocumentChunks({
      documentKey: 'doc-snapshot',
      sourceType: 'pdf-text',
      queryEmbedding: [0.91, 0.1, 0.1, 0.1],
      topK: 1,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].chunkId, 'snap-1');
    assert.equal(results[0].text, 'restored embedding chunk');
  } finally {
    source.store.close();
    target.store.close();
    rmSync(source.dataDir, { recursive: true, force: true });
    rmSync(target.dataDir, { recursive: true, force: true });
  }
});

test('RAG store fuses escaped FTS matches with vector candidates and syncs text updates', () => {
  const { dataDir, store } = createStore();

  try {
    assert.equal(store.isFtsAvailable(), true);
    assert.equal(buildFtsMatchQuery('MTOW OR "lift-to-drag"'), '"MTOW" OR "OR" OR "lift" OR "to" OR "drag"');

    const index = (chunkId, chunkIndex, text, embedding) => store.indexDocument({
      documentKey: 'doc-fts',
      title: 'FTS Document',
      sourceType: 'pdf-text',
      sourceSignature: 'fts-signature',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 3,
      chunks: [{
        chunkId,
        chunkIndex,
        pageIndex: chunkIndex,
        text,
        embedding,
      }],
    });

    index('nearest', 0, 'general aerodynamic description', [1, 0, 0, 0]);
    index('second-nearest', 1, 'another broad discussion', [0.9, 0, 0, 0]);
    index('keyword-only', 2, 'The MTOW limit is 1200 kg.', [0, 1, 0, 0]);

    const hybrid = store.retrieveDocumentChunks({
      documentKey: 'doc-fts',
      sourceType: 'pdf-text',
      queryEmbedding: [1, 0, 0, 0],
      queryText: 'MTOW',
      topK: 2,
    });

    assert.equal(hybrid.length, 2);
    assert.ok(hybrid.some((result) => result.chunkId === 'keyword-only'));

    index('keyword-only', 2, 'The revised payload marker is 1250 kg.', [0, 1, 0, 0]);
    const afterUpdate = store.retrieveDocumentChunks({
      documentKey: 'doc-fts',
      sourceType: 'pdf-text',
      queryEmbedding: [1, 0, 0, 0],
      queryText: 'revised payload marker',
      topK: 2,
    });

    assert.ok(afterUpdate.some((result) => result.text.includes('revised payload marker')));
    assert.deepEqual(
      rrfFuse(
        [{ chunkId: 'vector', sourceType: 'pdf-text', pageIndex: 0, text: 'vector', score: 0 }],
        [{ chunkId: 'fts', sourceType: 'pdf-text', pageIndex: 1, text: 'fts', score: 0 }],
      ).map((result) => result.chunkId),
      ['vector', 'fts'],
    );
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG store falls back to vector-only retrieval when FTS is unavailable', () => {
  const { dataDir, store } = createStore({ disableFts: true });

  try {
    assert.equal(store.isFtsAvailable(), false);

    store.indexDocument({
      documentKey: 'doc-vector-only',
      title: 'Vector-only Document',
      sourceType: 'pdf-text',
      sourceSignature: 'vector-only-signature',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      chunks: [
        {
          chunkId: 'nearest',
          chunkIndex: 0,
          pageIndex: 0,
          text: 'nearest vector result',
          embedding: [1, 0, 0, 0],
        },
        {
          chunkId: 'far',
          chunkIndex: 1,
          pageIndex: 1,
          text: 'keyword MTOW but distant vector',
          embedding: [0, 1, 0, 0],
        },
      ],
    });

    const results = store.retrieveDocumentChunks({
      documentKey: 'doc-vector-only',
      sourceType: 'pdf-text',
      queryEmbedding: [1, 0, 0, 0],
      queryText: 'MTOW',
      topK: 1,
    });

    assert.deepEqual(results.map((result) => result.chunkId), ['nearest']);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Agent run storage redacts sensitive event fields and accumulates usage', () => {
  const { dataDir, store } = createStore();

  try {
    const run = store.createAgentRun({
      runId: 'run-a',
      sessionId: 'session-a',
      model: 'test-model',
      presetId: 'test-preset',
      instruction: 'Compare the selected papers.',
      startedAt: 100,
    });

    assert.equal(run.status, 'running');
    const event = store.appendAgentRunEvent({
      runId: 'run-a',
      kind: 'turn_start',
      turn: 1,
      ts: 101,
      promptTokens: 12,
      completionTokens: 3,
      payload: {
        apiKey: 'never persist this',
        message: 'Starting a comparison.',
        dataUrl: 'data:image/png;base64,not-persisted',
      },
    });

    assert.equal(event.payload.apiKey, '[redacted]');
    assert.equal(event.payload.dataUrl, '[redacted]');
    assert.equal(event.payload.message, 'Starting a comparison.');
    assert.equal(store.listInterruptedAgentRuns({ sessionId: 'session-a' }).length, 1);

    const completed = store.finishAgentRun({
      runId: 'run-a',
      status: 'aborted',
      finishedAt: 102,
      promptTokens: 2,
      completionTokens: 5,
      turns: 1,
    });

    assert.equal(completed.status, 'aborted');
    assert.equal(completed.promptTokens, 14);
    assert.equal(completed.completionTokens, 8);
    assert.equal(completed.turns, 1);
    assert.equal(store.getAgentRunEvents({ runId: 'run-a' }).length, 1);
    assert.equal(store.listInterruptedAgentRuns({ sessionId: 'session-a' }).length, 0);
    assert.deepEqual(store.listAgentRunUsageBySession({ sessionIds: ['session-a'] }), [{
      sessionId: 'session-a',
      promptTokens: 14,
      completionTokens: 8,
      runCount: 1,
    }]);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG store retrieves Chinese chunks via trigram FTS keyword match', () => {
  const { dataDir, store } = createStore();

  try {
    assert.equal(store.isFtsAvailable(), true);

    store.indexDocument({
      documentKey: 'doc-zh',
      title: '中文文献',
      sourceType: 'mineru-markdown',
      sourceSignature: 'zh-signature',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      chunks: [
        {
          chunkId: 'zh-body',
          chunkIndex: 0,
          pageIndex: 0,
          text: '本文提出了一种基于深度学习的滚动轴承故障诊断方法，实验结果表明该方法有效。',
          // 距离查询向量较远，仅靠向量检索不会排在前面。
          embedding: [0, 1, 0, 0],
        },
        {
          chunkId: 'en-near',
          chunkIndex: 1,
          pageIndex: 1,
          text: 'unrelated english chunk about attention mechanisms',
          embedding: [1, 0, 0, 0],
        },
      ],
    });

    const results = store.retrieveDocumentChunks({
      documentKey: 'doc-zh',
      sourceType: 'mineru-markdown',
      queryEmbedding: [1, 0, 0, 0],
      queryText: '故障诊断方法',
      topK: 2,
    });

    // 中文关键词通过 trigram FTS 命中，与向量候选做 RRF 融合后进入结果。
    assert.ok(results.some((result) => result.chunkId === 'zh-body'));
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG store migrates a legacy unicode61 FTS table to trigram', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-rag-migration-'));
  const databasePath = path.join(dataDir, 'paperquay-rag.sqlite');
  const { DatabaseSync } = require('node:sqlite');

  // 模拟旧版库结构：unicode61 分词的 FTS 表 + v1 初始化标记。
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb.exec(`
    CREATE TABLE rag_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      page_index INTEGER,
      block_id TEXT,
      text TEXT NOT NULL,
      UNIQUE (document_key, source_type, chunk_id)
    );
    CREATE TABLE rag_store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE VIRTUAL TABLE rag_chunks_fts USING fts5(
      text,
      content='rag_chunks',
      content_rowid='id',
      tokenize='unicode61'
    );
    CREATE TRIGGER rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
      INSERT INTO rag_chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN
      INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER rag_chunks_au AFTER UPDATE ON rag_chunks BEGIN
      INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
      INSERT INTO rag_chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    INSERT INTO rag_store_meta (key, value) VALUES ('rag_chunks_fts_v1', '1');
  `);
  legacyDb.close();

  const store = createRagStore({ ragDatabasePath: databasePath });

  try {
    assert.equal(store.isFtsAvailable(), true);

    store.indexDocument({
      documentKey: 'doc-migrated',
      title: '迁移后的中文文献',
      sourceType: 'mineru-markdown',
      sourceSignature: 'migration-signature',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      chunks: [
        {
          chunkId: 'zh-migrated',
          chunkIndex: 0,
          pageIndex: 0,
          text: '迁移后的中文段落，包含关键词剩余使用寿命预测。',
          embedding: [0, 1, 0, 0],
        },
      ],
    });

    const results = store.retrieveDocumentChunks({
      documentKey: 'doc-migrated',
      sourceType: 'mineru-markdown',
      queryEmbedding: [1, 0, 0, 0],
      queryText: '剩余使用寿命预测',
      topK: 1,
    });

    assert.ok(results.some((result) => result.chunkId === 'zh-migrated'));
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG resume by chunk id gap closes the pending fixed point', () => {
  const { dataDir, store } = createStore();

  try {
    const totalChunkCount = 8;
    const allChunks = Array.from({ length: totalChunkCount }, (_, index) => ({
      chunkId: `chunk-${index}`,
      chunkIndex: index,
      pageIndex: index,
      blockId: null,
      text: `chunk text ${index}`,
      embedding: [0.1 * (index + 1), 0.2, 0.3, 0.4],
    }));

    // 模拟历史缺陷状态：低位 chunk（0-2）从未入库，只有 3-7 行存在，
    // indexed_chunk_count=5 与“前 5 个 chunk 已索引”的位置假设错位。
    store.indexDocument({
      documentKey: 'doc-gap',
      title: 'Gap Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-gap',
      embeddingModelKey: 'embedding-test',
      totalChunkCount,
      chunks: allChunks.slice(3),
    });

    let status = store.getDocumentIndexStatus({ documentKey: 'doc-gap', sourceType: 'mineru-markdown' });
    assert.equal(status.status, 'pending');
    assert.equal(status.indexedChunkCount, 5);

    // 错误的旧逻辑：chunks.slice(5) 只重发已存在的 5-7，行数不变，永远 pending。
    // 新逻辑：按 chunkId 差集补缺失的 0-2。
    const indexedIds = new Set(
      store.listIndexedChunkIds({ documentKey: 'doc-gap', sourceType: 'mineru-markdown' }),
    );
    assert.equal(indexedIds.size, 5);
    const remaining = allChunks.filter((chunk) => !indexedIds.has(chunk.chunkId));
    assert.deepEqual(remaining.map((chunk) => chunk.chunkId), ['chunk-0', 'chunk-1', 'chunk-2']);

    store.indexDocument({
      documentKey: 'doc-gap',
      title: 'Gap Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-gap',
      embeddingModelKey: 'embedding-test',
      totalChunkCount,
      chunks: remaining,
    });

    const finalized = store.finalizeDocumentIndex({
      documentKey: 'doc-gap',
      title: 'Gap Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-gap',
      embeddingModelKey: 'embedding-test',
      totalChunkCount,
      expectedChunkIds: allChunks.map((chunk) => chunk.chunkId),
    });

    assert.equal(finalized.status, 'ready');
    assert.equal(finalized.indexedChunkCount, totalChunkCount);

    status = store.getDocumentIndexStatus({ documentKey: 'doc-gap', sourceType: 'mineru-markdown' });
    assert.equal(status.status, 'ready');
    assert.equal(status.indexedChunkCount, totalChunkCount);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG finalize prunes stale chunk rows and keeps signature mismatch untouched', () => {
  const { dataDir, store } = createStore();

  try {
    const chunks = [
      { chunkId: 'keep-0', chunkIndex: 0, pageIndex: 0, blockId: null, text: 'keep zero', embedding: [0.1, 0.2, 0.3, 0.4] },
      { chunkId: 'keep-1', chunkIndex: 1, pageIndex: 1, blockId: null, text: 'keep one', embedding: [0.5, 0.6, 0.7, 0.8] },
    ];

    store.indexDocument({
      documentKey: 'doc-stale',
      title: 'Stale Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-stale',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      chunks,
    });

    // 人为制造一行不属于当前内容集的陈旧分块（同 signature/模型下的历史残留）。
    store.indexDocument({
      documentKey: 'doc-stale',
      title: 'Stale Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-stale',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      chunks: [
        { chunkId: 'stale-legacy', chunkIndex: 99, pageIndex: 99, blockId: null, text: 'stale legacy chunk', embedding: [0.9, 0.9, 0.9, 0.9] },
      ],
    });

    let ids = store.listIndexedChunkIds({ documentKey: 'doc-stale', sourceType: 'mineru-markdown' });
    assert.deepEqual([...ids].sort(), ['keep-0', 'keep-1', 'stale-legacy']);

    const mismatched = store.finalizeDocumentIndex({
      documentKey: 'doc-stale',
      title: 'Stale Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-changed',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      expectedChunkIds: ['keep-0', 'keep-1'],
    });
    assert.equal(mismatched.sourceSignature, 'sig-stale');
    ids = store.listIndexedChunkIds({ documentKey: 'doc-stale', sourceType: 'mineru-markdown' });
    assert.deepEqual([...ids].sort(), ['keep-0', 'keep-1', 'stale-legacy']);

    const finalized = store.finalizeDocumentIndex({
      documentKey: 'doc-stale',
      title: 'Stale Document',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-stale',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      expectedChunkIds: ['keep-0', 'keep-1'],
    });

    assert.equal(finalized.status, 'ready');
    assert.equal(finalized.indexedChunkCount, 2);
    ids = store.listIndexedChunkIds({ documentKey: 'doc-stale', sourceType: 'mineru-markdown' });
    assert.deepEqual([...ids].sort(), ['keep-0', 'keep-1']);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG store cleans up orphan zero-chunk failed statuses when mineru-markdown is ready', () => {
  const { dataDir, store } = createStore();

  try {
    // 模拟历史遗留状态：一个文档同时存在一个空的 pdf-text failed 状态和一个就绪的 mineru-markdown 状态
    store.reportFailure({
      documentKey: 'doc-orphan-test',
      title: 'Orphan Test Doc',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-pdf',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 10,
      errorMessage: 'ancient 404 failure',
      retryAfterMs: 1000,
    });

    let pdfStatus = store.getDocumentIndexStatus({ documentKey: 'doc-orphan-test', sourceType: 'pdf-text' });
    assert.equal(pdfStatus.status, 'failed');
    assert.equal(pdfStatus.chunkCount, 0);

    // 索引 mineru-markdown 并达到 ready
    store.indexDocument({
      documentKey: 'doc-orphan-test',
      title: 'Orphan Test Doc',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-mineru',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      chunks: [{
        chunkId: 'mineru-1',
        chunkIndex: 0,
        pageIndex: 0,
        blockId: null,
        text: 'valid mineru text',
        embedding: [0.1, 0.2, 0.3, 0.4],
      }],
    });

    const mineruStatus = store.getDocumentIndexStatus({ documentKey: 'doc-orphan-test', sourceType: 'mineru-markdown' });
    assert.equal(mineruStatus.status, 'ready');

    // indexDocument 成功就绪后，同文档下无数据的 pdf-text failed 记录应被自动清理
    pdfStatus = store.getDocumentIndexStatus({ documentKey: 'doc-orphan-test', sourceType: 'pdf-text' });
    assert.equal(pdfStatus, null);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG store supports global multi-document retrieval and documentKeys filtering', () => {
  const { dataDir, store } = createStore();

  try {
    store.indexDocument({
      documentKey: 'doc-alpha',
      title: 'Alpha Paper',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-alpha',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      chunks: [{
        chunkId: 'chunk-alpha',
        chunkIndex: 0,
        pageIndex: 0,
        blockId: 'b1',
        text: 'Attention mechanisms and Transformer networks.',
        embedding: [1, 0, 0, 0],
      }],
    });

    store.indexDocument({
      documentKey: 'doc-beta',
      title: 'Beta Paper',
      sourceType: 'mineru-markdown',
      sourceSignature: 'sig-beta',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      chunks: [{
        chunkId: 'chunk-beta',
        chunkIndex: 0,
        pageIndex: 1,
        blockId: 'b2',
        text: 'Convolutional neural networks for image classification.',
        embedding: [0, 1, 0, 0],
      }],
    });

    const globalResults = store.retrieveDocumentChunks({
      queryEmbedding: [1, 0, 0, 0],
      queryText: 'Transformer',
      topK: 5,
    });
    assert.equal(globalResults.length, 2);
    assert.equal(globalResults[0]?.chunkId, 'chunk-alpha');
    assert.equal(globalResults[0]?.documentKey, 'doc-alpha');

    const filteredResults = store.retrieveDocumentChunks({
      documentKeys: ['doc-beta'],
      queryEmbedding: [1, 0, 0, 0],
      queryText: 'Transformer',
      topK: 5,
    });
    assert.equal(filteredResults.length, 1);
    assert.equal(filteredResults[0]?.documentKey, 'doc-beta');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG store returns neighbor chunk context within the same document and source', () => {
  const { dataDir, store } = createStore();

  try {
    const chunks = [0, 2, 5, 9].map((chunkIndex, order) => ({
      chunkId: `c-${chunkIndex}`,
      chunkIndex,
      pageIndex: order,
      blockId: `block-${chunkIndex}`,
      text: `chunk text ${chunkIndex}`,
      embedding: [0.1 * (order + 1), 0.1, 0.1, 0.1],
    }));

    store.indexDocument({
      documentKey: 'doc-ctx',
      title: 'Context Document',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-ctx',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: chunks.length,
      chunks,
    });

    // chunkIndex 有间隔：邻接由排序而非编号算术决定。
    const middle = store.getChunkContext({
      documentKey: 'doc-ctx',
      sourceType: 'pdf-text',
      chunkId: 'c-5',
      before: 1,
      after: 1,
    });

    assert.equal(middle.status, 'ready');
    assert.equal(middle.sectionPath, null);
    assert.deepEqual(
      middle.slices.map((slice) => `${slice.position}:${slice.chunkId}`),
      ['before:c-2', 'hit:c-5', 'after:c-9'],
    );
    assert.equal(middle.hasMoreBefore, true);
    assert.equal(middle.hasMoreAfter, false);
    assert.equal(middle.slices[1].pageIndex, 2);
    assert.equal(middle.slices[1].blockId, 'block-5');

    const first = store.getChunkContext({
      documentKey: 'doc-ctx',
      sourceType: 'pdf-text',
      chunkId: 'c-0',
      before: 1,
      after: 1,
    });

    assert.equal(first.status, 'ready');
    assert.deepEqual(
      first.slices.map((slice) => slice.position),
      ['hit', 'after'],
    );
    assert.equal(first.hasMoreBefore, false);
    assert.equal(first.hasMoreAfter, true);

    const wide = store.getChunkContext({
      documentKey: 'doc-ctx',
      sourceType: 'pdf-text',
      chunkId: 'c-5',
      before: 5,
      after: 5,
    });

    assert.equal(wide.slices.length, 4);
    assert.equal(wide.hasMoreBefore, false);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RAG chunk context reports not-ready, not-found and stays source-isolated', () => {
  const { dataDir, store } = createStore();

  try {
    const notReady = store.getChunkContext({
      documentKey: 'doc-missing',
      sourceType: 'pdf-text',
      chunkId: 'c-0',
    });
    assert.equal(notReady.status, 'not-ready');
    assert.equal(notReady.slices.length, 0);

    store.indexDocument({
      documentKey: 'doc-ctx-2',
      title: 'Context Document 2',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-ctx-2',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 2,
      chunks: [0, 1].map((chunkIndex) => ({
        chunkId: `c2-${chunkIndex}`,
        chunkIndex,
        pageIndex: chunkIndex,
        blockId: null,
        text: `pdf chunk ${chunkIndex}`,
        embedding: [0.1, 0.2, 0.3, 0.4],
      })),
    });

    // mineru-markdown 来源未建索引：不跨来源拼接（方案 §5.7）。
    const wrongSource = store.getChunkContext({
      documentKey: 'doc-ctx-2',
      sourceType: 'mineru-markdown',
      chunkId: 'c2-0',
    });
    assert.equal(wrongSource.status, 'not-ready');

    const notFound = store.getChunkContext({
      documentKey: 'doc-ctx-2',
      sourceType: 'pdf-text',
      chunkId: 'does-not-exist',
    });
    assert.equal(notFound.status, 'not-found');

    store.indexDocument({
      documentKey: 'doc-ctx-3',
      title: 'Context Document 3',
      sourceType: 'pdf-text',
      sourceSignature: 'sig-ctx-3',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      chunks: [{
        chunkId: 'c2-0',
        chunkIndex: 0,
        pageIndex: 0,
        blockId: null,
        text: 'other document chunk',
        embedding: [0.1, 0.2, 0.3, 0.4],
      }],
    });

    // 不同文献同 chunkId：各自文档内取邻接，不串档。
    const docTwo = store.getChunkContext({
      documentKey: 'doc-ctx-2',
      sourceType: 'pdf-text',
      chunkId: 'c2-0',
    });
    assert.equal(docTwo.status, 'ready');
    assert.equal(docTwo.slices.length, 2);
    assert.ok(docTwo.slices.every((slice) => slice.text.startsWith('pdf chunk')));

    const docThree = store.getChunkContext({
      documentKey: 'doc-ctx-3',
      sourceType: 'pdf-text',
      chunkId: 'c2-0',
    });
    assert.equal(docThree.slices.length, 1);
    assert.equal(docThree.slices[0].text, 'other document chunk');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
