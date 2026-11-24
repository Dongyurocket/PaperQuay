import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Images, ListTree } from 'lucide-react';
import 'pdfjs-dist/web/pdf_viewer.css';
import EmptyState from '../../components/EmptyState';
import { ContextMenu } from '../../components/ContextMenu';
import type { MineruOutlineIndexItem } from '../reader/mineruSegments.ts';
import type {
  PaperAnnotation,
  PdfBlockSelectContext,
  PdfHighlightTarget,
  PdfReadingHeatmap,
  PdfScrollPosition,
  PdfSource,
  PositionedMineruBlock,
  TextSelectionPayload,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import { useLocaleText } from '../../i18n/uiLanguage';
import { emitToast, emitToastDismiss } from '../../ui/toastBridge';
import { loadPdfAnnotationToolColors } from './annotationColors';
import { buildPdfJsDocumentInit, getPdfSourceSignature } from './pdfDocumentSource';
import { PdfPageOverlay } from './PdfPageOverlay';
import { PdfReadingHeatmapBar } from './PdfReadingHeatmapBar';
import { PdfThumbnailSidebar } from './PdfThumbnailSidebar';
import { PdfOutlinePanel } from './PdfOutlinePanel';
import {
  PdfViewerToolbar,
  type AnnotationEditorTool,
} from './PdfViewerToolbar';
import { getPdfZoomPresetValue, type PdfZoomPreset } from './toolbar/pdfToolbarLogic';
import { usePdfAnnotations } from './hooks/usePdfAnnotations';
import { usePdfBlockOverlay } from './hooks/usePdfBlockOverlay';
import {
  usePdfDocumentLifecycle,
  type PdfViewerLayoutApi,
} from './hooks/usePdfDocumentLifecycle';
import { usePdfOutline } from './hooks/usePdfOutline';
import { usePdfScrollRestore } from './hooks/usePdfScrollRestore';
import { usePdfSelection } from './hooks/usePdfSelection';
import { usePdfThumbnails } from './hooks/usePdfThumbnails';

let pdfViewerToastSequence = 0;

interface PdfViewerProps {
  pane?: 'reader' | 'compare-original' | 'compare-translated';
  onPageCountChange?: (pageCount: number) => void;
  onDocumentErrorChange?: (error: string) => void;
  source: PdfSource;
  pdfData: Uint8Array | null;
  scrollPosition?: PdfScrollPosition | null;
  /** 页码同步信号：token 变化时滚动到指定页（1-based），context 必须匹配当前 PDF */
  pageSyncSignal?: { context: string; page: number; token: number } | null;
  /** 同步信号实际应用后的页码（已按目标 PDF 页数 clamp） */
  onPageSyncApplied?: (page: number, token: number) => void;
  readingHeatmap?: PdfReadingHeatmap | null;
  currentPdfName?: string;
  defaultSaveDirectory?: string;
  originalPdfPath?: string;
  translating?: boolean;
  translationProgressCompleted?: number;
  translationProgressTotal?: number;
  hideToolbar?: boolean;
  blocks: PositionedMineruBlock[];
  mineruOutlineIndex?: readonly MineruOutlineIndexItem[] | null;
  annotations: PaperAnnotation[];
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  activeHighlight: PdfHighlightTarget | null;
  highlightScrollSignal?: number;
  selectedAnnotationId?: string | null;
  smoothScroll: boolean;
  active?: boolean;
  enableReadingHeatmap?: boolean;
  softPageShadow: boolean;
  onBlockHover: (block: PositionedMineruBlock | null) => void;
  onBlockSelect: (block: PositionedMineruBlock, context?: PdfBlockSelectContext) => void;
  /** 目录点击 MinerU 标题块时的跳转（父级复用结构块点击的激活+双侧同步逻辑） */
  onOutlineNavigateBlock?: (block: PositionedMineruBlock) => void;
  onAddBlockToNote?: (block: PositionedMineruBlock, selection: TextSelectionPayload) => void;
  blockClickOpensQuickActions?: boolean;
  onAnnotationSelect?: (annotationId: string) => void;
  onTextSelect?: (selection: TextSelectionPayload) => void;
  /** 当前页变化通知（1-based），包括工具栏跳页和滚动换页 */
  onPageChange?: (page: number) => void;
  onScrollPositionChange?: (position: PdfScrollPosition) => void;
  onReadingHeatmapChange?: (heatmap: PdfReadingHeatmap) => void;
  onSaveSuccess?: (path: string) => void;
}

function PdfViewer({
  pane = 'reader',
  onPageCountChange,
  onDocumentErrorChange,
  source,
  pdfData,
  scrollPosition = null,
  pageSyncSignal = null,
  onPageSyncApplied,
  readingHeatmap = null,
  currentPdfName = '',
  defaultSaveDirectory = '',
  originalPdfPath = '',
  translating = false,
  translationProgressCompleted = 0,
  translationProgressTotal = 0,
  hideToolbar = false,
  blocks,
  mineruOutlineIndex,
  annotations,
  activeBlockId,
  hoveredBlockId,
  activeHighlight,
  highlightScrollSignal = 0,
  selectedAnnotationId = null,
  smoothScroll,
  active = true,
  enableReadingHeatmap = true,
  softPageShadow,
  onBlockHover,
  onBlockSelect,
  onOutlineNavigateBlock,
  onAddBlockToNote,
  blockClickOpensQuickActions = false,
  onAnnotationSelect,
  onTextSelect,
  onPageChange,
  onScrollPositionChange,
  onReadingHeatmapChange,
  onSaveSuccess,
}: PdfViewerProps) {
  const l = useLocaleText();
  const documentInit = useMemo(() => buildPdfJsDocumentInit(source, pdfData), [pdfData, source]);
  // source 为空且由 pdfData 承载时，签名只由数据内容决定：重命名（currentPdfName）
  // 不能进入该分支的依赖，否则只会改文件名也会重新加载整份 PDF。
  const pdfNameFallback = !source && pdfData ? '' : currentPdfName;
  const sourceSignature = useMemo(
    () => getPdfSourceSignature(source, pdfNameFallback, pdfData),
    [pdfData, pdfNameFallback, source],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const thumbnailSidebarRef = useRef<HTMLElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const lRef = useRef(l);
  const activeRef = useRef(active);
  const currentPageRef = useRef(1);
  const sourceSignatureRef = useRef('');
  // 原逻辑在「sourceSignature 变化」effect 内赋值。此处置于渲染期，使同一提交中
  // 先执行的生命周期重置效果即可读到新的 sourceKey，保持换源首帧的页码语义。
  sourceSignatureRef.current = sourceSignature;
  const restoredScrollKeyRef = useRef('');
  const lastPageSyncTokenRef = useRef(0);
  const editorToolRef = useRef<AnnotationEditorTool>('none');
  const viewerApiRef = useRef<PdfViewerLayoutApi>({});
  const retrySavedScrollRestoreRef = useRef<() => void>(() => {});

  const [currentPage, setCurrentPage] = useState(1);
  const [hasSelectedEditor, setHasSelectedEditor] = useState(false);
  const [annotationColors, setAnnotationColors] = useState(() => loadPdfAnnotationToolColors());
  const [outlineCollapsedIds, setOutlineCollapsedIds] = useState<Set<string>>(() => new Set());

  // 每个 PdfViewer 实例独立的 toast key：多个标签页或对照窗格同时翻译时互不覆盖。
  const translationToastKeyRef = useRef('');
  if (!translationToastKeyRef.current) {
    pdfViewerToastSequence += 1;
    translationToastKeyRef.current = `pdf-translation:${pdfViewerToastSequence}`;
  }
  const translationToastKey = translationToastKeyRef.current;

  // 跨 hook 共享的引用同步（原 effect #4/#5），置于 hook 调用前以保持下游读取顺序。
  useEffect(() => {
    lRef.current = l;
  }, [l]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const key = translationToastKey;

    if (translating && translationProgressTotal > 0) {
      const progress = Math.min(
        100,
        Math.max(0, (translationProgressCompleted / translationProgressTotal) * 100),
      );
      emitToast({
        tone: 'progress',
        key,
        message: l('正在翻译 PDF 结构块', 'Translating PDF structure blocks'),
        description: `${translationProgressCompleted}/${translationProgressTotal} · ${Math.round(progress)}%`,
        duration: 0,
      });
      return;
    }

    emitToastDismiss(key);
  }, [l, translationToastKey, translating, translationProgressCompleted, translationProgressTotal]);

  useEffect(() => () => emitToastDismiss(translationToastKey), [translationToastKey]);

  const lifecycle = usePdfDocumentLifecycle({
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
  });

  const selection = usePdfSelection({
    active,
    activeRef,
    containerRef,
    editorToolRef,
    onTextSelect,
  });

  const overlay = usePdfBlockOverlay({
    active,
    activeBlockId,
    activeHighlight,
    activeRef,
    annotations,
    blockClickOpensQuickActions,
    blocks,
    clearPendingBlockSelect: selection.clearPendingBlockSelect,
    containerRef,
    currentPage,
    documentInit,
    editorToolRef,
    hoveredBlockId,
    l,
    onAddBlockToNote,
    onBlockHover,
    onBlockSelect,
    pageCount: lifecycle.pageCount,
    pageSizes: lifecycle.pageSizes,
    pageSyncSignal,
    pdfViewerRef: lifecycle.pdfViewerRef,
    pendingBlockSelectTimerRef: selection.pendingBlockSelectTimerRef,
    requestPageSize: lifecycle.requestPageSize,
    resolveOriginalPageForSources: lifecycle.resolveOriginalPageForSources,
    retrySavedScrollRestoreRef,
    sourceSignature,
    viewerRef,
  });

  const scroll = usePdfScrollRestore({
    active,
    activeHighlight,
    blockById: overlay.blockById,
    containerRef,
    currentPage,
    currentPageRef,
    documentInit,
    enableReadingHeatmap,
    highlightScrollSignal,
    lastPageSyncTokenRef,
    loading: lifecycle.loading,
    onPageChange,
    onPageSyncApplied,
    onReadingHeatmapChange,
    onScrollPositionChange,
    pageCount: lifecycle.pageCount,
    pageCountRef: lifecycle.pageCountRef,
    pageHosts: overlay.pageHosts,
    pageSyncSignal,
    pagesInitialized: lifecycle.pagesInitialized,
    pdfDocumentRef: lifecycle.pdfDocumentRef,
    pdfViewerRef: lifecycle.pdfViewerRef,
    readingHeatmap,
    resolveOriginalPageForSources: lifecycle.resolveOriginalPageForSources,
    restoredScrollKeyRef,
    scrollPosition,
    setCurrentPage,
    setOutlineCollapsedIds,
    smoothScroll,
    sourceSignature,
    sourceSignatureRef,
    syncPageHosts: overlay.syncPageHosts,
    viewerRef,
  });

  const annotationsState = usePdfAnnotations({
    active,
    annotationColors,
    annotationEditorReadyRef: lifecycle.annotationEditorReadyRef,
    annotationEditorUiManagerRef: lifecycle.annotationEditorUiManagerRef,
    clearPendingBlockSelect: selection.clearPendingBlockSelect,
    clearSelectionCommitTimer: selection.clearSelectionCommitTimer,
    containerRef,
    currentPdfName,
    defaultSaveDirectory,
    editorToolRef,
    eventBusRef: lifecycle.eventBusRef,
    hasSelectedEditor,
    lRef,
    onBlockHover,
    onSaveSuccess,
    originalPdfPath,
    pdfDocumentRef: lifecycle.pdfDocumentRef,
    pdfViewerRef: lifecycle.pdfViewerRef,
    setAnnotationColors,
    setDocumentError: lifecycle.setDocumentError,
    setHasLiveTextSelection: selection.setHasLiveTextSelection,
    setHasSelectedEditor,
    source,
  });

  const thumbnails = usePdfThumbnails({
    active,
    currentPage,
    documentInit,
    pageCount: lifecycle.pageCount,
    pdfDocumentRef: lifecycle.pdfDocumentRef,
    thumbnailSidebarRef,
  });

  const outline = usePdfOutline({
    blocks,
    currentPageRef,
    documentInit,
    linkServiceRef: lifecycle.linkServiceRef,
    lRef,
    mineruOutlineIndex,
    onOutlineNavigateBlock,
    outlineCollapsedIds,
    pageCount: lifecycle.pageCount,
    pdfDocumentRef: lifecycle.pdfDocumentRef,
    scrollToPage: scroll.scrollToPage,
    setOutlineCollapsedIds,
    sidebarTab: thumbnails.sidebarTab,
    sourceSignatureRef,
    thumbnailsCollapsed: thumbnails.thumbnailsCollapsed,
  });

  retrySavedScrollRestoreRef.current = scroll.retrySavedScrollRestore;
  viewerApiRef.current = {
    clearPendingBlockSelect: selection.clearPendingBlockSelect,
    clearSelectionCommitTimer: selection.clearSelectionCommitTimer,
    getSavedScrollPage: scroll.getSavedScrollPage,
    primeSavedScrollPage: scroll.primeSavedScrollPage,
    refreshPdfViewerLayout: overlay.refreshPdfViewerLayout,
    resetPageHosts: overlay.resetPageHosts,
    resetPageThumbnails: thumbnails.resetPageThumbnails,
    restoreSavedScroll: scroll.restoreSavedScroll,
    retrySavedScrollRestore: scroll.retrySavedScrollRestore,
    syncPageHosts: overlay.syncPageHosts,
  };

  if (!source && !pdfData) {
    return (
      <EmptyState
        title={l('等待打开 PDF', 'Open a PDF to start')}
        description={l('After opening a paper, the original PDF will appear here and stay linked with the MinerU blocks on the right.', 'After opening a paper, the original PDF will appear here and stay linked with the MinerU blocks on the right.',
        )}
      />
    );
  }

  if (!documentInit) {
    return (
      <EmptyState
        title={l('正在准备 PDF', 'Preparing the PDF')}
        description={l('The desktop app is loading the PDF content for this document.', 'The desktop app is loading the PDF content for this document.',
        )}
      />
    );
  }

  const canShowReadingHeatmapBar =
    enableReadingHeatmap && lifecycle.pageCount > 0 && Boolean(sourceSignature);
  const showReadingHeatmapBar = canShowReadingHeatmapBar && scroll.readingHeatmapBarVisible;
  const readingHeatmapToggleLabel = showReadingHeatmapBar
    ? l('隐藏阅读热力进度', 'Hide reading heat progress')
    : l('显示阅读热力进度', 'Show reading heat progress');
  const allowLinkedInteractions =
    annotationsState.editorTool === 'none' && !selection.hasLiveTextSelection;

  return (
    <div
      className="paperquay-pdf-linked flex h-full min-h-0 flex-col bg-[var(--pq-bg)]"
      data-soft-shadow={softPageShadow ? 'true' : 'false'}
      data-pdf-phase={lifecycle.documentError ? 'error' : lifecycle.firstPageRendered ? 'page-rendered' : lifecycle.pageCount ? 'document-ready' : 'loading-document'}
    >
      <PdfViewerToolbar
        activeColorTool={annotationsState.activeColorTool}
        annotationColors={annotationColors}
        canShowReadingHeatmapBar={canShowReadingHeatmapBar}
        currentPage={currentPage}
        editorTool={annotationsState.editorTool}
        enableReadingHeatmap={enableReadingHeatmap}
        hasLiveTextSelection={selection.hasLiveTextSelection}
        hasSelectedEditor={hasSelectedEditor}
        hideToolbar={hideToolbar}
        l={l}
        loading={lifecycle.loading}
        onActiveColorToolChange={annotationsState.setActiveColorTool}
        onAnnotationToolColorChange={annotationsState.updateAnnotationToolColor}
        onCreateHighlight={annotationsState.handleCreatePdfHighlight}
        onDeleteSelected={annotationsState.handleDeleteSelected}
        onEditorToolChange={annotationsState.setEditorTool}
        onSave={annotationsState.handleSave}
        onScrollToPage={scroll.scrollToPage}
        onToggleReadingHeatmapBar={() => scroll.setReadingHeatmapBarVisible((current) => !current)}
        onZoomIn={() => lifecycle.pdfViewerRef.current?.increaseScale?.()}
        onZoomOut={() => lifecycle.pdfViewerRef.current?.decreaseScale?.()}
        onZoomPresetChange={(preset: PdfZoomPreset) => {
          const pdfViewer = lifecycle.pdfViewerRef.current;

          if (!pdfViewer) {
            return;
          }

          pdfViewer.currentScaleValue = getPdfZoomPresetValue(preset);
          pdfViewer.update?.();
          lifecycle.setZoomLabel(
            preset === 'page-width'
              ? l('适合宽度', 'Fit width')
              : preset === 'page-fit'
                ? l('适合页面', 'Fit page')
                : '100%',
          );
        }}
        pageCount={lifecycle.pageCount}
        readingHeatmapToggleLabel={readingHeatmapToggleLabel}
        saving={annotationsState.saving}
        showReadingHeatmapBar={showReadingHeatmapBar}
        translating={translating}
        translationProgressCompleted={translationProgressCompleted}
        translationProgressTotal={translationProgressTotal}
        zoomLabel={lifecycle.zoomLabel}
      />

      <div className="relative flex min-h-0 flex-1">
        <PdfThumbnailSidebar
          ref={thumbnailSidebarRef}
          collapsed={thumbnails.thumbnailsCollapsed}
          pageCount={lifecycle.pageCount}
          currentPage={currentPage}
          pageThumbnails={thumbnails.pageThumbnails}
          onToggleCollapsed={() => thumbnails.setThumbnailsCollapsed((current) => !current)}
          onScrollToPage={scroll.scrollToPage}
          onWheelCapture={thumbnails.handleThumbnailWheelCapture}
          stripExtra={
            <>
              <button
                type="button"
                onClick={() => {
                  thumbnails.setSidebarTab('thumbnails');
                  thumbnails.setThumbnailsCollapsed(false);
                }}
                title={l('页面缩略图', 'Page thumbnails')}
                aria-label={l('页面缩略图', 'Page thumbnails')}
                aria-pressed={thumbnails.sidebarTab === 'thumbnails'}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-[var(--pq-radius-sm)] border transition',
                  thumbnails.sidebarTab === 'thumbnails' && !thumbnails.thumbnailsCollapsed
                    ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)] '
                    : 'border-[var(--pq-border)] bg-[var(--pq-surface-1)] text-[var(--pq-text-muted)] hover:border-[var(--pq-border-strong)] hover:bg-[var(--pq-surface-2)]',
                )}
              >
                <Images className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => {
                  thumbnails.setSidebarTab('outline');
                  thumbnails.setThumbnailsCollapsed(false);
                }}
                title={l('文档目录', 'Document outline')}
                aria-label={l('文档目录', 'Document outline')}
                aria-pressed={thumbnails.sidebarTab === 'outline'}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-[var(--pq-radius-sm)] border transition',
                  thumbnails.sidebarTab === 'outline' && !thumbnails.thumbnailsCollapsed
                    ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)] '
                    : 'border-[var(--pq-border)] bg-[var(--pq-surface-1)] text-[var(--pq-text-muted)] hover:border-[var(--pq-border-strong)] hover:bg-[var(--pq-surface-2)]',
                )}
              >
                <ListTree className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </>
          }
          contentOverride={
            thumbnails.sidebarTab === 'outline' ? (
              <PdfOutlinePanel
                items={outline.outlineItems ?? []}
                loading={outline.outlineLoading}
                currentPage={currentPage}
                collapsedIds={outlineCollapsedIds}
                onToggleCollapsed={outline.handleOutlineToggleCollapsed}
                onNavigate={outline.handleOutlineNavigate}
                canGoBack={outline.outlineBackCount > 0}
                onGoBack={outline.handleOutlineGoBack}
                errorMessage={outline.outlineError || undefined}
                l={l}
              />
            ) : undefined
          }
          contentTitle={l('文档目录', 'Document Outline')}
          l={l}
        />

        <div className="relative min-h-0 flex-1">
          {(lifecycle.loading || (lifecycle.pageCount > 0 && !lifecycle.firstPageRendered && !lifecycle.documentError)) ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--pq-bg-elevated)] backdrop-blur-sm">
            <div className="inline-flex items-center rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-4 py-2 text-sm text-[var(--pq-text-muted)] shadow-[var(--pq-shadow-float)]">
              {lifecycle.pageCount > 0 ? l('正在绘制 PDF 页面…', 'Rendering PDF page...') : l('正在加载 PDF…', 'Loading PDF...')}
            </div>
          </div>
          ) : null}

          {!lifecycle.loading && lifecycle.documentError ? (
            <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--pq-surface-1)] px-6 text-center text-sm">
              <div className="font-medium">{currentPdfName}</div>
              <div className="text-[var(--pq-danger)]">{lifecycle.documentError}</div>
              <button type="button" className="rounded border border-[var(--pq-border)] px-3 py-1" onClick={() => lifecycle.setRetryRevision((revision) => revision + 1)}>
                {l('重试', 'Retry')}
              </button>
            </div>
          ) : null}

        <div
          ref={containerRef}
          className={cn(
            'pdf-annotation-scroll absolute inset-0 overflow-auto px-5 pt-5',
            showReadingHeatmapBar ? 'pb-24' : 'pb-5',
          )}
          onMouseUp={active ? () => selection.scheduleSelectionCommit() : undefined}
          onKeyUp={active ? () => selection.scheduleSelectionCommit() : undefined}
        >
          <div ref={viewerRef} className="pdfViewer" />

          {overlay.overlayPageIndexes.map((pageIndex) => {
            const host = overlay.pageHosts[pageIndex];
            const renderedPage = host
              ? {
              width: host.width,
              height: host.height,
                }
              : null;

            if (!host || !renderedPage || renderedPage.width <= 0 || renderedPage.height <= 0) {
              return null;
            }

            const pageBlocks = overlay.blocksByPage.get(pageIndex) ?? [];
            const pageAnnotations = overlay.annotationsByPage.get(pageIndex) ?? [];
            const activeHighlightSource =
              activeHighlight && activeHighlight.pageIndex === pageIndex
                ? overlay.blockById.get(activeHighlight.blockId) ?? activeHighlight
                : null;
            const originalPage = overlay.resolveOverlayPageOriginal(pageIndex, renderedPage);

            if (!originalPage) {
              return null;
            }

            return createPortal(
              <PdfPageOverlay
                pageIndex={pageIndex}
                originalPage={originalPage}
                renderedPage={renderedPage}
                pageBlocks={pageBlocks}
                pageAnnotations={pageAnnotations}
                activeBlockId={activeBlockId}
                hoveredBlockId={hoveredBlockId}
                selectedAnnotationId={selectedAnnotationId}
                activeHighlight={activeHighlight}
                activeHighlightSource={activeHighlightSource}
                allowLinkedInteractions={allowLinkedInteractions}
                onAnnotationSelect={onAnnotationSelect}
                l={l}
              />,
              host.overlayElement,
              `pdf-linked-overlay-${pageIndex}`,
            );
          })}

        </div>
        {showReadingHeatmapBar ? (
          <PdfReadingHeatmapBar
            heatmap={scroll.localReadingHeatmap}
            currentProgressRatio={scroll.readingProgressRatio}
            maxBinMs={scroll.maxReadingHeatmapBinMs}
            onSeek={scroll.scrollToReadingProgress}
            label={l('阅读热力进度', 'Reading heat progress')}
            totalLabel={l('累计', 'Total')}
          />
        ) : null}
        </div>
      </div>

      {overlay.blockContextMenu ? (
        <ContextMenu
          x={overlay.blockContextMenu.x}
          y={overlay.blockContextMenu.y}
          title={l(
            `第 ${overlay.blockContextMenu.block.pageIndex + 1} 页 · 块 ${overlay.blockContextMenu.block.blockIndex + 1}`,
            `Page ${overlay.blockContextMenu.block.pageIndex + 1} · Block ${overlay.blockContextMenu.block.blockIndex + 1}`,
          )}
          entries={overlay.blockContextMenuEntries}
          onClose={() => overlay.setBlockContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

export default memo(PdfViewer);
