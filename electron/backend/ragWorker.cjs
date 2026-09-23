const { parentPort, workerData } = require('node:worker_threads');
const { createRagStore } = require('./ragStore.cjs');

if (!parentPort) {
  throw new Error('ragWorker.cjs must run inside a worker thread');
}

const store = createRagStore(workerData.appPaths, workerData.options ?? {});

parentPort.on('message', async (message) => {
  const id = message?.id;
  const method = message?.method;

  try {
    if (method === 'close') {
      store.close();
      parentPort.postMessage({ id, ok: true, result: null });
      return;
    }

    const fn = store[method];
    if (typeof fn !== 'function') {
      throw new Error(`Unknown RAG worker method: ${method}`);
    }

    const result = await Promise.resolve(fn.apply(store, Array.isArray(message.args) ? message.args : []));
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
