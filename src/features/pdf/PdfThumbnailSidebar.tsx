import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEventHandler,
} from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../../utils/cn';
import { areVirtualWindowsEqual, type VirtualWindow } from '../../utils/virtualWindow';
import { resolveThumbnailWindow, THUMBNAIL_ITEM_STRIDE_PX } from './pdfViewerUtils';

type LocaleText = (zh: string, en: string) => string;

interface PdfThumbnailSidebarProps {
  collapsed: boolean;
  pageCount: number;
  currentPage: number;
  pageThumbnails: Record<number, string>;
  onToggleCollapsed: () => void;
  onScrollToPage: (pageIndex: number) => void;
  onWheelCapture: WheelEventHandler<HTMLElement>;
  /** 折叠按钮下方的额外按钮（如「目录/缩略图」切换） */
  stripExtra?: ReactNode;
  /** 非空时替换缩略图列表内容区（目录面板等），并改用 contentTitle 作标题 */
  contentOverride?: ReactNode;
  contentTitle?: string;
  l: LocaleText;
}

const EMPTY_THUMBNAIL_WINDOW: VirtualWindow = {
  startIndex: 0,
  endIndex: 0,
  paddingStart: 0,
  paddingEnd: 0,
  totalSize: 0,
};

const THUMBNAIL_VIEWPORT_FALLBACK_PX = 640;

