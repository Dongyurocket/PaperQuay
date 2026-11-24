import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
const sqliteVec = require('sqlite-vec');
const { buildFtsMatchQuery } = require('../src/shared/ragQueryUtils.cjs');
const { buildEmbeddingModelKey } = require('../src/shared/embeddingConfig.cjs');
const {
  searchFtsChunks,
  searchVectorChunks,
  searchLikeChunks,
  assembleNeighborSnippets,
  rrfFuse,
} = require('../electron/shared/ragSearch.cjs');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

function setupFixture({ extraDocuments = 0, chunksPerDocument = 0 } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pq-hybrid-retrieval-'));
  const appPaths = {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
  };
  // Library schema is only needed for rag_enabled lookups.
  createLibraryStore(appPaths).close();

  const ragDb = new DatabaseSync(appPaths.ragDatabasePath, { allowExtension: true });
  ragDb.enableLoadExtension(true);
  ragDb.loadExtension(sqliteVec.getLoadablePath());
  ragDb.enableLoadExtension(false);
  ragDb.exec(`
    CREATE TABLE rag_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      page_index INTEGER,
      block_id TEXT,
      text TEXT NOT NULL,
      generation_id TEXT NOT NULL DEFAULT '',
      section_id TEXT
    );
    CREATE VIRTUAL TABLE rag_chunks_fts USING fts5(
      text,
      content='rag_chunks',
      content_rowid='id',
      tokenize='unicode61'
    );
    CREATE TRIGGER rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
      INSERT INTO rag_chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TABLE rag_indexes (
      document_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL,
      embedding_model_key TEXT NOT NULL,
      embedding_dimension INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    );
    CREATE TABLE rag_vec_dimensions (dimension INTEGER PRIMARY KEY);
    INSERT INTO rag_vec_dimensions (dimension) VALUES (4);
    INSERT INTO rag_indexes VALUES
      ('doc-a', 'mineru-markdown', 'ready', 'http://localhost:11434/v1::test-embed::4', 4, 1),
      ('doc-b', 'mineru-markdown', 'ready', 'http://localhost:11434/v1::test-embed::4', 4, 2);
  `);
  ragDb.exec(`
    INSERT INTO rag_chunks (document_key, source_type, chunk_id, chunk_index, page_index, block_id, text)
    VALUES
      ('doc-a', 'mineru-markdown', 'c-1', 0, 0, 'b-1', 'We propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism to draw global dependencies between input and output.'),
      ('doc-a', 'mineru-markdown', 'c-2', 1, 1, 'b-2', 'Multi-head attention allows the model to jointly attend to information from different representation subspaces at different positions.'),
      ('doc-b', 'mineru-markdown', 'c-3', 0, 0, 'b-3', 'We explicitly reformulate the layers as learning residual functions with reference to the layer inputs, instead of learning unreferenced functions.');
  `);
  ragDb.exec(`
    CREATE VIRTUAL TABLE rag_vec_4 USING vec0(
      document_key TEXT partition key,
      source_type TEXT partition key,
      embedding float[4]
    );
  `);
  const insert = ragDb.prepare(
    'INSERT INTO rag_vec_4 (rowid, document_key, source_type, embedding) VALUES (?, ?, ?, ?)',
  );
  insert.run(1n, 'doc-a', 'mineru-markdown', new Float32Array([1, 0, 0, 0]));
  insert.run(2n, 'doc-a', 'mineru-markdown', new Float32Array([0, 1, 0, 0]));
  insert.run(3n, 'doc-b', 'mineru-markdown', new Float32Array([0, 0, 1, 0]));

  if (extraDocuments > 0 && chunksPerDocument > 0) {
    const modelKey = 'http://localhost:11434/v1::test-embed::4';
    const insertChunk = ragDb.prepare(`
      INSERT INTO rag_chunks (document_key, source_type, chunk_id, chunk_index, page_index, block_id, text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVector = ragDb.prepare(
      'INSERT INTO rag_vec_4 (rowid, document_key, source_type, embedding) VALUES (?, ?, ?, ?)',
    );
    const insertIndex = ragDb.prepare(
      "INSERT INTO rag_indexes (document_key, source_type, status, embedding_model_key, embedding_dimension, indexed_at) VALUES (?, ?, 'ready', ?, 4, ?)",
    );
    ragDb.exec('BEGIN');
    for (let documentIndex = 0; documentIndex < extraDocuments; documentIndex += 1) {
      const documentKey = `bulk-${documentIndex}`;
      insertIndex.run(documentKey, 'mineru-markdown', modelKey, 1000 + documentIndex);
      for (let chunkIndex = 0; chunkIndex < chunksPerDocument; chunkIndex += 1) {
        const info = insertChunk.run(
          documentKey,
          'mineru-markdown',
          `${documentKey}-c-${chunkIndex}`,
          chunkIndex,
          0,
          `b-${documentKey}-${chunkIndex}`,
          'attention transformer attention mechanism draws global dependencies between input and output tokens',
        );
        insertVector.run(
          BigInt(info.lastInsertRowid as any),
          documentKey,
          'mineru-markdown',
          new Float32Array([0, 1, 0, 0]),
        );
      }
    }
    ragDb.exec('COMMIT');
  }

  ragDb.close();

  const settingsDir = path.join(dataDir, '.settings');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(path.join(settingsDir, 'paperquay.config.json'), JSON.stringify({
    version: 1,
    settings: {
      embeddingBaseUrl: 'http://localhost:11434/v1',
      embeddingModel: 'test-embed',
      embeddingDimensions: 4,
    },
    secrets: { embeddingApiKey: 'test-key' },
  }));

  const service = new PaperQuayKnowledgeService({
    dataDir,
    isAppRunning: () => false,
    embedFn: async () => [0, 1, 0, 0],
  });

  return {
    dataDir,
    appPaths,
    service,
    openRag() {
      const db = new DatabaseSync(appPaths.ragDatabasePath, { readOnly: true, allowExtension: true });
      db.enableLoadExtension(true);
      db.loadExtension(sqliteVec.getLoadablePath());
      db.enableLoadExtension(false);
      return db;
    },
    close() {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** Count executed statements (not just prepared ones) while `fn` runs. */
function instrumentSqlExecutions() {
  const originalPrepare = DatabaseSync.prototype.prepare;
  const executions = new Map<string, number>();
  DatabaseSync.prototype.prepare = function patchedPrepare(sql: string, ...args: any[]) {
    const text = String(sql);
    const statement = originalPrepare.call(this, sql, ...args);
    return new Proxy(statement as any, {
      get(target: any, prop: string | symbol) {
        const value = Reflect.get(target, prop, target);
        if (typeof value === 'function' && ['all', 'get', 'run', 'iterate'].includes(String(prop))) {
          return (...callArgs: any[]) => {
            executions.set(text, (executions.get(text) ?? 0) + 1);
            return value.apply(target, callArgs);
          };
        }
        return value;
      },
    });
  };

  return {
    count(pattern: RegExp) {
      let total = 0;
      for (const [sql, count] of executions) {
        if (pattern.test(sql)) total += count;
      }
      return total;
    },
    total() {
      let total = 0;
      for (const count of executions.values()) total += count;
      return total;
    },
    restore() {
      DatabaseSync.prototype.prepare = originalPrepare;
    },
  };
}

function canonical(row: any) {
  return {
    documentKey: row.documentKey,
    chunkId: row.chunkId,
    text: row.text,
    score: row.score,
    pageIndex: row.pageIndex,
    pageNumber: row.pageIndex === null || row.pageIndex === undefined ? null : Number(row.pageIndex) + 1,
    sourceType: row.sourceType,
    blockId: row.blockId,
  };
}

test('shared keyword retrieval and MCP return the same canonical structure', async () => {
  const fixture = setupFixture();
  const db = fixture.openRag();
  try {
    const matchQuery = buildFtsMatchQuery('multi-head attention');
    const shared = searchFtsChunks(db, {
      matchQuery,
      limit: 4,
      readyMode: 'exists',
      excludedDocumentKeys: new Set(),
    });
    assert.equal(shared.status, 'searched');
    assert.ok(shared.rows.length > 0);

    const mcp = await fixture.service.searchKnowledgeBase({ query: 'multi-head attention', mode: 'keyword' });
    assert.ok(mcp.total > 0);
    assert.deepEqual(mcp.results.map(canonical), shared.rows.map(canonical));
  } finally {
    db.close();
    fixture.close();
  }
});

test('shared FTS + KNN + RRF reproduce MCP hybrid ordering', async () => {
  const fixture = setupFixture();
  const db = fixture.openRag();
  try {
    const config = fixture.service.resolveEmbeddingConfig();
    assert.ok(config);
    const modelKey = buildEmbeddingModelKey(config);
    const fts = searchFtsChunks(db, {
      matchQuery: buildFtsMatchQuery('attention'),
      limit: 4,
      readyMode: 'exists',
      excludedDocumentKeys: new Set(),
    });
    const vector = searchVectorChunks(db, {
      queryVector: [0, 1, 0, 0],
      dimension: 4,
      limit: 4,
      modelKey,
      requireReady: true,
      excludedDocumentKeys: new Set(),
    });
    assert.ok(vector.length > 0);
    const expected = rrfFuse(vector, fts.rows).slice(0, 2);

    const mcp = await fixture.service.searchKnowledgeBase({ query: 'attention', mode: 'hybrid', limit: 2 });
    assert.equal(mcp.retrievalMode, 'hybrid');
    assert.deepEqual(mcp.results.map((row: any) => row.chunkId), expected.map((row: any) => row.chunkId));
    for (const row of mcp.results) {
      assert.equal(row.documentKey, row.paperId);
      assert.equal(typeof row.text, 'string');
      assert.equal(typeof row.snippet, 'string');
      assert.ok(Array.isArray(row.channels));
    }
  } finally {
    db.close();
    fixture.close();
  }
});

test('MCP hybrid retrieval prepares one KNN statement and one batch neighbor query', async () => {
  const fixture = setupFixture();
  try {
    const originalPrepare = DatabaseSync.prototype.prepare;
    let knnPrepares = 0;
    let neighborPrepares = 0;
    DatabaseSync.prototype.prepare = function patchedPrepare(sql: string, ...args: any[]) {
      const text = String(sql);
      if (/embedding\s+MATCH/i.test(text)) knnPrepares += 1;
      if (/chunk_index\s+BETWEEN/i.test(text)) neighborPrepares += 1;
      return originalPrepare.call(this, sql, ...args);
    };
    try {
      const result = await fixture.service.searchKnowledgeBase({ query: 'attention', mode: 'hybrid', limit: 2 });
      assert.ok(result.total > 0);
    } finally {
      DatabaseSync.prototype.prepare = originalPrepare;
    }
    assert.equal(knnPrepares, 1, 'vector retrieval must use one KNN statement, not one per document');
    assert.equal(neighborPrepares, 1, 'neighbor snippets must use one batch query');
  } finally {
    fixture.close();
  }
});

test('batch neighbor assembly bridges adjacent chunks for every hit', () => {
  const fixture = setupFixture();
  const db = fixture.openRag();
  try {
    const rows = [
      { documentKey: 'doc-a', sourceType: 'mineru-markdown', chunkId: 'c-1', chunkIndex: 0, text: 'We propose the Transformer.' },
      { documentKey: 'doc-a', sourceType: 'mineru-markdown', chunkId: 'c-2', chunkIndex: 1, text: 'Multi-head attention allows the model to jointly attend.' },
    ];
    const snippets = assembleNeighborSnippets(db, rows);
    assert.equal(snippets.size, 2);
    for (const snippet of snippets.values()) {
      assert.match(snippet, /We propose the Transformer/);
      assert.match(snippet, /Multi-head attention allows/);
    }
  } finally {
    db.close();
    fixture.close();
  }
});

test('shared vector retrieval can constrain to one document with one KNN query', () => {
  const fixture = setupFixture();
  const db = fixture.openRag();
  try {
    const originalPrepare = db.prepare.bind(db);
    let knnPrepares = 0;
    db.prepare = (sql: string) => {
      if (/embedding\s+MATCH/i.test(String(sql))) knnPrepares += 1;
      return originalPrepare(sql);
    };
    const rows = searchVectorChunks(db, {
      queryVector: [0, 1, 0, 0],
      dimension: 4,
      limit: 4,
      documentKey: 'doc-a',
      modelKey: 'http://localhost:11434/v1::test-embed::4',
      requireReady: true,
      excludedDocumentKeys: new Set(),
    });
    assert.deepEqual(rows.map((row: any) => row.documentKey), ['doc-a', 'doc-a']);
    assert.equal(knnPrepares, 1);
  } finally {
    db.close();
    fixture.close();
  }
});

test('hybrid SQL and embedding work stays O(1) as matching chunks grow', async () => {
  // 13 documents seeded via the fixture + doc-a/doc-b = ~75 matching chunks.
  const fixture = setupFixture({ extraDocuments: 12, chunksPerDocument: 6 });
  try {
    const baseline = await fixture.service.searchKnowledgeBase({ query: 'attention', mode: 'hybrid', limit: 8 });
    assert.ok(baseline.total > 0);

    let embedCalls = 0;
    fixture.service.embedFn = async () => {
      embedCalls += 1;
      return [0, 1, 0, 0];
    };

    const sql = instrumentSqlExecutions();
    let measured;
    try {
      measured = await fixture.service.searchKnowledgeBase({ query: 'attention', mode: 'hybrid', limit: 8 });
    } finally {
      sql.restore();
    }

    assert.deepEqual(measured, baseline, 'batching must not change retrieval results');
    assert.equal(embedCalls, 1, 'one embedding call per hybrid query');
    assert.equal(sql.count(/embedding\s+MATCH/i), 1, 'one KNN statement per query');
    assert.equal(sql.count(/mcp:validate-chunks/), 1, 'chunk revalidation must be one batched query');
    assert.equal(sql.count(/mcp:ready-check/), 1, 'ready filtering must be one batched query');
    assert.equal(sql.count(/chunk_index\s+BETWEEN/i), 1, 'neighbor snippets must use one batch query');
    assert.equal(
      sql.count(/SELECT 1 FROM rag_indexes WHERE document_key = \? AND source_type = \? AND status = 'ready'/),
      0,
      'no per-result ready lookup',
    );
    assert.equal(
      sql.count(/SELECT text, page_index AS pageIndex, block_id AS blockId\s+FROM rag_chunks WHERE document_key = \?/),
      0,
      'no per-result chunk revalidation',
    );
  } finally {
    fixture.close();
  }
});

test('shared LIKE fallback matches MCP fallback rows', async () => {
  const fixture = setupFixture();
  const db = fixture.openRag();
  try {
    const shared = searchLikeChunks(db, {
      query: 'formulat',
      limit: 4,
      readyMode: 'exists',
      excludedDocumentKeys: new Set(),
    });
    assert.ok(shared.length > 0);

    const mcp = await fixture.service.searchKnowledgeBase({ query: 'formulat', mode: 'keyword' });
    assert.ok(mcp.results.some((row: any) => row.channels.includes('like')));
    assert.deepEqual(
      mcp.results.map((row: any) => row.chunkId),
      shared.map((row: any) => row.chunkId),
    );
  } finally {
    db.close();
    fixture.close();
  }
});

test('benchmark: hybrid retrieval SQL/embed counts by corpus size', {
  skip: process.env.PAPERQUAY_PERF !== '1',
}, async () => {
  const corpora: Array<[number, number, string]> = [
    [0, 0, '3 chunks / 2 docs'],
    [12, 6, '75 chunks / 14 docs'],
    [60, 20, '1203 chunks / 62 docs'],
  ];
  for (const [extraDocuments, chunksPerDocument, label] of corpora) {
    const fixture = setupFixture({ extraDocuments, chunksPerDocument });
    try {
      let embedCalls = 0;
      fixture.service.embedFn = async () => {
        embedCalls += 1;
        return [0, 1, 0, 0];
      };
      const sql = instrumentSqlExecutions();
      try {
        await fixture.service.searchKnowledgeBase({ query: 'attention', mode: 'hybrid', limit: 8 });
      } finally {
        sql.restore();
      }
      const knn = sql.count(/embedding\s+MATCH/i);
      const validate = sql.count(/mcp:validate-chunks/);
      const ready = sql.count(/mcp:ready-check/);
      const neighbor = sql.count(/chunk_index\s+BETWEEN/i);
      console.log(
        `${label}: knn=${knn} validate=${validate} ready=${ready} neighbor=${neighbor} embed=${embedCalls} totalStatements=${sql.total()}`,
      );
    } finally {
      fixture.close();
    }
  }
});
