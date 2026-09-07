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
