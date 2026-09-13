import type { RagDocumentIndexStatus } from '../types/reader';

/**
 * 本地 RAG 索引状态的纯函数工具：
 * 文献库角标聚合、批量索引候选筛选、管理面板统计都在这里计算，
 * 便于单元测试，也避免在 UI 组件里重复实现。
 */

/** 索引状态发生变化（批量/单篇/自动索引完成）后派发的事件，供各工作区刷新角标。 */
export const RAG_INDEX_STATUS_UPDATED_EVENT = 'paperquay:rag-index-status-updated';

export type RagAggregateStatus = 'ready' | 'pending' | 'failed' | 'none';

/** 同一文献可能有 mineru-markdown / pdf-text 两个来源：任一失败视为失败，否则任一待建视为待建。 */
export function aggregateRagIndexStatus(
  entries: readonly RagDocumentIndexStatus[] | undefined,
): RagAggregateStatus {
  if (!entries || entries.length === 0) {
    return 'none';
  }

  if (entries.some((entry) => entry.status === 'failed')) {
    return 'failed';
  }

  if (entries.every((entry) => entry.status === 'ready')) {
    return 'ready';
  }

  return 'pending';
}

export function groupRagIndexStatuses(
  entries: readonly RagDocumentIndexStatus[],
): Record<string, RagDocumentIndexStatus[]> {
  const grouped: Record<string, RagDocumentIndexStatus[]> = {};

  for (const entry of entries) {
    (grouped[entry.documentKey] ??= []).push(entry);
  }

  return grouped;
}

export interface RagIndexCandidateItem {
  /** rag_indexes.document_key（native-library 文献即 paper id） */
  documentKey: string;
  workspaceId: string;
  title: string;
}

/**
 * 批量手动索引候选：MinerU 已解析、且聚合状态为未建立/待建/失败。
 * onlyFailed 时只取失败项（配合 force 绕过冷却立即重试）。
 */
export function selectRagIndexCandidates<
  T extends RagIndexCandidateItem & { workspaceId: string },
>(input: {
  items: readonly T[];
  mineruParsedByWorkspaceId: Record<string, boolean | undefined>;
  statusByDocumentKey: Record<string, RagDocumentIndexStatus[]>;
  onlyFailed?: boolean;
}): T[] {
  return input.items.filter((item) => {
    if (input.mineruParsedByWorkspaceId[item.workspaceId] !== true) {
      return false;
    }

    const status = aggregateRagIndexStatus(input.statusByDocumentKey[item.documentKey]);

    if (input.onlyFailed) {
      return status === 'failed';
    }

    return status !== 'ready';
  });
}

export interface RagIndexOverview {
  ready: number;
  pending: number;
  failed: number;
  unindexed: number;
}

/** 管理面板统计：在 MinerU 已解析的文献集合上按聚合状态计数。 */
export function summarizeRagIndexOverview(input: {
  items: readonly RagIndexCandidateItem[];
  mineruParsedByWorkspaceId: Record<string, boolean | undefined>;
  statusByDocumentKey: Record<string, RagDocumentIndexStatus[]>;
}): RagIndexOverview {
  const overview: RagIndexOverview = { ready: 0, pending: 0, failed: 0, unindexed: 0 };

  for (const item of input.items) {
    if (input.mineruParsedByWorkspaceId[item.workspaceId] !== true) {
      continue;
    }

    const status = aggregateRagIndexStatus(input.statusByDocumentKey[item.documentKey]);

    if (status === 'ready') overview.ready += 1;
    else if (status === 'failed') overview.failed += 1;
    else if (status === 'pending') overview.pending += 1;
    else overview.unindexed += 1;
  }

  return overview;
}
