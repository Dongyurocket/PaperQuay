import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { useLocaleText } from '../i18n/uiLanguage';

/**
 * 统一浮层原语。
 *
 * 背景：仓库里此前有 11 个文件各自实现 `fixed inset-0` 遮罩，Esc 关闭、焦点陷阱、
 * 背景滚动锁和 aria 语义各处不一致，部分浮层还会把 Tab 焦点漏到背后界面。
 * 这里统一成 Dialog + ConfirmDialog 两层：
 *   - Dialog 负责遮罩、Portal、Esc、焦点陷阱与滚动锁；
 *   - ConfirmDialog 负责「危险/普通确认」的固定版式，替代各 feature 的重复实现。
 *
 * 注意：仅在需要用户决策或输入时使用；一次性反馈走 toast。
 */

const SIZE_CLASS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
} as const;

export type DialogSize = keyof typeof SIZE_CLASS;

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: DialogSize;
  /** 遮罩强度：普通弹窗用 soft，需要强遮挡的设置/预览用 strong。 */
  overlay?: 'soft' | 'strong';
  /** 点击遮罩是否关闭，默认 true；有未保存内容的弹窗应传 false。 */
  dismissOnBackdrop?: boolean;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Dialog({
  open,
  onClose,
  children,
  size = 'md',
  overlay = 'soft',
  dismissOnBackdrop = true,
  labelledBy,
  describedBy,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  // 调用方普遍传入内联 onClose。若直接进依赖数组，父级每次重渲染都会重建监听、
  // 重跑下面的打开副作用并重新聚焦第一个元素——模态里刚 Tab 走的焦点会被打回去。
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }

    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.offsetParent !== null || element === document.activeElement);

    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    // 焦点在面板外（例如刚打开）或越过边界时，循环回面板内，避免 Tab 漏到背景界面。
    if (!panel.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    // 无 DOM 环境（Node 里用 renderToStaticMarkup 合成渲染）不建立副作用。
    if (typeof document === 'undefined') return undefined;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);

    // 打开后把焦点移进面板，键盘用户不必先 Tab 穿过多层界面。
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelector<HTMLElement>(FOCUSABLE);
      (focusable ?? panel).focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [handleKeyDown, open]);

  if (!open) return null;

  const panel = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className={cn(
          'absolute inset-0',
          overlay === 'strong'
            ? 'bg-slate-950/62 backdrop-blur-sm dark:bg-black/70'
            : 'bg-slate-950/28 backdrop-blur-[2px] dark:bg-black/45',
        )}
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn(
          'relative w-full overflow-hidden rounded-[var(--pq-radius-lg)] border border-[var(--pq-border)] bg-[var(--pq-bg-primary)] shadow-[var(--pq-shadow-dialog)] outline-none',
          SIZE_CLASS[size],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );

  // 没有 DOM 时无法建 Portal，退化为内联渲染，保证合成渲染路径仍能拿到面板内容。
  if (typeof document === 'undefined') return panel;

  return createPortal(panel, document.body);
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  danger = false,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const l = useLocaleText();

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      size="md"
      dismissOnBackdrop={!busy}
      labelledBy="pq-confirm-title"
      describedBy="pq-confirm-description"
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
              danger
                ? 'bg-[var(--pq-error-bg)] text-[var(--pq-danger)]'
                : 'bg-[var(--pq-warning-bg)] text-[var(--pq-warning)]',
            )}
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 id="pq-confirm-title" className="text-lg font-semibold text-[var(--pq-text)]">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="pq-icon-button h-8 w-8 shrink-0 disabled:opacity-60"
                aria-label={l('关闭对话框', 'Close dialog')}
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
            <p id="pq-confirm-description" className="mt-2 text-sm leading-6 text-[var(--pq-text-muted)]">
              {description}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pq-button px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'px-4 py-2.5 text-sm disabled:opacity-60',
              danger
                ? 'rounded-2xl bg-[var(--pq-danger)] font-semibold text-white transition hover:opacity-90'
                : 'pq-button-primary',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
