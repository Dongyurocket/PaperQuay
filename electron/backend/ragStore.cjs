const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sqliteVec = require('sqlite-vec');
const { DatabaseSync, sqlStringLiteral, withTransaction } = require('./nodeSqlite.cjs');
const { cleanString, toError } = require('./utils.cjs');

const RAG_SOURCE_TYPES = new Set(['mineru-markdown', 'pdf-text']);
const MAX_VECTOR_DIMENSION = 32768;
const MAX_RAG_RETRIEVAL_TOP_K = 100;
const MAX_AGENT_LOG_STRING_LENGTH = 4096;
const MAX_AGENT_LOG_DEPTH = 6;
const MAX_AGENT_LOG_ITEMS = 64;
const AGENT_RUN_STATUSES = new Set(['running', 'done', 'error', 'aborted']);
const AGENT_RUN_EVENT_KINDS = new Set([
  'turn_start',
  'tool_call',
  'tool_result',
  'answer_delta',
  'turn_end',
  'error',
  'stage_start',
  'stage_progress',
  'stage_end',
  'capability',
  'memory',
  'context_compacted',
  'checkpoint',
]);
const AGENT_LOG_SENSITIVE_KEY = /(?:api[_-]?key|authorization|token|password|secret|dataurl|attachment)/i;

function resolveSqliteVecLoadablePath() {
  const loadablePath = typeof sqliteVec.getLoadablePath === 'function'
    ? sqliteVec.getLoadablePath()
    : '';
  const unpackedPath = loadablePath.replace(/\.asar([\\/])/, '.asar.unpacked$1');

  if (unpackedPath !== loadablePath && fs.existsSync(unpackedPath)) {
    return unpackedPath;
  }

  return loadablePath;
}

function loadSqliteVec(db) {
  const loadablePath = resolveSqliteVecLoadablePath();

  if (loadablePath) {
    db.loadExtension(loadablePath);
    return;
  }

  sqliteVec.load(db);
}

function normalizeDocumentKey(value) {
  const documentKey = cleanString(value);
  if (!documentKey) throw new Error('RAG documentKey is required');
  return documentKey;
}

function normalizeSourceType(value) {
  const sourceType = cleanString(value);
  if (!RAG_SOURCE_TYPES.has(sourceType)) {
    throw new Error(`Unsupported RAG sourceType: ${sourceType || '(empty)'}`);
  }
  return sourceType;
}

function normalizeRequiredString(value, label) {
  const text = cleanString(value);
  if (!text) throw new Error(`RAG ${label} is required`);
  return text;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.trunc(number));
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function normalizeBoundedString(value, label, { required = false, maxLength = MAX_AGENT_LOG_STRING_LENGTH } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';

  if (required && !text) {
    throw new Error(`${label} is required`);
  }

  return text.slice(0, maxLength);
}

function normalizeAgentRunId(value, label = 'agent runId') {
  return normalizeBoundedString(value, label, { required: true, maxLength: 180 });
}

function normalizeAgentRunStatus(value, fallback = 'running') {
  const status = normalizeBoundedString(value, 'agent run status', { maxLength: 24 }) || fallback;

  if (!AGENT_RUN_STATUSES.has(status)) {
    throw new Error(`Unsupported agent run status: ${status}`);
  }

  return status;
}

function normalizeAgentEventKind(value) {
  const kind = normalizeBoundedString(value, 'agent run event kind', { required: true, maxLength: 64 });

  if (!AGENT_RUN_EVENT_KINDS.has(kind)) {
    throw new Error(`Unsupported agent run event kind: ${kind}`);
  }

  return kind;
}

function redactAgentLogValue(value, key = '', depth = 0) {
  if (AGENT_LOG_SENSITIVE_KEY.test(key)) {
    return '[redacted]';
  }

  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return '[redacted]';
    }

    return value.slice(0, MAX_AGENT_LOG_STRING_LENGTH);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (depth >= MAX_AGENT_LOG_DEPTH) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_AGENT_LOG_ITEMS)
      .map((item) => redactAgentLogValue(item, '', depth + 1));
  }

  if (typeof value === 'object') {
    const output = {};

    for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_AGENT_LOG_ITEMS)) {
      output[entryKey] = redactAgentLogValue(entryValue, entryKey, depth + 1);
    }

    return output;
  }

  return String(value).slice(0, MAX_AGENT_LOG_STRING_LENGTH);
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(String(value ?? 'null'));
  } catch {
    return null;
  }
}

function normalizeVectorDimension(value) {
  const dimension = Number(value);
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > MAX_VECTOR_DIMENSION) {
    throw new Error(`Unsupported RAG embedding dimension: ${value}`);
  }
  return dimension;
}

function vectorTableName(dimension) {
  return `rag_vec_${normalizeVectorDimension(dimension)}`;
}

function validateEmbedding(embedding, expectedDimension = null) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('RAG chunk embedding must be a non-empty number array');
  }

  const dimension = normalizeVectorDimension(embedding.length);
  if (expectedDimension !== null && dimension !== expectedDimension) {
    throw new Error(`RAG chunk embedding dimension mismatch: expected ${expectedDimension}, got ${dimension}`);
  }

  for (const value of embedding) {
    if (!Number.isFinite(Number(value))) {
      throw new Error('RAG chunk embedding contains a non-finite value');
    }
  }

  return dimension;
}

function toFloat32Array(vector) {
  const output = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    output[index] = Number(vector[index]);
  }
  return output;
}

function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;

    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

