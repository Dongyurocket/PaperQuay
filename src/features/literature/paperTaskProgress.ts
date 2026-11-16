import type {
  LiteraturePaperTaskState,
  LiteraturePaperTaskStatus,
} from '../../types/library';

export interface PaperTaskProgress {
  completed: number;
  total: number | null;
  percent: number;
  countText: string | null;
  indeterminate: boolean;
  showProgressBar: boolean;
}

function nonNegativeInteger(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function positiveInteger(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : null;
}

/**
 * Converts a paper task state into the single progress model used by task cards
 * and the details status bar. An unknown running total is deliberately exposed
 * as indeterminate instead of pretending that the task is half complete.
 */
export function getPaperTaskProgress(
  state: Pick<LiteraturePaperTaskState, 'status' | 'completed' | 'total'>,
): PaperTaskProgress {
  const completed = nonNegativeInteger(state.completed);
  const knownTotal = positiveInteger(state.total);
  const displayTotal =
    state.status === 'success' && knownTotal === null && completed > 0
      ? completed
      : knownTotal;

  const countText = displayTotal === null ? null : `${completed}/${displayTotal}`;

  if (state.status === 'success') {
    return {
      completed,
      total: displayTotal,
      percent: 100,
      countText,
      indeterminate: false,
      showProgressBar: true,
    };
  }

  if (state.status === 'running' && knownTotal === null) {
    return {
      completed,
      total: null,
      percent: 45,
      countText: null,
      indeterminate: true,
      showProgressBar: true,
    };
  }

  if (state.status === 'error' && knownTotal === null) {
    return {
      completed,
      total: null,
      percent: 0,
      countText: completed > 0 ? `${completed}/?` : null,
      indeterminate: false,
      showProgressBar: false,
    };
  }

  const percent = knownTotal === null
    ? completed > 0
      ? 100
      : 0
    : Math.min(100, Math.max(0, (completed / knownTotal) * 100));

  return {
    completed,
    total: knownTotal,
    percent,
    countText,
    indeterminate: false,
    showProgressBar: true,
  };
}

export interface CachedTranslationTask {
  status: Extract<LiteraturePaperTaskStatus, 'success'>;
  completed: number;
  total: number;
  message: string;
}

export function buildCachedTranslationTask({
  count,
  total,
  l,
}: {
  count: number;
  total?: number | null;
  l: (zh: string, en: string) => string;
}): CachedTranslationTask {
  const completed = nonNegativeInteger(count);
  const resolvedTotal = positiveInteger(total) ?? Math.max(1, completed);

  return {
    status: 'success',
    completed,
    total: resolvedTotal,
    message: l(
      `全文翻译已完成（缓存），${completed} 段`,
      `Full translation complete (cached): ${completed} blocks`,
    ),
  };
}
