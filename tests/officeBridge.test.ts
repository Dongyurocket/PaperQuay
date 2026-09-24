import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createOfficeBridge, DEFAULT_PORT } = require('../electron/backend/officeBridge.cjs');

interface StubAuthor {
  name: string;
  givenName?: string | null;
  familyName?: string | null;
}

interface StubPaper {
  id: string;
  title: string;
  year?: string | null;
  itemType?: string | null;
  publication?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  publisherPlace?: string | null;
  abstractText?: string;
  authors?: StubAuthor[];
  tags?: Array<{ name: string }>;
  categoryIds?: string[];
  attachments?: unknown[];
}

interface CitationWriteRequest {
  documentId: string;
  documentTitle?: string | null;
  paperIds: string[];
}

interface BridgeResponse {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

function createStubStore(papers: StubPaper[]) {
  const citationWrites: CitationWriteRequest[] = [];

  return {
    citationWrites,
    queryPapers(request: { search?: string; limit?: number; offset?: number } = {}) {
      const search = String(request.search ?? '').trim().toLowerCase();
      const matched = search
        ? papers.filter((paper) => paper.title.toLowerCase().includes(search))
        : papers;
      const offset = Number(request.offset ?? 0);
      const limit = Number(request.limit ?? 50);
      return {
        papers: matched.slice(offset, offset + limit),
        total: matched.length,
        offset,
        limit,
      };
    },
    getPaper(paperId: string) {
      return papers.find((paper) => paper.id === paperId) ?? null;
    },
    listCategoriesWithCounts() {
      return [
        {
          id: 'all',
          name: '全部文献',
          parentId: null,
          sortOrder: 0,
          isSystem: true,
          systemKey: 'all',
          paperCount: papers.length,
        },
      ];
    },
    recordPaperCitations(request: CitationWriteRequest) {
      citationWrites.push(request);
      return { updated: request.paperIds.length, paperIds: request.paperIds, missingPaperIds: [] };
    },
  };
}

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-office-bridge-test-'));
  return { dataDir };
}

const silentLogger = { log() {}, info() {}, warn() {}, error() {} };

const PAPERS: StubPaper[] = [
  {
    id: 'paper-1',
    title: '深度学习综述',
    year: '2021',
    itemType: 'journalArticle',
    publication: '计算机学报',
    volume: '44',
    issue: '3',
    pages: '1-25',
    abstractText: '这段摘要不应出现在桥的响应里。',
    authors: [{ name: '张三' }],
    tags: [{ name: '综述' }],
    categoryIds: ['cat-1'],
    attachments: [{ id: 'att-1' }],
  },
  {
    id: 'paper-2',
    title: 'Attention Is All You Need',
    year: '2017',
    itemType: 'book',
    publisher: 'Curran Associates',
    publisherPlace: 'Red Hook, NY',
    authors: [{ name: 'Ashish Vaswani' }],
  },
];

function createBridge(options: { port?: number; allowWriteBack?: boolean; allowedOrigins?: string[] } = {}) {
  const appPaths = createAppPaths();
  const store = createStubStore(PAPERS);
  const bridge = createOfficeBridge({
    appPaths,
    store,
    appVersion: '9.9.9-test',
    logger: silentLogger,
    settings: {
      enabled: true,
      port: options.port ?? 0,
      allowWriteBack: options.allowWriteBack ?? true,
      allowedOrigins: options.allowedOrigins ?? [],
    },
  });
  return { bridge, store, appPaths };
}

async function startBridge(options: { port?: number; allowWriteBack?: boolean; allowedOrigins?: string[] } = {}) {
  const created = createBridge(options);
  const started = await created.bridge.start();
  return { ...created, baseUrl: `http://127.0.0.1:${started.port}` as string, started };
}

async function call(
  baseUrl: string,
  pathname: string,
  init: { method?: string; token?: string | null; origin?: string | null; body?: unknown } = {},
): Promise<BridgeResponse> {
  const headers: Record<string, string> = {};
  if (init.token !== null) headers.Authorization = `Bearer ${init.token}`;
  if (init.origin) headers.Origin = init.origin;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

test('office bridge: 未运行时不监听端口（start 之前 getStatus 为停止态）', () => {
  const { bridge } = createBridge();
  const status = bridge.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.port, null);
  assert.equal(status.url, null);
});

