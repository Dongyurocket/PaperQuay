import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createRagWorkerStore } = require('../electron/backend/ragWorkerHost.cjs');

class FakeWorker extends EventEmitter {
  terminated = false;
  posted: Array<Record<string, unknown>> = [];

  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }
}

class ResponsiveWorker extends FakeWorker {
  postMessage(message: Record<string, unknown>): void {
    super.postMessage(message);
    if (message.method === 'close') {
      this.emit('message', { id: message.id, ok: true, result: { closed: true } });
    }
  }
}

/** Worker that answers only the methods placed in `respond`, hangs otherwise. */
class ManualWorker extends FakeWorker {
  respond = new Set<string>();

  postMessage(message: Record<string, unknown>): void {
    super.postMessage(message);
    if (this.respond.has(String(message.method))) {
      this.emit('message', { id: message.id, ok: true, result: { method: message.method } });
    }
  }

  crash(error: Error = new Error('worker crashed')): void {
    this.emit('error', error);
  }
}

test('a hung RAG worker is terminated when the shutdown budget expires', async () => {
  const worker = new FakeWorker();
  const store = createRagWorkerStore({ dataDir: 'memory' }, { createWorker: () => worker });

  const result = await store.close({ timeoutMs: 25 });

  assert.deepEqual(result, { timedOut: true });
  assert.equal(worker.terminated, true);
  assert.equal(worker.posted[0]?.method, 'close');
});

test('a responsive RAG worker closes within the shutdown budget', async () => {
  const worker = new ResponsiveWorker();
  const store = createRagWorkerStore({ dataDir: 'memory' }, { createWorker: () => worker });

  const result = await store.close({ timeoutMs: 120 });

  assert.deepEqual(result, { timedOut: false });
  assert.equal(worker.terminated, true);
});

test('close without a budget keeps the previous unbounded wait semantics', async () => {
  const worker = new ResponsiveWorker();
  const store = createRagWorkerStore({ dataDir: 'memory' }, { createWorker: () => worker });

  const result = await store.close();

  assert.deepEqual(result, { timedOut: false });
  assert.equal(worker.terminated, true);
});

test('a hung call times out without killing other in-flight calls', async () => {
  const worker = new ManualWorker();
  worker.respond.add('listIndexStatuses');
  const store = createRagWorkerStore(
    { dataDir: 'memory' },
    { createWorker: () => worker, callTimeoutMs: 30 },
  );

  const hung = store.getChunkContext({ documentKey: 'doc', chunkId: 'c-1' });
  const healthy = store.listIndexStatuses();

  await assert.rejects(hung, (error: any) => {
    assert.equal(error.code, 'RAG_WORKER_TIMEOUT');
    assert.match(error.message, /timed out/i);
    return true;
  });
  assert.deepEqual(await healthy, { method: 'listIndexStatuses' });
  // A timeout must not tear down the worker: a later call still succeeds.
  assert.deepEqual(await store.listIndexStatuses(), { method: 'listIndexStatuses' });
  assert.equal(worker.terminated, false);
});

test('a worker crash rejects pending calls and the next call rebuilds worker #2', async () => {
  const workers = [new ManualWorker(), new ManualWorker()];
  workers[1].respond.add('listIndexStatuses');
  let created = 0;
  const store = createRagWorkerStore(
    { dataDir: 'memory' },
    { createWorker: () => workers[created++] },
  );

  const pending = store.getChunkContext({ documentKey: 'doc', chunkId: 'c-1' });
  workers[0].crash(new Error('worker crashed'));

  await assert.rejects(pending, /worker crashed/);
  assert.equal(created, 1);

  assert.deepEqual(await store.listIndexStatuses(), { method: 'listIndexStatuses' });
  assert.equal(created, 2, 'next call must lazily spawn a fresh worker');
  assert.equal(workers[1].posted[0]?.method, 'listIndexStatuses');
});

test('restart budget exhaustion fails fast instead of spawning forever', async () => {
  const workers = [new ManualWorker(), new ManualWorker()];
  let created = 0;
  const store = createRagWorkerStore(
    { dataDir: 'memory' },
    {
      createWorker: () => {
        const worker = workers[created];
        created += 1;
        return worker ?? new ManualWorker();
      },
      maxRestarts: 1,
      restartWindowMs: 60_000,
      callTimeoutMs: 5_000,
    },
  );

  // First crash: restart budget allows worker #2.
  const first = store.getChunkContext({ documentKey: 'doc', chunkId: 'c-1' });
  workers[0].crash(new Error('crash one'));
  await assert.rejects(first, /crash one/);
  workers[1].respond.add('listIndexStatuses');
  assert.deepEqual(await store.listIndexStatuses(), { method: 'listIndexStatuses' });
  assert.equal(created, 2);

  // Second crash: budget is now exhausted, the next call must fail fast.
  const second = store.getChunkContext({ documentKey: 'doc', chunkId: 'c-2' });
  workers[1].crash(new Error('crash two'));
  await assert.rejects(second, /crash two/);

  await assert.rejects(store.listIndexStatuses(), (error: any) => {
    assert.equal(error.code, 'RAG_WORKER_RESTART_BUDGET');
    assert.match(error.message, /restart budget|too many/i);
    return true;
  });
  assert.equal(created, 2, 'exhausted budget must not create another worker');
});

test('benchmark: real RAG worker cold start (crash-recovery proxy)', {
  skip: process.env.PAPERQUAY_PERF !== '1',
}, async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pq-rag-worker-coldstart-'));
  const ragDatabasePath = path.join(dataDir, 'paperquay-rag.sqlite');
  const store = createRagWorkerStore({ dataDir, ragDatabasePath });
  try {
    const started = performance.now();
    await store.vectorBackfillStatus();
    const elapsed = performance.now() - started;
    console.log(`RAG worker cold start (spawn + first call): ${elapsed.toFixed(1)} ms`);
    assert.ok(elapsed >= 0);
  } finally {
    await store.close();
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // worker 关闭后 Windows 仍可能短暂持有句柄。
    }
  }
});

test('close is idempotent, terminates the worker, and prevents restart', async () => {
  const worker = new ResponsiveWorker();
  let created = 0;
  const store = createRagWorkerStore(
    { dataDir: 'memory' },
    { createWorker: () => { created += 1; return worker; } },
  );

  assert.deepEqual(await store.close(), { timedOut: false });
  assert.deepEqual(await store.close(), { timedOut: false });
  assert.equal(worker.terminated, true);
  assert.equal(created, 1);

  await assert.rejects(store.listIndexStatuses(), (error: any) => {
    assert.equal(error.code, 'RAG_WORKER_CLOSED');
    return true;
  });
  assert.equal(created, 1, 'closed store must never spawn a new worker');
});
