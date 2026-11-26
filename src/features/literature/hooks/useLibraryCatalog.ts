import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { localPathsExist } from '../../../services/desktop';
import {
  getLibraryPaperSummary,
  initializeLiteratureLibrary,
  listAllLibraryPapers,
  listLibraryCategories,
  queryLibraryPapers,
} from '../../../services/library';
import type {
  LibrarySettings,
  LibraryTagCount,
  LiteratureCategory,
  LiteraturePaper,
  ListPapersRequest,
} from '../../../types/library';
import type { LiteraturePaperListStatus } from '../components/LiteraturePaperList';
import type { LibraryFilterState } from '../libraryFilters';
import { DEFAULT_LIBRARY_FILTERS, buildPaperQuery, matchesDemoLibraryFilters } from '../libraryFilters';
import { flattenCategories, type FlatLiteratureCategory } from '../literatureUi';
import {
  applyPaperMineruStatusUpdate,
  applyPaperSummaryStatusUpdate,
  buildInitialPaperStatuses,
  filterDemoPapers,
  markPaperStatusesCheckingMineru,
  mergePaperListSummary,
  mineruOutputPathCandidatesForPaper,
  resolveSelectedPaperId,
  type LiteratureLibraryDemoState,
} from '../literatureLibraryUtils';
import { EXTERNAL_LIBRARY_WRITE_EVENT } from '../../../services/externalWrite';
import {
  NATIVE_PAPER_UPDATED_EVENT,
  type LibraryReadingUpdatedEventDetail,
  type NativePaperUpdatedEventDetail,
} from '../libraryEvents';
import { useLibraryFilters } from '../useLibraryFilters';
import { useLibraryQueryRefresh } from '../useLibraryQueryRefresh';
import { loadLibraryFirstScreen } from '../libraryFirstScreen';
import {
  createRefreshingGate,
  paperQueryConditionsKey,
  resolveRefreshedSelection,
  shouldRefreshForMineruDiscovery,
  shouldSkipDebouncedQuery,
  type DebouncedQuerySkip,
} from '../libraryQueryPolicy';

type LocaleText = (zh: string, en: string) => string;

export type LiteraturePaperSortBy = NonNullable<ListPapersRequest['sortBy']>;
export type LiteraturePaperSortDirection = NonNullable<ListPapersRequest['sortDirection']>;

export interface PaperSortState {
  sortBy: LiteraturePaperSortBy;
  sortDirection: LiteraturePaperSortDirection;
}

interface NativeSummaryUpdatedEventDetail {
  paperId: string;
  aiSummary: string | null;
}

interface NativeMineruStatusUpdatedEventDetail {
  paperId: string;
  mineruParsed: boolean;
}

const PAPER_SORT_STORAGE_KEY = 'paperquay-literature-paper-sort-v1';
/** SQL 分页每页条数（P2-1）：首屏只取一页，滚动接近底部再追加。 */
export const PAPER_PAGE_SIZE = 500;

/** 需要「全库文献」的后台任务（MinerU 状态/批量元数据）按页取齐，不再受 1000 条硬上限截断。 */
export async function fetchAllLibraryPapers(): Promise<LiteraturePaper[]> {
  return listAllLibraryPapers(
    buildPaperQuery(DEFAULT_LIBRARY_FILTERS, { sortBy: 'manual', sortDirection: 'asc' }, null, ''),
  );
}
const PAPER_SORT_FIELDS: LiteraturePaperSortBy[] = [
  'manual',
  'title',
  'year',
  'author',
  'importedAt',
  'updatedAt',
  'lastReadAt',
];

function loadPaperSortState(): PaperSortState {
  try {
    const parsed = JSON.parse(localStorage.getItem(PAPER_SORT_STORAGE_KEY) ?? '{}') as Partial<PaperSortState>;

    return {
      sortBy: parsed.sortBy && PAPER_SORT_FIELDS.includes(parsed.sortBy) ? parsed.sortBy : 'manual',
      sortDirection: parsed.sortDirection === 'desc' ? 'desc' : 'asc',
    };
  } catch {
    return { sortBy: 'manual', sortDirection: 'asc' };
  }
}

export interface LibraryCatalogOptions {
  demoLibrary: LiteratureLibraryDemoState | null;
  mineruCacheDir: string;
  autoLoadSiblingJson: boolean;
  l: LocaleText;
  onPaperStatusesChange?: (statuses: Record<string, LiteraturePaperListStatus>) => void;
}

