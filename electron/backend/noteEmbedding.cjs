const fs = require('node:fs');
const { embedTexts } = require('./utils.cjs');
const { chunkNote, noteSignature } = require('./noteSearch.cjs');

function resolveNoteEmbedding(appPaths) {
  try {
    const raw = JSON.parse(fs.readFileSync(appPaths.configPath, 'utf8'));
    const settings = raw.settings || {};
    const baseUrl = String(settings.embeddingBaseUrl || '').trim().replace(/\/embeddings\/?$/i, '').replace(/\/+$/, '');
    const model = String(settings.embeddingModel || '').trim();
    const apiKey = String(raw.secrets?.embeddingApiKey || '').trim();
    if (!baseUrl || !model || !apiKey) return null;
    return {
      baseUrl: /\/v\d+$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`, model, apiKey,
      dimensions: Number.isInteger(settings.embeddingDimensions) && settings.embeddingDimensions > 0 ? settings.embeddingDimensions : null,
      timeoutSeconds: Math.max(5, Math.min(600, Number(settings.embeddingRequestTimeoutSeconds) || 60)),
      batchSize: Math.max(1, Math.min(100, Number(settings.embeddingBatchSize) || 24)),
    };
  } catch { return null; }
}

function noteModelKey(config) {
  return `${config.baseUrl}::${config.model}::${config.dimensions ?? 'default'}`;
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
  const state = { completed: 0, failed: 0, lastError: null };
  let idleResolve;
  let idle = Promise.resolve();

  async function drain() {
    scheduled = false;
    running = true;
    while (!closed && pending.size) {
      const [id, force] = pending.entries().next().value;
      pending.delete(id);
      try {
        const note = noteStore.getNote({ id, includeDeleted: true });
        const embedding = resolveEmbedding();
        if (!note) continue;
        if (note.deletedAt) await ragStore.removeNoteIndex({ id });
        else if (embedding) await ragStore.indexNote({ note, embedding, force });
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

  function enqueue(note, force = false) {
    if (closed || (!note.deletedAt && !resolveEmbedding())) return;
    pending.set(note.id, force || pending.get(note.id) === true);
    if (!scheduled && !running) {
      scheduled = true;
      idle = new Promise((resolve) => { idleResolve = resolve; });
      setImmediate(() => { if (!closed) void drain(); else idleResolve?.(); });
    }
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
    close() { closed = true; pending.clear(); },
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
