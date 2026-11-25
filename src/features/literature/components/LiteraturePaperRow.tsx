import clsx from 'clsx';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Check, GripVertical, Star } from 'lucide-react';
import { useAppLocale, useLocaleText } from '../../../i18n/uiLanguage';
import { Menu, type MenuEntry } from '../../../ui/menu';
import type { LiteraturePaper } from '../../../types/library';
import type { PdfReadingHeatmap } from '../../../types/reader';
import { truncateMiddle } from '../../../utils/text';
import { paperAuthors, paperPdfPath } from '../literatureUi';
import { buildRagActionItems, type RagPaperAction } from '../ragActions';
import { resolvePaperTitleDisplay, type PaperTitleDisplayMode } from '../titleDisplay';
import LiteratureReadingHeatmapPreview from './LiteratureReadingHeatmapPreview';
import type { LiteraturePaperListStatus, LiteraturePaperRagStatus } from './LiteraturePaperList';

export interface LiteraturePaperRowProps {
  paper: LiteraturePaper;
  /** 全局位置（1 起）与已加载集合大小：虚拟窗口内也必须传全局值，不能传窗口内偏移。 */
  position: number;
  setSize: number;
  active: boolean;
  multiSelected: boolean;
  multiSelectActive: boolean;
  showReadingHeatmap: boolean;
  compact: boolean;
  manualSortingEnabled: boolean;
  status?: LiteraturePaperListStatus;
  heatmap: PdfReadingHeatmap | null;
  ragStatus: LiteraturePaperRagStatus;
  ragIndexing: boolean;
  ragIndexAvailable: boolean;
  dropPlacement: 'before' | 'after' | null;
  sortDragging: boolean;
  categoryDragging: boolean;
  titleDisplayMode: PaperTitleDisplayMode;
  storageDir: string;
  suppressClick: boolean;
  onSelectPaper: (paperId: string, modifiers?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  onOpenPaper: (paper: LiteraturePaper) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, paper: LiteraturePaper) => void;
  onRagAction: (paper: LiteraturePaper, action: RagPaperAction) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, paper: LiteraturePaper) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, paper: LiteraturePaper) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>, paper: LiteraturePaper) => void;
  onCategoryPointerDown: (event: PointerEvent<HTMLDivElement>, paper: LiteraturePaper) => void;
  onCategoryPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onCategoryPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onCategoryPointerCancel: () => void;
  onSortPointerDown: (event: PointerEvent<HTMLElement>, paper: LiteraturePaper) => void;
  onSortPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onSortPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onSortPointerCancel: () => void;
  onMeasure: (paperId: string, element: HTMLDivElement) => void;
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  paper: LiteraturePaper,
  onOpenPaper: (paper: LiteraturePaper) => void,
  onSelectPaper: LiteraturePaperRowProps['onSelectPaper'],
) {
  if (event.key === 'Enter') {
    onOpenPaper(paper);
    return;
  }

  if (event.key === ' ') {
    event.preventDefault();
    onSelectPaper(paper.id, {
      ctrlKey: event.ctrlKey || event.metaKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
  }
}

function LiteraturePaperRowImpl({
  paper,
  position,
  setSize,
  active,
  multiSelected,
  multiSelectActive,
  showReadingHeatmap,
  compact,
  manualSortingEnabled,
  status,
  heatmap,
  ragStatus,
  ragIndexing,
  ragIndexAvailable,
  dropPlacement,
  sortDragging,
  categoryDragging,
  titleDisplayMode,
  storageDir,
  suppressClick,
  onSelectPaper,
  onOpenPaper,
  onContextMenu,
  onRagAction,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDragEnd,
  onDrop,
  onCategoryPointerDown,
  onCategoryPointerMove,
  onCategoryPointerUp,
  onCategoryPointerCancel,
  onSortPointerDown,
  onSortPointerMove,
  onSortPointerUp,
  onSortPointerCancel,
  onMeasure,
}: LiteraturePaperRowProps) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const [ragMenu, setRagMenu] = useState<{
    x: number;
    y: number;
    anchor: HTMLButtonElement;
    entries: MenuEntry[];
  } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const reportMeasure = useCallback(() => {
    const element = rowRef.current;
    if (element && onMeasure) onMeasure(paper.id, element);
  }, [onMeasure, paper.id]);

  useLayoutEffect(() => {
    reportMeasure();
  }, [reportMeasure]);

  useEffect(() => {
    const element = rowRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => reportMeasure());
    observer.observe(element);
    return () => observer.disconnect();
  }, [reportMeasure]);

  const titleDisplay = resolvePaperTitleDisplay(paper, titleDisplayMode);
  const pdfPath = paperPdfPath(paper, storageDir);
  const mineruParsed = status?.mineruParsed ?? false;
  const overviewGenerated = status?.overviewGenerated ?? Boolean(paper.aiSummary?.trim());

  return (
    <div
      ref={rowRef}
      role="listitem"
      aria-setsize={setSize}
      aria-posinset={position}
      data-paper-row-index={position - 1}
      className="pq-paper-row relative mb-2"
    >
      {dropPlacement === 'before' ? (
        <div className="pointer-events-none absolute -top-1 left-3 right-3 z-10 h-0.5 rounded-full bg-[var(--pq-accent)]" />
      ) : null}
      <div
        role="button"
        tabIndex={0}
        data-paper-row-id={paper.id}
        draggable={false}
        onPointerDown={(event) => onCategoryPointerDown(event, paper)}
        onPointerMove={onCategoryPointerMove}
        onPointerUp={onCategoryPointerUp}
        onPointerCancel={onCategoryPointerCancel}
        onDragStart={(event) => onDragStart(event, paper)}
        onDragOver={(event) => onDragOver(event, paper)}
        onDragLeave={onDragLeave}
        onDragEnd={onDragEnd}
        onDrop={(event) => onDrop(event, paper)}
        onContextMenu={(event) => onContextMenu(event, paper)}
        onClick={(event) => {
          if (suppressClick) return;
          onSelectPaper(paper.id, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          });
        }}
        onDoubleClick={() => onOpenPaper(paper)}
        onKeyDown={(event) => handleRowKeyDown(event, paper, onOpenPaper, onSelectPaper)}
        className={clsx(
          'pq-card pq-paper-row-card grid w-full gap-3 px-3 py-3 text-left transition',
          compact && '!py-1.5',
          showReadingHeatmap && 'pq-paper-row-card--heatmap',
          manualSortingEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          active
            ? 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-soft)] ring-1 ring-[var(--pq-accent-ring)]'
            : multiSelected
              ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)]/60'
              : dropPlacement
                ? 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-soft)]'
                : 'hover:border-[var(--pq-accent-border)] hover:bg-[var(--pq-surface-2)]',
          sortDragging && 'opacity-60 ring-2 ring-[color-mix(in_srgb,var(--pq-accent)_30%,transparent)]',
          categoryDragging && 'opacity-70 ring-2 ring-[color-mix(in_srgb,var(--pq-accent)_35%,transparent)]',
        )}
      >
        {multiSelectActive ? (
          <span
            role="checkbox"
            aria-checked={multiSelected}
            aria-label={multiSelected ? l('取消选中该文献', 'Deselect this paper') : l('选中该文献', 'Select this paper')}
            title={multiSelected ? l('取消选中', 'Deselect') : l('选中', 'Select')}
            onClick={(event) => {
              event.stopPropagation();
              onSelectPaper(paper.id, { ctrlKey: true });
            }}
            className={clsx(
              'mt-0.5 flex h-8 w-7 cursor-pointer items-center justify-center rounded-lg border transition',
              multiSelected
                ? 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent)] text-[var(--pq-accent-button-text)]'
                : 'border-[var(--pq-border)] bg-[var(--pq-surface-2)] text-transparent hover:border-[var(--pq-accent-border)]',
            )}
          >
            <Check className="h-4 w-4" strokeWidth={2.4} />
          </span>
        ) : (
          <span
            data-paper-sort-handle
            draggable={false}
            title={
              manualSortingEnabled
                ? l('拖拽排序', 'Drag to reorder')
                : l('切换到手动排序后可拖拽排序', 'Switch to manual order to drag-sort')
            }
            onPointerDown={(event) => onSortPointerDown(event, paper)}
            onPointerMove={onSortPointerMove}
            onPointerUp={onSortPointerUp}
            onPointerCancel={onSortPointerCancel}
            className={clsx(
              'mt-0.5 flex h-8 w-7 items-center justify-center rounded-lg text-[var(--pq-text-faint)] transition',
              manualSortingEnabled
                ? 'cursor-grab hover:bg-[var(--pq-accent-soft)] hover:text-[var(--pq-accent)] active:cursor-grabbing'
                : 'cursor-not-allowed opacity-45',
            )}
          >
            <GripVertical className="h-4 w-4" strokeWidth={1.8} />
          </span>
        )}
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            {paper.isFavorite ? (
              <Star className="h-3.5 w-3.5 shrink-0 text-[var(--pq-warning)] " fill="currentColor" strokeWidth={1.8} />
            ) : null}
            <span className="block truncate text-sm font-semibold">
              {titleDisplay.primary}
            </span>
          </span>
          {titleDisplay.secondary ? (
            <span className="mt-0.5 block truncate text-xs text-[var(--pq-text-muted)] dark:text-[var(--pq-text-muted)]">
              {titleDisplay.secondary}
            </span>
          ) : null}
          <span className="mt-1 block truncate text-xs text-[var(--pq-text-muted)] dark:text-[var(--pq-text-muted)]">
            {paperAuthors(paper, locale)}
          </span>
          <span className="pq-card-badges mt-2 flex flex-wrap gap-1.5">
            <span
              className={clsx(
                'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                status?.checkingMineru
                  ? 'border-[var(--pq-border-strong)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)] dark:border-white/10 dark:bg-white/[0.06] dark:text-[var(--pq-text-muted)]'
                  : mineruParsed
                    ? 'border-[color-mix(in_srgb,var(--pq-success)_28%,transparent)] bg-[var(--pq-success-bg)] text-[var(--pq-success)] '
                    : 'border-[color-mix(in_srgb,var(--pq-warning)_28%,transparent)] bg-[var(--pq-warning-bg)] text-[var(--pq-warning)] ',
              )}
            >
              {status?.checkingMineru
                ? l('MinerU 检测中', 'Checking MinerU')
                : mineruParsed
                  ? l('MinerU 已解析', 'MinerU Parsed')
                  : l('MinerU 未解析', 'MinerU Not Parsed')}
            </span>
            {ragIndexAvailable || ragStatus === 'excluded' ? (
              <button
                type="button"
                aria-haspopup="menu"
                title={
                  ragIndexing
                    ? l('正在建立 RAG 索引', 'Building RAG index')
                    : ragStatus === 'failed'
                      ? l('RAG 索引失败，点击重试或查看原因', 'RAG indexing failed; click to retry or view the reason')
                      : ragStatus === 'stale'
                        ? l('索引已过期，点击更新', 'Index is outdated; click to update')
                        : ragStatus === 'excluded'
                        ? l('该文献已移出本地知识库', 'This paper is excluded from the local knowledge base')
                        : l('管理 RAG 索引', 'Manage RAG index')
                }
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setRagMenu({
                    x: rect.left,
                    y: rect.bottom + 4,
                    anchor: event.currentTarget,
                    entries: buildRagActionItems({
                      status: ragStatus,
                      ragIndexAvailable,
                      mineruParsed,
                      indexing: ragIndexing,
                    }, l).map((item) => ({
                      id: `rag-${item.id}`,
                      label: item.label,
                      disabled: item.disabled,
                      tone: item.action === 'exclude' ? 'danger' as const : undefined,
                      onSelect: () => {
                        setRagMenu(null);
                        onRagAction(paper, item.action);
                      },
                    })),
                  });
                }}
                className={clsx(
                  'cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-semibold transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pq-accent)]',
                  ragIndexing && ragStatus !== 'excluded'
                    ? 'border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)] '
                    : ragStatus === 'ready'
                      ? 'border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)] '
                      : ragStatus === 'failed'
                        ? 'border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-error-bg)] text-[var(--pq-danger)] '
                        : ragStatus === 'stale'
                          ? 'border-[color-mix(in_srgb,var(--pq-warning)_28%,transparent)] bg-[var(--pq-warning-bg)] text-[var(--pq-warning)] '
                          : 'border-[var(--pq-border-strong)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)] dark:border-white/10 dark:bg-white/[0.06] dark:text-[var(--pq-text-muted)]',
                )}
              >
                {ragIndexing && ragStatus !== 'excluded'
                  ? l('RAG 索引中', 'RAG Indexing')
                  : ragStatus === 'excluded'
                    ? l('已排除', 'Excluded')
                    : ragStatus === 'ready'
                      ? l('RAG 已索引', 'RAG Indexed')
                      : ragStatus === 'stale'
                        ? l('RAG 待更新', 'RAG Update Pending')
                        : ragStatus === 'failed'
                          ? l('RAG 索引失败', 'RAG Index Failed')
                          : ragStatus === 'pending'
                            ? l('RAG 待索引', 'RAG Pending')
                            : l('RAG 未索引', 'RAG Not Indexed')}
              </button>
            ) : null}
            <span
              className={clsx(
                'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                overviewGenerated
                  ? 'border-[color-mix(in_srgb,var(--pq-info)_28%,transparent)] bg-[var(--pq-info-bg)] text-[var(--pq-info)] '
                  : 'border-[var(--pq-border-strong)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)] dark:border-white/10 dark:bg-white/[0.06] dark:text-[var(--pq-text-muted)]',
              )}
            >
              {overviewGenerated
                ? l('概览已生成', 'Overview Ready')
                : l('概览未生成', 'No Overview')}
            </span>
          </span>
          {paper.tags.length > 0 ? (
            <span className="pq-card-badges mt-2 flex flex-wrap gap-1.5">
              {paper.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full border border-[color-mix(in_srgb,var(--pq-info)_28%,transparent)] bg-[var(--pq-info-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--pq-info)] "
                >
                  {tag.name}
                </span>
              ))}
              {paper.tags.length > 3 ? (
                <span className="rounded-full bg-[var(--pq-surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--pq-text-muted)] dark:bg-white/[0.06] dark:text-[var(--pq-text-muted)]">
                  +{paper.tags.length - 3}
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="mt-2 block truncate text-[11px] text-[var(--pq-text-faint)] dark:text-[var(--pq-text-faint)]">
            {pdfPath ? truncateMiddle(pdfPath, 68) : l('缺少 PDF 附件', 'Missing PDF attachment')}
          </span>
        </span>
        {showReadingHeatmap ? (
          <span className="pq-card-heatmap min-w-0 self-center">
            <LiteratureReadingHeatmapPreview heatmap={heatmap} />
          </span>
        ) : null}
        <span className="pq-card-year text-sm text-[var(--pq-text-muted)]">
          {paper.year ?? 'n.d.'}
        </span>
        <span className="pq-card-date text-right text-xs text-[var(--pq-text-faint)]">
          {new Date(paper.importedAt).toLocaleDateString()}
        </span>
      </div>
      {dropPlacement === 'after' ? (
        <div className="pointer-events-none absolute -bottom-1 left-3 right-3 z-10 h-0.5 rounded-full bg-[var(--pq-accent)]" />
      ) : null}
      {ragMenu ? (
        <Menu
          x={ragMenu.x}
          y={ragMenu.y}
          entries={ragMenu.entries}
          onClose={() => {
            setRagMenu(null);
            ragMenu.anchor.focus();
          }}
          keyboardAnchor={ragMenu.anchor}
          width={220}
        />
      ) : null}
    </div>
  );
}

const LiteraturePaperRow = memo(LiteraturePaperRowImpl);
LiteraturePaperRow.displayName = 'LiteraturePaperRow';

export default LiteraturePaperRow;
