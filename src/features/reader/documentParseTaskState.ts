import type { LiteraturePaperTaskState } from '../../types/library';
import { documentParseTaskMessage, type DocumentParseTask } from '../../services/documentParseTasks.ts';

export function toPaperParseTaskState(task: DocumentParseTask, locale = 'zh-CN'): LiteraturePaperTaskState {
  return { kind: 'mineru', label: locale === 'en-US' ? 'PaddleOCR-VL Parse' : 'PaddleOCR-VL 解析', status: task.status,
    message: documentParseTaskMessage(task, locale), completed: task.completed, total: task.total,
    updatedAt: task.updatedAt };
}

export function shouldShowParseTask(task: DocumentParseTask | undefined, operation: LiteraturePaperTaskState | null | undefined): task is DocumentParseTask {
  if (!task) return false;
  if (task.status === 'running') return true;
  return !operation || operation.updatedAt <= task.updatedAt;
}
