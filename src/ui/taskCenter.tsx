import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '../utils/cn';
import { useLocaleText } from '../i18n/uiLanguage';
import {
  documentParseTaskMessage,
  listDocumentParseTasks,
  subscribeDocumentParseTasks,
  type DocumentParseTask,
} from '../services/documentParseTasks';

/**
 * 全局长任务条。
 *
 * 此前解析/索引进度只在其所在面板可见，切走标签页就看不到；失败也只能回到原页面发现。
 * 这里订阅既有的 documentParseTasks 注册表（它本身与标签页挂载解耦），在右下角常驻显示
 * 运行中的任务；全部完成后自动收起。
 *
 * 只展示 `running` 与「刚失败」两类：成功属于一次性反馈，应由调用方 toast，而不是长期占用界面。
 */

const STALE_ERROR_WINDOW_MS = 60_000;

export function TaskCenter() {
  const l = useLocaleText();
  const locale = l('zh-CN', 'en-US') as 'zh-CN' | 'en-US';
  const [revision, setRevision] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeDocumentParseTasks(() => setRevision((value) => value + 1)), []);

  const tasks = useMemo<DocumentParseTask[]>(() => {
    void revision;

    return listDocumentParseTasks()
      .filter((task) => task.status === 'running'
        || (task.status === 'error' && Date.now() - task.updatedAt < STALE_ERROR_WINDOW_MS))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [revision]);

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
            {tasks.map((task) => {
              const percent = task.total && task.total > 0 && typeof task.completed === 'number'
                ? Math.min(100, Math.round((task.completed / task.total) * 100))
                : null;

              return (
                <div key={task.documentKey} className="min-w-0">
                  <div
                    className={cn(
                      'truncate text-[11px] leading-4',
                      task.status === 'error' ? 'text-[var(--pq-danger)]' : 'text-[var(--pq-text-muted)]',
                    )}
                    title={documentParseTaskMessage(task, locale)}
                  >
                    {documentParseTaskMessage(task, locale)}
                  </div>
                  {task.status === 'running' ? (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--pq-bg-tertiary)]">
                      <div
                        className={cn(
                          'h-full rounded-full bg-[var(--pq-accent)] transition-all duration-300',
                          percent === null && 'w-1/3 animate-pulse',
                        )}
                        style={percent === null ? undefined : { width: `${percent}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
