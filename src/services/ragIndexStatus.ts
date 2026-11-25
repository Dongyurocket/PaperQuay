import type { RagDocumentIndexStatus } from '../types/reader';
import type { RagAggregateOptions, RagAggregateStatus } from '../shared/ragIndexStatus.cjs';
import {
  aggregateRagIndexStatus,
  groupRagIndexStatuses,
  isRagIndexStale,
} from '../shared/ragIndexStatus.cjs';

/**
 * 本地 RAG 索引状态的纯函数工具：
 * 文献库角标聚合、批量索引候选筛选、管理面板统计都在这里计算，
 * 便于单元测试，也避免在 UI 组件里重复实现。
 *
 * 聚合/过期判定已移到 src/shared/ragIndexStatus.cjs，与主进程的
 * 「按 RAG 状态筛选」共用同一套实现。
 */

export {
  aggregateRagIndexStatus,
  groupRagIndexStatuses,
  isRagIndexStale,
};
export type { RagAggregateOptions, RagAggregateStatus };

/** 索引状态发生变化（批量/单篇/自动索引完成，或一次索引开始）后派发的事件，供各工作区刷新角标。 */
export const RAG_INDEX_STATUS_UPDATED_EVENT = 'paperquay:rag-index-status-updated';

export interface RagIndexStatusUpdatedDetail {
  documentKey: string;
  /** 缺省表示只刷新角标，不进入全局任务条。成员变更走这条。 */
  status?: RagAggregateStatus;
  title?: string;
  error?: string;
  /** 同一文献的 mineru-markdown / pdf-text 分开计数，避免提前报完成。 */
  sourceType?: string;
}

export function emitRagIndexStatusUpdated(detail: RagIndexStatusUpdatedDetail): void {
  if (typeof window === 'undefined' || !detail.documentKey) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<RagIndexStatusUpdatedDetail>(RAG_INDEX_STATUS_UPDATED_EVENT, { detail }),
  );
}

export interface RagIndexCandidateItem {
  /** rag_indexes.document_key（native-library 文献即 paper id） */
  documentKey: string;
  workspaceId: string;
  title: string;
  /** false 表示已移出本地知识库，不参与自动/批量索引。 */
  ragEnabled?: boolean;
  /** MinerU 是否已解析；缺省按未知处理（不参与候选）。 */
  mineruParsed?: boolean;
}

/**
 * 批量手动索引候选：MinerU 已解析、且聚合状态为未建立/待建/失败。
 * onlyFailed 时只取失败项（配合 force 绕过冷却立即重试）；
 * onlyStale 时只取已索引但过期的文献。
 */
export function selectRagIndexCandidates<
  T extends RagIndexCandidateItem & { workspaceId: string },
>(input: {
  items: readonly T[];
  mineruParsedByWorkspaceId: Record<string, boolean | undefined>;
  statusByDocumentKey: Record<string, RagDocumentIndexStatus[]>;
  aggregateOptions?: RagAggregateOptions;
  onlyFailed?: boolean;
  onlyStale?: boolean;
}): T[] {
  return input.items.filter((item) => {
    if (item.ragEnabled === false) {
      return false;
    }

    const parsed = input.mineruParsedByWorkspaceId[item.workspaceId] ?? item.mineruParsed;

    if (parsed !== true) {
      return false;
    }

    const status = aggregateRagIndexStatus(
      input.statusByDocumentKey[item.documentKey],
      input.aggregateOptions,
    );

    if (input.onlyFailed) {
      return status === 'failed';
    }

    if (input.onlyStale) {
      return status === 'stale';
    }

    return status !== 'ready';
  });
}

export interface RagIndexOverview {
  ready: number;
  stale: number;
  pending: number;
  failed: number;
  unindexed: number;
  excluded: number;
}

/** 管理面板统计：在 MinerU 已解析的文献集合上按聚合状态计数。 */
export function summarizeRagIndexOverview(input: {
  items: readonly RagIndexCandidateItem[];
  mineruParsedByWorkspaceId: Record<string, boolean | undefined>;
  statusByDocumentKey: Record<string, RagDocumentIndexStatus[]>;
  aggregateOptions?: RagAggregateOptions;
}): RagIndexOverview {
  const overview: RagIndexOverview = {
    ready: 0,
    stale: 0,
    pending: 0,
    failed: 0,
    unindexed: 0,
    excluded: 0,
  };

  for (const item of input.items) {
    if (item.ragEnabled === false) {
      overview.excluded += 1;
      continue;
    }

    const parsed = input.mineruParsedByWorkspaceId[item.workspaceId] ?? item.mineruParsed;

    if (parsed !== true) {
      continue;
    }

    const status = aggregateRagIndexStatus(
      input.statusByDocumentKey[item.documentKey],
      input.aggregateOptions,
    );

    if (status === 'ready') overview.ready += 1;
    else if (status === 'stale') overview.stale += 1;
    else if (status === 'failed') overview.failed += 1;
    else if (status === 'pending') overview.pending += 1;
    else overview.unindexed += 1;
  }

  return overview;
}
