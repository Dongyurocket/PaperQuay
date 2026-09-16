const { randomUUID } = require('node:crypto');
const { prepareMineruCacheForReparse, finishMineruCacheReparse } = require('./mineruCacheCommands.cjs');

const PADDLE_PROGRESS_EVENT = 'paperquay://document-parse-progress';

/** The deadline covers headers AND body consumption. Aborting also closes the socket. */
async function fetchPaddleResource(url, init, consume, options = {}) {
  const remaining = (options.deadline ?? Infinity) - Date.now();
  const timeoutMs = Math.min(options.requestTimeoutMs ?? 60000, remaining);
  if (timeoutMs <= 0) throw new Error('PaddleOCR-VL 任务总时限已到');
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('PaddleOCR-VL 网络请求超时（含响应内容下载）');
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => consume(await fetch(url, { ...init, signal: controller.signal })))(),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function mapConcurrent(items, concurrency, worker) {
  let cursor = 0;
  let failure;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

/** One latest task per document; never retain credentials or large result bodies. */
function createPaddleTaskRegistry() {
  const tasks = new Map();
  const running = new Set();
  let revision = 0;
  function prune() {
    for (const [key, task] of tasks) {
      if (tasks.size <= 200) break;
      if (task.status !== 'running') tasks.delete(key);
    }
  }
  return {
    list: () => [...tasks.values()],
    async run(options, event, execute) {
      const documentKey = options.documentKey || options.pdfPath;
      if (running.has(documentKey)) throw new Error('该文献已有正在执行的解析任务');
      const taskId = options.taskId || randomUUID();
      const startedAt = Date.now();
      let finished = false;
      running.add(documentKey);
      const publish = (patch) => {
        if (finished) return;
        const previous = tasks.get(documentKey);
        const task = {
          ...(previous?.taskId === taskId ? previous : {}),
          taskId, documentKey, startedAt, revision: ++revision, updatedAt: Date.now(),
          ...patch,
        };
        tasks.set(documentKey, task);
        if (task.status !== 'running') finished = true;
        prune();
        if (!event?.sender?.isDestroyed?.()) {
          try { event?.sender?.send('paperquay:event', PADDLE_PROGRESS_EVENT, task); } catch {}
        }
        // Deliberately omit signed URLs, paths and credentials from diagnostics.
        console.info(`[PaddleOCR-VL] task=${taskId} stage=${task.stage} status=${task.status}`);
        return task;
      };
      publish({ status: 'running', stage: 'preparing', completed: 0, total: 100 });
      try {
        const deadline = Date.now() + Math.max(1, options.timeoutSecs ?? 3600) * 1000;
        if (options.reparse && options.extractDir) await prepareMineruCacheForReparse({ directory: options.extractDir });
        const result = await execute({
          ...options,
          deadline,
          onProgress: (patch) => publish({ status: 'running', ...patch }),
        });
        if (Date.now() >= deadline) throw new Error('PaddleOCR-VL 任务总时限已到');
        if (options.reparse && options.extractDir) await finishMineruCacheReparse({ directory: options.extractDir, success: true });
        publish({ status: 'success', stage: 'done', completed: 100, total: 100,
          contentJsonPath: result.contentJsonPath, blockCount: result.blockCount });
        return { ...result, taskId };
      } catch (error) {
        publish({ status: 'error', stage: 'error', error: error instanceof Error ? error.message : String(error), completed: 100, total: 100 });
        throw error;
      } finally {
        running.delete(documentKey);
      }
    },
  };
}

module.exports = { fetchPaddleResource, mapConcurrent, createPaddleTaskRegistry, PADDLE_PROGRESS_EVENT };