// sqlite-vec 的 embedding 列在 node:sqlite 下返回 float32 原始字节（Uint8Array/Buffer），
// 必须按字节视图解码；Array.from 会得到字节值数组，长度不等于维度，直接导致相似边静默为空。
function decodeEmbeddingValue(value, dimension) {
  if (!Number.isSafeInteger(dimension) || dimension <= 0) {
    return null;
  }

  if (value instanceof Float32Array) {
    return value.length === dimension ? value : null;
  }

  if (value instanceof Uint8Array) {
    if (value.byteLength !== dimension * 4 || value.byteOffset % 4 !== 0) {
      return null;
    }

    return new Float32Array(value.buffer, value.byteOffset, dimension);
  }

  if (Array.isArray(value)) {
    return value.length === dimension ? toFloat32Array(value) : null;
  }

  return null;
}

function parseSourceTypesJson(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.map((item) => cleanString(item)).filter(Boolean).sort() : [];
  } catch {
    return [];
  }
}

// 重算单个文档在所有维度下的平均向量缓存；没有可用向量时删除缓存行。
// 语义与原 listDocumentSimilarities 的按 documentKey 聚合一致：跨 source_type 合并、仅统计 ready 且维度匹配的索引。
function rebuildDocumentVectors(db, documentKey) {
  const normalizedDocumentKey = cleanString(documentKey);
  if (!normalizedDocumentKey) {
    return;
  }

  for (const dimension of knownVectorDimensions(db)) {
    const table = vectorTableName(dimension);
    const rows = db.prepare(`
      SELECT
        c.source_type AS sourceType,
        v.embedding AS embedding
      FROM ${table} v
      JOIN rag_chunks c ON c.id = v.rowid
      JOIN rag_indexes i
        ON i.document_key = c.document_key
       AND i.source_type = c.source_type
       AND i.status = 'ready'
       AND i.embedding_dimension = ?
      WHERE c.document_key = ?
      ORDER BY c.source_type, c.chunk_index
    `).all(dimension, normalizedDocumentKey);

    const sum = new Float64Array(dimension);
    const sourceTypes = new Set();
    let count = 0;

    for (const row of rows) {
      const vector = decodeEmbeddingValue(row.embedding, dimension);
      if (!vector) {
        continue;
      }

      for (let index = 0; index < dimension; index += 1) {
        sum[index] += vector[index];
      }
      count += 1;

      const sourceType = cleanString(row.sourceType);
      if (sourceType) {
        sourceTypes.add(sourceType);
      }
    }

    if (count === 0) {
      db.prepare('DELETE FROM rag_document_vectors WHERE document_key = ? AND dimension = ?')
        .run(normalizedDocumentKey, dimension);
      continue;
    }

    const average = new Float32Array(dimension);
    for (let index = 0; index < dimension; index += 1) {
      average[index] = sum[index] / count;
    }

    db.prepare(`
      INSERT INTO rag_document_vectors (
        document_key,
        dimension,
        embedding,
        chunk_count,
        source_types_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (document_key, dimension) DO UPDATE SET
        embedding = excluded.embedding,
        chunk_count = excluded.chunk_count,
        source_types_json = excluded.source_types_json,
        updated_at = excluded.updated_at
    `).run(
      normalizedDocumentKey,
      dimension,
      Buffer.from(average.buffer, average.byteOffset, average.byteLength),
      count,
      JSON.stringify(Array.from(sourceTypes).sort()),
      Date.now(),
    );
  }
}

