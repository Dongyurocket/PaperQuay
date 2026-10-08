import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check } from 'lucide-react';
import type { ModelReasoningEffort } from '../types/reader';
import { placeAnchoredMenu } from '../utils/anchoredMenu';
import { cn } from '../utils/cn';

const REASONING_OPTIONS: Array<{ value: ModelReasoningEffort; labelZh: string; labelEn: string }> = [
  { value: 'auto', labelZh: '自动', labelEn: 'Auto' },
  { value: 'low', labelZh: '低', labelEn: 'Low' },
  { value: 'medium', labelZh: '中', labelEn: 'Medium' },
  { value: 'high', labelZh: '高', labelEn: 'High' },
  { value: 'xhigh', labelZh: '极高', labelEn: 'XHigh' },
  { value: 'max', labelZh: '最高', labelEn: 'Max' },
];

interface ReasoningEffortPickerProps {
  l: (zh: string, en: string) => string;
  value: ModelReasoningEffort;
  onChange: (reasoningEffort: ModelReasoningEffort) => void;
  title?: string;
  className?: string;
  compact?: boolean;
}

export function ReasoningEffortPicker({
  l,
  value,
  onChange,
  title,
  className,
  compact = false,
}: ReasoningEffortPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [menuPlacement, setMenuPlacement] = useState<'above' | 'below'>('below');
  const selectedOption = useMemo(
    () => REASONING_OPTIONS.find((option) => option.value === value) ?? REASONING_OPTIONS[0],
    [value],
  );
  const selectedIndex = Math.max(0, REASONING_OPTIONS.findIndex((option) => option.value === selectedOption.value));
  const label = title ?? l('思考强度', 'Reasoning effort');

  const restoreButtonFocus = useCallback(() => {
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    pendingFocusIndexRef.current = null;
    if (restoreFocus && typeof window !== 'undefined') {
      restoreButtonFocus();
    }
  }, [restoreButtonFocus]);

  const openMenu = useCallback((focusIndex?: number) => {
    pendingFocusIndexRef.current = focusIndex ?? null;
    setOpen(true);
    if (focusIndex !== undefined && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => menuItemRefs.current[focusIndex]?.focus());
    }
  }, []);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;

    if (!button || typeof window === 'undefined') {
      return;
    }

    const rect = button.getBoundingClientRect();
    const placement = placeAnchoredMenu({
      anchor: {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      preferredWidth: 176,
      preferredMaxHeight: 320,
      minUsefulHeight: 180,
    });

    setMenuPlacement(placement.placement);
    setMenuStyle({
      left: placement.left,
      width: placement.width,
      maxHeight: placement.maxHeight,
      top: placement.top,
      bottom: placement.bottom,
    });
  }, []);

  const selectOption = useCallback((option: ModelReasoningEffort) => {
    onChange(option);
    closeMenu(true);
  }, [closeMenu, onChange]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updateMenuPosition();
    const focusIndex = pendingFocusIndexRef.current;
    if (focusIndex !== null) {
      window.requestAnimationFrame(() => menuItemRefs.current[focusIndex]?.focus());
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node &&
        (rootRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }

      closeMenu();
    };
    const handleViewportChange = () => updateMenuPosition();

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeMenu, open, updateMenuPosition]);

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className={cn(
        'pq-card fixed z-[9999] overflow-y-auto p-1 shadow-[0_18px_48px_rgba(15,23,42,0.18)]',
        menuPlacement === 'above' ? 'origin-bottom' : 'origin-top',
      )}
      style={menuStyle}
    >
      {REASONING_OPTIONS.map((option, index) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            ref={(element) => {
              menuItemRefs.current[index] = element;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            onClick={() => selectOption(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu(true);
                return;
              }

              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                const nextIndex = (index + direction + REASONING_OPTIONS.length) % REASONING_OPTIONS.length;
                menuItemRefs.current[nextIndex]?.focus();
                return;
              }

              if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const nextIndex = event.key === 'Home' ? 0 : REASONING_OPTIONS.length - 1;
                menuItemRefs.current[nextIndex]?.focus();
                return;
              }

            }}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition',
              selected
                ? 'bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]'
                : 'text-[var(--pq-text)] hover:bg-[var(--pq-surface-2)]',
            )}
          >
            <span>{l(option.labelZh, option.labelEn)}</span>
            {selected ? <Check className="h-4 w-4" strokeWidth={2.2} /> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={cn('relative shrink-0', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const focusIndex = event.key === 'ArrowDown'
              ? selectedIndex
              : (selectedIndex - 1 + REASONING_OPTIONS.length) % REASONING_OPTIONS.length;
            openMenu(focusIndex);
            return;
          }

          if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
        title={`${label}: ${l(selectedOption.labelZh, selectedOption.labelEn)}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'pq-icon-button border bg-white/60',
          compact ? 'h-8 w-8' : 'h-10 w-10',
          value === 'auto'
            ? 'border-[var(--pq-border)] text-slate-400 dark:bg-white/5 dark:text-[var(--pq-text-faint)]'
            : 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-[0_0_0_3px_rgba(16,185,129,0.12)] dark:border-emerald-400/40 dark:bg-emerald-400/12 dark:text-emerald-200',
        )}
      >
        <Brain className="h-4 w-4" strokeWidth={1.8} />
      </button>

      {typeof document === 'undefined' || !menu ? null : createPortal(menu, document.body)}
    </div>
  );
}
