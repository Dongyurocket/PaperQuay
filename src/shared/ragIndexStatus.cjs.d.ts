export type RagAggregateStatus =
  | 'ready'
  | 'stale'
  | 'pending'
  | 'failed'
  | 'none'
  | 'excluded';

export interface RagIndexStatusRow {
  documentKey: string;
  sourceType: string;
  status: 'pending' | 'ready' | 'failed' | string;
  embeddingModelKey?: string | null;
  extractorVersion?: string | null;
}

export interface RagAggregateOptions {
  /** 当前配置的 embedding 模型；模型不一致的 ready 索引同样视为待更新。 */
  embeddingModelKey?: string;
}

export function isRagIndexStale(
  entry: RagIndexStatusRow,
  options?: RagAggregateOptions,
): boolean;

export function aggregateRagIndexStatus(
  entries: readonly RagIndexStatusRow[] | undefined,
  options?: RagAggregateOptions,
): RagAggregateStatus;

export function groupRagIndexStatuses<T extends RagIndexStatusRow>(
  entries: readonly T[] | undefined,
): Record<string, T[]>;
