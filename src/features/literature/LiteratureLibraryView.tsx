import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Database, Sparkles, Star, Tag, Trash2 } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import { listLibraryCitationKeys } from '../../services/library';
import type { LiteraturePaper, LiteraturePaperTaskState } from '../../types/library';
import type { QaModelPreset, RagDocumentIndexStatus } from '../../types/reader';
import type {
  RagBatchMode,
  RagBatchRequest,
  RagBatchSelection,
} from '../../services/ragIndexStatus';
import { getFileNameFromPath } from '../../utils/text';
import ImportConfirmationDialog from './components/ImportConfirmationDialog';
import LibraryConfirmDialog from './components/LibraryConfirmDialog';
import LibraryTextInputDialog from './components/LibraryTextInputDialog';
import LiteratureCategorySidebar from './components/LiteratureCategorySidebar';
import LiteraturePaperDetails from './components/LiteraturePaperDetails';
import TranslatedPdfLanguageBatchDialog from './components/TranslatedPdfLanguageBatchDialog';
import TranslatedPdfLanguageConfirmDialog from './components/TranslatedPdfLanguageConfirmDialog';
import LiteraturePaperList, {
  type LiteraturePaperListStatus,
  type LiteraturePaperRagStatus,
} from './components/LiteraturePaperList';
import {
  CATEGORY_SIDEBAR_DEFAULT_WIDTH,
  DETAILS_PANEL_DEFAULT_WIDTH,
  CATEGORY_SIDEBAR_WIDTH_STORAGE_KEY,
  DETAILS_PANEL_WIDTH_STORAGE_KEY,
  clampCategorySidebarWidth,
  clampDetailsPanelWidth,
  loadCategorySidebarWidth,
  loadDetailsPanelWidth,
  type LiteratureLibraryDemoState,
} from './literatureLibraryUtils';
import {
  loadPaperTitleDisplayMode,
  type PaperTitleDisplayMode,
} from './titleDisplay';
import { usePaperFileLocationMenu } from './usePaperFileLocationMenu';
import type { RagPaperAction } from './ragActions';
import { Menu, type MenuEntry } from '../../ui/menu';
import { toast } from '../../ui/toast';
import { useLibraryCatalog } from './hooks/useLibraryCatalog';
import { usePaperSelection } from './hooks/usePaperSelection';
import { useMetadataJobs } from './hooks/useMetadataJobs';
import { useImportFlow } from './hooks/useImportFlow';
import { usePdfAssetAudit } from './hooks/usePdfAssetAudit';
import { useBatchOperations, type LibraryConfirmDialogState } from './hooks/useBatchOperations';
import { useCategoryActions } from './hooks/useCategoryActions';
import MetadataParseDialog from './dialogs/MetadataParseDialog';
import PdfAssetAuditDialog from './dialogs/PdfAssetAuditDialog';

interface LiteratureLibraryViewProps {
  onOpenPaper: (paper: LiteraturePaper) => void;
  mineruCacheDir?: string;
  autoLoadSiblingJson?: boolean;
  showReadingHeatmap?: boolean;
  demoLibrary?: LiteratureLibraryDemoState | null;
  paperActionStates?: Record<string, LiteraturePaperTaskState | null | undefined>;
  onRunMineruParse?: (paper: LiteraturePaper) => void;
  onTranslatePaper?: (paper: LiteraturePaper) => void;
  onTranslatePaperTitle?: (paper: LiteraturePaper) => Promise<string | null>;
  onGenerateSummary?: (paper: LiteraturePaper) => void;
  /** 批量标题翻译（P1）：由 Reader 层注入，作用于多选集合。 */
  onBatchTranslatePaperTitles?: (papers: LiteraturePaper[]) => void;
  /** 批量导出 Bib（P2）：由 Reader 层注入，作用于多选集合。mode=merged 合并单文件，separate 每篇一个文件。 */
  onBatchExportBib?: (papers: LiteraturePaper[], mode: 'merged' | 'separate') => void;
  batchTitleTranslationRunning?: boolean;
  /** 元数据智能提取所用的 LLM 预设（通常复用总结模型预设）。 */
  metadataLlmPreset?: QaModelPreset | null;
  /** 本地 RAG 索引可用（启用且 embedding 配置完整）。 */
  ragIndexAvailable?: boolean;
  /** paper id（rag_indexes.document_key）→ 聚合索引状态。 */
  ragBadgeByDocumentKey?: Record<string, LiteraturePaperRagStatus>;
  /** paper id → 逐来源索引状态，详情页面板使用。 */
  ragStatusEntriesByDocumentKey?: Record<string, RagDocumentIndexStatus[]>;
  /** 正在建立索引的文献 id。 */
  ragIndexingDocumentKey?: string;
  /** 右键菜单：为单篇文献建立/重建 RAG 索引。 */
  onIndexPaperRag?: (paperId: string) => void;
  /** 选中批量：按模式建立/重试/更新/重建 RAG 索引。 */
  onBatchRagIndex?: (request: RagBatchRequest) => void;
  /** 批量执行前预览候选与跳过原因，用于确认框。 */
  onPreviewBatchRagIndex?: (request: RagBatchRequest) => Promise<RagBatchSelection | null>;
  ragIndexRunning?: boolean;
  ragIndexPaused?: boolean;
  ragIndexProgress?: {
    total: number;
    completed: number;
    succeeded: number;
    skipped: number;
    failed: number;
    currentLabel: string;
  };
  onToggleRagIndexPause?: () => void;
  onCancelRagIndex?: () => void;
  /** MinerU 批量检测状态字典同步至父级。 */
  onPaperStatusesChange?: (statuses: Record<string, LiteraturePaperListStatus>) => void;
}

interface PaperContextMenuState {
  paper: LiteraturePaper;
  x: number;
  y: number;
}

