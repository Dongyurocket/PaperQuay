import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnnotationEditorType,
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
} from 'pdfjs-dist';
import type {
  PaperAnnotation,
  PdfHighlightTarget,
  PositionedMineruBlock,
} from '../../../types/reader';
import type { PageSize } from '../../../utils/bbox';
import { perfMark, perfMeasure } from '../../../utils/perfTrace';
import { emitToast } from '../../../ui/toastBridge';
import {
  applyPdfAnnotationToolColors,
  buildPdfJsHighlightColorOptions,
  type PdfAnnotationToolColors,
} from '../annotationColors';
import type { AnnotationEditorTool } from '../PdfViewerToolbar';
import type { PdfJsDocumentInit } from '../pdfDocumentSource';
import {
  detachPdfViewerDocument,
  isPdfDocumentUsable,
  isPdfLifecycleCancellation,
  releasePdfDocument,
  releasePdfDocumentSoon,
  releasePdfLoadingTask,
  suppressPdfLifecycleRejection,
} from '../pdfViewerUtils';
import { resolveToolMode } from './usePdfAnnotations';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDF_VIEWER_MAX_CANVAS_PIXELS = 5_242_880;

// pdfjs-dist 的运行时句柄与官方 .d.ts 存在差异（自定义 saveDocument、
// annotationEditorMode 对象写法等），只在边界处集中用别名标注。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs 运行时 API 与类型声明不一致
type PdfJsLoose = any;

type LocaleText = (zh: string, en: string) => string;
type MutableRef<T> = { current: T };
type NumberStateSetter = (value: number | ((current: number) => number)) => void;
type StringStateSetter = (value: string | ((current: string) => string)) => void;
type BooleanStateSetter = (value: boolean | ((current: boolean) => boolean)) => void;

export type BBoxPageSizeSource = Pick<
  PositionedMineruBlock | PdfHighlightTarget | PaperAnnotation,
  'bboxCoordinateSystem' | 'bboxPageSize'
> | null;

/** Scroll/overlay/page APIs that later hooks expose to the PDF.js lifecycle effects. */
export interface PdfViewerLayoutApi {
  clearPendingBlockSelect?: () => void;
  clearSelectionCommitTimer?: () => void;
  getSavedScrollPage?: (pagesCount?: number) => number;
  primeSavedScrollPage?: (pdfViewer: PdfJsLoose, pagesCount?: number) => number;
  refreshPdfViewerLayout?: () => void;
  resetPageHosts?: () => void;
  resetPageThumbnails?: () => void;
  restoreSavedScroll?: (options?: { force?: boolean }) => void;
  retrySavedScrollRestore?: () => void;
  syncPageHosts?: () => boolean;
}

interface UsePdfDocumentLifecycleOptions {
  active: boolean;
  annotationColors: PdfAnnotationToolColors;
  containerRef: MutableRef<HTMLDivElement | null>;
  currentPageRef: MutableRef<number>;
  documentInit: PdfJsDocumentInit | null;
  editorToolRef: MutableRef<AnnotationEditorTool>;
  l: LocaleText;
  lRef: MutableRef<LocaleText>;
  lastPageSyncTokenRef: MutableRef<number>;
  onDocumentErrorChange?: (error: string) => void;
  onPageCountChange?: (pageCount: number) => void;
  pane: 'reader' | 'compare-original' | 'compare-translated';
  restoredScrollKeyRef: MutableRef<string>;
  setCurrentPage: NumberStateSetter;
  setHasSelectedEditor: BooleanStateSetter;
  sourceSignature: string;
  viewerApiRef: MutableRef<PdfViewerLayoutApi>;
  viewerRef: MutableRef<HTMLDivElement | null>;
}

function sourceNeedsPdfPageSize(source: BBoxPageSizeSource): boolean {
  return Boolean(
    source &&
      source.bboxCoordinateSystem !== 'normalized-1000' &&
      !source.bboxPageSize,
  );
}

