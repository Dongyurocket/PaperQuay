'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

// 大库的 VACUUM + integrity_check 可能耗时数十秒；给一个明确上限，
// 超时后终止 worker，避免备份界面永远停在“正在校验”。
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 120_000;

function codedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function snapshotDatabaseInWorker({
  sourcePath,
  targetPath,
  kind = 'library',
  deep = true,
  timeoutMs = DEFAULT_SNAPSHOT_TIMEOUT_MS,
  signal,
  createWorker,
} = {}) {
  if (typeof sourcePath !== 'string' || !sourcePath || typeof targetPath !== 'string' || !targetPath) {
    return Promise.reject(codedError('INVALID_SNAPSHOT_REQUEST', 'A source and target database path are required'));
  }
  if (signal?.aborted) {
    return Promise.reject(codedError('CANCELLED', 'Database snapshot was cancelled'));
  }

  // 测试与嵌入式宿主可注入 Worker；默认仍是独立 worker_threads 线程。
  const worker = typeof createWorker === 'function'
    ? createWorker({ sourcePath, targetPath, kind, deep })
    : new Worker(path.join(__dirname, 'backupDatabaseWorker.cjs'), {
      workerData: { sourcePath, targetPath, kind, deep },
    });

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const onAbort = () => finalize(reject, codedError('CANCELLED', 'Database snapshot was cancelled'));

    function finalize(callback, value) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      Promise.resolve()
        .then(() => worker.terminate?.())
        .catch(() => {})
        .then(() => callback(value));
    }

    if (typeof signal?.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const budget = Number(timeoutMs);
    if (Number.isFinite(budget) && budget > 0) {
      const delay = Math.trunc(budget);
      timer = setTimeout(() => {
        finalize(reject, codedError('DB_SNAPSHOT_TIMEOUT', `Database snapshot timed out after ${delay} ms`));
      }, delay);
      timer.unref?.();
    }

    worker.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.ok) {
        finalize(resolve, message.result);
      } else {
        finalize(reject, codedError(
          message.code || 'DB_SNAPSHOT_FAILED',
          message.error || 'Database snapshot worker failed',
        ));
      }
    });
    worker.on('error', (error) => {
      finalize(reject, codedError(
        'DB_SNAPSHOT_FAILED',
        error instanceof Error ? error.message : String(error),
        error,
      ));
    });
    worker.on('exit', (code) => {
      if (!settled) {
        finalize(reject, codedError('DB_SNAPSHOT_FAILED', `Database snapshot worker exited with code ${code}`));
      }
    });
  });
}

module.exports = { DEFAULT_SNAPSHOT_TIMEOUT_MS, snapshotDatabaseInWorker };