export interface LibraryCatalog {
  demoMode: boolean;
  settings: LibrarySettings | null;
  setSettings: Dispatch<SetStateAction<LibrarySettings | null>>;
  categories: LiteratureCategory[];
  setCategories: Dispatch<SetStateAction<LiteratureCategory[]>>;
  papers: LiteraturePaper[];
  setPapers: Dispatch<SetStateAction<LiteraturePaper[]>>;
  papersRef: MutableRefObject<LiteraturePaper[]>;
  papersTotal: number;
  setPapersTotal: Dispatch<SetStateAction<number>>;
  /** null=未按 RAG 状态筛选；false=RAG 库不可用。 */
  ragStatusAvailable: boolean | null;
  papersLoadingMore: boolean;
  /** 后台刷新（分类/筛选/状态联动），与首次加载的 loading 区分。 */
  papersRefreshing: boolean;
  paperStatuses: Record<string, LiteraturePaperListStatus>;
  setPaperStatuses: Dispatch<SetStateAction<Record<string, LiteraturePaperListStatus>>>;
  loading: boolean;
  statusMessage: string;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  selectedCategoryId: string | null;
  setSelectedCategoryId: Dispatch<SetStateAction<string | null>>;
  selectedPaperId: string | null;
  setSelectedPaperId: Dispatch<SetStateAction<string | null>>;
  selectedCategory: LiteratureCategory | null;
  selectedPaper: LiteraturePaper | null;
  flatCategories: FlatLiteratureCategory[];
  libraryStorageDir: string;
  paperSort: PaperSortState;
  setPaperSort: Dispatch<SetStateAction<PaperSortState>>;
  filters: LibraryFilterState;
  setFilters: Dispatch<SetStateAction<LibraryFilterState>>;
  libraryTags: LibraryTagCount[];
  mineruIdKey: string;
  mineruPaperIds: string[];
  allPapersSnapshotRef: MutableRefObject<LiteraturePaper[]>;
  papersQueryGenerationRef: MutableRefObject<number>;
  refreshPapers: (nextCategoryId?: string | null) => Promise<LiteraturePaper[]>;
  refreshAll: () => Promise<void>;
  loadMorePapers: () => Promise<void>;
  refreshMineruStatusesForPapers: (
    targetPapers: LiteraturePaper[],
    shouldCancel?: () => boolean,
  ) => Promise<void>;
  resolveDemoPapers: (nextCategoryId?: string | null) => LiteraturePaper[];
  /** 分类查询已直接发出：登记条件键，让条件一致的防抖查询跳过（分类动作复用）。 */
  markCategoryQueryHandled: (categoryId: string | null) => void;
  handleSelectCategory: (categoryId: string) => void;
  reloadAfterPaperUpdate: (updatedPaper: LiteraturePaper) => Promise<void>;
  showDemoLockedMessage: () => void;
}

/**
 * 文献库目录数据：初始化、分类、筛选查询、分页、刷新、MinerU 状态与设置。
 * 从 LiteratureLibraryView 原样搬出，保持原有回调依赖与 effect 顺序。
 */
