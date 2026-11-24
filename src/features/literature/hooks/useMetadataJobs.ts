import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  addLibraryAttachment,
  listLibraryCategories,
  queryLibraryPapers,
  removeLibraryAttachment,
  selectLibraryPdfFiles,
  setLibraryPaperCategories,
  updateLibraryPaper,
  updateTranslatedPdfLanguages,
} from '../../../services/library';
import {
  extractLiteratureMetadataWithLlm,
  lookupLiteratureMetadata,
} from '../../../services/metadata';
import { extractLocalPdfMetadataPreview } from '../../../services/pdfMetadata';
import { startRetainPdfTranslationOnce } from '../../../services/retainPdf';
import { isChineseDominant, isChineseText } from '../../../utils/languageDetect';
import { ATTACHMENT_KIND_TRANSLATED_PDF } from '../../../utils/libraryPaper';
import type { LiteraturePaper, UpdatePaperRequest } from '../../../types/library';
import type { MetadataLookupResult } from '../../../types/metadata';
import type { QaModelPreset } from '../../../types/reader';
import { buildPaperQuery } from '../libraryFilters';
import { paperPdfPath, paperTranslatedPdfAttachment } from '../literatureUi';
import { metadataUpdateForPaper } from '../literatureLibraryUtils';
import { emitNativePaperUpdated, LIBRARY_METADATA_ENRICH_REQUEST_EVENT } from '../libraryEvents';
import { readPdfPageCount } from '../pdfPageCount';
import { confirmAction } from '../../../ui/confirmHost';
import { toast } from '../../../ui/toast';
import type { LibraryCatalog } from './useLibraryCatalog';
import { fetchAllLibraryPapers, PAPER_PAGE_SIZE } from './useLibraryCatalog';
import type { MetadataParseDialogState } from '../dialogs/MetadataParseDialog';
import type { LibraryConfirmDialogState } from './useBatchOperations';
import { buildManualMetadataUpdateRequest } from '../manualMetadataPatch';

type LocaleText = (zh: string, en: string) => string;

interface TranslatedPdfAttachDraft {
  paper: LiteraturePaper;
  sourcePath: string;
}

export interface MetadataJobsOptions {
  catalog: LibraryCatalog;
  demoMode: boolean;
  l: LocaleText;
  metadataLlmPreset: QaModelPreset | null;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setPaperSaving: Dispatch<SetStateAction<boolean>>;
  setDialogBusy: Dispatch<SetStateAction<boolean>>;
  setConfirmDialog: Dispatch<SetStateAction<LibraryConfirmDialogState | null>>;
}

export interface MetadataJobsState {
  metadataWorking: boolean;
  setMetadataWorking: Dispatch<SetStateAction<boolean>>;
  bulkMetadataWorking: boolean;
  metadataDialog: MetadataParseDialogState | null;
  setMetadataDialog: Dispatch<SetStateAction<MetadataParseDialogState | null>>;
  metadataDialogBusy: boolean;
  tagDialogPaper: LiteraturePaper | null;
  setTagDialogPaper: Dispatch<SetStateAction<LiteraturePaper | null>>;
  translatedPdfAttachDraft: TranslatedPdfAttachDraft | null;
  setTranslatedPdfAttachDraft: Dispatch<SetStateAction<TranslatedPdfAttachDraft | null>>;
  resolveLlmMetadataFallback: (input: {
    title: string;
    excerptText: string | null | undefined;
  }) => Promise<MetadataLookupResult | null>;
  handleEnrichAllMetadata: () => Promise<void>;
  handleSubmitMetadataDialog: () => Promise<void>;
  handleSavePaper: (request: UpdatePaperRequest, categoryIds?: string[]) => Promise<LiteraturePaper | void>;
  handleToggleFavorite: (paper: LiteraturePaper) => Promise<void>;
  handleSubmitPaperTag: (tagName: string) => Promise<void>;
  handleAttachTranslatedPdf: (paper: LiteraturePaper) => Promise<void>;
  handleGenerateTranslatedPdf: (paper: LiteraturePaper) => Promise<void>;
  handleConfirmTranslatedPdfAttach: (language: string | null) => Promise<void>;
  handleRemoveTranslatedPdf: (paper: LiteraturePaper) => void;
  handleUpdateTranslatedPdfLanguage: (
    paper: LiteraturePaper,
    attachmentId: string,
    language: string | null,
  ) => Promise<void>;
  removeTranslatedPdfAfterConfirm: (attachmentId: string) => Promise<void>;
}

