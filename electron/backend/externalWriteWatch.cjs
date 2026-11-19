const fs = require('node:fs');
const { MARKER_FILE, externalWriteRevisions, readExternalWriteMarker } = require('./externalWriteMarker.cjs');

/**
 * 监听外部写入标记并广播变化。
 *
 * 监听数据目录而不是标记文件本身：MCP 用临时文件 + rename 原子替换标记，
 * 直接 watch 文件在 Windows 上会在替换后失效。目录 watch 配合文件名过滤即可，
 * 且数据库 WAL 等噪声事件不会触发广播。
 */
function createExternalWriteWatcher({ dataDir, onChange }) {
  let watcher = null;
  let retryTimer = null;
  let closed = false;
  let lastRevisions = externalWriteRevisions(readExternalWriteMarker(dataDir).state);

  const readRevisions = () => externalWriteRevisions(readExternalWriteMarker(dataDir).state);

  const check = () => {
    if (closed) return;
    const next = readRevisions();
    for (const scope of ['library', 'notes']) {
      if (next[scope] !== lastRevisions[scope]) {
        const payload = {
          scope,
          revision: next[scope],
          previousRevision: lastRevisions[scope],
          at: Date.now(),
        };
        lastRevisions = { ...lastRevisions, [scope]: next[scope] };
        try {
          onChange?.(payload);
        } catch (error) {
          console.error('[PaperQuay] external write notification failed:', error);
        }
      } else {
        lastRevisions[scope] = next[scope];
      }
    }
  };

  const attach = () => {
    if (closed || watcher) return;
    try {
      watcher = fs.watch(dataDir, { persistent: false }, (_eventType, filename) => {
        if (!filename || String(filename) === MARKER_FILE) check();
      });
      watcher.on('error', () => {
        detach();
        scheduleRetry();
      });
    } catch {
      scheduleRetry();
    }
  };

  const scheduleRetry = () => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attach();
    }, 2000);
    retryTimer.unref?.();
  };

  const detach = () => {
    if (!watcher) return;
    try {
      watcher.close();
    } catch {}
    watcher = null;
  };

  fs.mkdirSync(dataDir, { recursive: true });
  attach();

  return {
    check,
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      detach();
    },
  };
}

module.exports = { createExternalWriteWatcher };
