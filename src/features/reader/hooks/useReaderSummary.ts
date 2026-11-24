import { useCallback, useMemo } from 'react';
import { shouldReadOverviewCache } from '../overview/overviewTaskState';
import {
  readLocalTextFileIfExists,
} from '../../../services/desktop';
import { summarizeDocumentOpenAICompatible } from '../../../services/summary';
import {
  buildMineruMarkdownDocument,
  resolveSummaryOutputLanguage,
  SUMMARY_PROMPT_VERSION,
} from '../../../services/summarySource';
import {
  isPaperTaskRunning,
} from '../paperTaskState';
import type {
  PaperSummary,
  WorkspaceItem,
} from '../../../types/reader';
import { getPdfSourceSignature } from '../../pdf/pdfDocumentSource';
import {
  LibraryPreviewSyncPayload,
} from '../documentReaderShared';
import {
  getModelRuntimeConfig,
} from '../readerShared';
import {
  writePreviewSummaryCache,
} from '../readerLibraryPreview';
import {
  loadSavedSummaryCache,
} from '../documentReaderCache';
import {
  buildLegacyPaperSummarySourceKeys,
  buildPaperSummarySourceKey,
  loadMineruMarkdownDocument,
  resolveMineruMarkdownCandidatePaths,
} from '../documentReaderSummarySource';
import {
  previewSummarySyncField,
  resolveSummaryModelConfigIssue,
  shouldAutoLoadCachedSummary,
  shouldUsePreviewSummaryFallback,
} from '../paperSummaryAutoLoad';



import type { ReaderTabState } from './readerTabContext';
import type { ReaderDocumentApi } from './useReaderDocument';

