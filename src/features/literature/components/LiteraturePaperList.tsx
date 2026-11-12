import clsx from 'clsx';
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
import {
  BookOpenText,
  Check,
  Minus,
  FilePlus2,
  GripVertical,
  HardDrive,
  RefreshCw,
  Search,
  Star,
  X,
} from 'lucide-react';
import { useAppLocale, useLocaleText } from '../../../i18n/uiLanguage';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import type { ListPapersRequest, LiteratureItemType, LiteraturePaper, LiteratureStructuredFilters } from '../../../types/library';
import type { PdfReadingHeatmap } from '../../../types/reader';
import {
  loadPaperHistoryMap,
  PAPER_READING_HEATMAP_UPDATED_EVENT,
} from '../../../utils/paperHistory';
import { truncateMiddle } from '../../../utils/text';
import {
  paperAuthors,
  paperPdfPath,
} from '../literatureUi';
import {
  persistPaperTitleDisplayMode,
  resolvePaperTitleDisplay,
  type PaperTitleDisplayMode,
} from '../titleDisplay';
import LiteratureReadingHeatmapPreview from './LiteratureReadingHeatmapPreview';
import type { SelectionCheckState } from '../paperSelection';
import { applicableMetadataFilterFields } from '../metadataFilterFields';

export interface LiteraturePaperListStatus {
  mineruParsed: boolean;
  /** 持久化来源成果状态；缺省表示旧的演示数据或尚未核实。 */
  mineruStatus?: 'unknown' | 'available' | 'missing' | 'error';
  overviewGenerated: boolean;
  checkingMineru?: boolean;
}

/** 本地 RAG 索引聚合状态（与 src/services/ragIndexStatus.ts 的 RagAggregateStatus 对齐）。 */
export type LiteraturePaperRagStatus = 'ready' | 'pending' | 'failed' | 'none' | 'excluded';

export type LiteratureRagMembershipFilter = 'all' | 'included' | 'excluded';

export type LiteraturePaperListSortBy = NonNullable<ListPapersRequest['sortBy']>;
export type LiteraturePaperListSortDirection = NonNullable<ListPapersRequest['sortDirection']>;

interface LiteraturePaperListProps {
  loading: boolean;
  working: boolean;
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
  onPaperKeyboardContextMenu?: (paper: LiteraturePaper, rect: DOMRect) => void;
  /** 本地 RAG 索引角标：paper id（即 rag_indexes.document_key）→ 聚合状态。 */
  ragBadgeByDocumentKey?: Record<string, LiteraturePaperRagStatus>;
  /** 正在建立索引的文献 id（批量或单篇索引运行时）。 */
  ragIndexingDocumentKey?: string;
  /** 本地 RAG 可用（启用且 embedding 配置完整）时才展示角标。 */
  ragIndexAvailable?: boolean;
  ragMembershipFilter?: LiteratureRagMembershipFilter;
  onRagMembershipFilterChange?: (value: LiteratureRagMembershipFilter) => void;
  itemTypeFilter?: LiteratureItemType | null;
  onItemTypeFilterChange?: (value: LiteratureItemType | null) => void;
  favoriteFilter?: boolean | null;
  onFavoriteFilterChange?: (value: boolean | null) => void;
  structuredFilters?: LiteratureStructuredFilters;
  onStructuredFiltersChange?: (value: LiteratureStructuredFilters) => void;
}

