/**
 * 加载项同源 API（officeAddinHost 的 /api/v1 → officeBridge.handleInternal）。
 *
 * v2 用它取代「复制端口:令牌」：PaperQuay 运行时加载项自动连接。安全靠三道校验：
 * 自定义头 X-PaperQuay-Client（跨站必须预检，而预检永不放行）、Host 必须是本机、Origin/Sec-Fetch-Site 同源。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createRequestHandler, isTrustedApiRequest } = require('../electron/backend/officeAddinHost.cjs');
const { createOfficeBridge } = require('../electron/backend/officeBridge.cjs');

const addinRoot = path.join(fileURLToPath(new URL('..', import.meta.url)), 'office-addin');

const PAPERS = [
  { id: 'p1', title: '深度学习综述', year: '2021', itemType: 'journalArticle', publication: '计算机学报', authors: [{ name: '张三' }], abstract: '很长的摘要' },
  { id: 'p2', title: 'Attention Is All You Need', year: '2017', itemType: 'conferencePaper', authors: [{ name: 'Ashish Vaswani' }] },
];

function createBridge(settings: Record<string, unknown> = {}) {
  const store = {
    queryPapers: ({ search = '', limit = 50 }: { search?: string; limit?: number }) => {
      const matched = PAPERS.filter((paper) => !search || paper.title.includes(search));
      return { papers: matched.slice(0, limit), total: matched.length, offset: 0, limit };
    },
    getPaper: (id: string) => PAPERS.find((paper) => paper.id === id) ?? null,
    listCategoriesWithCounts: () => [],
    recordPaperCitations: ({ paperIds }: { paperIds: string[] }) => ({ updated: paperIds.length }),
  };
  return createOfficeBridge({
    appPaths: { dataDir: mkdtempSync(path.join(tmpdir(), 'pq-host-')) },
    store,
    appVersion: '9.9.9-test',
    logger: { log() {}, info() {}, warn() {}, error() {} },
    settings: { enabled: true, port: 0, ...settings },
  });
}

async function startHost(bridge: unknown) {
  let port = 0;
  const handler = createRequestHandler(addinRoot, { getBridge: () => bridge, getPort: () => port });
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as { port: number }).port;
  return { server, port };
}

/** 用 node:http 直接发请求（fetch 不允许自定义 Host 头，这里要伪造 Host 做 DNS rebinding 测试）。 */
function send(
  port: number,
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: options.method ?? 'GET',
        headers: {
          Host: `localhost:${port}`,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = text;
          try {
            body = text ? JSON.parse(text) : {};
          } catch {
            body = text;
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body });
        });
      },
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const CLIENT = { 'X-PaperQuay-Client': 'word-addin/test' };

test('同源 API：带自定义头即可免 token 访问桥（自动连接）', async () => {
  const bridge = createBridge();
  const { server, port } = await startHost(bridge);
  try {
    const health = await send(port, '/api/v1/health', { headers: CLIENT });
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.headers['cache-control'], 'no-store');
    assert.equal(health.headers['x-content-type-options'], 'nosniff');

    const papers = await send(port, '/api/v1/papers?search=%E6%B7%B1%E5%BA%A6', { headers: CLIENT });
    assert.equal(papers.status, 200);
    assert.deepEqual(papers.body.papers.map((paper: { id: string }) => paper.id), ['p1']);
    assert.equal('abstract' in papers.body.papers[0], false, '摘要等大字段不下发');

    const sameOrigin = await send(port, '/api/v1/papers/batch', {
      method: 'POST',
      headers: { ...CLIENT, Origin: `https://localhost:${port}`, 'Sec-Fetch-Site': 'same-origin' },
      body: { ids: ['p2', 'gone', 'p1', 'p2'] },
    });
    assert.equal(sameOrigin.status, 200);
    assert.deepEqual(sameOrigin.body.papers.map((paper: { id: string }) => paper.id), ['p2', 'p1']);
    assert.deepEqual(sameOrigin.body.missing, ['gone']);
  } finally {
    server.close();
  }
});

