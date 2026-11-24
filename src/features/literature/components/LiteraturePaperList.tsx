import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { BookOpenText } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import type { ListPapersRequest, LiteraturePaper } from '../../../types/library';
import type { PdfReadingHeatmap } from '../../../types/reader';
import {
  loadPaperHistoryMap,
  PAPER_READING_HEATMAP_UPDATED_EVENT,
} from '../../../utils/paperHistory';
import {
  getVirtualOffset,
  resolveVirtualWindow,
  type VirtualWindow,
} from '../../../utils/virtualWindow';
import { resolvePaperListNavigation } from '../paperListKeyboard';
import type { PaperTitleDisplayMode } from '../titleDisplay';
import type { SelectionCheckState } from '../paperSelection';
import type { LibraryFilterState } from '../libraryFilters';
import type { LibraryTagCount } from '../../../types/library';
import LiteratureToolbar from './LiteratureToolbar';
import LiteraturePaperRow from './LiteraturePaperRow';

export interface LiteraturePaperListStatus {
  mineruParsed: boolean;
  overviewGenerated: boolean;
  checkingMineru?: boolean;
}

/** 本地 RAG 索引聚合状态（与 src/services/ragIndexStatus.ts 的 RagAggregateStatus 对齐）。 */
export type LiteraturePaperRagStatus = 'ready' | 'pending' | 'failed' | 'none' | 'excluded';

export type LiteratureRagMembershipFilter = 'all' | 'included' | 'excluded';

export type LiteraturePaperListSortBy = NonNullable<ListPapersRequest['sortBy']>;
export type LiteraturePaperListSortDirection = NonNullable<ListPapersRequest['sortDirection']>;

/** 小于该行数时保持原样全量渲染，避免小库引入虚拟列表的测量开销。 */
export const PAPER_LIST_VIRTUALIZE_AFTER = 60;
const ROW_GAP = 8;
const DEFAULT_ROW_HEIGHT = 132;
const COMPACT_ROW_HEIGHT = 84;
const VIRTUAL_OVERSCAN = 6;
/** 焦点跨虚拟窗口时，等目标行挂载的轮询上限（30 帧 / 500ms）。 */
const FOCUS_POLL_MAX_FRAMES = 30;
const FOCUS_POLL_TIMEOUT_MS = 500;
/** 模块级空数组：默认参数不能每次渲染都创建新引用，否则会击穿行 memo。 */
const EMPTY_MULTI_SELECTED_IDS: string[] = [];

/**
 * 外部回调稳定化：LiteratureLibraryView 每次渲染都会创建新的普通函数/内联箭头
 * （onSelectPaper 依赖 selectedPaperId、onPaperContextMenu 是普通函数、onPaperReorder 是内联箭头），
 * 直接透传会击穿 memo(LiteraturePaperRow) 的浅比较。这里把最新实现写进 ref，
 * 返回空依赖包装，父组件引用如何变化都不影响行 props 的稳定性；包装内部始终调用最新回调。
 */
function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