export default function LiteraturePaperList({
  loading,
  working,
  papers,
  papersTotal,
  loadingMore = false,
  onLoadMore,
  paperStatuses,
  showReadingHeatmap = true,
  storageDir = '',
  selectedPaper,
  multiSelectedPaperIds = [],
  selectAllState = 'none',
  onToggleSelectAll,
  searchQuery,
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
  onPaperKeyboardContextMenu,
  ragBadgeByDocumentKey,
  ragIndexingDocumentKey = '',
  ragIndexAvailable = false,
  ragMembershipFilter = 'all',
  onRagMembershipFilterChange,
  itemTypeFilter = null,
  onItemTypeFilterChange,
  favoriteFilter = null,
  onFavoriteFilterChange,
  structuredFilters,
  onStructuredFiltersChange,
}: LiteraturePaperListProps) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const rootRef = useRef<HTMLElement | null>(null);
  const filterDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef });
  const [dropIndicator, setDropIndicator] = useState<{
    paperId: string;
    placement: 'before' | 'after';
  } | null>(null);
  const [draggingPaperId, setDraggingPaperId] = useState<string | null>(null);
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
  const [structuredFilterDraft, setStructuredFilterDraft] = useState<LiteratureStructuredFilters | undefined>(structuredFilters);
  const [metadataFieldSearch, setMetadataFieldSearch] = useState('');
  const activeStructuredFilterCount = structuredFilters
    ? Number(Boolean(structuredFilters.yearFrom || structuredFilters.yearTo || structuredFilters.unknownYearOnly))
      + Number(Boolean(structuredFilters.authorQuery.trim()))
      + Number(Boolean(structuredFilters.publicationQuery.trim()))
      + Number(Boolean(structuredFilters.keywordQuery.trim()))
      + Number(Boolean(structuredFilters.tagNames.trim()))
      + Number(structuredFilters.readingState !== 'all')
      + Number(Boolean(structuredFilters.progressFrom.trim() || structuredFilters.progressTo.trim()))
      + Number(Boolean(structuredFilters.importedFrom || structuredFilters.importedTo))
      + Number(Boolean(structuredFilters.lastReadFrom || structuredFilters.lastReadTo))
      + Number(structuredFilters.attachmentRole !== 'any')
      + Number(structuredFilters.mineruParseStatus !== 'all')
      + Number(structuredFilters.missingMetadataFields.length > 0)
    : 0;
  const yearFromDraft = structuredFilterDraft?.yearFrom.trim() ?? '';
  const yearToDraft = structuredFilterDraft?.yearTo.trim() ?? '';
  const parsedYearFrom = yearFromDraft === '' ? null : Number(yearFromDraft);
  const parsedYearTo = yearToDraft === '' ? null : Number(yearToDraft);
  const yearDraftInvalid = Boolean(structuredFilterDraft) && !structuredFilterDraft?.unknownYearOnly && (
    (parsedYearFrom !== null && (!Number.isInteger(parsedYearFrom) || parsedYearFrom < 1 || parsedYearFrom > 9999))
    || (parsedYearTo !== null && (!Number.isInteger(parsedYearTo) || parsedYearTo < 1 || parsedYearTo > 9999))
    || (parsedYearFrom !== null && parsedYearTo !== null && parsedYearFrom > parsedYearTo)
  );
  const parsedProgressFrom = structuredFilterDraft?.progressFrom.trim() ? Number(structuredFilterDraft.progressFrom) : null;
  const parsedProgressTo = structuredFilterDraft?.progressTo.trim() ? Number(structuredFilterDraft.progressTo) : null;
  const progressDraftInvalid = Boolean(structuredFilterDraft) && (
    (parsedProgressFrom !== null && (!Number.isFinite(parsedProgressFrom) || parsedProgressFrom < 0 || parsedProgressFrom > 100))
    || (parsedProgressTo !== null && (!Number.isFinite(parsedProgressTo) || parsedProgressTo < 0 || parsedProgressTo > 100))
    || (parsedProgressFrom !== null && parsedProgressTo !== null && parsedProgressFrom > parsedProgressTo)
  );
  const timeDraftInvalid = structuredFilterDraft ? (
    (['importedFrom', 'importedTo', 'lastReadFrom', 'lastReadTo'] as const).some((key) => {
      const value = structuredFilterDraft[key];
      if (!value) return false;
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return !Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day;
    }) || Boolean(
      (structuredFilterDraft.importedFrom && structuredFilterDraft.importedTo && structuredFilterDraft.importedFrom > structuredFilterDraft.importedTo)
      || (structuredFilterDraft.lastReadFrom && structuredFilterDraft.lastReadTo && structuredFilterDraft.lastReadFrom > structuredFilterDraft.lastReadTo)
    )
  ) : false;
  const manualSortingEnabled = sortBy === 'manual';
  const sortValue = `${sortBy}:${sortDirection}`;
  const multiSelectedSet = useMemo(() => new Set(multiSelectedPaperIds), [multiSelectedPaperIds]);
  const multiSelectActive = multiSelectedPaperIds.length > 0;
  const metadataFieldOptions = applicableMetadataFilterFields(itemTypeFilter).filter((field) => {
    const query = metadataFieldSearch.trim().toLowerCase();
    return !query || field.labels.some((label) => label.toLowerCase().includes(query)) || field.key.toLowerCase().includes(query);
  });
  const resolvedTotal = typeof papersTotal === 'number' ? Math.max(papersTotal, papers.length) : papers.length;
  const hasMorePapers = papers.length < resolvedTotal;
  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasMorePapers || loadingMore || !onLoadMore) return;
      const target = event.currentTarget;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 400) {
        onLoadMore();
      }
    },
    [hasMorePapers, loadingMore, onLoadMore],
  );
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

  const handlePaperDragOver = (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    const draggedPaperId =
      draggingPaperId || event.dataTransfer.getData('application/x-paperquay-paper-id');

    if (!draggedPaperId || draggedPaperId === paper.id) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropIndicator({ paperId: paper.id, placement });
  };

  const handlePaperDrop = (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    const draggedPaperId =
      draggingPaperId || event.dataTransfer.getData('application/x-paperquay-paper-id');

    setDropIndicator(null);
    setDraggingPaperId(null);

    if (!draggedPaperId || draggedPaperId === paper.id) {
      return;
    }

    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    onPaperReorder(draggedPaperId, paper.id, placement);
  };

  const resetSortDrag = () => {
    sortDragRef.current = null;
    setDropIndicator(null);
    setSortDraggingPaperId(null);
    onPaperPointerDragOverCategory(null);
  };

  const resetCategoryDrag = () => {
    categoryDragRef.current = null;
    setCategoryDraggingPaperId(null);
    onPaperPointerDragOverCategory(null);
  };

  const handleSortPointerDown = (
    event: PointerEvent<HTMLElement>,
    paper: LiteraturePaper,
  ) => {
    if (!manualSortingEnabled) {
      return;
    }

    if (event.button !== 0) {
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
  };

  const handleSortPointerMove = (event: PointerEvent<HTMLElement>) => {
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
      onPaperPointerDragOverCategory(categoryId);
      return;
    }

    onPaperPointerDragOverCategory(null);

    const target = findPointerDropTarget(event.clientX, event.clientY);

    if (!target || target.paperId === dragState.paperId) {
      setDropIndicator(null);
      return;
    }

    setDropIndicator(target);
  };

  const handleSortPointerUp = (event: PointerEvent<HTMLElement>) => {
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
      onPaperDropOnCategory(dragState.paperId, categoryId);
    } else if (dragState.active && target && target.paperId !== dragState.paperId) {
      onPaperReorder(dragState.paperId, target.paperId, target.placement);
    }

    resetSortDrag();
  };

  const handleCategoryPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
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
  };

  const handleCategoryPointerMove = (event: PointerEvent<HTMLDivElement>) => {
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
    onPaperPointerDragOverCategory(findCategoryDropTarget(event.clientX, event.clientY));
  };

  const handleCategoryPointerUp = (event: PointerEvent<HTMLDivElement>) => {
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
        onPaperDropOnCategory(dragState.paperId, categoryId);
      }
    }

    resetCategoryDrag();
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      onPaperKeyboardContextMenu?.(paper, event.currentTarget.getBoundingClientRect());
      return;
    }

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
  };

  return (
    <section
      ref={rootRef}
      onWheelCapture={handleWheelCapture}
      className="pq-library-pane flex h-full min-h-0 flex-col overflow-hidden border-r"
    >
      <header className="pq-toolbar px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={selectAllState === 'all' ? true : selectAllState === 'partial' ? 'mixed' : false}
            disabled={working || resolvedTotal === 0 || !onToggleSelectAll}
            onClick={onToggleSelectAll}
            title={l(
              `全选当前筛选结果（${resolvedTotal} 篇）`,
              `Select all papers in the current filter (${resolvedTotal})`,
            )}
            className="pq-button inline-flex h-9 items-center gap-2 px-2.5 text-sm disabled:opacity-50"
          >
            <span
              className={clsx(
                'flex h-4 w-4 items-center justify-center rounded border',
                selectAllState === 'none'
                  ? 'border-[var(--pq-border)] bg-white/70 text-transparent'
                  : 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent)] text-white',
              )}
            >
              {selectAllState === 'partial'
                ? <Minus className="h-3 w-3" strokeWidth={2.6} />
                : <Check className="h-3 w-3" strokeWidth={2.6} />}
            </span>
            {l(`全选（${resolvedTotal}）`, `All (${resolvedTotal})`)}
          </button>
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pq-text-faint)]" strokeWidth={1.8} />
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={l('搜索标题、作者、摘要、DOI...', 'Search title, author, abstract, DOI...')}
              className="pq-input h-9 w-full pl-9 pr-3 text-sm placeholder:text-[var(--pq-text-faint)]"
            />
          </div>

          <select
            value={sortValue}
            onChange={(event) => {
              const [nextSortBy, nextDirection] = event.target.value.split(':') as [
                LiteraturePaperListSortBy,
                LiteraturePaperListSortDirection,
              ];

              onSortChange(nextSortBy, nextDirection);
            }}
            className="pq-input h-9 w-[168px] px-3 text-sm"
            title={l('排序', 'Sort')}
          >
            <option value="manual:asc">{l('手动排序', 'Manual Order')}</option>
            <option value="title:asc">{l('名称 A-Z', 'Name A-Z')}</option>
            <option value="title:desc">{l('名称 Z-A', 'Name Z-A')}</option>
            <option value="importedAt:desc">{l('添加时间 新-旧', 'Added New-Old')}</option>
            <option value="importedAt:asc">{l('添加时间 旧-新', 'Added Old-New')}</option>
            <option value="year:desc">{l('出版时间 新-旧', 'Year New-Old')}</option>
            <option value="year:asc">{l('出版时间 旧-新', 'Year Old-New')}</option>
            <option value="updatedAt:desc">{l('更新时间 新-旧', 'Updated New-Old')}</option>
            <option value="author:asc">{l('作者 A-Z', 'Author A-Z')}</option>
          </select>

          <select
            value={ragMembershipFilter}
            onChange={(event) => {
              onRagMembershipFilterChange?.(event.target.value as LiteratureRagMembershipFilter);
            }}
            className="pq-input h-9 w-[132px] px-3 text-sm"
            title={l('本地知识库', 'Local knowledge base')}
          >
            <option value="all">{l('知识库：全部', 'Library: All')}</option>
            <option value="included">{l('知识库：已加入', 'Library: Included')}</option>
            <option value="excluded">{l('知识库：已排除', 'Library: Excluded')}</option>
          </select>

          <select
            value={itemTypeFilter ?? 'all'}
            onChange={(event) => onItemTypeFilterChange?.(event.target.value === 'all' ? null : event.target.value as LiteratureItemType)}
            className="pq-input h-9 w-[150px] px-3 text-sm"
            title={l('文献类型筛选', 'Entry type filter')}
          >
            <option value="all">{l('类型：全部', 'Type: All')}</option>
            <option value="journalArticle">{l('期刊论文', 'Journal Article')}</option>
            <option value="book">{l('书籍', 'Book')}</option>
            <option value="bookSection">{l('书籍章节', 'Book Section')}</option>
            <option value="conferencePaper">{l('会议论文', 'Conference Paper')}</option>
            <option value="thesis">{l('学位论文', 'Thesis')}</option>
            <option value="report">{l('报告', 'Report')}</option>
            <option value="preprint">{l('预印本', 'Preprint')}</option>
            <option value="misc">{l('其他', 'Misc')}</option>
          </select>

          <select
            value={favoriteFilter === true ? 'favorites' : favoriteFilter === false ? 'not-favorites' : 'all'}
            onChange={(event) => onFavoriteFilterChange?.(event.target.value === 'favorites' ? true : event.target.value === 'not-favorites' ? false : null)}
            className="pq-input h-9 w-[140px] px-3 text-sm"
            title={l('收藏筛选', 'Favorite filter')}
          >
            <option value="all">{l('收藏：全部', 'Favorites: All')}</option>
            <option value="favorites">{l('仅收藏', 'Favorites only')}</option>
            <option value="not-favorites">{l('未收藏', 'Not favorited')}</option>
          </select>

          {structuredFilters && onStructuredFiltersChange ? (
            <details ref={filterDetailsRef} className="relative" onToggle={(event) => {
              if (event.currentTarget.open) setStructuredFilterDraft(structuredFilters);
            }}>
              <summary className="pq-button flex h-9 cursor-pointer list-none items-center px-3 text-sm">
                {activeStructuredFilterCount > 0
                  ? l(`更多属性筛选 · ${activeStructuredFilterCount}`, `More property filters · ${activeStructuredFilterCount}`)
                  : l('更多属性筛选', 'More property filters')}
              </summary>
              <div className="absolute right-0 top-10 z-20 grid w-[min(92vw,440px)] grid-cols-2 gap-2 rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface)] p-3 shadow-lg">
                <label className="flex flex-col gap-1 text-xs text-[var(--pq-text-muted)]">
                  {l('年份从', 'Year from')}
                  <input type="number" min="1" max="9999" value={structuredFilterDraft?.yearFrom ?? structuredFilters.yearFrom} disabled={structuredFilterDraft?.unknownYearOnly}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), yearFrom: event.target.value }))}
                    className="pq-input h-9 px-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--pq-text-muted)]">
                  {l('年份至', 'Year to')}
                  <input type="number" min="1" max="9999" value={structuredFilterDraft?.yearTo ?? structuredFilters.yearTo} disabled={structuredFilterDraft?.unknownYearOnly}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), yearTo: event.target.value }))}
                    className="pq-input h-9 px-2 text-sm" />
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--pq-text)]">
                  <input type="checkbox" checked={structuredFilterDraft?.unknownYearOnly ?? structuredFilters.unknownYearOnly}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), unknownYearOnly: event.target.checked, ...(event.target.checked ? { yearFrom: '', yearTo: '' } : {}) }))} />
                  {l('未知年份', 'Unknown year')}
                </label>
                <select value={structuredFilterDraft?.readingState ?? structuredFilters.readingState}
                  onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), readingState: event.target.value as LiteratureStructuredFilters['readingState'] }))}
                  className="pq-input h-9 px-2 text-sm" aria-label={l('阅读状态', 'Reading state')}>
                  <option value="all">{l('阅读状态：全部', 'Reading: All')}</option>
                  <option value="unread">{l('未读', 'Unread')}</option>
                  <option value="read">{l('已读', 'Read')}</option>
                </select>
                <label className="flex flex-col gap-1 text-xs text-[var(--pq-text-muted)]">
                  {l('阅读进度下限（%）', 'Progress from (%)')}
                  <input type="number" min="0" max="100" value={structuredFilterDraft?.progressFrom ?? structuredFilters.progressFrom}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), progressFrom: event.target.value }))}
                    className="pq-input h-9 px-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--pq-text-muted)]">
                  {l('阅读进度上限（%）', 'Progress to (%)')}
                  <input type="number" min="0" max="100" value={structuredFilterDraft?.progressTo ?? structuredFilters.progressTo}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), progressTo: event.target.value }))}
                    className="pq-input h-9 px-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--pq-text-muted)]">
                  {l('导入日期从', 'Imported from')}
                  <input type="date" value={structuredFilterDraft?.importedFrom ?? structuredFilters.importedFrom}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), importedFrom: event.target.value }))}
                    className="pq-input h-9 px-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--pq-text-muted)]">
                  {l('导入日期至', 'Imported to')}
                  <input type="date" value={structuredFilterDraft?.importedTo ?? structuredFilters.importedTo}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), importedTo: event.target.value }))}
                    className="pq-input h-9 px-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--pq-text-muted)]">
                  {l('最近阅读从', 'Last read from')}
                  <input type="date" value={structuredFilterDraft?.lastReadFrom ?? structuredFilters.lastReadFrom}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), lastReadFrom: event.target.value }))}
                    className="pq-input h-9 px-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--pq-text-muted)]">
                  {l('最近阅读至', 'Last read to')}
                  <input type="date" value={structuredFilterDraft?.lastReadTo ?? structuredFilters.lastReadTo}
                    onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), lastReadTo: event.target.value }))}
                    className="pq-input h-9 px-2 text-sm" />
                </label>
                <select value={structuredFilterDraft?.attachmentRole ?? structuredFilters.attachmentRole}
                  onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), attachmentRole: event.target.value as LiteratureStructuredFilters['attachmentRole'] }))}
                  className="pq-input col-span-2 h-9 px-2 text-sm" aria-label={l('附件角色', 'Attachment role')}>
                  <option value="any">{l('附件：全部', 'Attachments: All')}</option>
                  <option value="original-pdf">{l('有原文 PDF', 'Has original PDF')}</option>
                  <option value="translated-pdf">{l('有译文 PDF', 'Has translated PDF')}</option>
                  <option value="missing">{l('有缺失附件', 'Has missing attachment')}</option>
                  <option value="none">{l('无已登记附件', 'No registered attachments')}</option>
                </select>
                <select value={structuredFilterDraft?.mineruParseStatus ?? structuredFilters.mineruParseStatus}
                  onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), mineruParseStatus: event.target.value as LiteratureStructuredFilters['mineruParseStatus'] }))}
                  className="pq-input col-span-2 h-9 px-2 text-sm" aria-label={l('解析成果状态', 'Parse artifact status')}>
                  <option value="all">{l('解析：全部', 'Parse: All')}</option>
                  <option value="available">{l('解析成果可用', 'Parse artifact available')}</option>
                  <option value="missing">{l('解析成果不存在', 'Parse artifact missing')}</option>
                  <option value="unknown">{l('解析状态待核实', 'Parse status unverified')}</option>
                  <option value="error">{l('解析状态检查失败', 'Parse status check failed')}</option>
                </select>
                <div className="col-span-2 rounded-md border border-[var(--pq-border)] p-2">
                  <label className="mb-2 block text-xs text-[var(--pq-text-muted)]">{l('筛选适用元数据缺项（任一匹配）', 'Missing applicable metadata (any selected field)')}</label>
                  <input type="search" value={metadataFieldSearch} onChange={(event) => setMetadataFieldSearch(event.target.value)}
                    placeholder={l('搜索字段', 'Search fields')} className="pq-input mb-2 h-8 w-full px-2 text-xs" />
                  <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">
                    {metadataFieldOptions.map((field) => {
                      const selected = (structuredFilterDraft?.missingMetadataFields ?? structuredFilters.missingMetadataFields).includes(field.key);
                      return <label key={field.key} className="flex min-w-0 items-center gap-1.5 truncate text-xs" title={l(...field.labels)}>
                        <input type="checkbox" checked={selected} onChange={(event) => setStructuredFilterDraft((current) => {
                          const base = current ?? structuredFilters;
                          const next = new Set(base.missingMetadataFields);
                          if (event.target.checked) next.add(field.key); else next.delete(field.key);
                          return { ...base, missingMetadataFields: [...next] };
                        })} />
                        <span className="truncate">{l(...field.labels)}</span>
                      </label>;
                    })}
                    {metadataFieldOptions.length === 0 ? <span className="col-span-2 text-xs text-[var(--pq-text-faint)]">{l('没有匹配字段', 'No matching fields')}</span> : null}
                  </div>
                </div>
                <input value={structuredFilterDraft?.authorQuery ?? structuredFilters.authorQuery} placeholder={l('作者', 'Author')}
                  onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), authorQuery: event.target.value }))}
                  className="pq-input h-9 px-2 text-sm" />
                <input value={structuredFilterDraft?.publicationQuery ?? structuredFilters.publicationQuery} placeholder={l('刊物／会议', 'Publication / venue')}
                  onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), publicationQuery: event.target.value }))}
                  className="pq-input h-9 px-2 text-sm" />
                <input value={structuredFilterDraft?.keywordQuery ?? structuredFilters.keywordQuery} placeholder={l('关键词', 'Keyword')}
                  onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), keywordQuery: event.target.value }))}
                  className="pq-input h-9 px-2 text-sm" />
                <input value={structuredFilterDraft?.tagNames ?? structuredFilters.tagNames} placeholder={l('标签（逗号分隔，任一匹配）', 'Tags (comma separated, any match)')}
                  onChange={(event) => setStructuredFilterDraft((current) => ({ ...(current ?? structuredFilters), tagNames: event.target.value }))}
                  className="pq-input col-span-2 h-9 px-2 text-sm" />
                {yearDraftInvalid ? <p className="col-span-2 text-xs text-[var(--pq-danger)]" role="alert">{l('请输入有效年份范围，且起始年份不能晚于结束年份。', 'Enter a valid year range with the start no later than the end.')}</p> : null}
                {progressDraftInvalid ? <p className="col-span-2 text-xs text-[var(--pq-danger)]" role="alert">{l('阅读进度需为 0–100，且下限不能高于上限。', 'Progress must be 0–100, with the lower bound no greater than the upper bound.')}</p> : null}
                {timeDraftInvalid ? <p className="col-span-2 text-xs text-[var(--pq-danger)]" role="alert">{l('日期范围无效或起始日期晚于结束日期。', 'Date ranges must be valid and start no later than end.')}</p> : null}
                <div className="col-span-2 flex justify-between gap-2 border-t border-[var(--pq-border)] pt-2">
                  <button type="button" className="pq-button h-8 px-2 text-xs" onClick={() => setStructuredFilterDraft({ yearFrom: '', yearTo: '', unknownYearOnly: false, authorQuery: '', publicationQuery: '', keywordQuery: '', tagNames: '', readingState: 'all', progressFrom: '', progressTo: '', importedFrom: '', importedTo: '', lastReadFrom: '', lastReadTo: '', attachmentRole: 'any', mineruParseStatus: 'all', missingMetadataFields: [] })}>{l('清空', 'Clear')}</button>
                  <div className="flex gap-2">
                    <button type="button" className="pq-button h-8 px-2 text-xs" onClick={() => { filterDetailsRef.current?.removeAttribute('open'); }}>{l('取消', 'Cancel')}</button>
                    <button type="button" disabled={yearDraftInvalid || progressDraftInvalid || timeDraftInvalid} className="pq-button-primary h-8 px-3 text-xs disabled:opacity-50" onClick={() => { if (structuredFilterDraft) onStructuredFiltersChange(structuredFilterDraft); filterDetailsRef.current?.removeAttribute('open'); }}>{l('应用筛选', 'Apply filters')}</button>
                  </div>
                </div>
              </div>
            </details>
          ) : null}

          {structuredFilters && onStructuredFiltersChange && activeStructuredFilterCount > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label={l('已应用的属性筛选', 'Applied property filters')}>
              {structuredFilters.unknownYearOnly || structuredFilters.yearFrom || structuredFilters.yearTo ? (
                <button type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, yearFrom: '', yearTo: '', unknownYearOnly: false })}>
                  {structuredFilters.unknownYearOnly ? l('未知年份', 'Unknown year') : `${l('年份', 'Year')} ${structuredFilters.yearFrom || '…'}–${structuredFilters.yearTo || '…'}`}<X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{l('移除年份筛选', 'Remove year filter')}</span>
                </button>
              ) : null}
              {structuredFilters.readingState !== 'all' ? (
                <button type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, readingState: 'all' })}>
                  {structuredFilters.readingState === 'read' ? l('已读', 'Read') : l('未读', 'Unread')}<X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{l('移除阅读状态筛选', 'Remove reading state filter')}</span>
                </button>
              ) : null}
              {structuredFilters.progressFrom || structuredFilters.progressTo ? (
                <button type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, progressFrom: '', progressTo: '' })}>
                  {`${l('进度', 'Progress')} ${structuredFilters.progressFrom || '0'}–${structuredFilters.progressTo || '100'}%`}<X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{l('移除进度筛选', 'Remove progress filter')}</span>
                </button>
              ) : null}
              {structuredFilters.importedFrom || structuredFilters.importedTo ? (
                <button type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, importedFrom: '', importedTo: '' })}>
                  {`${l('导入', 'Imported')} ${structuredFilters.importedFrom || '…'}–${structuredFilters.importedTo || '…'}`}<X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{l('移除导入日期筛选', 'Remove import date filter')}</span>
                </button>
              ) : null}
              {structuredFilters.lastReadFrom || structuredFilters.lastReadTo ? (
                <button type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, lastReadFrom: '', lastReadTo: '' })}>
                  {`${l('最近阅读', 'Last read')} ${structuredFilters.lastReadFrom || '…'}–${structuredFilters.lastReadTo || '…'}`}<X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{l('移除最近阅读筛选', 'Remove last read filter')}</span>
                </button>
              ) : null}
              {structuredFilters.attachmentRole !== 'any' ? (
                <button type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, attachmentRole: 'any' })}>
                  {structuredFilters.attachmentRole === 'original-pdf' ? l('原文 PDF', 'Original PDF')
                    : structuredFilters.attachmentRole === 'translated-pdf' ? l('译文 PDF', 'Translated PDF')
                      : structuredFilters.attachmentRole === 'missing' ? l('缺失附件', 'Missing attachment') : l('无附件', 'No attachments')}<X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{l('移除附件筛选', 'Remove attachment filter')}</span>
                </button>
              ) : null}
              {structuredFilters.mineruParseStatus !== 'all' ? (
                <button type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, mineruParseStatus: 'all' })}>
                  {structuredFilters.mineruParseStatus === 'available' ? l('解析可用', 'Parse available')
                    : structuredFilters.mineruParseStatus === 'missing' ? l('解析缺失', 'Parse missing')
                      : structuredFilters.mineruParseStatus === 'error' ? l('解析检查失败', 'Parse check failed')
                        : l('解析待核实', 'Parse unverified')}<X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{l('移除解析状态筛选', 'Remove parse status filter')}</span>
                </button>
              ) : null}
              {structuredFilters.missingMetadataFields.map((field) => {
                const definition = applicableMetadataFilterFields().find((option) => option.key === field);
                const label = definition ? l(...definition.labels) : field;
                return <button key={field} type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, missingMetadataFields: structuredFilters.missingMetadataFields.filter((value) => value !== field) })}>
                  {l('缺项', 'Missing')}: {label}<X className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{l(`移除${label}缺项筛选`, `Remove missing ${label} filter`)}</span>
                </button>;
              })}
              {(['authorQuery', 'publicationQuery', 'keywordQuery', 'tagNames'] as const).map((field) => {
                const value = structuredFilters[field].trim();
                if (!value) return null;
                const label = field === 'authorQuery' ? l('作者', 'Author')
                  : field === 'publicationQuery' ? l('刊物', 'Publication')
                    : field === 'keywordQuery' ? l('关键词', 'Keyword') : l('标签', 'Tags');
                return (
                  <button key={field} type="button" className="pq-chip inline-flex items-center gap-1" onClick={() => onStructuredFiltersChange({ ...structuredFilters, [field]: '' })}>
                    {label}: {value}<X className="h-3 w-3" aria-hidden="true" />
                    <span className="sr-only">{l(`移除${label}筛选`, `Remove ${label} filter`)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <select
            value={titleDisplayMode}
            onChange={(event) => {
              const nextMode = event.target.value as PaperTitleDisplayMode;
              onTitleDisplayModeChange(nextMode);
              persistPaperTitleDisplayMode(nextMode);
            }}
            className="pq-input h-9 w-[132px] px-3 text-sm"
            title={l('标题语言显示', 'Title language display')}
          >
            <option value="both">{l('中英标题', 'Bilingual Titles')}</option>
            <option value="zh">{l('中文标题', 'Chinese Titles')}</option>
            <option value="original">{l('原文标题', 'Original Titles')}</option>
          </select>

          <button
            type="button"
            onClick={onImportPdfs}
            disabled={working}
            className="pq-button-primary h-9 px-3 text-sm"
          >
            <FilePlus2 className="mr-2 h-4 w-4" strokeWidth={1.9} />
            {l('导入 PDF', 'Import PDF')}
          </button>

          <button
            type="button"
            onClick={onInspectPdfAssets}
            disabled={working}
            className="pq-button inline-flex h-9 items-center gap-2 px-3 text-sm disabled:opacity-50"
            title={l('检查已登记的 PDF 附件与命名预览', 'Inspect registered PDF assets and naming preview')}
          >
            <HardDrive className="h-4 w-4" strokeWidth={1.9} />
            {l('存储体检', 'Storage audit')}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={working}
            className="pq-button h-9 px-3 text-sm"
          >
            <RefreshCw className="mr-2 h-4 w-4" strokeWidth={1.9} />
            {l('刷新', 'Refresh')}
          </button>
        </div>

        <div className="mt-2 text-xs text-[var(--pq-text-muted)]">
          {error ||
            statusMessage ||
            (manualSortingEnabled
              ? l('拖动把手可调整排序；拖动条目到分类可归类。', 'Drag the handle to reorder papers; drag the row onto a category to classify it.')
              : l('当前使用自动排序；拖动条目到分类仍可归类。', 'Automatic sorting is active. Dragging a row onto a category still classifies it.'))}
        </div>
      </header>

      <div
        data-wheel-scroll-target
        className="pq-paper-list h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3"
        onScroll={handleListScroll}
      >
        {loading ? (
          <div className="pq-card p-6 text-sm text-[var(--pq-text-muted)]">
            {l('正在加载文献库...', 'Loading library...')}
          </div>
        ) : papers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--pq-border)] bg-white/58 p-8 text-center dark:bg-white/5">
            <BookOpenText className="mx-auto h-9 w-9 text-[var(--pq-text-faint)] dark:text-[#a0a0a0]" strokeWidth={1.7} />
            <div className="mt-4 text-lg font-semibold">
              {l('还没有文献', 'No papers yet')}
            </div>
            <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--pq-text-muted)] dark:text-[#a0a0a0]">
              {l(
                '点击“导入 PDF”选择一个或多个文件。应用会把路径、附件和基础元数据保存到本地文库。',
                'Click "Import PDF" to select one or more files. The app will save paths, attachments, and basic metadata into the local library.',
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {papers.map((paper) => {
              const active = selectedPaper?.id === paper.id;
              const multiSelected = multiSelectedSet.has(paper.id);
              const titleDisplay = resolvePaperTitleDisplay(paper, titleDisplayMode);
              const pdfPath = paperPdfPath(paper, storageDir);
              const showBeforeIndicator =
                dropIndicator?.paperId === paper.id && dropIndicator.placement === 'before';
              const showAfterIndicator =
                dropIndicator?.paperId === paper.id && dropIndicator.placement === 'after';
              const status = paperStatuses[paper.id];
              const mineruParsed = status?.mineruParsed ?? false;
              const mineruStatus = status?.mineruStatus ?? (mineruParsed ? 'available' : 'unknown');
              const overviewGenerated =
                status?.overviewGenerated ?? Boolean(paper.aiSummary?.trim());
              const indexingRag = ragIndexingDocumentKey === paper.id;
              const storedRagStatus = ragBadgeByDocumentKey?.[paper.id];
              const ragStatus: LiteraturePaperRagStatus = paper.ragEnabled === false
                ? 'excluded'
                : storedRagStatus === 'excluded'
                  ? 'none'
                  : storedRagStatus ?? 'none';

              return (
                <div key={paper.id} className="pq-paper-row relative">
                  {showBeforeIndicator ? (
                    <div className="pointer-events-none absolute -top-1 left-3 right-3 z-10 h-0.5 rounded-full bg-[#2f7f85]" />
                  ) : null}
                  <div
                    role="button"
                    tabIndex={0}
                    data-paper-row-id={paper.id}
                    draggable={false}
                    onPointerDown={(event) => handleCategoryPointerDown(event, paper)}
                    onPointerMove={handleCategoryPointerMove}
                    onPointerUp={handleCategoryPointerUp}
                    onPointerCancel={resetCategoryDrag}
                    onDragStart={(event) => {
                      setDraggingPaperId(paper.id);
                      onPaperDragStart(event, paper);
                    }}
                    onDragOver={(event) => handlePaperDragOver(event, paper)}
                    onDragLeave={() => setDropIndicator(null)}
                    onDragEnd={() => {
                      setDropIndicator(null);
                      setDraggingPaperId(null);
                    }}
                    onDrop={(event) => handlePaperDrop(event, paper)}
                    onContextMenu={(event) => onPaperContextMenu(event, paper)}
                    onClick={(event) => {
                      if (suppressClickPaperId === paper.id) {
                        return;
                      }

                      onSelectPaper(paper.id, {
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey,
                        shiftKey: event.shiftKey,
                      });
                    }}
                    onDoubleClick={() => onOpenPaper(paper)}
                    onKeyDown={(event) => handleRowKeyDown(event, paper)}
                    className={clsx(
                      'pq-card pq-paper-row-card grid w-full gap-3 px-3 py-3 text-left transition',
                      showReadingHeatmap && 'pq-paper-row-card--heatmap',
                      manualSortingEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                      active
                        ? 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-soft)] ring-1 ring-[var(--pq-accent-ring)]'
                        : multiSelected
                          ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)]/60'
                          : dropIndicator?.paperId === paper.id
                            ? 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-soft)]'
                            : 'hover:border-[var(--pq-accent-border)] hover:bg-white/92',
                      sortDraggingPaperId === paper.id && 'opacity-60 ring-2 ring-[color-mix(in_srgb,var(--pq-accent)_30%,transparent)]',
                      categoryDraggingPaperId === paper.id && 'opacity-70 ring-2 ring-[color-mix(in_srgb,var(--pq-accent)_35%,transparent)]',
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
                            ? 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent)] text-white'
                            : 'border-[var(--pq-border)] bg-white/70 text-transparent hover:border-[var(--pq-accent-border)]',
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
                        onPointerDown={(event) => handleSortPointerDown(event, paper)}
                        onPointerMove={handleSortPointerMove}
                        onPointerUp={handleSortPointerUp}
                        onPointerCancel={resetSortDrag}
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
                        <span className="mt-0.5 block truncate text-xs text-[var(--pq-text-muted)] dark:text-[#a0a0a0]">
                          {titleDisplay.secondary}
                        </span>
                      ) : null}
                      <span className="mt-1 block truncate text-xs text-[var(--pq-text-muted)] dark:text-[#a0a0a0]">
                        {paperAuthors(paper, locale)}
                      </span>
                      <span className="pq-card-badges mt-2 flex flex-wrap gap-1.5">
                        <span
                          className={clsx(
                            'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                            status?.checkingMineru
                              ? 'border-[var(--pq-border-strong)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)] dark:border-white/10 dark:bg-white/[0.06] dark:text-[#a0a0a0]'
                              : mineruStatus === 'available'
                                ? 'border-[color-mix(in_srgb,var(--pq-success)_28%,transparent)] bg-[var(--pq-success-bg)] text-[var(--pq-success)] '
                                : mineruStatus === 'missing' || mineruStatus === 'error'
                                  ? 'border-[color-mix(in_srgb,var(--pq-warning)_28%,transparent)] bg-[var(--pq-warning-bg)] text-[var(--pq-warning)] '
                                  : 'border-[var(--pq-border)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)] dark:border-white/10 dark:bg-white/[0.06] dark:text-[#a0a0a0]',
                          )}
                        >
                          {status?.checkingMineru
                            ? l('MinerU 检测中', 'Checking MinerU')
                            : mineruStatus === 'available'
                              ? l('MinerU 已解析', 'MinerU Parsed')
                              : mineruStatus === 'missing'
                                ? l('MinerU 未解析', 'MinerU Not Parsed')
                                : mineruStatus === 'error'
                                  ? l('MinerU 检查失败', 'MinerU Check Failed')
                                  : l('MinerU 状态待核实', 'MinerU Status Unverified')}
                        </span>
                        {ragIndexAvailable || ragStatus === 'excluded' ? (
                          <span
                            title={
                              indexingRag
                                ? l('正在建立 RAG 索引', 'Building RAG index')
                                : ragStatus === 'failed'
                                  ? l('RAG 索引失败，可在设置中重建', 'RAG indexing failed; rebuild it in settings')
                                  : ragStatus === 'excluded'
                                    ? l('该文献已移出本地知识库', 'This paper is excluded from the local knowledge base')
                                    : undefined
                            }
                            className={clsx(
                              'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                              indexingRag && ragStatus !== 'excluded'
                                ? 'border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)] '
                                : ragStatus === 'ready'
                                  ? 'border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)] '
                                  : ragStatus === 'failed'
                                    ? 'border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-danger-bg)] text-[var(--pq-danger)] '
                                    : 'border-[var(--pq-border-strong)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)] dark:border-white/10 dark:bg-white/[0.06] dark:text-[#a0a0a0]',
                            )}
                          >
                            {indexingRag && ragStatus !== 'excluded'
                              ? l('RAG 索引中', 'RAG Indexing')
                              : ragStatus === 'excluded'
                                ? l('已排除', 'Excluded')
                                : ragStatus === 'ready'
                                  ? l('RAG 已索引', 'RAG Indexed')
                                  : ragStatus === 'failed'
                                    ? l('RAG 索引失败', 'RAG Index Failed')
                                    : ragStatus === 'pending'
                                      ? l('RAG 待索引', 'RAG Pending')
                                      : l('RAG 未索引', 'RAG Not Indexed')}
                          </span>
                        ) : null}
                        <span
                          className={clsx(
                            'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                            overviewGenerated
                              ? 'border-[color-mix(in_srgb,var(--pq-info)_28%,transparent)] bg-[var(--pq-info-bg)] text-[var(--pq-info)] '
                              : 'border-[var(--pq-border-strong)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)] dark:border-white/10 dark:bg-white/[0.06] dark:text-[#a0a0a0]',
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
                            <span className="rounded-full bg-[var(--pq-surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--pq-text-muted)] dark:bg-white/[0.06] dark:text-[#a0a0a0]">
                              +{paper.tags.length - 3}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      <span className="mt-2 block truncate text-[11px] text-[var(--pq-text-faint)] dark:text-[#8d8d8d]">
                        {pdfPath ? truncateMiddle(pdfPath, 68) : l('缺少 PDF 附件', 'Missing PDF attachment')}
                      </span>
                    </span>
                    {showReadingHeatmap ? (
                      <span className="pq-card-heatmap min-w-0 self-center">
                        <LiteratureReadingHeatmapPreview
                          heatmap={heatmapsByPaperId[paper.id] ?? null}
                        />
                      </span>
                    ) : null}
                    <span className="pq-card-year text-sm text-[var(--pq-text-muted)]">
                      {paper.year ?? 'n.d.'}
                    </span>
                    <span className="pq-card-date text-right text-xs text-[var(--pq-text-faint)]">
                      {new Date(paper.importedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {showAfterIndicator ? (
                    <div className="pointer-events-none absolute -bottom-1 left-3 right-3 z-10 h-0.5 rounded-full bg-[#2f7f85]" />
                  ) : null}
                </div>
              );
            })}
            {hasMorePapers || loadingMore ? (
              <div className="py-2 text-center text-xs text-[var(--pq-text-muted)]">
                {loadingMore
                  ? l('正在加载更多…', 'Loading more…')
                  : l(`已加载 ${papers.length} / ${resolvedTotal} 条，滚动加载更多`, `Loaded ${papers.length} / ${resolvedTotal}; scroll for more`)}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