test('同源 API：缺自定义头、伪造 Host、跨站 Origin、Sec-Fetch-Site=cross-site、预检 一律 403', async () => {
  const bridge = createBridge();
  const { server, port } = await startHost(bridge);
  try {
    const noHeader = await send(port, '/api/v1/health');
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.body.error.code, 'FORBIDDEN_ORIGIN');

    const rebinding = await send(port, '/api/v1/health', { headers: { ...CLIENT, Host: `evil.example:${port}` } });
    assert.equal(rebinding.status, 403, 'DNS rebinding：Host 不是本机时拒绝');

    const crossOrigin = await send(port, '/api/v1/papers', { headers: { ...CLIENT, Origin: 'https://evil.example' } });
    assert.equal(crossOrigin.status, 403);

    const nullOrigin = await send(port, '/api/v1/papers', { headers: { ...CLIENT, Origin: 'null' } });
    assert.equal(nullOrigin.status, 403);

    const crossSite = await send(port, '/api/v1/papers', { headers: { ...CLIENT, 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(crossSite.status, 403);

    const preflight = await send(port, '/api/v1/papers', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Headers': 'x-paperquay-client' },
    });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers['access-control-allow-origin'], undefined, '绝不回 CORS 放行头');
    assert.equal(preflight.headers['access-control-allow-headers'], undefined);
  } finally {
    server.close();
  }
});

test('同源 API：桥未就绪返回 503；设置关闭时拒绝；静态资源照常提供且带 nosniff', async () => {
  const offline = await startHost(null);
  try {
    const result = await send(offline.port, '/api/v1/health', { headers: CLIENT });
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'BRIDGE_UNAVAILABLE');
    const page = await send(offline.port, '/taskpane.html');
    assert.equal(page.status, 200);
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
  } finally {
    offline.server.close();
  }

  const disabled = await startHost(createBridge({ enabled: false }));
  try {
    const result = await send(disabled.port, '/api/v1/health', { headers: CLIENT });
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'BRIDGE_DISABLED');
  } finally {
    disabled.server.close();
  }
});

test('isTrustedApiRequest：127.0.0.1 与 localhost 都是本机；默认端口的 Origin 也能正确比较', () => {
  const ok = isTrustedApiRequest({ headers: { 'x-paperquay-client': 'x', host: '127.0.0.1:3000', origin: 'https://localhost:3000' } }, 3000);
  assert.equal(ok.ok, true);
  const wrongPort = isTrustedApiRequest({ headers: { 'x-paperquay-client': 'x', host: 'localhost:3000', origin: 'https://localhost:4000' } }, 3000);
  assert.equal(wrongPort.ok, false);
  const defaultPort = isTrustedApiRequest({ headers: { 'x-paperquay-client': 'x', host: 'localhost:443', origin: 'https://localhost' } }, 443);
  assert.equal(defaultPort.ok, true);
});

test('桥 /papers/batch（token 通道）：参数校验与上限', async () => {
  const bridge = createBridge();
  const started = await bridge.start();
  try {
    const base = `http://127.0.0.1:${started.port}`;
    const headers = { Authorization: `Bearer ${started.token}`, 'Content-Type': 'application/json' };
    const bad = await fetch(`${base}/papers/batch`, { method: 'POST', headers, body: JSON.stringify({}) });
    assert.equal(bad.status, 400);
    const tooMany = await fetch(`${base}/papers/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: Array.from({ length: 501 }, (_, index) => `id-${index}`) }),
    });
    assert.equal(tooMany.status, 400);
    const unauthorized = await fetch(`${base}/papers/batch`, { method: 'POST', body: JSON.stringify({ ids: ['p1'] }) });
    assert.equal(unauthorized.status, 401, '端口直连通道仍要求 token');
    const wrongMethod = await fetch(`${base}/papers/batch`, { headers });
    assert.equal(wrongMethod.status, 405);
  } finally {
    await bridge.stop();
  }
});
