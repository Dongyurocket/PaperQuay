const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * IPC 来源校验。抽成独立模块便于单测：主进程只接受「应用自身文档」的
 * 主框架调用，子框架与被导航到 file:// / 远程页面的上下文一律拒绝。
 */

function resolveAppRendererUrl({ isDev, devServerUrl, appDir }) {
  if (isDev) {
    return String(devServerUrl || '');
  }

  return pathToFileURL(path.join(appDir, '..', 'dist', 'index.html')).href;
}

function isTrustedRendererUrl(url, options) {
  const allowed = resolveAppRendererUrl(options);
  if (!allowed || typeof url !== 'string') return false;

  const normalized = allowed.replace(/\/+$/, '');
  return (
    url === allowed ||
    url === normalized ||
    url.startsWith(`${normalized}/`) ||
    url.startsWith(`${allowed}#`) ||
    url.startsWith(`${allowed}?`)
  );
}

/**
 * will-navigate 的放行规则比 IPC 更窄：
 *   - 生产版只允许应用自身的 dist/index.html（可带 query/hash），
 *     不能让整棵 dist/ 或任意 file:// 页面在主窗口加载并继承 preload 能力；
 *   - 开发版仍只信任 dev server 同源页面。
 * URL 解析会规范化 `..`，所以这里比较解析后的 pathname，
 * 而不是原始字符串前缀，避免 `dist/../evil.html` 绕过。
 */
function isTrustedRendererNavigation(url, options) {
  if (!isTrustedRendererUrl(url, options)) return false;

  let candidate;
  let allowed;
  try {
    candidate = new URL(url);
    allowed = new URL(resolveAppRendererUrl(options));
  } catch {
    return false;
  }

  if (candidate.protocol !== 'file:') return true;
  if (allowed.protocol !== 'file:') return false;
  if (candidate.username || candidate.password) return false;
  if (candidate.host && candidate.host !== 'localhost') return false;

  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  return normalize(candidate.pathname) === normalize(allowed.pathname);
}

function createIpcSenderGuard(options) {
  return function assertTrustedIpcSender(event) {
    const frame = event?.senderFrame;

    if (!frame || frame.parent) {
      throw new Error('Blocked IPC from an untrusted frame.');
    }
    if (!isTrustedRendererUrl(frame.url, options)) {
      throw new Error('Blocked IPC from an untrusted document.');
    }
  };
}

module.exports = {
  createIpcSenderGuard,
  isTrustedRendererNavigation,
  isTrustedRendererUrl,
  resolveAppRendererUrl,
};
