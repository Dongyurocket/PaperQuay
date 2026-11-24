const fs = require('node:fs');
const path = require('node:path');
const sqliteVec = require('sqlite-vec');
const { DatabaseSync, sqlStringLiteral } = require('../nodeSqlite.cjs');
const { toError } = require('../utils.cjs');

const MAX_VECTOR_DIMENSION = 32768;

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
      generation_id TEXT NOT NULL DEFAULT '',
      section_id TEXT,
      section_path TEXT,
      start_offset INTEGER,
      end_offset INTEGER,
      text_version TEXT,
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
  ensureChunkMappingColumns(db);
}

const VECTOR_BACKFILL_META_KEY = 'rag_document_vectors_v1';
const VECTOR_BACKFILL_CURSOR_KEY = 'rag_document_vectors_v1_cursor';
const VECTOR_BACKFILL_SYNC_LIMIT = 24;

function readStoreMeta(db, key) {
  return db.prepare('SELECT value FROM rag_store_meta WHERE key = ?').get(key)?.value ?? '';
}

function writeStoreMeta(db, key, value) {
  db.prepare(`
    INSERT INTO rag_store_meta (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function ensureChunkMappingColumns(db) {
  const names = new Set(
    db.prepare('PRAGMA table_info(rag_chunks)').all().map((row) => row.name),
  );
  const columns = [
    ['generation_id', "generation_id TEXT NOT NULL DEFAULT ''"],
    ['section_id', 'section_id TEXT'],
    ['section_path', 'section_path TEXT'],
    ['start_offset', 'start_offset INTEGER'],
    ['end_offset', 'end_offset INTEGER'],
    ['text_version', 'text_version TEXT'],
  ];

  for (const [name, definition] of columns) {
    if (!names.has(name)) {
      db.exec(`ALTER TABLE rag_chunks ADD COLUMN ${definition}`);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_generation
      ON rag_chunks (document_key, source_type, generation_id, chunk_index);
  `);
}

const FTS_TABLE_NAME = 'rag_chunks_fts';
const FTS_TRIGGER_NAMES = ['rag_chunks_ai', 'rag_chunks_ad', 'rag_chunks_au'];
const FTS_TRIGRAM_META_KEY = 'rag_chunks_fts_v2_trigram';
const FTS_UNICODE61_META_KEY = 'rag_chunks_fts_v1';

function existingFtsTokenizer(db) {
  try {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(FTS_TABLE_NAME);
    const sql = typeof row?.sql === 'string' ? row.sql.toLowerCase() : '';

    if (!sql) {
      return null;
    }

    if (sql.includes('trigram')) {
      return 'trigram';
    }

    return 'unicode61';
  } catch {
    return null;
  }
}

function dropFtsObjects(db) {
  for (const triggerName of FTS_TRIGGER_NAMES) {
    db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  }

  db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE_NAME}`);
}

function createFtsObjects(db, tokenizer) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE_NAME} USING fts5(
      text,
      content='rag_chunks',
      content_rowid='id',
      tokenize='${tokenizer}'
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
}

function rebuildFtsIndex(db, metaKey) {
  db.exec(`INSERT INTO ${FTS_TABLE_NAME}(${FTS_TABLE_NAME}) VALUES('rebuild')`);
  db.prepare('INSERT OR REPLACE INTO rag_store_meta (key, value) VALUES (?, ?)').run(
    metaKey,
    String(Date.now()),
  );
}

// 中文全文检索依赖 FTS5 trigram 分词：unicode61 会把整段中文当成一个 token，
// 导致中文关键词完全无法命中；trigram 按 3 字滑窗索引，天然支持中文子串匹配，
// 对英文则退化为子串匹配（召回更高）。旧库使用 unicode61 时自动重建为 trigram。
function initializeFtsSchema(db, { disabled = false } = {}) {
  if (disabled) {
    return false;
  }

  try {
    const existingTokenizer = existingFtsTokenizer(db);
    let activeTokenizer = 'trigram';
    let recreated = false;

    try {
      if (existingTokenizer !== 'trigram') {
        dropFtsObjects(db);
        createFtsObjects(db, 'trigram');
        recreated = true;
      }
    } catch (trigramError) {
      // 运行环境 SQLite 过旧不支持 trigram 时回退到 unicode61，保持英文检索可用。
      // 无条件重建：进入本分支时 FTS 对象可能已被 drop，按 existingTokenizer 条件跳过
      // 会留下缺失 FTS 表的坏状态。
      console.warn(
        '[paperquay] FTS5 trigram tokenizer unavailable; falling back to unicode61.',
        toError(trigramError),
      );
      activeTokenizer = 'unicode61';
      dropFtsObjects(db);
      createFtsObjects(db, 'unicode61');
      recreated = true;
    }

    const metaKey =
      activeTokenizer === 'trigram' ? FTS_TRIGRAM_META_KEY : FTS_UNICODE61_META_KEY;
    const initialized = db
      .prepare('SELECT value FROM rag_store_meta WHERE key = ?')
      .get(metaKey);

    if (recreated || !initialized) {
      rebuildFtsIndex(db, metaKey);
    }

    return true;
  } catch (error) {
    console.warn('[paperquay] SQLite FTS5 is unavailable; local RAG will use vector retrieval only.', toError(error));
    return false;
  }
}

// 启动自愈：清理已拥有可用 mineru-markdown ready 索引的文档下、残留的无数据 failed 记录（如历史早期测试遗留的 pdf-text:failed 空壳行），
// 避免已就绪文献因历史次要来源残留被永久误判为索引失败。
function cleanupOrphanFailedStatuses(db) {
  try {
    db.exec(`
      DELETE FROM rag_indexes
      WHERE status = 'failed'
        AND chunk_count = 0
        AND document_key IN (
          SELECT document_key
          FROM rag_indexes
          WHERE source_type = 'mineru-markdown'
            AND status = 'ready'
        );
    `);
  } catch (error) {
    console.warn('[paperquay] Failed to cleanup orphan failed RAG statuses.', toError(error));
  }
}

function openDatabase(databasePath, options = {}, { backfillDocumentVectors } = {}) {
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
  cleanupOrphanFailedStatuses(db);
  if (options.deferVectorBackfill !== true && typeof backfillDocumentVectors === 'function') {
    backfillDocumentVectors(db);
  }
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

function snapshotTo(db, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.rmSync(targetPath, { force: true });
  db.exec(`VACUUM main INTO ${sqlStringLiteral(targetPath)}`);
  return targetPath;
}

module.exports = {
  FTS_TABLE_NAME,
  FTS_TRIGGER_NAMES,
  FTS_TRIGRAM_META_KEY,
  FTS_UNICODE61_META_KEY,
  MAX_VECTOR_DIMENSION,
  VECTOR_BACKFILL_CURSOR_KEY,
  VECTOR_BACKFILL_META_KEY,
  VECTOR_BACKFILL_SYNC_LIMIT,
  cleanupOrphanFailedStatuses,
  createSchema,
  ensureChunkMappingColumns,
  ensureVectorTable,
  hasVectorTable,
  initializeFtsSchema,
  knownVectorDimensions,
  normalizeVectorDimension,
  openDatabase,
  readStoreMeta,
  snapshotTo,
  vectorTableName,
  writeStoreMeta,
};
