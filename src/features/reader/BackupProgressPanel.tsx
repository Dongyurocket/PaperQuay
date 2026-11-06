import { FolderOpen, LoaderCircle, X } from 'lucide-react';

import type {
  BackupExportResult,
  BackupProgress,
  BackupProgressPhase,
  BackupWarning,
} from '../../types/backupPackage';
import type { ReaderPreferencesLocalizer } from './readerPreferencesTypes';

interface BackupProgressPanelProps {
  progress: BackupProgress | null;
  result?: BackupExportResult | null;
  busy?: boolean;
  cancelling?: boolean;
  canCancel?: boolean;
  l: ReaderPreferencesLocalizer;
  onCancel?: () => void;
  onOpenFolder?: (path: string) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}

function warningLabel(warning: string | BackupWarning, l: ReaderPreferencesLocalizer): string {
  if (typeof warning === 'string') return l('备份包含警告项', 'The backup contains a warning item');
  const name = warning.originalName?.split(/[\\/]/).filter(Boolean).pop();
  return [warning.code, warning.kind, name].filter(Boolean).join(' · ');
}

function phaseLabel(phase: BackupProgressPhase, l: ReaderPreferencesLocalizer): string {
  switch (phase) {
    case 'preflight': return l('正在检查空间与目标', 'Checking space and destination');
    case 'collecting': return l('正在收集备份内容', 'Collecting backup contents');
    case 'snapshot': return l('正在创建数据库快照', 'Creating database snapshots');
    case 'writing': return l('正在写入加密备份包', 'Writing encrypted backup package');
    case 'verifying': return l('正在校验备份包', 'Verifying backup package');
    case 'committing': return l('正在提交恢复', 'Committing restore');
    case 'restarting': return l('正在重启以完成恢复', 'Restarting to finish restore');
    case 'done': return l('任务已完成', 'Task completed');
    case 'failed': return l('任务失败', 'Task failed');
  }
}

export function BackupProgressPanel({
  progress,
  result = null,
  busy = false,
  cancelling = false,
  canCancel = false,
  l,
  onCancel,
  onOpenFolder,
}: BackupProgressPanelProps) {
  if (!progress && !result) return null;

  const totalBytes = progress?.totalBytes ?? result?.bytes ?? 0;
  const completedBytes = progress?.completedBytes ?? result?.bytes ?? 0;
  const percent = totalBytes > 0 ? Math.min(100, Math.floor((completedBytes / totalBytes) * 100)) : 0;
  const warnings = result?.warnings ?? [];

  return (
    <section
      aria-live="polite"
      aria-atomic="false"
      className="space-y-3 rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface-1)] p-4"
    >
      {progress ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {(busy || (progress.phase !== 'done' && progress.phase !== 'failed'))
                ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[var(--pq-accent)]" strokeWidth={1.8} />
                : null}
              <h3 className="min-w-0 truncate text-sm font-semibold text-[var(--pq-text)]">
                {phaseLabel(progress.phase, l)}
              </h3>
            </div>
            {canCancel && progress.phase !== 'committing' && progress.phase !== 'restarting' ? (
              <button
                type="button"
                onClick={onCancel}
                disabled={cancelling}
                className="pq-button-danger inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                {cancelling ? l('正在取消…', 'Cancelling…') : l('取消任务', 'Cancel Task')}
              </button>
            ) : null}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--pq-text-muted)]">
            <span>{formatBytes(completedBytes)} / {formatBytes(totalBytes)}</span>
            <span>{percent}%</span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--pq-surface-3)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={phaseLabel(progress.phase, l)}
          >
            <div
              className="h-full rounded-full bg-[var(--pq-accent)] transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--pq-text-muted)]">
            <span>
              {l('条目', 'Entries')}: {progress.completedEntries}/{progress.totalEntries}
            </span>
            {progress.currentLabel ? <span className="min-w-0 truncate">{progress.currentLabel}</span> : null}
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-2 border-t border-[var(--pq-border)] pt-3">
          <div className="text-sm font-semibold text-[var(--pq-success)]">
            {l('备份包已生成并完成校验', 'Backup package created and verified')}
          </div>
          <dl className="grid gap-x-4 gap-y-1 text-xs text-[var(--pq-text-muted)] sm:grid-cols-2">
            <div><dt className="inline">{l('体积', 'Size')}: </dt><dd className="inline">{formatBytes(result.bytes)}</dd></div>
            <div><dt className="inline">{l('条目', 'Entries')}: </dt><dd className="inline">{result.entries}</dd></div>
            <div><dt className="inline">{l('耗时', 'Duration')}: </dt><dd className="inline">{(result.durationMs / 1000).toFixed(1)} s</dd></div>
          </dl>
          <div className="break-all rounded-md bg-[var(--pq-surface-2)] px-2.5 py-2 font-mono text-xs text-[var(--pq-text-muted)]">
            {result.packagePath}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenFolder?.(result.packagePath)}
              disabled={!onOpenFolder}
              className="pq-button inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60"
            >
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
              {l('打开所在文件夹', 'Open Containing Folder')}
            </button>
            {warnings.length > 0 ? (
              <span className="text-xs text-[var(--pq-warning)]">
                {l(`警告 ${warnings.length} 条`, `${warnings.length} warning(s)`)}
              </span>
            ) : null}
          </div>
          {warnings.length > 0 ? (
            <ul className="max-h-28 space-y-1 overflow-auto border-t border-[var(--pq-border)] pt-2 text-xs text-[var(--pq-text-muted)]">
              {warnings.slice(0, 10).map((warning, index) => <li key={index} className="break-words">{warningLabel(warning, l)}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
