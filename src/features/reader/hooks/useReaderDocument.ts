import { useCallback, useMemo } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLibraryReadingTracking } from '../useLibraryReadingTracking';
import {
  downloadRemoteFileToPath,
  finishMineruCacheReparse,
  loadPdfBinary,
  listLocalDirectoryFiles,
  localPathExists,
  prepareMineruReparse,
  readLocalTextFile,
  readLocalTextFileIfExists,
  repairMineruCacheImages,
  selectLocalMineruJsonPath,
} from '../../../services/desktop';
import type { LocalDirectoryFileEntry } from '../../../services/desktop';
import {
  extractTranslatableMarkdownFromMineruBlock,
  flattenMineruPages,
  parseMineruMarkdownPages,
  resolveMineruBlockContentSource,
} from '../../../services/mineru';
import { parseMineruPagesOffThread } from '../mineruParseWorker';
import { extractMineruOutlineIndex, type MineruOutlineIndexItem } from '../mineruSegments.ts';
import {
  getMissingMineruCredentialMessage,
  PARSE_ENGINE_LABEL,
  runDocumentParseWithFallback,
} from '../mineruOcrFallback';
import { startRetainPdfTranslationOnce } from '../../../services/retainPdf';
import {
  buildSummaryBlockInputs,
  extractPdfTextByPdfJs,
} from '../../../services/summarySource';
import {
  buildZoteroAttachmentPdfUrl,
  lookupZoteroKey,
} from '../../../services/zotero';
import {
  isPaperTaskRunning,
} from '../paperTaskState';
import type {
  MineruPage,
  PdfBlockSelectContext,
  PdfHighlightTarget,
  PdfReadingHeatmap,
  PdfScrollPosition,
  PdfSource,
  PositionedMineruBlock,
  SelectedExcerpt,
  SummaryBlockInput,
  WorkspaceItem,
  WorkspaceStage,
} from '../../../types/reader';
import {
  buildMineruCachePaths,
  guessSiblingJsonPaths,
  guessSiblingMarkdownPath,
} from '../../../utils/mineruCache';
import {
  loadPaperHistory,
  PAPER_READING_HEATMAP_UPDATED_EVENT,
  savePaperHistory,
} from '../../../utils/paperHistory';
import { getFileNameFromPath } from '../../../utils/text';
import { perfMark, perfMeasure } from '../../../utils/perfTrace';
import { getPdfSourceSignature } from '../../pdf/pdfDocumentSource';
import {
  buildRemotePdfDownloadPath,
  clampPaneRatio,
  getMineruJsonDisplayName,
  getPreviewPdfName,
  isSameLocalPath,
  PANE_RATIO_STORAGE_KEY,
} from '../documentReaderShared';
import {
  stripEmptyAssistantMessages,
} from '../documentReaderQaSessions';
import { useDocumentTranslation } from '../useDocumentTranslation';
import {
  buildReaderLocalPdfPathCandidates,
  restorePdfSourceHistory,
  upsertRecentPdfReadingHeatmap,
  upsertRecentPdfScrollPosition,
} from '../documentReaderHistory';
import {
  buildAvailablePdfOptions,
  canSwitchToOriginalPdf,
  resolveAnnotationSaveDirectory,
  resolveCurrentLocalPdfPath,
  resolveCurrentPdfVariantLabel,
  resolveOriginalPdfPath,
} from '../documentReaderPdfOptions.ts';
import {
  writeMineruParseCache,
} from '../readerLibraryPreview';
import {
  loadSavedMineruPages,
  resolveSavedPdfPath,
} from '../documentReaderCache';
import {
  computeMineruBlocksContentSignature,
} from '../documentReaderSummarySource';
import { formatReaderDocumentSource } from '../readerWorkspaceShared';


function requestDeferredReaderStartupWork(callback: () => void) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 280 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 80);
  return () => window.clearTimeout(handle);
}


import type { ReaderTabState } from './readerTabContext';