interface LiteraturePaperListProps {
  loading: boolean;
  working: boolean;
  refreshing?: boolean;
  papers: LiteraturePaper[];
  /** SQL 分页（P2-1）：当前筛选的完整匹配数；papers.length < total 时滚动到底自动加载下一页。 */
  papersTotal?: number;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  paperStatuses: Record<string, LiteraturePaperListStatus>;
  showReadingHeatmap?: boolean;
  storageDir?: string;
  selectedPaper: LiteraturePaper | null;
  /** 多选集合。全选时包含尚未加载的匹配 id，所以后加载的行也会显示为已选。 */
  multiSelectedPaperIds?: string[];
  selectAllState?: SelectionCheckState;
  onToggleSelectAll?: () => void;
  searchQuery: string;
  filters: LibraryFilterState;
  onFiltersChange: (filters: LibraryFilterState) => void;
  tags: LibraryTagCount[];
  libraryTotal: number;
  sortBy: LiteraturePaperListSortBy;
  sortDirection: LiteraturePaperListSortDirection;
  titleDisplayMode: PaperTitleDisplayMode;
  statusMessage: string;
  error: string;
  onSearchQueryChange: (value: string) => void;
  onSortChange: (sortBy: LiteraturePaperListSortBy, sortDirection: LiteraturePaperListSortDirection) => void;
  onTitleDisplayModeChange: (mode: PaperTitleDisplayMode) => void;
  onImportPdfs: () => void;
  onInspectPdfAssets: () => void;
  onRefresh: () => void;
  onSelectPaper: (paperId: string, modifiers?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  onOpenPaper: (paper: LiteraturePaper) => void;
  onPaperDragStart: (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => void;
  onPaperReorder: (
    draggedPaperId: string,
    targetPaperId: string,
    placement: 'before' | 'after',
  ) => void;
  onPaperDropOnCategory: (paperId: string, categoryId: string) => void;
  onPaperPointerDragOverCategory: (categoryId: string | null) => void;
  onPaperContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => void;
  /** 本地 RAG 索引角标：paper id（即 rag_indexes.document_key）→ 聚合状态。 */
  ragBadgeByDocumentKey?: Record<string, LiteraturePaperRagStatus>;
  /** 正在建立索引的文献 id（批量或单篇索引运行时）。 */
  ragIndexingDocumentKey?: string;
  /** 本地 RAG 可用（启用且 embedding 配置完整）时才展示角标。 */
  ragIndexAvailable?: boolean;
}

export default function LiteraturePaperList({
  loading,
  working,
  refreshing = false,
  papers,
  papersTotal,
  loadingMore = false,
  onLoadMore,
  paperStatuses,
  showReadingHeatmap: initialShowReadingHeatmap = true,
  storageDir = '',
  selectedPaper,
  multiSelectedPaperIds = EMPTY_MULTI_SELECTED_IDS,
  selectAllState = 'none',
  onToggleSelectAll,
  searchQuery,
  filters,
  onFiltersChange,
  tags,
  libraryTotal,
  sortBy,
  sortDirection,
  titleDisplayMode,
  statusMessage,
  error,
  onSearchQueryChange,
  onSortChange,
  onTitleDisplayModeChange,
  onImportPdfs,
  onInspectPdfAssets,
  onRefresh,
  onSelectPaper,
  onOpenPaper,
  onPaperDragStart,
  onPaperReorder,
  onPaperDropOnCategory,
  onPaperPointerDragOverCategory,
  onPaperContextMenu,
  ragBadgeByDocumentKey,
  ragIndexingDocumentKey = '',
  ragIndexAvailable = false,
}: LiteraturePaperListProps) {
  const l = useLocaleText();
  // 传给行的外部回调全部经 ref 转发：父组件的闭包引用每次都变，但行 props 保持稳定。
  const stableSelectPaper = useStableCallback(onSelectPaper);
  const stableOpenPaper = useStableCallback(onOpenPaper);
  const stablePaperContextMenu = useStableCallback(onPaperContextMenu);
  const stablePaperReorder = useStableCallback(onPaperReorder);
  const stablePaperDragStart = useStableCallback(onPaperDragStart);
  const stablePaperDropOnCategory = useStableCallback(onPaperDropOnCategory);
  const stablePaperPointerDragOverCategory = useStableCallback(onPaperPointerDragOverCategory);
  const rootRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef });
  const [dropIndicator, setDropIndicator] = useState<{
    paperId: string;
    placement: 'before' | 'after';
  } | null>(null);
  const draggingPaperIdRef = useRef<string | null>(null);
  const sortDragRef = useRef<{
    paperId: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const categoryDragRef = useRef<{
    paperId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const [sortDraggingPaperId, setSortDraggingPaperId] = useState<string | null>(null);
  const [categoryDraggingPaperId, setCategoryDraggingPaperId] = useState<string | null>(null);
  const [suppressClickPaperId, setSuppressClickPaperId] = useState<string | null>(null);
  const [heatmapRevision, setHeatmapRevision] = useState(0);
  const [showReadingHeatmap, setShowReadingHeatmap] = useState(initialShowReadingHeatmap);
  const [compact, setCompact] = useState(false);
  useEffect(() => setShowReadingHeatmap(initialShowReadingHeatmap), [initialShowReadingHeatmap]);
  const manualSortingEnabled = sortBy === 'manual';
  const multiSelectedSet = useMemo(() => new Set(multiSelectedPaperIds), [multiSelectedPaperIds]);
  const multiSelectActive = multiSelectedPaperIds.length > 0;
  const selectedPaperId = selectedPaper?.id ?? null;
  const resolvedTotal = typeof papersTotal === 'number' ? Math.max(papersTotal, papers.length) : papers.length;
  const hasMorePapers = papers.length < resolvedTotal;

  // 虚拟列表：滚动偏移与视口高度只驱动窗口重算，不重算整行数据。
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [measureRevision, setMeasureRevision] = useState(0);
  const rowHeightsRef = useRef(new Map<string, number>());
  const measureFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const virtualize = papers.length > PAPER_LIST_VIRTUALIZE_AFTER;

  const handleRowMeasure = useCallback((paperId: string, element: HTMLDivElement) => {
    const height = element.getBoundingClientRect().height;
    if (!height) return;
    const next = height + ROW_GAP;
    const previous = rowHeightsRef.current.get(paperId);
    if (previous !== undefined && Math.abs(previous - next) <= 1) return;
    rowHeightsRef.current.set(paperId, next);
    if (measureFrameRef.current !== null) return;
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null;
      setMeasureRevision((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    // 紧凑模式改变行高，失效测量缓存。
    rowHeightsRef.current.clear();
    setMeasureRevision((value) => value + 1);
  }, [compact]);

  useEffect(() => () => {
    if (measureFrameRef.current !== null) window.cancelAnimationFrame(measureFrameRef.current);
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const update = () => setViewportHeight(element.clientHeight || 600);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 行高解析与 resolveVirtualWindow 共用：键盘漫游计算目标偏移时必须用同一套尺寸。
  const getPaperItemSize = useCallback((index: number) => {
    const paper = papers[index];
    const measured = paper ? rowHeightsRef.current.get(paper.id) : undefined;
    return measured ?? (compact ? COMPACT_ROW_HEIGHT : DEFAULT_ROW_HEIGHT) + ROW_GAP;
  }, [compact, papers]);

  const virtualWindow = useMemo<VirtualWindow | null>(() => {
    if (!virtualize) return null;
    return resolveVirtualWindow({
      itemCount: papers.length,
      getItemSize: getPaperItemSize,
      scrollOffset: scrollTop,
      viewportSize: viewportHeight,
      overscan: VIRTUAL_OVERSCAN,
    });
  }, [getPaperItemSize, measureRevision, scrollTop, viewportHeight, virtualize]);

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      pendingScrollTopRef.current = target.scrollTop;
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          scrollFrameRef.current = null;
          setScrollTop(pendingScrollTopRef.current);
        });
      }
      if (!hasMorePapers || loadingMore || !onLoadMore) return;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 400) {
        onLoadMore();
      }
    },
    [hasMorePapers, loadingMore, onLoadMore],
  );