export function useReaderSummary(state: ReaderTabState, documentApi: ReaderDocumentApi) {
  const { autoSummarySourceKeyRef, cachedSummaryAttemptKeyRef, cachedSummaryRequestIdRef, currentDocument, flatBlocks, lRef, libraryOperation, libraryPreviewSummary, mineruPath, onLibraryPreviewSync, onOpenPreferences, paperSummary, paperSummaryError, paperSummaryLoading, paperSummarySourceKey, pdfPath, pdfSource, setPaperSummary, setPaperSummaryError, setPaperSummaryLoading, setPaperSummarySourceKey, setStatusMessage, setSummaryCacheLoading, settings, statusMessage, summaryCacheWriter, summaryConfigured, summaryModelPreset, summaryRequestIdRef, updateLibraryOperation } = state;
  const { currentJsonName, currentPdfName, loadCachedPdfDocumentText, mineruContentSignature, summaryBlockInputs } = documentApi;

  const paperSummaryNextSourceKey = useMemo(() => {
      return buildPaperSummarySourceKey({
        item: currentDocument,
        promptVersion: SUMMARY_PROMPT_VERSION,
        summaryLanguage: resolveSummaryOutputLanguage(settings),
        summarySourceMode: settings.summarySourceMode,
        pdfSignature: pdfSource ? getPdfSourceSignature(pdfSource, pdfPath || currentPdfName) : '',
        mineruContentSignature,
      });
    }, [
      currentDocument,
      currentPdfName,
      mineruContentSignature,
      pdfSource,
      pdfPath,
      settings.summaryOutputLanguage,
      settings.summarySourceMode,
      settings.uiLanguage,
    ]);
  const paperSummaryLegacySourceKeys = useMemo(() => {
      return buildLegacyPaperSummarySourceKeys({
        item: currentDocument,
        promptVersion: SUMMARY_PROMPT_VERSION,
        summaryLanguage: resolveSummaryOutputLanguage(settings),
        summarySourceMode: settings.summarySourceMode,
        pdfSource,
        pdfPath,
        currentPdfName,
        mineruPath,
        currentJsonName,
        blockCount: flatBlocks.length,
        mineruMarkdownCandidatePaths: currentDocument
          ? resolveMineruMarkdownCandidatePaths({
            item: currentDocument,
            mineruCacheDir: settings.mineruCacheDir,
            mineruPath,
          })
          : [],
      });
    }, [
      currentDocument,
      currentJsonName,
      currentPdfName,
      flatBlocks.length,
      mineruPath,
      pdfSource,
      pdfPath,
      settings.mineruCacheDir,
      settings.summaryOutputLanguage,
      settings.summarySourceMode,
      settings.uiLanguage,
    ]);
  const libraryPreviewSourceKey =
      paperSummarySourceKey ||
      paperSummaryNextSourceKey ||
      `${currentDocument.workspaceId}::preview::${currentJsonName}::${flatBlocks.length}`;
  const effect_162 = useCallback(() => {
    if (!currentDocument.workspaceId) {
      return;
    }

    const previewPayload: LibraryPreviewSyncPayload = {
      item: currentDocument,
      hasBlocks: flatBlocks.length > 0,
      blockCount: flatBlocks.length,
      currentPdfName,
      currentJsonName,
      statusMessage,
      sourceKey: libraryPreviewSourceKey,
      // 暂无概览时不带 summary 字段，避免用 null 覆盖文库侧已缓存的概览。
      ...previewSummarySyncField(paperSummary),
    };

    if (libraryOperation) {
      previewPayload.loading = paperSummaryLoading || libraryOperation.status === 'running';
      previewPayload.error = libraryOperation.status === 'error' ? libraryOperation.message : '';
      previewPayload.operation = libraryOperation;
    } else if (paperSummaryLoading || paperSummaryError) {
      previewPayload.loading = paperSummaryLoading;
      previewPayload.error = paperSummaryError;
    }

    onLibraryPreviewSync(previewPayload);
  }, [
    currentDocument,
    currentJsonName,
    currentPdfName,
    flatBlocks.length,
    libraryOperation,
    libraryPreviewSourceKey,
    onLibraryPreviewSync,
    paperSummary,
    paperSummaryError,
    paperSummaryLoading,
    statusMessage,
  ]);
  const saveSummaryCache = useCallback(
      async (item: WorkspaceItem, sourceKey: string, summary: PaperSummary) => {
        await summaryCacheWriter.current(() => writePreviewSummaryCache({
          item,
          mineruCacheDir: settings.mineruCacheDir,
          sourceKey,
          summary,
        }));
      },
      [settings.mineruCacheDir],
    );
  const tryLoadSavedSummary = useCallback(
      async (item: WorkspaceItem, sourceKey: string, isCurrent: () => boolean) => {
        const result = await loadSavedSummaryCache({
          item,
          mineruCacheDir: settings.mineruCacheDir,
          sourceKey,
          legacySourceKeys: paperSummaryLegacySourceKeys,
          readText: readLocalTextFileIfExists,
        });

        if (result && result.matchedSourceKey !== sourceKey && sourceKey.trim()) {
          await summaryCacheWriter.current(() => writePreviewSummaryCache({
            item,
            mineruCacheDir: settings.mineruCacheDir,
            sourceKey,
            summary: result.summary,
          }), isCurrent).catch(() => undefined);
        }

        return result?.summary ?? null;
      },
      [paperSummaryLegacySourceKeys, settings.mineruCacheDir],
    );
  const loadMineruMarkdownForSummary = useCallback(async () => {
      return loadMineruMarkdownDocument({
        item: currentDocument,
        flatBlocks,
        mineruPath,
        mineruCacheDir: settings.mineruCacheDir,
        readText: readLocalTextFileIfExists,
        buildFallbackMarkdown: buildMineruMarkdownDocument,
        l: lRef.current,
      });
    }, [
      currentDocument,
      flatBlocks,
      mineruPath,
      settings.mineruCacheDir,
    ]);
  const resolveSummaryRequest = useCallback(async () => {
      if (settings.summarySourceMode === 'pdf-text') {
        if (!pdfSource) {
          throw new Error(
            lRef.current(
              '请先加载 PDF，或切换概览来源后再生成概览。',
              'Load a PDF, or switch the overview source before generating an overview.',
            ),
          );
        }

        const documentText = await loadCachedPdfDocumentText();

        if (!documentText.trim()) {
          throw new Error(
            lRef.current(
              '当前 PDF 未提取到可用文本，请尝试切换概览来源或重新加载 PDF。',
              'No usable text was extracted from the current PDF. Try switching the overview source or reloading the PDF.',
            ),
          );
        }

        return {
          blocks: summaryBlockInputs,
          documentText,
        };
      }

      return {
        blocks: summaryBlockInputs,
        documentText: await loadMineruMarkdownForSummary(),
      };
    }, [
      loadCachedPdfDocumentText,
      loadMineruMarkdownForSummary,
      pdfSource,
      settings.summarySourceMode,
      summaryBlockInputs,
    ]);
  const handleGeneratePaperSummary = useCallback(
      async (openPreferencesOnMissingKey = true, force = false) => {
        if (paperSummaryLoading || isPaperTaskRunning(libraryOperation, 'overview')) {
          return;
        }

        if (!currentDocument) {
          return;
        }

        const requestId = summaryRequestIdRef.current + 1;
        summaryRequestIdRef.current = requestId;
        // 主动生成会接管被动读缓存，丢弃仍在途的被动结果。
        cachedSummaryRequestIdRef.current += 1;
        setSummaryCacheLoading(false);

        setPaperSummaryLoading(true);
        setPaperSummaryError('');

        try {
          // 先读本地缓存：命中时不需要模型配置，也不必抽取正文。
          const cachedSummary = shouldReadOverviewCache(paperSummaryNextSourceKey, force)
            ? await tryLoadSavedSummary(currentDocument, paperSummaryNextSourceKey, () => summaryRequestIdRef.current === requestId)
            : null;

          if (summaryRequestIdRef.current !== requestId) {
            return;
          }

          if (cachedSummary) {
            setPaperSummary(cachedSummary);
            setPaperSummarySourceKey(paperSummaryNextSourceKey);
            const successMessage = lRef.current('已从本地缓存恢复论文概览', 'Restored the paper overview from the local cache');
            setStatusMessage(successMessage);
            updateLibraryOperation('overview', 'success', successMessage, 100, 100);
            return;
          }

          const configIssue = resolveSummaryModelConfigIssue(summaryModelPreset);

          if (configIssue || !summaryModelPreset) {
            const configMessages = {
              'base-url': {
                message: lRef.current(
                  '请先在设置中填写概览模型的 OpenAI 兼容 Base URL。',
                  'Configure the overview model OpenAI-compatible Base URL in Settings first.',
                ),
                status: lRef.current('缺少概览接口 Base URL', 'Missing overview Base URL'),
              },
              'api-key': {
                message: lRef.current(
                  '请先在设置中填写概览模型的 API Key。',
                  'Configure the overview model API key in Settings first.',
                ),
                status: lRef.current('缺少概览接口 API Key', 'Missing overview API key'),
              },
              model: {
                message: lRef.current(
                  '请先在设置中填写概览模型名称。',
                  'Configure the overview model name in Settings first.',
                ),
                status: lRef.current('缺少概览模型名称', 'Missing overview model name'),
              },
            } as const;
            const { message, status } = configMessages[configIssue ?? 'base-url'];
            // 不清空已显示的概览：缺配置只说明无法重新生成。
            setPaperSummaryError(message);
            setStatusMessage(status);
            updateLibraryOperation('overview', 'error', message, 100, 100);

            if (openPreferencesOnMissingKey) {
              onOpenPreferences();
            }

            return;
          }

          if (settings.summarySourceMode === 'mineru-markdown' && summaryBlockInputs.length === 0) {
            throw new Error(lRef.current('请先加载 MinerU JSON，再基于 MinerU Markdown 生成概览。', 'Load a MinerU JSON file before generating an overview from MinerU Markdown.'));
          }

          const runningMessage = lRef.current('正在生成论文概览…', 'Generating the paper overview...');
          setStatusMessage(runningMessage);
          updateLibraryOperation('overview', 'running', runningMessage, 25, 100);

          const summaryRequest = await resolveSummaryRequest();

          if (summaryRequestIdRef.current !== requestId) {
            return;
          }

          const summary = await summarizeDocumentOpenAICompatible({
            baseUrl: summaryModelPreset.baseUrl,
            apiKey: summaryModelPreset.apiKey.trim(),
            model: summaryModelPreset.model,
            apiMode: summaryModelPreset.apiMode,
            temperature: getModelRuntimeConfig(settings, 'summary').temperature,
            reasoningEffort: getModelRuntimeConfig(settings, 'summary').reasoningEffort,
            title: currentDocument.title,
            authors: currentDocument.creators || undefined,
            year: currentDocument.year || undefined,
            outputLanguage: resolveSummaryOutputLanguage(settings),
            blocks: summaryRequest.blocks,
            documentText: summaryRequest.documentText,
          });

          if (summaryRequestIdRef.current !== requestId) {
            return;
          }

          setPaperSummary(summary);
          setPaperSummarySourceKey(paperSummaryNextSourceKey);
          await saveSummaryCache(currentDocument, paperSummaryNextSourceKey, summary).catch(
            () => undefined,
          );
          const successMessage = lRef.current('论文概览已生成', 'Paper overview generated');
          setStatusMessage(successMessage);
          updateLibraryOperation('overview', 'success', successMessage, 100, 100);
        } catch (nextError) {
          if (summaryRequestIdRef.current !== requestId) {
            return;
          }

          const message =
            nextError instanceof Error
              ? nextError.message
              : lRef.current('生成论文概览失败', 'Failed to generate the paper overview');
          setPaperSummaryError(message);
          setStatusMessage(lRef.current('论文概览生成失败', 'Failed to generate the paper overview'));
          updateLibraryOperation('overview', 'error', message, 100, 100);
        } finally {
          if (summaryRequestIdRef.current === requestId) {
            setPaperSummaryLoading(false);
          }
        }
      },
      [
        currentDocument,
        libraryOperation,
        onOpenPreferences,
        paperSummaryNextSourceKey,
        paperSummaryLoading,
        resolveSummaryRequest,
        saveSummaryCache,
        settings.summaryOutputLanguage,
        settings.summarySourceMode,
        settings.uiLanguage,
        summaryBlockInputs.length,
        summaryModelPreset,
        tryLoadSavedSummary,
        updateLibraryOperation,
      ],
    );
  const effect_266 = useCallback(() => {
    if (
      !shouldUsePreviewSummaryFallback({
        currentSummary: paperSummary,
        previewSummary: libraryPreviewSummary,
        loading: paperSummaryLoading,
      }) ||
      !libraryPreviewSummary
    ) {
      return;
    }

    setPaperSummary(libraryPreviewSummary);
  }, [libraryPreviewSummary, paperSummary, paperSummaryLoading]);
  const effect_267 = useCallback(() => {
    if (
      !currentDocument ||
      !shouldAutoLoadCachedSummary({
        sourceKey: paperSummaryNextSourceKey,
        currentSourceKey: paperSummarySourceKey,
        attemptedSourceKey: cachedSummaryAttemptKeyRef.current,
        loading: paperSummaryLoading,
        taskRunning: isPaperTaskRunning(libraryOperation, 'overview'),
      })
    ) {
      return;
    }

    const sourceKey = paperSummaryNextSourceKey;
    const generationAtStart = summaryRequestIdRef.current;
    const requestId = cachedSummaryRequestIdRef.current + 1;
    cachedSummaryRequestIdRef.current = requestId;
    cachedSummaryAttemptKeyRef.current = sourceKey;
    setSummaryCacheLoading(true);

    const isCurrent = () => cachedSummaryRequestIdRef.current === requestId &&
      summaryRequestIdRef.current === generationAtStart;
    void tryLoadSavedSummary(currentDocument, sourceKey, isCurrent)
      .then((cachedSummary) => {
        if (
          !cachedSummary ||
          cachedSummaryRequestIdRef.current !== requestId ||
          summaryRequestIdRef.current !== generationAtStart
        ) {
          return;
        }

        setPaperSummary(cachedSummary);
        setPaperSummarySourceKey(sourceKey);
        setPaperSummaryError('');
      })
      .catch(() => undefined)
      .finally(() => {
        if (cachedSummaryRequestIdRef.current === requestId) setSummaryCacheLoading(false);
      });
  }, [
    currentDocument,
    libraryOperation,
    paperSummaryLoading,
    paperSummaryNextSourceKey,
    paperSummarySourceKey,
    tryLoadSavedSummary,
  ]);
  const effect_268 = useCallback(() => {
    if (!currentDocument || !paperSummaryNextSourceKey) {
      return;
    }

    if (
      !settings.autoGenerateSummary ||
      !summaryConfigured ||
      paperSummaryLoading ||
      paperSummarySourceKey === paperSummaryNextSourceKey
    ) {
      return;
    }

    if (autoSummarySourceKeyRef.current === paperSummaryNextSourceKey) {
      return;
    }

    autoSummarySourceKeyRef.current = paperSummaryNextSourceKey;

    void handleGeneratePaperSummary(false);
  }, [
    currentDocument,
    handleGeneratePaperSummary,
    paperSummaryLoading,
    paperSummaryNextSourceKey,
    paperSummarySourceKey,
    settings.autoGenerateSummary,
    summaryConfigured,
  ]);

  return { effect_162, effect_266, effect_267, effect_268, handleGeneratePaperSummary, libraryPreviewSourceKey, loadMineruMarkdownForSummary, paperSummaryLegacySourceKeys, paperSummaryNextSourceKey, resolveSummaryRequest, saveSummaryCache, tryLoadSavedSummary };
}

export type ReaderSummaryApi = ReturnType<typeof useReaderSummary>;