export const PdfThumbnailSidebar = memo(forwardRef<HTMLElement, PdfThumbnailSidebarProps>(function PdfThumbnailSidebar(
  {
    collapsed,
    pageCount,
    currentPage,
    pageThumbnails,
    onToggleCollapsed,
    onScrollToPage,
    onWheelCapture,
    stripExtra,
    contentOverride,
    contentTitle,
    l,
  },
  ref,
) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [thumbWindow, setThumbWindow] = useState<VirtualWindow>(EMPTY_THUMBNAIL_WINDOW);
  const toggleLabel = collapsed
    ? l('Show page thumbnails', 'Show page thumbnails')
    : l('Hide page thumbnails', 'Hide page thumbnails');

  const updateThumbWindow = useCallback((scrollTop?: number, viewportHeight?: number) => {
    const scroller = listRef.current;
    const next = resolveThumbnailWindow(
      pageCount,
      scrollTop ?? scroller?.scrollTop ?? 0,
      viewportHeight ?? scroller?.clientHeight ?? THUMBNAIL_VIEWPORT_FALLBACK_PX,
    );

    setThumbWindow((current) => (areVirtualWindowsEqual(current, next) ? current : next));
  }, [pageCount]);

  useLayoutEffect(() => {
    if (collapsed || pageCount <= 0) {
      setThumbWindow(EMPTY_THUMBNAIL_WINDOW);
      return;
    }

    const scroller = listRef.current;
    const index = Math.max(0, Math.min(pageCount - 1, currentPage - 1));
    const itemSize = THUMBNAIL_ITEM_STRIDE_PX;
    const targetTop = index * itemSize;

    if (scroller) {
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;

      if (targetTop < viewTop || targetTop + itemSize > viewBottom) {
        scroller.scrollTop = Math.max(0, targetTop - Math.max(0, scroller.clientHeight - itemSize) / 2);
      }

      updateThumbWindow(scroller.scrollTop, scroller.clientHeight || THUMBNAIL_VIEWPORT_FALLBACK_PX);
      return;
    }

    updateThumbWindow(Math.max(0, targetTop - THUMBNAIL_VIEWPORT_FALLBACK_PX / 2), THUMBNAIL_VIEWPORT_FALLBACK_PX);
  }, [collapsed, currentPage, pageCount, updateThumbWindow]);

  useEffect(() => {
    if (collapsed) {
      return undefined;
    }

    const scroller = listRef.current;

    if (!scroller) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateThumbWindow();
    });

    observer.observe(scroller);

    return () => observer.disconnect();
  }, [collapsed, pageCount, updateThumbWindow]);

  const visiblePageIndexes = Array.from(
    { length: Math.max(0, thumbWindow.endIndex - thumbWindow.startIndex) },
    (_, offset) => thumbWindow.startIndex + offset,
  );

  return (
    <aside
      ref={ref}
      onWheelCapture={onWheelCapture}
      className={cn(
        'flex min-h-0 shrink-0 transition-[width,background-color,box-shadow] duration-300 ease-out',
        collapsed
          ? 'pointer-events-none absolute inset-y-0 left-0 z-30 w-10 border-r-0 bg-transparent'
          : cn(
              'relative border-r border-slate-200/80 bg-white/72 shadow-[8px_0_24px_rgba(15,23,42,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:shadow-none',
              contentOverride ? 'w-[248px]' : 'w-[184px]',
            ),
      )}
    >
      <div className="flex min-h-0 w-full">
        <div
          className={cn(
            'flex shrink-0 flex-col items-center gap-3 transition-all duration-300 ease-out',
            collapsed
              ? 'pointer-events-auto w-10 px-1 py-3'
              : 'w-10 border-r border-slate-200/70 px-1.5 py-4 dark:border-white/10',
          )}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)] dark:hover:border-white/15 dark:hover:bg-[var(--pq-surface-2)]',
              collapsed && 'shadow-[0_10px_24px_rgba(15,23,42,0.16)]',
            )}
            title={toggleLabel}
            aria-label={toggleLabel}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
            ) : (
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
            )}
          </button>
          {stripExtra}
        </div>

        <div
          className={cn(
            'min-h-0 overflow-hidden transition-[width,opacity] duration-300 ease-out',
            collapsed ? 'w-0 opacity-0' : cn('opacity-100', contentOverride ? 'w-52' : 'w-36'),
          )}
        >
          {!collapsed ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200/70 px-2.5 py-3 text-xs font-medium text-slate-500 dark:border-[var(--pq-border)] dark:text-[var(--pq-text-faint)]">
                {contentOverride ? (contentTitle ?? l('Outline', 'Outline')) : l('Page Thumbnails', 'Page Thumbnails')}
              </div>
              {contentOverride ?? (
              <div
                ref={listRef}
                data-wheel-scroll-target
                className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2.5 py-3"
                onScroll={() => updateThumbWindow()}
              >
                <div
                  style={{
                    paddingTop: thumbWindow.paddingStart,
                    paddingBottom: thumbWindow.paddingEnd,
                  }}
                >
                  <div className="space-y-2.5">
                    {visiblePageIndexes.map((pageIndex) => {
                      const isActivePage = currentPage === pageIndex + 1;
                      const thumbnailUrl = pageThumbnails[pageIndex];

                      return (
                        <button
                          key={`thumbnail-${pageIndex}`}
                          type="button"
                          onClick={() => onScrollToPage(pageIndex)}
                          className={cn(
                            'group w-full rounded-xl border p-1.5 text-left transition-all duration-200',
                            isActivePage
                              ? 'border-indigo-200 bg-white shadow-[0_10px_24px_rgba(79,70,229,0.10)] dark:border-indigo-400/30 dark:bg-[var(--pq-surface-2)] dark:shadow-[0_10px_24px_rgba(79,70,229,0.16)]'
                              : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:hover:border-white/15 dark:hover:bg-[var(--pq-surface-2)]',
                          )}
                        >
                          <div className="aspect-[0.74] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-[var(--pq-surface-1)]">
                            {thumbnailUrl ? (
                              <img
                                src={thumbnailUrl}
                                alt={l(
                                  `第 ${pageIndex + 1} 页缩略图`,
                                  `Thumbnail for page ${pageIndex + 1}`,
                                )}
                                className="block h-full w-full object-contain"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(180deg,#f8fafc,#eef2f7)] text-xs text-slate-400 dark:bg-[linear-gradient(180deg,#242424,#1e1e1e)] dark:text-[var(--pq-text-muted)]">
                                {l('Rendering', 'Rendering')}
                              </div>
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-[var(--pq-text-faint)]">
                            <span>{l(`Page ${pageIndex + 1}`, `Page ${pageIndex + 1}`)}</span>
                            {isActivePage ? (
                              <span className="text-indigo-600 dark:text-indigo-400">
                                {l('当前', 'Current')}
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}));
