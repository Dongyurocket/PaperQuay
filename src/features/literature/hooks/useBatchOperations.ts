import {
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  batchDeleteLibraryPapers,
  batchUpdateLibraryPapers,
  deleteLibraryPaper,
  listLibraryCategories,
  reorderLibraryPapers,
  setLibraryRagMembership,
  updateTranslatedPdfLanguages,
} from '../../../services/library';
import type {
  LiteratureCategory,
  LiteraturePaper,
  TranslatedPdfLanguageChange,
} from '../../../types/library';
import { ATTACHMENT_KIND_TRANSLATED_PDF } from '../../../utils/libraryPaper';
import type { LiteraturePaperRagStatus } from '../components/LiteraturePaperList';
import type { RagBatchMode, RagBatchSelection } from '../../../services/ragIndexStatus';
import type { TranslatedPdfLanguageBatchEntry } from '../components/TranslatedPdfLanguageBatchDialog';
import { reorderPaperList } from '../literatureLibraryUtils';
import { emitNativePaperUpdated } from '../libraryEvents';
import type { PaperSelection } from '../paperSelection';
import type { LibraryCatalog } from './useLibraryCatalog';

type LocaleText = (zh: string, en: string) => string;

export type LibraryConfirmDialogState =
  | { kind: 'delete-category'; category: LiteratureCategory }
  | { kind: 'delete-paper'; paper: LiteraturePaper; deleteFiles: boolean }
  | { kind: 'delete-papers'; paperIds: string[]; deleteFiles: boolean }
  | { kind: 'exclude-rag-paper'; paper: LiteraturePaper }
  | { kind: 'exclude-rag-papers'; paperIds: string[]; indexedCount: number }
  | {
    kind: 'batch-rag-index';
    paperIds: string[];
    mode: RagBatchMode;
    selection: RagBatchSelection;
  }
  | { kind: 'remove-translated-pdf'; paper: LiteraturePaper; attachmentId: string; fileName: string };

interface TranslatedPdfLanguageBatchState {
  entries: TranslatedPdfLanguageBatchEntry[];
  skippedCount: number;
}

export interface BatchOperationsOptions {
  catalog: LibraryCatalog;
  demoMode: boolean;
  l: LocaleText;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setBatchWorking: Dispatch<SetStateAction<boolean>>;
  setDialogBusy: Dispatch<SetStateAction<boolean>>;
  setPaperSaving: Dispatch<SetStateAction<boolean>>;
  setConfirmDialog: Dispatch<SetStateAction<LibraryConfirmDialogState | null>>;
  setPaperContextMenu: (value: null) => void;
  paperSelectionRef: MutableRefObject<PaperSelection>;
  resolveSelectedPapers: (ids: string[]) => Promise<LiteraturePaper[]>;
  clearMultiSelection: () => void;
  ragBadgeByDocumentKey?: Record<string, LiteraturePaperRagStatus>;
}

export interface BatchOperationsState {
  translatedPdfLanguageBatch: TranslatedPdfLanguageBatchState | null;
  setTranslatedPdfLanguageBatch: Dispatch<SetStateAction<TranslatedPdfLanguageBatchState | null>>;
  applyRagMembership: (paperIds: string[], enabled: boolean) => Promise<void>;
  handleBatchIncludeRag: () => void;
  handleBatchExcludeRag: () => void;
  handleBatchSetFavorite: (favorite: boolean) => Promise<void>;
  handleBatchMoveToCategory: (categoryId: string) => Promise<void>;
  handleBatchDeletePapers: () => void;
  deletePapersAfterConfirm: (paperIds: string[], deleteFiles: boolean) => Promise<void>;
  handleDeletePaper: (paper: LiteraturePaper) => void;
  deletePaperAfterConfirm: (paper: LiteraturePaper, deleteFiles: boolean) => Promise<void>;
  handlePaperReorder: (
    draggedPaperId: string,
    targetPaperId: string,
    placement: 'before' | 'after',
  ) => Promise<void>;
  handleBeginBatchTranslatedPdfLanguage: () => Promise<void>;
  handleSaveBatchTranslatedPdfLanguage: (changes: TranslatedPdfLanguageChange[]) => Promise<void>;
}

