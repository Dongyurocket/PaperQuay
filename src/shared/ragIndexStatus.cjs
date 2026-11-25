'use strict';

const { MINERU_RAG_EXTRACTOR_VERSION } = require('./ragIndexVersions.cjs');

/**
 * RAG 索引状态的共享纯函数。
 *
 * 渲染进程的角标/候选筛选与主进程的「按 RAG 状态筛选」必须使用同一套判定；
 * 放在 src/shared 下由两边 require，避免两份实现漂移。
 */

function isRagIndexStale(entry, options) {
  if (!entry || entry.status !== 'ready') {
    return false;
  }

  if (
    options?.embeddingModelKey &&
    entry.embeddingModelKey &&
    entry.embeddingModelKey !== options.embeddingModelKey
  ) {
    return true;
  }

  if (
    entry.sourceType === 'mineru-markdown' &&
    (entry.extractorVersion ?? '') !== MINERU_RAG_EXTRACTOR_VERSION
  ) {
    return true;
  }

  return false;
}

/** 同一文献可能有 mineru-markdown / pdf-text 两个来源：任一失败视为失败，否则任一待建视为待建。 */
function aggregateRagIndexStatus(entries, options) {
  if (!entries || entries.length === 0) {
    return 'none';
  }

  if (entries.some((entry) => entry.status === 'failed')) {
    return 'failed';
  }

  if (entries.some((entry) => entry.status === 'pending')) {
    return 'pending';
  }

  if (entries.every((entry) => entry.status === 'ready')) {
    return entries.some((entry) => isRagIndexStale(entry, options)) ? 'stale' : 'ready';
  }

  return 'pending';
}

function groupRagIndexStatuses(entries) {
  const grouped = {};

  for (const entry of entries ?? []) {
    (grouped[entry.documentKey] ??= []).push(entry);
  }

  return grouped;
}

module.exports = {
  aggregateRagIndexStatus,
  groupRagIndexStatuses,
  isRagIndexStale,
};