  const findMountedPaperRow = useCallback((index: number): HTMLElement | null => {
    const container = scrollRef.current;
    if (!container) return null;
    return container.querySelector<HTMLElement>(
      `[data-paper-row-index="${index}"] [data-paper-row-id]`,
    );
  }, []);

  // 焦点目标可能在虚拟窗口外：先按与 resolveVirtualWindow 相同的行高滚动到目标偏移，
  // 再逐帧等待目标行挂载后 focus；超时则放弃，避免无上限轮询。
  const focusPaperRow = useCallback((index: number) => {
    if (!papers[index]) return;
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }

    const mounted = findMountedPaperRow(index);
    if (mounted) {
      mounted.focus();
      return;
    }

    const container = scrollRef.current;
    if (!container) return;

    const offset = getVirtualOffset(index, getPaperItemSize);
    container.scrollTop = offset;
    pendingScrollTopRef.current = offset;
    // 直接更新窗口状态；浏览器原生 scroll 事件仍会走 handleListScroll，二者幂等。
    setScrollTop(offset);

    const startedAt = Date.now();
    let frames = 0;
    const poll = () => {
      frames += 1;
      const target = findMountedPaperRow(index);
      if (target) {
        focusFrameRef.current = null;
        target.focus();
        return;
      }
      if (frames >= FOCUS_POLL_MAX_FRAMES || Date.now() - startedAt >= FOCUS_POLL_TIMEOUT_MS) {
        focusFrameRef.current = null;
        return;
      }
      focusFrameRef.current = window.requestAnimationFrame(poll);
    };
    focusFrameRef.current = window.requestAnimationFrame(poll);
  }, [findMountedPaperRow, getPaperItemSize, papers]);

  const handleListKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // 不劫持带修饰键的快捷键（Ctrl/Cmd+A、Alt+方向键等）。
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const row = target.closest<HTMLElement>('[data-paper-row-index]');
    if (!row) return;

    const parsedIndex = Number(row.dataset.paperRowIndex);
    const nextIndex = resolvePaperListNavigation({
      currentIndex: Number.isFinite(parsedIndex) ? parsedIndex : -1,
      total: papers.length,
      key: event.key,
    });
    if (nextIndex === null) return;

    // 方向键只移动焦点，不改变选择；同时阻止浏览器滚动页面。
    event.preventDefault();
    if (nextIndex === parsedIndex) return;
    focusPaperRow(nextIndex);
  }, [focusPaperRow, papers.length]);

  const heatmapsByPaperId = useMemo(() => {
    if (!showReadingHeatmap || papers.length === 0) {
      return {} as Record<string, PdfReadingHeatmap | null>;
    }

    const historyMap = loadPaperHistoryMap();
    const nextHeatmaps: Record<string, PdfReadingHeatmap | null> = {};

    for (const paper of papers) {
      const history = historyMap[`native-library:${paper.id}`];
      const latestHeatmap = Object.values(history?.pdfReadingHeatmaps ?? {})
        .filter((heatmap) => heatmap.totalMs > 0)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;

      nextHeatmaps[paper.id] = latestHeatmap;
    }

    return nextHeatmaps;
  }, [heatmapRevision, papers, showReadingHeatmap]);

  useEffect(() => {
    if (!showReadingHeatmap) {
      return undefined;
    }

    const handleHeatmapUpdated = () => {
      setHeatmapRevision((current) => current + 1);
    };

    window.addEventListener(PAPER_READING_HEATMAP_UPDATED_EVENT, handleHeatmapUpdated);

    return () => {
      window.removeEventListener(PAPER_READING_HEATMAP_UPDATED_EVENT, handleHeatmapUpdated);
    };
  }, [showReadingHeatmap]);

  const findPointerDropTarget = (
    clientX: number,
    clientY: number,
  ): { paperId: string; placement: 'before' | 'after' } | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>('[data-paper-row-id]');
    const paperId = row?.dataset.paperRowId;

    if (!row || !paperId) {
      return null;
    }

    const rect = row.getBoundingClientRect();
    const placement: 'before' | 'after' =
      clientY < rect.top + rect.height / 2 ? 'before' : 'after';

    return { paperId, placement };
  };

  const findCategoryDropTarget = (clientX: number, clientY: number): string | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const target = element?.closest<HTMLElement>('[data-paperquay-category-drop-id]');

    return target?.dataset.paperquayCategoryDropId ?? null;
  };

  const updateDraggingPaperId = useCallback((paperId: string | null) => {
    draggingPaperIdRef.current = paperId;
  }, []);

  const handlePaperDragStart = useCallback((event: DragEvent<HTMLDivElement>, paper: LiteraturePaper) => {
    updateDraggingPaperId(paper.id);
    stablePaperDragStart(event, paper);
  }, [stablePaperDragStart, updateDraggingPaperId]);

  const handlePaperDragOver = useCallback((event: DragEvent<HTMLDivElement>, paper: LiteraturePaper) => {
    const draggedPaperId =
      draggingPaperIdRef.current || event.dataTransfer.getData('application/x-paperquay-paper-id');

    if (!draggedPaperId || draggedPaperId === paper.id) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropIndicator({ paperId: paper.id, placement });
  }, []);

  const handlePaperDrop = useCallback((event: DragEvent<HTMLDivElement>, paper: LiteraturePaper) => {
    const draggedPaperId =
      draggingPaperIdRef.current || event.dataTransfer.getData('application/x-paperquay-paper-id');

    setDropIndicator(null);
    updateDraggingPaperId(null);

    if (!draggedPaperId || draggedPaperId === paper.id) {
      return;
    }

    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    stablePaperReorder(draggedPaperId, paper.id, placement);
  }, [stablePaperReorder, updateDraggingPaperId]);

  const handlePaperDragEnd = useCallback(() => {
    setDropIndicator(null);
    updateDraggingPaperId(null);
  }, [updateDraggingPaperId]);

  const handlePaperDragLeave = useCallback(() => setDropIndicator(null), []);

  const resetSortDrag = useCallback(() => {
    sortDragRef.current = null;
    setDropIndicator(null);
    setSortDraggingPaperId(null);
    stablePaperPointerDragOverCategory(null);
  }, [stablePaperPointerDragOverCategory]);

  const resetCategoryDrag = useCallback(() => {
    categoryDragRef.current = null;
    setCategoryDraggingPaperId(null);
    stablePaperPointerDragOverCategory(null);
  }, [stablePaperPointerDragOverCategory]);

  const handleSortPointerDown = useCallback((event: PointerEvent<HTMLElement>, paper: LiteraturePaper) => {
    if (!manualSortingEnabled || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    sortDragRef.current = {
      paperId: paper.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  }, [manualSortingEnabled]);

  const handleSortPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = sortDragRef.current;

    if (!dragState) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );

    if (!dragState.active && distance < 4) {
      return;
    }

    dragState.active = true;
    setSortDraggingPaperId(dragState.paperId);

    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);

    if (categoryId) {
      setDropIndicator(null);
      stablePaperPointerDragOverCategory(categoryId);
      return;
    }

    stablePaperPointerDragOverCategory(null);

    const target = findPointerDropTarget(event.clientX, event.clientY);

    if (!target || target.paperId === dragState.paperId) {
      setDropIndicator(null);
      return;
    }

    setDropIndicator(target);
  }, [stablePaperPointerDragOverCategory]);

  const handleSortPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = sortDragRef.current;

    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);
    const target = findPointerDropTarget(event.clientX, event.clientY);

    if (dragState.active) {
      setSuppressClickPaperId(dragState.paperId);
      window.setTimeout(() => setSuppressClickPaperId(null), 0);
    }

    if (dragState.active && categoryId) {
      stablePaperDropOnCategory(dragState.paperId, categoryId);
    } else if (dragState.active && target && target.paperId !== dragState.paperId) {
      stablePaperReorder(dragState.paperId, target.paperId, target.placement);
    }

    resetSortDrag();
  }, [stablePaperDropOnCategory, stablePaperReorder, resetSortDrag]);

  const handleCategoryPointerDown = useCallback((event: PointerEvent<HTMLDivElement>, paper: LiteraturePaper) => {
    if (event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest('[data-paper-sort-handle]')) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    categoryDragRef.current = {
      paperId: paper.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  }, []);

  const handleCategoryPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const dragState = categoryDragRef.current;

    if (!dragState) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );

    if (!dragState.active && distance < 6) {
      return;
    }

    event.preventDefault();
    dragState.active = true;
    setCategoryDraggingPaperId(dragState.paperId);
    stablePaperPointerDragOverCategory(findCategoryDropTarget(event.clientX, event.clientY));
  }, [stablePaperPointerDragOverCategory]);

  const handleCategoryPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const dragState = categoryDragRef.current;

    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);

    if (dragState.active) {
      event.preventDefault();
      setSuppressClickPaperId(dragState.paperId);
      window.setTimeout(() => setSuppressClickPaperId(null), 0);

      if (categoryId) {
        stablePaperDropOnCategory(dragState.paperId, categoryId);
      }
    }

    resetCategoryDrag();
  }, [stablePaperDropOnCategory, resetCategoryDrag]);

  // 稳定引用：行是 memo 组件，只有真正变化的行才应重渲染。
  const renderPaperRow = useCallback((paper: LiteraturePaper, index: number) => {
    const status = paperStatuses[paper.id];
    const indexingRag = ragIndexingDocumentKey === paper.id;
    const storedRagStatus = ragBadgeByDocumentKey?.[paper.id];
    const ragStatus: LiteraturePaperRagStatus = paper.ragEnabled === false
      ? 'excluded'
      : storedRagStatus === 'excluded'
        ? 'none'
        : storedRagStatus ?? 'none';

    return (
      <LiteraturePaperRow
        key={paper.id}
        paper={paper}
        // 全局位置（虚拟窗口外也必须连续）：aria-setsize 固定用已加载的 papers.length
        // （任务口径，宁可少于分页总数也不改成 resolvedTotal）；分页总数由工具栏
        // 「全选当前结果（N 篇）」与加载更多提示播报。
        position={index + 1}
        setSize={papers.length}
        active={selectedPaperId === paper.id}
        multiSelected={multiSelectedSet.has(paper.id)}
        multiSelectActive={multiSelectActive}
        showReadingHeatmap={showReadingHeatmap}
        compact={compact}
        manualSortingEnabled={manualSortingEnabled}
        status={status}
        heatmap={heatmapsByPaperId[paper.id] ?? null}
        ragStatus={ragStatus}
        ragIndexing={indexingRag}
        ragIndexAvailable={ragIndexAvailable}
        dropPlacement={dropIndicator?.paperId === paper.id ? dropIndicator.placement : null}
        sortDragging={sortDraggingPaperId === paper.id}
        categoryDragging={categoryDraggingPaperId === paper.id}
        titleDisplayMode={titleDisplayMode}
        storageDir={storageDir}
        suppressClick={suppressClickPaperId === paper.id}
        onSelectPaper={stableSelectPaper}
        onOpenPaper={stableOpenPaper}
        onContextMenu={stablePaperContextMenu}
        onDragStart={handlePaperDragStart}
        onDragOver={handlePaperDragOver}
        onDragLeave={handlePaperDragLeave}
        onDragEnd={handlePaperDragEnd}
        onDrop={handlePaperDrop}
        onCategoryPointerDown={handleCategoryPointerDown}
        onCategoryPointerMove={handleCategoryPointerMove}
        onCategoryPointerUp={handleCategoryPointerUp}
        onCategoryPointerCancel={resetCategoryDrag}
        onSortPointerDown={handleSortPointerDown}
        onSortPointerMove={handleSortPointerMove}
        onSortPointerUp={handleSortPointerUp}
        onSortPointerCancel={resetSortDrag}
        onMeasure={handleRowMeasure}
      />
    );
  }, [
    categoryDraggingPaperId,
    compact,
    dropIndicator,
    handleCategoryPointerDown,
    handleCategoryPointerMove,
    handleCategoryPointerUp,
    handlePaperDragEnd,
    handlePaperDragLeave,
    handlePaperDragOver,
    handlePaperDragStart,
    handlePaperDrop,
    handleRowMeasure,
    handleSortPointerDown,
    handleSortPointerMove,
    handleSortPointerUp,
    heatmapsByPaperId,
    manualSortingEnabled,
    multiSelectActive,
    multiSelectedSet,
    papers.length,
    paperStatuses,
    ragBadgeByDocumentKey,
    ragIndexAvailable,
    ragIndexingDocumentKey,
    resetCategoryDrag,
    resetSortDrag,
    selectedPaperId,
    showReadingHeatmap,
    sortDraggingPaperId,
    stableOpenPaper,
    stablePaperContextMenu,
    stableSelectPaper,
    storageDir,
    suppressClickPaperId,
    titleDisplayMode,
  ]);

  const renderedPapers = virtualWindow
    ? papers.slice(virtualWindow.startIndex, virtualWindow.endIndex)
    : papers;
  const renderedStartIndex = virtualWindow?.startIndex ?? 0;

  return (
    <section
      ref={rootRef}
      onWheelCapture={handleWheelCapture}
      className="pq-library-pane flex h-full min-h-0 flex-col overflow-hidden border-r"
    >
      <LiteratureToolbar
        working={working} refreshing={refreshing} total={resolvedTotal} libraryTotal={libraryTotal}
        selectAllState={selectAllState} onToggleSelectAll={onToggleSelectAll}
        search={searchQuery} onSearch={onSearchQueryChange}
        filters={filters} onFilters={onFiltersChange} tags={tags}
        sortBy={sortBy} sortDirection={sortDirection} onSort={onSortChange}
        titleMode={titleDisplayMode} onTitleMode={onTitleDisplayModeChange}
        showHeatmap={showReadingHeatmap} onHeatmap={setShowReadingHeatmap}
        compact={compact} onCompact={setCompact}
        onImport={onImportPdfs} onAudit={onInspectPdfAssets} onRefresh={onRefresh}
        statusMessage={statusMessage} error={error}
      />

      {/* 工具栏批量条已有可见的选中计数（非 live）；这里只补读屏播报，避免视觉重复。 */}
      <span
        data-paper-selection-status
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {multiSelectedPaperIds.length > 0
          ? l(
            `已选择 ${multiSelectedPaperIds.length} 篇`,
            `${multiSelectedPaperIds.length} papers selected`,
          )
          : ''}
      </span>

      <div
        ref={scrollRef}
        data-wheel-scroll-target
        aria-busy={loading || undefined}
        className="pq-paper-list h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3"
        onScroll={handleListScroll}
      >
        {loading ? (
          <div role="status" className="pq-card p-6 text-sm text-[var(--pq-text-muted)]">
            {l('正在加载文献库...', 'Loading library...')}
          </div>
        ) : papers.length === 0 ? (
          <div role="status" className="rounded-2xl border border-dashed border-[var(--pq-border)] bg-white/60 p-8 text-center dark:bg-white/5">
            <BookOpenText className="mx-auto h-9 w-9 text-[var(--pq-text-faint)] dark:text-[var(--pq-text-muted)]" strokeWidth={1.7} />
            <div className="mt-4 text-lg font-semibold">
              {l('还没有文献', 'No papers yet')}
            </div>
            <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--pq-text-muted)] dark:text-[var(--pq-text-muted)]">
              {l(
                '点击“导入 PDF”选择一个或多个文件。应用会把路径、附件和基础元数据保存到本地文库。',
                'Click "Import PDF" to select one or more files. The app will save paths, attachments, and basic metadata into the local library.',
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              role="list"
              aria-label={l('文献列表', 'Paper list')}
              onKeyDown={handleListKeyDown}
            >
              {/* 虚拟窗口上下高度占位：role=list 的内容模型只允许 listitem，
                  占位元素用 presentation + aria-hidden 保留高度但不进入可访问树。 */}
              {virtualWindow ? (
                <div
                  role="presentation"
                  aria-hidden="true"
                  style={{ height: virtualWindow.paddingStart }}
                />
              ) : null}
              {renderedPapers.map((paper, offset) => (
                renderPaperRow(paper, renderedStartIndex + offset)
              ))}
              {virtualWindow ? (
                <div
                  role="presentation"
                  aria-hidden="true"
                  style={{ height: virtualWindow.paddingEnd }}
                />
              ) : null}
            </div>
            {hasMorePapers || loadingMore ? (
              <div role="status" aria-live="polite" className="py-2 text-center text-xs text-[var(--pq-text-muted)]">
                {loadingMore
                  ? l('正在加载更多…', 'Loading more…')
                  : l(`已加载 ${papers.length} / ${resolvedTotal} 条，滚动加载更多`, `Loaded ${papers.length} / ${resolvedTotal}; scroll for more`)}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