export function useLibraryCatalog({
  demoLibrary,
  mineruCacheDir,
  autoLoadSiblingJson,
  l,
  onPaperStatusesChange,
}: LibraryCatalogOptions): LibraryCatalog {
  const demoMode = Boolean(demoLibrary);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [categories, setCategories] = useState<LiteratureCategory[]>([]);
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  // SQL 分页（P2-1）：papers 是「当前筛选结果」的已加载前缀；papersTotal 是完整匹配数。
  const [papersTotal, setPapersTotal] = useState(0);
  const [ragStatusAvailable, setRagStatusAvailable] = useState<boolean | null>(null);
  const [papersLoadingMore, setPapersLoadingMore] = useState(false);
  // 首次加载走 loading；后台刷新单独标记，避免把整页骨架屏重新打开。
  const [papersRefreshing, setPapersRefreshing] = useState(false);
  const [mineruDiscoveryVersion, setMineruDiscoveryVersion] = useState(0);
  const mineruDiscoveryInFlightRef = useRef(0);
  const mineruDiscoveryHandledVersionRef = useRef(0);
  const papersRef = useRef<LiteraturePaper[]>([]);
  const papersQueryGenerationRef = useRef(0);

  useEffect(() => {
    papersRef.current = papers;
  }, [papers]);
  const [paperStatuses, setPaperStatuses] = useState<Record<string, LiteraturePaperListStatus>>({});

  useEffect(() => {
    onPaperStatusesChange?.(paperStatuses);
  }, [onPaperStatusesChange, paperStatuses]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const selectedCategoryIdRef = useRef<string | null>(null);
  // 渲染期同步：处理函数（如双击分类）和初始化 effect 都能读到已提交的分类。
  selectedCategoryIdRef.current = selectedCategoryId;
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { filters, setFilters, libraryTags, mineruIdKey, mineruPaperIds } = useLibraryFilters({
    demoPapers: demoLibrary?.papers, categories, paperStatuses,
  });
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [paperSort, setPaperSort] = useState(loadPaperSortState);
  const checkedMineruPaperIdsRef = useRef<Set<string>>(new Set());
  // init/refreshAll 拉取的全量文献快照，供 MinerU 状态检查复用，避免启动时重复全库查询。
  const allPapersSnapshotRef = useRef<LiteraturePaper[]>([]);
  const mineruStatusConfigKey = useMemo(
    () => `${mineruCacheDir.trim()}::${autoLoadSiblingJson ? 'auto-sibling' : 'cache-only'}`,
    [autoLoadSiblingJson, mineruCacheDir],
  );
  const mineruStatusConfigKeyRef = useRef(mineruStatusConfigKey);
  // 首屏初始化时用最新筛选状态构造第一页查询；用户若在初始化期间改筛选，
  // 后面的 180ms 防抖查询会以新条件覆盖，不会把旧条件写回状态。
  const queryStateRef = useRef({ filters, paperSort, searchQuery, mineruPaperIds, selectedCategoryId });
  queryStateRef.current = { filters, paperSort, searchQuery, mineruPaperIds, selectedCategoryId };
  // 只由用户筛选/排序/搜索/分类变化驱动查询；MinerU 后台状态发现不进入该键。
  const queryConditionsKey = useMemo(
    () => paperQueryConditionsKey(filters, paperSort, searchQuery, selectedCategoryId),
    [filters, paperSort, searchQuery, selectedCategoryId],
  );
  const skipNextDebouncedQueryRef = useRef<DebouncedQuerySkip | null>(null);
  // 并发刷新闸门：先结束的刷新不能清掉仍在运行刷新的状态提示。
  const refreshGateRef = useRef(createRefreshingGate());

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );
  const libraryStorageDir = settings?.storageDir ?? '';
  const selectedPaper = useMemo(
    () => papers.find((paper) => paper.id === selectedPaperId) ?? papers[0] ?? null,
    [papers, selectedPaperId],
  );

  const showDemoLockedMessage = useCallback(() => {
    setStatusMessage(
      l(
        '演示模式不允许修改真实文库。',
        'Demo mode does not allow changes to the real library.',
      ),
    );
  }, [l]);

  const refreshMineruStatusesForPapers = useCallback(
    async (
      targetPapers: LiteraturePaper[],
      shouldCancel: () => boolean = () => false,
      storageDirOverride?: string,
    ) => {
      if (demoLibrary || targetPapers.length === 0) {
        return;
      }
      const effectiveStorageDir = storageDirOverride ?? libraryStorageDir;

      const uniquePapers = Array.from(
        new Map(targetPapers.map((paper) => [paper.id, paper])).values(),
      );
      const uncheckedPapers = uniquePapers.filter(
        (paper) => !checkedMineruPaperIdsRef.current.has(paper.id),
      );
      const uncheckedPaperIds = new Set(uncheckedPapers.map((paper) => paper.id));

      setPaperStatuses((current) =>
        markPaperStatusesCheckingMineru(current, uniquePapers, uncheckedPaperIds),
      );

      if (uncheckedPapers.length === 0) {
        return;
      }

      if (uncheckedPapers.length > 0) {
        mineruDiscoveryInFlightRef.current += 1;
        let discovered = false;
        try {
        // 提前标记，避免并发重入时重复检查同一批文献。
        for (const paper of uncheckedPapers) {
          checkedMineruPaperIdsRef.current.add(paper.id);
        }

        // 大库分批检查：每批一次批量 IPC，批次间让出主线程；
        // 调用方将当前可见文献排在前面，保证可见项状态优先就绪，
        // 其余条目在后台分批补齐（limit-concurrency backfill）。
        const MINERU_STATUS_BATCH_SIZE = 400;
        let processedCount = 0;

        const rollbackUncheckedMarks = (papersToRollback: LiteraturePaper[]) => {
          for (const paper of papersToRollback) {
            checkedMineruPaperIdsRef.current.delete(paper.id);
          }
        };

        for (let start = 0; start < uncheckedPapers.length; start += MINERU_STATUS_BATCH_SIZE) {
          if (shouldCancel()) {
            // 取消时回滚未处理批次的标记，让下一次运行重新检查；同时清除已写入的
            // checking 状态，避免没有后续运行时界面永久停在“检测中”。
            rollbackUncheckedMarks(uncheckedPapers.slice(processedCount));
            const remainingPaperIds = new Set(
              uncheckedPapers.slice(processedCount).map((paper) => paper.id),
            );
            setPaperStatuses((current) =>
              Object.fromEntries(
                Object.entries(current).map(([paperId, status]) => [
                  paperId,
                  remainingPaperIds.has(paperId) && status.checkingMineru
                    ? { ...status, checkingMineru: false }
                    : status,
                ]),
              ),
            );
            return;
          }

          // 汇总本批候选路径，单次 IPC 批量检查，避免每篇文献多次 IPC 往返。
          const batch = uncheckedPapers.slice(start, start + MINERU_STATUS_BATCH_SIZE);

          try {
            const candidatesByPaper = batch.map((paper) => ({
              paper,
              candidates: mineruOutputPathCandidatesForPaper(
                paper,
                mineruCacheDir,
                autoLoadSiblingJson,
                effectiveStorageDir,
              ),
            }));
            const uniquePaths = Array.from(
              new Set(candidatesByPaper.flatMap((item) => item.candidates)),
            );
            const existence = await localPathsExist(uniquePaths);

            if (shouldCancel()) {
              rollbackUncheckedMarks(uncheckedPapers.slice(processedCount));
              const remainingPaperIds = new Set(
                uncheckedPapers.slice(processedCount).map((paper) => paper.id),
              );
              setPaperStatuses((current) =>
                Object.fromEntries(
                  Object.entries(current).map(([paperId, status]) => [
                    paperId,
                    remainingPaperIds.has(paperId) && status.checkingMineru
                      ? { ...status, checkingMineru: false }
                      : status,
                  ]),
                ),
              );
              return;
            }

            const existsByPath = new Map(uniquePaths.map((candidate, index) => [candidate, existence[index] === true]));
            const batchEntries: Array<[string, LiteraturePaperListStatus]> = [];

            for (const { paper, candidates } of candidatesByPaper) {
              batchEntries.push([
                paper.id,
                {
                  mineruParsed: candidates.some((candidate) => existsByPath.get(candidate) === true),
                  overviewGenerated: Boolean(paper.aiSummary?.trim()),
                  checkingMineru: false,
                },
              ]);
            }

            setPaperStatuses((current) => ({
              ...current,
              ...Object.fromEntries(batchEntries),
            }));
            discovered = true;
            processedCount = start + batch.length;
          } catch {
            // 本批检查失败时回滚标记并清除 checking 状态，允许后续重试；其余批次继续。
            rollbackUncheckedMarks(batch);
            const failedBatchIds = new Set(batch.map((paper) => paper.id));

            setPaperStatuses((current) =>
              Object.fromEntries(
                Object.entries(current).map(([paperId, status]) => [
                  paperId,
                  failedBatchIds.has(paperId) ? { ...status, checkingMineru: false } : status,
                ]),
              ),
            );
            processedCount = start + batch.length;
          }

          // 批次间让出事件循环，避免大库状态检查挤占交互。
          if (start + MINERU_STATUS_BATCH_SIZE < uncheckedPapers.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        } finally {
          mineruDiscoveryInFlightRef.current = Math.max(0, mineruDiscoveryInFlightRef.current - 1);
          // 一轮发现结束后只通知一次；筛选联动刷新在下方单独去抖，避免每个批次都重查。
          if (discovered && mineruDiscoveryInFlightRef.current === 0) {
            setMineruDiscoveryVersion((value) => value + 1);
          }
        }
      }
    },
    [autoLoadSiblingJson, demoLibrary, libraryStorageDir, mineruCacheDir],
  );

  const resolveDemoPapers = useCallback(
    (nextCategoryId = selectedCategoryId) => {
      if (!demoLibrary) {
        return [];
      }

      return filterDemoPapers(demoLibrary, nextCategoryId, searchQuery)
        .filter((paper) => matchesDemoLibraryFilters(paper, filters, mineruPaperIds));
    },
    [demoLibrary, filters, mineruPaperIds, searchQuery, selectedCategoryId],
  );
  const resolveDemoPapersRef = useRef(resolveDemoPapers);
  resolveDemoPapersRef.current = resolveDemoPapers;

  /**
   * 查询只读取最新状态 ref，保持回调身份稳定：后台 MinerU 状态发现不会
   * 因为 `mineruPaperIds` 变化而反复触发全量重查。
   * source='status' 的刷新不推进查询代次，也不清空当前选择。
   */
  const refreshPapers = useCallback(
    async (
      nextCategoryId?: string | null,
      options: { source?: 'user' | 'status'; preserveSelection?: boolean } = {},
    ) => {
      const queryState = queryStateRef.current;
      const categoryId = nextCategoryId === undefined
        ? queryState.selectedCategoryId
        : nextCategoryId;
      if (demoLibrary) {
        const nextPapers = resolveDemoPapersRef.current(categoryId);

        setPapers(nextPapers);
        setPapersTotal(nextPapers.length);
        setSelectedPaperId((current) => resolveSelectedPaperId(current, nextPapers));
        return nextPapers;
      }

      const isUserQuery = options.source !== 'status';
      const generation = isUserQuery
        ? papersQueryGenerationRef.current + 1
        : papersQueryGenerationRef.current;
      if (isUserQuery) {
        papersQueryGenerationRef.current = generation;
      }
      setPapersRefreshing(true);
      refreshGateRef.current.begin();
      try {
        const result = await queryLibraryPapers({
          ...buildPaperQuery(
            queryState.filters,
            queryState.paperSort,
            categoryId,
            queryState.searchQuery,
            queryState.mineruPaperIds,
          ),
          limit: PAPER_PAGE_SIZE,
          offset: 0,
        });
        const nextPapers = result.papers;
        if (generation !== papersQueryGenerationRef.current) {
          return nextPapers;
        }

        setPapers(nextPapers);
        setPapersTotal(result.total);
        setRagStatusAvailable(result.ragStatusAvailable ?? null);
        setSelectedPaperId((current) => resolveRefreshedSelection(
          current,
          nextPapers,
          options.preserveSelection === true,
          resolveSelectedPaperId,
        ));
        void refreshMineruStatusesForPapers(nextPapers);
        return nextPapers;
      } finally {
        if (refreshGateRef.current.end()) setPapersRefreshing(false);
      }
    },
    [demoLibrary, refreshMineruStatusesForPapers],
  );

  useLibraryQueryRefresh({
    enabled: !demoMode,
    ready: !loading,
    ragStatusActive: filters.ragStatus !== 'all',
    refreshPapers,
    listCategories: listLibraryCategories,
    setCategories,
    handleReadingUpdated: (detail: LibraryReadingUpdatedEventDetail | null) => {
      const paperId = detail?.paperId;
      if (!paperId) return false;
      // 阅读状态筛选/最近阅读/按最近阅读排序依赖成员资格或顺序：仍走全量重查。
      if (filters.readStatus || filters.recentlyRead || paperSort.sortBy === 'lastReadAt') {
        return false;
      }

      const generation = papersQueryGenerationRef.current;
      void getLibraryPaperSummary(paperId).then((summary) => {
        if (!summary || generation !== papersQueryGenerationRef.current) return;
        setPapers((current) =>
          current.map((paper) => (paper.id === paperId ? mergePaperListSummary(paper, summary) : paper)),
        );
        if (allPapersSnapshotRef.current.length > 0) {
          allPapersSnapshotRef.current = allPapersSnapshotRef.current.map((paper) =>
            paper.id === paperId ? mergePaperListSummary(paper, summary) : paper,
          );
        }
      }).catch((error) => {
        console.error('Failed to refresh paper reading summary', error);
        if (generation === papersQueryGenerationRef.current) {
          void refreshPapers().catch(() => {});
        }
      });
      return true;
    },
  });

  // 滚动接近底部时按当前筛选追加下一页；按 id 去重防止翻页期间并发写入造成重复行。
  const loadMorePapers = useCallback(async () => {
    if (demoLibrary || papersLoadingMore) return;

    const generation = papersQueryGenerationRef.current;
    setPapersLoadingMore(true);
    try {
      const snapshot = papersRef.current;
      const result = await queryLibraryPapers({
        ...buildPaperQuery(filters, paperSort, selectedCategoryId, searchQuery, mineruPaperIds),
        limit: PAPER_PAGE_SIZE,
        offset: snapshot.length,
      });
      if (generation !== papersQueryGenerationRef.current) {
        return;
      }

      if (result.papers.length === 0) {
        setPapersTotal(result.total);
        setRagStatusAvailable(result.ragStatusAvailable ?? null);
        return;
      }

      setPapers((current) => {
        const seen = new Set(current.map((paper) => paper.id));
        return [...current, ...result.papers.filter((paper) => !seen.has(paper.id))];
      });
      setPapersTotal(result.total);
      setRagStatusAvailable(result.ragStatusAvailable ?? null);
      // 分页追加的文献同样需要 MinerU 状态；checkedMineruPaperIdsRef 保证不重复检查。
      void refreshMineruStatusesForPapers(result.papers);
    } finally {
      setPapersLoadingMore(false);
    }
  }, [
    demoLibrary,
    paperSort.sortBy,
    paperSort.sortDirection,
    papersLoadingMore,
    filters, mineruPaperIds,
    refreshMineruStatusesForPapers,
    searchQuery,
    selectedCategoryId,
  ]);

  const refreshAll = useCallback(async () => {
    if (demoLibrary) {
      const nextPapers = resolveDemoPapers();

      setSettings(demoLibrary.settings);
      setCategories(demoLibrary.categories);
      setPapers(nextPapers);
      setPapersTotal(nextPapers.length);
      setSelectedPaperId((current) => resolveSelectedPaperId(current, nextPapers));
      setStatusMessage(demoLibrary.statusMessage);
      return;
    }

    const [nextCategories, visiblePapers, allPapers] = await Promise.all([
      listLibraryCategories(),
      refreshPapers(),
      fetchAllLibraryPapers(),
    ]);

    allPapersSnapshotRef.current = allPapers;
    setCategories(nextCategories);

    // 解析状态可见项优先：当前列表页排在前面先检查，其余条目后台分批补齐。
    const visiblePaperIds = new Set(visiblePapers.map((paper) => paper.id));
    const prioritizedPapers = [
      ...visiblePapers,
      ...allPapers.filter((paper) => !visiblePaperIds.has(paper.id)),
    ];
    void refreshMineruStatusesForPapers(prioritizedPapers);
  }, [demoLibrary, refreshMineruStatusesForPapers, refreshPapers, resolveDemoPapers]);

  // MCP/外部进程写入文库：重新加载列表、分类与整个快照；
  // 详情表单在数据变化时自行保留未保存编辑并显示“外部更新”提示。
  useEffect(() => {
    const handleExternalWrite = () => {
      if (demoMode) return;
      void refreshAll().catch((error) => console.error('Failed to refresh library after external write', error));
    };
    window.addEventListener(EXTERNAL_LIBRARY_WRITE_EVENT, handleExternalWrite);
    return () => window.removeEventListener(EXTERNAL_LIBRARY_WRITE_EVENT, handleExternalWrite);
  }, [demoMode, refreshAll]);

  useEffect(() => {
    try {
      localStorage.setItem(PAPER_SORT_STORAGE_KEY, JSON.stringify(paperSort));
    } catch {
    }
  }, [paperSort]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError('');

      try {
        if (demoLibrary) {
          const allCategory = demoLibrary.categories.find((category) => category.systemKey === 'all');
          const currentCategoryId = selectedCategoryIdRef.current;
          const nextSelectedCategoryId =
            currentCategoryId &&
            demoLibrary.categories.some((category) => category.id === currentCategoryId)
              ? currentCategoryId
              : allCategory?.id ?? demoLibrary.categories[0]?.id ?? null;
          const nextPapers = filterDemoPapers(demoLibrary, nextSelectedCategoryId, searchQuery);

          if (cancelled) {
            return;
          }

          setSettings(demoLibrary.settings);
          setCategories(demoLibrary.categories);
          setSelectedCategoryId(nextSelectedCategoryId);
          setPapers(nextPapers);
          setSelectedPaperId(nextPapers[0]?.id ?? null);
          setStatusMessage(demoLibrary.statusMessage);
          return;
        }

        const queryState = queryStateRef.current;
        // 首屏只拉第一页：library_init 不再携带整库快照。
        const { snapshot, categoryId: initialCategoryId, page: initialPage } = await loadLibraryFirstScreen({
          initialize: initializeLiteratureLibrary,
          query: queryLibraryPapers,
          buildRequest: (categoryId) => buildPaperQuery(
            queryState.filters,
            queryState.paperSort,
            categoryId,
            queryState.searchQuery,
            queryState.mineruPaperIds,
          ),
          pageSize: PAPER_PAGE_SIZE,
        });

        if (cancelled) {
          return;
        }

        // 初始化已完成第一页查询；记录这次查询真正使用的条件（分类是
        // loadLibraryFirstScreen 解析出的 initialCategoryId，不是挂载时的 null）。
        // loading=false 后的防抖查询只有条件一致时才跳过。
        skipNextDebouncedQueryRef.current = {
          kind: 'first-screen',
          conditionKey: paperQueryConditionsKey(
            queryState.filters,
            queryState.paperSort,
            queryState.searchQuery,
            initialCategoryId,
          ),
        };
        setSettings(snapshot.settings);
        setCategories(snapshot.categories);
        setSelectedCategoryId(initialCategoryId);
        setPapers(initialPage.papers);
        setPapersTotal(initialPage.total);
        setRagStatusAvailable(initialPage.ragStatusAvailable ?? null);
        setSelectedPaperId(resolveSelectedPaperId(null, initialPage.papers));
        setStatusMessage(l('文献库已就绪', 'Library is ready'));
        allPapersSnapshotRef.current = [];

        if (queryState.filters.mineruParsed) {
          // 只有该筛选需要全库解析状态；延迟到首屏第一页之后按需补齐，
          // 常规首屏不承担全库水合。
          void fetchAllLibraryPapers().then((allPapers) => {
            if (cancelled) return;
            allPapersSnapshotRef.current = allPapers;
            void refreshMineruStatusesForPapers(
              allPapers,
              () => cancelled,
              snapshot.settings.storageDir ?? '',
            );
          }).catch((error) => {
            console.error('Failed to load papers for the MinerU filter', error);
          });
        }
      } catch (nextError) {
        if (!cancelled) {
          const message =
            nextError instanceof Error
              ? nextError.message
              : l('初始化文献库失败', 'Failed to initialize the library');
          setError(message);
          setStatusMessage(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [demoLibrary]);

  useEffect(() => {
    const handleNativeSummaryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<NativeSummaryUpdatedEventDetail>).detail;

      if (!detail?.paperId) {
        return;
      }

      setPapers((current) =>
        current.map((paper) =>
          paper.id === detail.paperId ? { ...paper, aiSummary: detail.aiSummary } : paper,
        ),
      );
      setPaperStatuses((current) =>
        applyPaperSummaryStatusUpdate(current, detail.paperId, detail.aiSummary),
      );
    };

    const handleNativeMineruStatusUpdated = (event: Event) => {
      const detail = (event as CustomEvent<NativeMineruStatusUpdatedEventDetail>).detail;

      if (!detail?.paperId) {
        return;
      }

      checkedMineruPaperIdsRef.current.add(detail.paperId);
      setPaperStatuses((current) =>
        applyPaperMineruStatusUpdate(current, detail.paperId, detail.mineruParsed),
      );
    };

    const handleNativePaperUpdated = (event: Event) => {
      const detail = (event as CustomEvent<NativePaperUpdatedEventDetail>).detail;

      if (!detail?.paper?.id) {
        return;
      }

      setPapers((current) =>
        current.some((paper) => paper.id === detail.paper.id)
          ? current.map((paper) => (paper.id === detail.paper.id ? detail.paper : paper))
          : current,
      );
    };

    window.addEventListener('paperquay:native-summary-updated', handleNativeSummaryUpdated);
    window.addEventListener('paperquay:native-mineru-status-updated', handleNativeMineruStatusUpdated);
    window.addEventListener(NATIVE_PAPER_UPDATED_EVENT, handleNativePaperUpdated);

    return () => {
      window.removeEventListener('paperquay:native-summary-updated', handleNativeSummaryUpdated);
      window.removeEventListener('paperquay:native-mineru-status-updated', handleNativeMineruStatusUpdated);
      window.removeEventListener(NATIVE_PAPER_UPDATED_EVENT, handleNativePaperUpdated);
    };
  }, []);

  useEffect(() => {
    if (demoLibrary) {
      setPaperStatuses(
        demoLibrary.paperStatuses ??
          buildInitialPaperStatuses(demoLibrary.papers),
      );
      return undefined;
    }

    if (loading) {
      return undefined;
    }

    if (mineruStatusConfigKeyRef.current !== mineruStatusConfigKey) {
      mineruStatusConfigKeyRef.current = mineruStatusConfigKey;
      checkedMineruPaperIdsRef.current = new Set();
    }

    let cancelled = false;

    // 复用 init/refreshAll 已拉取的全量文献快照；首屏没有全量快照时，
    // 先检查当前已加载页，其余条目在后续刷新/筛选时补齐。
    void refreshMineruStatusesForPapers(
      allPapersSnapshotRef.current.length > 0 ? allPapersSnapshotRef.current : papersRef.current,
      () => cancelled,
    );

    return () => {
      cancelled = true;
    };
  }, [
    demoLibrary,
    loading,
    mineruStatusConfigKey,
    refreshMineruStatusesForPapers,
  ]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (skipNextDebouncedQueryRef.current) {
      const skip = skipNextDebouncedQueryRef.current;
      skipNextDebouncedQueryRef.current = null;
      if (shouldSkipDebouncedQuery({ skip, currentKey: queryConditionsKey })) {
        return;
      }
      // 首屏条件已变化：继续走下面的防抖查询，以用户的新条件覆盖首屏结果。
    }

    const timer = window.setTimeout(() => {
      void refreshPapers().catch((nextError) => {
        const message =
          nextError instanceof Error ? nextError.message : l('搜索文献失败', 'Failed to search papers');
        setError(message);
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [loading, l, queryConditionsKey, refreshPapers]);

  // MinerU「已解析」筛选的用户条件（是否勾选）由上面的防抖查询处理；
  // 后台状态发现完成后只补一次尾部查询，避免每一批 stat 都重置结果集
  // 或清空当前选择。未开启该筛选时，状态发现只合并 paperStatuses。
  useEffect(() => {
    if (loading) {
      return;
    }

    if (!filters.mineruParsed) {
      mineruDiscoveryHandledVersionRef.current = mineruDiscoveryVersion;
      return;
    }

    if (!shouldRefreshForMineruDiscovery({
      loading,
      mineruParsed: filters.mineruParsed,
      discoveryVersion: mineruDiscoveryVersion,
      handledVersion: mineruDiscoveryHandledVersionRef.current,
    })) {
      return;
    }

    mineruDiscoveryHandledVersionRef.current = mineruDiscoveryVersion;
    void refreshPapers(undefined, { source: 'status', preserveSelection: true }).catch((nextError) => {
      const message =
        nextError instanceof Error ? nextError.message : l('刷新文献状态失败', 'Failed to refresh paper status');
      setError(message);
    });
  }, [filters.mineruParsed, loading, l, mineruDiscoveryVersion, refreshPapers]);

  /**
   * 分类查询已经直接发出：登记本次查询的条件键，供随后的防抖 effect 在条件一致时跳过。
   * 分类点击与分类动作（创建/删除/拖放分配）都在 setSelectedCategoryId + refreshPapers
   * 之前调用；条件键随后变化（筛选/搜索/排序）时 skip 会被丢弃并正常重查。
   */
  const markCategoryQueryHandled = useCallback((categoryId: string | null) => {
    const queryState = queryStateRef.current;
    skipNextDebouncedQueryRef.current = {
      kind: 'conditions',
      conditionKey: paperQueryConditionsKey(
        queryState.filters,
        queryState.paperSort,
        queryState.searchQuery,
        categoryId,
      ),
    };
  }, []);

  const handleSelectCategory = (categoryId: string) => {
    // 点击当前已选分类时状态与查询条件都未变化：不写 skip、不改 error、不发请求。
    // 同步 ref 保证同一事件循环内的重复调用（双击）也立即返回。
    if (selectedCategoryIdRef.current === categoryId) {
      return;
    }
    selectedCategoryIdRef.current = categoryId;
    // 分类点击已经直接查询；只跳过与本次查询条件完全一致的随后防抖查询。
    markCategoryQueryHandled(categoryId);
    setSelectedCategoryId(categoryId);
    setError('');
    void refreshPapers(categoryId).catch((nextError) => {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('读取分类文献失败', 'Failed to load category papers');
      setError(message);
      setStatusMessage(message);
    });
  };

  const reloadAfterPaperUpdate = async (updatedPaper: LiteraturePaper) => {
    const generation = papersQueryGenerationRef.current + 1;
    papersQueryGenerationRef.current = generation;
    const [nextCategories, queryResult] = await Promise.all([
      listLibraryCategories(),
      queryLibraryPapers({
        ...buildPaperQuery(filters, paperSort, selectedCategoryId, searchQuery, mineruPaperIds),
        limit: PAPER_PAGE_SIZE,
        offset: 0,
      }),
    ]);

    if (generation !== papersQueryGenerationRef.current) {
      return;
    }

    const nextPapers = queryResult.papers;
    setCategories(nextCategories);
    setPapers(nextPapers);
    setPapersTotal(queryResult.total);
    setSelectedPaperId(
      nextPapers.some((paper) => paper.id === updatedPaper.id)
        ? updatedPaper.id
        : nextPapers[0]?.id ?? null,
    );
  };

  return {
    demoMode,
    settings,
    setSettings,
    categories,
    setCategories,
    papers,
    setPapers,
    papersRef,
    papersTotal,
    setPapersTotal,
    ragStatusAvailable,
    papersLoadingMore,
    papersRefreshing,
    paperStatuses,
    setPaperStatuses,
    loading,
    statusMessage,
    setStatusMessage,
    error,
    setError,
    searchQuery,
    setSearchQuery,
    selectedCategoryId,
    setSelectedCategoryId,
    selectedPaperId,
    setSelectedPaperId,
    selectedCategory,
    selectedPaper,
    flatCategories,
    libraryStorageDir,
    paperSort,
    setPaperSort,
    filters,
    setFilters,
    libraryTags,
    mineruIdKey,
    mineruPaperIds,
    allPapersSnapshotRef,
    papersQueryGenerationRef,
    refreshPapers,
    refreshAll,
    loadMorePapers,
    refreshMineruStatusesForPapers,
    resolveDemoPapers,
    markCategoryQueryHandled,
    handleSelectCategory,
    reloadAfterPaperUpdate,
    showDemoLockedMessage,
  };
}
