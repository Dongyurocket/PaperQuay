'use strict';

const { remapRendererStorage } = require('./rendererStorageRemap.cjs');

// 恢复完成标记：preload 在每次文档加载时都会同步取回同一份 restore payload；
// 没有标记时，ack 丢失或页面重复加载会反复 clear() localStorage，把用户在恢复后
// 新写的设置一起抹掉。标记按 restoreId 记录，新恢复（新 restoreId）才再次替换。
const RESTORE_MARKER_KEY = 'paperquay-restore-state-v1';

function readMarker(storage) {
  try {
    const raw = storage.getItem(RESTORE_MARKER_KEY);
    if (typeof raw !== 'string' || !raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.restoreId === 'string') return parsed;
  } catch {}
  return null;
}

function markerValue(restoreId, failedKeys) {
  return JSON.stringify({
    restoreId,
    failedKeys: Array.isArray(failedKeys) ? failedKeys.slice(0, 200) : [],
  });
}

/**
 * 把主进程的 restore payload 写入渲染层 localStorage。
 * 返回 { skipped, failedKeys, warnings }；重复加载同一 restoreId 时 skipped=true。
 * 标记只在 clear + 写入完成后落盘，写失败（配额）也会落标记，避免每次加载都清空；
 * clear 本身失败则不落标记，下一次加载仍会重试。
 */
function restoreRendererStorage(storage, payload, { platform = process.platform } = {}) {
  if (!storage || !payload?.restoreId || !payload.state || typeof payload.state !== 'object') return null;

  const completed = readMarker(storage);
  if (completed?.restoreId === payload.restoreId) {
    return {
      skipped: true,
      failedKeys: Array.isArray(completed.failedKeys) ? completed.failedKeys.slice() : [],
      warnings: [],
    };
  }

  const failedKeys = [];
  const warnings = [];
  try {
    const remapped = remapRendererStorage(payload.state, {
      pathMap: payload.pathMap,
      rootMap: payload.rootMap,
      platform,
      hasMineruCache: payload.hasMineruCache === true,
    });
    warnings.push(...remapped.warnings);
    storage.clear();
    for (const [key, value] of Object.entries(remapped.state)) {
      try {
        storage.setItem(key, String(value));
      } catch {
        failedKeys.push(key);
      }
    }
    try {
      storage.setItem(RESTORE_MARKER_KEY, markerValue(payload.restoreId, failedKeys));
    } catch {}
  } catch {
    failedKeys.push('__localStorage_restore__');
  }

  return { skipped: false, failedKeys, warnings };
}

module.exports = { RESTORE_MARKER_KEY, restoreRendererStorage };
