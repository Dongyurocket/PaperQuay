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
  isTrustedRendererUrl,
  resolveAppRendererUrl,
};
