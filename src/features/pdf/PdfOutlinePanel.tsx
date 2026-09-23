import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CornerUpLeft, ListTree, Search, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import {
  filterOutline,
  findActiveOutlineId,
  flattenOutline,
  type ReaderOutlineItem,
} from './pdfOutline';

type LocaleText = (zh: string, en: string) => string;

interface PdfOutlinePanelProps {
  items: ReaderOutlineItem[];
  loading: boolean;
  /** 1-based 当前页 */
  currentPage: number;
  collapsedIds: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  onNavigate: (item: ReaderOutlineItem) => void;
  /** 返回上一个阅读位置（跳转前记录），无历史时隐藏 */
  canGoBack: boolean;
  onGoBack: () => void;
  errorMessage?: string;
  l: LocaleText;
}

const OUTLINE_ROW_ESTIMATE_PX = 30;

export const PdfOutlinePanel = memo(function PdfOutlinePanel({
  items,
  loading,
  currentPage,
  collapsedIds,
  onToggleCollapsed,
  onNavigate,
  canGoBack,
  onGoBack,
  errorMessage,
  l,
}: PdfOutlinePanelProps) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const visibleItems = useMemo(() => filterOutline(items, query), [items, query]);
  const searching = query.trim().length > 0;
  // 搜索时全部展开，便于看到命中上下文
  const rows = useMemo(
    () => flattenOutline(visibleItems, searching ? new Set<string>() : collapsedIds),
    [visibleItems, searching, collapsedIds],
  );
  const activeId = useMemo(
    () => findActiveOutlineId(items, Math.max(0, currentPage - 1)),
    [items, currentPage],
  );

  // 当前位置行滚动到可视区域（仅未搜索时跟随）
  useEffect(() => {
    if (!activeId || searching) {
      return;
    }

    const scroller = listRef.current;
    const target = scroller?.querySelector<HTMLElement>(`[data-outline-id="${activeId}"]`);
    if (!scroller || !target) {
      return;
    }

    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    if (target.offsetTop < viewTop || target.offsetTop + target.offsetHeight > viewBottom) {
      scroller.scrollTop = Math.max(0, target.offsetTop - scroller.clientHeight / 3);
    }
  }, [activeId, searching, rows.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-slate-200/70 px-2.5 py-2.5 dark:border-[var(--pq-border)]">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-[var(--pq-text-faint)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={l('搜索标题', 'Search headings')}
            className="h-7 w-full rounded-lg border border-slate-200 bg-white/80 pl-7 pr-6 text-xs text-slate-700 outline-none transition focus:border-indigo-300 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text)] dark:focus:border-indigo-400/40"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-[var(--pq-text)]"
              aria-label={l('清除搜索', 'Clear search')}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        {canGoBack ? (
          <button
            type="button"
            onClick={onGoBack}
            title={l('返回上一个位置', 'Back to previous location')}
            aria-label={l('返回上一个位置', 'Back to previous location')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)] dark:hover:text-[var(--pq-text)]"
          >
            <CornerUpLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        ) : null}
      </div>

      <div
        ref={listRef}
        data-wheel-scroll-target
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-1.5 py-2"
      >
        {loading ? (
          <div className="px-2 py-6 text-center text-xs text-slate-400 dark:text-[var(--pq-text-faint)]">
            {l('正在读取目录…', 'Loading outline...')}
          </div>
        ) : errorMessage ? (
          <div className="px-2 py-6 text-center text-xs text-amber-600 dark:text-amber-400">
            {errorMessage}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-slate-400 dark:text-[var(--pq-text-faint)]">
            <ListTree className="h-5 w-5" strokeWidth={1.6} />
            {searching
              ? l('没有匹配的标题', 'No matching headings')
              : l('本文档没有可用目录', 'No outline available for this document')}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {rows.map(({ item, depth, hasChildren, collapsed }) => {
              const isActive = item.id === activeId;
              return (
                <li key={item.id} className="pq-outline-row">
                  <div
                    data-outline-id={item.id}
                    className={cn(
                      'group flex w-full items-center gap-0.5 rounded-lg pr-1 text-left transition-colors',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                        : 'text-slate-600 hover:bg-slate-100/80 dark:text-[var(--pq-text-muted)] dark:hover:bg-[var(--pq-surface-2)]',
                    )}
                    style={{ paddingLeft: `${(depth - 1) * 12 + 2}px` }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={() => onToggleCollapsed(item.id)}
                        className="inline-flex h-6 w-5 shrink-0 items-center justify-center text-slate-400 transition hover:text-slate-600 dark:hover:text-[var(--pq-text)]"
                        aria-label={collapsed ? l('展开', 'Expand') : l('折叠', 'Collapse')}
                      >
                        {collapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                        )}
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={() => onNavigate(item)}
                      title={item.title}
                      className={cn(
                        'min-w-0 flex-1 truncate py-1.5 text-left text-xs leading-5',
                        depth === 1 ? 'font-medium' : 'font-normal',
                        isActive && 'font-medium',
                      )}
                      style={{ minHeight: OUTLINE_ROW_ESTIMATE_PX - 8 }}
                    >
                      {item.title}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
});
