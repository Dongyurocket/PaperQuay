'use strict';

/**
 * PaperQuay Office 桥：Word 加载项（Office.js 任务窗格）与本地文献库之间的唯一通道。
 *
 * 设计约束（见 docs/plans/2026-09-25-office-addin-citation-plan.md §4）：
 *  - 只监听 127.0.0.1，端口从 23120 起顺序探测（避开 Zotero 的 23119）；
 *  - 每次启动生成随机 Bearer token，写入发现文件 <userData>/PaperQuay/paperquay-office-bridge.json；
 *  - CORS 严格白名单 + `Vary: Origin`，绝不回 `*`；
 *  - 默认只读：唯一写路径是 POST /documents/cited（「本文引用过」），受 allowWriteBack 开关约束；
 *  - 引用格式化复用 src/shared/citation 的 esbuild 产物 electron/generated/citationFormatters.cjs，
 *    与笔记侧、主进程 noteVault 共用同一实现。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const API_VERSION = 1;
const BRIDGE_NAME = 'PaperQuay Office Bridge';
const DEFAULT_PORT = 23120;
const PORT_ATTEMPT_COUNT = 10;
const DISCOVERY_FILE_NAME = 'paperquay-office-bridge.json';
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** POST /papers/batch 单次最多查询的文献数（加载项刷新文档内快照用）。 */
const MAX_BATCH_IDS = 500;
const DEFAULT_ALLOWED_ORIGINS = [
  // 加载项页面的来源：https://localhost:3000 为默认源站，http://localhost:3007 是证书不可用时的回退源站
  // （见 electron/backend/officeAddinHost.cjs），两者都必须放行，否则任务窗格请求会被 403。
  'https://localhost:3000',
  'http://localhost:3000',
  'https://127.0.0.1:3000',
  'http://localhost:3007',
  'http://127.0.0.1:3007',
];
const SORT_FIELDS = new Set(['title', 'year', 'importedAt', 'updatedAt', 'lastReadAt', 'readingProgress']);
const KNOWN_PATHS = new Set([
  '/health',
  '/papers',
  '/papers/batch',
  '/categories',
  '/styles',
  '/citations/render',
  '/documents/cited',
]);

let citationFormattersModule = null;

/** 引用格式化产物（esbuild 生成，勿手改）。缺失时给出可执行的修复提示。 */
function loadCitationFormatters() {
  if (!citationFormattersModule) {
    try {
      citationFormattersModule = require('../generated/citationFormatters.cjs');
    } catch (error) {
      throw new Error(
        `引用格式化产物缺失（electron/generated/citationFormatters.cjs），请先运行 npm run build:citation。原始错误：${error?.message ?? error}`,
      );
    }
    if (typeof citationFormattersModule.renderCitations !== 'function') {
      throw new Error('引用格式化产物不完整，请重新运行 npm run build:citation。');
    }
  }
  return citationFormattersModule;
}

class OfficeBridgeError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'OfficeBridgeError';
    this.code = code;
    this.status = status;
  }
}

const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN_ORIGIN: 403,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  UNKNOWN_PAPER: 404,
  LIBRARY_NOT_READY: 503,
  WRITE_DISABLED: 403,
  BRIDGE_DISABLED: 503,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

function bridgeError(code, message) {
  return new OfficeBridgeError(code, message, ERROR_STATUS[code] ?? 400);
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSettings(raw) {
  const record = raw && typeof raw === 'object' ? raw : {};
  const extraOrigins = Array.isArray(record.allowedOrigins)
    ? record.allowedOrigins.map((origin) => cleanString(origin)).filter(Boolean)
    : [];
  return {
    enabled: record.enabled !== false,
    port: Number.isInteger(record.port) && record.port >= 0 ? record.port : DEFAULT_PORT,
    allowedOrigins: [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins])],
    allowWriteBack: record.allowWriteBack !== false,
  };
}

