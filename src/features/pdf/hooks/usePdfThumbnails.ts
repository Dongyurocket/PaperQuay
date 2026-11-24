import { useCallback, useEffect, useRef, useState } from 'react';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import type { PdfJsDocumentInit } from '../pdfDocumentSource';
import {
  buildThumbnailPageIndexes,
  isPdfDocumentUsable,
  isPdfLifecycleCancellation,
  loadStoredBoolean,
  releaseCanvas,
} from '../pdfViewerUtils';
import type { PdfSidebarTab } from './usePdfOutline';

const PDF_THUMBNAILS_COLLAPSED_STORAGE_KEY = 'paperquay-pdf-thumbnails-collapsed-v2';
const PDF_SIDEBAR_TAB_STORAGE_KEY = 'paperquay-pdf-sidebar-tab-v1';
const THUMBNAIL_RENDER_IDLE_MS = 420;

// pdfjs-dist 的运行时句柄与官方 .d.ts 存在差异，只在边界处集中用别名标注。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs 运行时 API 与类型声明不一致
type PdfJsLoose = any;

type MutableRef<T> = { current: T };

interface UsePdfThumbnailsOptions {
  active: boolean;
  currentPage: number;
  documentInit: PdfJsDocumentInit | null;
  pageCount: number;
  pdfDocumentRef: MutableRef<PdfJsLoose>;
  thumbnailSidebarRef: MutableRef<HTMLElement | null>;
}

function loadStoredSidebarTab(): PdfSidebarTab {
  try {
    return window.localStorage.getItem(PDF_SIDEBAR_TAB_STORAGE_KEY) === 'outline'
      ? 'outline'
      : 'thumbnails';
  } catch {
    return 'thumbnails';
  }
}

export function usePdfThumbnails({
  active,
  currentPage,
  documentInit,
  pageCount,
  pdfDocumentRef,
  thumbnailSidebarRef,
}: UsePdfThumbnailsOptions) {
  const [thumbnailsCollapsed, setThumbnailsCollapsed] = useState(() =>
    loadStoredBoolean(PDF_THUMBNAILS_COLLAPSED_STORAGE_KEY, true),
  );
  const [sidebarTab, setSidebarTab] = useState<PdfSidebarTab>(() => loadStoredSidebarTab());
  const [pageThumbnails, setPageThumbnails] = useState<Record<number, string>>({});
  const [thumbnailFocusPage, setThumbnailFocusPage] = useState(1);
  const pageThumbnailsRef = useRef<Record<number, string>>({});
  const handleThumbnailWheelCapture = useWheelScrollDelegate({ rootRef: thumbnailSidebarRef });

  useEffect(() => {
    try {
      window.localStorage.setItem(PDF_SIDEBAR_TAB_STORAGE_KEY, sidebarTab);
    } catch {
      // 存储失败仅影响侧栏页签记忆
    }
  }, [sidebarTab]);

  useEffect(() => {
    localStorage.setItem(PDF_THUMBNAILS_COLLAPSED_STORAGE_KEY, String(thumbnailsCollapsed));
  }, [thumbnailsCollapsed]);

  useEffect(() => {
    pageThumbnailsRef.current = pageThumbnails;
  }, [pageThumbnails]);

  useEffect(() => {
    if (thumbnailsCollapsed) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setThumbnailFocusPage(currentPage);
    }, THUMBNAIL_RENDER_IDLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentPage, thumbnailsCollapsed]);

  const resetPageThumbnails = useCallback(() => {
    pageThumbnailsRef.current = {};
    setPageThumbnails({});
  }, []);

  useEffect(() => {
    const pdfDocument = pdfDocumentRef.current;

    if (!pdfDocument || pageCount <= 0) {
      if (Object.keys(pageThumbnailsRef.current).length > 0) {
        pageThumbnailsRef.current = {};
        setPageThumbnails({});
      }
      return;
    }

    if (!active) {
      return;
    }

    if (thumbnailsCollapsed) {
      return;
    }

    let cancelled = false;
    let activeRenderTask: PdfJsLoose = null;
    let activeCanvas: HTMLCanvasElement | null = null;
    let activePage: PdfJsLoose = null;
    const isCurrentDocument = () =>
      !cancelled && pdfDocumentRef.current === pdfDocument && isPdfDocumentUsable(pdfDocument);

    const pageIndexes = buildThumbnailPageIndexes(pageCount, thumbnailFocusPage);

    setPageThumbnails((current) => {
      const nextEntries = Object.entries(current).filter(([pageIndex]) =>
        pageIndexes.includes(Number(pageIndex)),
      );

      const next = Object.fromEntries(nextEntries);
      pageThumbnailsRef.current = next;
      return next;
    });

    const renderThumbnails = async () => {
      for (const pageIndex of pageIndexes) {
        if (!isCurrentDocument()) {
          return;
        }

        if (pageThumbnailsRef.current[pageIndex]) {
          continue;
        }

        let page: PdfJsLoose = null;
        let canvas: HTMLCanvasElement | null = null;

        try {
          page = await pdfDocument.getPage(pageIndex + 1);
          activePage = page;

          if (!isCurrentDocument()) {
            return;
          }

          const viewport = page.getViewport({ scale: 1 });
          const targetWidth = 136;
          const scale = targetWidth / Math.max(viewport.width, 1);
          const thumbnailViewport = page.getViewport({ scale });
          canvas = document.createElement('canvas');
          activeCanvas = canvas;
          const context = canvas.getContext('2d', { alpha: false });

          if (!context) {
            continue;
          }

          canvas.width = Math.max(1, Math.floor(thumbnailViewport.width));
          canvas.height = Math.max(1, Math.floor(thumbnailViewport.height));
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);

          const renderTask = page.render({
            canvasContext: context,
            viewport: thumbnailViewport,
          });

          activeRenderTask = renderTask;
          await renderTask.promise;
          activeRenderTask = null;

          if (!isCurrentDocument()) {
            return;
          }

          const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.78);

          setPageThumbnails((current) => {
            if (!isCurrentDocument() || current[pageIndex] === thumbnailUrl) {
              return current;
            }

            const next = {
              ...current,
              [pageIndex]: thumbnailUrl,
            };
            pageThumbnailsRef.current = next;
            return next;
          });
        } catch (thumbnailError) {
          if (!isCurrentDocument() || isPdfLifecycleCancellation(thumbnailError)) {
            return;
          }
        } finally {
          activeRenderTask = null;
          if (canvas) {
            releaseCanvas(canvas);
          }
          page?.cleanup?.();
          if (activeCanvas === canvas) {
            activeCanvas = null;
          }
          if (activePage === page) {
            activePage = null;
          }
        }
      }
    };

    void renderThumbnails();

    return () => {
      cancelled = true;
      try {
        activeRenderTask?.cancel?.();
      } catch {
        // Best-effort cancellation for stale PDF.js thumbnail renders.
      }
      if (activeCanvas) {
        releaseCanvas(activeCanvas);
        activeCanvas = null;
      }
      try {
        activePage?.cleanup?.();
      } catch {
        // Best-effort PDF.js page cleanup.
      }
      activePage = null;
    };
  }, [active, documentInit, pageCount, thumbnailFocusPage, thumbnailsCollapsed]);

  return {
    handleThumbnailWheelCapture,
    pageThumbnails,
    resetPageThumbnails,
    setSidebarTab,
    setThumbnailsCollapsed,
    sidebarTab,
    thumbnailsCollapsed,
  };
}