export function useReaderDocument(state: ReaderTabState) {
  const { activeBlockId, annotations, autoSummarySourceKeyRef, autoTranslatedSelectionKeyRef, cachedSummaryAttemptKeyRef, cachedSummaryRequestIdRef, currentDocument, document, documentOpenGenerationRef, flatBlocks, forceSaveCurrentPaperHistoryRef, isActive, l, lRef, lastCapturedSelectionRef, latestPaneWidthRatioRef, layoutRef, libraryOperation, mineruApiToken, mineruPath, onAttachTranslatedPdf, onDocumentResolved, onLibraryPreviewSync, onOpenPreferences, onZoteroUserIdChange, paperOpenedAtRef, paperSummary, paperSummarySourceKey, pdfData, pdfDocumentErrorSnapshot, pdfPageCountSnapshot, pdfPath, pdfReadingHeatmapsRef, pdfScrollPositionsRef, pdfSource, pdfTextCacheRef, pendingHistoryActiveBlockIdRef, projectPdfFiles, qaHistoryReadyWorkspaceRef, qaSessions, qaSessionsRef, readerLocaleText, readingViewMode, restoredHistoryRef, selectedExcerpt, selectedQaPresetId, selectedQaPresetIdRef, selectedQaSessionId, selectedQaSessionIdRef, selectionTranslationModelPreset, setActiveBlockId, setActivePdfHighlight, setAnnotations, setAttachTranslatedPdfBusy, setBlockScrollSignal, setCapturingScreenshot, setCurrentDocument, setError, setFlatBlocks, setHoveredBlockId, setIsDraggingSplitter, setLeftPaneWidthRatio, setLibraryOperation, setLoading, setMineruOutlineIndex, setMineruPages, setMineruPath, setPaperSummary, setPaperSummaryError, setPaperSummaryLoading, setPaperSummarySourceKey, setPdfData, setPdfHighlightSignal, setPdfOpenFailed, setPdfPath, setPdfSource, setProjectPdfFiles, setReadingViewMode, setRestoringDocumentBlocks, setSelectedAnnotationId, setSelectedExcerpt, setStatusMessage, setSummaryCacheLoading, setWorkspaceStage, setZoteroRelatedNotes, setZoteroRelatedNotesError, setZoteroRelatedNotesLoading, settings, startSplitResize, translationModelPreset, translationSnapshot, updateLibraryOperation, workspaceStage, zoteroApiKey, zoteroUserId } = state;

  const effect_81 = useCallback(() => {
    setCurrentDocument((current) =>
      current.workspaceId === document.workspaceId &&
      (current.translatedPdfPath ?? '') !== (document.translatedPdfPath ?? '')
        ? { ...current, translatedPdfPath: document.translatedPdfPath }
        : current,
    );
  }, [document.translatedPdfPath, document.workspaceId]);
  const handleAttachTranslatedPdf = useCallback(async () => {
      if (!onAttachTranslatedPdf || currentDocument.source !== 'native-library') {
        return;
      }

      setAttachTranslatedPdfBusy(true);

      try {
        await onAttachTranslatedPdf(currentDocument);
      } finally {
        setAttachTranslatedPdfBusy(false);
      }
    }, [onAttachTranslatedPdf, currentDocument]);
  const handleGenerateTranslatedPdf = useCallback(async () => {
      if (currentDocument.source !== 'native-library') {
        return;
      }

      setError('');
      try {
        await startRetainPdfTranslationOnce(currentDocument.itemKey);
        const message = l(
          `已提交 RetainPDF 翻译：${currentDocument.title}`,
          `RetainPDF translation started: ${currentDocument.title}`,
        );
        setStatusMessage(message);
      } catch (nextError) {
        const message = nextError instanceof Error
          ? nextError.message
          : l('启动 RetainPDF 翻译失败', 'Failed to start RetainPDF translation');
        setError(message);
        setStatusMessage(message);
      }
    }, [currentDocument, l, setError, setStatusMessage]);
  const selectedSectionTitle = useMemo(
      () =>
        currentDocument.source === 'standalone'
          ? readerLocaleText('独立文献', 'Standalone Document')
          : readerLocaleText('我的文库', 'My Library'),
      [currentDocument.source, readerLocaleText],
    );
  const documentSource = useMemo(
      () => formatReaderDocumentSource(readerLocaleText, currentDocument, selectedSectionTitle),
      [currentDocument, readerLocaleText, selectedSectionTitle],
    );
  const hasDocument = Boolean(currentDocument && pdfSource);
  const {
      applySelectedExcerptTranslation,
      blockTranslations,
      handleCancelDocumentTranslation,
      handleClearTranslations,
      handleRetranslateBlock,
      handleTranslateDocument,
      handleTranslateSelectedExcerpt,
      resetDocumentTranslationState,
      resetSelectedExcerptTranslationState,
      selectedExcerptError,
      selectedExcerptTranslation,
      selectedExcerptTranslating,
      translatedCount,
      translating,
      translationCancelling,
      translationProgressCompleted,
      translationProgressTotal,
    } = useDocumentTranslation({
      currentDocument,
      flatBlocks,
      libraryOperationRunning: isPaperTaskRunning(libraryOperation, 'translation'),
      onOpenPreferences,
      selectedExcerpt,
      selectionTranslationModelPreset,
      settings,
      setError,
      setStatusMessage,
      translationModelPreset,
      translationSnapshot,
      updateLibraryOperation,
      lRef,
    });
  const currentPdfName =
      pdfSource?.kind === 'remote-url'
        ? pdfSource.fileName ||
          currentDocument.attachmentFilename ||
          currentDocument.attachmentTitle ||
          `${currentDocument.title}.pdf`
        : pdfPath
          ? getFileNameFromPath(pdfPath)
          : l('未打开', 'Not Opened');
  const currentJsonName = mineruPath
      ? mineruPath.startsWith('cloud:')
        ? mineruPath.replace(/^cloud:/, '')
        : getFileNameFromPath(mineruPath)
      : l('未加载', 'Not Loaded');
  const originalPdfPath = useMemo(
      () => resolveOriginalPdfPath(document, settings.remotePdfDownloadDir),
      [document, settings.remotePdfDownloadDir],
    );
  const currentLocalPdfPath = resolveCurrentLocalPdfPath(pdfPath, pdfSource);
  const compareOriginalPath = readingViewMode === 'pdf-compare' ? originalPdfPath.trim() : '';
  const effectiveSourceKey = compareOriginalPath
      ? getPdfSourceSignature({ kind: 'local-path', path: originalPdfPath })
      : getPdfSourceSignature(pdfSource);
  const effectivePdfData = compareOriginalPath ? null : pdfData;
  const pdfPageCount = pdfPageCountSnapshot?.sourceKey === effectiveSourceKey &&
      pdfPageCountSnapshot.data === effectivePdfData ? pdfPageCountSnapshot.count : 0;
  const pdfDocumentError = pdfDocumentErrorSnapshot?.sourceKey === effectiveSourceKey
      ? pdfDocumentErrorSnapshot.error : '';
  const pdfScrollSourceKey = useMemo(
      () => effectiveSourceKey || (pdfSource ? getPdfSourceSignature(pdfSource, pdfPath || currentDocument.workspaceId) : ''),
      [currentDocument.workspaceId, effectiveSourceKey, pdfPath, pdfSource],
    );
  const pdfScrollPosition = pdfScrollSourceKey
      ? pdfScrollPositionsRef.current[pdfScrollSourceKey] ?? null
      : null;
  const recordLibraryReadingPosition = useLibraryReadingTracking({
      document: currentDocument,
      expectedWorkspaceId: document.workspaceId,
      active: isActive && Boolean(pdfSource),
      sourceKey: pdfScrollSourceKey,
      pageCount: pdfPageCount,
      position: pdfScrollPosition,
    });
  const pdfReadingHeatmap = pdfScrollSourceKey
      ? pdfReadingHeatmapsRef.current[pdfScrollSourceKey] ?? null
      : null;
  const saveCurrentPaperHistory = useCallback(
      (
        nextPdfScrollPositions = pdfScrollPositionsRef.current,
        nextPdfReadingHeatmaps = pdfReadingHeatmapsRef.current,
        force = false,
      ) => {
        if (
          (!isActive && !force) ||
          !currentDocument.workspaceId ||
          !pdfSource ||
          qaHistoryReadyWorkspaceRef.current !== currentDocument.workspaceId
        ) {
          return;
        }

        savePaperHistory({
          version: 6,
          workspaceId: currentDocument.workspaceId,
          document: currentDocument,
          lastOpenedAt: paperOpenedAtRef.current,
          lastUpdatedAt: Date.now(),
          lastPdfPath:
            pdfPath || (pdfSource.kind === 'local-path' ? pdfSource.path : ''),
          pdfScrollPositions: nextPdfScrollPositions,
          pdfReadingHeatmaps: nextPdfReadingHeatmaps,
          lastMineruPath: mineruPath,
          lastActiveBlockId: activeBlockId,
          workspaceStage,
          readingViewMode,
          selectedQaPresetId: selectedQaPresetIdRef.current,
          selectedQaSessionId: selectedQaSessionIdRef.current || null,
          paperSummary,
          paperSummarySourceKey,
          workspaceNoteMarkdown: '',
          annotations,
          qaSessions: stripEmptyAssistantMessages(qaSessionsRef.current),
        });
      },
      [
        activeBlockId,
        annotations,
        currentDocument,
        isActive,
        mineruPath,
        paperSummary,
        paperSummarySourceKey,
        pdfPath,
        pdfSource,
        readingViewMode,
        workspaceStage,
      ],
    );
  forceSaveCurrentPaperHistoryRef.current = () => {
      saveCurrentPaperHistory(
        pdfScrollPositionsRef.current,
        pdfReadingHeatmapsRef.current,
        true,
      );
    };
  const handlePdfScrollPositionChange = useCallback((position: PdfScrollPosition) => {
      recordLibraryReadingPosition(position);
      const next = upsertRecentPdfScrollPosition(pdfScrollPositionsRef.current, position);

      if (!next) {
        return;
      }

      pdfScrollPositionsRef.current = next;
      saveCurrentPaperHistory(next, pdfReadingHeatmapsRef.current);
    }, [recordLibraryReadingPosition, saveCurrentPaperHistory]);
  const handlePdfReadingHeatmapChange = useCallback((heatmap: PdfReadingHeatmap) => {
      const next = upsertRecentPdfReadingHeatmap(pdfReadingHeatmapsRef.current, heatmap);

      if (!next) {
        return;
      }

      pdfReadingHeatmapsRef.current = next;
      saveCurrentPaperHistory(pdfScrollPositionsRef.current, next);
      window.dispatchEvent(
        new CustomEvent(PAPER_READING_HEATMAP_UPDATED_EVENT, {
          detail: {
            workspaceId: currentDocument.workspaceId,
            sourceKey: heatmap.sourceKey,
          },
        }),
      );
    }, [saveCurrentPaperHistory]);
  const currentPdfVariantLabel = useMemo(
      () => resolveCurrentPdfVariantLabel({
        currentLocalPdfPath,
        originalPdfPath,
        pdfSource,
        localize: l,
      }),
      [currentLocalPdfPath, l, originalPdfPath, pdfSource],
    );
  const canOpenOriginalPdf = canSwitchToOriginalPdf(currentLocalPdfPath, originalPdfPath);
  const annotationSaveDirectory = useMemo(
      () => resolveAnnotationSaveDirectory({
        mineruCacheDir: settings.mineruCacheDir,
        document,
        originalPdfPath,
        currentLocalPdfPath,
      }),
      [currentLocalPdfPath, document, originalPdfPath, settings.mineruCacheDir],
    );
  const availablePdfOptions = useMemo(
      () => buildAvailablePdfOptions({
        originalPdfPath,
        projectPdfFiles,
        currentLocalPdfPath,
        currentPdfVariantLabel,
        localize: l,
      }),
      [currentLocalPdfPath, currentPdfVariantLabel, l, originalPdfPath, projectPdfFiles],
    );
  const effect_152 = useCallback(() => {
    const fallbackFiles: LocalDirectoryFileEntry[] = currentLocalPdfPath
      ? [
          {
            path: currentLocalPdfPath,
            name: getFileNameFromPath(currentLocalPdfPath),
            size: 0,
            modifiedAtMs: 0,
          },
        ]
      : [];

    // Native library attachments define this document's sources. A cache directory is
    // not an ownership boundary, so don't promote unrelated PDFs found there.
    if (document.source === 'native-library') {
      const registeredFiles: LocalDirectoryFileEntry[] = (document.pdfVariants ?? []).map((variant) => ({
        path: variant.path,
        name: variant.name,
        role: variant.role,
        size: 0,
        modifiedAtMs: 0,
      }));
      setProjectPdfFiles(registeredFiles.length > 0 ? registeredFiles : fallbackFiles);
      return;
    }

    if (!annotationSaveDirectory.trim()) {
      setProjectPdfFiles(fallbackFiles);
      return;
    }

    let cancelled = false;

    void listLocalDirectoryFiles(annotationSaveDirectory, 'pdf')
      .then((entries) => {
        if (cancelled) {
          return;
        }

        setProjectPdfFiles(entries);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setProjectPdfFiles(fallbackFiles);
      });

    return () => {
      cancelled = true;
    };
  }, [annotationSaveDirectory, currentLocalPdfPath]);
  const blockById = useMemo(
      () => new Map(flatBlocks.map((block) => [block.blockId, block])),
      [flatBlocks],
    );
  const activeBlock = useMemo(
      () => (activeBlockId ? blockById.get(activeBlockId) ?? null : null),
      [activeBlockId, blockById],
    );
  const resolveBlockContentSource = useCallback(
      (block: PositionedMineruBlock) =>
        resolveMineruBlockContentSource(block, blockById),
      [blockById],
    );
  const activeBlockSummary = useMemo(() => {
      if (!activeBlock) {
        return l('尚未选中结构块', 'No block selected yet');
      }

      return `P${activeBlock.pageIndex + 1} · ${activeBlock.type} · ${activeBlock.blockId}`;
    }, [activeBlock, l]);
  const summaryBlockInputs = useMemo<SummaryBlockInput[]>(
      () => buildSummaryBlockInputs(flatBlocks),
      [flatBlocks],
    );
  const mineruContentSignature = useMemo(
      () => computeMineruBlocksContentSignature(flatBlocks),
      [flatBlocks],
    );
  const resetDocumentState = useCallback(() => {
      // Allow the next opened document, including reopening the same workspace item,
      // to restore cached reading history before any auto-generation runs.
      restoredHistoryRef.current = '';
      setMineruPath('');
      setMineruPages([]);
      setFlatBlocks([]);
      resetDocumentTranslationState();
      setActiveBlockId(null);
      setHoveredBlockId(null);
      setActivePdfHighlight(null);
      setBlockScrollSignal(0);
      pdfScrollPositionsRef.current = {};
      pdfReadingHeatmapsRef.current = {};
      setPaperSummary(null);
      setPaperSummaryLoading(false);
      setSummaryCacheLoading(false);
      setPaperSummaryError('');
      setPaperSummarySourceKey('');
      setLibraryOperation(null);
      autoSummarySourceKeyRef.current = '';
      cachedSummaryAttemptKeyRef.current = '';
      cachedSummaryRequestIdRef.current += 1;
      setSelectedAnnotationId(null);
      setCapturingScreenshot(false);
      setSelectedExcerpt(null);
      setAnnotations([]);
      setZoteroRelatedNotes([]);
      setZoteroRelatedNotesLoading(false);
      setZoteroRelatedNotesError('');
      lastCapturedSelectionRef.current = null;
      autoTranslatedSelectionKeyRef.current = '';
    }, [resetDocumentTranslationState]);
  const applyMineruPages = useCallback(
      (
        pages: MineruPage[],
        nextMineruPath: string,
        options?: {
          item?: WorkspaceItem;
          pdfPath?: string;
          pdfSource?: PdfSource;
          statusMessage?: string;
          outlineIndex?: MineruOutlineIndexItem[];
        },
      ) => {
        const blocks = flattenMineruPages(pages);
        const outlineIndex = options?.outlineIndex ?? extractMineruOutlineIndex(pages);

        setMineruPages(pages);
        setFlatBlocks(blocks);
        setMineruOutlineIndex(outlineIndex);
        setMineruPath(nextMineruPath);
        setActiveBlockId(null);
        setHoveredBlockId(null);
        setBlockScrollSignal((current) => current + 1);

        if (!options?.item) {
          return;
        }

        const currentJsonDisplayName = getMineruJsonDisplayName(nextMineruPath);

        onLibraryPreviewSync({
          item: options.item,
          hasBlocks: blocks.length > 0,
          blockCount: blocks.length,
          currentPdfName: getPreviewPdfName(
            options.item,
            options.pdfPath ?? '',
            options.pdfSource ?? null,
          ),
          currentJsonName: currentJsonDisplayName,
          statusMessage:
            options.statusMessage ??
            lRef.current(
              blocks.length > 0
                ? `已加载 ${blocks.length} 个结构块`
                : '已加载结构化 JSON，但还没有可用的结构块',
              blocks.length > 0
                ? `Loaded ${blocks.length} structured blocks`
                : 'Loaded the structured JSON, but no usable blocks are available yet',
            ),
          sourceKey: `${options.item.workspaceId}::${currentJsonDisplayName}::${blocks.length}`,
        });
      },
      [onLibraryPreviewSync],
    );
  const saveMineruParseCache = useCallback(
      async ({
        item,
        pdfPath: currentPdfPath,
        sourceKind,
        contentJsonText,
        middleJsonText,
        markdownText,
        batchId,
        dataId,
        fileName,
        zipEntries,
      }: {
        item: WorkspaceItem;
        pdfPath: string;
        sourceKind: Parameters<typeof writeMineruParseCache>[0]['sourceKind'];
        contentJsonText?: string | null;
        middleJsonText?: string | null;
        markdownText?: string | null;
        batchId?: string;
        dataId?: string;
        fileName?: string;
        zipEntries?: string[];
      }) => {
        return writeMineruParseCache({
          item,
          pdfPath: currentPdfPath,
          sourceKind,
          contentJsonText,
          middleJsonText,
          markdownText,
          batchId,
          dataId,
          fileName,
          zipEntries,
          mineruCacheDir: settings.mineruCacheDir,
        });
      },
      [settings.mineruCacheDir],
    );
  const tryLoadSavedMineruPages = useCallback(
      async (item: WorkspaceItem) => {
        return loadSavedMineruPages({
          item,
          mineruCacheDir: settings.mineruCacheDir,
          l: lRef.current,
          readText: readLocalTextFileIfExists,
          parsePages: parseMineruPagesOffThread,
          parseMarkdownPages: parseMineruMarkdownPages,
          repairCacheImages: async (directory) => {
            await repairMineruCacheImages(directory);
          },
        });
      },
      [settings.mineruCacheDir],
    );
  const tryResolveSavedPdfPath = useCallback(
      async (item: WorkspaceItem) => {
        return resolveSavedPdfPath({
          item,
          mineruCacheDir: settings.mineruCacheDir,
          readText: readLocalTextFileIfExists,
          pathExists: localPathExists,
        });
      },
      [settings.mineruCacheDir],
    );
  const createHighlightTarget = useCallback(
      (block: PositionedMineruBlock): PdfHighlightTarget | null =>
        block.bbox
          ? {
              blockId: block.blockId,
              pageIndex: block.pageIndex,
              bbox: block.bbox,
              bboxCoordinateSystem: block.bboxCoordinateSystem,
              bboxPageSize: block.bboxPageSize,
            }
          : null,
      [],
    );
  const createSelectionHighlightTarget = useCallback(
      (excerpt: SelectedExcerpt): PdfHighlightTarget | null => {
        const location = excerpt.pdfLocation;

        if (!location?.bbox || typeof location.pageNumber !== 'number') {
          return null;
        }

        return {
          blockId: excerpt.blockId || `selection:${excerpt.createdAt}`,
          pageIndex: Math.max(0, location.pageNumber - 1),
          bbox: location.bbox,
          bboxCoordinateSystem: location.bboxCoordinateSystem,
          bboxPageSize: location.bboxPageSize,
        };
      },
      [],
    );
  const activateBlock = useCallback(
      (
        block: PositionedMineruBlock,
        nextStatus: string,
        options?: {
          syncPdfHighlight?: boolean;
          syncBlockList?: boolean;
        },
      ) => {
        const nextPdfHighlight =
          options?.syncPdfHighlight === false ? null : createHighlightTarget(block);

        setActiveBlockId(block.blockId);
        setHoveredBlockId(block.blockId);
        setActivePdfHighlight(nextPdfHighlight);

        if (nextPdfHighlight) {
          setPdfHighlightSignal((current) => current + 1);
        }

        if (options?.syncBlockList !== false) {
          setBlockScrollSignal((current) => current + 1);
        }

        if (nextStatus.trim()) {
          setStatusMessage(nextStatus);
        }
      },
      [createHighlightTarget],
    );
  const clearSelection = useCallback(() => {
      setActiveBlockId(null);
      setHoveredBlockId(null);
      setActivePdfHighlight(null);
      setStatusMessage(lRef.current('已清除当前选中块', 'Cleared the current block selection'));
    }, []);
  const persistPaneWidthRatio = useCallback((ratio: number) => {
      latestPaneWidthRatioRef.current = ratio;
      setLeftPaneWidthRatio(ratio);
      // 只在比例确定时写一次，避免拖动过程中每帧同步写 localStorage。
      localStorage.setItem(PANE_RATIO_STORAGE_KEY, String(ratio));
    }, []);
  const resetLayout = useCallback(() => {
      persistPaneWidthRatio(0.5);
      setStatusMessage(lRef.current('已重置为默认布局', 'Restored the default layout'));
    }, [persistPaneWidthRatio]);
  const restorePdfScrollPositionsForSource = useCallback(
      (workspaceId: string, source: Exclude<PdfSource, null>, fallback: string) => {
        const history = loadPaperHistory(workspaceId);
        const sourceKey = getPdfSourceSignature(source, fallback || workspaceId);
        const nextHistory = restorePdfSourceHistory(history, sourceKey);

        pdfScrollPositionsRef.current = nextHistory.pdfScrollPositions;
        pdfReadingHeatmapsRef.current = nextHistory.pdfReadingHeatmaps;
      },
      [],
    );
  const openWorkspaceDocument = useCallback(
      async (
        item: WorkspaceItem,
        source: Exclude<PdfSource, null>,
        openingStatus: string,
        nextStage: WorkspaceStage,
        generationToken?: number,
      ): Promise<boolean> => {
        const generation = documentOpenGenerationRef.current;
        const token = generationToken ?? generation.begin();
        if (!generation.isCurrent(token)) {
          return false;
        }
        perfMark('reader:open-start');
        setLoading(true);
        setError('');
        setPdfOpenFailed(false);

        try {
          let resolvedSource = source;
          let resolvedPdfPath = source.kind === 'local-path' ? source.path : '';
          let nextStatus = openingStatus;
          const resolvedItem =
            source.kind === 'local-path' ? { ...item, localPdfPath: source.path } : item;

          let nextResolvedItem = resolvedItem;

          if (source.kind === 'local-path' && !(await localPathExists(source.path))) {
            throw new Error(
              lRef.current(
                `PDF 文件不存在：${source.path}`,
                `PDF file does not exist: ${source.path}`,
              ),
            );
          }

          // 等待磁盘/网络期间可能已经切换文档：旧请求不得继续提交。
          if (!generation.isCurrent(token)) {
            return false;
          }

          if (source.kind === 'remote-url' && settings.remotePdfDownloadDir.trim()) {
            const downloadPath = buildRemotePdfDownloadPath(
              settings.remotePdfDownloadDir,
              item,
              source,
            );

            try {
              await downloadRemoteFileToPath(source.url, downloadPath, source.headers);
              if (!generation.isCurrent(token)) {
                return false;
              }
              resolvedPdfPath = downloadPath;
              nextResolvedItem = { ...item, localPdfPath: downloadPath };
              // 下载是打开前的阻塞步骤：成功后统一切换到本地文件作为阅读来源，
              // 避免 PDF 查看器与文本提取再次请求远程 URL（重复下载）。
              resolvedSource = { kind: 'local-path', path: downloadPath };
              nextStatus = lRef.current(
                `${openingStatus}，并已保存到本地下载目录`,
                `${openingStatus}, and saved to the local download directory`,
              );
            } catch {
              nextStatus = lRef.current(
                `${openingStatus}，但保存到本地下载目录失败`,
                `${openingStatus}, but saving to the local download directory failed`,
              );
            }
          }

          if (!generation.isCurrent(token)) {
            return false;
          }

          resetDocumentState();
          restorePdfScrollPositionsForSource(
            nextResolvedItem.workspaceId,
            resolvedSource,
            resolvedPdfPath || nextResolvedItem.workspaceId,
          );
          setPdfSource(resolvedSource);
          setPdfData(null);
          setPdfPath(resolvedPdfPath);
          setCurrentDocument(nextResolvedItem);
          setWorkspaceStage(nextStage);
          onDocumentResolved(nextResolvedItem);
          perfMeasure('reader:open-source-resolved', 'reader:open-start');

          setRestoringDocumentBlocks(true);
          requestDeferredReaderStartupWork(() => {
            void (async () => {
              const isCurrentOpen = () => generation.isCurrent(token);

              if (!isCurrentOpen()) {
                return;
              }

              if (resolvedSource.kind !== 'local-path') {
                return;
              }

              const cachedMineru = await tryLoadSavedMineruPages(nextResolvedItem);

              if (!isCurrentOpen()) {
                return;
              }

              if (cachedMineru) {
                applyMineruPages(cachedMineru.pages, cachedMineru.path, {
                  item: nextResolvedItem,
                  pdfPath: resolvedPdfPath,
                  pdfSource: resolvedSource,
                  statusMessage: cachedMineru.message,
                });
                setStatusMessage(cachedMineru.message);
                return;
              }

              if (!settings.autoLoadSiblingJson) {
                return;
              }

              for (const siblingJsonPath of guessSiblingJsonPaths(resolvedSource.path)) {
                try {
                  const jsonText = await readLocalTextFileIfExists(siblingJsonPath);
                  if (!jsonText || !isCurrentOpen()) {
                    continue;
                  }

                  const pages = await parseMineruPagesOffThread(jsonText, {
                    sourcePath: siblingJsonPath,
                    onOutlineIndex: (outline) => {
                      if (isCurrentOpen()) setMineruOutlineIndex(outline);
                    },
                    onSegment: (_, { allPagesSoFar, segmentIndex }) => {
                      if (isCurrentOpen() && segmentIndex === 0 && allPagesSoFar.length > 0) {
                        setMineruPages(allPagesSoFar);
                        setFlatBlocks(flattenMineruPages(allPagesSoFar));
                        setMineruPath(siblingJsonPath);
                      }
                    },
                  });

                  if (!isCurrentOpen()) {
                    return;
                  }

                  const siblingStatusMessage = lRef.current(
                    `已自动加载《${item.title}》同目录的 MinerU JSON`,
                    `Automatically loaded the MinerU JSON next to "${item.title}"`,
                  );

                  applyMineruPages(pages, siblingJsonPath, {
                    item: nextResolvedItem,
                    pdfPath: resolvedSource.path,
                    pdfSource: resolvedSource,
                    statusMessage: siblingStatusMessage,
                  });
                  setStatusMessage(siblingStatusMessage);

                  await saveMineruParseCache({
                    item: nextResolvedItem,
                    pdfPath: resolvedSource.path,
                    sourceKind: 'sibling-json',
                    contentJsonText: siblingJsonPath.toLowerCase().endsWith('middle.json') ? null : jsonText,
                    middleJsonText: siblingJsonPath.toLowerCase().endsWith('middle.json') ? jsonText : null,
                  }).catch(() => undefined);
                  return;
                } catch {
                  // Cache restore is opportunistic. Keep the PDF open even if parsing is unavailable.
                }
              }

              const siblingMarkdownPath = guessSiblingMarkdownPath(resolvedSource.path);

              try {
                const markdownText = await readLocalTextFileIfExists(siblingMarkdownPath);
                if (!markdownText?.trim() || !isCurrentOpen()) {
                  return;
                }

                const pages = parseMineruMarkdownPages(markdownText);
                const blockCount = flattenMineruPages(pages).length;

                if (blockCount === 0 || !isCurrentOpen()) {
                  return;
                }

                const markdownStatusMessage = lRef.current(
                  `已自动加载《${item.title}》同目录的 MinerU Markdown`,
                  `Automatically loaded the MinerU Markdown next to "${item.title}"`,
                );

                applyMineruPages(pages, siblingMarkdownPath, {
                  item: nextResolvedItem,
                  pdfPath: resolvedSource.path,
                  pdfSource: resolvedSource,
                  statusMessage: markdownStatusMessage,
                });
                setStatusMessage(markdownStatusMessage);

                await saveMineruParseCache({
                  item: nextResolvedItem,
                  pdfPath: resolvedSource.path,
                  sourceKind: 'sibling-json',
                  markdownText,
                }).catch(() => undefined);
              } catch {
                // Markdown fallback is best-effort. Keep the PDF open even if parsing is unavailable.
              }
            })().catch(() => undefined).finally(() => {
              generation.ifCurrent(token, () => setRestoringDocumentBlocks(false));
            });
          });

          setStatusMessage(nextStatus);
          return true;
        } catch (nextError) {
          generation.ifCurrent(token, () => {
            setPdfOpenFailed(true);
            setError(nextError instanceof Error ? nextError.message : lRef.current('打开文献失败', 'Failed to open the paper'));
            setStatusMessage(lRef.current('打开文献失败', 'Failed to open the paper'));
          });
          return false;
        } finally {
          generation.ifCurrent(token, () => setLoading(false));
        }
      },
      [
        applyMineruPages,
        onDocumentResolved,
        resetDocumentState,
        restorePdfScrollPositionsForSource,
        saveMineruParseCache,
        settings.autoLoadSiblingJson,
        settings.remotePdfDownloadDir,
        tryLoadSavedMineruPages,
      ],
    );
  const openDocumentItem = useCallback(async () => {
      const generation = documentOpenGenerationRef.current;
      const token = generation.begin();
      setPdfOpenFailed(false);
      const history = loadPaperHistory(document.workspaceId);
      const cachedPdfPath = await tryResolveSavedPdfPath(document);

      // 解析保存路径期间用户可能已切换文档或 PDF 来源。
      if (!generation.isCurrent(token)) {
        return;
      }

      const candidateLocalPaths = buildReaderLocalPdfPathCandidates({
        historyLastPdfPath: history?.lastPdfPath,
        documentLocalPdfPath: document.localPdfPath,
        remotePdfDownloadPath:
          document.attachmentKey && settings.remotePdfDownloadDir.trim()
            ? buildRemotePdfDownloadPath(settings.remotePdfDownloadDir, document)
            : null,
        cachedPdfPath,
      });

      if (candidateLocalPaths.length > 0) {
        for (const candidatePath of candidateLocalPaths) {
          const opened = await openWorkspaceDocument(
            { ...document, localPdfPath: candidatePath },
            { kind: 'local-path', path: candidatePath },
            lRef.current(`正在打开《${document.title}》`, `Opening "${document.title}"`),
            'reading',
            token,
          );

          if (opened) {
            return;
          }
        }
      }

      // 候选路径尝试期间被新的打开/切换取代：不要再进入 Zotero 兜底。
      if (!generation.isCurrent(token)) {
        return;
      }

      if (document.localPdfPath && candidateLocalPaths.length === 0) {
        await openWorkspaceDocument(
          document,
          { kind: 'local-path', path: document.localPdfPath },
          lRef.current(`正在打开《${document.title}》`, `Opening "${document.title}"`),
          'reading',
          token,
        );
        return;
      }

      if (!document.attachmentKey) {
        setPdfOpenFailed(true);
        resetDocumentState();
        setPdfSource(null);
        setPdfData(null);
        setPdfPath('');
        setCurrentDocument(document);
        setError(lRef.current('该条目没有可打开的 PDF 附件', 'This item has no PDF attachment that can be opened'));
        setStatusMessage(lRef.current('该条目没有可打开的 PDF 附件', 'This item has no PDF attachment that can be opened'));
        return;
      }

      if (!zoteroApiKey.trim()) {
        setPdfOpenFailed(true);
        resetDocumentState();
        setPdfSource(null);
        setPdfData(null);
        setPdfPath('');
        setCurrentDocument(document);
        onOpenPreferences();
        setError(
          lRef.current(
            '当前条目的本地 PDF 不存在，请先在设置中填写 Zotero Web API Key',
            'The local PDF is unavailable. Configure the Zotero Web API key in Settings first.',
          ),
        );
        setStatusMessage(lRef.current('缺少 Zotero Web API Key', 'Missing Zotero Web API key'));
        return;
      }

      setLoading(true);
      setError('');

      try {
        let userId = zoteroUserId.trim();

        if (!userId) {
          const keyInfo = await lookupZoteroKey(zoteroApiKey.trim());
          userId = keyInfo.userId;
          onZoteroUserIdChange(userId);
        }

        const remoteSource: Exclude<PdfSource, null> = {
          kind: 'remote-url',
          url: buildZoteroAttachmentPdfUrl(userId, document.attachmentKey),
          fileName: document.attachmentFilename || document.attachmentTitle || `${document.title}.pdf`,
          headers: {
            'Zotero-API-Key': zoteroApiKey.trim(),
            'Zotero-API-Version': '3',
          },
        };

        const resolvedDocument: WorkspaceItem = {
          ...document,
          localPdfPath: undefined,
        };

        await openWorkspaceDocument(
          resolvedDocument,
          remoteSource,
          lRef.current(
            `已通过 Zotero Web API 打开《${document.title}》`,
            `Opened "${document.title}" via the Zotero Web API`,
          ),
          'reading',
          token,
        );
      } catch (nextError) {
        generation.ifCurrent(token, () => {
          setPdfOpenFailed(true);
          setError(
            nextError instanceof Error
              ? nextError.message
              : lRef.current('打开 Zotero 文献失败', 'Failed to open the Zotero paper'),
          );
          setStatusMessage(lRef.current('打开 Zotero 文献失败', 'Failed to open the Zotero paper'));
        });
      } finally {
        generation.ifCurrent(token, () => setLoading(false));
      }
    }, [
      document,
      onOpenPreferences,
      onZoteroUserIdChange,
      openWorkspaceDocument,
      resetDocumentState,
      settings.remotePdfDownloadDir,
      tryResolveSavedPdfPath,
      zoteroApiKey,
      zoteroUserId,
    ]);
  const handleOpenMineruJson = useCallback(async () => {
      if (!pdfSource) {
        setStatusMessage(lRef.current('请先打开 PDF，再选择 MinerU JSON', 'Open a PDF before selecting a MinerU JSON file'));
        return;
      }

      setLoading(true);
      setError('');

      try {
        const path = await selectLocalMineruJsonPath();

        if (!path) {
          setStatusMessage(lRef.current('已取消选择 MinerU JSON', 'Cancelled MinerU JSON selection'));
          return;
        }

        const jsonText = await readLocalTextFile(path);
        const pages = await parseMineruPagesOffThread(jsonText, {
          sourcePath: path,
          onOutlineIndex: (outline) => setMineruOutlineIndex(outline),
          onSegment: (_, { allPagesSoFar, segmentIndex }) => {
            if (segmentIndex === 0 && allPagesSoFar.length > 0) {
              setMineruPages(allPagesSoFar);
              setFlatBlocks(flattenMineruPages(allPagesSoFar));
              setMineruPath(path);
            }
          },
        });

        applyMineruPages(pages, path, {
          item: currentDocument,
          pdfPath,
          pdfSource,
          statusMessage: lRef.current('已加载结构化 JSON', 'Loaded the structured JSON'),
        });
        if (currentDocument && pdfPath) {
          await saveMineruParseCache({
            item: currentDocument,
            pdfPath,
            sourceKind: 'manual-json',
            contentJsonText: jsonText,
          }).catch(() => undefined);
        }

        setStatusMessage(lRef.current('已加载结构化 JSON', 'Loaded the structured JSON'));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : lRef.current('打开 MinerU JSON 失败', 'Failed to open the MinerU JSON'));
        setStatusMessage(lRef.current('打开 MinerU JSON 失败', 'Failed to open the MinerU JSON'));
      } finally {
        setLoading(false);
      }
    }, [applyMineruPages, currentDocument, pdfPath, pdfSource, saveMineruParseCache]);
  const handlePdfBlockSelect = useCallback(
      (block: PositionedMineruBlock, context?: PdfBlockSelectContext) => {
        const contentBlock = resolveBlockContentSource(block);
        const clickedHighlight =
          context?.pdfLocation?.bbox && context.pdfLocation.pageNumber
            ? {
                blockId: block.blockId,
                pageIndex: Math.max(0, context.pdfLocation.pageNumber - 1),
                bbox: context.pdfLocation.bbox,
                bboxCoordinateSystem: context.pdfLocation.bboxCoordinateSystem,
                bboxPageSize: context.pdfLocation.bboxPageSize,
              }
            : createHighlightTarget(block);

        activateBlock(contentBlock, lRef.current(
          `已从 PDF 选中结构块 ${contentBlock.blockId}`,
          `Selected block ${contentBlock.blockId} from the PDF`,
        ), {
          syncPdfHighlight: false,
        });
        setActivePdfHighlight(clickedHighlight);

        if (
          readingViewMode !== 'pdf-only' ||
          !context ||
          !settings.enablePdfParagraphTranslationPopover
        ) {
          return;
        }

        const blockText = extractTranslatableMarkdownFromMineruBlock(contentBlock).trim().slice(0, 4_000);

        if (!blockText) {
          return;
        }

        const translatedText = blockTranslations[contentBlock.blockId]?.trim() ?? '';

        lastCapturedSelectionRef.current = null;
        autoTranslatedSelectionKeyRef.current = '';

        setSelectedExcerpt({
          text: blockText,
          source: 'pdf',
          origin: 'pdf-block',
          blockId: contentBlock.blockId,
          createdAt: Date.now(),
          anchorClientX: context.anchorClientX,
          anchorClientY: context.anchorClientY,
          anchorClientRect: context.anchorClientRect,
          placement: context.placement ?? 'bottom',
          pdfLocation: context.pdfLocation,
        });
        applySelectedExcerptTranslation(translatedText);
        setStatusMessage(
          translatedText
            ? lRef.current('已显示当前段落的缓存译文', 'Showing the cached translation for this paragraph')
            : lRef.current(
                '当前段落还没有缓存译文，可先运行全文翻译或点击立即翻译',
                'This paragraph has no cached translation yet. Run full translation first or click Translate Now.',
              ),
        );
      },
      [
        activateBlock,
        applySelectedExcerptTranslation,
        blockTranslations,
        createHighlightTarget,
        readingViewMode,
        resolveBlockContentSource,
        settings.enablePdfParagraphTranslationPopover,
      ],
    );
  const handlePdfBlockHover = useCallback((block: PositionedMineruBlock | null) => {
      setHoveredBlockId(block?.blockId ?? null);
    }, []);
  const handleBlockClick = useCallback(
      (block: PositionedMineruBlock) => {
        activateBlock(block, lRef.current(
          `已定位到右侧结构块 ${block.blockId}`,
          `Focused block ${block.blockId} in the block panel`,
        ), {
          syncBlockList: false,
        });
      },
      [activateBlock],
    );
  const runDocumentParse = useCallback(async ({ force }: { force: boolean }) => {
      if (isPaperTaskRunning(libraryOperation, 'mineru')) {
        return;
      }

      if (!pdfPath) {
        const message = lRef.current('请先打开 PDF，再调用云端解析', 'Open a PDF before starting cloud parsing');
        setStatusMessage(message);
        updateLibraryOperation('mineru', 'error', message, 100, 100);
        return;
      }

      const providerLabel = PARSE_ENGINE_LABEL;
      const missingCredential = getMissingMineruCredentialMessage(mineruApiToken);

      if (missingCredential) {
        onOpenPreferences();
        const message = lRef.current(
          `请先在设置中填写 ${providerLabel} API Token`,
          `Configure the ${providerLabel} API token in Settings first`,
        );
        setError(message);
        setStatusMessage(message);
        updateLibraryOperation('mineru', 'error', message, 100, 100);
        return;
      }

      setLoading(true);
      setError('');
      const runningMessage = force
        ? lRef.current(
            `正在重新识别（${providerLabel}，已忽略旧缓存）…`,
            `Re-parsing with ${providerLabel} (existing cache ignored)...`,
          )
        : lRef.current(
            `正在将 PDF 发送到 ${providerLabel} 云端解析…`,
            `Sending the PDF to ${providerLabel} cloud parsing...`,
          );
      setStatusMessage(runningMessage);
      updateLibraryOperation('mineru', 'running', runningMessage, 20, 100);

      const cachePaths =
        currentDocument && settings.mineruCacheDir.trim()
          ? buildMineruCachePaths(settings.mineruCacheDir.trim(), currentDocument)
          : null;

      let reparsePrepared = false;

      try {
        if (force && cachePaths) {
          await prepareMineruReparse(cachePaths.directory);
          reparsePrepared = true;
        }

        const { result, jsonText } = await runDocumentParseWithFallback({
          documentKey: currentDocument.workspaceId,
          reparse: force,
          pdfPath,
          extractDir: cachePaths?.directory,
          mineruApiToken,
          mineruApiBaseUrl: settings.mineruApiBaseUrl,
          timeoutSecs: 900,
          pollIntervalSecs: 5,
        });

        if (!jsonText) {
          throw new Error(
            lRef.current(
              `${providerLabel} 解析成功，但未返回可用的 JSON 内容`,
              `${providerLabel} parsing succeeded, but no usable JSON payload was returned.`,
            ),
          );
        }

        const pages = await parseMineruPagesOffThread(jsonText, {
          sourcePath: (result.contentJsonPath || result.middleJsonPath) ?? undefined,
          onOutlineIndex: (outline) => setMineruOutlineIndex(outline),
          onSegment: (_, { allPagesSoFar, segmentIndex }) => {
            if (segmentIndex === 0 && allPagesSoFar.length > 0) {
              setMineruPages(allPagesSoFar);
              setFlatBlocks(flattenMineruPages(allPagesSoFar));
            }
          },
        });
        let nextMineruPath =
          result.contentJsonPath || result.middleJsonPath || `cloud:${result.fileName}:${result.batchId}`;
        let nextStatusMessage = lRef.current(
          `云端解析完成，批次号 ${result.batchId}`,
          `Cloud parsing finished. Batch ID: ${result.batchId}`,
        );

        if (currentDocument) {
          const savedPaths = await saveMineruParseCache({
            item: currentDocument,
            pdfPath,
            sourceKind: 'cloud',
            contentJsonText: result.contentJsonText,
            middleJsonText: result.middleJsonText,
            markdownText: result.markdownText,
            batchId: result.batchId,
            dataId: result.dataId,
            fileName: result.fileName,
            zipEntries: result.zipEntries,
          }).catch(() => null);

          if (savedPaths) {
            nextMineruPath =
              result.contentJsonPath ||
              result.middleJsonPath ||
              (result.contentJsonText?.trim() ? savedPaths.contentJsonPath : savedPaths.middleJsonPath);
            nextStatusMessage = lRef.current(
              `已保存云端解析结果到：${savedPaths.directory}`,
              `Saved the cloud parsing output to: ${savedPaths.directory}`,
            );
          }
        }

        applyMineruPages(pages, nextMineruPath, {
          item: currentDocument,
          pdfPath,
          pdfSource,
          statusMessage: nextStatusMessage,
        });
        setStatusMessage(nextStatusMessage);
        const blockCount = flattenMineruPages(pages).length;
        updateLibraryOperation('mineru', 'success', nextStatusMessage, blockCount, blockCount || null);

        // 重新识别成功：新译文将基于新的 blockId 重新生成，可以丢弃备份代。
        if (reparsePrepared && cachePaths) {
          await finishMineruCacheReparse(cachePaths.directory, true).catch(() => undefined);
          reparsePrepared = false;
        }
      } catch (nextError) {
        const message =
          nextError instanceof Error ? nextError.message : lRef.current('云端解析失败', 'Cloud parsing failed');
        setError(message);
        setStatusMessage(lRef.current('云端解析失败', 'Cloud parsing failed'));
        updateLibraryOperation('mineru', 'error', message, 100, 100);
      } finally {
        setLoading(false);
      }
    }, [
      applyMineruPages,
      currentDocument,
      libraryOperation,
      mineruApiToken,
      onOpenPreferences,
      pdfPath,
      saveMineruParseCache,
      settings.mineruCacheDir,
      settings.mineruApiBaseUrl,
      updateLibraryOperation,
    ]);
  const handleCloudParse = useCallback(
      () => runDocumentParse({ force: false }),
      [runDocumentParse],
    );
  const handleForceReparse = useCallback(
      () => runDocumentParse({ force: true }),
      [runDocumentParse],
    );
  const pdfTextSourceKey = `${currentDocument.workspaceId}::${getPdfSourceSignature(pdfSource, pdfPath || currentPdfName)}`;
  const effect_188 = useCallback(() => {
    // PDF 身份变化即失效在途提取；旧 promise 的 then/finally 会通过 identity
    // 校验发现自己已被替换，不再回写共享缓存。
    pdfTextCacheRef.current.invalidate();
  }, [pdfTextSourceKey]);
  const loadCachedPdfDocumentText = useCallback(async () => {
      if (!pdfSource) {
        return '';
      }

      const sourceForText = pdfSource;
      const cacheKey = pdfTextSourceKey;
      const cachedText = pdfTextCacheRef.current.getCached(cacheKey);

      if (cachedText !== null) {
        return cachedText;
      }

      const pendingText = pdfTextCacheRef.current.getPending(cacheKey);
      if (pendingText) {
        return pendingText;
      }

      return pdfTextCacheRef.current.start(cacheKey, () =>
        loadPdfBinary(sourceForText)
          .then((bytes) => (bytes ? extractPdfTextByPdfJs(bytes) : '')),
      );
    }, [pdfSource, pdfTextSourceKey]);
  const legacyHandlePdfAnnotationSaveSuccess = useCallback((path: string) => {
      setStatusMessage(
        lRef.current(
          `已切换到标注后的 PDF：${path}`,
          `Switched to the annotated PDF: ${path}`,
        ),
      );
    }, []);
  const switchCurrentPdfFile = useCallback(
      async (path: string, nextStatusMessage: string) => {
        // 切换 PDF 与打开文献共享代次：让仍在恢复的旧文档/MinerU 缓存失效。
        const generation = documentOpenGenerationRef.current;
        const token = generation.begin();
        setLoading(true);
        setError('');

        try {
          const nextSource: Exclude<PdfSource, null> = { kind: 'local-path', path };

          if (!(await localPathExists(path))) {
            throw new Error(
              lRef.current(
                `PDF 文件不存在：${path}`,
                `PDF file does not exist: ${path}`,
              ),
            );
          }

          if (!generation.isCurrent(token)) {
            return;
          }

          setPdfSource(nextSource);
          setPdfData(null);
          setPdfPath(path);
          setCurrentDocument((current) => ({ ...current, localPdfPath: path }));
          setStatusMessage(nextStatusMessage);
        } catch (nextError) {
          generation.ifCurrent(token, () => {
            setError(nextError instanceof Error ? nextError.message : lRef.current('切换 PDF 失败', 'Failed to switch PDF'));
            setStatusMessage(lRef.current('切换 PDF 失败', 'Failed to switch PDF'));
          });
        } finally {
          generation.ifCurrent(token, () => setLoading(false));
        }
      },
      [],
    );
  const handlePdfAnnotationSaveSuccess = useCallback(
      (path: string) => {
        void switchCurrentPdfFile(
          path,
          lRef.current(
            `已切换到已保存的批注版 PDF：${getFileNameFromPath(path)}`,
            `Switched to the saved annotated PDF: ${getFileNameFromPath(path)}`,
          ),
        );
      },
      [switchCurrentPdfFile],
    );
  const handleOpenOriginalPdf = useCallback(() => {
      if (!originalPdfPath) {
        setStatusMessage(lRef.current('当前论文没有可切换的原始 PDF', 'No original PDF is available for this paper'));
        return;
      }

      void switchCurrentPdfFile(
        originalPdfPath,
        lRef.current(
          `已切换到原始 PDF：${getFileNameFromPath(originalPdfPath)}`,
          `Switched to the original PDF: ${getFileNameFromPath(originalPdfPath)}`,
        ),
      );
    }, [originalPdfPath, switchCurrentPdfFile]);
  const handleSelectProjectPdf = useCallback(
      (path: string) => {
        if (!path.trim()) {
          return;
        }

        if (currentLocalPdfPath && isSameLocalPath(path, currentLocalPdfPath)) {
          return;
        }

        void switchCurrentPdfFile(
          path,
          lRef.current(
            `已切换到 PDF：${getFileNameFromPath(path)}`,
            `Switched to PDF: ${getFileNameFromPath(path)}`,
          ),
        );
      },
      [currentLocalPdfPath, switchCurrentPdfFile],
    );
  const effect_246 = useCallback(() => {
    if (!currentDocument.workspaceId || !pdfSource) {
      return;
    }

    if (restoredHistoryRef.current === currentDocument.workspaceId) {
      return;
    }

    restoredHistoryRef.current = currentDocument.workspaceId;
    const history = loadPaperHistory(currentDocument.workspaceId);

    paperOpenedAtRef.current = history?.lastOpenedAt ?? Date.now();
    pendingHistoryActiveBlockIdRef.current = history?.lastActiveBlockId ?? null;

    if (!history) {
      setReadingViewMode('dual-pane');
      return;
    }

    setWorkspaceStage(history.workspaceStage);
    setReadingViewMode(history.readingViewMode);
    setPaperSummary(history.paperSummary);
    setPaperSummarySourceKey(history.paperSummarySourceKey);
    setAnnotations(history.annotations);

    if (history.paperSummary || history.annotations.length > 0) {
      setStatusMessage(lRef.current('已恢复上次阅读记录', 'Restored the last reading history'));
    }
  }, [
    currentDocument.workspaceId,
    pdfSource,
  ]);
  const effect_252 = useCallback(() => {
    const pendingBlockId = pendingHistoryActiveBlockIdRef.current;

    if (!pendingBlockId || flatBlocks.length === 0) {
      return;
    }

    const targetBlock = flatBlocks.find((block) => block.blockId === pendingBlockId);
    pendingHistoryActiveBlockIdRef.current = null;

    if (!targetBlock) {
      return;
    }

    setActiveBlockId(targetBlock.blockId);
    setBlockScrollSignal((current) => current + 1);
  }, [flatBlocks]);
  const effect_253 = useCallback(() => {
    saveCurrentPaperHistory();
  }, [saveCurrentPaperHistory]);
  const effect_254 = useCallback(() => {
    if (
      !isActive ||
      qaHistoryReadyWorkspaceRef.current !== currentDocument.workspaceId
    ) {
      return undefined;
    }

    const timer = window.setTimeout(saveCurrentPaperHistory, 300);
    return () => window.clearTimeout(timer);
  }, [
    currentDocument.workspaceId,
    isActive,
    qaSessions,
    saveCurrentPaperHistory,
    selectedQaPresetId,
    selectedQaSessionId,
  ]);
  const effect_255 = useCallback(() => {
    if (!isActive) {
      return undefined;
    }

    const handleBeforeUnload = () => forceSaveCurrentPaperHistoryRef.current();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      forceSaveCurrentPaperHistoryRef.current();
    };
  }, [currentDocument.workspaceId, isActive]);
  const handleSplitResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
      startSplitResize(event, {
        onStart: () => setIsDraggingSplitter(true),
        onMove: (moveEvent) => {
          const layoutRect = layoutRef.current?.getBoundingClientRect();

          if (!layoutRect || layoutRect.width <= 0) {
            return;
          }

          const nextRatio = clampPaneRatio(
            (moveEvent.clientX - layoutRect.left) / layoutRect.width,
          );

          latestPaneWidthRatioRef.current = nextRatio;
          setLeftPaneWidthRatio(nextRatio);
        },
        onEnd: () => {
          setIsDraggingSplitter(false);
          // 拖拽结束才落盘，拖动过程中不再逐帧写 localStorage。
          localStorage.setItem(PANE_RATIO_STORAGE_KEY, String(latestPaneWidthRatioRef.current));
        },
      });
    };

  return { activateBlock, activeBlock, activeBlockSummary, annotationSaveDirectory, applyMineruPages, applySelectedExcerptTranslation, availablePdfOptions, blockById, blockTranslations, canOpenOriginalPdf, clearSelection, compareOriginalPath, createHighlightTarget, createSelectionHighlightTarget, currentJsonName, currentLocalPdfPath, currentPdfName, currentPdfVariantLabel, documentSource, effect_152, effect_188, effect_246, effect_252, effect_253, effect_254, effect_255, effect_81, effectivePdfData, effectiveSourceKey, handleAttachTranslatedPdf, handleBlockClick, handleCancelDocumentTranslation, handleClearTranslations, handleCloudParse, handleForceReparse, handleGenerateTranslatedPdf, handleOpenMineruJson, handleOpenOriginalPdf, handlePdfAnnotationSaveSuccess, handlePdfBlockHover, handlePdfBlockSelect, handlePdfReadingHeatmapChange, handlePdfScrollPositionChange, handleRetranslateBlock, handleSelectProjectPdf, handleSplitResizeStart, handleTranslateDocument, handleTranslateSelectedExcerpt, hasDocument, legacyHandlePdfAnnotationSaveSuccess, loadCachedPdfDocumentText, mineruContentSignature, openDocumentItem, openWorkspaceDocument, originalPdfPath, pdfDocumentError, pdfPageCount, pdfReadingHeatmap, pdfScrollPosition, pdfScrollSourceKey, pdfTextSourceKey, persistPaneWidthRatio, recordLibraryReadingPosition, resetDocumentState, resetDocumentTranslationState, resetLayout, resetSelectedExcerptTranslationState, resolveBlockContentSource, restorePdfScrollPositionsForSource, runDocumentParse, saveCurrentPaperHistory, saveMineruParseCache, selectedExcerptError, selectedExcerptTranslating, selectedExcerptTranslation, selectedSectionTitle, summaryBlockInputs, switchCurrentPdfFile, translatedCount, translating, translationCancelling, translationProgressCompleted, translationProgressTotal, tryLoadSavedMineruPages, tryResolveSavedPdfPath };
}

export type ReaderDocumentApi = ReturnType<typeof useReaderDocument>;
