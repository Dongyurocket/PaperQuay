import {
  taskCenterPercent,
  type BackgroundTask,
  type BackgroundTaskKind,
} from '../services/backgroundTasks.ts';
import {
  documentParseTaskMessage,
  type DocumentParseTask,
} from '../services/documentParseTasks.ts';

export const TASK_CENTER_ERROR_RETENTION_MS = 60_000;

export type TaskCenterKind = 'parse' | BackgroundTaskKind;

export interface TaskCenterEntry {
  id: string;
  kind: TaskCenterKind;
  kindLabel: string;
  detail: string;
  status: 'running' | 'error';
  percent: number | null;
  updatedAt: number;
}

export function taskCenterKindLabel(kind: TaskCenterKind, english: boolean): string {
  if (kind === 'parse') {
    return english ? 'Parse' : '解析';
  }

  if (kind === 'translate') {
    return english ? 'Translate' : '翻译';
  }

  return english ? 'Index' : '索引';
}

export function buildTaskCenterEntries(input: {
  parseTasks: readonly DocumentParseTask[];
  backgroundTasks: readonly BackgroundTask[];
  now: number;
  english: boolean;
}): TaskCenterEntry[] {
  const entries: TaskCenterEntry[] = [];

  for (const task of input.parseTasks) {
    if (!isVisibleStatus(task.status, task.updatedAt, input.now)) {
      continue;
    }

    entries.push({
      id: `parse:${task.documentKey}`,
      kind: 'parse',
      kindLabel: taskCenterKindLabel('parse', input.english),
      detail: documentParseTaskMessage(task, input.english ? 'en-US' : 'zh-CN'),
      status: task.status === 'error' ? 'error' : 'running',
      percent: taskCenterPercent(task.completed, task.total),
      updatedAt: task.updatedAt,
    });
  }

  for (const task of input.backgroundTasks) {
    if (!isVisibleStatus(task.status, task.updatedAt, input.now)) {
      continue;
    }

    const errorDetail = task.error?.trim();
    entries.push({
      id: task.id,
      kind: task.kind,
      kindLabel: taskCenterKindLabel(task.kind, input.english),
      detail: task.status === 'error' && errorDetail ? errorDetail : task.title,
      status: task.status === 'error' ? 'error' : 'running',
      percent: taskCenterPercent(task.completed, task.total),
      updatedAt: task.updatedAt,
    });
  }

  return entries.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

function isVisibleStatus(
  status: string,
  updatedAt: number,
  now: number,
): boolean {
  return status === 'running'
    || (status === 'error' && now - updatedAt < TASK_CENTER_ERROR_RETENTION_MS);
}
