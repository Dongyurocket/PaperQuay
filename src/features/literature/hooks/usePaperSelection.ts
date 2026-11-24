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
import { listAllLibraryPaperIds, queryLibraryPapers } from '../../../services/library';
import type { LiteraturePaper } from '../../../types/library';
import { buildPaperQuery, type LibraryFilterState } from '../libraryFilters';
import {
  capturePaperSelection,
  EMPTY_PAPER_SELECTION,
  replacePaperSelection,
  selectionCheckState,
  togglePaperSelection,
  type PaperSelection,
  type SelectionCheckState,
} from '../paperSelection';
import { useSelectionFilterGuard } from '../useSelectionFilterGuard';
import type { LiteratureLibraryDemoState } from '../literatureLibraryUtils';
import type { PaperSortState } from './useLibraryCatalog';

type LocaleText = (zh: string, en: string) => string;

export interface PaperSelectionOptions {
  demoLibrary: LiteratureLibraryDemoState | null;
  papers: LiteraturePaper[];
  papersRef: MutableRefObject<LiteraturePaper[]>;
  papersTotal: number;
  selectedPaperId: string | null;
  setSelectedPaperId: Dispatch<SetStateAction<string | null>>;
  selectedCategoryId: string | null;
  searchQuery: string;
  filters: LibraryFilterState;
  mineruPaperIds: string[];
  paperSort: PaperSortState;
  resolveDemoPapers: (nextCategoryId?: string | null) => LiteraturePaper[];
  l: LocaleText;
  setBatchWorking: Dispatch<SetStateAction<boolean>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
}

export interface PaperSelectionState {
  paperSelection: PaperSelection;
  paperSelectionRef: MutableRefObject<PaperSelection>;
  multiSelectedPaperIds: string[];
  selectedCount: number;
  selectAllState: SelectionCheckState;
  multiSelectedPaperIdSet: Set<string>;
  multiSelectedPapers: LiteraturePaper[];
  clearMultiSelection: () => void;
  handleSelectPaperWithModifiers: (
    paperId: string,
    modifiers?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ) => void;
  resolveSelectedPapers: (ids: string[]) => Promise<LiteraturePaper[]>;
  handleToggleSelectAll: () => Promise<void>;
}