/** 批量操作：加入/移出知识库、批量删除/收藏/移动分类、手动排序与批量译版语言。 */
export function useBatchOperations({
  catalog,
  demoMode,
  l,
  setStatusMessage,
  setError,
  setBatchWorking,
  setDialogBusy,
  setPaperSaving,
  setConfirmDialog,
  setPaperContextMenu,
  paperSelectionRef,
  resolveSelectedPapers,
  clearMultiSelection,
  ragBadgeByDocumentKey,
}: BatchOperationsOptions): BatchOperationsState {
  const {
    selectedCategory,
    flatCategories,
    setCategories,
    papers,
    setPapers,
    paperSort,
    refreshAll,
    refreshPapers,
    reloadAfterPaperUpdate,
    showDemoLockedMessage,
  } = catalog;
  const [translatedPdfLanguageBatch, setTranslatedPdfLanguageBatch] =
    useState<TranslatedPdfLanguageBatchState | null>(null);

  const applyRagMembership = async (paperIds: string[], enabled: boolean) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (paperIds.length === 0) return;

    setBatchWorking(true);
    setDialogBusy(true);
    setError('');

    try {
      const result = await setLibraryRagMembership(paperIds, enabled);
      await refreshAll();
      const failedCount = result.failures.length;
      const successCount = result.papers.length;
      setStatusMessage(
        failedCount > 0
          ? enabled
            ? l(
              `已加入 ${successCount} 篇，${failedCount} 篇失败。`,
              `Included ${successCount} papers; ${failedCount} failed.`,
            )
            : l(
              `已移出 ${successCount} 篇，${failedCount} 篇失败。`,
              `Excluded ${successCount} papers; ${failedCount} failed.`,
            )
          : enabled
            ? l(
              `已加入 ${successCount} 篇。未自动建立索引。`,
              `Included ${successCount} papers. Indexes were not rebuilt.`,
            )
            : l(
              `已移出 ${successCount} 篇。`,
              `Excluded ${successCount} papers.`,
            ),
      );
      setConfirmDialog(null);
      setPaperContextMenu(null);
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : enabled
          ? l('加入本地知识库失败', 'Failed to include papers in the local knowledge base')
          : l('移出本地知识库失败', 'Failed to exclude papers from the local knowledge base');
      setError(message);
      setStatusMessage(message);
    } finally {
      setBatchWorking(false);
      setDialogBusy(false);
    }
  };

  const handleBatchIncludeRag = () => {
    void applyRagMembership(paperSelectionRef.current.ids, true);
  };

  const handleBatchExcludeRag = () => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    const paperIds = paperSelectionRef.current.ids;
    if (paperIds.length === 0) return;

    const indexedCount = paperIds.filter((id) => {
      const status = ragBadgeByDocumentKey?.[id];
      return status === 'ready' || status === 'pending' || status === 'failed';
    }).length;
    setConfirmDialog({ kind: 'exclude-rag-papers', paperIds, indexedCount });
  };

  const handleBatchSetFavorite = async (favorite: boolean) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    const paperIds = paperSelectionRef.current.ids;
    if (paperIds.length === 0) {
      return;
    }

    setBatchWorking(true);
    setError('');

    try {
      // 单事务批量写入，不再逐篇 IPC。
      await batchUpdateLibraryPapers({ paperIds, isFavorite: favorite });
      await refreshAll();
      setStatusMessage(
        favorite
          ? l(`已收藏 ${paperIds.length} 篇文献。`, `Favorited ${paperIds.length} papers.`)
          : l(`已取消收藏 ${paperIds.length} 篇文献。`, `Unfavorited ${paperIds.length} papers.`),
      );
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : l('批量更新收藏状态失败', 'Failed to update favorite status');
      setError(message);
      setStatusMessage(message);
    } finally {
      setBatchWorking(false);
    }
  };

  const handleBatchMoveToCategory = async (categoryId: string) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    const targetCategory = flatCategories.find((category) => category.id === categoryId);

    const paperIds = paperSelectionRef.current.ids;
    if (!targetCategory || targetCategory.isSystem || paperIds.length === 0) {
      return;
    }

    setBatchWorking(true);
    setError('');

    try {
      // 单事务把目标分类加到全部选中文献。
      await batchUpdateLibraryPapers({ paperIds, addCategoryId: categoryId });
      const nextCategories = await listLibraryCategories();
      setCategories(nextCategories);
      await refreshAll();
      setStatusMessage(
        l(
          `已移动 ${paperIds.length} 篇文献到「${targetCategory.name}」。`,
          `Moved ${paperIds.length} papers to "${targetCategory.name}".`,
        ),
      );
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : l('批量移动文献失败', 'Failed to move papers');
      setError(message);
      setStatusMessage(message);
    } finally {
      setBatchWorking(false);
    }
  };

  const handleBatchDeletePapers = () => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    const paperIds = paperSelectionRef.current.ids;
    if (paperIds.length === 0) {
      return;
    }

    setConfirmDialog({
      kind: 'delete-papers',
      paperIds,
      deleteFiles: selectedCategory?.systemKey === 'all',
    });
  };

  const deletePapersAfterConfirm = async (paperIds: string[], deleteFiles: boolean) => {
    setBatchWorking(true);
    setDialogBusy(true);
    setError('');

    try {
      // 文件清理 + 单事务删除由主进程一次完成。
      const result = await batchDeleteLibraryPapers({ paperIds, deleteFiles });
      await refreshAll();
      clearMultiSelection();
      const indexFailures = result.ragFailures.length;
      setStatusMessage(
        indexFailures > 0
          ? l(
            `已删除 ${result.deleted} 篇文献，${indexFailures} 篇的 RAG 索引清理失败，可在设置中重建。`,
            `Deleted ${result.deleted} papers; RAG index cleanup failed for ${indexFailures}. Rebuild indexes in settings.`,
          )
          : l(
            `已删除 ${result.deleted} 篇文献${deleteFiles ? '及其 PDF 文件' : '记录'}。`,
            `Deleted ${result.deleted} paper${result.deleted > 1 ? 's' : ''}${deleteFiles ? ' and their PDF files' : ' records'}.`,
          ),
      );
      setConfirmDialog(null);
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : l('批量删除文献失败', 'Failed to delete papers');
      setError(message);
      setStatusMessage(message);
    } finally {
      setBatchWorking(false);
      setDialogBusy(false);
    }
  };

  const handleDeletePaper = (paper: LiteraturePaper) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setConfirmDialog({
      kind: 'delete-paper',
      paper,
      deleteFiles: selectedCategory?.systemKey === 'all',
    });
  };

  const deletePaperAfterConfirm = async (paper: LiteraturePaper, deleteFiles: boolean) => {
    setPaperSaving(true);
    setDialogBusy(true);
    setError('');

    try {
      await deleteLibraryPaper({ paperId: paper.id, deleteFiles });
      await refreshAll();
      setStatusMessage(
        deleteFiles
          ? l('文献记录和 PDF 文件已删除。', 'Paper record and PDF files deleted.')
          : l('文献记录已删除，PDF 文件未删除。', 'Paper record deleted. PDF files were not deleted.'),
      );
      setConfirmDialog(null);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('删除文献记录失败', 'Failed to delete paper record');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperSaving(false);
      setDialogBusy(false);
    }
  };

  const handlePaperReorder = async (
    draggedPaperId: string,
    targetPaperId: string,
    placement: 'before' | 'after',
  ) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (paperSort.sortBy !== 'manual') {
      setStatusMessage(l('请切换到手动排序后再拖拽调整顺序', 'Switch to manual order before drag-sorting papers'));
      return;
    }

    const nextPapers = reorderPaperList(papers, draggedPaperId, targetPaperId, placement);

    if (nextPapers === papers) {
      return;
    }

    setPapers(nextPapers);
    setError('');

    try {
      await reorderLibraryPapers({
        paperIds: nextPapers.map((paper) => paper.id),
      });
      setStatusMessage(l('文献排序已保存', 'Paper order saved'));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('保存文献排序失败', 'Failed to save paper order');
      setError(message);
      setStatusMessage(message);
      await refreshPapers();
    }
  };

  const handleBeginBatchTranslatedPdfLanguage = async () => {
    if (demoMode) { showDemoLockedMessage(); return; }
    setBatchWorking(true);
    try {
      const selectedPapers = await resolveSelectedPapers(paperSelectionRef.current.ids);
      const entries = selectedPapers.flatMap((paper) => paper.attachments
        .filter((attachment) => attachment.kind === ATTACHMENT_KIND_TRANSLATED_PDF)
        .map((attachment) => ({ paper, attachmentId: attachment.id, fileName: attachment.fileName, language: attachment.language ?? null })));
      setTranslatedPdfLanguageBatch({
        entries,
        skippedCount: selectedPapers.filter((paper) => !paper.attachments.some((attachment) => attachment.kind === ATTACHMENT_KIND_TRANSLATED_PDF)).length,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : l('读取选中文献失败', 'Failed to load selected papers'));
    } finally { setBatchWorking(false); }
  };

  const handleSaveBatchTranslatedPdfLanguage = async (changes: TranslatedPdfLanguageChange[]) => {
    setBatchWorking(true);
    try {
      const result = await updateTranslatedPdfLanguages({ changes });
      for (const paper of result.papers) {
        await reloadAfterPaperUpdate(paper);
        emitNativePaperUpdated(paper);
      }
      setTranslatedPdfLanguageBatch(null);
      setStatusMessage(l(`已更新 ${result.changedCount} 个译版语言`, `Updated ${result.changedCount} translated PDF languages`));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : l('批量更新失败，请刷新预览后重试', 'Batch update failed; refresh the preview and retry'));
    } finally { setBatchWorking(false); }
  };

  return {
    translatedPdfLanguageBatch,
    setTranslatedPdfLanguageBatch,
    applyRagMembership,
    handleBatchIncludeRag,
    handleBatchExcludeRag,
    handleBatchSetFavorite,
    handleBatchMoveToCategory,
    handleBatchDeletePapers,
    deletePapersAfterConfirm,
    handleDeletePaper,
    deletePaperAfterConfirm,
    handlePaperReorder,
    handleBeginBatchTranslatedPdfLanguage,
    handleSaveBatchTranslatedPdfLanguage,
  };
}
