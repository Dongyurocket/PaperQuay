import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils/cn';

/**
 * 统一右键菜单原语。
 *
 * 背景：`components/ContextMenu.tsx` 与 `features/notes/NotesContextMenu.tsx` 曾是两份
 * 逐行相同的实现（props、类型结构、分隔符、高度估算与贴边钳制逻辑完全一致），笔记侧
 * 只是多出了两个文本选择辅助函数。这里合并为唯一实现，两个旧模块改为薄 re-export，
 * 7 个调用点的 import 路径与用法保持不变。
 *
 * 行为约束（与合并前逐条一致，重构时勿改）：
 *   - 点击遮罩、或在遮罩上再次右键，关闭菜单；
 *   - `tone="danger"` 用错误色，`tone="accent"` 用强调色，默认项为弱化文字；
 *   - 超出窗口右下边缘时，按宽度与估算高度钳制回窗口内并留 8px 安全边距；
 *   - 当前实现不含键盘导航与快捷键提示（合并前也没有），如需新增应单独立项。
 */

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'accent' | 'danger';
  onSelect: () => void | Promise<void>;
}

export type MenuEntry = MenuItem | { type: 'separator'; id: string };

interface MenuProps {
  x: number;
  y: number;
  title?: string;
  entries: MenuEntry[];
  onClose: () => void;
  width?: number;
  initialFocus?: boolean;
}

function isSeparator(entry: MenuEntry): entry is { type: 'separator'; id: string } {
  return 'type' in entry && entry.type === 'separator';
}

function estimateMenuHeight(entries: MenuEntry[], hasTitle: boolean) {
  const itemCount = entries.filter((entry) => !isSeparator(entry)).length;
  const separatorCount = entries.length - itemCount;
  return (hasTitle ? 42 : 8) + itemCount * 34 + separatorCount * 9 + 10;
}

function clampPosition(x: number, y: number, width: number, height: number) {
  if (typeof window === 'undefined') return { left: x, top: y };

  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

export function Menu({
  x,
  y,
  title,
  entries,
  onClose,
  width = 224,
  initialFocus = false,
}: MenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const position = clampPosition(x, y, width, estimateMenuHeight(entries, Boolean(title)));

  useEffect(() => {
    if (!initialFocus) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [initialFocus]);

  const menu = (
    <div
      className="fixed inset-0 z-[10000]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="pq-card fixed overflow-hidden p-1 shadow-[var(--pq-shadow-dialog)]"
        ref={menuRef}
        style={{ left: position.left, top: position.top, width }}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? (
          <div className="border-b border-[var(--pq-border-subtle)] px-2.5 py-2 text-xs font-medium text-[var(--pq-text-muted)]">
            <div className="truncate">{title}</div>
          </div>
        ) : null}

        <div className="max-h-[min(420px,calc(100vh-32px))] overflow-y-auto py-1">
          {entries.map((entry) => {
            if (isSeparator(entry)) {
              return <div key={entry.id} className="my-1 border-t border-[var(--pq-border-subtle)]" />;
            }

            return (
              <button
                key={entry.id}
                type="button"
                disabled={entry.disabled}
                onClick={() => {
                  if (entry.disabled) return;
                  onClose();
                  void entry.onSelect();
                }}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-[var(--pq-radius-sm)] px-2.5 text-left text-xs font-medium transition disabled:opacity-45',
                  entry.tone === 'danger'
                    ? 'text-[var(--pq-error)] hover:bg-[var(--pq-error-bg)]'
                    : entry.tone === 'accent'
                      ? 'text-[var(--pq-accent)] hover:bg-[var(--pq-accent-bg)]'
                      : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
                )}
              >
                {entry.icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{entry.icon}</span> : null}
                <span className="truncate">{entry.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? menu : createPortal(menu, document.body);
}
