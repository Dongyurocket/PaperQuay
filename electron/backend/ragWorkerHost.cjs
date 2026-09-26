const path = require('node:path');
const { Worker } = require('node:worker_threads');

const RAG_WORKER_METHODS = [
  'appendAgentRunEvent',
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
  'snapshotTo',
  'stepVectorBackfill',
  'vectorBackfillStatus',
];

function createRagWorkerStore(appPaths, options = {}) {
  const worker = new Worker(path.join(__dirname, 'ragWorker.cjs'), {
    workerData: { appPaths, options },
  });
  let nextId = 1;
  const pending = new Map();
  let failed = null;

  function failAll(error) {
    failed = error;
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  }

  worker.on('message', (message) => {
    const entry = pending.get(message?.id);
    if (!entry) {
      return;
    }

    pending.delete(message.id);
    if (message.ok) {
      entry.resolve(message.result);
      return;
    }

    entry.reject(new Error(message.error || 'RAG worker call failed'));
  });
  worker.on('error', failAll);
  worker.on('exit', (code) => {
    if (code !== 0) {
      failAll(new Error(`RAG worker exited with code ${code}`));
    }
  });

  function call(method, args) {
    if (failed) {
      return Promise.reject(failed);
    }

    const id = nextId;
    nextId += 1;

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, args });
    });
  }

  const api = {
    available: true,
    execution: 'worker',
  };

  for (const method of RAG_WORKER_METHODS) {
    api[method] = (...args) => call(method, args);
  }

  api.close = async () => {
    try {
      await call('close', []);
    } catch {
      // The worker may already be gone. Terminating it is the cleanup that matters.
    }
    await worker.terminate();
  };

  return api;
}

module.exports = { createRagWorkerStore };
