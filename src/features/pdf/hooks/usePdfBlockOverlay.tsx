import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import type { ContextMenuEntry } from '../../../components/ContextMenu';
import {
  extractTranslatableMarkdownFromMineruBlock,
  extractTextFromMineruBlock,
  resolveMineruBlockContentSource,
} from '../../../services/mineru';
import type {
  PaperAnnotation,
  PdfBlockSelectContext,
  PdfHighlightTarget,
  PositionedMineruBlock,
  TextSelectionPayload,
} from '../../../types/reader';
import { isValidBBox, shouldCreateHotspot, type PageSize } from '../../../utils/bbox';
import {
  arePageHostsEqual,
  ensurePageOverlayElement,
  getPageTargetFromEvent,
  getRenderedPageSize,
  hasActiveTextSelection,
  isAnnotationUiTarget,
  resolveBlockClientRect,
  resolvePdfBlockHitByPoint,
  type PageHostState,
} from '../pdfPageDomUtils';
import type { AnnotationEditorTool } from '../PdfViewerToolbar';
import type { PdfJsDocumentInit } from '../pdfDocumentSource';
import {
  resolveOverlayOriginalPage,
  type BBoxPageSizeSource,
} from './usePdfDocumentLifecycle';

const OVERLAY_PAGE_RADIUS = 1;

type LocaleText = (zh: string, en: string) => string;
// pdfjs-dist 的运行时句柄与官方 .d.ts 存在差异，只在边界处集中用别名标注。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs 运行时 API 与类型声明不一致
type PdfJsLoose = any;

type MutableRef<T> = { current: T };

interface UsePdfBlockOverlayOptions {
  active: boolean;
  activeBlockId: string | null;
  activeHighlight: PdfHighlightTarget | null;
  activeRef: MutableRef<boolean>;
  annotations: PaperAnnotation[];
  blockClickOpensQuickActions: boolean;
  blocks: PositionedMineruBlock[];
  clearPendingBlockSelect: () => void;
  containerRef: MutableRef<HTMLDivElement | null>;
  currentPage: number;
  documentInit: PdfJsDocumentInit | null;
  editorToolRef: MutableRef<AnnotationEditorTool>;
  hoveredBlockId: string | null;
  l: LocaleText;
  onAddBlockToNote?: (block: PositionedMineruBlock, selection: TextSelectionPayload) => void;
  onBlockHover: (block: PositionedMineruBlock | null) => void;
  onBlockSelect: (block: PositionedMineruBlock, context?: PdfBlockSelectContext) => void;
  pageCount: number;
  pageSizes: Record<number, PageSize>;
  pageSyncSignal?: { context: string; page: number; token: number } | null;
  pdfViewerRef: MutableRef<PdfJsLoose>;
  pendingBlockSelectTimerRef: MutableRef<number | null>;
  requestPageSize: (pageIndex: number) => void;
  resolveOriginalPageForSources: (
    pageIndex: number,
    renderedPage: PageSize,
    sources: BBoxPageSizeSource[],
  ) => PageSize | null;
  retrySavedScrollRestoreRef: MutableRef<() => void>;
  sourceSignature: string;
  viewerRef: MutableRef<HTMLDivElement | null>;
}

