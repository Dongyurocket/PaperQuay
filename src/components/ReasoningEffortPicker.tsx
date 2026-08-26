import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check } from 'lucide-react';
import type { ModelReasoningEffort } from '../types/reader';
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
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selectedOption = useMemo(
    () => REASONING_OPTIONS.find((option) => option.value === value) ?? REASONING_OPTIONS[0],
    [value],
  );
  const label = title ?? l('思考强度', 'Reasoning effort');

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;

    if (!button || typeof window === 'undefined') {
      return;
    }

    const rect = button.getBoundingClientRect();
    const width = Math.min(window.innerWidth - 24, 176);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));

    setMenuStyle({
      bottom: Math.max(12, window.innerHeight - rect.top + 8),
      left,
      width,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node &&
        (rootRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }

      setOpen(false);
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
  }, [open, updateMenuPosition]);

  const menu = open ? (
    <div
      ref={menuRef}
      className="pq-card fixed z-[9999] overflow-hidden p-1 shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
      style={menuStyle}
    >
      {REASONING_OPTIONS.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
              setOpen(false);
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
        onClick={() => setOpen((current) => !current)}
        title={`${label}: ${l(selectedOption.labelZh, selectedOption.labelEn)}`}
        aria-label={label}
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
