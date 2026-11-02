import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '../utils/cn';
import { useLocaleText } from '../i18n/uiLanguage';
import {
  bindRagIndexBackgroundTasks,
  listBackgroundTasks,
  subscribeBackgroundTasks,
  type BackgroundTask,
} from '../services/backgroundTasks';
import {
  listDocumentParseTasks,
  subscribeDocumentParseTasks,
} from '../services/documentParseTasks';
import { toast } from './toast';
import { buildTaskCenterEntries } from './taskCenterEntries';

/**
 * 全局长任务条。
 *
 * 解析走 documentParseTasks。翻译与 RAG 走 backgroundTasks。
 * 两者都与阅读标签页解耦，切到文库或笔记后仍能看到。
 * 位置在左下角，避免挡住右下角 toast。
 *
 * 只展示运行中和 60 秒内的失败。成功不占位，由这里各报一次 toast。
 * 进度更新不发 toast。
 */

function terminalMessage(task: BackgroundTask, english: boolean): string {
  const title = task.title;

  if (task.kind === 'translate') {
    if (task.status === 'error') {
      return english ? `Translation failed: ${title}` : `翻译失败：${title}`;
    }

    return english ? `Translation complete: ${title}` : `翻译完成：${title}`;
  }

  if (task.status === 'error') {
    return english ? `Indexing failed: ${title}` : `索引失败：${title}`;
  }

  return english ? `Indexing complete: ${title}` : `索引完成：${title}`;
}

export function TaskCenter() {
  const l = useLocaleText();
  const english = l(false, true);
  const [revision, setRevision] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeDocumentParseTasks(() => setRevision((value) => value + 1)), []);

  useEffect(() => {
    const announced = new Set<string>();

    for (const task of listBackgroundTasks()) {
      if (task.status === 'success' || task.status === 'error') {
        announced.add(`${task.id}:${task.status}:${task.updatedAt}`);
      }
    }

    const onBackground = () => {
      for (const task of listBackgroundTasks()) {
        if (task.status !== 'success' && task.status !== 'error') {
          continue;
        }

        const token = `${task.id}:${task.status}:${task.updatedAt}`;

        if (announced.has(token)) {
          continue;
        }

        announced.add(token);
        const message = terminalMessage(task, english);
        const description = task.error?.trim();

        if (task.status === 'success') {
          toast.success(message);
        } else {
          toast.error(message, description && description !== message ? { description } : {});
        }
      }

      setRevision((value) => value + 1);
    };
    const unsubscribe = subscribeBackgroundTasks(onBackground);
    const unbindRag = bindRagIndexBackgroundTasks();

    return () => {
      unsubscribe();
      unbindRag();
    };
  }, [english]);

  const tasks = useMemo(() => {
    void revision;

    return buildTaskCenterEntries({
      parseTasks: listDocumentParseTasks(),
      backgroundTasks: listBackgroundTasks(),
      now: Date.now(),
      english,
    });
  }, [english, revision]);

  if (tasks.length === 0) {
    return null;
  }

  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const failedCount = tasks.length - runningCount;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[190] w-[min(360px,calc(100vw-32px))]">
      <div className="pointer-events-auto overflow-hidden rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] shadow-[var(--pq-shadow-float)]">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[var(--pq-hover)]"
          aria-expanded={!collapsed}
        >
          {runningCount > 0 ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--pq-accent)]" strokeWidth={1.9} />
          ) : (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-[var(--pq-warning)]" strokeWidth={1.9} />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--pq-text)]">
            {runningCount > 0
              ? l(`${runningCount} 个任务进行中`, `${runningCount} task(s) running`)
              : l(`${failedCount} 个任务失败`, `${failedCount} task(s) failed`)}
          </span>
          {collapsed ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[var(--pq-text-faint)]" strokeWidth={1.9} />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--pq-text-faint)]" strokeWidth={1.9} />
          )}
        </button>

        {collapsed ? null : (
          <div className="max-h-[40vh] space-y-1.5 overflow-y-auto border-t border-[var(--pq-border-soft)] px-3 py-2">
            {tasks.map((task) => (
              <div key={task.id} className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 rounded bg-[var(--pq-bg-tertiary)] px-1 text-[11px] leading-4 text-[var(--pq-text-faint)]">
                    {task.kindLabel}
                  </span>
                  <div
                    className={cn(
                      'min-w-0 flex-1 truncate text-[11px] leading-4',
                      task.status === 'error' ? 'text-[var(--pq-danger)]' : 'text-[var(--pq-text-muted)]',
                    )}
                    title={task.detail}
                  >
                    {task.detail}
                  </div>
                  {task.status === 'running' && task.percent !== null ? (
                    <span className="shrink-0 text-[11px] tabular-nums leading-4 text-[var(--pq-text-muted)]">
                      {task.percent}%
                    </span>
                  ) : null}
                  {task.kind === 'rag' && task.status === 'running' && task.percent === null ? (
                    <span className="shrink-0 text-[11px] leading-4 text-[var(--pq-text-faint)]">
                      {l('索引中', 'Indexing')}
                    </span>
                  ) : null}
                </div>
                {task.status === 'running' ? (
                  <div
                    className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--pq-bg-tertiary)]"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={task.percent ?? undefined}
                    aria-label={task.kindLabel}
                  >
                    <div
                      className={cn(
                        'h-full rounded-full bg-[var(--pq-accent)] transition-all duration-300',
                        task.percent === null && 'w-1/3 animate-pulse',
                      )}
                      style={task.percent === null ? undefined : { width: `${task.percent}%` }}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
