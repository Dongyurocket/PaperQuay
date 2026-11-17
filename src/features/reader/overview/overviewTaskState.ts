import type { LiteraturePaperTaskKind, LiteraturePaperTaskState } from '../../../types/library.ts';
import { getPaperTaskProgress } from '../../literature/paperTaskProgress.ts';

export interface OverviewTaskInput {
  operation?: LiteraturePaperTaskState | null;
  loading: boolean;
  translating: boolean;
  summaryLoading: boolean;
  blockCount: number;
  translatedCount: number;
  translationCompleted: number;
  translationTotal: number;
  hasSummary: boolean;
  summaryError?: string;
}

/** Live operations take precedence over cached completion; unrelated operations do not leak. */
export function deriveOverviewTask(kind: LiteraturePaperTaskKind, input: OverviewTaskInput) {
  const operation = input.operation?.kind === kind ? input.operation : null;
  const running = kind === 'mineru' ? input.loading
    : kind === 'translation' ? input.translating : input.summaryLoading;
  const done = kind === 'mineru' ? input.blockCount > 0
    : kind === 'translation' ? input.translatedCount > 0 && input.translatedCount >= input.blockCount
    : input.hasSummary;
  const status = running ? 'running' : operation?.status ??
    (kind === 'overview' && input.summaryError ? 'error' : done ? 'success' : 'idle');
  const completed = operation ? operation.completed : kind === 'translation' ? input.translationCompleted || input.translatedCount : done ? 1 : 0;
  const total = operation ? operation.total : kind === 'translation' ? input.translationTotal || input.blockCount || null : done ? 1 : null;
  return {
    status,
    progress: getPaperTaskProgress({ status: status === 'idle' ? 'error' : status, completed, total }),
    message: operation?.message ?? (kind === 'overview' ? input.summaryError ?? '' : ''),
  };
}

export function shouldReadOverviewCache(sourceKey: string, force = false): boolean {
  return !force && sourceKey.trim().length > 0;
}