/** 元数据任务：LLM/远程抓取、批量补全、解析应用，以及文献记录与译版附件的保存结果。 */
export function useMetadataJobs({
  catalog,
  demoMode,
  l,
  metadataLlmPreset,
  setStatusMessage,
  setError,
  setPaperSaving,
  setDialogBusy,
  setConfirmDialog,
}: MetadataJobsOptions): MetadataJobsState {
  const {
    libraryStorageDir,
    papersQueryGenerationRef,
    allPapersSnapshotRef,
    filters,
    paperSort,
    selectedCategoryId,
    searchQuery,
    mineruPaperIds,
    setCategories,
    setPapers,
    setPapersTotal,
    setSelectedPaperId,
    refreshAll,
    reloadAfterPaperUpdate,
    showDemoLockedMessage,
  } = catalog;

  const [metadataWorking, setMetadataWorking] = useState(false);
  const [bulkMetadataWorking, setBulkMetadataWorking] = useState(false);
  const [metadataDialog, setMetadataDialog] = useState<MetadataParseDialogState | null>(null);
  const [metadataDialogBusy, setMetadataDialogBusy] = useState(false);
  const [tagDialogPaper, setTagDialogPaper] = useState<LiteraturePaper | null>(null);
  const [translatedPdfAttachDraft, setTranslatedPdfAttachDraft] = useState<TranslatedPdfAttachDraft | null>(null);
  const paperSaveInFlightRef = useRef(false);

  // 中文文献元数据 LLM 兑底：Crossref/OpenAlex 对中文论文覆盖有限，远程检索未命中时，
  // 使用配置的大模型从文献首页文本直接抽取标题、作者、期刊、摘要、关键词等字段。
  // 只对中文文献启用，避免对英文文献的检索 miss 浪费模型调用。
  const resolveLlmMetadataFallback = useCallback(
    async (input: {
      title: string;
      excerptText: string | null | undefined;
    }): Promise<MetadataLookupResult | null> => {
      const preset = metadataLlmPreset;

      if (!preset?.apiKey?.trim() || !preset.baseUrl?.trim() || !preset.model?.trim()) {
        return null;
      }

      const excerptText = input.excerptText?.trim() ?? '';

      if (!excerptText) {
        return null;
      }

      if (!isChineseText(input.title) && !isChineseDominant(excerptText)) {
        return null;
      }

      return extractLiteratureMetadataWithLlm({
        baseUrl: preset.baseUrl.trim(),
        apiKey: preset.apiKey.trim(),
        model: preset.model.trim(),
        apiMode: preset.apiMode,
        title: input.title,
        excerptText,
      }).catch(() => null);
    },
    [metadataLlmPreset],
  );

  const handleEnrichAllMetadata = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (bulkMetadataWorking) {
      return;
    }

    setBulkMetadataWorking(true);
    setError('');

    try {
      const allPapers = await fetchAllLibraryPapers();

      if (allPapers.length === 0) {
        setStatusMessage(l('当前文库没有可解析的文献', 'There are no papers to parse.'));
        return;
      }

      let updatedCount = 0;
      let unchangedCount = 0;
      let missedCount = 0;
      let failedCount = 0;

      for (const [index, paper] of allPapers.entries()) {
        setStatusMessage(
          l(
            `正在解析元数据：${index + 1}/${allPapers.length} - ${paper.title}`,
            `Parsing metadata: ${index + 1}/${allPapers.length} - ${paper.title}`,
          ),
        );

        try {
          let metadata = await lookupLiteratureMetadata({
            doi: paper.doi,
            title: paper.title,
            path: paperPdfPath(paper, libraryStorageDir),
          });

          // 中文文献在远程数据库中通常检索不到：读取首页文本后用 LLM 提取兑底。
          // 是否为中文文献由 resolveLlmMetadataFallback 内部根据标题与正文判定，
          // 以覆盖标题为英文但正文为中文的文献；英文文献不会产生模型调用。
          if (!metadata) {
            const pdfPath = paperPdfPath(paper, libraryStorageDir);
            const firstPageText = pdfPath
              ? (await extractLocalPdfMetadataPreview(pdfPath).catch(() => null))?.firstPageText
              : null;

            metadata = await resolveLlmMetadataFallback({
              title: paper.title,
              excerptText: firstPageText,
            });
          }

          if (!metadata) {
            missedCount += 1;
            continue;
          }

          const updateRequest = metadataUpdateForPaper(paper, metadata);

          if (!updateRequest) {
            unchangedCount += 1;
            continue;
          }

          await updateLibraryPaper(updateRequest);
          updatedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      await refreshAll();

      const message = l(
        `元数据解析完成：更新 ${updatedCount}，无需更新 ${unchangedCount}，未匹配 ${missedCount}，失败 ${failedCount}。`,
        `Metadata parsing finished: ${updatedCount} updated, ${unchangedCount} unchanged, ${missedCount} not matched, ${failedCount} failed.`,
      );

      setStatusMessage(message);

      if (failedCount > 0) {
        setError(message);
      }
    } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('批量解析文献元数据失败', 'Failed to parse metadata for all papers');
      setError(message);
      setStatusMessage(message);
    } finally {
      setBulkMetadataWorking(false);
    }
  };

  useEffect(() => {
    const handleMetadataEnrichRequest = () => {
      void handleEnrichAllMetadata();
    };

    window.addEventListener(LIBRARY_METADATA_ENRICH_REQUEST_EVENT, handleMetadataEnrichRequest);

    return () => {
      window.removeEventListener(LIBRARY_METADATA_ENRICH_REQUEST_EVENT, handleMetadataEnrichRequest);
    };
  }, [handleEnrichAllMetadata]);

  const handleSubmitMetadataDialog = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      setMetadataDialog(null);
      return;
    }

    if (!metadataDialog || metadataDialogBusy) {
      return;
    }

    const title = metadataDialog.title.trim();
    const doi = metadataDialog.doi.trim();

    if (!title && !doi) {
      setError(l('请输入标题或 DOI 后再解析元数据。', 'Enter a title or DOI before parsing metadata.'));
      return;
    }

    setMetadataDialogBusy(true);
    setError('');

    try {
      let metadata = await lookupLiteratureMetadata({
        doi: doi || null,
        title: title || metadataDialog.paper.title,
        path: paperPdfPath(metadataDialog.paper, libraryStorageDir),
      });

      // 中文文献远程检索通常未命中，用 LLM 从首页文本提取兑底；
      // 是否为中文文献由 resolveLlmMetadataFallback 内部判定，英文文献不会产生模型调用。
      if (!metadata) {
        const pdfPath = paperPdfPath(metadataDialog.paper, libraryStorageDir);
        const firstPageText = pdfPath
          ? (await extractLocalPdfMetadataPreview(pdfPath).catch(() => null))?.firstPageText
          : null;

        metadata = await resolveLlmMetadataFallback({
          title: title || metadataDialog.paper.title,
          excerptText: firstPageText,
        });
      }

      const updateRequest = buildManualMetadataUpdateRequest(
        metadataDialog.paper,
        metadata,
        { title, doi },
      );

      if (!metadata && !updateRequest) {
        setStatusMessage(l('未匹配到元数据，请调整标题或 DOI 后重试。', 'No metadata matched. Adjust the title or DOI and try again.'));
        setError(l('未匹配到元数据。', 'No metadata matched.'));
        return;
      }

      if (!updateRequest) {
        setMetadataDialog(null);
        setStatusMessage(l('文献元数据已是最新。', 'Paper metadata is already up to date.'));
        return;
      }

      const updatedPaper = await updateLibraryPaper(updateRequest);
      await reloadAfterPaperUpdate(updatedPaper);
      setMetadataDialog(null);
      setStatusMessage(
        metadata
          ? l('文献元数据已更新。', 'Paper metadata updated.')
          : l('未匹配到远程元数据，已保存手动输入的标题或 DOI。', 'No remote metadata matched. Manual title or DOI saved.'),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('解析文献元数据失败', 'Failed to parse paper metadata');
      setError(message);
      setStatusMessage(message);
    } finally {
      setMetadataDialogBusy(false);
    }
  };

  const handleSavePaper = async (request: UpdatePaperRequest, categoryIds?: string[]) => {
    if (demoMode) {
      showDemoLockedMessage();
      throw new Error(l('演示模式不可修改文献。', 'Paper changes are disabled in demo mode.'));
    }

    if (paperSaveInFlightRef.current) {
      throw new Error(l('文献信息正在保存。', 'Paper metadata is already being saved.'));
    }
    paperSaveInFlightRef.current = true;
    setPaperSaving(true);
    setError('');

    try {
      let updatedPaper = await updateLibraryPaper(request);
      if (categoryIds) {
        const currentCategoryIds = [...updatedPaper.categoryIds].sort();
        const nextCategoryIds = [...new Set(categoryIds)].sort();
        if (JSON.stringify(currentCategoryIds) !== JSON.stringify(nextCategoryIds)) {
          updatedPaper = await setLibraryPaperCategories({
            paperId: updatedPaper.id,
            categoryIds: nextCategoryIds,
          });
        }
      }

      const currentSnapshot = allPapersSnapshotRef.current;
      const hasPaper = currentSnapshot.some((paper) => paper.id === updatedPaper.id);
      const nextSnapshot = hasPaper
        ? currentSnapshot.map((paper) => paper.id === updatedPaper.id ? updatedPaper : paper)
        : [...currentSnapshot, updatedPaper];
      allPapersSnapshotRef.current = nextSnapshot;

      await reloadAfterPaperUpdate(updatedPaper);
      setStatusMessage(l('文献信息已保存', 'Paper metadata saved'));
      return updatedPaper;
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('保存文献信息失败', 'Failed to save paper metadata');
      setError(message);
      setStatusMessage(message);
      throw nextError;
    } finally {
      paperSaveInFlightRef.current = false;
      setPaperSaving(false);
    }
  };

  const handleToggleFavorite = async (paper: LiteraturePaper) => {
    const nextFavorite = !paper.isFavorite;
    setPaperSaving(true);
    setError('');

    try {
      const updatedPaper = await updateLibraryPaper({
        paperId: paper.id,
        isFavorite: nextFavorite,
      });

      await reloadAfterPaperUpdate(updatedPaper);
      setStatusMessage(
        nextFavorite
          ? l('已加入收藏', 'Added to favorites')
          : l('已取消收藏', 'Removed from favorites'),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('更新收藏状态失败', 'Failed to update favorite status');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperSaving(false);
    }
  };

  const handleSubmitPaperTag = async (tagName: string) => {
    if (demoMode) {
      showDemoLockedMessage();
      setTagDialogPaper(null);
      return;
    }

    if (!tagDialogPaper) {
      return;
    }

    const normalizedTag = tagName.trim();

    if (!normalizedTag) {
      return;
    }

    const existingTags = tagDialogPaper.tags.map((tag) => tag.name.trim()).filter(Boolean);
    const hasTag = existingTags.some(
      (tag) => tag.toLocaleLowerCase() === normalizedTag.toLocaleLowerCase(),
    );

    if (hasTag) {
      setTagDialogPaper(null);
      setStatusMessage(l(`标签已存在：${normalizedTag}`, `Tag already exists: ${normalizedTag}`));
      return;
    }

    setDialogBusy(true);
    setError('');

    try {
      const updatedPaper = await updateLibraryPaper({
        paperId: tagDialogPaper.id,
        tags: [...existingTags, normalizedTag],
      });
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
      setTagDialogPaper(null);
      setStatusMessage(l(`已添加标签：${normalizedTag}`, `Added tag: ${normalizedTag}`));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('添加标签失败', 'Failed to add tag');
      setError(message);
      setStatusMessage(message);
    } finally {
      setDialogBusy(false);
    }
  };

  const handleAttachTranslatedPdf = async (paper: LiteraturePaper) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setError('');

    try {
      const paths = await selectLibraryPdfFiles();
      const sourcePath = paths[0];

      if (!sourcePath) {
        return;
      }
      setTranslatedPdfAttachDraft({ paper, sourcePath });
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : l('附加翻译版 PDF 失败', 'Failed to attach the translated PDF');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperSaving(false);
    }
  };

  const handleGenerateTranslatedPdf = async (paper: LiteraturePaper) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setError('');
    try {
      await startRetainPdfTranslationOnce(paper.id);
      const message = l(`已提交 RetainPDF 翻译：${paper.title}`, `RetainPDF translation started: ${paper.title}`);
      setStatusMessage(message);
      toast.info(message, {
        description: l(
          '任务在后台执行，完成后会自动下载并附加译版 PDF。',
          'The task runs in the background. The translated PDF will be attached automatically when ready.',
        ),
      });
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : l('启动 RetainPDF 翻译失败', 'Failed to start RetainPDF translation');
      setError(message);
      setStatusMessage(message);
      toast.error(message);
    }
  };

  const handleConfirmTranslatedPdfAttach = async (language: string | null) => {
    if (!translatedPdfAttachDraft) return;
    const { paper, sourcePath } = translatedPdfAttachDraft;
    setPaperSaving(true);
    try {
      const originalPath = paperPdfPath(paper, libraryStorageDir);
      const [originalPages, translatedPages] = await Promise.all([
        originalPath ? readPdfPageCount(originalPath) : Promise.resolve(null),
        readPdfPageCount(sourcePath),
      ]);
      if (originalPages && translatedPages && originalPages !== translatedPages) {
        const proceed = await confirmAction({
          title: l('翻译版 PDF 页数与原文不一致', 'Translated PDF page count differs'),
          description: l(
            `翻译版 PDF 页数（${translatedPages} 页）与原版（${originalPages} 页）不一致，对照阅读时页码可能错位。仍要附加吗？`,
            `The translated PDF has ${translatedPages} pages, but the original has ${originalPages}. Page alignment in compare mode may be off. Attach anyway?`,
          ),
        });
        if (!proceed) { setStatusMessage(l('已取消附加翻译版 PDF', 'Translated PDF attachment cancelled')); setTranslatedPdfAttachDraft(null); return; }
      }
      const existingTranslatedIds = new Set(paper.attachments.filter((item) => item.kind === ATTACHMENT_KIND_TRANSLATED_PDF).map((item) => item.id));
      const updatedPaper = await addLibraryAttachment({ paperId: paper.id, sourcePath, kind: ATTACHMENT_KIND_TRANSLATED_PDF, language });
      if (updatedPaper.attachments.some((attachment) => attachment.kind === ATTACHMENT_KIND_TRANSLATED_PDF && existingTranslatedIds.has(attachment.id))) {
        setStatusMessage(l('该译版已存在，可通过设置语言修改', 'This translated PDF already exists. Use Set language to update its metadata.'));
      } else {
        setStatusMessage(l('已附加翻译版 PDF', 'Translated PDF attached'));
      }
      await reloadAfterPaperUpdate(updatedPaper);
      emitNativePaperUpdated(updatedPaper);
      setTranslatedPdfAttachDraft(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : l('附加翻译版 PDF 失败', 'Failed to attach the translated PDF'));
    } finally { setPaperSaving(false); }
  };

  const handleRemoveTranslatedPdf = (paper: LiteraturePaper) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    const attachment = paperTranslatedPdfAttachment(paper, libraryStorageDir)?.attachment;

    if (!attachment) {
      return;
    }

    setConfirmDialog({
      kind: 'remove-translated-pdf',
      paper,
      attachmentId: attachment.id,
      fileName: attachment.fileName,
    });
  };

  const handleUpdateTranslatedPdfLanguage = async (
    paper: LiteraturePaper,
    attachmentId: string,
    language: string | null,
  ) => {
    if (demoMode) { showDemoLockedMessage(); throw new Error(l('演示模式不可修改', 'Changes are disabled in demo mode')); }
    const attachment = paper.attachments.find((item) => item.id === attachmentId && item.kind === ATTACHMENT_KIND_TRANSLATED_PDF);
    if (!attachment) throw new Error(l('译版附件已不存在，请刷新后重试', 'Translated attachment no longer exists; refresh and retry'));
    setPaperSaving(true);
    try {
      const result = await updateTranslatedPdfLanguages({ changes: [{
        paperId: paper.id,
        attachmentId,
        expectedLanguage: attachment.language ?? null,
        language,
      }] });
      for (const updatedPaper of result.papers) {
        await reloadAfterPaperUpdate(updatedPaper);
        emitNativePaperUpdated(updatedPaper);
      }
      setStatusMessage(l('译版语言已更新', 'Translated PDF language updated'));
    } finally { setPaperSaving(false); }
  };

  const removeTranslatedPdfAfterConfirm = async (attachmentId: string) => {
    setPaperSaving(true);
    setDialogBusy(true);
    setError('');

    try {
      const updatedPaper = await removeLibraryAttachment({ attachmentId, deleteFile: true });
      await reloadAfterPaperUpdate(updatedPaper);
      emitNativePaperUpdated(updatedPaper);
      setStatusMessage(l('已移除翻译版 PDF', 'Translated PDF removed'));
      setConfirmDialog(null);
    } catch (nextError) {
      const message = nextError instanceof Error
        ? nextError.message
        : l('移除翻译版 PDF 失败', 'Failed to remove the translated PDF');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperSaving(false);
      setDialogBusy(false);
    }
  };

  return {
    metadataWorking,
    setMetadataWorking,
    bulkMetadataWorking,
    metadataDialog,
    setMetadataDialog,
    metadataDialogBusy,
    tagDialogPaper,
    setTagDialogPaper,
    translatedPdfAttachDraft,
    setTranslatedPdfAttachDraft,
    resolveLlmMetadataFallback,
    handleEnrichAllMetadata,
    handleSubmitMetadataDialog,
    handleSavePaper,
    handleToggleFavorite,
    handleSubmitPaperTag,
    handleAttachTranslatedPdf,
    handleGenerateTranslatedPdf,
    handleConfirmTranslatedPdfAttach,
    handleRemoveTranslatedPdf,
    handleUpdateTranslatedPdfLanguage,
    removeTranslatedPdfAfterConfirm,
  };
}
