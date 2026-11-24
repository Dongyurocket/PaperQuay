const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, withTransaction } = require('./nodeSqlite.cjs');

/**
 * 外部写入标记（MCP / 其他进程 → 桌面应用）。
 *
 * 与 desktopRunMarker 同目录、同思路：只记录"哪个范围被写过、写了几次、什么时候写的"，
 * 不承担锁语义。桌面应用通过 fs.watch 监听它并刷新界面；watch 不可用时退化为
 * 窗口聚焦时读取版本号比对。
 *
 * 存储从 JSON 快照换成 SQLite：并发写入用 BEGIN IMMEDIATE + `revision = revision + 1`
 * 原子递增，两个进程不会再把同一个旧值各 +1。旧版 `.paperquay-external-writes.json`
 * 只作为迁移基线读取一次，不再写入。
 */
const MARKER_FILE = '.paperquay-external-writes.sqlite';
const LEGACY_MARKER_FILE = '.paperquay-external-writes.json';
const MARKER_VERSION = 1;

const WRITE_SCOPES = ['library', 'notes'];

function externalWriteMarkerPath(dataDir) {
  return path.join(dataDir, MARKER_FILE);
}

function legacyExternalWriteMarkerPath(dataDir) {
  return path.join(dataDir, LEGACY_MARKER_FILE);
}

function emptyState() {
  return {
    version: MARKER_VERSION,
    library: { revision: 0, updatedAt: null, source: null },
    notes: { revision: 0, updatedAt: null, source: null },
  };
}

function normalizeScope(value) {
  const revision = Number.isSafeInteger(Number(value?.revision)) && Number(value.revision) >= 0
    ? Number(value.revision)
    : 0;
  const updatedAt = Number.isSafeInteger(Number(value?.updatedAt)) && Number(value.updatedAt) > 0
    ? Number(value.updatedAt)
    : null;
  const source = typeof value?.source === 'string' && value.source.trim() ? value.source.trim().slice(0, 120) : null;

  return { revision, updatedAt, source };
}

function normalizeSource(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : 'mcp';
}

function readStateFromDb(db) {
  const state = emptyState();
  let rows;
  try {
    rows = db.prepare('SELECT scope, revision, updated_at AS updatedAt, source FROM external_writes').all();
  } catch (error) {
    // 事务在提交前崩溃可能留下空库/无表；按「尚无事件」处理，而不是把整个标记判为损坏。
    if (/no such table/i.test(String(error?.message || ''))) return state;
    throw error;
  }
  for (const row of rows) {
    if (!WRITE_SCOPES.includes(row.scope)) continue;
    state[row.scope] = normalizeScope(row);
  }
  return state;
}

function readLegacyState(dataDir) {
  let raw;
  try {
    raw = fs.readFileSync(legacyExternalWriteMarkerPath(dataDir), 'utf8');
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return null;
    return {
      version: MARKER_VERSION,
      library: normalizeScope(payload.library),
      notes: normalizeScope(payload.notes),
    };
  } catch {
    return null;
  }
}

function readExternalWriteMarker(dataDir) {
  const filePath = externalWriteMarkerPath(dataDir);

  if (fs.existsSync(filePath)) {
    let db;
    try {
      db = new DatabaseSync(filePath, { readOnly: true, timeout: 5000 });
      const state = readStateFromDb(db);
      // 事务提交前崩溃可能留下空库（尚未播种旧 JSON）：此时仍以旧基线为准。
      if (state.library.revision === 0 && state.notes.revision === 0) {
        const legacyState = readLegacyState(dataDir);
        if (legacyState && (legacyState.library.revision > 0 || legacyState.notes.revision > 0)) {
          return { status: 'known', filePath, state: legacyState };
        }
      }
      return { status: 'known', filePath, state };
    } catch {
      return { status: 'unknown', filePath, state: emptyState() };
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  const legacyPath = legacyExternalWriteMarkerPath(dataDir);
  let raw;
  try {
    raw = fs.readFileSync(legacyPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', filePath, state: emptyState() };
    return { status: 'unknown', filePath, state: emptyState() };
  }

  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') {
      return { status: 'unknown', filePath, state: emptyState() };
    }

    return {
      status: 'known',
      filePath,
      state: {
        version: MARKER_VERSION,
        library: normalizeScope(payload.library),
        notes: normalizeScope(payload.notes),
      },
    };
  } catch {
    return { status: 'unknown', filePath, state: emptyState() };
  }
}

/**
 * 记录一次外部写入并返回最新状态。
 * revision 在单个写事务内原子 +1，多进程并发也不会丢失递增；即使标记库被删除，
 * 也会从 0（或旧 JSON 基线）重新开始，桌面端只比较差值。
 */
function recordExternalWrite(dataDir, scope, { source = 'mcp', at = Date.now() } = {}) {
  const normalizedScope = WRITE_SCOPES.includes(scope) ? scope : null;
  if (!normalizedScope) throw new Error(`Unsupported external write scope: ${scope}`);

  const filePath = externalWriteMarkerPath(dataDir);
  // 旧 JSON 只在标记库没有任何行时播种；已迁移后它不影响 revision。
  const legacyState = readLegacyState(dataDir);
  const updatedAt = Number.isSafeInteger(Number(at)) && Number(at) > 0 ? Number(at) : Date.now();
  const sourceValue = normalizeSource(source);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath, { timeout: 5000 });

  try {
    withTransaction(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS external_writes (
          scope TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          updated_at INTEGER,
          source TEXT
        );
      `);

      const rowCount = Number(
        db.prepare('SELECT COUNT(*) AS count FROM external_writes').get()?.count,
      ) || 0;
      if (legacyState && rowCount === 0) {
        const insertLegacy = db.prepare(`
          INSERT OR IGNORE INTO external_writes (scope, revision, updated_at, source)
          VALUES (?, ?, ?, ?)
        `);
        for (const legacyScope of WRITE_SCOPES) {
          const previous = legacyState[legacyScope];
          if (previous.revision > 0 || previous.updatedAt !== null || previous.source !== null) {
            insertLegacy.run(legacyScope, previous.revision, previous.updatedAt, previous.source);
          }
        }
      }

      db.prepare(`
        INSERT INTO external_writes (scope, revision, updated_at, source)
        VALUES (?, 1, ?, ?)
        ON CONFLICT (scope) DO UPDATE SET
          revision = external_writes.revision + 1,
          updated_at = excluded.updated_at,
          source = excluded.source
      `).run(normalizedScope, updatedAt, sourceValue);
    });

    return readStateFromDb(db);
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function externalWriteRevisions(state) {
  return {
    library: Number(state?.library?.revision) || 0,
    notes: Number(state?.notes?.revision) || 0,
  };
}

module.exports = {
  MARKER_FILE,
  LEGACY_MARKER_FILE,
  WRITE_SCOPES,
  externalWriteMarkerPath,
  externalWriteRevisions,
  readExternalWriteMarker,
  recordExternalWrite,
};
