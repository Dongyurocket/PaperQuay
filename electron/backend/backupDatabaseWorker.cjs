'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync, sqlStringLiteral } = require('./nodeSqlite.cjs');

function loadSqliteVec(db) {
  const sqliteVec = require('sqlite-vec');
  db.enableLoadExtension(true);
  try {
    const loadablePath = typeof sqliteVec.getLoadablePath === 'function' ? sqliteVec.getLoadablePath() : '';
    if (loadablePath) db.loadExtension(loadablePath.replace(/\.asar([\\/])/, '.asar.unpacked$1'));
    else sqliteVec.load(db);
  } finally {
    db.enableLoadExtension(false);
  }
}

function openDatabase(filePath, { rag = false, readOnly = false } = {}) {
  const db = new DatabaseSync(filePath, { readOnly, allowExtension: rag, timeout: 5000 });
  if (rag) loadSqliteVec(db);
  return db;
}

function countRows(db, kind) {
  if (kind === 'library') {
    return {
      papers: Number(db.prepare('SELECT COUNT(*) AS n FROM papers').get().n) || 0,
      attachments: Number(db.prepare('SELECT COUNT(*) AS n FROM attachments').get().n) || 0,
    };
  }
  if (kind === 'notes') {
    return {
      notes: Number(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n) || 0,
      noteFolders: Number(db.prepare('SELECT COUNT(*) AS n FROM note_folders').get().n) || 0,
    };
  }
  return {
    ragIndexes: Number(db.prepare('SELECT COUNT(*) AS n FROM rag_indexes').get().n) || 0,
    ragDocuments: Number(db.prepare('SELECT COUNT(DISTINCT document_key) AS n FROM rag_chunks').get().n) || 0,
    ragChunks: Number(db.prepare('SELECT COUNT(*) AS n FROM rag_chunks').get().n) || 0,
  };
}

/**
 * 在 worker 线程里完成 VACUUM snapshot、user_version 与 integrity_check。
 * 只读连接上的 `VACUUM main INTO` 会包含 WAL 中未 checkpoint 的数据，
 * 且不会阻塞主进程 UI；大库的 I/O 与校验都在这里完成。
 */
function runSnapshot() {
  const { sourcePath, targetPath, kind, deep = true } = workerData;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.rmSync(targetPath, { force: true });

  const source = openDatabase(sourcePath, { rag: kind === 'rag', readOnly: true });
  try {
    source.exec(`VACUUM main INTO ${sqlStringLiteral(targetPath)}`);
  } finally {
    source.close();
  }

  const snapshot = openDatabase(targetPath, { rag: kind === 'rag' });
  try {
    snapshot.exec('PRAGMA user_version = 1');
    const row = snapshot.prepare(deep ? 'PRAGMA integrity_check' : 'PRAGMA quick_check').get();
    const value = row ? Object.values(row)[0] : '';
    if (value !== 'ok') {
      const error = new Error(`Database integrity check failed: ${value}`);
      error.code = 'DB_INTEGRITY_FAILED';
      throw error;
    }
    return { counts: countRows(snapshot, kind), userVersion: 1 };
  } finally {
    snapshot.close();
  }
}

if (!parentPort) {
  throw new Error('backupDatabaseWorker.cjs must run inside a worker thread');
}

try {
  parentPort.postMessage({ ok: true, result: runSnapshot() });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code: error?.code,
    error: error instanceof Error ? error.message : String(error),
  });
} finally {
  parentPort.close();
}
