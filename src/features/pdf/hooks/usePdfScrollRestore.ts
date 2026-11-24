import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PdfHighlightTarget,
  PdfReadingHeatmap,
  PdfScrollPosition,
  PositionedMineruBlock,
} from '../../../types/reader';
import { bboxToRect, type PageSize } from '../../../utils/bbox';
import { scrollInstantly } from '../instantScroll';
import { isHighlightScrollReady } from '../highlightScroll';
import { createScrollRestoreScheduler } from '../scrollRestoreScheduler';
import {
  getPdfReadingProgressRatio,
  usePdfReadingHeatmap,
} from '../pdfReadingHeatmap';
import {
  getPageElementHeight,
  getRenderedPageSize,
  resolveScrollAnchorPage,
  type PageHostState,
} from '../pdfPageDomUtils';
import {
  buildScrollRestoreKey,
  clampScrollRatio,
  loadStoredBoolean,
  resolveBBoxBaseSize,
} from '../pdfViewerUtils';
import type { PdfJsDocumentInit } from '../pdfDocumentSource';
import { loadOutlineCollapsedIds } from './usePdfOutline';
import type { BBoxPageSizeSource } from './usePdfDocumentLifecycle';

const PDF_READING_HEATMAP_BAR_VISIBLE_STORAGE_KEY =
  'paperquay-pdf-reading-heatmap-bar-visible-v1';
const USER_SCROLL_RESTORE_GUARD_MS = 700;
const SCROLL_EMIT_TRAILING_MS = 360;

// pdfjs-dist 的运行时句柄与官方 .d.ts 存在差异，只在边界处集中用别名标注。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs 运行时 API 与类型声明不一致
type PdfJsLoose = any;

type MutableRef<T> = { current: T };
type NumberStateSetter = (value: number | ((current: number) => number)) => void;
type OutlineCollapsedIdsSetter = (
  value: Set<string> | ((current: Set<string>) => Set<string>),
) => void;

interface UsePdfScrollRestoreOptions {
  active: boolean;
  activeHighlight: PdfHighlightTarget | null;
  blockById: Map<string, PositionedMineruBlock>;
  containerRef: MutableRef<HTMLDivElement | null>;
  currentPage: number;
  currentPageRef: MutableRef<number>;
  documentInit: PdfJsDocumentInit | null;
  enableReadingHeatmap: boolean;
  highlightScrollSignal: number;
  lastPageSyncTokenRef: MutableRef<number>;
  loading: boolean;
  onPageChange?: (page: number) => void;
  onPageSyncApplied?: (page: number, token: number) => void;
  onReadingHeatmapChange?: (heatmap: PdfReadingHeatmap) => void;
  onScrollPositionChange?: (position: PdfScrollPosition) => void;
  pageCount: number;
  pageCountRef: MutableRef<number>;
  pageHosts: Record<number, PageHostState>;
  pageSyncSignal?: { context: string; page: number; token: number } | null;
  pagesInitialized: boolean;
  pdfDocumentRef: MutableRef<PdfJsLoose>;
  pdfViewerRef: MutableRef<PdfJsLoose>;
  readingHeatmap: PdfReadingHeatmap | null;
  resolveOriginalPageForSources: (
    pageIndex: number,
    renderedPage: PageSize,
    sources: BBoxPageSizeSource[],
  ) => PageSize | null;
  restoredScrollKeyRef: MutableRef<string>;
  scrollPosition: PdfScrollPosition | null;
  setCurrentPage: NumberStateSetter;
  setOutlineCollapsedIds: OutlineCollapsedIdsSetter;
  smoothScroll: boolean;
  sourceSignature: string;
  sourceSignatureRef: MutableRef<string>;
  syncPageHosts: () => boolean;
  viewerRef: MutableRef<HTMLDivElement | null>;
}

function setNumberStateIfChanged(setter: NumberStateSetter, value: number) {
  setter((current) => (current === value ? current : value));
}

