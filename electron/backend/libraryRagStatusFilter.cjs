'use strict';

const {
  aggregateRagIndexStatus,
  groupRagIndexStatuses,
} = require('../../src/shared/ragIndexStatus.cjs');

const RAG_STATUS_VALUES = new Set(['ready', 'stale', 'pending', 'failed', 'none']);

function normalizeRagStatus(value) {
  const status = typeof value === 'string' ? value.trim() : '';
  return RAG_STATUS_VALUES.has(status) ? status : null;
}

/**
 * 文献库按 RAG 状态筛选。
 *
 * RAG 状态存放在独立的 paperquay-rag.sqlite，不能与文献库直接 JOIN；
 * 这里把「匹配的 paper id」算出来，再复用现有 paperIds 过滤，避免两库同步。
 *
 * - ragEnabled === false 的文献不参与任何状态筛选（仍由「知识库成员」筛选表达）。
 * - RAG 库不可用时：none 视为所有已加入文献，其余状态为空。
 * - 请求已有 paperIds（例如 MinerU 筛选）时取交集。
 */
function applyRagStatusFilter(request, input = {}) {
  const ragStatus = normalizeRagStatus(request?.ragStatus);
  if (!ragStatus) {
    return request;
  }

  const papers = Array.isArray(input.papers) ? input.papers : [];
  const enabledPapers = papers.filter((paper) => paper && paper.id && paper.ragEnabled !== false);

  let matchingIds;
  if (!input.ragAvailable) {
    matchingIds = ragStatus === 'none' ? enabledPapers.map((paper) => paper.id) : [];
  } else {
    const grouped = groupRagIndexStatuses(
      Array.isArray(input.statuses) ? input.statuses : [],
    );
    const options = input.embeddingModelKey
      ? { embeddingModelKey: input.embeddingModelKey }
      : undefined;

    matchingIds = enabledPapers
      .filter((paper) => aggregateRagIndexStatus(grouped[paper.id], options) === ragStatus)
      .map((paper) => paper.id);
  }

  const restricted = Array.isArray(request.paperIds) ? new Set(request.paperIds) : null;
  const paperIds = restricted
    ? matchingIds.filter((paperId) => restricted.has(paperId))
    : matchingIds;

  return { ...request, paperIds };
}

module.exports = {
  RAG_STATUS_VALUES,
  applyRagStatusFilter,
  normalizeRagStatus,
};
