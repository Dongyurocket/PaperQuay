import { emitNativePaperUpdated } from '../features/literature/libraryEvents';
import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import type { LiteraturePaper } from '../types/library';
import {
  failBackgroundTask,
  finishBackgroundTask,
  removeBackgroundTask,
  upsertBackgroundTask,
} from './backgroundTasks';

export const RETAINPDF_TRANSLATION_EVENT = 'paperquay://retainpdf-translation';

export interface RetainPdfConfigSummary {
  provider: 'paddle' | 'mineru';
  model: string;
  baseUrl: string;
  ready: boolean;
  missing: string[];
  configPath: string;
}

export interface RetainPdfProgress {
  current: number | null;
  total: number | null;
  percent: number | null;
}

export interface RetainPdfJob {
  paperId: string;
  paperTitle: string;
  jobId: string;
  status: string;
  stage: string;
  stageDetail: string;
  progress: RetainPdfProgress | null;
  error: string;
  createdAt: number;
  updatedAt: number;
  attachmentId: string;
  pageCountMismatch: { original: number; translated: number } | null;
}

export interface RetainPdfStatus {
  installed: boolean;
  running: boolean;
  apiBase: string;
  executablePath: string;
  config: RetainPdfConfigSummary | null;
  jobs: RetainPdfJob[];
}

export interface RetainPdfTranslationEvent {
  phase: 'progress' | 'attached' | 'failed' | 'canceled';
  job: RetainPdfJob;
  paper?: LiteraturePaper;
  pageCountMismatch?: { original: number; translated: number } | null;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
}

export function retainPdfTaskId(paperId: string): string {
  return `retainpdf:${paperId}`;
}

export async function getRetainPdfStatus(): Promise<RetainPdfStatus> {
  try {
    return await invoke<RetainPdfStatus>('retainpdf_get_status');
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 RetainPDF 状态失败'));
  }
}

export async function getRetainPdfTranslation(paperId: string): Promise<RetainPdfJob | null> {
  try {
    return await invoke<RetainPdfJob | null>('retainpdf_get_translation', { paperId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 RetainPDF 任务失败'));
  }
}

export async function startRetainPdfTranslation(paperId: string): Promise<RetainPdfJob> {
  try {
    return await invoke<RetainPdfJob>('retainpdf_start_translation', { paperId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '启动 RetainPDF 翻译失败'));
  }
}

const startInFlight = new Map<string, Promise<RetainPdfJob>>();

/** 同一文献的启动请求合并为一个：详情面板与文献库操作栏共用，避免双启动。 */
export function startRetainPdfTranslationOnce(paperId: string): Promise<RetainPdfJob> {
  const existing = startInFlight.get(paperId);
  if (existing) {
    return existing;
  }
  const pending = startRetainPdfTranslation(paperId).finally(() => {
    startInFlight.delete(paperId);
  });
  startInFlight.set(paperId, pending);
  return pending;
}

export async function cancelRetainPdfTranslation(paperId: string): Promise<RetainPdfJob> {
  try {
    return await invoke<RetainPdfJob>('retainpdf_cancel_translation', { paperId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '取消 RetainPDF 翻译失败'));
  }
}

export function bindRetainPdfBackgroundTasks(): () => void {
  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  listen<RetainPdfTranslationEvent>(RETAINPDF_TRANSLATION_EVENT, ({ payload }) => {
    const job = payload?.job;
    const paperId = job?.paperId?.trim();
    if (!paperId) {
      return;
    }

    const taskId = retainPdfTaskId(paperId);
    const title = job.paperTitle?.trim() || paperId;

    if (payload.phase === 'attached') {
      finishBackgroundTask(taskId);
      if (payload.paper) {
        emitNativePaperUpdated(payload.paper);
      }
      return;
    }

    if (payload.phase === 'failed') {
      failBackgroundTask(taskId, job.error?.trim() || 'RetainPDF 翻译失败', {
        kind: 'translate',
        title,
      });
      return;
    }

    if (payload.phase === 'canceled') {
      removeBackgroundTask(taskId);
      return;
    }

    upsertBackgroundTask({
      id: taskId,
      kind: 'translate',
      title,
      completed: job.progress?.current ?? null,
      total: job.progress?.total ?? null,
    });
  })
    .then((nextUnsubscribe) => {
      if (disposed) {
        nextUnsubscribe();
      } else {
        unsubscribe = nextUnsubscribe;
      }
    })
    .catch(() => {});

  return () => {
    disposed = true;
    unsubscribe?.();
  };
}
