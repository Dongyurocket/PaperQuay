import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  prepareMineruCacheDir,
  selectDirectory,
  selectLocalPdfSource,
  selectSaveFilePath,
  approveWritePath,
  writeLocalTextFile,
} from '../../services/desktop';
import {
  listOpenAICompatibleModels,
  testOpenAICompatibleChat,
} from '../../services/llm';
import {
  extractTranslatableMarkdownFromMineruBlock,
} from '../../services/mineru';
import { resolveSummaryOutputLanguage } from '../../services/summarySource';
import {
  translateBlocksOpenAICompatible,
  translateTextOpenAICompatible,
} from '../../services/translation';
import type {
  OpenAICompatibleModelListResult,
  OpenAICompatibleTestResult,
  QaModelPreset,
  TranslationMap,
  WorkspaceItem,
} from '../../types/reader';
import type {
  LiteraturePaper,
  LiteraturePaperTaskState,
} from '../../types/library';
import { getFileNameFromPath, truncateMiddle } from '../../utils/text';
import { buildMineruCachePaths } from '../../utils/mineruCache';
import {
  createNativeLibraryWorkspaceItem,
  createStandaloneItem,
  clampBatchConcurrency,
  getModelRuntimeConfig,
  EMPTY_LIBRARY_PREVIEW_STATE,
  type BatchProgressState,
} from './readerShared';
import { emitNativePaperUpdated } from '../literature/libraryEvents';
import { updateLibraryPaper } from '../../services/library';
import { buildCitationKey, papersToBibtex, paperToBibtexEntry } from '../../utils/bibtex';
import { isPaperPipelineBusy } from './paperTaskState';
import {
  writeLibraryTranslationCache,
} from './readerLibraryPreview';
import { runMineruCloudParseWithOcrFallback } from './mineruOcrFallback';
import {
  mergeReaderTranslations,
  sanitizeTranslationErrorMessage,
  translateBlocksBestEffort,
} from './readerTranslation';
import { readTranslationCache } from './readerTranslationCache';
import type { UseReaderLibraryActionsOptions } from './readerLibraryActionTypes';
import { useReaderLibraryBatchActions } from './useReaderLibraryBatchActions';

export interface UseReaderLibraryActionsResult {
  batchMineruPaused: boolean;
  batchMineruProgress: BatchProgressState;
  batchMineruRunning: boolean;
  batchSummaryPaused: boolean;
  batchSummaryProgress: BatchProgressState;
  batchSummaryRunning: boolean;
  handleBatchGenerateSummaries: (options?: { auto?: boolean }) => Promise<void>;
  handleBatchMineruParse: (options?: { auto?: boolean }) => Promise<void>;
  handleCancelBatchMineru: () => void;
  handleCancelBatchSummary: () => void;
  handleNativeLibraryGenerateSummary: (paper: LiteraturePaper) => void;
  handleNativeLibraryMineruParse: (paper: LiteraturePaper) => void;
  handleNativeLibraryTranslate: (paper: LiteraturePaper) => void;
  handleNativeLibraryTranslatePaperTitle: (paper: LiteraturePaper) => Promise<string | null>;
  /** P1：批量翻译多选文献的标题并直接落库到 titleZh。 */
  handleBatchTranslatePaperTitles: (papers: LiteraturePaper[]) => Promise<void>;
  batchTitleTranslationRunning: boolean;
  /** P2：批量导出 Bib。mode=merged 合并为单个 .bib；mode=separate 每篇一个 .bib 文件。 */
  handleBatchExportBib: (papers: LiteraturePaper[], mode: 'merged' | 'separate') => Promise<void>;
  batchBibExportRunning: boolean;
  handleOpenNativeLibraryPaper: (paper: LiteraturePaper) => void;
  handleOpenStandalonePdf: () => Promise<void>;
  handleSelectMineruCacheDir: () => Promise<void>;
  handleSelectRemotePdfDownloadDir: () => Promise<void>;
  handleListLlmModels: (preset: QaModelPreset) => Promise<OpenAICompatibleModelListResult>;
  handleTestLlmConnection: (preset?: QaModelPreset) => Promise<OpenAICompatibleTestResult>;
  handleToggleBatchMineruPause: () => void;
  handleToggleBatchSummaryPause: () => void;
  handleWindowClose: () => void;
  handleWindowMinimize: () => void;
  handleWindowToggleMaximize: () => void;
  handleWorkspaceItemResolved: (resolvedItem: WorkspaceItem) => void;
  nativePaperActionStates: Record<string, LiteraturePaperTaskState | null | undefined>;
}