export function resolveOverlayOriginalPage(
  cachedPageSize: PageSize | undefined,
  renderedPage: PageSize,
  sources: BBoxPageSizeSource[],
): PageSize | null {
  if (cachedPageSize) {
    return cachedPageSize;
  }

  return sources.some(sourceNeedsPdfPageSize) ? null : renderedPage;
}

function setNumberStateIfChanged(setter: NumberStateSetter, value: number) {
  setter((current) => (current === value ? current : value));
}

function setStringStateIfChanged(setter: StringStateSetter, value: string) {
  setter((current) => (current === value ? current : value));
}

function setBooleanStateIfChanged(setter: BooleanStateSetter, value: boolean) {
  setter((current) => (current === value ? current : value));
}

export function usePdfDocumentLifecycle({
  active,
  annotationColors,
  containerRef,
  currentPageRef,
  documentInit,
  editorToolRef,
  l,
  lRef,
  lastPageSyncTokenRef,
  onDocumentErrorChange,
  onPageCountChange,
  pane,
  restoredScrollKeyRef,
  setCurrentPage,
  setHasSelectedEditor,
  sourceSignature,
  viewerApiRef,
  viewerRef,
}: UsePdfDocumentLifecycleOptions) {
  const [retryRevision, setRetryRevision] = useState(0);
  const [loadedPageCount, setLoadedPageCount] = useState<{
    documentInit: PdfJsDocumentInit;
    revision: number;
    count: number;
  } | null>(null);
  // 换源时立即停止使用旧文档页数；缓存页签重新激活时也向父层同步。
  const pageCount = loadedPageCount?.documentInit === documentInit && loadedPageCount.revision === retryRevision
    ? loadedPageCount.count : 0;
  const pageCountRef = useRef(0);
  pageCountRef.current = pageCount;
  useEffect(() => {
    onPageCountChange?.(pageCount);
  }, [active, onPageCountChange, pageCount]);

  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const pageSizesRef = useRef<Record<number, PageSize>>({});
  const pendingPageSizeRequestsRef = useRef<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [renderedDocument, setRenderedDocument] = useState<{ documentInit: PdfJsDocumentInit; revision: number } | null>(null);
  const [initializedDocument, setInitializedDocument] = useState<{ documentInit: PdfJsDocumentInit; revision: number } | null>(null);
  const pagesInitialized = initializedDocument?.documentInit === documentInit && initializedDocument.revision === retryRevision;
  const firstPageRendered = renderedDocument?.documentInit === documentInit && renderedDocument.revision === retryRevision;
  const [zoomLabel, setZoomLabel] = useState('100%');

  const [documentErrorSnapshot, setDocumentErrorSnapshot] = useState<{
    documentInit: PdfJsDocumentInit | null;
    revision: number;
    message: string;
  } | null>(null);
  const documentError = documentErrorSnapshot?.documentInit === documentInit &&
    documentErrorSnapshot.revision === retryRevision ? documentErrorSnapshot.message : '';
  const setDocumentError = useCallback((message: string) => {
    setDocumentErrorSnapshot({ documentInit, revision: retryRevision, message });
  }, [documentInit, retryRevision]);
  useEffect(() => {
    onDocumentErrorChange?.(documentError);
  }, [onDocumentErrorChange, documentError]);
  useEffect(() => {
    if (!documentError) {
      return;
    }

    emitToast({
      tone: 'error',
      key: `pdf-error:${paneRef.current}:${documentError}`,
      message: documentError,
    });
  }, [documentError]);

  const pdfViewerRef = useRef<PdfJsLoose>(null);
  const pdfDocumentRef = useRef<PdfJsLoose>(null);
  const eventBusRef = useRef<PdfJsLoose>(null);
  const linkServiceRef = useRef<PdfJsLoose>(null);
  const loadingTaskRef = useRef<PdfJsLoose>(null);
  const annotationEditorUiManagerRef = useRef<PdfJsLoose>(null);
  const annotationEditorReadyRef = useRef(false);
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const firstPageRenderLoggedRef = useRef(false);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    window.addEventListener('unhandledrejection', suppressPdfLifecycleRejection);
    return () => {
      window.removeEventListener('unhandledrejection', suppressPdfLifecycleRejection);
    };
  }, []);

  useEffect(() => {
    setZoomLabel((current) =>
      current === 'Fit Width' || current === '适合宽度' ? l('适合宽度', 'Fit width') : current,
    );
  }, [l]);

  const requestPageSize = useCallback((pageIndex: number) => {
    const pdfDocument = pdfDocumentRef.current;

    if (
      !pdfDocument ||
      !isPdfDocumentUsable(pdfDocument) ||
      pageIndex < 0 ||
      pageIndex >= pageCount ||
      pageSizesRef.current[pageIndex] ||
      pendingPageSizeRequestsRef.current.has(pageIndex)
    ) {
      return;
    }

    pendingPageSizeRequestsRef.current.add(pageIndex);

    void pdfDocument
      .getPage(pageIndex + 1)
      .then((page: PdfJsLoose) => {
        if (pdfDocumentRef.current !== pdfDocument) {
          page?.cleanup?.();
          return;
        }

        const viewport = page.getViewport({ scale: 1 });
        const pageSize = {
          width: viewport.width,
          height: viewport.height,
        };

        pageSizesRef.current = {
          ...pageSizesRef.current,
          [pageIndex]: pageSize,
        };
        setPageSizes(pageSizesRef.current);
        page?.cleanup?.();
      })
      .catch((pageError: unknown) => {
        if (!isPdfLifecycleCancellation(pageError)) {
          console.debug('[paperquay] Failed to resolve PDF page size', pageIndex + 1, pageError);
        }
      })
      .finally(() => {
        pendingPageSizeRequestsRef.current.delete(pageIndex);
      });
  }, [pageCount]);

  const resolveOriginalPageForSources = useCallback(
    (pageIndex: number, renderedPage: PageSize, sources: BBoxPageSizeSource[]) => {
      const originalPage = resolveOverlayOriginalPage(
        pageSizesRef.current[pageIndex],
        renderedPage,
        sources,
      );

      if (!originalPage) {
        requestPageSize(pageIndex);
      }

      return originalPage;
    },
    [requestPageSize],
  );

  useEffect(() => {
    setLoadedPageCount(null);
    lastPageSyncTokenRef.current = 0;
    pageSizesRef.current = {};
    pendingPageSizeRequestsRef.current.clear();
    setPageSizes({});
    viewerApiRef.current.resetPageHosts?.();
    const initialPage = viewerApiRef.current.getSavedScrollPage?.() ?? 1;

    currentPageRef.current = initialPage;
    restoredScrollKeyRef.current = '';
    setNumberStateIfChanged(setCurrentPage, initialPage);
    setStringStateIfChanged(setZoomLabel, '100%');
    setDocumentError('');
    viewerApiRef.current.clearSelectionCommitTimer?.();
    viewerApiRef.current.clearPendingBlockSelect?.();
  }, [documentInit]);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !viewer || !documentInit) {
      if (!documentInit) {
        setLoadedPageCount(null);
        viewerApiRef.current.resetPageHosts?.();
        setNumberStateIfChanged(setCurrentPage, 1);
        setStringStateIfChanged(setZoomLabel, '100%');
      }

      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setDocumentError('');
    firstPageRenderLoggedRef.current = false;
    perfMark('pdf:document-load-start');

    let eventBus: PdfJsLoose = null;
    let linkService: PdfJsLoose = null;
    let handlePagesInit: (() => void) | null = null;
    let handlePageChanging: ((event: { pageNumber?: number }) => void) | null = null;
    let handleScaleChanging: ((event: { scale?: number }) => void) | null = null;
    let handlePageRendered: ((event: { error?: unknown }) => void) | null = null;
    let handleAnnotationEditorUiManager: ((event: { uiManager?: unknown }) => void) | null = null;
    let handleEditorStatesChanged:
      | ((event: { details?: { hasSelectedEditor?: boolean } }) => void)
      | null = null;

    void import('pdfjs-dist/web/pdf_viewer.mjs')
      .then(async ({ EventBus, PDFLinkService, PDFViewer: PdfJsViewer }) => {
        if (cancelled) {
          return;
        }

        eventBus = new EventBus();
        eventBusRef.current = eventBus;
        linkService = new PDFLinkService({ eventBus });
        linkServiceRef.current = linkService;
        viewer.textContent = '';

        const pdfViewer = new PdfJsViewer({
          container,
          viewer,
          eventBus,
          linkService,
          removePageBorders: true,
          annotationMode: AnnotationMode.ENABLE_FORMS,
          annotationEditorMode: AnnotationEditorType.NONE,
          enableHighlightFloatingButton: false,
          annotationEditorHighlightColors: buildPdfJsHighlightColorOptions(),
          enableHWA: true,
          maxCanvasPixels: PDF_VIEWER_MAX_CANVAS_PIXELS,
        } as PdfJsLoose);

        pdfViewerRef.current = pdfViewer;
        linkService.setViewer(pdfViewer);

        handleAnnotationEditorUiManager = (event) => {
          annotationEditorReadyRef.current = true;
          annotationEditorUiManagerRef.current = event.uiManager ?? null;
          applyPdfAnnotationToolColors(annotationEditorUiManagerRef.current, annotationColors);

          pdfViewer.annotationEditorMode = {
            mode: resolveToolMode(editorToolRef.current),
            isFromKeyboard: false,
          };
        };

        handleEditorStatesChanged = (event) => {
          setBooleanStateIfChanged(
            setHasSelectedEditor,
            Boolean(event.details?.hasSelectedEditor),
          );
        };

        handlePagesInit = () => {
          viewerApiRef.current.primeSavedScrollPage?.(pdfViewer, pdfViewer.pagesCount);
          pdfViewer.currentScaleValue = 'page-width';
          pdfViewer.update?.();
          setStringStateIfChanged(setZoomLabel, lRef.current('适合宽度', 'Fit width'));
          viewerApiRef.current.syncPageHosts?.();
          viewerApiRef.current.restoreSavedScroll?.({ force: true });
          setInitializedDocument({ documentInit, revision: retryRevision });
          window.requestAnimationFrame(() => viewerApiRef.current.refreshPdfViewerLayout?.());
        };

        handlePageChanging = (event) => {
          const pageNumber = Math.max(1, Math.round(event.pageNumber ?? 1));
          currentPageRef.current = pageNumber;
          setNumberStateIfChanged(setCurrentPage, pageNumber);
        };

        handleScaleChanging = (event) => {
          const scale = Number(event.scale);
          setStringStateIfChanged(
            setZoomLabel,
            Number.isFinite(scale)
              ? `${Math.round(scale * 100)}%`
              : lRef.current('适合宽度', 'Fit width'),
          );
        };

        handlePageRendered = (event) => {
          if (cancelled) return;
          if (event.error) {
            const error = event.error;
            console.error('PDF load failed', { pane: paneRef.current, generation, phase: 'page-render', type: error instanceof Error ? error.name : typeof error });
            setDocumentError(error instanceof Error ? error.message : lRef.current('PDF 页面渲染失败', 'Failed to render the PDF page'));
            return;
          }
          setRenderedDocument({ documentInit, revision: retryRevision });
          // 基线指标：首个 pagerendered 才是首屏可用的准确信号（loading=false 早于实际绘制）。
          if (!firstPageRenderLoggedRef.current) {
            firstPageRenderLoggedRef.current = true;
            perfMeasure('pdf:first-pagerendered', 'pdf:document-load-start');
          }

          if (viewerApiRef.current.syncPageHosts?.()) {
            viewerApiRef.current.retrySavedScrollRestore?.();
          }
        };

        eventBus.on('annotationeditoruimanager', handleAnnotationEditorUiManager);
        eventBus.on('annotationeditorstateschanged', handleEditorStatesChanged);
        eventBus.on('pagesinit', handlePagesInit);
        eventBus.on('pagechanging', handlePageChanging);
        eventBus.on('scalechanging', handleScaleChanging);
        eventBus.on('pagerendered', handlePageRendered);

        const loadingTask = getDocument(documentInit as PdfJsLoose);
        loadingTaskRef.current = loadingTask;
        const pdfDocument = await loadingTask.promise;

        if (cancelled) {
          releasePdfDocument(pdfDocument);
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        setLoadedPageCount({ documentInit, revision: retryRevision, count: pdfDocument.numPages });

        if (!cancelled && pdfDocumentRef.current === pdfDocument) {
          pdfViewer.setDocument(pdfDocument);
          linkService.setDocument(pdfDocument, null);
          viewerApiRef.current.primeSavedScrollPage?.(pdfViewer, pdfDocument.numPages);
          window.requestAnimationFrame(() => viewerApiRef.current.refreshPdfViewerLayout?.());
          setLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }

        console.error('PDF load failed', { pane: paneRef.current, generation, phase: 'document-load', type: loadError instanceof Error ? loadError.name : typeof loadError });
        setDocumentError(
          loadError instanceof Error
            ? loadError.message
            : lRef.current('PDF 渲染模块加载失败', 'Failed to load the PDF rendering module'),
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
      annotationEditorReadyRef.current = false;
      annotationEditorUiManagerRef.current = null;
      eventBusRef.current = null;
      linkServiceRef.current = null;
      setBooleanStateIfChanged(setHasSelectedEditor, false);

      if (eventBus && handleAnnotationEditorUiManager) {
        eventBus.off('annotationeditoruimanager', handleAnnotationEditorUiManager);
      }
      if (eventBus && handleEditorStatesChanged) {
        eventBus.off('annotationeditorstateschanged', handleEditorStatesChanged);
      }
      if (eventBus && handlePagesInit) {
        eventBus.off('pagesinit', handlePagesInit);
      }
      if (eventBus && handlePageChanging) {
        eventBus.off('pagechanging', handlePageChanging);
      }
      if (eventBus && handleScaleChanging) {
        eventBus.off('scalechanging', handleScaleChanging);
      }
      if (eventBus && handlePageRendered) {
        eventBus.off('pagerendered', handlePageRendered);
      }

      const pdfDocumentToDestroy = pdfDocumentRef.current;
      const pdfViewerToDetach = pdfViewerRef.current;
      detachPdfViewerDocument(pdfViewerToDetach, linkService);
      pdfDocumentRef.current = null;
      pdfViewerRef.current = null;
      viewerApiRef.current.resetPageThumbnails?.();
      viewer.textContent = '';

      const loadingTaskToDestroy = loadingTaskRef.current;
      loadingTaskRef.current = null;

      if (pdfDocumentToDestroy) {
        releasePdfDocumentSoon(pdfDocumentToDestroy);
      } else {
        releasePdfLoadingTask(loadingTaskToDestroy);
      }

      setLoading(false);
    };
  }, [documentInit, retryRevision, sourceSignature]);

  useEffect(() => {
    const container = containerRef.current;

    if (!active || !container) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();

      if (event.deltaY < 0) {
        pdfViewerRef.current?.increaseScale?.();
        return;
      }

      pdfViewerRef.current?.decreaseScale?.();
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [active, documentInit]);

  return {
    annotationEditorReadyRef,
    annotationEditorUiManagerRef,
    documentError,
    eventBusRef,
    firstPageRendered,
    linkServiceRef,
    loading,
    pageCount,
    pageCountRef,
    pageSizes,
    pagesInitialized,
    pdfDocumentRef,
    pdfViewerRef,
    requestPageSize,
    resolveOriginalPageForSources,
    setDocumentError,
    setRetryRevision,
    setZoomLabel,
    zoomLabel,
  };
}