test('office bridge: /health 允许匿名探活并返回能力与样式清单', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const response = await call(baseUrl, '/health', { token: null });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.apiVersion, 1);
    assert.equal(response.body.appVersion, '9.9.9-test');
    assert.equal(response.body.port, started.port);
    assert.equal(response.body.authorized, false);

    const capabilities = response.body.capabilities as {
      styles: string[];
      defaultStyle: string;
      writeBack: boolean;
    };
    assert.equal(capabilities.defaultStyle, 'gbt7714');
    assert.deepEqual(capabilities.styles, ['gbt7714', 'gbt7714-author-date', 'apa7', 'ieee']);
    assert.equal(capabilities.writeBack, true);
  } finally {
    await bridge.stop();
  }
});

test('office bridge: 错误 token 在 /health 上被识别为 401，其他端点未带 token 一律 401', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const badHealth = await call(baseUrl, '/health', { token: 'not-the-token' });
    assert.equal(badHealth.status, 401);
    assert.equal((badHealth.body.error as { code: string }).code, 'UNAUTHORIZED');

    const noToken = await call(baseUrl, '/papers', { token: null });
    assert.equal(noToken.status, 401);
    assert.equal((noToken.body.error as { code: string }).code, 'UNAUTHORIZED');

    const goodHealth = await call(baseUrl, '/health', { token: started.token });
    assert.equal(goodHealth.status, 200);
    assert.equal(goodHealth.body.authorized, true);
  } finally {
    await bridge.stop();
  }
});

test('office bridge: CORS 只回显白名单来源，且绝不返回 *', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const allowed = await call(baseUrl, '/papers', {
      token: started.token,
      origin: 'https://localhost:3000',
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://localhost:3000');
    assert.match(String(allowed.headers.get('vary')), /Origin/);
    assert.notEqual(allowed.headers.get('access-control-allow-origin'), '*');

    const noOrigin = await call(baseUrl, '/papers', { token: started.token });
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);

    const evildoer = await call(baseUrl, '/papers', {
      token: started.token,
      origin: 'https://evil.example.com',
    });
    assert.equal(evildoer.status, 403);
    assert.equal((evildoer.body.error as { code: string }).code, 'FORBIDDEN_ORIGIN');
    assert.equal(evildoer.headers.get('access-control-allow-origin'), null);
  } finally {
    await bridge.stop();
  }
});

test('office bridge: OPTIONS 预检在白名单来源上返回 204 与允许头', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const response = await fetch(`${baseUrl}/documents/cited`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://localhost:3000');
    assert.match(String(response.headers.get('access-control-allow-headers')), /authorization/);
    assert.match(String(response.headers.get('access-control-allow-methods')), /POST/);
    void started;
  } finally {
    await bridge.stop();
  }
});

test('office bridge: 白名单可通过 allowedOrigins 设置扩展', async () => {
  const { bridge, baseUrl, started } = await startBridge({ allowedOrigins: ['https://myword.example'] });
  try {
    const response = await call(baseUrl, '/papers', {
      token: started.token,
      origin: 'https://myword.example',
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://myword.example');
  } finally {
    await bridge.stop();
  }
});

test('office bridge: /papers 支持检索/分页并裁剪掉摘要等大字段', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const all = await call(baseUrl, '/papers', { token: started.token });
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 2);
    const papers = all.body.papers as Array<Record<string, unknown>>;
    assert.equal(papers.length, 2);
    assert.equal(papers[0].id, 'paper-1');
    assert.equal(papers[0].abstractText, undefined);
    assert.equal(papers[0].publisherPlace, null);
    assert.equal(papers[0].attachmentCount, 1);
    assert.equal(papers[1].publisherPlace, 'Red Hook, NY');
    assert.deepEqual(papers[1].authors, [
      { id: null, name: 'Ashish Vaswani', givenName: null, familyName: null },
    ]);

    const searched = await call(baseUrl, '/papers?search=attention', { token: started.token });
    assert.equal(searched.body.total, 1);
    assert.equal((searched.body.papers as Array<{ id: string }>)[0].id, 'paper-2');

    const paged = await call(baseUrl, '/papers?limit=1&offset=1', { token: started.token });
    assert.equal(paged.body.limit, 1);
    assert.equal(paged.body.offset, 1);
    assert.equal((paged.body.papers as Array<{ id: string }>).length, 1);
    assert.equal((paged.body.papers as Array<{ id: string }>)[0].id, 'paper-2');
  } finally {
    await bridge.stop();
  }
});

