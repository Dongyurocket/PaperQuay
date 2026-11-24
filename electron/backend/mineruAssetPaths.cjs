/**
 * MinerU 资源文件的读取边界（主进程与 MCP 共用）。
 *
 * content_list 来自外部解析产物，`image_source.path` 完全不可信。先做字符串
 * 层拒绝（绝对路径、盘符、UNC/设备、ADS、`.`/`..`），再对缓存目录与资产做
 * realpath 包含校验，确保链接/联接不会把读取带出当前文档的缓存目录。
 */

const fs = require('node:fs');
const path = require('node:path');
const { sanitizeMineruAssetReference } = require('../../src/shared/mineruCachePaths.cjs');

function nativeRealpath(fsImpl, target) {
  return fsImpl.realpathSync?.native
    ? fsImpl.realpathSync.native(target)
    : fsImpl.realpathSync(target);
}

function resolveMineruAssetPath(cacheDir, assetPath, { fsImpl = fs } = {}) {
  const rawCacheDir = typeof cacheDir === 'string' ? cacheDir.trim() : '';
  if (!rawCacheDir || rawCacheDir.includes('\0')) {
    return { path: null, reason: 'invalid' };
  }

  // 关键：UNC/ADS/绝对路径必须在任何 fs 调用之前拒绝，否则 realpath 会先
  // 触发一次 SMB 探测。
  const reference = sanitizeMineruAssetReference(assetPath);
  if (!reference) {
    return { path: null, reason: 'invalid' };
  }

  let realCacheDir;
  try {
    realCacheDir = nativeRealpath(fsImpl, rawCacheDir);
  } catch {
    return { path: null, reason: 'invalid' };
  }

  const candidate = path.resolve(realCacheDir, ...reference.split('/'));

  let realAssetPath;
  try {
    realAssetPath = nativeRealpath(fsImpl, candidate);
  } catch (error) {
    return {
      path: null,
      reason: error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'missing' : 'invalid',
    };
  }

  const relative = path.relative(realCacheDir, realAssetPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { path: null, reason: 'invalid' };
  }

  return { path: realAssetPath, reason: '' };
}

module.exports = { resolveMineruAssetPath };
