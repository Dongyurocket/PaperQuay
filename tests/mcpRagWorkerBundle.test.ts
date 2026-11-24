import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const { bundleMcp } = require('../scripts/bundle-mcp.cjs');

/**
 * D3-2：安装版布局里 MCP 的 ragWorkerHost 以 `__dirname/ragWorker.cjs` 启动 worker。
 * 这里用 bundleMcp 生成与打包完全一致的目录，再从该目录启动 worker，
 * 证明 worker 是自包含的（不缺 ragStore/noteEmbedding 依赖），且能打开 RAG 库。
 */

let scratchCounter = 0;

function createScratchRoot() {
  for (const base of [path.resolve('.tmp-test'), tmpdir()]) {
    const dir = path.join(base, `paperquay-rag-worker-${process.pid}-${scratchCounter++}`);
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // 换下一个候选目录。
    }
  }
  throw new Error('No writable scratch directory for the rag worker test');
}

function removeScratchRoot(dir) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) return;
    }
  }
}

function callWorker<T = unknown>(worker: Worker, message: { id: number; method: string; args: unknown[] }): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker response timeout: ${JSON.stringify(message)}`)), 10000);
    const onMessage = (reply: { id?: number; ok?: boolean; result?: unknown; error?: string }) => {
      if (reply?.id !== message.id) return;
      clearTimeout(timer);
      worker.off('message', onMessage);
      if (reply.ok) resolve(reply.result as T);
      else reject(new Error(reply.error));
    };
    worker.on('message', onMessage);
    worker.postMessage(message);
  });
}

function startEmbeddingServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const json = JSON.parse(body || '{}');
        const inputs = Array.isArray(json.input) ? json.input : [json.input];
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          data: inputs.map((_, index) => ({
            index,
            embedding: Array.from({ length: 8 }, (__, dimension) => (index + dimension + 1) / 10),
          })),
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 });
    });
  });
}

test('the bundled MCP rag worker indexes a note through the installed layout', async () => {
  const root = createScratchRoot();
  const outDir = path.join(root, 'paperquay-mcp');
  const dataDir = path.join(root, 'data');
  const isolatedRoot = mkdtempSync(path.join(tmpdir(), 'paperquay-rag-worker-isolated-'));
  mkdirSync(dataDir, { recursive: true });
  const { server, port } = await startEmbeddingServer();

  try {
    const bundle = await bundleMcp({ outDir });
    assert.equal(path.resolve(bundle.workerEntry), path.resolve(outDir, 'ragWorker.cjs'));

    // 复制到仓库外的临时目录再启动：worker 只能靠 bundle 自带的 node_modules，
    // 不能回退到仓库根 node_modules 解析 sqlite-vec。
    const isolatedBundleDir = path.join(isolatedRoot, 'paperquay-mcp');
    cpSync(outDir, isolatedBundleDir, { recursive: true });

    const worker = new Worker(path.join(isolatedBundleDir, 'ragWorker.cjs'), {
      workerData: {
        appPaths: { ragDatabasePath: path.join(dataDir, 'rag.db') },
        options: { deferVectorBackfill: true },
      },
    });
    const errors = [];
    worker.on('error', (error) => errors.push(error));

    try {
      const statuses = await callWorker<unknown[]>(worker, { id: 1, method: 'listIndexStatuses', args: [] });
      assert.deepEqual(statuses, [], 'a fresh RAG database has no index statuses');

      const indexed = await callWorker<{ indexed: boolean }>(worker, {
        id: 2,
        method: 'indexNote',
        args: [{
          note: {
            id: 'note-1',
            title: 'Bundled note',
            content: 'vector indexing works from the installed layout',
            contentText: 'vector indexing works from the installed layout',
            tags: [],
            anchors: [],
            updatedAt: 1,
          },
          embedding: {
            baseUrl: `http://127.0.0.1:${port}/v1`,
            model: 'test-embedding',
            apiKey: 'test-key',
            dimensions: 8,
            batchSize: 24,
            timeoutSeconds: 10,
          },
        }],
      });
      assert.deepEqual(indexed, { indexed: true }, 'indexNote must use the bundled embedding/RAG path');

      const documentStatus = await callWorker<{ status?: string } | null>(worker, {
        id: 3,
        method: 'getDocumentIndexStatus',
        args: [{ documentKey: 'note:note-1', sourceType: 'note' }],
      });
      assert.equal(documentStatus?.status, 'ready');

      await callWorker(worker, { id: 4, method: 'close', args: [] });
      assert.deepEqual(errors, []);
    } finally {
      await worker.terminate();
    }
  } finally {
    server.closeAllConnections?.();
    server.close();
    removeScratchRoot(root);
    removeScratchRoot(isolatedRoot);
  }
});
