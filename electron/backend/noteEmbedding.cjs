const fs = require('node:fs');
const { embedTexts } = require('./utils.cjs');
const { chunkNote, noteSignature } = require('./noteSearch.cjs');
const { resolveReaderConfigSecrets } = require('./secretStorage.cjs');
const {
  buildEmbeddingModelKey,
  resolveEmbeddingConfigFromDocument,
  clampEmbeddingBatchSize,
} = require('../../src/shared/embeddingConfig.cjs');

function resolveNoteEmbedding(appPaths) {
  try {
    const raw = JSON.parse(fs.readFileSync(appPaths.configPath, 'utf8'));
    const config = resolveEmbeddingConfigFromDocument({
      settings: raw.settings || {},
      secrets: resolveReaderConfigSecrets(raw, appPaths) || {},
    }, {
      requireApiKey: true,
      defaultTimeoutSeconds: 60,
    });
    if (!config) return null;
    return {
      ...config,
      batchSize: clampEmbeddingBatchSize(raw.settings?.embeddingBatchSize, 24),
    };
  } catch { return null; }
}

function noteModelKey(config) {
  return buildEmbeddingModelKey(config);
}

async function indexNote(store, { note, embedding, force = false }, embed = embedTexts) {
  const documentKey = `note:${note.id}`;
  if (note.deletedAt) {
    await store.removeNoteIndex({ id: note.id });
    return { indexed: false };
  }
  const sourceSignature = noteSignature(note);
  const embeddingModelKey = noteModelKey(embedding);
  const status = await store.getDocumentIndexStatus({ documentKey, sourceType: 'note' });
  if (!force && status?.status === 'ready' && status.sourceSignature === sourceSignature && status.embeddingModelKey === embeddingModelKey) {
    return { indexed: false, unchanged: true };
  }
  const chunks = chunkNote(note);
  const request = { documentKey, sourceType: 'note', title: note.title, sourceSignature, embeddingModelKey, totalChunkCount: chunks.length };
  try {
    const indexed = [];
    const batchSize = embedding.batchSize || 24;
    for (let offset = 0; offset < chunks.length; offset += batchSize) {
      const batch = chunks.slice(offset, offset + batchSize);
      const vectors = await embed(batch.map((chunk) => chunk.text), embedding);
      if (vectors.length !== batch.length) throw new Error('Embedding service returned an incomplete note batch');
      indexed.push(...batch.map((chunk, index) => ({ ...chunk, embedding: vectors[index] })));
    }
    await store.indexDocument({ ...request, chunks: indexed });
    return { indexed: true };
  } catch (error) {
    await store.reportFailure({ ...request, errorMessage: error.message });
    throw error;
  }
}