function isLibraryNotReadyError(error) {
  const message = String(error?.message ?? error);
  return /not open|has been closed|no such table|database is locked/i.test(message);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function toWireAuthor(author) {
  return {
    id: author?.id ?? null,
    name: author?.name ?? '',
    givenName: author?.givenName ?? null,
    familyName: author?.familyName ?? null,
  };
}

/** 只暴露加载项需要的字段：避免把摘要、阅读进度等大字段推给文档界面。 */
function toWirePaper(paper) {
  if (!paper) return null;
  return {
    id: paper.id,
    title: paper.title ?? '',
    titleZh: paper.titleZh ?? null,
    year: paper.year ?? null,
    publication: paper.publication ?? null,
    doi: paper.doi ?? null,
    url: paper.url ?? null,
    itemType: paper.itemType ?? null,
    publisher: paper.publisher ?? null,
    publisherPlace: paper.publisherPlace ?? null,
    institution: paper.institution ?? null,
    reportNumber: paper.reportNumber ?? null,
    volume: paper.volume ?? null,
    issue: paper.issue ?? null,
    pages: paper.pages ?? null,
    isbn: paper.isbn ?? null,
    issn: paper.issn ?? null,
    citation: paper.citation ?? null,
    source: paper.source ?? null,
    authors: Array.isArray(paper.authors) ? paper.authors.map(toWireAuthor) : [],
    tags: Array.isArray(paper.tags) ? paper.tags.map((tag) => tag?.name ?? '').filter(Boolean) : [],
    categoryIds: Array.isArray(paper.categoryIds) ? paper.categoryIds : [],
    attachmentCount: Array.isArray(paper.attachments) ? paper.attachments.length : 0,
    importedAt: paper.importedAt ?? null,
    updatedAt: paper.updatedAt ?? null,
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(bridgeError('PAYLOAD_TOO_LARGE', '请求体超过 1MB 限制。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (error) => reject(error));
  });
}

async function readJsonBody(req) {
  const raw = await readRequestBody(req);
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be a JSON object');
    }
    return parsed;
  } catch (error) {
    throw bridgeError('BAD_REQUEST', `请求体不是合法 JSON 对象：${error?.message ?? error}`);
  }
}