test('office bridge: /papers/:id 命中返回文献，未命中返回 UNKNOWN_PAPER', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const found = await call(baseUrl, '/papers/paper-1', { token: started.token });
    assert.equal(found.status, 200);
    assert.equal((found.body.paper as { title: string }).title, '深度学习综述');

    const missing = await call(baseUrl, '/papers/does-not-exist', { token: started.token });
    assert.equal(missing.status, 404);
    assert.equal((missing.body.error as { code: string }).code, 'UNKNOWN_PAPER');
  } finally {
    await bridge.stop();
  }
});

test('office bridge: /categories 与 /styles 返回加载项需要的清单', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const categories = await call(baseUrl, '/categories', { token: started.token });
    assert.equal(categories.status, 200);
    const category = (categories.body.categories as Array<Record<string, unknown>>)[0];
    assert.equal(category.id, 'all');
    assert.equal(category.paperCount, 2);
    assert.equal(category.isSystem, true);

    const styles = await call(baseUrl, '/styles', { token: started.token });
    assert.equal(styles.status, 200);
    assert.equal(styles.body.defaultStyle, 'gbt7714');
    const list = styles.body.styles as Array<{ id: string; label: string; kind: string }>;
    assert.equal(list.length, 4);
    assert.equal(list[0].id, 'gbt7714');
    assert.equal(list[0].kind, 'numeric');
    assert.match(list[0].label, /GB\/T 7714/);
  } finally {
    await bridge.stop();
  }
});

test('office bridge: /citations/render 单组插入输出 GB/T 编号与条目', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const response = await call(baseUrl, '/citations/render', {
      method: 'POST',
      token: started.token,
      body: { style: 'gbt7714', items: [{ paperId: 'paper-1' }] },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.style, 'gbt7714');
    assert.equal(response.body.kind, 'numeric');
    assert.equal(response.body.inline, '[1]');
    assert.equal(response.body.bibliographyTitle, '参考文献');

    const entries = response.body.entries as Array<{ paperId: string; seq: number; text: string; missing: boolean }>;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].paperId, 'paper-1');
    assert.equal(entries[0].seq, 1);
    assert.equal(entries[0].missing, false);
    assert.equal(entries[0].text, '张三. 深度学习综述[J]. 计算机学报, 2021, 44(3): 1-25.');
    assert.equal(response.body.bibliography, `[1] ${entries[0].text}`);
  } finally {
    await bridge.stop();
  }
});

test('office bridge: /citations/render 全文刷新按文档顺序编号且同一文献同号', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const response = await call(baseUrl, '/citations/render', {
      method: 'POST',
      token: started.token,
      body: {
        style: 'gbt7714',
        groups: [
          { citeId: 'aaaa1111', items: [{ paperId: 'paper-2' }] },
          { citeId: 'bbbb2222', items: [{ paperId: 'paper-1' }] },
          { citeId: 'cccc3333', items: [{ paperId: 'paper-2' }] },
        ],
      },
    });
    assert.equal(response.status, 200);
    const groups = response.body.groups as Array<{ citeId: string; inline: string }>;
    assert.deepEqual(
      groups.map((group) => [group.citeId, group.inline]),
      [
        ['aaaa1111', '[1]'],
        ['bbbb2222', '[2]'],
        ['cccc3333', '[1]'],
      ],
    );
    const entries = response.body.entries as Array<{ paperId: string; seq: number; text: string }>;
    assert.deepEqual(entries.map((entry) => [entry.paperId, entry.seq]), [
      ['paper-2', 1],
      ['paper-1', 2],
    ]);
    assert.equal(entries[0].text, 'Ashish Vaswani. Attention Is All You Need[M]. Red Hook, NY: Curran Associates, 2017.');
    assert.match(String(response.body.bibliography), /\[1\] Ashish Vaswani/);
  } finally {
    await bridge.stop();
  }
});

