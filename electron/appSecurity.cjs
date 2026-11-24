/**
 * 应用级安全基线：CSP 与渲染进程权限策略。
 *
 * 渲染层只需要访问自身打包资源、paperquay-pdf / paperquay-pdf-assets 协议、
 * data:/blob: 图片，以及用户配置的远程 PDF 地址；其余网络与权限一律收紧。
 * 注意：Electron 的 file:// 文档不会被 webRequest 拦截，因此 CSP 同时以
 * index.html 的 meta 形式注入（见 vite.config.ts 的 paperquay-csp 插件），
 * webRequest 只负责 dev server 的 http 文档。
 */

const DEFAULT_DEV_SERVER_URL = 'http://127.0.0.1:1420';

const ALLOWED_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-write',
  'clipboard-sanitized-write',
]);

function normalizeDevOrigins(devServerUrl) {
  const raw = typeof devServerUrl === 'string' && devServerUrl.trim()
    ? devServerUrl.trim()
    : DEFAULT_DEV_SERVER_URL;

  try {
    const parsed = new URL(raw);
    const httpOrigin = parsed.origin;
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return {
      httpOrigin,
      wsOrigin: `${wsProtocol}//${parsed.host}`,
    };
  } catch {
    return {
      httpOrigin: DEFAULT_DEV_SERVER_URL,
      wsOrigin: 'ws://127.0.0.1:1420',
    };
  }
}

function buildContentSecurityPolicy({ isDev = false, devServerUrl = '' } = {}) {
  const dev = normalizeDevOrigins(devServerUrl);
  const scriptSources = ["'self'", "'wasm-unsafe-eval'"];
  const connectSources = [
    "'self'",
    'paperquay-pdf:',
    'paperquay-pdf-assets:',
    // 远程 PDF 附件由用户配置，无法枚举具体源；AI/MinerU/Zotero 的请求都在
    // 主进程，渲染层只保留 PDF 直连与开发服务器。
    'https:',
    'http:',
  ];

  if (isDev) {
    // @vitejs/plugin-react 会在 index.html 注入内联 refresh preamble，
    // 开发版必须允许 inline script；生产版保持收紧。
    scriptSources.push("'unsafe-inline'", dev.httpOrigin);
    connectSources.push(dev.httpOrigin, dev.wsOrigin);
  }

  const directives = {
    'default-src': ["'self'"],
    'script-src': scriptSources,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'paperquay-pdf:', 'paperquay-pdf-assets:', 'https:', 'http:'],
    'font-src': ["'self'", 'data:', 'paperquay-pdf-assets:'],
    'connect-src': connectSources,
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

function escapeHtmlAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function injectContentSecurityPolicy(html, policy) {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy)}" />`;
  const existing = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i;

  if (existing.test(html)) {
    return html.replace(existing, tag);
  }

  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n    ${tag}`);
  }

  return `${tag}\n${html}`;
}

function installContentSecurityPolicy(session, options = {}) {
  const policy = buildContentSecurityPolicy(options);
  const webRequest = session?.webRequest;

  if (typeof webRequest?.onHeadersReceived !== 'function') {
    return policy;
  }

  webRequest.onHeadersReceived((details, callback) => {
    if (details?.resourceType !== 'mainFrame') {
      callback({ responseHeaders: details?.responseHeaders ?? {} });
      return;
    }

    const responseHeaders = {};
    for (const [name, value] of Object.entries(details?.responseHeaders || {})) {
      if (name.toLowerCase() === 'content-security-policy') continue;
      responseHeaders[name] = value;
    }
    responseHeaders['Content-Security-Policy'] = [policy];
    callback({ responseHeaders });
  });

  return policy;
}

function isPermissionAllowed(permission) {
  return ALLOWED_PERMISSIONS.has(String(permission ?? ''));
}

function createPermissionHandlers({ isTrustedWebContents, log = console.warn } = {}) {
  function isTrusted(webContents) {
    try {
      return typeof isTrustedWebContents === 'function' && Boolean(isTrustedWebContents(webContents));
    } catch {
      return false;
    }
  }

  function decide(webContents, permission) {
    return isPermissionAllowed(permission) && isTrusted(webContents);
  }

  function logDenied(webContents, permission) {
    try {
      log(`[paperquay] Denied renderer permission request: ${String(permission || 'unknown')}`);
    } catch {}
  }

  return {
    requestHandler(webContents, permission, callback) {
      const allowed = decide(webContents, permission);
      if (!allowed) logDenied(webContents, permission);
      callback(allowed);
    },

    checkHandler(webContents, permission) {
      return decide(webContents, permission);
    },
  };
}

function installPermissionHandlers(session, options = {}) {
  const handlers = createPermissionHandlers(options);

  if (typeof session?.setPermissionRequestHandler === 'function') {
    session.setPermissionRequestHandler(handlers.requestHandler);
  }
  if (typeof session?.setPermissionCheckHandler === 'function') {
    session.setPermissionCheckHandler(handlers.checkHandler);
  }

  return handlers;
}

module.exports = {
  ALLOWED_PERMISSIONS,
  buildContentSecurityPolicy,
  createPermissionHandlers,
  injectContentSecurityPolicy,
  installContentSecurityPolicy,
  installPermissionHandlers,
  isPermissionAllowed,
};
