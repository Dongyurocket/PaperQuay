import clsx from 'clsx';
import { useAppLocale } from '../../i18n/uiLanguage';
import {
  pickLocaleText,
  type BatchProgressState,
} from './readerShared';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-4 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-all duration-200 hover:border-[var(--pq-border-strong)] hover:bg-[var(--pq-surface-2)]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--pq-text)]">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--pq-text-muted)]">{description}</span>
      </span>
      <span
        className={clsx(
          'relative h-6 w-11 shrink-0 rounded-full transition',
          checked ? 'bg-[var(--pq-accent)]' : 'bg-[var(--pq-surface-3)]',
        )}
      >
        <span
          className={clsx(
            'absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </button>
  );
}

function ProgressBar({
  value,
  total,
  tone = 'indigo',
}: {
  value: number;
  total: number;
  tone?: 'indigo' | 'emerald';
}) {
  const ratio = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;

  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--pq-surface-2)]">
      <div
        className={clsx(
          'h-full rounded-full transition-all duration-300',
          tone === 'emerald' ? 'bg-[var(--pq-success)]' : 'bg-[var(--pq-accent)]',
        )}
        style={{ width: `${ratio}%` }}
      />
    </div>
  );
}

export function BatchProgressCard({
  title,
  progress,
  tone = 'indigo',
}: {
  title: string;
  progress: BatchProgressState;
  tone?: 'indigo' | 'emerald';
}) {
  const locale = useAppLocale();

  if (!progress.running && progress.total === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[var(--pq-border)] bg-slate-50/80 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="font-medium text-[var(--pq-text)]">{title}</div>
        <div className="text-[var(--pq-text-muted)]">
          {progress.completed}/{progress.total}
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar value={progress.completed} total={progress.total} tone={tone} />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--pq-text-muted)]">
        <span>{pickLocaleText(locale, `成功 ${progress.succeeded}`, `Succeeded ${progress.succeeded}`)}</span>
        <span>{pickLocaleText(locale, `跳过 ${progress.skipped}`, `Skipped ${progress.skipped}`)}</span>
        <span>{pickLocaleText(locale, `失败 ${progress.failed}`, `Failed ${progress.failed}`)}</span>
        {progress.paused ? (
          <span>{pickLocaleText(locale, '已暂停', 'Paused')}</span>
        ) : null}
        {progress.cancelRequested ? (
          <span>{pickLocaleText(locale, '取消中', 'Cancelling')}</span>
        ) : null}
      </div>
      {progress.currentLabel ? (
        <div className="mt-2 truncate text-xs text-[var(--pq-text-muted)]">{progress.currentLabel}</div>
      ) : null}
    </div>
  );
}

export function SettingsField({
  label,
  description,
  children,
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-[var(--pq-border)] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:shadow-none">
      <div>
        <div className="text-sm font-medium text-[var(--pq-text)] dark:text-[var(--pq-text)]">{label}</div>
        {description ? (
          <div className="mt-1 text-xs leading-5 text-[var(--pq-text-muted)] dark:text-[var(--pq-text-muted)]">
            {description}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingsInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-3 py-2.5 text-sm text-[var(--pq-text)] outline-none transition focus:border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] focus:bg-white dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text)] dark:placeholder:text-[var(--pq-text-faint)] dark:focus:border-[color-mix(in_srgb,var(--pq-accent)_30%,transparent)] dark:focus:bg-[var(--pq-surface-2)]',
        props.className,
      )}
    />
  );
}

export function SettingsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        'w-full rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-3 py-2.5 text-sm text-[var(--pq-text)] outline-none transition focus:border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] focus:bg-white dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text)] dark:focus:border-[color-mix(in_srgb,var(--pq-accent)_30%,transparent)] dark:focus:bg-[var(--pq-surface-2)]',
        props.className,
      )}
    />
  );
}

export function SettingsTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        'w-full rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-3 py-2.5 text-sm text-[var(--pq-text)] outline-none transition focus:border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] focus:bg-white dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text)] dark:placeholder:text-[var(--pq-text-faint)] dark:focus:border-[color-mix(in_srgb,var(--pq-accent)_30%,transparent)] dark:focus:bg-[var(--pq-surface-2)]',
        props.className,
      )}
    />
  );
}