test('office bridge: 连续编号折叠、locator、prefix/suffix 与著者-出版年制', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const numeric = await call(baseUrl, '/citations/render', {
      method: 'POST',
      token: started.token,
      body: {
        style: 'ieee',
        groups: [
          { citeId: 'g1', items: [{ paperId: 'paper-1' }] },
          { citeId: 'g2', items: [{ paperId: 'paper-2' }] },
        ],
      },
    });
    assert.equal((numeric.body.groups as Array<{ inline: string }>)[0].inline, '[1]');
    assert.equal((numeric.body.groups as Array<{ inline: string }>)[1].inline, '[2]');

    const single = await call(baseUrl, '/citations/render', {
      method: 'POST',
      token: started.token,
      body: {
        style: 'gbt7714',
        items: [{ paperId: 'paper-1', locator: '25', prefix: '参见', suffix: '。' }],
      },
    });
    assert.equal(single.body.inline, '参见 [1]25。');

    const authorDate = await call(baseUrl, '/citations/render', {
      method: 'POST',
      token: started.token,
      body: {
        style: 'gbt7714-author-date',
        bibliographyTitle: '参考文献（著者-出版年制）',
        items: [{ paperId: 'paper-1' }],
      },
    });
    assert.equal(authorDate.body.kind, 'author-date');
    assert.equal(authorDate.body.inline, '(张三, 2021)');
    assert.equal(authorDate.body.bibliographyTitle, '参考文献（著者-出版年制）');
    const entries = authorDate.body.entries as Array<{ text: string }>;
    assert.equal(entries[0].text, '张三. 2021. 深度学习综述[J]. 计算机学报, 44(3): 1-25.');
  } finally {
    await bridge.stop();
  }
});

test('office bridge: 已移出库的 paperId 用 label 兜底并列入 missingPaperIds', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const response = await call(baseUrl, '/citations/render', {
      method: 'POST',
      token: started.token,
      body: {
        style: 'gbt7714',
        items: [{ paperId: 'gone-1', label: '被删除的文献' }],
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.inline, '[1]');
    assert.deepEqual(response.body.missingPaperIds, ['gone-1']);
    const entries = response.body.entries as Array<{ text: string; missing: boolean }>;
    assert.equal(entries[0].text, '被删除的文献.');
    assert.equal(entries[0].missing, true);
  } finally {
    await bridge.stop();
  }
});

test('office bridge: /citations/render 缺 items/groups 返回 BAD_REQUEST，非法 JSON 同理', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const empty = await call(baseUrl, '/citations/render', {
      method: 'POST',
      token: started.token,
      body: { style: 'gbt7714' },
    });
    assert.equal(empty.status, 400);
    assert.equal((empty.body.error as { code: string }).code, 'BAD_REQUEST');

    const broken = await fetch(`${baseUrl}/citations/render`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.token}`, 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(broken.status, 400);
    const brokenBody = (await broken.json()) as { error: { code: string } };
    assert.equal(brokenBody.error.code, 'BAD_REQUEST');
  } finally {
    await bridge.stop();
  }
});

test('office bridge: /documents/cited 写入「本文引用过」，关闭开关时返回 WRITE_DISABLED', async () => {
  const allowed = await startBridge();
  try {
    const response = await call(allowed.baseUrl, '/documents/cited', {
      method: 'POST',
      token: allowed.started.token,
      body: { documentId: 'doc-1', documentTitle: '论文.docx', paperIds: ['paper-1', 'paper-2'] },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.updated, 2);
    assert.equal(allowed.store.citationWrites.length, 1);
    assert.equal(allowed.store.citationWrites[0].documentId, 'doc-1');
    assert.equal(allowed.store.citationWrites[0].documentTitle, '论文.docx');

    const noDocument = await call(allowed.baseUrl, '/documents/cited', {
      method: 'POST',
      token: allowed.started.token,
      body: { paperIds: ['paper-1'] },
    });
    assert.equal(noDocument.status, 400);
  } finally {
    await allowed.bridge.stop();
  }

  const disabled = await startBridge({ allowWriteBack: false });
  try {
    const response = await call(disabled.baseUrl, '/documents/cited', {
      method: 'POST',
      token: disabled.started.token,
      body: { documentId: 'doc-1', paperIds: ['paper-1'] },
    });
    assert.equal(response.status, 403);
    assert.equal((response.body.error as { code: string }).code, 'WRITE_DISABLED');
    assert.equal(disabled.store.citationWrites.length, 0);
  } finally {
    await disabled.bridge.stop();
  }
});

test('office bridge: 未知端点 404、已知端点错误方法 405', async () => {
  const { bridge, baseUrl, started } = await startBridge();
  try {
    const unknown = await call(baseUrl, '/nope', { token: started.token });
    assert.equal(unknown.status, 404);
    assert.equal((unknown.body.error as { code: string }).code, 'NOT_FOUND');

    const wrongMethod = await call(baseUrl, '/styles', { method: 'POST', token: started.token, body: {} });
    assert.equal(wrongMethod.status, 405);
    assert.equal((wrongMethod.body.error as { code: string }).code, 'METHOD_NOT_ALLOWED');

    const wrongMethodOnPapers = await call(baseUrl, '/papers', { method: 'POST', token: started.token, body: {} });
    assert.equal(wrongMethodOnPapers.status, 405);
  } finally {
    await bridge.stop();
  }
});

test('office bridge: 文献库不可用时返回 LIBRARY_NOT_READY', async () => {
  const appPaths = createAppPaths();
  const store = createStubStore(PAPERS);
  const broken = { ...store, queryPapers: () => { throw new Error('database is not open'); } };
  const bridge = createOfficeBridge({
    appPaths,
    store: broken,
    logger: silentLogger,
    settings: { enabled: true, port: 0 },
  });
  const started = await bridge.start();
  try {
    const response = await call(`http://127.0.0.1:${started.port}`, '/papers', { token: started.token });
    assert.equal(response.status, 503);
    assert.equal((response.body.error as { code: string }).code, 'LIBRARY_NOT_READY');
  } finally {
    await bridge.stop();
  }
});

