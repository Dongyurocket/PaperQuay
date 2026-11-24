import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { snapshotDatabaseInWorker } = require('../electron/backend/backupDatabaseSnapshot.cjs');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');

class FakeWorker extends EventEmitter {
  terminated = false;

  postMessage() {}

  terminate() {
    this.terminated = true;
    this.emit('exit', 1);
    return Promise.resolve(1);
  }
}

function snapshotArgs(overrides: Record<string, unknown> = {}) {
  return {
    sourcePath: 'C:/source.sqlite',
    targetPath: 'C:/target.sqlite',
    kind: 'library',
    deep: true,
    ...overrides,
  };
}

test('snapshotDatabaseInWorker times out stuck VACUUM/integrity work and terminates the worker', async () => {
  const worker = new FakeWorker();

  await assert.rejects(
    () => snapshotDatabaseInWorker(snapshotArgs({ timeoutMs: 25, createWorker: () => worker })),
    (error: any) => error?.code === 'DB_SNAPSHOT_TIMEOUT',
  );

  assert.equal(worker.terminated, true);
});

test('snapshotDatabaseInWorker can be cancelled and terminates the worker', async () => {
  const worker = new FakeWorker();
  const controller = new AbortController();

  const pending = snapshotDatabaseInWorker(snapshotArgs({
    signal: controller.signal,
    timeoutMs: 5000,
    createWorker: () => worker,
  }));
  controller.abort();

  await assert.rejects(pending, (error: any) => error?.code === 'CANCELLED');
  assert.equal(worker.terminated, true);
});

test('snapshotDatabaseInWorker resolves the worker result', async () => {
  const worker = new FakeWorker();
  const pending = snapshotDatabaseInWorker(snapshotArgs({ timeoutMs: 5000, createWorker: () => worker }));

  worker.emit('message', { ok: true, result: { counts: { papers: 2 }, userVersion: 1 } });

  const result = await pending;
  assert.deepEqual(result.counts, { papers: 2 });
  assert.equal(worker.terminated, true);
});

test('snapshotDatabaseInWorker snapshots the live WAL state off the main thread', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-db-snapshot-test-'));
  const sourcePath = path.join(directory, 'library.sqlite');
  const targetPath = path.join(directory, 'snapshot.sqlite');
  const source = new DatabaseSync(sourcePath);

  try {
    source.exec('PRAGMA journal_mode = WAL');
    source.exec('PRAGMA wal_autocheckpoint = 0');
    source.exec('CREATE TABLE papers (id TEXT PRIMARY KEY)');
    source.exec('CREATE TABLE attachments (id TEXT PRIMARY KEY)');
    source.exec("INSERT INTO papers VALUES ('paper-1')");
    source.exec("INSERT INTO attachments VALUES ('att-1')");
    // 保持连接打开且不 checkpoint：第二行只在 -wal 中。
    source.exec("INSERT INTO papers VALUES ('paper-2')");

    const result = await snapshotDatabaseInWorker({
      sourcePath,
      targetPath,
      kind: 'library',
      deep: true,
      timeoutMs: 20000,
    });

    assert.deepEqual(result.counts, { papers: 2, attachments: 1 });
    assert.equal(existsSync(targetPath), true);

    const snapshot = new DatabaseSync(targetPath, { readOnly: true });
    try {
      assert.equal(Number(snapshot.prepare('PRAGMA user_version').get().user_version), 1);
      assert.equal(Number(snapshot.prepare('SELECT COUNT(*) AS n FROM papers').get().n), 2);
    } finally {
      snapshot.close();
    }
  } finally {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