// 全量重建所有文档的平均向量缓存：顺序扫描 vec 表（partition key 含 document_key/source_type），
// 避免按文档 JOIN vec0 虚拟表的随机 rowid 查找。
function rebuildAllDocumentVectors(db) {
  db.prepare('DELETE FROM rag_document_vectors').run();

  const upsert = db.prepare(`
    INSERT INTO rag_document_vectors (
      document_key,
      dimension,
      embedding,
      chunk_count,
      source_types_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const dimension of knownVectorDimensions(db)) {
    const readyKeys = new Set(
      db.prepare(`
        SELECT document_key || '::' || source_type AS key
        FROM rag_indexes
        WHERE status = 'ready' AND embedding_dimension = ?
      `).all(dimension).map((row) => row.key),
    );
    const table = vectorTableName(dimension);
    const rows = db.prepare(`
      SELECT document_key AS documentKey, source_type AS sourceType, embedding
      FROM ${table}
    `).all();
    const grouped = new Map();

    for (const row of rows) {
      const documentKey = cleanString(row.documentKey);
      const sourceType = cleanString(row.sourceType);

      if (!documentKey || !readyKeys.has(`${documentKey}::${sourceType}`)) {
        continue;
      }

      const vector = decodeEmbeddingValue(row.embedding, dimension);
      if (!vector) {
        continue;
      }

      let entry = grouped.get(documentKey);
      if (!entry) {
        entry = { sum: new Float64Array(dimension), count: 0, sourceTypes: new Set() };
        grouped.set(documentKey, entry);
      }

      for (let index = 0; index < dimension; index += 1) {
        entry.sum[index] += vector[index];
      }
      entry.count += 1;
      if (sourceType) {
        entry.sourceTypes.add(sourceType);
      }
    }

    for (const [documentKey, entry] of grouped) {
      const average = new Float32Array(dimension);
      for (let index = 0; index < dimension; index += 1) {
        average[index] = entry.sum[index] / entry.count;
      }

      upsert.run(
        documentKey,
        dimension,
        Buffer.from(average.buffer, average.byteOffset, average.byteLength),
        entry.count,
        JSON.stringify(Array.from(entry.sourceTypes).sort()),
        Date.now(),
      );
    }
  }
}

// 旧库一次性回填：为所有已有 chunk 的文档重建平均向量缓存。
function backfillDocumentVectors(db) {
  const META_KEY = 'rag_document_vectors_v1';
  const initialized = db
    .prepare('SELECT value FROM rag_store_meta WHERE key = ?')
    .get(META_KEY);

  if (initialized?.value) {
    return;
  }

  rebuildAllDocumentVectors(db);

  db.prepare(`
    INSERT INTO rag_store_meta (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).run(META_KEY, String(Date.now()));
}

function normalizeChunk(chunk, dimension) {
  const chunkId = cleanString(chunk?.chunkId) || `chunk-${normalizeNonNegativeInteger(chunk?.chunkIndex)}`;
  const chunkIndex = normalizeNonNegativeInteger(chunk?.chunkIndex);
  const pageIndex = chunk?.pageIndex === null || chunk?.pageIndex === undefined
    ? null
    : normalizeNonNegativeInteger(chunk.pageIndex);
  const blockId = cleanString(chunk?.blockId) || null;
  const text = typeof chunk?.text === 'string' ? chunk.text : String(chunk?.text ?? '');

  validateEmbedding(chunk?.embedding, dimension);

  return {
    chunkId,
    chunkIndex,
    pageIndex,
    blockId,
    text,
    embedding: chunk.embedding,
  };
}

function rowToStatus(row) {
  if (!row) return null;

  return {
    documentKey: row.document_key,
    sourceType: row.source_type,
    sourceSignature: row.source_signature,
    embeddingModelKey: row.embedding_model_key,
    embeddingDimension: Number(row.embedding_dimension) || 0,
    totalChunkCount: Number(row.total_chunk_count) || 0,
    chunkCount: Number(row.chunk_count) || 0,
    indexedChunkCount: Number(row.indexed_chunk_count) || 0,
    indexedAt: Number(row.indexed_at) || 0,
    status: row.status,
    lastError: row.last_error ?? null,
    failedAt: row.failed_at ?? null,
    retryAfterMs: row.retry_after_ms ?? null,
    cooldownUntil: row.cooldown_until ?? null,
  };
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS rag_indexes (
      document_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      title TEXT,
      source_signature TEXT NOT NULL,
      embedding_model_key TEXT NOT NULL,
      embedding_dimension INTEGER NOT NULL,
      total_chunk_count INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      indexed_chunk_count INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
      last_error TEXT,
      failed_at INTEGER,
      retry_after_ms INTEGER,
      cooldown_until INTEGER,
      PRIMARY KEY (document_key, source_type)
    );

    CREATE TABLE IF NOT EXISTS rag_chunks (
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

    CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_source
      ON rag_chunks (document_key, source_type, chunk_index);

    CREATE TABLE IF NOT EXISTS rag_vec_dimensions (
      dimension INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS rag_store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 文档级平均向量缓存：listDocumentSimilarities 只读本表，
    -- 避免每次全量解码 rag_chunks 的全部 chunk 向量。
    CREATE TABLE IF NOT EXISTS rag_document_vectors (
      document_key TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      chunk_count INTEGER NOT NULL,
      source_types_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (document_key, dimension)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error', 'aborted')),
      model TEXT,
      preset_id TEXT,
      instruction TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      turns INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_session_started
      ON agent_runs (session_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_run_events_run
      ON agent_run_events (run_id, id);
  `);
}

function initializeFtsSchema(db, { disabled = false } = {}) {
  if (disabled) {
    return false;
  }

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
        text,
        content='rag_chunks',
        content_rowid='id',
        tokenize='unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TRIGGER IF NOT EXISTS rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
      END;

      CREATE TRIGGER IF NOT EXISTS rag_chunks_au AFTER UPDATE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO rag_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `);

    const initialized = db
      .prepare('SELECT value FROM rag_store_meta WHERE key = ?')
      .get('rag_chunks_fts_v1');

    if (!initialized) {
      db.exec("INSERT INTO rag_chunks_fts(rag_chunks_fts) VALUES('rebuild')");
      db.prepare('INSERT INTO rag_store_meta (key, value) VALUES (?, ?)').run(
        'rag_chunks_fts_v1',
        String(Date.now()),
      );
    }

    return true;
  } catch (error) {
    console.warn('[paperquay] SQLite FTS5 is unavailable; local RAG will use vector retrieval only.', toError(error));
    return false;
  }
}

function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath, {
    allowExtension: true,
    timeout: 5000,
  });

  db.enableLoadExtension(true);
  try {
    loadSqliteVec(db);
  } finally {
    db.enableLoadExtension(false);
  }

  db.exec('PRAGMA journal_mode = WAL;');
  createSchema(db);
  backfillDocumentVectors(db);
  return db;
}

function ensureVectorTable(db, dimension) {
  const normalizedDimension = normalizeVectorDimension(dimension);
  const table = vectorTableName(normalizedDimension);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${table}
    USING vec0(
      document_key TEXT partition key,
      source_type TEXT partition key,
      embedding float[${normalizedDimension}]
    );
  `);
  db.prepare('INSERT OR IGNORE INTO rag_vec_dimensions (dimension) VALUES (?)').run(normalizedDimension);
  return table;
}

function hasVectorTable(db, dimension) {
  const row = db
    .prepare('SELECT dimension FROM rag_vec_dimensions WHERE dimension = ?')
    .get(normalizeVectorDimension(dimension));
  return Boolean(row);
}

function knownVectorDimensions(db) {
  return db
    .prepare('SELECT dimension FROM rag_vec_dimensions ORDER BY dimension')
    .all()
    .map((row) => Number(row.dimension))
    .filter((dimension) => Number.isSafeInteger(dimension) && dimension > 0);
}

function deleteVectorRowsByIds(db, ids) {
  if (ids.length === 0) return;

  for (const dimension of knownVectorDimensions(db)) {
    const table = vectorTableName(dimension);
    const statement = db.prepare(`DELETE FROM ${table} WHERE rowid = ?`);

    for (const id of ids) {
      statement.run(BigInt(id));
    }
  }
}

function chunkIdsForSource(db, documentKey, sourceType) {
  return db
    .prepare('SELECT id FROM rag_chunks WHERE document_key = ? AND source_type = ?')
    .all(documentKey, sourceType)
    .map((row) => Number(row.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

function deleteDocumentSourceData(db, documentKey, sourceType) {
  deleteVectorRowsByIds(db, chunkIdsForSource(db, documentKey, sourceType));
  db.prepare('DELETE FROM rag_chunks WHERE document_key = ? AND source_type = ?').run(documentKey, sourceType);
  db.prepare('DELETE FROM rag_indexes WHERE document_key = ? AND source_type = ?').run(documentKey, sourceType);
}

function getStatus(db, documentKey, sourceType) {
  return rowToStatus(
    db
      .prepare('SELECT * FROM rag_indexes WHERE document_key = ? AND source_type = ?')
      .get(documentKey, sourceType),
  );
}

function countChunks(db, documentKey, sourceType) {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM rag_chunks WHERE document_key = ? AND source_type = ?')
    .get(documentKey, sourceType);
  return Number(row?.count) || 0;
}

function upsertStatus(db, status) {
  db.prepare(`
    INSERT INTO rag_indexes (
      document_key,
      source_type,
      title,
      source_signature,
      embedding_model_key,
      embedding_dimension,
      total_chunk_count,
      chunk_count,
      indexed_chunk_count,
      indexed_at,
      status,
      last_error,
      failed_at,
      retry_after_ms,
      cooldown_until
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (document_key, source_type) DO UPDATE SET
      title = excluded.title,
      source_signature = excluded.source_signature,
      embedding_model_key = excluded.embedding_model_key,
      embedding_dimension = excluded.embedding_dimension,
      total_chunk_count = excluded.total_chunk_count,
      chunk_count = excluded.chunk_count,
      indexed_chunk_count = excluded.indexed_chunk_count,
      indexed_at = excluded.indexed_at,
      status = excluded.status,
      last_error = excluded.last_error,
      failed_at = excluded.failed_at,
      retry_after_ms = excluded.retry_after_ms,
      cooldown_until = excluded.cooldown_until
  `).run(
    status.documentKey,
    status.sourceType,
    status.title,
    status.sourceSignature,
    status.embeddingModelKey,
    status.embeddingDimension,
    status.totalChunkCount,
    status.chunkCount,
    status.indexedChunkCount,
    status.indexedAt,
    status.status,
    status.lastError,
    status.failedAt,
    status.retryAfterMs,
    status.cooldownUntil,
  );
}

function indexedSourceRows(db, documentKey, sourceType, dimension) {
  const sql = `
    SELECT source_type
    FROM rag_indexes
    WHERE document_key = ?
      AND status = 'ready'
      AND embedding_dimension = ?
      ${sourceType ? 'AND source_type = ?' : ''}
    ORDER BY source_type
  `;
  const args = sourceType ? [documentKey, dimension, sourceType] : [documentKey, dimension];
  return db.prepare(sql).all(...args);
}

function buildFtsMatchQuery(value) {
  const terms = String(value ?? '')
    .trim()
    .match(/[\p{L}\p{N}_]+/gu) ?? [];

  return terms
    .slice(0, 32)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function ragResultKey(row) {
  return `${row.sourceType}::${row.chunkId}`;
}

function rrfFuse(vectorRows, ftsRows, { k = 60 } = {}) {
  const normalizedK = Math.max(1, normalizeNonNegativeInteger(k, 60));
  const fused = new Map();

  const addRanks = (rows, source) => {
    for (const [index, row] of rows.entries()) {
      const key = ragResultKey(row);
      const existing = fused.get(key) ?? { ...row, rrfScore: 0, sourceRanks: {} };
      existing.rrfScore += 1 / (normalizedK + index + 1);
      existing.sourceRanks[source] = index + 1;
      fused.set(key, existing);
    }
  };

  addRanks(vectorRows, 'vector');
  addRanks(ftsRows, 'fts');

  return [...fused.values()]
    .sort((left, right) => right.rrfScore - left.rrfScore)
    .map(({ rrfScore, sourceRanks, ...row }) => ({
      ...row,
      // Existing renderers expect lower scores to be more relevant, so invert the RRF score.
      score: 1 - rrfScore,
    }));
}

function rowToAgentRun(row) {
  if (!row) {
    return null;
  }

  return {
    runId: row.run_id,
    sessionId: row.session_id,
    startedAt: Number(row.started_at) || 0,
    finishedAt: row.finished_at === null || row.finished_at === undefined ? null : Number(row.finished_at),
    status: row.status,
    model: row.model ?? '',
    presetId: row.preset_id ?? '',
    instruction: row.instruction ?? '',
    promptTokens: Number(row.prompt_tokens) || 0,
    completionTokens: Number(row.completion_tokens) || 0,
    turns: Number(row.turns) || 0,
  };
}

function rowToAgentRunEvent(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id) || 0,
    runId: row.run_id,
    ts: Number(row.ts) || 0,
    kind: row.kind,
    payload: parseJsonOrNull(row.payload) ?? {},
  };
}

function createRagStore(appPaths, options = {}) {
  if (!appPaths?.ragDatabasePath) {
    throw new Error('ragDatabasePath is required');
  }

  let db = openDatabase(appPaths.ragDatabasePath);
  let ftsAvailable = initializeFtsSchema(db, { disabled: options.disableFts === true });

  function indexDocument(request) {
    const documentKey = normalizeDocumentKey(request?.documentKey);
    const sourceType = normalizeSourceType(request?.sourceType);
    const title = cleanString(request?.title);
    const sourceSignature = normalizeRequiredString(request?.sourceSignature, 'sourceSignature');
    const embeddingModelKey = normalizeRequiredString(request?.embeddingModelKey, 'embeddingModelKey');
    const chunks = Array.isArray(request?.chunks) ? request.chunks : [];
    const totalChunkCount = normalizeNonNegativeInteger(request?.totalChunkCount, chunks.length);
    const dimension = chunks.length > 0 ? validateEmbedding(chunks[0]?.embedding) : 0;

    if (dimension > 0) {
      for (const chunk of chunks) {
        validateEmbedding(chunk?.embedding, dimension);
      }
    }

    return withTransaction(db, () => {
      const existing = getStatus(db, documentKey, sourceType);
      const shouldReset =
        !existing ||
        existing.status === 'failed' ||
        existing.sourceSignature !== sourceSignature ||
        existing.embeddingModelKey !== embeddingModelKey ||
        existing.embeddingDimension !== dimension;

      if (shouldReset) {
        deleteDocumentSourceData(db, documentKey, sourceType);
      }

      if (dimension === 0) {
        upsertStatus(db, {
          documentKey,
          sourceType,
          title,
          sourceSignature,
          embeddingModelKey,
          embeddingDimension: 0,
          totalChunkCount,
          chunkCount: 0,
          indexedChunkCount: 0,
          indexedAt: Date.now(),
          status: totalChunkCount === 0 ? 'ready' : 'pending',
          lastError: null,
          failedAt: null,
          retryAfterMs: null,
          cooldownUntil: null,
        });
        rebuildDocumentVectors(db, documentKey);
        return;
      }

      const vectorTable = ensureVectorTable(db, dimension);
      const selectChunk = db.prepare(
        'SELECT id FROM rag_chunks WHERE document_key = ? AND source_type = ? AND chunk_id = ?',
      );
      const insertChunk = db.prepare(`
        INSERT INTO rag_chunks (
          document_key,
          source_type,
          chunk_id,
          chunk_index,
          page_index,
          block_id,
          text
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const updateChunk = db.prepare(`
        UPDATE rag_chunks
        SET chunk_index = ?, page_index = ?, block_id = ?, text = ?
        WHERE id = ?
      `);
      const lastInsertedId = db.prepare('SELECT last_insert_rowid() AS id');
      const insertVector = db.prepare(`
        INSERT INTO ${vectorTable} (rowid, document_key, source_type, embedding)
        VALUES (?, ?, ?, ?)
      `);

      for (const rawChunk of chunks) {
        const chunk = normalizeChunk(rawChunk, dimension);
        const existingChunk = selectChunk.get(documentKey, sourceType, chunk.chunkId);
        let chunkRowId;

        if (existingChunk) {
          chunkRowId = Number(existingChunk.id);
          deleteVectorRowsByIds(db, [chunkRowId]);
          updateChunk.run(chunk.chunkIndex, chunk.pageIndex, chunk.blockId, chunk.text, chunkRowId);
        } else {
          insertChunk.run(
            documentKey,
            sourceType,
            chunk.chunkId,
            chunk.chunkIndex,
            chunk.pageIndex,
            chunk.blockId,
            chunk.text,
          );
          chunkRowId = Number(lastInsertedId.get().id);
        }

        insertVector.run(
          BigInt(chunkRowId),
          documentKey,
          sourceType,
          toFloat32Array(chunk.embedding),
        );
      }

      const indexedChunkCount = countChunks(db, documentKey, sourceType);
      upsertStatus(db, {
        documentKey,
        sourceType,
        title,
        sourceSignature,
        embeddingModelKey,
        embeddingDimension: dimension,
        totalChunkCount,
        chunkCount: indexedChunkCount,
        indexedChunkCount,
        indexedAt: Date.now(),
        status: indexedChunkCount >= totalChunkCount ? 'ready' : 'pending',
        lastError: null,
        failedAt: null,
        retryAfterMs: null,
        cooldownUntil: null,
      });
      rebuildDocumentVectors(db, documentKey);
    });
  }

  function reportFailure(request) {
    const documentKey = normalizeDocumentKey(request?.documentKey);
    const sourceType = normalizeSourceType(request?.sourceType);
    const title = cleanString(request?.title);
    const sourceSignature = normalizeRequiredString(request?.sourceSignature, 'sourceSignature');
    const embeddingModelKey = normalizeRequiredString(request?.embeddingModelKey, 'embeddingModelKey');
    const retryAfterMs = normalizeNullableInteger(request?.retryAfterMs);
    const failedAt = Date.now();

    return withTransaction(db, () => {
      deleteDocumentSourceData(db, documentKey, sourceType);
      rebuildDocumentVectors(db, documentKey);
      upsertStatus(db, {
        documentKey,
        sourceType,
        title,
        sourceSignature,
        embeddingModelKey,
        embeddingDimension: 0,
        totalChunkCount: normalizeNonNegativeInteger(request?.totalChunkCount),
        chunkCount: 0,
        indexedChunkCount: 0,
        indexedAt: 0,
        status: 'failed',
        lastError: cleanString(request?.errorMessage) || 'RAG index failed',
        failedAt,
        retryAfterMs,
        cooldownUntil: retryAfterMs ? failedAt + retryAfterMs : null,
      });
    });
  }

  function getDocumentIndexStatus(request) {
    const documentKey = normalizeDocumentKey(request?.documentKey);
    const sourceType = normalizeSourceType(request?.sourceType);
    return getStatus(db, documentKey, sourceType);
  }

  function retrieveVectorChunks({ documentKey, sourceType, queryEmbedding, dimension, limit }) {
    if (!hasVectorTable(db, dimension)) {
      return [];
    }

    const vectorTable = vectorTableName(dimension);
    const sourceRows = indexedSourceRows(db, documentKey, sourceType, dimension);
    const search = db.prepare(`
      SELECT
        c.chunk_id,
        c.source_type,
        c.page_index,
        c.block_id,
        c.text,
        v.distance
      FROM ${vectorTable} v
      JOIN rag_chunks c ON c.id = v.rowid
      WHERE v.embedding MATCH ?
        AND k = ?
        AND v.document_key = ?
        AND v.source_type = ?
      ORDER BY v.distance
    `);
    const results = [];

    for (const row of sourceRows) {
      results.push(
        ...search.all(queryEmbedding, limit, documentKey, row.source_type).map((chunk) => ({
          chunkId: chunk.chunk_id,
          sourceType: chunk.source_type,
          pageIndex: chunk.page_index ?? null,
          blockId: chunk.block_id ?? null,
          text: chunk.text,
          score: Number(chunk.distance) || 0,
        })),
      );
    }

    return results
      .sort((left, right) => left.score - right.score)
      .slice(0, limit);
  }

  function searchFts({ documentKey, sourceType, queryText, dimension, limit }) {
    if (!ftsAvailable) {
      return [];
    }

    const matchQuery = buildFtsMatchQuery(queryText);

    if (!matchQuery) {
      return [];
    }

    const sourceClause = sourceType ? 'AND c.source_type = ?' : '';
    const args = [matchQuery, documentKey, dimension];

    if (sourceType) {
      args.push(sourceType);
    }

    args.push(limit);

    try {
      const rows = db.prepare(`
        SELECT
          c.chunk_id,
          c.source_type,
          c.page_index,
          c.block_id,
          c.text,
          bm25(rag_chunks_fts) AS rank
        FROM rag_chunks_fts
        JOIN rag_chunks c ON c.id = rag_chunks_fts.rowid
        JOIN rag_indexes i
          ON i.document_key = c.document_key
         AND i.source_type = c.source_type
         AND i.status = 'ready'
         AND i.embedding_dimension = ?
        WHERE rag_chunks_fts MATCH ?
          AND c.document_key = ?
          ${sourceClause}
        ORDER BY rank
        LIMIT ?
      `).all(dimension, matchQuery, documentKey, ...(sourceType ? [sourceType] : []), limit);

      return rows.map((chunk) => ({
        chunkId: chunk.chunk_id,
        sourceType: chunk.source_type,
        pageIndex: chunk.page_index ?? null,
        blockId: chunk.block_id ?? null,
        text: chunk.text,
        score: Number(chunk.rank) || 0,
      }));
    } catch (error) {
      console.warn('[paperquay] FTS retrieval failed; local RAG used vector retrieval only.', toError(error));
      return [];
    }
  }

  function retrieveDocumentChunks(request) {
    const documentKey = normalizeDocumentKey(request?.documentKey);
    const sourceType = request?.sourceType ? normalizeSourceType(request.sourceType) : null;
    const topK = Math.min(
      MAX_RAG_RETRIEVAL_TOP_K,
      Math.max(1, normalizeNonNegativeInteger(request?.topK, 6)),
    );
    const dimension = validateEmbedding(request?.queryEmbedding);
    const candidateLimit = Math.min(MAX_RAG_RETRIEVAL_TOP_K, Math.max(topK, topK * 2));
    const vectorRows = retrieveVectorChunks({
      documentKey,
      sourceType,
      queryEmbedding: toFloat32Array(request.queryEmbedding),
      dimension,
      limit: candidateLimit,
    });
    const ftsRows = searchFts({
      documentKey,
      sourceType,
      queryText: normalizeBoundedString(request?.queryText, 'RAG queryText', { maxLength: 2000 }),
      dimension,
      limit: candidateLimit,
    });

    if (ftsRows.length === 0) {
      return vectorRows.slice(0, topK);
    }

    return rrfFuse(vectorRows, ftsRows).slice(0, topK);
  }

  function createAgentRun(request) {
    const runId = normalizeAgentRunId(request?.runId);
    const sessionId = normalizeAgentRunId(request?.sessionId, 'agent sessionId');
    const startedAt = normalizeNonNegativeInteger(request?.startedAt, Date.now());
    const status = normalizeAgentRunStatus(request?.status, 'running');

    db.prepare(`
      INSERT INTO agent_runs (
        run_id, session_id, started_at, finished_at, status, model, preset_id, instruction,
        prompt_tokens, completion_tokens, turns
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      sessionId,
      startedAt,
      status === 'running' ? null : startedAt,
      status,
      normalizeBoundedString(request?.model, 'agent model', { maxLength: 256 }),
      normalizeBoundedString(request?.presetId, 'agent presetId', { maxLength: 180 }),
      normalizeBoundedString(request?.instruction, 'agent instruction', { maxLength: MAX_AGENT_LOG_STRING_LENGTH }),
      normalizeNonNegativeInteger(request?.promptTokens),
      normalizeNonNegativeInteger(request?.completionTokens),
      normalizeNonNegativeInteger(request?.turns),
    );

    return rowToAgentRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
  }

  function appendAgentRunEvent(request) {
    const runId = normalizeAgentRunId(request?.runId);
    const kind = normalizeAgentEventKind(request?.kind);
    const ts = normalizeNonNegativeInteger(request?.ts, Date.now());
    const promptTokens = normalizeNonNegativeInteger(request?.promptTokens);
    const completionTokens = normalizeNonNegativeInteger(request?.completionTokens);
    const turns = normalizeNonNegativeInteger(request?.turn);
    const payload = redactAgentLogValue(request?.payload ?? {});
    const serializedPayload = JSON.stringify(payload);

    if (!db.prepare('SELECT 1 FROM agent_runs WHERE run_id = ?').get(runId)) {
      throw new Error(`Unknown agent run: ${runId}`);
    }

    return withTransaction(db, () => {
      db.prepare(`
        INSERT INTO agent_run_events (run_id, ts, kind, payload)
        VALUES (?, ?, ?, ?)
      `).run(runId, ts, kind, serializedPayload);
      const id = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);

      db.prepare(`
        UPDATE agent_runs
        SET prompt_tokens = prompt_tokens + ?,
            completion_tokens = completion_tokens + ?,
            turns = MAX(turns, ?)
        WHERE run_id = ?
      `).run(promptTokens, completionTokens, turns, runId);

      return rowToAgentRunEvent(db.prepare('SELECT * FROM agent_run_events WHERE id = ?').get(id));
    });
  }

  function finishAgentRun(request) {
    const runId = normalizeAgentRunId(request?.runId);
    const status = normalizeAgentRunStatus(request?.status, 'done');

    if (status === 'running') {
      throw new Error('A finished agent run cannot retain running status');
    }

    const result = db.prepare(`
      UPDATE agent_runs
      SET finished_at = ?,
          status = ?,
          prompt_tokens = prompt_tokens + ?,
          completion_tokens = completion_tokens + ?,
          turns = MAX(turns, ?)
      WHERE run_id = ?
    `).run(
      normalizeNonNegativeInteger(request?.finishedAt, Date.now()),
      status,
      normalizeNonNegativeInteger(request?.promptTokens),
      normalizeNonNegativeInteger(request?.completionTokens),
      normalizeNonNegativeInteger(request?.turns),
      runId,
    );

    if (Number(result.changes) === 0) {
      throw new Error(`Unknown agent run: ${runId}`);
    }

    return rowToAgentRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
  }

  function getAgentRun(request) {
    const runId = normalizeAgentRunId(request?.runId);
    return rowToAgentRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
  }

  function getAgentRunEvents(request) {
    const runId = normalizeAgentRunId(request?.runId);
    const afterId = normalizeNonNegativeInteger(request?.afterId);
    const limit = Math.min(500, Math.max(1, normalizeNonNegativeInteger(request?.limit, 200)));

    return db.prepare(`
      SELECT *
      FROM agent_run_events
      WHERE run_id = ? AND id > ?
      ORDER BY id
      LIMIT ?
    `).all(runId, afterId, limit).map(rowToAgentRunEvent);
  }

  function listInterruptedAgentRuns(request = {}) {
    const sessionId = normalizeBoundedString(request?.sessionId, 'agent sessionId', { maxLength: 180 });
    const limit = Math.min(50, Math.max(1, normalizeNonNegativeInteger(request?.limit, 10)));
    const rows = sessionId
      ? db.prepare(`
        SELECT * FROM agent_runs
        WHERE status = 'running' AND session_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `).all(sessionId, limit)
      : db.prepare(`
        SELECT * FROM agent_runs
        WHERE status = 'running'
        ORDER BY started_at DESC
        LIMIT ?
      `).all(limit);

    return rows.map(rowToAgentRun);
  }

  function listAgentRunUsageBySession(request = {}) {
    const sessionIds = Array.isArray(request?.sessionIds)
      ? request.sessionIds
        .map((sessionId) => normalizeBoundedString(sessionId, 'agent sessionId', { maxLength: 180 }))
        .filter(Boolean)
        .slice(0, 100)
      : [];

    const where = sessionIds.length > 0
      ? `WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`
      : '';

    return db.prepare(`
      SELECT
        session_id,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COUNT(*) AS run_count
      FROM agent_runs
      ${where}
      GROUP BY session_id
    `).all(...sessionIds).map((row) => ({
      sessionId: row.session_id,
      promptTokens: Number(row.prompt_tokens) || 0,
      completionTokens: Number(row.completion_tokens) || 0,
      runCount: Number(row.run_count) || 0,
    }));
  }

  function isFtsAvailable() {
    return ftsAvailable;
  }

  function listDocumentSimilarities(request = {}) {
    const limit = Math.max(0, normalizeNonNegativeInteger(request.limit, 80));
    const minSimilarity = Number.isFinite(Number(request.minSimilarity))
      ? Math.max(-1, Math.min(1, Number(request.minSimilarity)))
      : 0.82;
    const allowedDocumentKeys = Array.isArray(request.documentKeys)
      ? new Set(request.documentKeys.map((key) => cleanString(key)).filter(Boolean))
      : null;

    if (limit === 0) {
      return [];
    }

    // 只读文档级平均向量缓存（由 indexDocument/reportFailure 维护、旧库一次性回填），
    // 避免每次全量解码 chunk 向量阻塞主进程。
    const documents = db.prepare(`
      SELECT
        document_key AS documentKey,
        dimension,
        embedding,
        source_types_json AS sourceTypesJson
      FROM rag_document_vectors
      ORDER BY document_key, dimension
    `).all()
      .map((row) => {
        const documentKey = cleanString(row.documentKey);
        const dimension = Number(row.dimension);

        if (!documentKey || (allowedDocumentKeys && !allowedDocumentKeys.has(documentKey))) {
          return null;
        }

        const vector = decodeEmbeddingValue(row.embedding, dimension);
        if (!vector) {
          return null;
        }

        return {
          documentKey,
          dimension,
          vector,
          sourceTypes: parseSourceTypesJson(row.sourceTypesJson),
        };
      })
      .filter(Boolean);

    const edges = [];

    for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < documents.length; rightIndex += 1) {
        const left = documents[leftIndex];
        const right = documents[rightIndex];

        if (left.dimension !== right.dimension) {
          continue;
        }

        const similarity = cosineSimilarity(left.vector, right.vector);

        if (similarity < minSimilarity) {
          continue;
        }

        edges.push({
          sourceDocumentKey: left.documentKey,
          targetDocumentKey: right.documentKey,
          similarity,
          sourceTypes: Array.from(new Set([...left.sourceTypes, ...right.sourceTypes])).sort(),
        });
      }
    }

    return edges
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);
  }

  function migrateFromLibraryRagIndexes(ragIndexes) {
    const entries = Object.entries(ragIndexes && typeof ragIndexes === 'object' ? ragIndexes : {});
    const summary = {
      migratedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (const [key, value] of entries) {
      try {
        const status = value?.status ?? {};
        const keyParts = key.split('::');
        const fallbackSourceType = keyParts.pop();
        const fallbackDocumentKey = keyParts.join('::');
        const documentKey = status.documentKey || fallbackDocumentKey;
        const sourceType = status.sourceType || fallbackSourceType;

        if (status.status === 'failed') {
          reportFailure({
            documentKey,
            title: value?.title || '',
            sourceType,
            sourceSignature: status.sourceSignature,
            embeddingModelKey: status.embeddingModelKey,
            totalChunkCount: status.totalChunkCount,
            errorMessage: status.lastError || 'Legacy RAG index failed',
            retryAfterMs: status.retryAfterMs,
          });
          summary.migratedCount += 1;
          continue;
        }

        const chunks = (Array.isArray(value?.chunks) ? value.chunks : []).filter((chunk) =>
          Array.isArray(chunk?.embedding) && chunk.embedding.length > 0,
        );

        indexDocument({
          documentKey,
          title: value?.title || '',
          sourceType,
          sourceSignature: status.sourceSignature,
          embeddingModelKey: status.embeddingModelKey,
          totalChunkCount: status.totalChunkCount ?? chunks.length,
          chunks,
        });
        summary.migratedCount += 1;
      } catch (error) {
        summary.failedCount += 1;
        summary.errors.push({ key, message: toError(error) });
      }
    }

    summary.skippedCount = entries.length - summary.migratedCount - summary.failedCount;
    return summary;
  }

  function close() {
    if (db.isOpen) {
      db.close();
    }
  }

  return {
    appendAgentRunEvent,
    close,
    createAgentRun,
    finishAgentRun,
    getAgentRun,
    getAgentRunEvents,
    getDocumentIndexStatus,
    indexDocument,
    isFtsAvailable,
    listAgentRunUsageBySession,
    listDocumentSimilarities,
    listInterruptedAgentRuns,
    migrateFromLibraryRagIndexes,
    reportFailure,
    retrieveDocumentChunks,
    snapshotTo(targetPath) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.rmSync(targetPath, { force: true });
      db.exec(`VACUUM main INTO ${sqlStringLiteral(targetPath)}`);
      return targetPath;
    },
    async replaceWithSnapshot(snapshotPath) {
      const replacementPath = `${appPaths.ragDatabasePath}.restore-${Date.now()}.tmp`;
      await fsp.mkdir(path.dirname(appPaths.ragDatabasePath), { recursive: true });
      await fsp.copyFile(snapshotPath, replacementPath);

      if (db.isOpen) db.close();

      try {
        await fsp.rm(appPaths.ragDatabasePath, { force: true });
        await fsp.rm(`${appPaths.ragDatabasePath}-wal`, { force: true });
        await fsp.rm(`${appPaths.ragDatabasePath}-shm`, { force: true });
        await fsp.rename(replacementPath, appPaths.ragDatabasePath);
      } finally {
        await fsp.rm(replacementPath, { force: true }).catch(() => {});
        db = openDatabase(appPaths.ragDatabasePath);
        ftsAvailable = initializeFtsSchema(db, { disabled: options.disableFts === true });
      }
    },
  };
}

module.exports = { buildFtsMatchQuery, createRagStore, rrfFuse };