function createNoteIndexer({ noteStore, ragStore, appPaths, resolveEmbedding = () => resolveNoteEmbedding(appPaths) }) {
  const pending = new Map();
  let scheduled = false;
  let running = false;
  let closed = false;
  let accepting = true;
  const state = { completed: 0, failed: 0, lastError: null };
  let idleResolve;
  let idle = Promise.resolve();
  // 退出超时时取消在途 embedding 请求（fetch 由 utils.embedTexts 透传 signal）。
  // Worker 执行单元的 embedding 在另一个线程内，signal 不可结构化克隆；
  // 该路径由 shutdown 预算到点后终止 worker 来取消。
  const shutdownAbort = new AbortController();
  const canAbortEmbedding = ragStore?.execution !== 'worker';

  function embeddingWithShutdownSignal(embedding) {
    if (!canAbortEmbedding) return embedding;
    if (!embedding.signal) return { ...embedding, signal: shutdownAbort.signal };
    if (typeof AbortSignal.any === 'function') {
      return { ...embedding, signal: AbortSignal.any([embedding.signal, shutdownAbort.signal]) };
    }
    return embedding;
  }

  async function drain() {
    scheduled = false;
    running = true;
    while (pending.size) {
      const [id, force] = pending.entries().next().value;
      pending.delete(id);
      try {
        const note = noteStore.getNote({ id, includeDeleted: true });
        const embedding = resolveEmbedding();
        if (!note) continue;
        if (note.deletedAt) await ragStore.removeNoteIndex({ id });
        else if (embedding) await ragStore.indexNote({ note, embedding: embeddingWithShutdownSignal(embedding), force });
        else continue;
        state.completed += 1;
      } catch (error) {
        state.failed += 1;
        state.lastError = error.message;
      }
    }
    running = false;
    idleResolve?.();
  }

  function scheduleDrain() {
    if (scheduled || running || pending.size === 0) return;
    scheduled = true;
    idle = new Promise((resolve) => { idleResolve = resolve; });
    setImmediate(() => {
      if (pending.size) void drain();
      else { scheduled = false; idleResolve?.(); }
    });
  }

  function enqueue(note, force = false) {
    if (closed || !accepting || (!note.deletedAt && !resolveEmbedding())) return;
    pending.set(note.id, force || pending.get(note.id) === true);
    scheduleDrain();
  }

  return {
    enqueue,
    rebuild() {
      if (!resolveEmbedding()) return { queued: 0, warning: 'Embedding 未在 PaperQuay 中配置，未启动笔记索引。' };
      state.completed = 0;
      state.failed = 0;
      state.lastError = null;
      const notes = noteStore.eligibleSearchNotes({});
      for (const note of notes) enqueue(note, true);
      return { queued: notes.length };
    },
    status: () => ({ ...state, pending: pending.size, running: scheduled || running }),
    whenIdle: () => idle,
    /**
     * Stop accepting new work and wait for the queued note indexing to finish.
     * Returns a summary instead of throwing so the quit path can always proceed.
     */
    async closeWhenIdle({ timeoutMs = 0 } = {}) {
      accepting = false;
      scheduleDrain();
      const isIdle = () => !scheduled && !running && pending.size === 0;
      // Count the job that has already left the queue but is still in flight.
      const outstanding = () => pending.size + (running ? 1 : 0);
      if (isIdle()) {
        return { drained: true, timedOut: false, pending: 0 };
      }
      const waiting = idle;
      if (!(Number(timeoutMs) > 0)) {
        await waiting;
        return { drained: isIdle(), timedOut: false, pending: outstanding() };
      }
      let timer;
      const timedOut = await Promise.race([
        waiting.then(() => false),
        new Promise((resolve) => { timer = setTimeout(() => resolve(true), timeoutMs); timer.unref?.(); }),
      ]);
      clearTimeout(timer);
      if (timedOut) {
        // 停止等待后取消在途请求，避免退出流程一直占着网络/worker 资源。
        shutdownAbort.abort();
      }
      return { drained: isIdle(), timedOut, pending: outstanding() };
    },
    close() {
      closed = true;
      accepting = false;
      pending.clear();
      shutdownAbort.abort();
      if (!scheduled && !running) idleResolve?.();
    },
  };
}

module.exports = { resolveNoteEmbedding, noteModelKey, indexNote, createNoteIndexer };

// MCP writes close their noteStore immediately. Index snapshots without retaining
// that connection; close the single per-directory worker when the queue drains.
const externalQueues = new Map();
function enqueueExternalNote(appPaths, note) {
  if (!note.deletedAt && !resolveNoteEmbedding(appPaths)) return;
  let queue = externalQueues.get(appPaths.ragDatabasePath);
  if (!queue) {
    queue = new Map();
    externalQueues.set(appPaths.ragDatabasePath, queue);
    setImmediate(async () => {
      const { createRagWorkerStore } = require('./ragWorkerHost.cjs');
      let worker;
      try {
        worker = createRagWorkerStore(appPaths);
        while (queue.size) {
          const [id, snapshot] = queue.entries().next().value;
          queue.delete(id);
          const { createNoteStore } = require('./noteStore.cjs');
          const notes = createNoteStore(appPaths);
          let latest;
          try { latest = notes.getNote({ id, includeDeleted: true }); }
          finally { notes.close(); }
          const embedding = resolveNoteEmbedding(appPaths);
          if (!latest) latest = snapshot;
          if (!latest.deletedAt && !embedding) continue;
          try {
            if (latest.deletedAt) await worker.removeNoteIndex({ id });
            else await worker.indexNote({ note: latest, embedding });
          }
          catch (error) { console.warn('[paperquay] MCP note indexing failed.', error.message); }
        }
      } catch (error) {
        console.warn('[paperquay] MCP note worker unavailable.', error.message);
      } finally {
        externalQueues.delete(appPaths.ragDatabasePath);
        if (worker) {
          try { await worker.close(); }
          catch (error) { console.warn('[paperquay] MCP note worker close failed.', error.message); }
        }
      }
    });
  }
  queue.set(note.id, note);
}
module.exports.enqueueExternalNote = enqueueExternalNote;
