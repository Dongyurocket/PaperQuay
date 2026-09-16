import { invoke } from '../platform/electron/core.ts';
import { listen } from '../platform/electron/event.ts';

export interface DocumentParseTask {
  taskId: string;
  documentKey: string;
  revision: number;
  startedAt: number;
  updatedAt: number;
  status: 'running' | 'success' | 'error';
  stage: string;
  completed?: number;
  total?: number | null;
  error?: string;
  contentJsonPath?: string;
  blockCount?: number;
}

export function acceptDocumentParseTask(previous: DocumentParseTask | undefined, next: DocumentParseTask): boolean {
  return !previous || next.revision > previous.revision;
}

const tasks = new Map<string, DocumentParseTask>();
const listeners = new Set<() => void>();
let connection: Promise<void> | undefined;
function receive(task: DocumentParseTask) {
  if (!acceptDocumentParseTask(tasks.get(task.documentKey), task)) return;
  tasks.set(task.documentKey, task);
  for (const notify of listeners) notify();
}

/** Subscribe before querying/invoking: revision comparison closes the snapshot/event race. */
export function connectDocumentParseTasks(): Promise<void> {
  if (!connection) {
    connection = (async () => {
      const unlisten = await listen<DocumentParseTask>('paperquay://document-parse-progress', ({ payload }) => receive(payload));
      try {
        const snapshot = await invoke<DocumentParseTask[]>('list_paddleocr_parse_tasks');
        snapshot.forEach(receive);
      } catch (error) {
        unlisten();
        throw error;
      }
    })().catch((error) => { connection = undefined; throw error; });
  }
  return connection;
}

export function subscribeDocumentParseTasks(notify: () => void): () => void {
  listeners.add(notify);
  void connectDocumentParseTasks().then(notify).catch(() => undefined);
  return () => { listeners.delete(notify); };
}
export function getDocumentParseTask(documentKey: string) { return tasks.get(documentKey); }

export function reportDocumentParseFailure(
  documentKey: string,
  taskId: string,
  error: unknown,
  startedAt: number,
): void {
  const current = tasks.get(documentKey);
  if (current?.taskId === taskId && current.status !== 'running') return;
  if (current && current.taskId !== taskId
    && (current.status === 'running' || current.startedAt >= startedAt)) return;
  // A local IPC failure must not manufacture a backend revision or replace a newer task.
  tasks.set(documentKey, {
    taskId, documentKey, startedAt,
    revision: current?.revision ?? 0,
    updatedAt: Date.now(), status: 'error', stage: 'error',
    error: error instanceof Error ? error.message : String(error),
  });
  for (const notify of listeners) notify();
}

export function documentParseTaskMessage(task: DocumentParseTask, locale = 'zh-CN'): string {
  const english = locale === 'en-US';
  if (task.status === 'error') return task.error || (english ? 'PaddleOCR-VL parse failed' : 'PaddleOCR-VL 解析失败');
  const stages: Record<string, string> = english ? {
    preparing: 'Preparing document', submitting: 'Submitting cloud task', recognizing: 'Recognizing',
    downloading: 'Downloading results', assets: 'Downloading images', saving: 'Saving results',
    merging: 'Merging parts', done: 'Parse complete',
  } : {
    preparing: '准备文档', submitting: '提交云端任务', recognizing: '云端识别',
    downloading: '下载识别结果', assets: '下载图片资源', saving: '保存解析结果',
    merging: '合并分卷结果', done: '解析已完成',
  };
  const progress = task.total && task.stage !== 'done' ? ` (${task.completed ?? 0}/${task.total})` : '';
  return `PaddleOCR-VL · ${stages[task.stage] || task.stage}${progress}`;
}
