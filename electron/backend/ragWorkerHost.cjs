const path = require('node:path');
const { Worker } = require('node:worker_threads');

const RAG_WORKER_METHODS = [
  'appendAgentRunEvent',
  'clearAgentHistory',
  'createAgentRun',
  'finalizeDocumentIndex',
  'finishAgentRun',
  'getAgentRun',
  'getAgentRunEvents',
  'getChunkContext',
  'getDocumentIndexStatus',
  'indexDocument',
  'indexNote',
  'listAgentRunUsageBySession',
  'listDocumentSimilarities',
  'listIndexedChunkIds',
  'listIndexStatuses',
  'listInterruptedAgentRuns',
  'migrateFromLibraryRagIndexes',
  'replaceWithSnapshot',
  'reportFailure',
  'retrieveDocumentChunks',
  'retrieveNoteVectors',
  'removeNoteIndex',
  'removeDocumentIndex',
  'snapshotTo',
  'stepVectorBackfill',
  'vectorBackfillStatus',
];

// Read calls should fail fast; indexing/snapshot/migrate can legitimately run
// for minutes on large libraries.
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_LONG_TIMEOUT_MS = 10 * 60_000;
const LONG_RUNNING_METHODS = new Set([
  'finalizeDocumentIndex',
  'indexDocument',
  'indexNote',
  'migrateFromLibraryRagIndexes',
  'replaceWithSnapshot',
  'snapshotTo',
  'stepVectorBackfill',
]);

const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_RESTART_WINDOW_MS = 60_000;

