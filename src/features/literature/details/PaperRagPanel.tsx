import { AlertTriangle, Database, Loader2 } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { LiteraturePaper } from '../../../types/library';
import type { RagDocumentIndexStatus } from '../../../types/reader';
import {
  buildRagActionItems,
  ragStatusDescription,
  ragStatusLabel,
  type RagPaperAction,
} from '../ragActions';
import type { LiteraturePaperRagStatus } from '../components/LiteraturePaperList';

interface Props {
  paper: LiteraturePaper;
  status: LiteraturePaperRagStatus;
  entries: RagDocumentIndexStatus[];
  ragIndexAvailable: boolean;
  indexing: boolean;
  busy: boolean;
  mineruParsed: boolean;
  onAction: (action: RagPaperAction) => void;
}

function sourceLabel(sourceType: string, l: (zh: string, en: string) => string): string {
  if (sourceType === 'mineru-markdown') return 'MinerU Markdown';
  if (sourceType === 'pdf-text') return l('PDF 文本', 'PDF text');
  if (sourceType === 'note') return l('笔记', 'Note');
  return sourceType;
}

function sourceStatusLabel(status: string, l: (zh: string, en: string) => string): string {
  if (status === 'ready') return l('已索引', 'Indexed');
  if (status === 'pending') return l('待索引', 'Pending');
  if (status === 'failed') return l('失败', 'Failed');
  return status;
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

function shortenModelKey(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length > 30 ? `${value.slice(0, 16)}…${value.slice(-10)}` : value;
}

function statusBadgeClass(status: LiteraturePaperRagStatus): string {
  if (status === 'failed') {
    return 'border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-error-bg)] text-[var(--pq-danger)]';
  }
  if (status === 'stale' || status === 'pending') {
    return 'border-[color-mix(in_srgb,var(--pq-warning)_28%,transparent)] bg-[var(--pq-warning-bg)] text-[var(--pq-warning)]';
  }
  if (status === 'ready') {
    return 'border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]';
  }
  return 'border-[var(--pq-border-strong)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)]';
}

/** 详情页的本地知识库面板：成员开关、来源明细、错误与逐篇动作。 */
export default function PaperRagPanel({
  paper,
  status,
  entries,
  ragIndexAvailable,
  indexing,
  busy,
  mineruParsed,
  onAction,
}: Props) {
  const l = useLocaleText();
  const included = paper.ragEnabled !== false;
  const actionItems = buildRagActionItems({
    status,
    ragIndexAvailable,
    mineruParsed,
    indexing,
    busy,
  }, l).filter((item) => ['build', 'retry', 'update', 'rebuild'].includes(item.action));
  const now = Date.now();
  const errors = entries.flatMap((entry) => {
    const message = entry.lastError || entry.rebuildError;
    const coolingDown = typeof entry.cooldownUntil === 'number' && entry.cooldownUntil > now;
    return message || coolingDown
      ? [{ entry, message, coolingDown }]
      : [];
  });

  return (
    <details className="group rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)]" open>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-2.5 text-sm font-semibold">
        <Database className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />
        <span>{l('本地知识库', 'Local knowledge base')}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(status)}`}>
          {ragStatusLabel(status, l)}
        </span>
        {indexing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--pq-accent)]" /> : null}
        <span className="ml-auto text-xs font-normal text-[var(--pq-text-muted)]">
          {included ? l('参与检索', 'Included') : l('不参与检索', 'Excluded')}
        </span>
      </summary>

      <div className="space-y-2.5 border-t border-[var(--pq-border-subtle)] p-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs text-[var(--pq-text-muted)]">{ragStatusDescription(status, l)}</p>
          <button
            type="button"
            role="switch"
            aria-checked={included}
            aria-label={l('参与本地知识库', 'Include in local knowledge base')}
            disabled={busy}
            onClick={() => onAction(included ? 'exclude' : 'include')}
            className={[
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition',
              included
                ? 'border-[var(--pq-accent)] bg-[var(--pq-accent)]'
                : 'border-[var(--pq-border-strong)] bg-[var(--pq-surface-3)]',
              busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-3.5 w-3.5 rounded-full bg-[var(--pq-surface-1)] shadow-sm transition-transform',
                included ? 'translate-x-[18px]' : 'translate-x-[3px]',
              ].join(' ')}
            />
          </button>
        </div>

        {entries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-xs">
              <thead className="text-[var(--pq-text-muted)]">
                <tr className="border-b border-[var(--pq-border-subtle)]">
                  <th className="py-1 pr-2 font-medium">{l('来源', 'Source')}</th>
                  <th className="py-1 pr-2 font-medium">{l('状态', 'Status')}</th>
                  <th className="py-1 pr-2 font-medium">{l('分块', 'Chunks')}</th>
                  <th className="py-1 pr-2 font-medium">{l('模型', 'Model')}</th>
                  <th className="py-1 pr-2 font-medium">{l('索引时间', 'Indexed at')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={`${entry.documentKey}:${entry.sourceType}`} className="border-b border-[var(--pq-border-subtle)] last:border-b-0">
                    <td className="py-1.5 pr-2">{sourceLabel(entry.sourceType, l)}</td>
                    <td className={`py-1.5 pr-2 font-medium ${entry.status === 'failed' ? 'text-[var(--pq-danger)]' : entry.status === 'ready' ? 'text-[var(--pq-success)]' : 'text-[var(--pq-warning)]'}`}>
                      {sourceStatusLabel(entry.status, l)}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums">{entry.indexedChunkCount}/{entry.totalChunkCount}</td>
                    <td className="py-1.5 pr-2" title={entry.embeddingModelKey || undefined}>{shortenModelKey(entry.embeddingModelKey)}</td>
                    <td className="py-1.5 pr-2">{formatTimestamp(entry.indexedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[var(--pq-text-muted)]">
            {l('还没有索引记录。', 'No index records yet.')}
          </p>
        )}

        {errors.length > 0 ? (
          <div className="space-y-1 rounded-[var(--pq-radius-sm)] border border-[color-mix(in_srgb,var(--pq-danger)_24%,transparent)] bg-[var(--pq-error-bg)] p-2 text-xs text-[var(--pq-danger)]">
            {errors.map(({ entry, message, coolingDown }) => (
              <div key={`${entry.documentKey}:${entry.sourceType}:error`} className="space-y-0.5">
                <div className="flex items-center gap-1 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{sourceLabel(entry.sourceType, l)}</span>
                </div>
                {message ? <div className="break-words opacity-90">{message}</div> : null}
                {coolingDown ? (
                  <div className="opacity-80">
                    {l('冷却到 ', 'Cooling down until ')}
                    {formatTimestamp(entry.cooldownUntil)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {actionItems.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {actionItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="pq-button !h-8 px-2.5 text-xs"
                disabled={item.disabled}
                title={item.hint}
                onClick={() => onAction(item.action)}
              >
                {item.label}
              </button>
            ))}
            {!ragIndexAvailable ? (
              <span className="text-[11px] text-[var(--pq-text-muted)]">
                {l('请先在设置中启用本地 RAG 并配置 Embedding。', 'Enable local RAG and configure embedding in settings first.')}
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="text-[11px] leading-relaxed text-[var(--pq-text-faint)]">
          {l(
            '移出知识库会删除这篇文献的索引，但保留 PDF、解析结果和笔记；重新加入不会自动建立索引。PDF 文本来源会在打开文献或重建全部来源时更新。',
            'Excluding removes this paper’s index but keeps its PDF, parsed text and notes. Re-including does not build an index automatically. The PDF-text source refreshes when the paper is opened or all sources are rebuilt.',
          )}
        </p>
      </div>
    </details>
  );
}