/** 文献列表多选：Ctrl/Shift 选择、全选快照、筛选变化清空与选择守卫。 */
export function usePaperSelection({
  demoLibrary,
  papers,
  papersRef,
  papersTotal,
  selectedPaperId,
  setSelectedPaperId,
  selectedCategoryId,
  searchQuery,
  filters,
  mineruPaperIds,
  paperSort,
  resolveDemoPapers,
  l,
  setBatchWorking,
  setStatusMessage,
  setError,
}: PaperSelectionOptions): PaperSelectionState {
  const [paperSelection, setPaperSelection] = useState<PaperSelection>(EMPTY_PAPER_SELECTION);
  const paperSelectionRef = useRef(paperSelection);
  const selectionFilterRef = useRef<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const selectionQueryGuard = useSelectionFilterGuard({
    categoryId: selectedCategoryId, search: searchQuery, filters,
  });

  // 多选与详情面板的 selectedPaperId 分开。全选保存 id 快照，已加载行只是其中可见的一部分。
  paperSelectionRef.current = paperSelection;
  const multiSelectedPaperIds = paperSelection.ids;
  const selectedCount = multiSelectedPaperIds.length;
  const selectAllState = selectionCheckState(paperSelection, papersTotal);
  const multiSelectedPaperIdSet = useMemo(() => new Set(multiSelectedPaperIds), [multiSelectedPaperIds]);
  const multiSelectedPapers = useMemo(
    () => papers.filter((paper) => multiSelectedPaperIdSet.has(paper.id)),
    [papers, multiSelectedPaperIdSet],
  );

  useEffect(() => {
    const nextFilter = JSON.stringify({ categoryId: selectedCategoryId, search: searchQuery, filters });
    const previousFilter = selectionFilterRef.current;
    selectionFilterRef.current = nextFilter;
    if (
      !previousFilter
      || previousFilter === nextFilter
      || paperSelectionRef.current.ids.length === 0
    ) {
      return;
    }

    setPaperSelection(EMPTY_PAPER_SELECTION);
    setStatusMessage(
      l('筛选条件已变化，选择已清空。', 'The filter changed, so the selection was cleared.'),
    );
  }, [filters, l, searchQuery, selectedCategoryId]);

  const clearMultiSelection = useCallback(() => {
    setPaperSelection(EMPTY_PAPER_SELECTION);
  }, []);

  const handleSelectPaperWithModifiers = useCallback(
    (paperId: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) => {
      const orderedIds = papers.map((paper) => paper.id);

      if (modifiers.shiftKey) {
        const anchorId = selectionAnchorId ?? selectedPaperId;
        const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1;
        const targetIndex = orderedIds.indexOf(paperId);

        if (anchorIndex >= 0 && targetIndex >= 0) {
          const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
          const rangeIds = orderedIds.slice(start, end + 1);
          const currentIds = paperSelectionRef.current.ids;

          setPaperSelection(replacePaperSelection(
            modifiers.ctrlKey || modifiers.metaKey
              ? [...currentIds, ...rangeIds]
              : rangeIds,
          ));
          setSelectedPaperId(paperId);
          return;
        }
      }

      if (modifiers.ctrlKey || modifiers.metaKey) {
        setPaperSelection((current) => togglePaperSelection(current, paperId));
        setSelectionAnchorId(paperId);
        setSelectedPaperId(paperId);
        return;
      }

      // 普通点击：单选并退出多选。
      setPaperSelection(EMPTY_PAPER_SELECTION);
      setSelectionAnchorId(paperId);
      setSelectedPaperId(paperId);
    },
    [papers, selectedPaperId, selectionAnchorId],
  );

  const resolveSelectedPapers = useCallback(async (ids: string[]) => {
    const wanted = new Set(ids);
    const found = new Map<string, LiteraturePaper>();

    for (const paper of papersRef.current) {
      if (wanted.has(paper.id)) {
        found.set(paper.id, paper);
      }
    }

    if (!demoLibrary && found.size < wanted.size) {
      let offset = 0;
      const pageSize = 500;

      while (found.size < wanted.size) {
        const result = await queryLibraryPapers({
          ...buildPaperQuery(filters, paperSort, selectedCategoryId, searchQuery, mineruPaperIds),
          limit: pageSize,
          offset,
        });

        for (const paper of result.papers) {
          if (wanted.has(paper.id)) {
            found.set(paper.id, paper);
          }
        }

        offset += result.papers.length;
        if (result.papers.length === 0 || offset >= result.total) {
          break;
        }
      }
    }

    return ids.flatMap((id) => {
      const paper = found.get(id);
      return paper ? [paper] : [];
    });
  }, [demoLibrary, paperSort.sortBy, paperSort.sortDirection, filters, mineruPaperIds, searchQuery, selectedCategoryId]);

  const handleToggleSelectAll = useCallback(async () => {
    if (selectionCheckState(paperSelectionRef.current, papersTotal) === 'all') {
      setPaperSelection(EMPTY_PAPER_SELECTION);
      return;
    }

    const selectionRequest = selectionQueryGuard.capture();
    setBatchWorking(true);
    setError('');

    try {
      const ids = demoLibrary
        ? resolveDemoPapers().map((paper) => paper.id)
        : await listAllLibraryPaperIds({
          ...buildPaperQuery(filters, paperSort, selectedCategoryId, searchQuery, mineruPaperIds),
        });

      if (!selectionQueryGuard.isCurrent(selectionRequest)) return;
      setPaperSelection(capturePaperSelection(ids));
      setStatusMessage(
        ids.length === 0
          ? l('当前筛选没有文献。', 'No papers match the current filter.')
          : l(
            `已全选当前筛选的 ${ids.length} 篇。之后导入的文献不会自动加入。`,
            `Selected all ${ids.length} papers in the current filter. Papers imported later are not added.`,
          ),
      );
    } catch (nextError) {
      if (!selectionQueryGuard.isCurrent(selectionRequest)) return;
      const message = nextError instanceof Error
        ? nextError.message
        : l('全选当前筛选失败', 'Failed to select the current filter');
      setError(message);
      setStatusMessage(message);
    } finally {
      if (selectionQueryGuard.isLatest(selectionRequest)) setBatchWorking(false);
    }
  }, [demoLibrary, l, papersTotal, filters, mineruPaperIds, paperSort, resolveDemoPapers, searchQuery, selectedCategoryId, selectionQueryGuard]);

  return {
    paperSelection,
    paperSelectionRef,
    multiSelectedPaperIds,
    selectedCount,
    selectAllState,
    multiSelectedPaperIdSet,
    multiSelectedPapers,
    clearMultiSelection,
    handleSelectPaperWithModifiers,
    resolveSelectedPapers,
    handleToggleSelectAll,
  };
}