function makeWorkerError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function createRagWorkerStore(appPaths, options = {}) {
  // 测试与嵌入式宿主可注入 Worker；默认仍是独立 worker_threads 线程。
  const spawnWorker = typeof options.createWorker === 'function'
    ? options.createWorker
    : () => new Worker(path.join(__dirname, 'ragWorker.cjs'), {
      workerData: { appPaths, options },
    });

  const defaultCallTimeoutMs = Number.isFinite(Number(options.callTimeoutMs))
    ? Math.max(0, Number(options.callTimeoutMs))
    : null;
  const methodTimeouts = options.methodTimeouts && typeof options.methodTimeouts === 'object'
    ? options.methodTimeouts
    : {};
  const maxRestarts = Number.isFinite(Number(options.maxRestarts))
    ? Math.max(0, Math.trunc(Number(options.maxRestarts)))
    : DEFAULT_MAX_RESTARTS;
  const restartWindowMs = Number.isFinite(Number(options.restartWindowMs))
    ? Math.max(1, Number(options.restartWindowMs))
    : DEFAULT_RESTART_WINDOW_MS;

  let nextId = 1;
  const pending = new Map();
  let worker = null;
  let closed = false;
  let needsRestart = false;
  let restartTimestamps = [];

  function resolveCallTimeout(method) {
    if (defaultCallTimeoutMs !== null) return defaultCallTimeoutMs;
    const perMethod = Number(methodTimeouts[method]);
    if (Number.isFinite(perMethod)) return Math.max(0, perMethod);
    return LONG_RUNNING_METHODS.has(method) ? DEFAULT_LONG_TIMEOUT_MS : DEFAULT_READ_TIMEOUT_MS;
  }

  function clearEntryTimer(entry) {
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  function rejectAllPending(error) {
    for (const entry of pending.values()) {
      clearEntryTimer(entry);
      entry.reject(error);
    }
    pending.clear();
  }

  function handleCrash(source, error) {
    if (closed) return;
    if (worker !== source) return;
    worker = null;
    needsRestart = true;
    rejectAllPending(error);
  }

  function handleMessage(message) {
    const entry = pending.get(message?.id);
    if (!entry) {
      return;
    }

    pending.delete(message.id);
    clearEntryTimer(entry);
    if (message.ok) {
      entry.resolve(message.result);
      return;
    }

    entry.reject(makeWorkerError(message.error || 'RAG worker call failed', 'RAG_WORKER_CALL_FAILED'));
  }

  function attachWorker(nextWorker) {
    nextWorker.on('message', handleMessage);
    nextWorker.on('error', (error) => {
      handleCrash(nextWorker, error instanceof Error ? error : makeWorkerError(String(error), 'RAG_WORKER_CRASHED'));
    });
    nextWorker.on('exit', (code) => {
      if (closed) return;
      handleCrash(
        nextWorker,
        makeWorkerError(`RAG worker exited with code ${code}`, 'RAG_WORKER_EXITED'),
      );
    });
  }

  function pruneRestarts(now) {
    restartTimestamps = restartTimestamps.filter((timestamp) => now - timestamp < restartWindowMs);
  }

  function ensureWorker() {
    if (closed) {
      throw makeWorkerError('RAG worker store is closed', 'RAG_WORKER_CLOSED');
    }
    if (worker) return worker;

    if (needsRestart) {
      const now = Date.now();
      pruneRestarts(now);
      if (restartTimestamps.length >= maxRestarts) {
        throw makeWorkerError(
          `RAG worker restart budget exhausted (${maxRestarts} restarts within ${restartWindowMs}ms)`,
          'RAG_WORKER_RESTART_BUDGET',
        );
      }
      restartTimestamps.push(now);
    }

    const nextWorker = spawnWorker();
    attachWorker(nextWorker);
    worker = nextWorker;
    needsRestart = false;
    return nextWorker;
  }

  function call(method, args) {
    let current;
    try {
      current = ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }

    const id = nextId;
    nextId += 1;
    const timeoutMs = resolveCallTimeout(method);

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, method, timer: null };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(makeWorkerError(
            `RAG worker call "${method}" timed out after ${timeoutMs}ms`,
            'RAG_WORKER_TIMEOUT',
          ));
        }, timeoutMs);
        entry.timer.unref?.();
      }
      pending.set(id, entry);

      try {
        current.postMessage({ id, method, args });
      } catch (error) {
        pending.delete(id);
        clearEntryTimer(entry);
        reject(error);
        // 发送失败通常意味着 worker 已退出：让其他等待中的调用一起失败并在下次调用重建。
        handleCrash(current, error instanceof Error ? error : makeWorkerError(String(error), 'RAG_WORKER_CRASHED'));
      }
    });
  }

  const api = {
    available: true,
    execution: 'worker',
  };

  for (const method of RAG_WORKER_METHODS) {
    api[method] = (...args) => call(method, args);
  }

  api.close = async (closeOptions = {}) => {
    if (closed) {
      return { timedOut: false };
    }
    closed = true;

    const hasBudget = Boolean(closeOptions) && typeof closeOptions === 'object' && 'timeoutMs' in closeOptions;
    const timeoutMs = Math.max(0, Number(closeOptions?.timeoutMs) || 0);
    const current = worker;
    worker = null;

    // Pending calls can no longer complete once the store is closing.
    rejectAllPending(makeWorkerError('RAG worker store is closed', 'RAG_WORKER_CLOSED'));

    if (!current) {
      return { timedOut: false };
    }

    let timedOut = false;

    if (hasBudget && timeoutMs === 0) {
      // 预算已经耗尽：不再等待 worker 响应，直接请求终止。
      timedOut = true;
    } else {
      const closeId = nextId;
      nextId += 1;
      let settleReply = () => {};
      const closedReply = new Promise((resolve) => {
        settleReply = resolve;
      });
      pending.set(closeId, {
        resolve: () => settleReply(true),
        reject: () => settleReply(false),
        method: 'close',
        timer: null,
      });

      try {
        current.postMessage({ id: closeId, method: 'close', args: [] });
      } catch {
        // worker 已经不可写：按失败回复处理，继续 terminate。
        pending.delete(closeId);
        settleReply(false);
      }

      if (hasBudget) {
        let timer;
        const replied = await Promise.race([
          closedReply,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
            timer.unref?.();
          }),
        ]);
        clearTimeout(timer);
        timedOut = !replied;
      } else {
        await closedReply;
      }

      const entry = pending.get(closeId);
      if (entry) clearEntryTimer(entry);
      pending.delete(closeId);
    }

    if (timedOut) {
      // 让仍在等待 close 的其他调用尽快失败，而不是永远挂起。
      rejectAllPending(makeWorkerError(
        'RAG worker did not close within the shutdown budget',
        'RAG_WORKER_CLOSE_TIMEOUT',
      ));
    }

    try {
      await current.terminate();
    } catch {
      // 已退出的 worker 再 terminate 可能抛错；关闭流程仍视为完成。
    }
    return { timedOut };
  };

  // Spawn eagerly so `close()` can flush an idle worker, matching the previous
  // host behavior. Rebuilds after a crash stay lazy (see ensureWorker).
  const initialWorker = spawnWorker();
  attachWorker(initialWorker);
  worker = initialWorker;

  return api;
}

module.exports = {
  createRagWorkerStore,
  RAG_WORKER_METHODS,
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_LONG_TIMEOUT_MS,
  LONG_RUNNING_METHODS,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_RESTART_WINDOW_MS,
};
