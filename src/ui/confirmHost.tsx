import { useEffect, useState } from 'react';
import { ConfirmDialog } from './dialog';
import { useLocaleText } from '../i18n/uiLanguage';

/**
 * 命令式确认框宿主。
 *
 * 背景：仓库里有 6 处 `window.confirm`，原生对话框既不受主题控制、样式与产品不一致，
 * 也无法在 Electron 里保证焦点归还。这里用一个单例 + Promise 的方式提供
 * `confirmAction()`，由挂在 App 的 ConfirmHost 渲染共享的 ConfirmDialog。
 *
 * 用法：
 *   if (!(await confirmAction({ title: '删除文献', description: '...', danger: true }))) return;
 *
 * 注意：这是「需要用户决策」的场景；一次性反馈请用 toast()。
 */

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

let pending: PendingConfirm | null = null;
const listeners = new Set<(value: PendingConfirm | null) => void>();

function setPending(next: PendingConfirm | null) {
  pending = next;
  for (const listener of listeners) listener(next);
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  // 同一时刻只允许一个确认框：后到的请求结束前一个（按取消处理），避免叠层。
  if (pending) {
    pending.resolve(false);
    setPending(null);
  }

  return new Promise<boolean>((resolve) => {
    setPending({ options, resolve });
  });
}

export function ConfirmHost() {
  const l = useLocaleText();
  const [current, setCurrent] = useState<PendingConfirm | null>(pending);

  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(pending);

    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  const settle = (confirmed: boolean) => {
    const active = pending;

    if (!active) return;

    setPending(null);
    active.resolve(confirmed);
  };

  if (!current) return null;

  return (
    <ConfirmDialog
      open
      title={current.options.title}
      description={current.options.description}
      confirmLabel={current.options.confirmLabel ?? l('确认', 'Confirm')}
      cancelLabel={current.options.cancelLabel ?? l('取消', 'Cancel')}
      danger={current.options.danger}
      // 共享确认框本身不承载加载态：调用方在确认后才进入 busy，因此这里始终可点。
      busy={false}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
    />
  );
}