export function useReaderLibraryActions({
  allKnownItems,
  appWindow,
  configHydrated,
  createPaperTaskState,
  findExistingMineruJson,
  generateLibraryPreview,
  itemParseStatusMap,
  l,
  libraryPreviewStates,
  librarySettings,
  libraryTranslationSnapshots,
  loadLibraryPreviewBlocks,
  mineruApiToken,
  settings,
  setError,
  setLibraryPreviewStates,
  setLibraryTranslationSnapshots,
  setNativeLibraryItems,
  setPreferencesOpen,
  setPreferredPreferencesSection,
  setSelectedLibraryItemId,
  setStandaloneItems,
  setStatusMessage,
  summaryConfigured,
  syncLibraryParsedState,
  translationModelPreset,
  updateLibraryPreviewOperation,
  updateSetting,
  saveLibraryMineruParseCache,
  openTab,
}: UseReaderLibraryActionsOptions): UseReaderLibraryActionsResult {
  const nativePaperActionStates = useMemo(() => {
    const nextStates: Record<string, LiteraturePaperTaskState | null | undefined> = {};

    for (const [workspaceId, previewState] of Object.entries(libraryPreviewStates)) {
      if (!workspaceId.startsWith('native-library:')) {
        continue;
      }

      const paperId = workspaceId.slice('native-library:'.length);

      if (paperId) {
        nextStates[paperId] = previewState.operation ?? null;
      }
    }

    return nextStates;
  }, [libraryPreviewStates]);

  const handleWorkspaceItemResolved = useCallback((resolvedItem: WorkspaceItem) => {
    const mergeItem = (item: WorkspaceItem) =>
      item.workspaceId === resolvedItem.workspaceId
        ? {
            ...item,
            ...resolvedItem,
            localPdfPath: resolvedItem.localPdfPath ?? item.localPdfPath,
          }
        : item;

    setStandaloneItems((current) => current.map(mergeItem));
    setNativeLibraryItems((current) => current.map(mergeItem));
    setLibraryPreviewStates((current) => {
      const existingState = current[resolvedItem.workspaceId];

      if (!existingState || !resolvedItem.localPdfPath) {
        return current;
      }

      const nextPdfName = getFileNameFromPath(resolvedItem.localPdfPath);

      if (existingState.currentPdfName === nextPdfName) {
        return current;
      }

      return {
        ...current,
        [resolvedItem.workspaceId]: {
          ...existingState,
          currentPdfName: nextPdfName,
        },
      };
    });
  }, [setLibraryPreviewStates, setNativeLibraryItems, setStandaloneItems]);

  const saveLibraryTranslationCache = useCallback(
    async (item: WorkspaceItem, translations: TranslationMap) =>
      writeLibraryTranslationCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        translations,
      }),
    [
      settings.mineruCacheDir,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
    ],
  );

  const readExistingLibraryTranslations = useCallback(
    async (item: WorkspaceItem) =>
      readTranslationCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        targetLanguage: settings.translationTargetLanguage,
      }),
    [settings.mineruCacheDir, settings.translationTargetLanguage],
  );

  const runLibraryItemMineruParse = useCallback(
    async (item: WorkspaceItem) => {
      const pdfPath = item.localPdfPath?.trim() ?? '';

      if (!pdfPath) {
        const message = l('这篇文献缺少可解析的 PDF 文件', 'This paper has no PDF file to parse');
        setError(message);
        setStatusMessage(message);
        updateLibraryPreviewOperation(
          item,
          createPaperTaskState('mineru', 'error', message, 100, 100),
          {
            loading: false,
            error: message,
            statusMessage: message,
          },
        );
        return;
      }

      setError('');
      setLibraryPreviewStates((current) => ({
        ...current,
        [item.workspaceId]: {
          ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          loading: true,
          error: '',
          operation: createPaperTaskState(
            'mineru',
            'running',
            l('正在执行 MinerU 解析...', 'Running MinerU parsing...'),
            10,
            100,
          ),
          currentPdfName: getFileNameFromPath(pdfPath),
          statusMessage: l('正在执行 MinerU 解析...', 'Running MinerU parsing...'),
        },
      }));
      setStatusMessage(l(`正在解析：${item.title}`, `Parsing: ${item.title}`));

      try {
        const existingParse = await findExistingMineruJson(item);

        if (existingParse) {
          const parsedState = syncLibraryParsedState(
            item,
            existingParse.jsonText,
            existingParse.path,
            l('已复用已有的 MinerU 结果', 'Reused the existing MinerU result'),
          );
          updateLibraryPreviewOperation(
            item,
            createPaperTaskState(
              'mineru',
              'success',
              l('已复用已有的 MinerU 解析结果', 'Reused the existing MinerU parse result'),
              parsedState.blocks.length,
              parsedState.blocks.length || null,
            ),
            {
              loading: false,
              error: '',
            },
          );
          window.dispatchEvent(
            new CustomEvent('paperquay:native-mineru-status-updated', {
              detail: {
                paperId: item.itemKey,
                mineruParsed: true,
              },
            }),
          );
          setStatusMessage(l('已复用已有的 MinerU 解析结果', 'Reused the existing MinerU parse result'));
          return;
        }

        if (!mineruApiToken.trim()) {
          setPreferredPreferencesSection('mineru');
          setPreferencesOpen(true);
          throw new Error(l('缺少 MinerU API Token', 'MinerU API Token is missing'));
        }

        updateLibraryPreviewOperation(
          item,
          createPaperTaskState(
            'mineru',
            'running',
            l(
              '已提交 MinerU 云端任务，正在等待解析结果...',
              'Submitted the MinerU cloud task. Waiting for the parse result...',
            ),
            35,
            100,
          ),
          {
            loading: true,
            error: '',
            statusMessage: l(
              '已提交 MinerU 云端任务，正在等待解析结果...',
              'Submitted the MinerU cloud task. Waiting for the parse result...',
            ),
          },
        );

        const cachePaths = settings.mineruCacheDir.trim()
          ? buildMineruCachePaths(settings.mineruCacheDir.trim(), item)
          : null;
        const parseResult = await runMineruCloudParseWithOcrFallback({
          apiToken: mineruApiToken.trim(),
          apiBaseUrl: settings.mineruApiBaseUrl,
          pdfPath,
          extractDir: cachePaths?.directory,
          language: 'ch',
          modelVersion: 'vlm',
          enableFormula: true,
          enableTable: true,
          isOcr: false,
          timeoutSecs: 900,
          pollIntervalSecs: 5,
        }, () => {
          updateLibraryPreviewOperation(
            item,
            createPaperTaskState(
              'mineru',
              'running',
              l('普通解析没有得到可用结构，正在切换 OCR 模式重试...', 'No usable structure was returned. Retrying with OCR mode...'),
              55,
              100,
            ),
            {
              loading: true,
              error: '',
              statusMessage: l('正在切换 OCR 模式重试...', 'Retrying with OCR mode...'),
            },
          );
        });
        const { result, jsonText, usedOcr } = parseResult;

        if (!jsonText?.trim()) {
          throw new Error(l('MinerU 未返回可用的 JSON 结果', 'MinerU did not return a usable JSON result'));
        }

        const savedPaths = await saveLibraryMineruParseCache({
          item,
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
        const resolvedJsonPath =
          result.contentJsonPath ||
          result.middleJsonPath ||
          (savedPaths
            ? result.contentJsonText?.trim()
              ? savedPaths.contentJsonPath
              : savedPaths.middleJsonPath
            : 'content_list_v2.json');

        const parsedState = syncLibraryParsedState(
          item,
          jsonText,
          resolvedJsonPath,
          savedPaths
            ? l(
                `已完成 MinerU 解析并写入缓存：${savedPaths.directory}`,
                `MinerU parsing finished and was cached in: ${savedPaths.directory}`,
              )
            : l('已完成 MinerU 解析', 'MinerU parsing finished'),
        );
        updateLibraryPreviewOperation(
          item,
          createPaperTaskState(
            'mineru',
            'success',
            l('MinerU 解析已完成', 'MinerU parsing finished'),
            parsedState.blocks.length,
            parsedState.blocks.length || null,
          ),
          {
            loading: false,
            error: '',
          },
        );
        window.dispatchEvent(
          new CustomEvent('paperquay:native-mineru-status-updated', {
            detail: {
              paperId: item.itemKey,
              mineruParsed: true,
            },
          }),
        );
        setStatusMessage(l('MinerU 解析已完成', 'MinerU parsing finished'));
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('MinerU 解析失败', 'MinerU parsing failed');
        setError(message);
        setStatusMessage(message);
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
            loading: false,
            error: message,
            operation: createPaperTaskState('mineru', 'error', message, 100, 100),
            statusMessage: message,
          },
        }));
      }
    },
    [
      createPaperTaskState,
      findExistingMineruJson,
      l,
      mineruApiToken,
      saveLibraryMineruParseCache,
      setError,
      setLibraryPreviewStates,
      setPreferencesOpen,
      setPreferredPreferencesSection,
      setStatusMessage,
      settings.mineruCacheDir,
      settings.mineruApiBaseUrl,
      syncLibraryParsedState,
      updateLibraryPreviewOperation,
    ],
  );

  const runLibraryItemTranslation = useCallback(
    async (item: WorkspaceItem) => {
      if (!translationModelPreset?.apiKey.trim() || !translationModelPreset.baseUrl.trim()) {
        setPreferredPreferencesSection('models');
        setPreferencesOpen(true);
        const message = l('请先配置可用的翻译模型', 'Configure an available translation model first');
        setError(message);
        setStatusMessage(message);
        updateLibraryPreviewOperation(
          item,
          createPaperTaskState('translation', 'error', message, 100, 100),
          {
            loading: false,
            error: message,
            statusMessage: message,
          },
        );
        return;
      }

      setError('');
      setLibraryPreviewStates((current) => ({
        ...current,
        [item.workspaceId]: {
          ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          loading: true,
          error: '',
          operation: createPaperTaskState(
            'translation',
            'running',
            l('正在准备全文翻译...', 'Preparing full-document translation...'),
            0,
            null,
          ),
          statusMessage: l('正在准备全文翻译...', 'Preparing full-document translation...'),
        },
      }));
      setStatusMessage(l(`正在准备翻译：${item.title}`, `Preparing translation: ${item.title}`));

      try {
        const previewContext = await loadLibraryPreviewBlocks(item);
        const blocksToTranslate = previewContext.blocks
          .map((block) => ({
            blockId: block.blockId,
            text: extractTranslatableMarkdownFromMineruBlock(block),
          }))
          .filter((block) => block.text.trim().length > 0);

        if (blocksToTranslate.length === 0) {
          throw new Error(
            l(
              '当前没有可翻译的结构化文本，请先执行 MinerU 解析。',
              'There is no structured text to translate. Run MinerU parsing first.',
            ),
          );
        }

        updateLibraryPreviewOperation(
          item,
          createPaperTaskState(
            'translation',
            'running',
            l(
              `正在翻译 ${blocksToTranslate.length} 个结构块`,
              `Translating ${blocksToTranslate.length} structured blocks`,
            ),
            0,
            blocksToTranslate.length,
          ),
          {
            loading: true,
            error: '',
            hasBlocks: previewContext.blocks.length > 0,
            blockCount: previewContext.blocks.length,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: l(
              `正在翻译 ${blocksToTranslate.length} 个结构块`,
              `Translating ${blocksToTranslate.length} structured blocks`,
            ),
          },
        );

        const batchSize = Math.max(1, settings.translationBatchSize);
        const concurrency = Math.max(1, settings.translationConcurrency);
        const cachedTranslationResult = await readExistingLibraryTranslations(item).catch(
          () => null,
        );
        const currentSnapshot = libraryTranslationSnapshots[item.workspaceId] ?? null;
        const resumedTranslations = mergeReaderTranslations(
          cachedTranslationResult?.translations,
          currentSnapshot?.translations,
        );
        const resumedCount = Object.keys(resumedTranslations).length;

        if (resumedCount > 0) {
          setLibraryTranslationSnapshots((current) => ({
            ...current,
            [item.workspaceId]: {
              targetLanguage: settings.translationTargetLanguage,
              translations: resumedTranslations,
              updatedAt: Date.now(),
            },
          }));
        }

        const result = await translateBlocksBestEffort({
          apiKey: translationModelPreset.apiKey.trim(),
          apiMode: translationModelPreset.apiMode,
          baseUrl: translationModelPreset.baseUrl,
          batchSize,
          blocks: blocksToTranslate,
          concurrency,
          existingTranslations: resumedTranslations,
          model: translationModelPreset.model,
          onProgress: async (progress) => {
            setLibraryTranslationSnapshots((current) => ({
              ...current,
              [item.workspaceId]: {
                targetLanguage: settings.translationTargetLanguage,
                translations: progress.translations,
                updatedAt: Date.now(),
              },
            }));

            if (Object.keys(progress.translations).length > 0) {
              try {
                await saveLibraryTranslationCache(item, progress.translations);
              } catch (cacheError) {
                console.warn('Failed to save library translation cache', cacheError);
              }
            }

            const progressMessage = l(
              `正在翻译 ${progress.translatedCount}/${progress.totalBlocks} 个块`,
              `Translating ${progress.translatedCount}/${progress.totalBlocks} blocks`,
            );

            setStatusMessage(progressMessage);
            updateLibraryPreviewOperation(
              item,
              createPaperTaskState(
                'translation',
                'running',
                progressMessage,
                progress.translatedCount,
                progress.totalBlocks,
              ),
              {
                loading: true,
                error: '',
                statusMessage: progressMessage,
              },
            );
          },
          reasoningEffort: getModelRuntimeConfig(settings, 'translation').reasoningEffort,
          requestsPerMinute: settings.translationRequestsPerMinute,
          sourceLanguage: settings.translationSourceLanguage,
          targetLanguage: settings.translationTargetLanguage,
          temperature: getModelRuntimeConfig(settings, 'translation').temperature,
          translateBatch: translateBlocksOpenAICompatible,
        });
        const translations = result.translations;

        setLibraryTranslationSnapshots((current) => ({
          ...current,
          [item.workspaceId]: {
            targetLanguage: settings.translationTargetLanguage,
            translations,
            updatedAt: Date.now(),
          },
        }));

        let cacheStatusSuffix = '';

        try {
          const savedCachePath = await saveLibraryTranslationCache(item, translations);

          if (!savedCachePath) {
            cacheStatusSuffix = l('，仅保存在当前会话', ', kept in the current session only');
          }
        } catch (cacheError) {
          cacheStatusSuffix = l(
            '，缓存写入失败，已保存在当前会话',
            ', cache write failed and the result is kept in the current session',
          );
          console.warn('Failed to save library translation cache', cacheError);
        }

        const translatedCount = Object.keys(translations).length;
        const failedCount = result.failedBlocks.length;
        const translationFinishedMessage =
          failedCount > 0
            ? l(
                `全文翻译已部分完成，已保存 ${translatedCount} 段译文，剩余 ${failedCount} 段可稍后重试${cacheStatusSuffix}`,
                `Full translation partially completed. Saved ${translatedCount} translated blocks, with ${failedCount} remaining for retry${cacheStatusSuffix}`,
              )
            : l(
                `全文翻译完成，已生成 ${translatedCount} 段译文${cacheStatusSuffix}`,
                `Full translation complete. Generated ${translatedCount} translated blocks${cacheStatusSuffix}`,
              );

        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
            loading: false,
            error:
              failedCount > 0
                ? sanitizeTranslationErrorMessage(
                    result.failureMessages[0],
                    l,
                    'document',
                  )
                : '',
            operation: createPaperTaskState(
              'translation',
              failedCount > 0 ? 'error' : 'success',
              translationFinishedMessage,
              translatedCount,
              blocksToTranslate.length,
            ),
            hasBlocks: previewContext.blocks.length > 0,
            blockCount: previewContext.blocks.length,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: translationFinishedMessage,
          },
        }));
        setStatusMessage(translationFinishedMessage);
      } catch (nextError) {
        const message = sanitizeTranslationErrorMessage(nextError, l, 'document');
        setError(message);
        setStatusMessage(message);
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
            loading: false,
            error: message,
            operation: createPaperTaskState('translation', 'error', message, 100, 100),
            statusMessage: message,
          },
        }));
      }
    },
    [
      createPaperTaskState,
      l,
      loadLibraryPreviewBlocks,
      saveLibraryTranslationCache,
      setError,
      setLibraryPreviewStates,
      setLibraryTranslationSnapshots,
      setPreferencesOpen,
      setPreferredPreferencesSection,
      setStatusMessage,
      settings,
      translationModelPreset,
      updateLibraryPreviewOperation,
      libraryTranslationSnapshots,
      readExistingLibraryTranslations,
    ],
  );
  const {
    batchMineruPaused,
    batchMineruProgress,
    batchMineruRunning,
    batchSummaryPaused,
    batchSummaryProgress,
    batchSummaryRunning,
    handleBatchGenerateSummaries,
    handleBatchMineruParse,
    handleCancelBatchMineru,
    handleCancelBatchSummary,
    handleToggleBatchMineruPause,
    handleToggleBatchSummaryPause,
  } = useReaderLibraryBatchActions({
    allKnownItems,
    configHydrated,
    findExistingMineruJson,
    generateLibraryPreview,
    itemParseStatusMap,
    l,
    mineruApiToken,
    saveLibraryMineruParseCache,
    setError,
    setPreferencesOpen,
    setStatusMessage,
    settings,
    summaryConfigured,
    syncLibraryParsedState,
  });

  const handleOpenStandalonePdf = useCallback(async () => {
    setError('');

    try {
      const source = await selectLocalPdfSource();

      if (!source || source.kind !== 'local-path') {
        setStatusMessage(l('未选择 PDF 文件', 'No PDF file selected'));
        return;
      }

      const standaloneItem = createStandaloneItem(source.path, settings.uiLanguage);

      setStandaloneItems((current) => {
        const existingItems = current.filter(
          (item) => item.workspaceId !== standaloneItem.workspaceId,
        );
        return [standaloneItem, ...existingItems];
      });
      setSelectedLibraryItemId(standaloneItem.workspaceId);
      openTab(standaloneItem.workspaceId, standaloneItem.title);
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('打开独立 PDF 失败', 'Failed to open the standalone PDF');
      setError(message);
      setStatusMessage(message);
    }
  }, [l, openTab, setError, setSelectedLibraryItemId, setStandaloneItems, setStatusMessage, settings.uiLanguage]);

  const registerNativeLibraryWorkspace = useCallback(
    (
      paper: LiteraturePaper,
      options?: {
        select?: boolean;
      },
    ) => {
      const workspaceItem = createNativeLibraryWorkspaceItem(paper, librarySettings?.storageDir);

      if (!workspaceItem) {
        const message = l('这篇文献缺少可打开的 PDF 附件', 'This paper has no openable PDF attachment');
        setError(message);
        setStatusMessage(message);
        return;
      }

      setNativeLibraryItems((current) => {
        const existingItems = current.filter((item) => item.workspaceId !== workspaceItem.workspaceId);
        return [workspaceItem, ...existingItems];
      });

      if (options?.select ?? true) {
        setSelectedLibraryItemId(workspaceItem.workspaceId);
      }

      return workspaceItem;
    },
    [l, librarySettings?.storageDir, setError, setNativeLibraryItems, setSelectedLibraryItemId, setStatusMessage],
  );

  const openNativeLibraryWorkspace = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = registerNativeLibraryWorkspace(paper);

      if (!workspaceItem) {
        return;
      }

      const tabId = openTab(workspaceItem.workspaceId, workspaceItem.title);

      return { workspaceItem, tabId };
    },
    [openTab, registerNativeLibraryWorkspace],
  );

  const handleOpenNativeLibraryPaper = useCallback(
    (paper: LiteraturePaper) => {
      openNativeLibraryWorkspace(paper);
    },
    [openNativeLibraryWorkspace],
  );

  const triggerNativeLibraryReaderAction = useCallback(
    (paper: LiteraturePaper): WorkspaceItem | null => {
      const existingOperation = nativePaperActionStates[paper.id] ?? null;

      if (isPaperPipelineBusy(existingOperation)) {
        setStatusMessage(
          l(
            '当前文献已有任务正在执行，请等待本轮处理完成。',
            'A task is already running for this paper. Wait for it to finish first.',
          ),
        );
        return null;
      }

      return registerNativeLibraryWorkspace(paper, { select: false }) ?? null;
    },
    [l, nativePaperActionStates, registerNativeLibraryWorkspace, setStatusMessage],
  );

  const handleNativeLibraryMineruParse = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = triggerNativeLibraryReaderAction(paper);

      if (!workspaceItem) {
        return;
      }

      void runLibraryItemMineruParse(workspaceItem);
    },
    [runLibraryItemMineruParse, triggerNativeLibraryReaderAction],
  );

  const handleNativeLibraryTranslate = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = triggerNativeLibraryReaderAction(paper);

      if (!workspaceItem) {
        return;
      }

      void runLibraryItemTranslation(workspaceItem);
    },
    [runLibraryItemTranslation, triggerNativeLibraryReaderAction],
  );

  const handleNativeLibraryGenerateSummary = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = triggerNativeLibraryReaderAction(paper);

      if (!workspaceItem) {
        return;
      }

      void generateLibraryPreview(workspaceItem, true);
    },
    [generateLibraryPreview, triggerNativeLibraryReaderAction],
  );

  const handleNativeLibraryTranslatePaperTitle = useCallback(
    async (paper: LiteraturePaper): Promise<string | null> => {      const sourceTitle = paper.title.trim();

      if (!sourceTitle) {
        return null;
      }

      if (!translationModelPreset?.apiKey.trim() || !translationModelPreset.baseUrl.trim()) {
        setPreferredPreferencesSection('models');
        setPreferencesOpen(true);
        const message = l('请先配置可用的翻译模型', 'Configure an available translation model first');
        setError(message);
        setStatusMessage(message);
        return null;
      }

      setError('');
      setStatusMessage(
        l(`正在翻译标题：${sourceTitle}`, `Translating title: ${sourceTitle}`),
      );

      try {
        const translated = (
          await translateTextOpenAICompatible({
            baseUrl: translationModelPreset.baseUrl,
            apiKey: translationModelPreset.apiKey.trim(),
            model: translationModelPreset.model,
            apiMode: translationModelPreset.apiMode,
            sourceLanguage: settings.translationSourceLanguage,
            targetLanguage: 'Simplified Chinese',
            text: sourceTitle,
          })
        ).trim();

        if (!translated) {
          throw new Error(
            l('翻译接口没有返回可用内容', 'The translation endpoint returned no usable content'),
          );
        }

        setError('');
        setStatusMessage(
          l('标题翻译完成，确认后请保存文献信息。', 'Title translated. Save the paper to apply it.'),
        );
        return translated;
      } catch (nextError) {
        const message = nextError instanceof Error
          ? nextError.message
          : l('标题翻译失败', 'Failed to translate the title');
        setError(message);
        setStatusMessage(message);
        return null;
      }
    },
    [
      l,
      setError,
      setPreferencesOpen,
      setPreferredPreferencesSection,
      setStatusMessage,
      settings.translationSourceLanguage,
      translationModelPreset,
    ],
  );

  // P1：批量标题翻译。复用翻译模型 preset，逐篇翻译并直接落库 titleZh；
  // 默认跳过已有中文标题的文献，失败项不中断整体批次。
  const [batchTitleTranslationRunning, setBatchTitleTranslationRunning] = useState(false);

  const handleBatchTranslatePaperTitles = useCallback(
    async (papers: LiteraturePaper[]) => {
      if (batchTitleTranslationRunning) {
        return;
      }

      const candidates = papers.filter((paper) => paper.title.trim() && !paper.titleZh?.trim());
      const skippedCount = papers.length - candidates.length;

      if (candidates.length === 0) {
        setStatusMessage(
          l(
            '选中文献已有中文标题或缺少标题，无需翻译。',
            'Selected papers already have translated titles or have no title to translate.',
          ),
        );
        return;
      }

      if (!translationModelPreset?.apiKey.trim() || !translationModelPreset.baseUrl.trim()) {
        setPreferredPreferencesSection('models');
        setPreferencesOpen(true);
        const message = l('请先配置可用的翻译模型', 'Configure an available translation model first');
        setError(message);
        setStatusMessage(message);
        return;
      }

      setBatchTitleTranslationRunning(true);
      setError('');

      const concurrency = clampBatchConcurrency(settings.libraryBatchConcurrency);
      let cursor = 0;
      let succeededCount = 0;
      let failedCount = 0;

      const runWorker = async () => {
        while (true) {
          const currentIndex = cursor;
          cursor += 1;

          if (currentIndex >= candidates.length) {
            return;
          }

          const paper = candidates[currentIndex];
          setStatusMessage(
            l(
              `批量翻译标题中：${currentIndex + 1}/${candidates.length} ${truncateMiddle(paper.title, 48)}`,
              `Translating titles: ${currentIndex + 1}/${candidates.length} ${truncateMiddle(paper.title, 48)}`,
            ),
          );

          try {
            const translated = (
              await translateTextOpenAICompatible({
                baseUrl: translationModelPreset.baseUrl,
                apiKey: translationModelPreset.apiKey.trim(),
                model: translationModelPreset.model,
                apiMode: translationModelPreset.apiMode,
                sourceLanguage: settings.translationSourceLanguage,
                targetLanguage: 'Simplified Chinese',
                text: paper.title.trim(),
              })
            ).trim();

            if (!translated) {
              throw new Error('empty translation');
            }

            const updatedPaper = await updateLibraryPaper({ paperId: paper.id, titleZh: translated });
            emitNativePaperUpdated(updatedPaper);
            succeededCount += 1;
          } catch {
            failedCount += 1;
          }
        }
      };

      try {
        await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

        const doneMessage = failedCount > 0
          ? l(
            `标题翻译完成：成功 ${succeededCount} 篇，失败 ${failedCount} 篇，跳过 ${skippedCount} 篇。`,
            `Title translation finished: ${succeededCount} succeeded, ${failedCount} failed, ${skippedCount} skipped.`,
          )
          : l(
            `标题翻译完成：成功 ${succeededCount} 篇，跳过 ${skippedCount} 篇。`,
            `Title translation finished: ${succeededCount} succeeded, ${skippedCount} skipped.`,
          );
        setStatusMessage(doneMessage);

        if (failedCount > 0) {
          setError(doneMessage);
        }
      } finally {
        setBatchTitleTranslationRunning(false);
      }
    },
    [
      batchTitleTranslationRunning,
      l,
      setError,
      setPreferencesOpen,
      setPreferredPreferencesSection,
      setStatusMessage,
      settings.libraryBatchConcurrency,
      settings.translationSourceLanguage,
      translationModelPreset,
    ],
  );

  // P2：批量导出 Bib。两种形态：合并为单个 .bib 文件（merged）或每篇一个 .bib 文件（separate）。
  const [batchBibExportRunning, setBatchBibExportRunning] = useState(false);

  const handleBatchExportBib = useCallback(
    async (papers: LiteraturePaper[], mode: 'merged' | 'separate') => {
      if (batchBibExportRunning) {
        return;
      }

      const exportable = papers.filter((paper) => paper.title.trim());

      if (exportable.length === 0) {
        setStatusMessage(
          l('选中文献没有可导出的标题信息。', 'Selected papers have no title information to export.'),
        );
        return;
      }

      setBatchBibExportRunning(true);
      setError('');

      try {
        if (mode === 'merged') {
          const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const targetPath = await selectSaveFilePath({
            suggestedFileName: `library-${dateStamp}.bib`,
            filterName: 'BibTeX',
            extensions: ['bib'],
          });

          if (!targetPath) {
            return;
          }

          await writeLocalTextFile(targetPath, papersToBibtex(exportable));
          setStatusMessage(
            l(
              `已导出 ${exportable.length} 篇文献的 Bib 到：${targetPath}`,
              `Exported ${exportable.length} papers to ${targetPath}`,
            ),
          );
          return;
        }

        const targetDir = await selectDirectory(
          l('选择 Bib 导出目录', 'Choose Bib export directory'),
        );

        if (!targetDir) {
          return;
        }

        const usedKeys = new Set<string>();
        let succeededCount = 0;
        let failedCount = 0;

        for (const paper of exportable) {
          const citationKey = buildCitationKey(paper, usedKeys);
          const filePath = `${targetDir}${targetDir.includes('\\') ? '\\' : '/'}${citationKey}.bib`;

          try {
            await approveWritePath(filePath);
            await writeLocalTextFile(filePath, `${paperToBibtexEntry(paper, { citationKey }, usedKeys)}\n`);
            succeededCount += 1;
          } catch {
            failedCount += 1;
          }
        }

        const doneMessage = failedCount > 0
          ? l(
            `Bib 导出完成：成功 ${succeededCount} 篇，失败 ${failedCount} 篇。目录：${targetDir}`,
            `Bib export finished: ${succeededCount} succeeded, ${failedCount} failed. Directory: ${targetDir}`,
          )
          : l(
            `已导出 ${succeededCount} 个 Bib 文件到：${targetDir}`,
            `Exported ${succeededCount} Bib files to ${targetDir}`,
          );
        setStatusMessage(doneMessage);

        if (failedCount > 0) {
          setError(doneMessage);
        }
      } catch (nextError) {
        const message = nextError instanceof Error
          ? nextError.message
          : l('导出 Bib 失败', 'Failed to export Bib');
        setError(message);
        setStatusMessage(message);
      } finally {
        setBatchBibExportRunning(false);
      }
    },
    [batchBibExportRunning, l, setError, setStatusMessage],
  );

  const handleWindowMinimize = useCallback(() => {
    void appWindow.minimize().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : '窗口最小化失败';
      setError(message);
      setStatusMessage(message);
    });
  }, [appWindow, setError, setStatusMessage]);

  const handleWindowToggleMaximize = useCallback(() => {
    void appWindow.toggleMaximize().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : '窗口缩放失败';
      setError(message);
      setStatusMessage(message);
    });
  }, [appWindow, setError, setStatusMessage]);

  const handleWindowClose = useCallback(() => {
    void appWindow.close().catch((nextError) => {
      const message =
        nextError instanceof Error ? nextError.message : l('关闭窗口失败', 'Failed to close the window');
      setError(message);
      setStatusMessage(message);
    });
  }, [appWindow, l, setError, setStatusMessage]);

  const handleSelectMineruCacheDir = useCallback(async () => {
    try {
      const selectedDir = await selectDirectory(
        l('选择 MinerU 缓存目录', 'Select the MinerU cache directory'),
      );

      if (!selectedDir) {
        setStatusMessage(l('未选择 MinerU 缓存目录', 'No MinerU cache directory selected'));
        return;
      }

      const previousDir = settings.mineruCacheDir.trim();
      const prepared = await prepareMineruCacheDir(selectedDir, previousDir);
      const preparedDir = prepared.directory || selectedDir;

      setStatusMessage(
        [
          l(
            `已更新 MinerU 缓存目录：${truncateMiddle(preparedDir, 48)}`,
            `Updated the MinerU cache directory: ${truncateMiddle(preparedDir, 48)}`,
          ),
          prepared.migratedCount > 0
            ? l(
                `已迁移 ${prepared.migratedCount} 个旧缓存目录`,
                `Migrated ${prepared.migratedCount} existing cache folder(s)`,
              )
            : '',
          prepared.looseOutputFilesIgnored
            ? l(
                '所选根目录中的裸 MinerU 输出文件已保留但不会被直接当作缓存解析',
                'Loose MinerU output files in the selected root were kept but will not be parsed as cache',
              )
            : '',
          prepared.errors.length > 0
            ? l(
                `有 ${prepared.errors.length} 个旧缓存目录迁移失败`,
                `${prepared.errors.length} old cache folder(s) failed to migrate`,
              )
            : '',
        ].filter(Boolean).join('；'),
      );
      updateSetting('mineruCacheDir', preparedDir);
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l(
              '选择 MinerU 缓存目录失败',
              'Failed to select the MinerU cache directory',
            );
      setError(message);
      setStatusMessage(message);
    }
  }, [l, setError, setStatusMessage, settings.mineruCacheDir, updateSetting]);

  const handleSelectRemotePdfDownloadDir = useCallback(async () => {
    try {
      const selectedDir = await selectDirectory(
        l('选择远程 PDF 下载目录', 'Select the remote PDF download directory'),
      );

      if (!selectedDir) {
        setStatusMessage(
          l('未选择远程 PDF 下载目录', 'No remote PDF download directory selected'),
        );
        return;
      }

      updateSetting('remotePdfDownloadDir', selectedDir);
      setStatusMessage(
        l(
          `已更新远程 PDF 下载目录：${truncateMiddle(selectedDir, 48)}`,
          `Updated the remote PDF download directory: ${truncateMiddle(selectedDir, 48)}`,
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l(
              '选择远程 PDF 下载目录失败',
              'Failed to select the remote PDF download directory',
            );
      setError(message);
      setStatusMessage(message);
    }
  }, [l, setError, setStatusMessage, updateSetting]);

  const handleTestLlmConnection = useCallback(
    async (
      preset?: QaModelPreset,
    ): Promise<OpenAICompatibleTestResult> => {
      setError('');
      setStatusMessage(l('正在测试 AI 接口连接...', 'Testing the AI endpoint connection...'));

      try {
        const targetPreset = preset ?? translationModelPreset;

        if (!targetPreset) {
          throw new Error(
            l(
              '没有可用于测试的模型预设，请先完成模型配置。',
              'No model preset is available for testing. Configure a model first.',
            ),
          );
        }

        const result = await testOpenAICompatibleChat({
          baseUrl: targetPreset.baseUrl,
          apiKey: targetPreset.apiKey.trim(),
          model: targetPreset.model,
          apiMode: targetPreset.apiMode,
        });

        if (result.ok) {
          setError('');
          setStatusMessage(
            l(
              `AI 接口连接成功：${result.responseModel || result.model}`,
              `AI endpoint connected: ${result.responseModel || result.model}`,
            ),
          );
        } else {
          setError(result.message);
          setStatusMessage(
            l(`AI 接口连接失败：${result.message}`, `AI endpoint connection failed: ${result.message}`),
          );
        }

        return result;
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('测试 AI 接口失败', 'Failed to test the AI endpoint');

        setError(message);
        setStatusMessage(message);
        throw nextError;
      }
    },
    [l, setError, setStatusMessage, translationModelPreset],
  );

  const handleListLlmModels = useCallback(
    async (preset: QaModelPreset): Promise<OpenAICompatibleModelListResult> => {
      setError('');
      setStatusMessage(l('正在读取模型列表...', 'Loading model list...'));

      try {
        if (!preset.baseUrl.trim()) {
          throw new Error(
            l(
              '请先填写模型服务 Base URL，再读取模型列表。',
              'Fill in the model service Base URL before loading the model list.',
            ),
          );
        }

        const result = await listOpenAICompatibleModels({
          baseUrl: preset.baseUrl,
          apiKey: preset.apiKey.trim(),
        });

        setError('');
        setStatusMessage(
          l(
            `已读取 ${result.models.length} 个模型`,
            `Loaded ${result.models.length} models`,
          ),
        );

        return result;
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('读取模型列表失败', 'Failed to load the model list');

        setError(message);
        setStatusMessage(message);
        throw nextError;
      }
    },
    [l, setError, setStatusMessage],
  );

  return {
    batchMineruPaused,
    batchMineruProgress,
    batchMineruRunning,
    batchSummaryPaused,
    batchSummaryProgress,
    batchSummaryRunning,
    handleBatchGenerateSummaries,
    handleBatchMineruParse,
    handleCancelBatchMineru,
    handleCancelBatchSummary,
    handleNativeLibraryGenerateSummary,
    handleNativeLibraryMineruParse,
    handleNativeLibraryTranslate,
    handleNativeLibraryTranslatePaperTitle,
    handleBatchTranslatePaperTitles,
    batchTitleTranslationRunning,
    handleBatchExportBib,
    batchBibExportRunning,
    handleOpenNativeLibraryPaper,
    handleOpenStandalonePdf,
    handleSelectMineruCacheDir,
    handleSelectRemotePdfDownloadDir,
    handleListLlmModels,
    handleTestLlmConnection,
    handleToggleBatchMineruPause,
    handleToggleBatchSummaryPause,
    handleWindowClose,
    handleWindowMinimize,
    handleWindowToggleMaximize,
    handleWorkspaceItemResolved,
    nativePaperActionStates,
  };
}
