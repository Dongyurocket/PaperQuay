import {
  RAG_INDEX_STATUS_UPDATED_EVENT,
  type RagIndexStatusUpdatedDetail,
} from './ragIndexStatus.ts';

/**
 * 跨标签页的轻量任务表，供翻译与 RAG 索引使用。
 * 解析任务仍走 documentParseTasks，由 TaskCenter 合并展示。
 * 不写 localStorage，进程退出后不保留。
 */

export type BackgroundTaskKind = 'translate' | 'rag';
export type BackgroundTaskStatus = 'running' | 'success' | 'error';

export interface BackgroundTask {
  id: string;
  kind: BackgroundTaskKind;
  title: string;
  status: BackgroundTaskStatus;
  completed?: number | null;
  total?: number | null;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface BackgroundTaskUpsert {
  id: string;
  kind: BackgroundTaskKind;
  title: string;
  completed?: number | null;
  total?: number | null;
}

export interface ProgressPublishGate {
  at: number;
  percent: number;
}

export interface BackgroundTaskPublish {
  id: string;
  at: number;
  completed: number | null;
  total: number | null;
}

export const BACKGROUND_PROGRESS_MIN_INTERVAL_MS = 200;
export const BACKGROUND_PROGRESS_MIN_PERCENT_DELTA = 2;
export const BACKGROUND_TASK_ERROR_RETENTION_MS = 60_000;

const tasks = new Map<string, BackgroundTask>();
const listeners = new Set<() => void>();
const errorTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ragInflightSources = new Map<string, Set<string>>();
const publishLog: BackgroundTaskPublish[] = [];
const PUBLISH_LOG_LIMIT = 2_000;

function emit(): void {
  for (const notify of listeners) notify();
}

function clearErrorTimer(id: string): void {
  const timer = errorTimers.get(id);

  if (timer === undefined) {
    return;
  }

  clearTimeout(timer);
  errorTimers.delete(id);
}

function notePublish(task: BackgroundTask): void {
  publishLog.push({
    id: task.id,
    at: task.updatedAt,
    completed: task.completed ?? null,
    total: task.total ?? null,
  });

  if (publishLog.length > PUBLISH_LOG_LIMIT) {
    publishLog.shift();
  }
}

function scheduleErrorRemoval(id: string): void {
  clearErrorTimer(id);
  const timer = setTimeout(() => {
    errorTimers.delete(id);
    const current = tasks.get(id);

    if (!current || current.status !== 'error') {
      return;
    }

    if (Date.now() - current.updatedAt < BACKGROUND_TASK_ERROR_RETENTION_MS) {
      return;
    }

    tasks.delete(id);
    emit();
  }, BACKGROUND_TASK_ERROR_RETENTION_MS);
  errorTimers.set(id, timer);
}

export function shouldPublishBackgroundProgress(
  gate: ProgressPublishGate | null,
  completed: number,
  total: number | null | undefined,
  now: number,
): boolean {
  if (!gate) {
    return true;
  }

  if (now - gate.at >= BACKGROUND_PROGRESS_MIN_INTERVAL_MS) {
    return true;
  }

  if (typeof total === 'number' && total > 0) {
    const percent = (completed / total) * 100;

    if (Math.abs(percent - gate.percent) >= BACKGROUND_PROGRESS_MIN_PERCENT_DELTA) {
      return true;
    }
  }

  return false;
}

export function nextProgressPublishGate(
  completed: number,
  total: number | null | undefined,
  now: number,
): ProgressPublishGate {
  const percent = typeof total === 'number' && total > 0 ? (completed / total) * 100 : 0;
  return { at: now, percent };
}

export function listBackgroundTaskPublishLog(): readonly BackgroundTaskPublish[] {
  return publishLog;
}

export function upsertBackgroundTask(input: BackgroundTaskUpsert): BackgroundTask {
  const current = tasks.get(input.id);
  const now = Date.now();
  const completed = input.completed ?? null;
  const total = input.total ?? null;
  const unchanged = current
    && current.kind === input.kind
    && current.title === input.title
    && current.status === 'running'
    && (current.completed ?? null) === completed
    && (current.total ?? null) === total
    && !current.error;

  if (unchanged && current) {
    return current;
  }

  clearErrorTimer(input.id);
  const next: BackgroundTask = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    status: 'running',
    completed,
    total,
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
  };
  tasks.set(input.id, next);
  notePublish(next);
  emit();
  return next;
}