export function usePdfScrollRestore({
  active,
  activeHighlight,
  blockById,
  containerRef,
  currentPage,
  currentPageRef,
  documentInit,
  enableReadingHeatmap,
  highlightScrollSignal,
  lastPageSyncTokenRef,
  loading,
  onPageChange,
  onPageSyncApplied,
  onReadingHeatmapChange,
  onScrollPositionChange,
  pageCount,
  pageCountRef,
  pageHosts,
  pageSyncSignal,
  pagesInitialized,
  pdfDocumentRef,
  pdfViewerRef,
  readingHeatmap,
  resolveOriginalPageForSources,
  restoredScrollKeyRef,
  scrollPosition,
  setCurrentPage,
  setOutlineCollapsedIds,
  smoothScroll,
  sourceSignature,
  sourceSignatureRef,
  syncPageHosts,
  viewerRef,
}: UsePdfScrollRestoreOptions) {
  const [readingProgressRatio, setReadingProgressRatio] = useState(0);
  const [readingHeatmapBarVisible, setReadingHeatmapBarVisible] = useState(() =>
    loadStoredBoolean(PDF_READING_HEATMAP_BAR_VISIBLE_STORAGE_KEY, true),
  );
  const scrollPositionRef = useRef<PdfScrollPosition | null>(scrollPosition);
  const restoringScrollRef = useRef(false);
  const externalScrollRestoreKeyRef = useRef('');
  const pendingScrollRestoreKeyRef = useRef('');
  const lastUserScrollAtRef = useRef(0);
  const lastHandledHighlightSignalRef = useRef(0);
  const scrollRestoreSchedulerRef = useRef(createScrollRestoreScheduler((callback) => {
    window.requestAnimationFrame(callback);
  }));

  const buildCurrentScrollPosition = useCallback((): PdfScrollPosition | null => {
    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !sourceSignature) {
      return null;
    }

    const { page, pageElement } = resolveScrollAnchorPage(
      container,
      viewer,
      currentPageRef.current || 1,
    );
    const pageHeight = pageElement ? getPageElementHeight(pageElement) : 0;
    const pageOffsetTop = pageElement
      ? Math.max(0, container.scrollTop - pageElement.offsetTop)
      : 0;

    return {
      sourceKey: sourceSignature,
      top: Math.max(0, container.scrollTop),
      left: Math.max(0, container.scrollLeft),
      page,
      pageOffsetTop,
      pageOffsetRatio: pageHeight > 0 ? clampScrollRatio(pageOffsetTop / pageHeight) : undefined,
      pageHeight: pageHeight > 0 ? pageHeight : undefined,
      updatedAt: Date.now(),
    };
  }, [sourceSignature]);

  // 页数变化只更新进度计算，不能改变布局回调身份而触发同源 PDF 重载。
  const updateLocalScrollPosition = useCallback((options?: { syncPageState?: boolean }) => {
    const nextPosition = buildCurrentScrollPosition();

    if (!nextPosition) {
      return null;
    }

    scrollPositionRef.current = nextPosition;
    setNumberStateIfChanged(
      setReadingProgressRatio,
      getPdfReadingProgressRatio(nextPosition, pageCountRef.current),
    );

    if (currentPageRef.current !== nextPosition.page) {
      currentPageRef.current = nextPosition.page;

      if (options?.syncPageState !== false) {
        setNumberStateIfChanged(setCurrentPage, nextPosition.page);
      }
    }

    return nextPosition;
  }, [buildCurrentScrollPosition]);

  const emitScrollPosition = useCallback((options?: { syncPageState?: boolean }) => {
    if (!onScrollPositionChange) {
      return;
    }

    const nextPosition = updateLocalScrollPosition(options) ?? scrollPositionRef.current;

    if (!nextPosition) {
      return;
    }

    const sourceKey = sourceSignatureRef.current;

    if (!sourceKey || nextPosition.sourceKey !== sourceKey) {
      return;
    }

    onScrollPositionChange(nextPosition);
  }, [onScrollPositionChange, updateLocalScrollPosition]);

  const getSavedScrollPage = useCallback((pagesCount?: number) => {
    const position = scrollPositionRef.current;
    const sourceKey = sourceSignatureRef.current;

    if (!position || !sourceKey || position.sourceKey !== sourceKey) {
      return 1;
    }

    const page = Math.max(1, Math.round(position.page || 1));

    return pagesCount && pagesCount > 0 ? Math.min(page, pagesCount) : page;
  }, []);

  const applySavedScrollPosition = useCallback((options?: { force?: boolean }) => {
    const force = Boolean(options?.force);

    if (!force && Date.now() - lastUserScrollAtRef.current < USER_SCROLL_RESTORE_GUARD_MS) {
      return false;
    }

    const position = scrollPositionRef.current;
    const sourceKey = sourceSignatureRef.current;

    if (!position || !sourceKey || position.sourceKey !== sourceKey) {
      return false;
    }

    const restoreKey = buildScrollRestoreKey(position);

    if (!force && restoredScrollKeyRef.current === restoreKey) {
      return true;
    }

    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !viewer) {
      return false;
    }

    const page = getSavedScrollPage();
    const pageElement = viewer.querySelector<HTMLDivElement>(
      `.page[data-page-number="${page}"]`,
    );
    const pageHeight = pageElement ? getPageElementHeight(pageElement) : 0;

    if (
      !pageElement ||
      pageHeight <= 0 ||
      (position.top > 0 && container.scrollHeight <= container.clientHeight)
    ) {
      return false;
    }

    const pageOffsetTop =
      typeof position.pageOffsetRatio === 'number' && pageHeight > 0
        ? clampScrollRatio(position.pageOffsetRatio) * pageHeight
        : Math.max(0, position.pageOffsetTop || 0);
    const rawTop = pageElement.offsetTop + pageOffsetTop;
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const top = Math.min(Math.max(0, rawTop), maxTop);
    const left = Math.min(Math.max(0, position.left), maxLeft);

    restoringScrollRef.current = true;
    scrollInstantly(container, { top, left });
    currentPageRef.current = page;
    setNumberStateIfChanged(setCurrentPage, page);
    restoredScrollKeyRef.current = restoreKey;

    if (pendingScrollRestoreKeyRef.current === restoreKey) {
      pendingScrollRestoreKeyRef.current = '';
    }

    window.setTimeout(() => {
      const appliedPosition = updateLocalScrollPosition({ syncPageState: false });

      if (appliedPosition) {
        restoredScrollKeyRef.current = buildScrollRestoreKey(appliedPosition);
      }

      restoringScrollRef.current = false;
    }, 80);

    return true;
  }, [getSavedScrollPage, updateLocalScrollPosition, restoredScrollKeyRef]);

  const primeSavedScrollPage = useCallback((pdfViewer: PdfJsLoose, pagesCount?: number) => {
    const page = getSavedScrollPage(pagesCount);

    currentPageRef.current = page;
    setNumberStateIfChanged(setCurrentPage, page);

    try {
      const viewerPageCount =
        typeof pdfViewer?.pagesCount === 'number' ? pdfViewer.pagesCount : 0;

      if (pdfViewer?.pdfDocument && page > 0 && viewerPageCount >= page) {
        pdfViewer.currentPageNumber = page;
      } else if (pdfViewer?.pdfDocument && page > 0 && '_currentPageNumber' in pdfViewer) {
        pdfViewer._currentPageNumber = page;
      }
    } catch {
      // PDF.js may reject page changes before pages are initialized.
    }

    return page;
  }, [getSavedScrollPage]);

  const restoreSavedScroll = useCallback((options?: { force?: boolean }) => {
    const force = Boolean(options?.force);

    if (!force && Date.now() - lastUserScrollAtRef.current < USER_SCROLL_RESTORE_GUARD_MS) {
      return;
    }

    const position = scrollPositionRef.current;
    const sourceKey = sourceSignatureRef.current;

    if (!position || !sourceKey || position.sourceKey !== sourceKey) {
      return;
    }

    const restoreKey = buildScrollRestoreKey(position);

    if (!force && restoredScrollKeyRef.current === restoreKey) {
      return;
    }

    scrollRestoreSchedulerRef.current.schedule(() => applySavedScrollPosition({ force }));
  }, [applySavedScrollPosition]);

  const hasPendingExternalScrollRestore = useCallback(() => {
    const pendingRestoreKey = pendingScrollRestoreKeyRef.current;
    const position = scrollPositionRef.current;
    const sourceKey = sourceSignatureRef.current;

    if (!pendingRestoreKey || !position || !sourceKey || position.sourceKey !== sourceKey) {
      return false;
    }

    return pendingRestoreKey === buildScrollRestoreKey(position);
  }, []);

  const retrySavedScrollRestore = useCallback(() => {
    restoreSavedScroll({ force: hasPendingExternalScrollRestore() });
  }, [hasPendingExternalScrollRestore, restoreSavedScroll]);

  useEffect(() => {
    scrollRestoreSchedulerRef.current.cancel();
    sourceSignatureRef.current = sourceSignature;
    restoredScrollKeyRef.current = '';
    externalScrollRestoreKeyRef.current = '';
    pendingScrollRestoreKeyRef.current = '';
    lastUserScrollAtRef.current = 0;
    setOutlineCollapsedIds(loadOutlineCollapsedIds(sourceSignature));
  }, [sourceSignature]);

  useEffect(() => {
    const currentPosition = scrollPositionRef.current;

    if (!scrollPosition) {
      if (!sourceSignature || currentPosition?.sourceKey !== sourceSignature) {
        scrollPositionRef.current = null;
      }

      return;
    }

    if (scrollPosition.sourceKey !== sourceSignature) {
      return;
    }

    if (
      !currentPosition ||
      currentPosition.sourceKey !== scrollPosition.sourceKey ||
      scrollPosition.updatedAt >= currentPosition.updatedAt
    ) {
      scrollPositionRef.current = scrollPosition;
    }
  }, [scrollPosition, sourceSignature]);

  useEffect(() => {
    currentPageRef.current = currentPage;

    if (pageCount > 0) {
      onPageChange?.(currentPage);
    }
  }, [currentPage, onPageChange, pageCount]);

  useEffect(() => {
    if (!scrollPosition || !sourceSignature || scrollPosition.sourceKey !== sourceSignature) {
      return;
    }

    const currentPosition = scrollPositionRef.current;

    if (
      currentPosition &&
      currentPosition.sourceKey === scrollPosition.sourceKey &&
      currentPosition.updatedAt > scrollPosition.updatedAt
    ) {
      return;
    }

    const restoreKey = buildScrollRestoreKey(scrollPosition);

    if (
      externalScrollRestoreKeyRef.current === restoreKey &&
      restoredScrollKeyRef.current === restoreKey
    ) {
      return;
    }

    scrollPositionRef.current = scrollPosition;
    currentPageRef.current = Math.max(1, scrollPosition.page || 1);
    restoredScrollKeyRef.current = '';
    externalScrollRestoreKeyRef.current = restoreKey;
    pendingScrollRestoreKeyRef.current = restoreKey;
    restoreSavedScroll({ force: true });
  }, [restoreSavedScroll, scrollPosition, sourceSignature]);

  const scrollToPage = useCallback(
    (pageIndex: number, _behavior?: ScrollBehavior) => {
      const pageHost = pageHosts[pageIndex]?.element;
      const container = containerRef.current;

      const appliedPage = pageIndex + 1;

      try {
        if (pdfViewerRef.current?.pdfDocument) {
          pdfViewerRef.current.currentPageNumber = appliedPage;
        }
      } catch {
        // PDF.js may reject page changes while pages are still being initialized.
      }

      if (pageHost && container) {
        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const previousScrollBehavior = container.style.scrollBehavior;
        container.style.scrollBehavior = 'auto';
        container.scrollTo({
          top: Math.min(Math.max(0, pageHost.offsetTop), maxTop),
          left: container.scrollLeft,
          behavior: 'auto',
        });
        container.style.scrollBehavior = previousScrollBehavior;
      } else {
        pdfViewerRef.current?.scrollPageIntoView?.({
          pageNumber: appliedPage,
        });
      }

      currentPageRef.current = appliedPage;
      setNumberStateIfChanged(setCurrentPage, appliedPage);

      window.requestAnimationFrame(() => {
        syncPageHosts();
        window.requestAnimationFrame(syncPageHosts);
      });
    },
    [pageHosts, smoothScroll, syncPageHosts],
  );

  useEffect(() => {
    if (!pageSyncSignal || pageSyncSignal.token === lastPageSyncTokenRef.current) {
      return;
    }

    if (pageSyncSignal.context !== sourceSignature) {
      return;
    }

    if (
      !Number.isFinite(pageSyncSignal.page) ||
      pageSyncSignal.page <= 0 ||
      pageCount <= 0 ||
      !pagesInitialized ||
      !pdfDocumentRef.current
    ) {
      return;
    }

    const targetIndex = Math.min(
      Math.max(0, Math.round(pageSyncSignal.page) - 1),
      pageCount - 1,
    );

    // Wait until PDF.js has materialized the target page. Consuming the token before
    // pagesinit lets the subsequent saved-position restore overwrite the sync jump.
    if (!pageHosts[targetIndex]?.element) {
      return;
    }

    lastPageSyncTokenRef.current = pageSyncSignal.token;
    const appliedPage = targetIndex + 1;

    if (appliedPage === currentPageRef.current) {
      onPageSyncApplied?.(appliedPage, pageSyncSignal.token);
      return;
    }

    // 对照同步必须即时定位，避免平滑滚动途经中间页时反向触发另一栏。
    scrollToPage(targetIndex, 'auto');
    onPageSyncApplied?.(appliedPage, pageSyncSignal.token);
  }, [onPageSyncApplied, pageSyncSignal, pageCount, pageHosts, pagesInitialized, scrollToPage, sourceSignature]);

  const scrollToReadingProgress = useCallback(
    (progressRatio: number) => {
      const safeRatio = Number.isFinite(progressRatio)
        ? Math.min(0.999999, Math.max(0, progressRatio))
        : 0;
      const targetPageIndex = Math.min(
        Math.max(0, pageCount - 1),
        Math.max(0, Math.floor(safeRatio * Math.max(1, pageCount))),
      );
      const pageHost = pageHosts[targetPageIndex]?.element;
      const container = containerRef.current;

      if (!container || !pageHost || pageCount <= 0) {
        scrollToPage(targetPageIndex);
        return;
      }

      const pageProgress = safeRatio * pageCount - targetPageIndex;
      const top = pageHost.offsetTop + Math.max(0, pageHost.clientHeight * pageProgress);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);

      restoringScrollRef.current = true;
      container.scrollTo({
        top: Math.min(Math.max(0, top), maxTop),
        left: container.scrollLeft,
        behavior: smoothScroll ? 'smooth' : 'auto',
      });
      currentPageRef.current = targetPageIndex + 1;
      setNumberStateIfChanged(setCurrentPage, targetPageIndex + 1);
      setNumberStateIfChanged(setReadingProgressRatio, safeRatio);

      window.setTimeout(() => {
        restoringScrollRef.current = false;
        emitScrollPosition();
      }, smoothScroll ? 280 : 80);
    },
    [emitScrollPosition, pageCount, pageHosts, scrollToPage, smoothScroll],
  );

  const { heatmap: localReadingHeatmap, maxBinMs: maxReadingHeatmapBinMs } =
    usePdfReadingHeatmap({
      sourceKey: sourceSignature,
      pageCount,
      heatmap: readingHeatmap,
      active: Boolean(active && enableReadingHeatmap && documentInit && sourceSignature && pageCount > 0 && !loading),
      displayActive: readingHeatmapBarVisible,
      getCurrentScrollPosition: buildCurrentScrollPosition,
      onChange: enableReadingHeatmap ? onReadingHeatmapChange : undefined,
    });

  useEffect(() => {
    setNumberStateIfChanged(
      setReadingProgressRatio,
      getPdfReadingProgressRatio(scrollPositionRef.current, pageCount),
    );
  }, [pageCount, sourceSignature]);

  const scrollToHighlight = useCallback(
    (highlight: PdfHighlightTarget, options?: { retry?: boolean }) => {
      scrollRestoreSchedulerRef.current.cancel();
      pendingScrollRestoreKeyRef.current = '';
      lastUserScrollAtRef.current = Date.now();
      if (scrollPositionRef.current) {
        restoredScrollKeyRef.current = buildScrollRestoreKey(scrollPositionRef.current);
      }
      const retry = () => {
        if (options?.retry === false) {
          return;
        }

        window.setTimeout(() => {
          syncPageHosts();
          scrollToHighlight(highlight, { retry: false });
        }, 120);
      };
      const container = containerRef.current;
      const viewer = viewerRef.current;

      if (!container) {
        scrollToPage(highlight.pageIndex);
        retry();
        return;
      }

      const hostedPage = pageHosts[highlight.pageIndex];
      const pageElement =
        hostedPage?.element ??
        viewer?.querySelector<HTMLDivElement>(
          `.page[data-page-number="${highlight.pageIndex + 1}"]`,
        ) ??
        null;
      const renderedPage = hostedPage
        ? { width: hostedPage.width, height: hostedPage.height }
        : pageElement
          ? getRenderedPageSize(pageElement)
          : null;

      if (!pageElement || !renderedPage) {
        scrollToPage(highlight.pageIndex);
        retry();
        return;
      }

      const sourceBlock = blockById.get(highlight.blockId) ?? highlight;
      const originalPage = resolveOriginalPageForSources(
        highlight.pageIndex,
        renderedPage,
        [sourceBlock],
      );

      if (!originalPage) {
        scrollToPage(highlight.pageIndex);
        retry();
        return;
      }

      const targetRect = bboxToRect(
        highlight.bbox,
        resolveBBoxBaseSize(sourceBlock, originalPage),
        renderedPage,
      );
      const viewportLead = Math.min(180, Math.max(72, container.clientHeight * 0.28));
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const top = Math.min(Math.max(0, pageElement.offsetTop + targetRect.top - viewportLead), maxTop);
      const left = Math.min(Math.max(0, container.scrollLeft), maxLeft);
      const page = highlight.pageIndex + 1;

      restoringScrollRef.current = true;
      scrollInstantly(container, { top, left });
      currentPageRef.current = page;
      setNumberStateIfChanged(setCurrentPage, page);
      updateLocalScrollPosition();

      window.requestAnimationFrame(() => {
        syncPageHosts();
        window.requestAnimationFrame(syncPageHosts);
      });

      window.setTimeout(() => {
        restoringScrollRef.current = false;
        emitScrollPosition();
      }, 80);
    },
    [
      blockById,
      emitScrollPosition,
      pageHosts,
      resolveOriginalPageForSources,
      scrollToPage,
      syncPageHosts,
      updateLocalScrollPosition,
    ],
  );

  useEffect(() => {
    const container = containerRef.current;

    if (!active || !container || !onScrollPositionChange || !sourceSignature) {
      return undefined;
    }

    let trailingTimer = 0;
    let scrollPositionFrame = 0;

    const flushLocalScrollPosition = () => {
      scrollPositionFrame = 0;
      updateLocalScrollPosition();
    };

    const handleScroll = () => {
      if (restoringScrollRef.current) {
        return;
      }

      if (hasPendingExternalScrollRestore()) {
        return;
      }

      lastUserScrollAtRef.current = Date.now();

      if (scrollPositionFrame === 0) {
        scrollPositionFrame = window.requestAnimationFrame(flushLocalScrollPosition);
      }

      if (trailingTimer !== 0) {
        window.clearTimeout(trailingTimer);
      }

      trailingTimer = window.setTimeout(() => {
        trailingTimer = 0;
        emitScrollPosition();
      }, SCROLL_EMIT_TRAILING_MS);
    };

    const cancelPendingExternalRestore = () => {
      scrollRestoreSchedulerRef.current.cancel();
      pendingScrollRestoreKeyRef.current = '';
      lastUserScrollAtRef.current = Date.now();
    };

    container.addEventListener('wheel', cancelPendingExternalRestore, { passive: true });
    container.addEventListener('pointerdown', cancelPendingExternalRestore, { passive: true });
    container.addEventListener('keydown', cancelPendingExternalRestore);
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (trailingTimer !== 0) {
        window.clearTimeout(trailingTimer);
      }

      if (scrollPositionFrame !== 0) {
        window.cancelAnimationFrame(scrollPositionFrame);
      }

      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', cancelPendingExternalRestore);
      container.removeEventListener('pointerdown', cancelPendingExternalRestore);
      container.removeEventListener('keydown', cancelPendingExternalRestore);

      // Do not measure hidden tab DOM during cleanup. The PDF viewer remains mounted,
      // so tab switching preserves the live scroll position without restoring.
    };
  }, [
    emitScrollPosition,
    hasPendingExternalScrollRestore,
    onScrollPositionChange,
    active,
    sourceSignature,
    updateLocalScrollPosition,
  ]);

  useEffect(() => {
    localStorage.setItem(
      PDF_READING_HEATMAP_BAR_VISIBLE_STORAGE_KEY,
      String(readingHeatmapBarVisible),
    );
  }, [readingHeatmapBarVisible]);

  useEffect(() => {
    if (!active || !activeHighlight || pageCount === 0 || loading ||
      !isHighlightScrollReady(pagesInitialized, Boolean(pageHosts[activeHighlight.pageIndex]?.element)) ||
      highlightScrollSignal === lastHandledHighlightSignalRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      lastHandledHighlightSignalRef.current = highlightScrollSignal;
      scrollToHighlight(activeHighlight);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, activeHighlight, highlightScrollSignal, loading, pageCount, pageHosts, pagesInitialized, scrollToHighlight]);

  return {
    getSavedScrollPage,
    localReadingHeatmap,
    maxReadingHeatmapBinMs,
    primeSavedScrollPage,
    readingHeatmapBarVisible,
    readingProgressRatio,
    restoreSavedScroll,
    retrySavedScrollRestore,
    scrollToPage,
    scrollToReadingProgress,
    setReadingHeatmapBarVisible,
  };
}
