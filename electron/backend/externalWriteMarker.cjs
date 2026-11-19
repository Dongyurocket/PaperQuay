const fs = require('node:fs');
const path = require('node:path');

/**
 * 外部写入标记（MCP / 其他进程 → 桌面应用）。
 *
 * 与 desktopRunMarker 同目录、同思路：只记录"哪个范围被写过、写了几次、什么时候写的"，
 * 不承担锁语义。桌面应用通过 fs.watch 监听它并刷新界面；watch 不可用时退化为
 * 窗口聚焦时读取版本号比对。标记写入使用临时文件 + rename 原子替换。
 */
const MARKER_FILE = '.paperquay-external-writes.json';
const MARKER_VERSION = 1;

const WRITE_SCOPES = ['library', 'notes'];

function externalWriteMarkerPath(dataDir) {
  return path.join(dataDir, MARKER_FILE);
}

function emptyState() {
  return {
    version: MARKER_VERSION,
    library: { revision: 0, updatedAt: null, source: null },
    notes: { revision: 0, updatedAt: null, source: null },
  };
}

function normalizeScope(value) {
  const revision = Number.isSafeInteger(Number(value?.revision)) && Number(value.revision) >= 0
    ? Number(value.revision)
    : 0;
  const updatedAt = Number.isSafeInteger(Number(value?.updatedAt)) && Number(value.updatedAt) > 0
    ? Number(value.updatedAt)
    : null;
  const source = typeof value?.source === 'string' && value.source.trim() ? value.source.trim().slice(0, 120) : null;

  return { revision, updatedAt, source };
}

function readExternalWriteMarker(dataDir) {
  const filePath = externalWriteMarkerPath(dataDir);

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', filePath, state: emptyState() };
    return { status: 'unknown', filePath, state: emptyState() };
  }

  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') {
      return { status: 'unknown', filePath, state: emptyState() };
    }

    return {
      status: 'known',
      filePath,
      state: {
        version: MARKER_VERSION,
        library: normalizeScope(payload.library),
        notes: normalizeScope(payload.notes),
      },
    };
  } catch {
    return { status: 'unknown', filePath, state: emptyState() };
  }
}

function writeExternalWriteState(filePath, state) {
  const payload = JSON.stringify({
    version: MARKER_VERSION,
    ...state,
  });
  const temporaryPath = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, payload, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

/**
 * 记录一次外部写入并返回最新状态。
 * revision 单调递增；即使标记文件被删除，也会从 0 重新开始，桌面端只比较差值。
 */
function recordExternalWrite(dataDir, scope, { source = 'mcp', at = Date.now() } = {}) {
  const normalizedScope = WRITE_SCOPES.includes(scope) ? scope : null;
  if (!normalizedScope) throw new Error(`Unsupported external write scope: ${scope}`);

  const current = readExternalWriteMarker(dataDir);
  const previous = current.state[normalizedScope];
  const nextState = {
    version: MARKER_VERSION,
    ...current.state,
    [normalizedScope]: {
      revision: previous.revision + 1,
      updatedAt: at,
      source: typeof source === 'string' && source.trim() ? source.trim().slice(0, 120) : 'mcp',
    },
  };

  writeExternalWriteState(current.filePath, nextState);
  return nextState;
}

function externalWriteRevisions(state) {
  return {
    library: Number(state?.library?.revision) || 0,
    notes: Number(state?.notes?.revision) || 0,
  };
}

module.exports = {
  MARKER_FILE,
  WRITE_SCOPES,
  externalWriteMarkerPath,
  externalWriteRevisions,
  readExternalWriteMarker,
  recordExternalWrite,
};
