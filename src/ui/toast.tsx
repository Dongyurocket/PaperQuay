import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { useLocaleText } from '../i18n/uiLanguage';

/**
 * 全应用统一反馈层。
 *
 * 背景：此前成功/失败/进行中提示散落在各 feature 的内联 error/statusMessage 里，
 * 既无法跨面板可见，也没有任何 aria-live 区域供读屏播报。这里提供一套最小实现：
 * 模块级单例 store（供非 React 调用方直接 toast()）+ 一个挂载在 App 的 Toaster。
 *
 * 约定：toast 只用于「一次性、无需用户决策」的反馈；需要用户确认的仍走 ConfirmDialog。
 */

export type ToastTone = 'success' | 'error' | 'info' | 'progress';

export interface ToastInput {
  tone?: ToastTone;
  message: string;
  /** 同一 key 的 toast 会被替换而不是堆叠（长任务的进度更新用）。 */
  key?: string;
  /** 毫秒；0 表示不自动关闭（默认 error 5s、其余 3.2s）。 */
  duration?: number;
  description?: string;
}

export interface ToastItem extends ToastInput {
  id: string;
  tone: ToastTone;
}

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 3200,
  info: 3200,
  error: 5000,
  progress: 0,
};

let toasts: ToastItem[] = [];
let sequence = 0;
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

function subscribe(listener: (items: ToastItem[]) => void) {
  listeners.add(listener);
  listener(toasts);

  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: string) {
  const next = toasts.filter((item) => item.id !== id);

  if (next.length === toasts.length) {
    return;
  }

  toasts = next;
  emit();
}

export function toast(input: ToastInput | string) {
  const normalized: ToastInput = typeof input === 'string' ? { message: input } : input;
  const tone = normalized.tone ?? 'info';
  const item: ToastItem = {
    ...normalized,
    tone,
    id: normalized.key ? `key:${normalized.key}` : `toast:${++sequence}`,
  };

  const existingIndex = toasts.findIndex((entry) => entry.id === item.id);
  toasts = existingIndex >= 0
    ? toasts.map((entry) => (entry.id === item.id ? item : entry))
    : [...toasts, item];
  emit();

  window.setTimeout(() => dismissToast(item.id), normalized.duration ?? DEFAULT_DURATION[tone]);

  return item.id;
}

toast.success = (message: string, options: Omit<ToastInput, 'message' | 'tone'> = {}) =>
  toast({ ...options, message, tone: 'success' });
toast.error = (message: string, options: Omit<ToastInput, 'message' | 'tone'> = {}) =>
  toast({ ...options, message, tone: 'error' });
toast.info = (message: string, options: Omit<ToastInput, 'message' | 'tone'> = {}) =>
  toast({ ...options, message, tone: 'info' });
toast.progress = (message: string, options: Omit<ToastInput, 'message' | 'tone'> = {}) =>
  toast({ ...options, message, tone: 'progress' });

const TONE_ICON = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  progress: Loader2,
} as const;

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-[var(--pq-success-bg)] text-[var(--pq-success)]',
  error: 'border-[var(--pq-error-bg)] text-[var(--pq-danger)]',
  info: 'border-[var(--pq-info-bg)] text-[var(--pq-info)]',
  progress: 'border-[var(--pq-accent-border)] text-[var(--pq-accent)]',
};

export function Toaster() {
  const l = useLocaleText();
  const [items, setItems] = useState<ToastItem[]>(toasts);

  useEffect(() => subscribe(setItems), []);

  const dismiss = useCallback((id: string) => dismissToast(id), []);

  const rendered = useMemo(() => items.slice(-4), [items]);

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      role="region"
      aria-label={l('通知', 'Notifications')}
    >
      {/* 读屏播报区：与视觉 toast 分离，避免频繁 re-render 影响交互。 */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="false">
        {rendered.map((item) => (
          <div key={`sr-${item.id}`}>{item.message}</div>
        ))}
      </div>

      {rendered.map((item) => {
        const Icon = TONE_ICON[item.tone];

        return (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-[var(--pq-radius-md)] border bg-[var(--pq-surface)] px-3 py-2.5 shadow-[var(--pq-shadow-float)]',
              TONE_CLASS[item.tone],
            )}
          >
            <Icon
              className={cn('mt-0.5 h-4 w-4 shrink-0', item.tone === 'progress' && 'animate-spin')}
              strokeWidth={1.9}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-5 text-[var(--pq-text)]">{item.message}</div>
              {item.description ? (
                <div className="mt-0.5 text-xs leading-5 text-[var(--pq-text-muted)]">{item.description}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="pq-icon-button mt-0.5 h-6 w-6 shrink-0"
              aria-label={l('关闭通知', 'Dismiss notification')}
              title={l('关闭', 'Dismiss')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
