'use strict';

const fs = require('node:fs');

/**
 * 知识图谱快照缓存（B8）。
 *
 * 图谱工作区常驻 hidden 挂载，切换工作区、改筛选、重开面板都会重新请求快照；
 * 语义边与引用解析在 1k+ 文献时需要几百毫秒。这里按「数据修订号 + 请求」
 * 缓存最后一次快照：
 *
 * - 修订号来自文献库/笔记库/RAG 库/关系文件/配置文件的 mtime+size；
 * - 渲染层在文献/笔记/RAG 变更事件后显式调用 `knowledge_graph_invalidate_cache`；
 * - TTL 只是兜底，不能依赖它保证一致性。
 *
 * 缓存键使用稳定序列化（对象键排序），避免同一请求因属性顺序不同而漏命中。
 */

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_MAX_ENTRIES = 8;

function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function safeStatSignature(stat) {
  if (!stat) return '0:0';
  return `${Math.trunc(Number(stat.mtimeMs) || 0)}:${Math.trunc(Number(stat.size) || 0)}`;
}

function statSignature(filePath, { statSync = fs.statSync } = {}) {
  try {
    return safeStatSignature(statSync(filePath));
  } catch {
    return 'missing';
  }
}

/**
 * 只读五个数据文件的 mtime/size；RAG 库同时看 -wal，因为 worker 提交后主库
 * mtime 可能滞后。文件不存在不视为错误（新安装或尚未建库）。
 */
function computeGraphRevision(appPaths, { statSync = fs.statSync } = {}) {
  // 只读取已知文件；目录 mtime 会被无关缓存写入干扰，不参与修订。
  const files = [
    appPaths?.libraryDatabasePath,
    appPaths?.libraryDatabasePath ? `${appPaths.libraryDatabasePath}-wal` : '',
    appPaths?.notesDatabasePath,
    appPaths?.notesDatabasePath ? `${appPaths.notesDatabasePath}-wal` : '',
    appPaths?.ragDatabasePath,
    appPaths?.ragDatabasePath ? `${appPaths.ragDatabasePath}-wal` : '',
    appPaths?.configPath,
    appPaths?.dataDir ? `${appPaths.dataDir}/paperquay-knowledge-graph-relations.json` : '',
  ].filter(Boolean);

  return files.map((filePath) => statSignature(filePath, { statSync })).join('|');
}

function createGraphSnapshotCache(options = {}) {
  const ttlMs = Math.max(0, Number(options.ttlMs) || DEFAULT_TTL_MS);
  const maxEntries = Math.max(1, Math.trunc(Number(options.maxEntries) || DEFAULT_MAX_ENTRIES));
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const entries = new Map();
  let generation = 0;
  let hits = 0;
  let misses = 0;

  const purgeExpired = (timestamp) => {
    for (const [key, entry] of entries) {
      if (timestamp - entry.storedAt > ttlMs) entries.delete(key);
    }
  };

  return {
    get(request, revision) {
      const timestamp = now();
      purgeExpired(timestamp);
      const key = `${revision}\u0000${stableStringify(request ?? {})}`;
      const entry = entries.get(key);
      if (!entry) {
        misses += 1;
        return null;
      }
      hits += 1;
      // LRU：命中的条目移到末尾。
      entries.delete(key);
      entries.set(key, entry);
      return entry.snapshot;
    },

    set(request, revision, snapshot) {
      const timestamp = now();
      purgeExpired(timestamp);
      const key = `${revision}\u0000${stableStringify(request ?? {})}`;
      entries.delete(key);
      entries.set(key, { snapshot, storedAt: timestamp });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return snapshot;
    },

    invalidate() {
      generation += 1;
      entries.clear();
    },

    stats() {
      return {
        size: entries.size,
        hits,
        misses,
        generation,
      };
    },
  };
}

module.exports = {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_TTL_MS,
  computeGraphRevision,
  createGraphSnapshotCache,
  stableStringify,
};
