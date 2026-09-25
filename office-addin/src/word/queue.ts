/**
 * 文档操作串行队列：所有写文档的动作排队执行，避免两个 Word.run 批次交错（例如自动刷新与
 * 用户点击插入同时发生时，一个在读控件集合、另一个在改 tag）。
 */
export interface TaskQueue {
  run<T>(label: string, task: () => Promise<T>): Promise<T>;
  busy(): string | null;
  onChange(listener: (label: string | null) => void): void;
}

export function createTaskQueue(): TaskQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let active: string | null = null;
  let pending = 0;
  const listeners: Array<(label: string | null) => void> = [];

  function notify(): void {
    for (const listener of listeners) listener(active);
  }

  return {
    run<T>(label: string, task: () => Promise<T>): Promise<T> {
      pending += 1;
      const next = tail.then(
        async () => {
          active = label;
          notify();
          try {
            return await task();
          } finally {
            pending -= 1;
            active = pending > 0 ? active : null;
            notify();
          }
        },
      );
      // 前一个任务失败不能阻塞后续任务。
      tail = next.catch(() => undefined);
      return next;
    },
    busy: () => active,
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