export function finishBackgroundTask(id: string): BackgroundTask | null {
  const current = tasks.get(id);

  if (!current || current.status !== 'running') {
    return null;
  }

  clearErrorTimer(id);
  const next: BackgroundTask = {
    ...current,
    status: 'success',
    error: undefined,
    updatedAt: Date.now(),
  };
  tasks.set(id, next);
  emit();
  tasks.delete(id);
  emit();
  return next;
}

export function failBackgroundTask(
  id: string,
  error: string,
  seed?: { kind: BackgroundTaskKind; title: string },
): BackgroundTask {
  const current = tasks.get(id);
  const now = Date.now();

  if (current?.status === 'error' && current.error === error) {
    return current;
  }

  const next: BackgroundTask = {
    id,
    kind: current?.kind ?? seed?.kind ?? 'rag',
    title: current?.title ?? seed?.title ?? id,
    status: 'error',
    completed: current?.completed ?? null,
    total: current?.total ?? null,
    error,
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
  };
  tasks.set(id, next);
  scheduleErrorRemoval(id);
  emit();
  return next;
}

export function removeBackgroundTask(id: string): void {
  clearErrorTimer(id);

  if (!tasks.delete(id)) {
    return;
  }

  emit();
}

export function listBackgroundTasks(): BackgroundTask[] {
  return Array.from(tasks.values());
}

export function subscribeBackgroundTasks(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function clearFinishedBackgroundTasks(): void {
  let changed = false;

  for (const [id, task] of tasks) {
    if (task.status === 'running') {
      continue;
    }

    clearErrorTimer(id);
    tasks.delete(id);
    changed = true;
  }

  if (changed) {
    emit();
  }
}

export function translationBackgroundTaskId(documentKey: string): string {
  return `translate:${documentKey}`;
}

export function ragBackgroundTaskId(documentKey: string): string {
  return `rag:${documentKey}`;
}

function ragSourceSet(documentKey: string): Set<string> {
  const existing = ragInflightSources.get(documentKey);

  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  ragInflightSources.set(documentKey, created);
  return created;
}

/**
 * 把 RAG 状态事件收成一条任务。
 * pending 只表示「索引中」，不写 completed/total，避免造出百分比。
 * 同一文献的多个来源用 sourceType 计数，全部结束后才报一次完成。
 */
export function applyRagIndexBackgroundUpdate(detail: RagIndexStatusUpdatedDetail): void {
  const documentKey = detail.documentKey?.trim();

  if (!documentKey || !detail.status) {
    return;
  }

  const id = ragBackgroundTaskId(documentKey);
  const title = detail.title?.trim() || documentKey;
  const sourceType = detail.sourceType?.trim() || '';

  if (detail.status === 'pending') {
    ragSourceSet(documentKey).add(sourceType || 'default');
    upsertBackgroundTask({
      id,
      kind: 'rag',
      title,
      completed: null,
      total: null,
    });
    return;
  }

  if (detail.status === 'ready') {
    const sources = ragInflightSources.get(documentKey);

    if (sources && sourceType) {
      sources.delete(sourceType);
    }

    if (sources && sources.size > 0) {
      return;
    }

    ragInflightSources.delete(documentKey);
    finishBackgroundTask(id);
    return;
  }

  if (detail.status === 'failed') {
    ragInflightSources.delete(documentKey);
    failBackgroundTask(id, detail.error?.trim() || '索引失败', { kind: 'rag', title });
    return;
  }

  ragInflightSources.delete(documentKey);
  removeBackgroundTask(id);
}

export function bindRagIndexBackgroundTasks(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleUpdated = (event: Event) => {
    const detail = (event as CustomEvent<RagIndexStatusUpdatedDetail>).detail;

    if (!detail) {
      return;
    }

    applyRagIndexBackgroundUpdate(detail);
  };

  window.addEventListener(RAG_INDEX_STATUS_UPDATED_EVENT, handleUpdated);
  return () => {
    window.removeEventListener(RAG_INDEX_STATUS_UPDATED_EVENT, handleUpdated);
  };
}

export function resetBackgroundTasksForTests(): void {
  for (const timer of errorTimers.values()) {
    clearTimeout(timer);
  }

  errorTimers.clear();
  tasks.clear();
  ragInflightSources.clear();
  publishLog.length = 0;
  listeners.clear();
}

export function taskCenterPercent(
  completed: number | null | undefined,
  total: number | null | undefined,
): number | null {
  if (
    typeof total !== 'number'
    || !Number.isFinite(total)
    || total <= 0
    || typeof completed !== 'number'
    || !Number.isFinite(completed)
  ) {
    return null;
  }

  return Math.min(100, Math.round((completed / total) * 100));
}