export function usePdfBlockOverlay({
  active,
  activeBlockId,
  activeHighlight,
  activeRef,
  annotations,
  blockClickOpensQuickActions,
  blocks,
  clearPendingBlockSelect,
  containerRef,
  currentPage,
  documentInit,
  editorToolRef,
  hoveredBlockId,
  l,
  onAddBlockToNote,
  onBlockHover,
  onBlockSelect,
  pageCount,
  pageSizes,
  pageSyncSignal,
  pdfViewerRef,
  pendingBlockSelectTimerRef,
  requestPageSize,
  resolveOriginalPageForSources,
  retrySavedScrollRestoreRef,
  sourceSignature,
  viewerRef,
}: UsePdfBlockOverlayOptions) {
  const [pageHosts, setPageHosts] = useState<Record<number, PageHostState>>({});
  const [blockContextMenu, setBlockContextMenu] = useState<{
    block: PositionedMineruBlock;
    x: number;
    y: number;
    anchorClientRect?: TextSelectionPayload['anchorClientRect'];
  } | null>(null);
  const pageHostsRef = useRef<Record<number, PageHostState>>({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const observedPageElementsRef = useRef<Set<HTMLDivElement>>(new Set());
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredBlockIdRef = useRef<string | null>(hoveredBlockId);
  const layoutViewportRef = useRef<{ viewer: unknown; width: number; height: number } | null>(null);

  useEffect(() => {
    hoveredBlockIdRef.current = hoveredBlockId;
  }, [hoveredBlockId]);

  const blockById = useMemo(() => {
    const map = new Map<string, PositionedMineruBlock>();

    for (const block of blocks) {
      map.set(block.blockId, block);
    }

    return map;
  }, [blocks]);

  const resolveBlockContentSource = useCallback(
    (block: PositionedMineruBlock) => resolveMineruBlockContentSource(block, blockById),
    [blockById],
  );

  const hasTranslatableBlockText = useCallback(
    (block: PositionedMineruBlock) => Boolean(extractTextFromMineruBlock(block).trim()),
    [],
  );

  const blocksByPage = useMemo(() => {
    const map = new Map<number, PositionedMineruBlock[]>();

    for (const block of blocks) {
      if (!shouldCreateHotspot(block)) {
        continue;
      }

      const pageBlocks = map.get(block.pageIndex) ?? [];
      pageBlocks.push(block);
      map.set(block.pageIndex, pageBlocks);
    }

    return map;
  }, [blocks]);

  const activeBlock = activeBlockId ? blockById.get(activeBlockId) ?? null : null;
  const hoveredBlock = hoveredBlockId ? blockById.get(hoveredBlockId) ?? null : null;

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, PaperAnnotation[]>();

    for (const annotation of annotations) {
      if (!isValidBBox(annotation.bbox)) {
        continue;
      }

      const pageAnnotations = map.get(annotation.pageIndex) ?? [];
      pageAnnotations.push(annotation);
      map.set(annotation.pageIndex, pageAnnotations);
    }

    return map;
  }, [annotations]);

  const overlayPageIndexes = useMemo(() => {
    const indexes = new Set<number>();
    const currentPageIndex = Math.max(0, currentPage - 1);

    for (
      let pageIndex = Math.max(0, currentPageIndex - OVERLAY_PAGE_RADIUS);
      pageIndex <= Math.min(Math.max(0, pageCount - 1), currentPageIndex + OVERLAY_PAGE_RADIUS);
      pageIndex += 1
    ) {
      indexes.add(pageIndex);
    }

    if (activeBlock) indexes.add(activeBlock.pageIndex);
    if (hoveredBlock) indexes.add(hoveredBlock.pageIndex);
    if (activeHighlight) indexes.add(activeHighlight.pageIndex);
    // A distant sync target needs a host before its token can be acknowledged.
    // The usual current-page radius alone never materializes that target.
    if (pageSyncSignal?.context === sourceSignature && pageCount > 0 &&
      Number.isFinite(pageSyncSignal.page) && pageSyncSignal.page > 0) {
      indexes.add(Math.min(pageCount - 1, Math.max(0, Math.round(pageSyncSignal.page) - 1)));
    }

    return Array.from(indexes).sort((left, right) => left - right);
  }, [activeBlock, activeHighlight, currentPage, hoveredBlock, pageCount, pageSyncSignal, sourceSignature]);
  const overlayPageIndexesRef = useRef(overlayPageIndexes);
  overlayPageIndexesRef.current = overlayPageIndexes;

  const resolvePageOverlaySources = useCallback(
    (pageIndex: number): BBoxPageSizeSource[] => {
      const sources: BBoxPageSizeSource[] = [
        ...(blocksByPage.get(pageIndex) ?? []),
        ...(annotationsByPage.get(pageIndex) ?? []),
      ];

      if (activeBlock?.pageIndex === pageIndex) {
        sources.push(activeBlock);
      }

      if (hoveredBlock?.pageIndex === pageIndex) {
        sources.push(hoveredBlock);
      }

      if (activeHighlight?.pageIndex === pageIndex) {
        sources.push(blockById.get(activeHighlight.blockId) ?? activeHighlight);
      }

      return sources;
    },
    [
      activeBlock,
      activeHighlight,
      annotationsByPage,
      blockById,
      blocksByPage,
      hoveredBlock,
    ],
  );

  const syncPageHosts = useCallback(() => {
    const viewer = viewerRef.current;
    const observer = resizeObserverRef.current;

    if (!viewer || !observer) {
      return false;
    }

    const nextHosts: Record<number, PageHostState> = {};
    const nextObservedElements = new Set<HTMLDivElement>();

    for (const pageIndex of overlayPageIndexesRef.current) {
      const element = viewer.querySelector<HTMLDivElement>(
        `.page[data-page-number="${pageIndex + 1}"]`,
      );

      if (!element) {
        continue;
      }

      const overlayElement = ensurePageOverlayElement(element);
      nextObservedElements.add(element);

      if (!observedPageElementsRef.current.has(element)) {
        observer.observe(element);
      }

      nextHosts[pageIndex] = {
        element,
        overlayElement,
        width: element.clientWidth || element.getBoundingClientRect().width,
        height: element.clientHeight || element.getBoundingClientRect().height,
      };
    }

    for (const element of observedPageElementsRef.current) {
      if (!nextObservedElements.has(element)) {
        observer.unobserve(element);
      }
    }

    observedPageElementsRef.current = nextObservedElements;

    const changed = !arePageHostsEqual(pageHostsRef.current, nextHosts);

    if (changed) {
      pageHostsRef.current = nextHosts;
      setPageHosts(nextHosts);
    }

    return changed;
  }, []);

  const refreshPdfViewerLayout = useCallback(() => {
    const pdfViewer = pdfViewerRef.current;
    const container = containerRef.current;

    if (!activeRef.current || !pdfViewer || !container || container.clientWidth <= 0 || container.clientHeight <= 0) {
      return;
    }

    try {
      const previous = layoutViewportRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!previous || previous.viewer !== pdfViewer || previous.width !== width || previous.height !== height) {
        layoutViewportRef.current = { viewer: pdfViewer, width, height };
        // PDF.js update() renders visible pages but does not recalculate fit scales.
        // Reapply only fit presets; a user's numeric zoom must survive resizing.
        const preset = pdfViewer.currentScaleValue;
        if (['page-width', 'page-fit', 'page-height', 'auto'].includes(preset)) {
          pdfViewer.currentScaleValue = preset;
        }
      }
      pdfViewer.update?.();
    } catch {
      // PDF.js can throw while a document is still being attached.
    }

    if (syncPageHosts()) {
      retrySavedScrollRestoreRef.current();
    }
  }, [sourceSignature, syncPageHosts]);

  const resetPageHosts = useCallback(() => {
    pageHostsRef.current = {};
    setPageHosts({});
  }, []);

  const resolveOverlayPageOriginal = useCallback(
    (pageIndex: number, renderedPage: PageSize) => {
      const pageBlocks = blocksByPage.get(pageIndex) ?? [];
      const pageAnnotations = annotationsByPage.get(pageIndex) ?? [];
      const activePageBlock =
        activeBlock?.pageIndex === pageIndex ? activeBlock : null;
      const activeHighlightSource =
        activeHighlight && activeHighlight.pageIndex === pageIndex
          ? blockById.get(activeHighlight.blockId) ?? activeHighlight
          : null;

      return resolveOverlayOriginalPage(
        pageSizes[pageIndex],
        renderedPage,
        [
          ...pageBlocks,
          ...pageAnnotations,
          activePageBlock,
          activeHighlightSource,
        ],
      );
    },
    [
      activeBlock,
      activeHighlight,
      annotationsByPage,
      blockById,
      blocksByPage,
      pageSizes,
    ],
  );

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        refreshPdfViewerLayout();
      });
    });
    const mutationObserver = new MutationObserver(() => {
      window.requestAnimationFrame(() => {
        if (!activeRef.current) {
          return;
        }

        if (syncPageHosts()) {
          retrySavedScrollRestoreRef.current();
        }
      });
    });

    resizeObserverRef.current = observer;
    mutationObserverRef.current = mutationObserver;
    if (containerRef.current) observer.observe(containerRef.current);
    syncPageHosts();
    refreshPdfViewerLayout();

    const viewer = viewerRef.current;

    if (viewer) {
      mutationObserver.observe(viewer, {
        childList: true,
      });
    }

    return () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      mutationObserver.disconnect();
      observedPageElementsRef.current = new Set();
      resizeObserverRef.current = null;
      mutationObserverRef.current = null;
    };
  }, [active, refreshPdfViewerLayout, retrySavedScrollRestoreRef, syncPageHosts]);

  useEffect(() => {
    if (!active) {
      return;
    }

    syncPageHosts();
  }, [active, overlayPageIndexes, syncPageHosts]);

  useEffect(() => {
    if (!active || !documentInit) {
      return undefined;
    }

    let firstFrame = 0;
    let secondFrame = 0;

    firstFrame = window.requestAnimationFrame(() => {
      refreshPdfViewerLayout();
      secondFrame = window.requestAnimationFrame(refreshPdfViewerLayout);
    });

    return () => {
      if (firstFrame !== 0) {
        window.cancelAnimationFrame(firstFrame);
      }

      if (secondFrame !== 0) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [active, documentInit, refreshPdfViewerLayout]);

  useEffect(() => {
    if (!active) {
      return;
    }

    for (const pageIndex of overlayPageIndexes) {
      const host = pageHosts[pageIndex];

      if (!host) {
        continue;
      }

      const renderedPage = {
        width: host.width,
        height: host.height,
      };

      if (renderedPage.width <= 0 || renderedPage.height <= 0) {
        continue;
      }

      const originalPage = resolveOverlayOriginalPage(
        pageSizes[pageIndex],
        renderedPage,
        resolvePageOverlaySources(pageIndex),
      );

      if (!originalPage) {
        requestPageSize(pageIndex);
      }
    }
  }, [
    active,
    overlayPageIndexes,
    pageHosts,
    pageSizes,
    requestPageSize,
    resolvePageOverlaySources,
  ]);

  const buildBlockPdfLocation = useCallback(
    (block: PositionedMineruBlock): TextSelectionPayload['pdfLocation'] =>
      block.bbox
        ? {
            pageNumber: block.pageIndex + 1,
            bbox: block.bbox,
            bboxCoordinateSystem: block.bboxCoordinateSystem,
            bboxPageSize: block.bboxPageSize,
          }
        : undefined,
    [],
  );

  const buildBlockSelectionPayload = useCallback(
    (
      block: PositionedMineruBlock,
      options: {
        x: number;
        y: number;
        anchorClientRect?: TextSelectionPayload['anchorClientRect'];
      },
    ): TextSelectionPayload | null => {
      const contentBlock = resolveBlockContentSource(block);
      const text = extractTranslatableMarkdownFromMineruBlock(contentBlock).trim();

      if (!text) {
        return null;
      }

      return {
        text,
        blockId: contentBlock.blockId,
        anchorClientX: options.x,
        anchorClientY: options.y,
        anchorClientRect: options.anchorClientRect,
        placement: 'bottom',
        pdfLocation: buildBlockPdfLocation(block),
      };
    },
    [buildBlockPdfLocation, resolveBlockContentSource],
  );

  const blockContextMenuEntries = useMemo<ContextMenuEntry[]>(() => {
    if (!blockContextMenu || !onAddBlockToNote) {
      return [];
    }

    const selection = buildBlockSelectionPayload(blockContextMenu.block, {
      x: blockContextMenu.x,
      y: blockContextMenu.y,
      anchorClientRect: blockContextMenu.anchorClientRect,
    });

    return [
      {
        id: 'add-block-to-note',
        label: l('整块加入笔记', 'Add Whole Block to Note'),
        icon: <FilePlus2 className="h-4 w-4" strokeWidth={1.9} />,
        tone: 'accent',
        disabled: !selection,
        onSelect: () => {
          if (selection) {
            onAddBlockToNote(blockContextMenu.block, selection);
          }
        },
      },
    ];
  }, [blockContextMenu, buildBlockSelectionPayload, l, onAddBlockToNote]);

  useEffect(() => {
    const viewer = viewerRef.current;

    if (!active || !viewer) {
      return undefined;
    }

    let pendingHoverBlock: PositionedMineruBlock | null = null;
    let hoverAnimationFrame: number | null = null;

    const flushBlockHover = () => {
      hoverAnimationFrame = null;

      const block = pendingHoverBlock;
      pendingHoverBlock = null;
      const nextBlockId = block?.blockId ?? null;

      if (hoveredBlockIdRef.current === nextBlockId) {
        return;
      }

      hoveredBlockIdRef.current = nextBlockId;
      onBlockHover(block);
    };

    const emitBlockHover = (block: PositionedMineruBlock | null) => {
      const nextBlockId = block?.blockId ?? null;
      const pendingBlockId = pendingHoverBlock?.blockId ?? null;

      if (
        (hoverAnimationFrame === null && hoveredBlockIdRef.current === nextBlockId) ||
        (hoverAnimationFrame !== null && pendingBlockId === nextBlockId)
      ) {
        return;
      }

      pendingHoverBlock = block;

      if (hoverAnimationFrame !== null) {
        return;
      }

      hoverAnimationFrame = window.requestAnimationFrame(flushBlockHover);
    };

    const getPointerPageTarget = (event: PointerEvent | MouseEvent) =>
      getPageTargetFromEvent(event.target, event.clientX, event.clientY, viewer);

    const getPointerRenderedPage = (pageTarget: ReturnType<typeof getPageTargetFromEvent>) => {
      if (!pageTarget) {
        return null;
      }

      return pageHosts[pageTarget.pageIndex] ?? getRenderedPageSize(pageTarget.pageElement);
    };

    const resolvePointerBlockHit = (event: MouseEvent | PointerEvent) => {
      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        return null;
      }

      const renderedPage = getPointerRenderedPage(pageTarget);

      if (!renderedPage) {
        return null;
      }

      const pageBlocks = blocksByPage.get(pageTarget.pageIndex) ?? [];
      const originalPage = resolveOriginalPageForSources(
        pageTarget.pageIndex,
        renderedPage,
        pageBlocks,
      );

      if (!originalPage) {
        return null;
      }

      const hit = resolvePdfBlockHitByPoint(
        event.clientX,
        event.clientY,
        pageTarget.pageElement,
        pageBlocks,
        originalPage,
        renderedPage,
        resolveBlockContentSource,
        hasTranslatableBlockText,
      );

      if (!hit) {
        return null;
      }

      return {
        block: hit.block,
        anchorBlock: hit.anchorBlock,
        anchorClientRect: resolveBlockClientRect(
          pageTarget.pageElement,
          hit.anchorBlock,
          originalPage,
          renderedPage,
        ),
        pdfLocation: buildBlockPdfLocation(hit.anchorBlock),
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      clearPendingBlockSelect();

      if (editorToolRef.current !== 'none') {
        pointerStartRef.current = null;
        emitBlockHover(null);
        return;
      }

      if (isAnnotationUiTarget(event.target)) {
        return;
      }

      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        pointerStartRef.current = null;
        return;
      }

      pointerStartRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (editorToolRef.current !== 'none') {
        emitBlockHover(null);
        return;
      }

      if (event.buttons !== 0 || hasActiveTextSelection() || isAnnotationUiTarget(event.target)) {
        return;
      }

      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        emitBlockHover(null);
        return;
      }

      const pageBlocks = blocksByPage.get(pageTarget.pageIndex) ?? [];
      const renderedPage = getPointerRenderedPage(pageTarget);

      if (!renderedPage) {
        emitBlockHover(null);
        return;
      }

      const originalPage = resolveOriginalPageForSources(
        pageTarget.pageIndex,
        renderedPage,
        pageBlocks,
      );

      if (!originalPage) {
        emitBlockHover(null);
        return;
      }

      const hit = resolvePdfBlockHitByPoint(
        event.clientX,
        event.clientY,
        pageTarget.pageElement,
        pageBlocks,
        originalPage,
        renderedPage,
        resolveBlockContentSource,
        hasTranslatableBlockText,
      );

      emitBlockHover(hit?.block ?? null);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (editorToolRef.current !== 'none') {
        pointerStartRef.current = null;
        return;
      }

      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        pointerStartRef.current = null;
        return;
      }

      if (isAnnotationUiTarget(event.target)) {
        pointerStartRef.current = null;
        return;
      }

      const renderedPage = getPointerRenderedPage(pageTarget);

      if (!renderedPage) {
        pointerStartRef.current = null;
        return;
      }

      const pointerStart = pointerStartRef.current;
      pointerStartRef.current = null;

      if (pointerStart) {
        const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);

        if (movement > 4) {
          return;
        }
      }

      if (hasActiveTextSelection()) {
        return;
      }

      const pageBlocks = blocksByPage.get(pageTarget.pageIndex) ?? [];
      const originalPage = resolveOriginalPageForSources(
        pageTarget.pageIndex,
        renderedPage,
        pageBlocks,
      );

      if (!originalPage) {
        return;
      }

      const hit = resolvePdfBlockHitByPoint(
        event.clientX,
        event.clientY,
        pageTarget.pageElement,
        pageBlocks,
        originalPage,
        renderedPage,
        resolveBlockContentSource,
        hasTranslatableBlockText,
      );

      if (hit) {
        const anchorClientRect = resolveBlockClientRect(
          pageTarget.pageElement,
          hit.anchorBlock,
          originalPage,
          renderedPage,
        );

        clearPendingBlockSelect();
        pendingBlockSelectTimerRef.current = window.setTimeout(() => {
          pendingBlockSelectTimerRef.current = null;

          if (hasActiveTextSelection()) {
            return;
          }

          onBlockSelect(hit.block, {
            anchorClientX: event.clientX,
            anchorClientY: event.clientY,
            anchorClientRect,
            placement: 'bottom',
            pdfLocation: buildBlockPdfLocation(hit.anchorBlock),
          });
        }, 48);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (editorToolRef.current !== 'none') {
        return;
      }

      if (isAnnotationUiTarget(event.target) || hasActiveTextSelection()) {
        return;
      }

      const pageTarget = getPointerPageTarget(event);

      if (!pageTarget) {
        return;
      }

      const renderedPage = getPointerRenderedPage(pageTarget);

      if (!renderedPage) {
        return;
      }

      const pageBlocks = blocksByPage.get(pageTarget.pageIndex) ?? [];
      const originalPage = resolveOriginalPageForSources(
        pageTarget.pageIndex,
        renderedPage,
        pageBlocks,
      );

      if (!originalPage) {
        return;
      }

      const hit = resolvePdfBlockHitByPoint(
        event.clientX,
        event.clientY,
        pageTarget.pageElement,
        pageBlocks,
        originalPage,
        renderedPage,
        resolveBlockContentSource,
        hasTranslatableBlockText,
      );

      if (!hit) {
        return;
      }

      clearPendingBlockSelect();
      if (blockClickOpensQuickActions) {
        (event as MouseEvent & { paperQuayPdfBlockSelectClick?: boolean }).paperQuayPdfBlockSelectClick = true;
      }
      onBlockSelect(hit.block, {
        anchorClientX: event.clientX,
        anchorClientY: event.clientY,
        anchorClientRect: resolveBlockClientRect(
          pageTarget.pageElement,
          hit.anchorBlock,
          originalPage,
          renderedPage,
        ),
        placement: 'bottom',
        pdfLocation: buildBlockPdfLocation(hit.anchorBlock),
      });
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!onAddBlockToNote || editorToolRef.current !== 'none') {
        return;
      }

      if (isAnnotationUiTarget(event.target) || hasActiveTextSelection()) {
        return;
      }

      const result = resolvePointerBlockHit(event);

      if (!result) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearPendingBlockSelect();
      setBlockContextMenu({
        block: result.anchorBlock,
        x: event.clientX,
        y: event.clientY,
        anchorClientRect: result.anchorClientRect,
      });
    };

    const handlePointerLeave = (event: PointerEvent) => {
      const relatedTarget = event.relatedTarget;

      if (relatedTarget instanceof Node && viewer.contains(relatedTarget)) {
        return;
      }

      emitBlockHover(null);
    };

    viewer.addEventListener('pointerdown', handlePointerDown);
    viewer.addEventListener('pointermove', handlePointerMove);
    viewer.addEventListener('pointerup', handlePointerUp);
    viewer.addEventListener('pointerleave', handlePointerLeave);
    viewer.addEventListener('click', handleClick, true);
    viewer.addEventListener('contextmenu', handleContextMenu, true);

    return () => {
      if (hoverAnimationFrame !== null) {
        window.cancelAnimationFrame(hoverAnimationFrame);
      }

      pendingHoverBlock = null;
      if (hoveredBlockIdRef.current !== null) {
        hoveredBlockIdRef.current = null;
        onBlockHover(null);
      }

      viewer.removeEventListener('pointerdown', handlePointerDown);
      viewer.removeEventListener('pointermove', handlePointerMove);
      viewer.removeEventListener('pointerup', handlePointerUp);
      viewer.removeEventListener('pointerleave', handlePointerLeave);
      viewer.removeEventListener('click', handleClick, true);
      viewer.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, [
    active,
    blockClickOpensQuickActions,
    blocksByPage,
    clearPendingBlockSelect,
    onBlockHover,
    onBlockSelect,
    onAddBlockToNote,
    pageHosts,
    buildBlockPdfLocation,
    hasTranslatableBlockText,
    resolveBlockContentSource,
    resolveOriginalPageForSources,
  ]);

  return {
    annotationsByPage,
    blockById,
    blockContextMenu,
    blockContextMenuEntries,
    blocksByPage,
    overlayPageIndexes,
    pageHosts,
    refreshPdfViewerLayout,
    resetPageHosts,
    resolveOverlayPageOriginal,
    setBlockContextMenu,
    syncPageHosts,
  };
}