export default function LiteratureLibraryView({
  onOpenPaper,
  mineruCacheDir = '',
  autoLoadSiblingJson = true,
  showReadingHeatmap = true,
  demoLibrary = null,
  paperActionStates = {},
  onRunMineruParse,
  onTranslatePaper,
  onTranslatePaperTitle,
  onGenerateSummary,
  onBatchTranslatePaperTitles,
  onBatchExportBib,
  batchTitleTranslationRunning = false,
  metadataLlmPreset = null,
  ragIndexAvailable = false,
  ragBadgeByDocumentKey,
  ragStatusEntriesByDocumentKey,
  ragIndexingDocumentKey = '',
  onIndexPaperRag,
  onBatchRagIndex,
  onPreviewBatchRagIndex,
  ragIndexRunning = false,
  ragIndexPaused = false,
  ragIndexProgress,
  onToggleRagIndexPause,
  onCancelRagIndex,
  onPaperStatusesChange,
}: LiteratureLibraryViewProps) {
  const l = useLocaleText();
  const demoMode = Boolean(demoLibrary);
  const [working, setWorking] = useState(false);
  const [batchWorking, setBatchWorking] = useState(false);
  const [paperSaving, setPaperSaving] = useState(false);
  const [citationKeys, setCitationKeys] = useState<Array<{ id: string; citationKey?: string | null }>>([]);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [bibExportMenuOpen, setBibExportMenuOpen] = useState(false);
  const [paperContextMenu, setPaperContextMenu] = useState<PaperContextMenuState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<LibraryConfirmDialogState | null>(null);
  const [titleDisplayMode, setTitleDisplayMode] = useState<PaperTitleDisplayMode>(
    () => loadPaperTitleDisplayMode(),
  );
  const [categorySidebarWidth, setCategorySidebarWidth] = useState(loadCategorySidebarWidth);
  const [categorySidebarResizing, setCategorySidebarResizing] = useState(false);
  const [detailsPanelWidth, setDetailsPanelWidth] = useState(loadDetailsPanelWidth);
  const [detailsPanelResizing, setDetailsPanelResizing] = useState(false);
  const categorySidebarResizeStartRef = useRef({
    clientX: 0,
    width: CATEGORY_SIDEBAR_DEFAULT_WIDTH,
  });
  const detailsPanelResizeStartRef = useRef({
    clientX: 0,
    width: DETAILS_PANEL_DEFAULT_WIDTH,
  });

  const catalog = useLibraryCatalog({
    demoLibrary,
    mineruCacheDir,
    autoLoadSiblingJson,
    l,
    onPaperStatusesChange,
  });
  const selection = usePaperSelection({
    demoLibrary,
    papers: catalog.papers,
    papersRef: catalog.papersRef,
    papersTotal: catalog.papersTotal,
    selectedPaperId: catalog.selectedPaperId,
    setSelectedPaperId: catalog.setSelectedPaperId,
    selectedCategoryId: catalog.selectedCategoryId,
    searchQuery: catalog.searchQuery,
    filters: catalog.filters,
    mineruPaperIds: catalog.mineruPaperIds,
    paperSort: catalog.paperSort,
    resolveDemoPapers: catalog.resolveDemoPapers,
    l,
    setBatchWorking,
    setStatusMessage: catalog.setStatusMessage,
    setError: catalog.setError,
  });
  const metadataJobs = useMetadataJobs({
    catalog,
    demoMode,
    l,
    metadataLlmPreset,
    setStatusMessage: catalog.setStatusMessage,
    setError: catalog.setError,
    setPaperSaving,
    setDialogBusy,
    setConfirmDialog,
  });
  const importFlow = useImportFlow({
    catalog,
    demoMode,
    l,
    metadataWorking: metadataJobs.metadataWorking,
    setMetadataWorking: metadataJobs.setMetadataWorking,
    resolveLlmMetadataFallback: metadataJobs.resolveLlmMetadataFallback,
    setStatusMessage: catalog.setStatusMessage,
    setError: catalog.setError,
    working,
    setWorking,
  });
  const pdfAssetAudit = usePdfAssetAudit();
  const batch = useBatchOperations({
    catalog,
    demoMode,
    l,
    setStatusMessage: catalog.setStatusMessage,
    setError: catalog.setError,
    setBatchWorking,
    setDialogBusy,
    setPaperSaving,
    setConfirmDialog,
    setPaperContextMenu,
    paperSelectionRef: selection.paperSelectionRef,
    resolveSelectedPapers: selection.resolveSelectedPapers,
    clearMultiSelection: selection.clearMultiSelection,
    ragBadgeByDocumentKey,
  });
  const categoryActions = useCategoryActions({
    catalog,
    demoMode,
    l,
    setStatusMessage: catalog.setStatusMessage,
    setError: catalog.setError,
    setDialogBusy,
    setConfirmDialog,
  });

  const {
    categories,
    papers,
    papersTotal,
    papersLoadingMore,
    paperStatuses,
    loading,
    papersRefreshing,
    statusMessage,
    error,
    searchQuery,
    setSearchQuery,
    selectedCategoryId,
    selectedPaper,
    flatCategories,
    libraryStorageDir,
    paperSort,
    setPaperSort,
    filters,
    setFilters,
    libraryTags,
    refreshAll,
    loadMorePapers,
    handleSelectCategory,
    showDemoLockedMessage,
    setStatusMessage,
    setError,
    setSelectedPaperId,
  } = catalog;

  // citationKey 查重只需 id + key；不再为详情表单保留整库 LiteraturePaper 快照。
  useEffect(() => {
    if (demoLibrary) {
      setCitationKeys(demoLibrary.papers.map((paper) => ({
        id: paper.id,
        citationKey: paper.citationKey ?? null,
      })));
      return undefined;
    }

    let cancelled = false;
    void listLibraryCitationKeys()
      .then((keys) => { if (!cancelled) setCitationKeys(keys); })
      .catch(() => { if (!cancelled) setCitationKeys([]); });
    return () => { cancelled = true; };
  }, [demoLibrary, selectedPaper?.updatedAt]);
  const {
    multiSelectedPaperIds,
    selectedCount,
    selectAllState,
    multiSelectedPapers,
    paperSelectionRef,
    clearMultiSelection,
    handleSelectPaperWithModifiers,
    resolveSelectedPapers,
    handleToggleSelectAll,
  } = selection;

  useEffect(() => {
    try {
      localStorage.setItem(CATEGORY_SIDEBAR_WIDTH_STORAGE_KEY, String(categorySidebarWidth));
    } catch {
    }
  }, [categorySidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(DETAILS_PANEL_WIDTH_STORAGE_KEY, String(detailsPanelWidth));
    } catch {
    }
  }, [detailsPanelWidth]);

  useEffect(() => {
    if (!detailsPanelResizing) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = detailsPanelResizeStartRef.current;

      setDetailsPanelWidth(clampDetailsPanelWidth(start.width + start.clientX - event.clientX));
    };

    const handlePointerUp = () => {
      setDetailsPanelResizing(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [detailsPanelResizing]);

  useEffect(() => {
    if (!categorySidebarResizing) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = categorySidebarResizeStartRef.current;

      setCategorySidebarWidth(clampCategorySidebarWidth(start.width + event.clientX - start.clientX));
    };

    const handlePointerUp = () => {
      setCategorySidebarResizing(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [categorySidebarResizing]);

  const handleStartCategorySidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    categorySidebarResizeStartRef.current = {
      clientX: event.clientX,
      width: categorySidebarWidth,
    };
    setCategorySidebarResizing(true);
  };

  const handleStartDetailsPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    detailsPanelResizeStartRef.current = {
      clientX: event.clientX,
      width: detailsPanelWidth,
    };
    setDetailsPanelResizing(true);
  };

  const handlePaperContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedPaperId(paper.id);
    setPaperContextMenu({
      paper,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleOpenTagDialogFromContextMenu = () => {
    if (demoMode) {
      showDemoLockedMessage();
      setPaperContextMenu(null);
      return;
    }

    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (paper) {
      metadataJobs.setTagDialogPaper(paper);
    }
  };

  const handleOpenMetadataDialogFromContextMenu = () => {
    if (demoMode) {
      showDemoLockedMessage();
      setPaperContextMenu(null);
      return;
    }

    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (paper) {
      metadataJobs.setMetadataDialog({
        paper,
        title: paper.title,
        doi: paper.doi ?? '',
      });
    }
  };

  const handleIndexPaperRagFromContextMenu = () => {
    if (demoMode) {
      showDemoLockedMessage();
      setPaperContextMenu(null);
      return;
    }

    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (paper) {
      onIndexPaperRag?.(paper.id);
    }
  };

  /** 行内角标与详情面板的共用动作入口。 */
  const handlePaperRagAction = useCallback((paper: LiteraturePaper, action: RagPaperAction) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    switch (action) {
      case 'include':
      case 'exclude':
        void batch.applyRagMembership([paper.id], action === 'include');
        return;
      case 'open-details':
        setSelectedPaperId(paper.id);
        return;
      case 'parse-mineru':
        onRunMineruParse?.(paper);
        return;
      default:
        onIndexPaperRag?.(paper.id);
    }
  }, [batch, demoMode, onIndexPaperRag, onRunMineruParse, setSelectedPaperId, showDemoLockedMessage]);

  const openBatchRagIndexConfirm = useCallback(async (mode: RagBatchMode) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    const paperIds = paperSelectionRef.current.ids;
    if (paperIds.length === 0 || !onPreviewBatchRagIndex) return;

    try {
      const selection = await onPreviewBatchRagIndex({ mode, paperIds });
      if (!selection) {
        setStatusMessage(l(
          '请先在设置中启用本地 RAG 并完成 Embedding 配置。',
          'Enable local RAG and finish the embedding configuration in settings first.',
        ));
        return;
      }
      if (selection.candidateIds.length === 0) {
        const skipped = selection.skipped;
        setStatusMessage(l(
          `选中范围内没有可索引的文献（未解析 ${skipped.unparsed}，已排除 ${skipped.excluded}，已就绪 ${skipped.ready}，待索引 ${skipped.pending}）。`,
          `No indexable papers in the selection (${skipped.unparsed} unparsed, ${skipped.excluded} excluded, ${skipped.ready} ready, ${skipped.pending} pending).`,
        ));
        return;
      }
      setConfirmDialog({ kind: 'batch-rag-index', paperIds, mode, selection });
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : l('无法准备 RAG 批量索引', 'Could not prepare the RAG batch');
      setError(message);
      setStatusMessage(message);
    }
  }, [
    demoMode,
    l,
    onPreviewBatchRagIndex,
    paperSelectionRef,
    setConfirmDialog,
    setError,
    setStatusMessage,
    showDemoLockedMessage,
  ]);

  const handleToggleFavoriteFromContextMenu = () => {
    if (demoMode) {
      showDemoLockedMessage();
      setPaperContextMenu(null);
      return;
    }

    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (!paper) {
      return;
    }

    void metadataJobs.handleToggleFavorite(paper);
  };

  const handleDeletePaperFromContextMenu = () => {
    const paper = paperContextMenu?.paper;

    setPaperContextMenu(null);

    if (paper) {
      batch.handleDeletePaper(paper);
    }
  };

  const paperFileLocationEntries = usePaperFileLocationMenu({
    paper: paperContextMenu?.paper ?? null,
    storageDir: libraryStorageDir,
    mineruCacheDir,
    autoLoadSiblingJson,
    l,
  });

  const paperContextMenuEntries = (): MenuEntry[] => {
    if (!paperContextMenu) {
      return [];
    }

    const paper = paperContextMenu.paper;
    const entries: MenuEntry[] = [
      {
        id: 'toggle-favorite',
        label: paper.isFavorite
          ? l('取消收藏', 'Remove from Favorites')
          : l('加入收藏', 'Add to Favorites'),
        disabled: paperSaving,
        icon: (
          <Star
            className="h-4 w-4 text-[var(--pq-warning)]"
            fill={paper.isFavorite ? 'currentColor' : 'none'}
            strokeWidth={1.9}
          />
        ),
        onSelect: handleToggleFavoriteFromContextMenu,
      },
      {
        id: 'add-tag',
        label: l('添加自定义标签', 'Add Custom Tag'),
        icon: <Tag className="h-4 w-4 text-[var(--pq-info)]" strokeWidth={1.9} />,
        onSelect: handleOpenTagDialogFromContextMenu,
      },
      {
        id: 'parse-metadata',
        label: l('解析元数据', 'Parse Metadata'),
        icon: <Sparkles className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />,
        onSelect: () => {
          handleOpenMetadataDialogFromContextMenu();
        },
      },
      {
        id: 'rag-membership',
        label: paper.ragEnabled === false
          ? l('加入本地知识库', 'Include in Local Knowledge Base')
          : l('移出本地知识库', 'Exclude from Local Knowledge Base'),
        disabled: paperSaving || batchWorking,
        icon: (
          <Database
            className="h-4 w-4 text-[var(--pq-text-muted)] dark:text-[var(--pq-text-faint)]"
            strokeWidth={1.9}
          />
        ),
        onSelect: () => {
          setPaperContextMenu(null);
          if (paper.ragEnabled === false) {
            void batch.applyRagMembership([paper.id], true);
            return;
          }
          setConfirmDialog({ kind: 'exclude-rag-paper', paper });
        },
      },
    ];

    if (ragIndexAvailable && onIndexPaperRag) {
      const ragStatus = ragBadgeByDocumentKey?.[paper.id] ?? 'none';
      entries.push({
        id: 'rag-index',
        label: ragIndexingDocumentKey === paper.id
          ? l('RAG 索引中…', 'Indexing…')
          : ragStatus === 'failed'
            ? l('重试 RAG 索引', 'Retry RAG indexing')
            : ragStatus === 'stale'
              ? l('更新 RAG 索引', 'Update RAG index')
              : ragStatus === 'none'
                ? l('建立 RAG 索引', 'Build RAG index')
                : l('重建 RAG 索引', 'Rebuild RAG index'),
        disabled: ragIndexingDocumentKey === paper.id || paper.ragEnabled === false,
        icon: <Database className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />,
        onSelect: handleIndexPaperRagFromContextMenu,
      });
    }

    entries.push(...paperFileLocationEntries);

    entries.push(
      { type: 'separator', id: 'delete-paper-separator' },
      {
        id: 'delete-paper',
        label: l('删除文献记录', 'Delete Paper Record'),
        tone: 'danger',
        icon: <Trash2 className="h-4 w-4" strokeWidth={1.9} />,
        onSelect: handleDeletePaperFromContextMenu,
      },
    );

    return entries;
  };

  return (
    <div
      className="pq-library-workspace pq-workspace-surface relative grid h-full min-h-0 overflow-hidden text-[var(--pq-text)]"
      style={{
        gridTemplateColumns: `${categorySidebarWidth}px minmax(360px,1fr) ${detailsPanelWidth}px`,
        gridTemplateRows: 'minmax(0, 1fr)',
      }}
    >
      <div className="h-full min-h-0 overflow-hidden">
        <LiteratureCategorySidebar
          categories={flatCategories}
          selectedCategoryId={selectedCategoryId}
          onCreateCategory={categoryActions.handleCreateCategory}
          onSelectCategory={handleSelectCategory}
          onRenameCategory={categoryActions.handleRenameCategory}
          onDeleteCategory={categoryActions.handleDeleteCategory}
          onCategoryMove={(categoryId, parentId) => void categoryActions.handleMoveCategory(categoryId, parentId)}
          externalDragOverCategoryId={categoryActions.paperDragOverCategoryId}
          onCategoryDrop={(event, category) => void categoryActions.handleCategoryDrop(event, category)}
        />
      </div>

      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--pq-border)] bg-[var(--pq-accent-soft)] px-4 py-2">
            <span className="text-xs font-semibold text-[var(--pq-accent)]">
              {l(`已选 ${selectedCount} 篇`, `${selectedCount} selected`)}
            </span>
            <div className="mx-1 h-4 w-px bg-[var(--pq-border)]" />
            <button type="button" disabled={batchWorking || demoMode} onClick={() => void batch.handleBeginBatchTranslatedPdfLanguage()} className="pq-button px-2.5 py-1 text-xs disabled:opacity-50">{l('设置译版语言', 'Set translated PDF language')}</button>
            {onBatchTranslatePaperTitles ? (
              <button
                type="button"
                disabled={batchWorking || batchTitleTranslationRunning || demoMode}
                onClick={() => {
                  void resolveSelectedPapers(paperSelectionRef.current.ids)
                    .then((resolved) => onBatchTranslatePaperTitles(resolved))
                    .catch((nextError) => {
                      const message = nextError instanceof Error
                        ? nextError.message
                        : l('读取选中文献失败', 'Failed to load the selected papers');
                      setError(message);
                      setStatusMessage(message);
                    });
                }}
                className="pq-button px-2.5 py-1 text-xs disabled:opacity-50"
              >
                {l('翻译标题', 'Translate Titles')}
              </button>
            ) : null}
            {onBatchExportBib ? (
              <span className="relative">
                <button
                  type="button"
                  disabled={batchWorking}
                  onClick={() => setBibExportMenuOpen((current) => !current)}
                  className="pq-button px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  {l('导出 Bib', 'Export Bib')}
                </button>
                {bibExportMenuOpen ? (
                  <span className="absolute left-0 top-full z-30 mt-1 flex min-w-[168px] flex-col rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface-1)] p-1 shadow-lg">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 text-left text-xs hover:bg-[var(--pq-accent-soft)]"
                      onClick={() => {
                        setBibExportMenuOpen(false);
                        void resolveSelectedPapers(paperSelectionRef.current.ids)
                          .then((resolved) => onBatchExportBib(resolved, 'merged'))
                          .catch((nextError) => {
                            const message = nextError instanceof Error
                              ? nextError.message
                              : l('读取选中文献失败', 'Failed to load the selected papers');
                            setError(message);
                            setStatusMessage(message);
                          });
                      }}
                    >
                      {l('合并为单个 .bib', 'Merge into one .bib')}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 text-left text-xs hover:bg-[var(--pq-accent-soft)]"
                      onClick={() => {
                        setBibExportMenuOpen(false);
                        void resolveSelectedPapers(paperSelectionRef.current.ids)
                          .then((resolved) => onBatchExportBib(resolved, 'separate'))
                          .catch((nextError) => {
                            const message = nextError instanceof Error
                              ? nextError.message
                              : l('读取选中文献失败', 'Failed to load the selected papers');
                            setError(message);
                            setStatusMessage(message);
                          });
                      }}
                    >
                      {l('每篇一个 .bib 文件', 'One .bib per paper')}
                    </button>
                  </span>
                ) : null}
              </span>
            ) : null}
            <select
              value=""
              disabled={batchWorking}
              onChange={(event) => {
                const categoryId = event.target.value;
                event.target.value = '';
                if (categoryId) {
                  void batch.handleBatchMoveToCategory(categoryId);
                }
              }}
              className="pq-input h-7 max-w-[140px] px-2 text-xs disabled:opacity-50"
              title={l('移动到分类', 'Move to category')}
            >
              <option value="">{l('移动到分类…', 'Move to…')}</option>
              {flatCategories
                .filter((category) => !category.isSystem)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={batchWorking || demoMode}
              onClick={batch.handleBatchIncludeRag}
              className="pq-button px-2.5 py-1 text-xs disabled:opacity-50"
            >
              {l('加入知识库', 'Include in Library')}
            </button>
            <button
              type="button"
              disabled={batchWorking || demoMode}
              onClick={batch.handleBatchExcludeRag}
              className="pq-button px-2.5 py-1 text-xs disabled:opacity-50"
            >
              {l('移出知识库', 'Exclude from Library')}
            </button>
            <select
              value=""
              disabled={batchWorking || ragIndexRunning || demoMode || !onPreviewBatchRagIndex}
              onChange={(event) => {
                const mode = event.target.value as RagBatchMode;
                event.target.value = '';
                if (mode) void openBatchRagIndexConfirm(mode);
              }}
              className="pq-input h-7 max-w-[150px] px-2 text-xs disabled:opacity-50"
              title={l('RAG 索引批量操作', 'Batch RAG indexing')}
            >
              <option value="">{l('RAG 索引…', 'RAG index…')}</option>
              <option value="missing">{l('补建未建立', 'Build missing')}</option>
              <option value="failed">{l('重试失败', 'Retry failed')}</option>
              <option value="stale">{l('更新过期', 'Update stale')}</option>
              <option value="rebuild">{l('重建全部', 'Rebuild all')}</option>
            </select>
            <button
              type="button"
              disabled={batchWorking}
              onClick={() => void batch.handleBatchSetFavorite(true)}
              className="pq-button px-2.5 py-1 text-xs disabled:opacity-50"
            >
              {l('收藏', 'Favorite')}
            </button>
            <button
              type="button"
              disabled={batchWorking}
              onClick={batch.handleBatchDeletePapers}
              className="pq-button px-2.5 py-1 text-xs text-[var(--pq-danger)] disabled:opacity-50 "
            >
              {l('删除', 'Delete')}
            </button>
            <button
              type="button"
              disabled={batchWorking}
              onClick={clearMultiSelection}
              className="pq-button px-2.5 py-1 text-xs disabled:opacity-50"
            >
              {l('取消选择', 'Clear')}
            </button>
          </div>
        ) : null}
        {ragIndexRunning && ragIndexProgress ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-accent-border)] bg-[var(--pq-accent-bg)] px-2.5 py-1.5 text-xs text-[var(--pq-accent)]">
            <span className="min-w-0 flex-1 truncate">
              {l(
                `RAG 索引 ${ragIndexProgress.completed}/${ragIndexProgress.total}：成功 ${ragIndexProgress.succeeded}，跳过 ${ragIndexProgress.skipped}，失败 ${ragIndexProgress.failed}`,
                `RAG indexing ${ragIndexProgress.completed}/${ragIndexProgress.total}: ${ragIndexProgress.succeeded} succeeded, ${ragIndexProgress.skipped} skipped, ${ragIndexProgress.failed} failed`,
              )}
              {ragIndexProgress.currentLabel ? ` · ${ragIndexProgress.currentLabel}` : ''}
            </span>
            <button
              type="button"
              onClick={onToggleRagIndexPause}
              disabled={!onToggleRagIndexPause}
              className="pq-button !h-7 px-2 text-xs disabled:opacity-50"
            >
              {ragIndexPaused ? l('继续', 'Resume') : l('暂停', 'Pause')}
            </button>
            <button
              type="button"
              onClick={onCancelRagIndex}
              disabled={!onCancelRagIndex}
              className="pq-button !h-7 px-2 text-xs disabled:opacity-50"
            >
              {l('取消', 'Cancel')}
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          <LiteraturePaperList
            loading={loading}
            working={working}
            refreshing={papersRefreshing}
            papers={papers}
            papersTotal={papersTotal}
            loadingMore={papersLoadingMore}
            onLoadMore={() => void loadMorePapers()}
            paperStatuses={paperStatuses}
            showReadingHeatmap={showReadingHeatmap}
            storageDir={libraryStorageDir}
            selectedPaper={selectedPaper}
            multiSelectedPaperIds={multiSelectedPaperIds}
            selectAllState={selectAllState}
            onToggleSelectAll={() => void handleToggleSelectAll()}
            searchQuery={searchQuery}
            filters={filters}
            onFiltersChange={setFilters}
            ragStatusDisabled={Boolean(demoLibrary)}
            tags={libraryTags}
            libraryTotal={categories.find((category) => category.id === selectedCategoryId)?.paperCount ?? categories.find((category) => category.systemKey === 'all')?.paperCount ?? papersTotal}
            sortBy={paperSort.sortBy}
            sortDirection={paperSort.sortDirection}
            titleDisplayMode={titleDisplayMode}
            statusMessage={statusMessage}
            error={error}
            onSearchQueryChange={setSearchQuery}
            onSortChange={(sortBy, sortDirection) => setPaperSort({ sortBy, sortDirection })}
            onTitleDisplayModeChange={setTitleDisplayMode}
            onImportPdfs={() => void importFlow.handleImportPdfs()}
            onInspectPdfAssets={() => void pdfAssetAudit.handleInspectPdfAssets()}
            onRefresh={() => void refreshAll()
              .then(() => toast.success(l('文献库已刷新', 'Library refreshed')))
              .catch((nextError: unknown) => toast.error(nextError instanceof Error ? nextError.message : l('刷新失败', 'Refresh failed')))}
            onSelectPaper={handleSelectPaperWithModifiers}
            onOpenPaper={onOpenPaper}
            onPaperDragStart={categoryActions.handlePaperDragStart}
            onPaperReorder={(draggedPaperId, targetPaperId, placement) =>
            void batch.handlePaperReorder(draggedPaperId, targetPaperId, placement)
          }
          onPaperDropOnCategory={categoryActions.handlePaperDropOnCategory}
          onPaperPointerDragOverCategory={categoryActions.setPaperDragOverCategoryId}
          onPaperContextMenu={handlePaperContextMenu}
          onRagAction={handlePaperRagAction}
          ragBadgeByDocumentKey={ragBadgeByDocumentKey}
          ragIndexingDocumentKey={ragIndexingDocumentKey}
          ragIndexAvailable={ragIndexAvailable}
        />
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={l('拖动调整本地文库导航宽度', 'Drag to resize the local library navigation')}
        title={l('拖动调整本地文库导航宽度', 'Drag to resize the local library navigation')}
        onPointerDown={handleStartCategorySidebarResize}
        onDoubleClick={() => setCategorySidebarWidth(CATEGORY_SIDEBAR_DEFAULT_WIDTH)}
        className={[
          'absolute bottom-0 top-0 z-40 w-4 -translate-x-1/2 cursor-col-resize touch-none',
          categorySidebarResizing ? 'bg-[color-mix(in_srgb,var(--pq-accent)_10%,transparent)]' : 'bg-transparent hover:bg-[color-mix(in_srgb,var(--pq-accent)_4%,transparent)]',
        ].join(' ')}
        style={{
          left: categorySidebarWidth,
          touchAction: 'none',
        }}
      >
        <div
          className={[
            'mx-auto h-full w-px transition',
            categorySidebarResizing
              ? 'bg-[var(--pq-accent)] shadow-[0_0_0_3px_rgba(45,212,191,0.16)]'
              : 'bg-[var(--pq-surface-3)] hover:bg-[var(--pq-accent-bg)] dark:bg-white/10 ',
          ].join(' ')}
        />
      </div>

      <div className="h-full min-h-0 overflow-hidden">
        {selectedCount >= 2 ? (
          <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
            <div className="rounded-[22px] border border-[var(--pq-border)] bg-white/70 p-4 dark:bg-white/5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--pq-text-faint)]">
                {l('批量操作', 'Batch Operations')}
              </div>
              <div className="mt-2 text-base font-semibold">
                {l(`已选择 ${selectedCount} 篇文献`, `${selectedCount} papers selected`)}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--pq-text-muted)]">
                {l(
                  '使用列表顶部的批量工具栏执行标题翻译、导出 Bib、移动分类、收藏或删除。再次普通点击任一篇文献可退出多选。',
                  'Use the batch toolbar above the list to translate titles, export Bib, move to a category, favorite, or delete. Click any paper normally to exit multi-select.',
                )}
              </p>
              <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto text-sm text-[var(--pq-text-muted)]">
                {multiSelectedPapers.slice(0, 12).map((paper) => (
                  <li key={paper.id} className="truncate">
                    · {paper.title}
                  </li>
                ))}
                {selectedCount > multiSelectedPapers.slice(0, 12).length ? (
                  <li className="text-[var(--pq-text-faint)]">
                    {l(`… 等 ${selectedCount} 篇`, `… and ${selectedCount} papers`)}
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : (
          <LiteraturePaperDetails
            selectedPaper={selectedPaper}
            titleDisplayMode={titleDisplayMode}
            saving={paperSaving}
            categories={categories}
            libraryTags={libraryTags}
            citationKeys={citationKeys}
            paperStatus={selectedPaper ? paperStatuses[selectedPaper.id] : undefined}
            storageDir={libraryStorageDir}
            mineruCacheDir={mineruCacheDir}
            autoLoadSiblingJson={autoLoadSiblingJson}
            onOpenPaper={onOpenPaper}
            onSavePaper={metadataJobs.handleSavePaper}
            onRestorePaperSelection={setSelectedPaperId}
            actionState={selectedPaper ? paperActionStates[selectedPaper.id] ?? null : null}
            onRunMineruParse={onRunMineruParse}
            onTranslatePaper={onTranslatePaper}
            onTranslatePaperTitle={onTranslatePaperTitle}
            onGenerateTranslatedPdf={(paper) => void metadataJobs.handleGenerateTranslatedPdf(paper)}
            onAttachTranslatedPdf={(paper) => void metadataJobs.handleAttachTranslatedPdf(paper)}
            onRemoveTranslatedPdf={metadataJobs.handleRemoveTranslatedPdf}
            onUpdateTranslatedPdfLanguage={metadataJobs.handleUpdateTranslatedPdfLanguage}
            onGenerateSummary={onGenerateSummary}
            ragStatus={
              selectedPaper?.ragEnabled === false
                ? 'excluded'
                : selectedPaper
                  ? ragBadgeByDocumentKey?.[selectedPaper.id] ?? 'none'
                  : 'none'
            }
            ragStatusEntries={selectedPaper ? ragStatusEntriesByDocumentKey?.[selectedPaper.id] ?? [] : []}
            ragIndexAvailable={ragIndexAvailable}
            ragIndexing={Boolean(selectedPaper && ragIndexingDocumentKey === selectedPaper.id)}
            ragMembershipBusy={batchWorking}
            onRagAction={handlePaperRagAction}
            onSetRagMembership={(paper, enabled) => {
              void batch.applyRagMembership([paper.id], enabled);
            }}
            onIndexPaperRag={onIndexPaperRag ? (paper) => onIndexPaperRag(paper.id) : undefined}
            onDeletePaper={batch.handleDeletePaper}
          />
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={l('拖动调整详情面板宽度', 'Drag to resize the details panel')}
        title={l('拖动调整详情面板宽度', 'Drag to resize the details panel')}
        onPointerDown={handleStartDetailsPanelResize}
        onDoubleClick={() => setDetailsPanelWidth(DETAILS_PANEL_DEFAULT_WIDTH)}
        className={[
          'absolute bottom-0 top-0 z-40 w-4 -translate-x-1/2 cursor-col-resize touch-none',
          detailsPanelResizing ? 'bg-[color-mix(in_srgb,var(--pq-accent)_10%,transparent)]' : 'bg-transparent hover:bg-[color-mix(in_srgb,var(--pq-accent)_4%,transparent)]',
        ].join(' ')}
        style={{
          right: detailsPanelWidth - 1,
          touchAction: 'none',
        }}
      >
        <div
          className={[
            'mx-auto h-full w-px transition',
            detailsPanelResizing
              ? 'bg-[var(--pq-accent)] shadow-[0_0_0_3px_rgba(45,212,191,0.16)]'
              : 'bg-[var(--pq-surface-3)] hover:bg-[var(--pq-accent-bg)] dark:bg-white/10 ',
          ].join(' ')}
        />
      </div>

      {importFlow.dropActive ? (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-bg)] text-center backdrop-blur-[2px]">
          <div className="pq-acrylic px-8 py-6">
            <div className="text-xl font-semibold">
              {l('松开鼠标导入 PDF', 'Drop to import PDFs')}
            </div>
            <div className="mt-2 text-sm text-[var(--pq-text-muted)]">
              {l('导入前会先显示元数据确认界面。', 'A metadata confirmation screen will appear before import.')}
            </div>
          </div>
        </div>
      ) : null}

      {paperContextMenu ? (
        <Menu
          x={paperContextMenu.x}
          y={paperContextMenu.y}
          title={paperContextMenu.paper.title}
          entries={paperContextMenuEntries()}
          onClose={() => setPaperContextMenu(null)}
          width={264}
        />
      ) : null}

      <MetadataParseDialog
        state={metadataJobs.metadataDialog}
        busy={metadataJobs.metadataDialogBusy}
        storageDir={libraryStorageDir}
        onChangeTitle={(value) =>
          metadataJobs.setMetadataDialog((current) =>
            current ? { ...current, title: value } : current,
          )
        }
        onChangeDoi={(value) =>
          metadataJobs.setMetadataDialog((current) =>
            current ? { ...current, doi: value } : current,
          )
        }
        onClose={() => metadataJobs.setMetadataDialog(null)}
        onSubmit={() => void metadataJobs.handleSubmitMetadataDialog()}
      />

      <ImportConfirmationDialog
        open={importFlow.importDialogOpen}
        drafts={importFlow.importDrafts}
        categories={categories}
        working={working}
        metadataWorking={metadataJobs.metadataWorking || importFlow.localImportMetadataWorking}
        onDraftChange={importFlow.handleImportDraftChange}
        onRemoveDraft={importFlow.handleRemoveImportDraft}
        onAutoFillMetadata={() => void importFlow.handleAutoFillImportMetadata(importFlow.importDrafts)}
        onClose={importFlow.handleCloseImportDialog}
        onConfirm={() => void importFlow.handleConfirmImportDrafts()}
      />

      {metadataJobs.translatedPdfAttachDraft ? <TranslatedPdfLanguageConfirmDialog
        paperTitle={metadataJobs.translatedPdfAttachDraft.paper.title}
        fileName={getFileNameFromPath(metadataJobs.translatedPdfAttachDraft.sourcePath)}
        busy={paperSaving}
        onClose={() => metadataJobs.setTranslatedPdfAttachDraft(null)}
        onConfirm={metadataJobs.handleConfirmTranslatedPdfAttach}
      /> : null}

      {batch.translatedPdfLanguageBatch ? <TranslatedPdfLanguageBatchDialog
        entries={batch.translatedPdfLanguageBatch.entries}
        skippedCount={batch.translatedPdfLanguageBatch.skippedCount}
        saving={batchWorking}
        onClose={() => batch.setTranslatedPdfLanguageBatch(null)}
        onSave={batch.handleSaveBatchTranslatedPdfLanguage}
      /> : null}

      <PdfAssetAuditDialog
        open={pdfAssetAudit.pdfAssetAuditOpen}
        loading={pdfAssetAudit.pdfAssetAuditLoading}
        error={pdfAssetAudit.pdfAssetAuditError}
        inventory={pdfAssetAudit.pdfAssetInventory}
        namePlan={pdfAssetAudit.pdfAssetNamePlan}
        duplicateAttachmentIds={pdfAssetAudit.duplicatePdfAttachmentIds}
        onClose={() => pdfAssetAudit.setPdfAssetAuditOpen(false)}
      />

      <LibraryTextInputDialog
        open={categoryActions.categoryNameDialog !== null}
        title={
          categoryActions.categoryNameDialog?.mode === 'rename'
            ? l('重命名分类', 'Rename Category')
            : categoryActions.categoryNameDialog?.parentCategory
              ? l('新建子分类', 'New Subcategory')
              : l('新建分类', 'New Category')
        }
        description={
          categoryActions.categoryNameDialog?.mode === 'create' && categoryActions.categoryNameDialog.parentCategory
            ? l(`在“${categoryActions.categoryNameDialog.parentCategory.name}”下创建子分类。`, `Create a subcategory under "${categoryActions.categoryNameDialog.parentCategory.name}".`,
              )
            : categoryActions.categoryNameDialog?.mode === 'create'
              ? l('分类会显示在文库目录树中，可通过拖拽调整位置。', 'The category will appear in the library tree and can be rearranged by drag and drop.')
              : l('只会修改分类名称，不会移动或删除 PDF 文件。', 'Only the category name changes. Paper files are not moved or deleted.')
        }
        label={l('分类名称', 'Category Name')}
        initialValue={categoryActions.categoryNameDialog?.mode === 'rename' ? categoryActions.categoryNameDialog.category.name : ''}
        placeholder={l('例如：文献综述', 'e.g. Literature Review')}
        confirmLabel={categoryActions.categoryNameDialog?.mode === 'rename' ? l('保存', 'Save') : l('创建', 'Create')}
        cancelLabel={l('取消', 'Cancel')}
        busy={dialogBusy}
        onClose={() => {
          if (!dialogBusy) {
            categoryActions.setCategoryNameDialog(null);
          }
        }}
        onSubmit={(value) => void categoryActions.handleSubmitCategoryName(value)}
      />

      <LibraryTextInputDialog
        open={metadataJobs.tagDialogPaper !== null}
        title={l('添加自定义标签', 'Add Custom Tag')}
        description={
          metadataJobs.tagDialogPaper
            ? l(`为“${metadataJobs.tagDialogPaper.title}”添加自定义标签。状态徽章不会保存为文献标签。`, `Add a custom tag to "${metadataJobs.tagDialogPaper.title}". Status badges are not saved as paper tags.`,
              )
            : ''
        }
        label={l('标签名称', 'Tag Name')}
        initialValue=""
        placeholder={l('例如：待读 / 方法 / 综述', 'e.g. To Read / Method / Review')}
        confirmLabel={l('添加', 'Add')}
        cancelLabel={l('取消', 'Cancel')}
        busy={dialogBusy}
        onClose={() => {
          if (!dialogBusy) {
            metadataJobs.setTagDialogPaper(null);
          }
        }}
        onSubmit={(value) => void metadataJobs.handleSubmitPaperTag(value)}
      />

      <LibraryConfirmDialog
        open={confirmDialog !== null}
        title={
          confirmDialog?.kind === 'delete-category'
            ? l('删除分类', 'Delete Category')
            : confirmDialog?.kind === 'remove-translated-pdf'
              ? l('移除翻译版 PDF', 'Remove Translated PDF')
              : confirmDialog?.kind === 'delete-papers'
                ? l('批量删除文献', 'Delete Selected Papers')
                : confirmDialog?.kind === 'exclude-rag-papers' || confirmDialog?.kind === 'exclude-rag-paper'
                  ? l('移出本地知识库', 'Exclude from Local Knowledge Base')
                  : confirmDialog?.kind === 'batch-rag-index'
                    ? l('批量建立 RAG 索引', 'Batch RAG Indexing')
                    : l('删除文献', 'Delete Paper')
        }
        description={
          confirmDialog?.kind === 'delete-category'
            ? l(`删除分类“${confirmDialog.category.name}”及其所有子分类？这只会移除分类关系，不会删除磁盘上的 PDF 文件。`, `Delete category "${confirmDialog.category.name}" and all subcategories? This only removes category relations and does not delete PDF files on disk.`,
              )
            : confirmDialog?.kind === 'delete-papers'
              ? confirmDialog.deleteFiles
                ? l(`从所有文献中删除选中的 ${confirmDialog.paperIds.length} 篇文献？这也会删除磁盘上的 PDF 文件。`, `Delete the selected ${confirmDialog.paperIds.length} papers from All Papers? This will also delete PDF files from disk.`,
                  )
                : l(`删除选中的 ${confirmDialog.paperIds.length} 篇文献记录？磁盘上的 PDF 文件不会被删除。`, `Delete the records of the selected ${confirmDialog.paperIds.length} papers? PDF files on disk will not be deleted.`,
                  )
            : confirmDialog?.kind === 'delete-paper'
              ? confirmDialog.deleteFiles
                ? l(`从所有文献中删除“${confirmDialog.paper.title}”？这也会删除磁盘上的 PDF 文件。`, `Delete "${confirmDialog.paper.title}" from All Papers? This will also delete PDF files from disk.`,
                  )
                : l(`删除“${confirmDialog.paper.title}”的文献记录？磁盘上的 PDF 文件不会被删除。`, `Delete the paper record for "${confirmDialog.paper.title}"? PDF files on disk will not be deleted.`,
                  )
              : confirmDialog?.kind === 'remove-translated-pdf'
                ? l(`移除“${confirmDialog.paper.title}”的翻译版 PDF（${confirmDialog.fileName}）？文献库中的副本文件会被删除，原始 PDF 不受影响。`, `Remove the translated PDF (${confirmDialog.fileName}) for "${confirmDialog.paper.title}"? The stored copy will be deleted. The original PDF is not affected.`,
                  )
                : confirmDialog?.kind === 'exclude-rag-papers'
                  ? l(
                    `移出选中的 ${confirmDialog.paperIds.length} 篇，其中 ${confirmDialog.indexedCount} 篇已有索引。将删除这些索引；PDF、解析结果和笔记保留；之后需要重新建立索引才能再被检索。`,
                    `Exclude the selected ${confirmDialog.paperIds.length} papers, ${confirmDialog.indexedCount} of which already have an index. Those indexes will be deleted. PDFs, parsed content, and notes stay. Index them again before they can be retrieved.`,
                  )
                  : confirmDialog?.kind === 'exclude-rag-paper'
                    ? l(
                      '将删除该文献已建立的索引；PDF、解析结果和笔记保留；之后需要重新建立索引才能再被检索。',
                      'This deletes the paper’s existing index. The PDF, parsed content, and notes stay. It must be indexed again before it can be retrieved.',
                    )
                    : confirmDialog?.kind === 'batch-rag-index'
                      ? l(
                        `将处理 ${confirmDialog.selection.candidateIds.length} 篇文献并调用 Embedding 服务。跳过：未解析 ${confirmDialog.selection.skipped.unparsed}、已排除 ${confirmDialog.selection.skipped.excluded}、已就绪 ${confirmDialog.selection.skipped.ready}、待索引 ${confirmDialog.selection.skipped.pending}、其他 ${confirmDialog.selection.skipped.other}。执行后可在批量栏暂停或取消。`,
                        `This will process ${confirmDialog.selection.candidateIds.length} papers and call the embedding service. Skipped: ${confirmDialog.selection.skipped.unparsed} unparsed, ${confirmDialog.selection.skipped.excluded} excluded, ${confirmDialog.selection.skipped.ready} ready, ${confirmDialog.selection.skipped.pending} pending, ${confirmDialog.selection.skipped.other} other. You can pause or cancel from the batch bar.`,
                      )
                      : ''
        }
        confirmLabel={
          confirmDialog?.kind === 'batch-rag-index'
            ? l('开始索引', 'Start indexing')
            : confirmDialog?.kind === 'exclude-rag-papers' || confirmDialog?.kind === 'exclude-rag-paper'
              ? l('移出', 'Exclude')
              : confirmDialog?.kind === 'remove-translated-pdf'
                ? l('移除', 'Remove')
                : l('删除', 'Delete')
        }
        cancelLabel={l('取消', 'Cancel')}
        busy={dialogBusy}
        danger={confirmDialog?.kind !== 'batch-rag-index'}
        onClose={() => {
          if (!dialogBusy) {
            setConfirmDialog(null);
          }
        }}
        onConfirm={() => {
          if (!confirmDialog) {
            return;
          }

          if (confirmDialog.kind === 'delete-category') {
            void categoryActions.deleteCategoryAfterConfirm(confirmDialog.category);
            return;
          }

          if (confirmDialog.kind === 'remove-translated-pdf') {
            void metadataJobs.removeTranslatedPdfAfterConfirm(confirmDialog.attachmentId);
            return;
          }

          if (confirmDialog.kind === 'delete-papers') {
            void batch.deletePapersAfterConfirm(confirmDialog.paperIds, confirmDialog.deleteFiles);
            return;
          }

          if (confirmDialog.kind === 'exclude-rag-papers') {
            void batch.applyRagMembership(confirmDialog.paperIds, false);
            return;
          }

          if (confirmDialog.kind === 'exclude-rag-paper') {
            void batch.applyRagMembership([confirmDialog.paper.id], false);
            return;
          }

          if (confirmDialog.kind === 'batch-rag-index') {
            const request = {
              mode: confirmDialog.mode,
              paperIds: confirmDialog.selection.candidateIds,
            };
            setConfirmDialog(null);
            onBatchRagIndex?.(request);
            return;
          }

          void batch.deletePaperAfterConfirm(confirmDialog.paper, confirmDialog.deleteFiles);
        }}
      />
    </div>
  );
}