function createOfficeBridge(options = {}) {
  const {
    appPaths,
    store,
    appVersion = '0.0.0',
    logger = console,
  } = options;
  const readSettings =
    typeof options.getSettings === 'function'
      ? options.getSettings
      : () => normalizeSettings(options.settings);

  let server = null;
  let port = null;
  let token = null;
  let startedAt = null;
  let discoveryPath = null;
  let stopPromise = null;
  let exitHookInstalled = false;

  const log = (level, message) => {
    const sink = typeof logger?.[level] === 'function' ? logger[level] : logger?.log;
    if (typeof sink === 'function') sink.call(logger, `[office-bridge] ${message}`);
  };

  function settings() {
    return normalizeSettings(readSettings());
  }

  function tokenMatches(header) {
    const value = cleanString(header);
    if (!value.toLowerCase().startsWith('bearer ')) return false;
    const provided = value.slice(7).trim();
    if (!token || provided.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  }

  function applyCors(req, res, allowedOrigins) {
    const origin = cleanString(req.headers.origin);
    if (!origin) return { origin: null, allowed: true };
    if (!allowedOrigins.includes(origin)) return { origin, allowed: false };
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (cleanString(req.headers['access-control-request-private-network']).toLowerCase() === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    return { origin, allowed: true };
  }

  function sendJson(res, status, payload) {
    const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }

  function sendError(res, error) {
    const code = error instanceof OfficeBridgeError ? error.code : 'INTERNAL';
    const status = error instanceof OfficeBridgeError ? error.status : 500;
    if (code === 'INTERNAL') log('error', `未处理错误：${error?.stack ?? error}`);
    sendJson(res, status, { error: { code, message: String(error?.message ?? error) } });
  }

  function requireAuth(req) {
    if (!tokenMatches(req.headers.authorization)) {
      throw bridgeError('UNAUTHORIZED', '缺少或无效的 Bearer token（请在 PaperQuay 设置中复制最新的连接信息）。');
    }
  }

  function requireLibraryReady() {
    if (!store) throw bridgeError('LIBRARY_NOT_READY', '文献库尚未就绪，请先打开 PaperQuay 主窗口。');
  }

  function wrapLibraryCall(action) {
    requireLibraryReady();
    try {
      return action();
    } catch (error) {
      if (error instanceof OfficeBridgeError) throw error;
      if (isLibraryNotReadyError(error)) {
        throw bridgeError('LIBRARY_NOT_READY', `文献库不可用：${error?.message ?? error}`);
      }
      throw error;
    }
  }

  const routes = {
    'GET /health': (req, res, url) => {
      const activeSettings = settings();
      const authorized = tokenMatches(req.headers.authorization);
      if (cleanString(req.headers.authorization) && !authorized) {
        throw bridgeError('UNAUTHORIZED', 'Bearer token 无效，请重新复制连接信息。');
      }
      sendJson(res, 200, {
        ok: true,
        name: BRIDGE_NAME,
        apiVersion: API_VERSION,
        appVersion,
        port,
        pid: process.pid,
        startedAt,
        authorized,
        authRequired: true,
        capabilities: {
          citations: true,
          styles: loadCitationFormatters().CITATION_STYLE_IDS,
          defaultStyle: loadCitationFormatters().DEFAULT_CITATION_STYLE,
          writeBack: activeSettings.allowWriteBack,
        },
      });
      void url;
    },

    'GET /papers': (req, res, url) => {
      const limit = clampInteger(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
      const offset = clampInteger(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
      const sortByRaw = cleanString(url.searchParams.get('sortBy'));
      const sortDirectionRaw = cleanString(url.searchParams.get('sortDirection')).toLowerCase();
      const request = {
        limit,
        offset,
        search: cleanString(url.searchParams.get('search')),
        categoryId: cleanString(url.searchParams.get('categoryId')),
        tagId: cleanString(url.searchParams.get('tagId')),
        sortBy: SORT_FIELDS.has(sortByRaw) ? sortByRaw : undefined,
        sortDirection: sortDirectionRaw === 'asc' || sortDirectionRaw === 'desc' ? sortDirectionRaw : undefined,
      };
      const result = wrapLibraryCall(() => store.queryPapers(request));
      sendJson(res, 200, {
        papers: (result?.papers ?? []).map(toWirePaper),
        total: result?.total ?? 0,
        offset: result?.offset ?? offset,
        limit: result?.limit ?? limit,
      });
    },

    'GET /papers/:id': (req, res, url, params) => {
      const paperId = cleanString(decodeURIComponent(params.id ?? ''));
      if (!paperId) throw bridgeError('BAD_REQUEST', '缺少文献 id。');
      const paper = wrapLibraryCall(() => store.getPaper(paperId));
      if (!paper) throw bridgeError('UNKNOWN_PAPER', `文献库中不存在 id 为 ${paperId} 的文献。`);
      sendJson(res, 200, { paper: toWirePaper(paper) });
      void url;
    },

    /** 批量取文献（加载项用库里最新数据刷新文档内嵌的条目快照）；库里没有的 id 列进 missing。 */
    'POST /papers/batch': async (req, res) => {
      const body = await readJsonBody(req);
      const rawIds = Array.isArray(body.ids) ? body.ids : null;
      if (!rawIds) throw bridgeError('BAD_REQUEST', '请求需包含 ids 数组。');
      const ids = [...new Set(rawIds.map((id) => cleanString(id)).filter(Boolean))];
      if (ids.length > MAX_BATCH_IDS) {
        throw bridgeError('BAD_REQUEST', `ids 最多 ${MAX_BATCH_IDS} 个（收到 ${ids.length} 个）。`);
      }
      const papers = [];
      const missing = [];
      wrapLibraryCall(() => {
        for (const id of ids) {
          const paper = store.getPaper(id);
          if (paper) papers.push(toWirePaper(paper));
          else missing.push(id);
        }
      });
      sendJson(res, 200, { papers, missing });
    },

    'GET /categories': (req, res) => {
      const categories = wrapLibraryCall(() => store.listCategoriesWithCounts());
      sendJson(res, 200, {
        categories: (categories ?? []).map((category) => ({
          id: category.id,
          name: category.name,
          parentId: category.parentId ?? null,
          paperCount: category.paperCount ?? 0,
          isSystem: Boolean(category.isSystem),
          systemKey: category.systemKey ?? null,
        })),
      });
      void res;
    },

    'GET /styles': (req, res) => {
      const formatters = loadCitationFormatters();
      sendJson(res, 200, {
        defaultStyle: formatters.DEFAULT_CITATION_STYLE,
        styles: formatters.CITATION_STYLES,
      });
    },

    'POST /citations/render': async (req, res) => {
      const body = await readJsonBody(req);
      const formatters = loadCitationFormatters();
      const hasItems = Array.isArray(body.items) && body.items.length > 0;
      const hasGroups = Array.isArray(body.groups) && body.groups.length > 0;
      if (!hasItems && !hasGroups) {
        throw bridgeError('BAD_REQUEST', '请求需包含非空的 items（单组插入）或 groups（全文刷新）。');
      }
      const result = wrapLibraryCall(() =>
        formatters.renderCitations(
          {
            style: body.style,
            locale: body.locale ?? null,
            items: hasItems ? body.items : undefined,
            groups: hasGroups ? body.groups : undefined,
            bibliographyTitle: body.bibliographyTitle ?? null,
            bibliographyOrder: body.bibliographyOrder ?? null,
            punctuation: body.punctuation ?? null,
          },
          (paperId) => store.getPaper(paperId),
        ),
      );
      sendJson(res, 200, result);
      void res;
    },

    'POST /documents/cited': async (req, res) => {
      const activeSettings = settings();
      if (!activeSettings.allowWriteBack) {
        throw bridgeError('WRITE_DISABLED', 'PaperQuay 已关闭「Word 引用回写」，请在设置中开启后重试。');
      }
      const body = await readJsonBody(req);
      const documentId = cleanString(body.documentId);
      const paperIds = Array.isArray(body.paperIds) ? body.paperIds : [];
      if (!documentId) throw bridgeError('BAD_REQUEST', '缺少 documentId。');
      if (paperIds.length === 0) throw bridgeError('BAD_REQUEST', 'paperIds 不能为空。');
      const result = wrapLibraryCall(() =>
        store.recordPaperCitations({
          documentId,
          documentTitle: cleanString(body.documentTitle) || null,
          paperIds,
          citedAt: Number(body.citedAt) || Date.now(),
          source: cleanString(body.source) || 'office-addin',
        }),
      );
      sendJson(res, 200, { ok: true, ...result });
      void res;
    },
  };

  function matchRoute(method, pathname) {
    if (method === 'GET' && pathname === '/papers') return { key: 'GET /papers', params: {} };
    const paperMatch = /^\/papers\/([^/]+)$/.exec(pathname);
    // /papers/batch 是保留路径（仅 POST），不能被 GET /papers/:id 吞掉。
    if (method === 'GET' && paperMatch && pathname !== '/papers/batch') {
      return { key: 'GET /papers/:id', params: { id: paperMatch[1] } };
    }
    const key = `${method} ${pathname}`;
    if (Object.prototype.hasOwnProperty.call(routes, key)) return { key, params: {} };
    return null;
  }

  async function dispatch(req, res, url, { internal }) {
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const route = matchRoute(req.method, pathname);
    if (!route) {
      if (KNOWN_PATHS.has(pathname)) {
        throw bridgeError('METHOD_NOT_ALLOWED', `${req.method} 不被 ${pathname} 支持。`);
      }
      throw bridgeError('NOT_FOUND', `未知端点：${req.method} ${pathname}`);
    }
    // /health 允许匿名探活，但带上了无效 token 时按 401 处理（便于加载项区分「桥没起来」与「token 过期」）。
    // 进程内调用（加载项源站的同源 /api/v1 转发）不走 token：转发层已做 Host/Origin/自定义头校验。
    if (!internal && route.key !== 'GET /health') requireAuth(req);
    await routes[route.key](req, res, url, route.params);
  }

  async function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', `http://127.0.0.1:${port ?? DEFAULT_PORT}`);
    } catch {
      sendError(res, bridgeError('BAD_REQUEST', '请求路径无法解析。'));
      return;
    }

    const activeSettings = settings();
    const cors = applyCors(req, res, activeSettings.allowedOrigins);
    if (!cors.allowed) {
      sendError(res, bridgeError('FORBIDDEN_ORIGIN', `来源 ${cors.origin} 不在 PaperQuay 的 Office 桥白名单中。`));
      return;
    }

    try {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      await dispatch(req, res, url, { internal: false });
    } catch (error) {
      sendError(res, error);
    }
  }

  /**
   * 进程内调用入口（officeAddinHost 的 /api/v1/* 转发）：`pathWithQuery` 是去掉 `/api/v1` 前缀后的路径。
   * 不做 token 与 CORS 校验——调用方必须先完成同源校验（见 officeAddinHost.cjs isTrustedApiRequest）。
   * 桥被关闭时仍可服务（数据只读、同进程），但 enabled=false 时拒绝，尊重用户的开关。
   */
  async function handleInternal(req, res, pathWithQuery) {
    let url;
    try {
      url = new URL(pathWithQuery || '/', 'http://paperquay.internal');
    } catch {
      sendError(res, bridgeError('BAD_REQUEST', '请求路径无法解析。'));
      return;
    }
    try {
      if (!settings().enabled) {
        throw bridgeError('BRIDGE_DISABLED', 'PaperQuay 的 Word 加载项连接已在设置中关闭。');
      }
      await dispatch(req, res, url, { internal: true });
    } catch (error) {
      sendError(res, error);
    }
  }

  function listen(attemptPort) {
    return new Promise((resolve, reject) => {
      const candidate = http.createServer((req, res) => {
        void handleRequest(req, res);
      });
      candidate.on('error', (error) => {
        candidate.removeAllListeners();
        reject(error);
      });
      candidate.listen(attemptPort, '127.0.0.1', () => {
        candidate.removeListener('error', reject);
        resolve(candidate);
      });
    });
  }

  function writeDiscoveryFile() {
    discoveryPath = path.join(appPaths.dataDir, DISCOVERY_FILE_NAME);
    const payload = {
      name: BRIDGE_NAME,
      port,
      token,
      apiVersion: API_VERSION,
      appVersion,
      pid: process.pid,
      startedAt,
      url: `http://127.0.0.1:${port}`,
    };
    fs.mkdirSync(path.dirname(discoveryPath), { recursive: true });
    fs.writeFileSync(discoveryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return discoveryPath;
  }

  function removeDiscoveryFile() {
    if (!discoveryPath) return;
    try {
      const raw = fs.readFileSync(discoveryPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.pid === process.pid && parsed?.port === port) fs.rmSync(discoveryPath, { force: true });
    } catch {
      fs.rmSync(discoveryPath, { force: true });
    }
  }

  async function start() {
    if (server) return { port, token, url: `http://127.0.0.1:${port}` };
    const activeSettings = settings();
    if (!activeSettings.enabled) throw bridgeError('WRITE_DISABLED', 'PaperQuay 的 Office 桥已在设置中关闭。');

    token = crypto.randomBytes(24).toString('hex');
    startedAt = new Date().toISOString();

    const requestedPort = activeSettings.port;
    const attempts = requestedPort === 0
      ? [0]
      : Array.from({ length: PORT_ATTEMPT_COUNT }, (_, index) => requestedPort + index);

    let lastError = null;
    for (const candidatePort of attempts) {
      try {
        server = await listen(candidatePort);
        port = server.address()?.port ?? candidatePort;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.code !== 'EADDRINUSE') break;
        log('warn', `端口 ${candidatePort} 已被占用，尝试下一个。`);
      }
    }

    if (!server) {
      token = null;
      const suffix = lastError?.code ? `（${lastError.code}）` : '';
      throw new Error(
        `Office 桥无法启动：端口 ${attempts[0]}–${attempts[attempts.length - 1]} 均不可用${suffix}。`,
      );
    }

    writeDiscoveryFile();
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      // 退出路径上 stop() 可能来不及 await，这里兜底清掉发现文件，避免加载项指向死端口。
      process.once('exit', () => {
        try {
          removeDiscoveryFile();
        } catch {
          // 退出期异常无需处理。
        }
      });
    }
    log('info', `已启动：http://127.0.0.1:${port}（apiVersion ${API_VERSION}，发现文件 ${discoveryPath}）`);
    return { port, token, url: `http://127.0.0.1:${port}`, discoveryPath };
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (server) {
        const closing = server;
        server = null;
        await new Promise((resolve) => closing.close(() => resolve()));
      }
      removeDiscoveryFile();
      if (port !== null) log('info', `已停止（端口 ${port}）。`);
      port = null;
      token = null;
      startedAt = null;
      stopPromise = null;
    })();
    return stopPromise;
  }

  function getStatus() {
    const activeSettings = settings();
    return {
      running: Boolean(server),
      enabled: activeSettings.enabled,
      port,
      token,
      url: port ? `http://127.0.0.1:${port}` : null,
      apiVersion: API_VERSION,
      appVersion,
      startedAt,
      discoveryPath,
      allowedOrigins: activeSettings.allowedOrigins,
      allowWriteBack: activeSettings.allowWriteBack,
    };
  }

  return { start, stop, getStatus, handleRequest, handleInternal, port: () => port, token: () => token };
}

module.exports = {
  API_VERSION,
  BRIDGE_NAME,
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_PORT,
  DISCOVERY_FILE_NAME,
  PORT_ATTEMPT_COUNT,
  createOfficeBridge,
  normalizeSettings,
};