test('office bridge: 发现文件写入端口/token，停止后清理', async () => {
  const { bridge, baseUrl, appPaths, started } = await startBridge();
  const discoveryFile = path.join(appPaths.dataDir, 'paperquay-office-bridge.json');
  try {
    assert.equal(existsSync(discoveryFile), true);
    const discovery = JSON.parse(readFileSync(discoveryFile, 'utf8')) as Record<string, unknown>;
    assert.equal(discovery.port, started.port);
    assert.equal(discovery.token, started.token);
    assert.equal(discovery.apiVersion, 1);
    assert.equal(discovery.pid, process.pid);
    assert.equal(discovery.url, `http://127.0.0.1:${started.port}`);
    void baseUrl;
  } finally {
    await bridge.stop();
  }
  assert.equal(existsSync(discoveryFile), false);
});

test('office bridge: 端口被占用时顺延到下一个（默认从 23120 起）', async () => {
  const probe = http.createServer(() => {});
  const occupiedPort = await new Promise<number>((resolve, reject) => {
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });

  const bridge = createOfficeBridge({
    appPaths: createAppPaths(),
    store: createStubStore(PAPERS),
    logger: silentLogger,
    settings: { enabled: true, port: occupiedPort },
  });
  try {
    const started = await bridge.start();
    assert.ok(started.port > occupiedPort, `期望端口顺延，实际 ${started.port}`);
    assert.ok(started.port < occupiedPort + 10);
  } finally {
    await bridge.stop();
    await new Promise((resolve) => probe.close(() => resolve()));
  }
});

test('office bridge: 关闭 enabled 时 start 抛错；默认端口为 23120', async () => {
  assert.equal(DEFAULT_PORT, 23120);

  const appPaths = createAppPaths();
  const bridge = createOfficeBridge({
    appPaths,
    store: createStubStore(PAPERS),
    logger: silentLogger,
    settings: { enabled: false, port: 0 },
  });
  await assert.rejects(() => bridge.start(), /Office 桥已在设置中关闭/);
  assert.equal(existsSync(path.join(appPaths.dataDir, 'paperquay-office-bridge.json')), false);
});

test('office bridge: 发现文件被别的进程改写时停止不会误删', async () => {
  const { bridge, appPaths } = await startBridge();
  const discoveryFile = path.join(appPaths.dataDir, 'paperquay-office-bridge.json');
  writeFileSync(discoveryFile, JSON.stringify({ pid: process.pid + 1, port: 1 }), 'utf8');
  await bridge.stop();
  assert.equal(existsSync(discoveryFile), true);
});
