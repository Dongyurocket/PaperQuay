import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import {
  translateBlocksOpenAICompatible,
  translateTextOpenAICompatible,
} from "../../services/translation";
import type { BlockReparseOverrideApi } from "../../services/blockReparseOverrides";
import type {
  PositionedMineruBlock,
  QaModelPreset,
  ReaderSettings,
  SelectedExcerpt,
  TranslationMap,
  WorkspaceItem,
} from "../../types/reader";
import {
  getModelRuntimeConfig,
} from "./readerShared";
import type { ReaderDocumentTranslationSnapshot } from "./documentReaderShared";

import {
  countTranslatedBlocks,
  mergeReaderTranslations,
  sanitizeTranslationErrorMessage,
  translateBlocksBestEffort,
} from "./readerTranslation";
import {
  buildBlockTranslationInput,
  buildBlockTranslationInputs,
  hashTranslationSourceText,
  mergeSourceHashes,
  reconcileTranslations,
  resolveBlockTranslationText,
  sameTranslationMap,
  withCurrentSourceHashes,
} from "./translationSource";
import {
  beginTranslationCacheRestore,
  createTranslationCacheIdentity,
  deleteTranslationCache,
  hasTranslationCacheClearedMarker,
  isTranslationCacheRestoreTokenCurrent,
  markTranslationCacheCleared,
  readTranslationCache,
  writeTranslationCache,
} from "./readerTranslationCache";
import {
  failBackgroundTask,
  finishBackgroundTask,
  nextProgressPublishGate,
  removeBackgroundTask,
  shouldPublishBackgroundProgress,
  translationBackgroundTaskId,
  upsertBackgroundTask,
  type ProgressPublishGate,
} from "../../services/backgroundTasks.ts";

type LocaleTextFn = (zh: string, en: string) => string;

function translationCacheFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 旧测试/旧调用方可能没有传入 hiddenBlockIds；缺省视为没有隐藏块。 */
const EMPTY_HIDDEN_BLOCK_IDS = new Set<string>();

interface UseDocumentTranslationOptions {
  currentDocument: WorkspaceItem;
  flatBlocks: PositionedMineruBlock[];
  /** AI 重解析覆盖：翻译输入与失效判断都以修复后的文本为准。 */
  blockReparse: BlockReparseOverrideApi;
  libraryOperationRunning: boolean;
  onOpenPreferences: () => void;
  selectedExcerpt: SelectedExcerpt | null;
  selectionTranslationModelPreset: QaModelPreset | null;
  settings: ReaderSettings;
  setError: (value: string) => void;
  setStatusMessage: (value: string) => void;
  translationModelPreset: QaModelPreset | null;
  translationSnapshot?: ReaderDocumentTranslationSnapshot | null;
  updateLibraryOperation: (
    kind: "translation",
    status: "running" | "success" | "error",
    message: string,
    completed?: number | null,
    total?: number | null,
  ) => void;
  lRef: MutableRefObject<LocaleTextFn>;
}

interface UseDocumentTranslationResult {
  applySelectedExcerptTranslation: (translation: string) => void;
  blockTranslations: TranslationMap;
  handleCancelDocumentTranslation: () => void;
  handleClearTranslations: () => void;
  handleRetranslateBlock: (block: PositionedMineruBlock) => Promise<void>;
  handleTranslateDocument: () => Promise<void>;
  handleTranslateSelectedExcerpt: (
    openPreferencesOnMissingKey?: boolean,
  ) => Promise<void>;
  resetDocumentTranslationState: () => void;
  resetSelectedExcerptTranslationState: () => void;
  selectedExcerptError: string;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  translatedCount: number;
  translating: boolean;
  translationCancelling: boolean;
  translationProgressCompleted: number;
  translationProgressTotal: number;
}

export function useDocumentTranslation({
  currentDocument,
  flatBlocks,
  blockReparse,
  libraryOperationRunning,
  onOpenPreferences,
  selectedExcerpt,
  selectionTranslationModelPreset,
  settings,
  setError,
  setStatusMessage,
  translationModelPreset,
  translationSnapshot = null,
  updateLibraryOperation,
  lRef,
}: UseDocumentTranslationOptions): UseDocumentTranslationResult {
  const documentTranslationAbortControllerRef = useRef<AbortController | null>(null);
  const documentTranslationRequestIdRef = useRef(0);
  const selectedExcerptRequestIdRef = useRef(0);
  const selectionRequestKeyRef = useRef("");
  const blockTranslationsRef = useRef<TranslationMap>({});
  const translationProgressTotalRef = useRef(0);
  const translationPublishGateRef = useRef<ProgressPublishGate | null>(null);
  const translationTaskIdRef = useRef("");
  /** 当前内存译文对应的源文本指纹；与 blockTranslationsRef 同步更新。 */
  const translationSourceHashesRef = useRef<Record<string, string>>({});

  const [blockTranslations, setBlockTranslations] = useState<TranslationMap>(
    {},
  );
  const [blockTranslationTargetLanguage, setBlockTranslationTargetLanguage] =
    useState("");
  const [translating, setTranslating] = useState(false);
  const [translationCancelling, setTranslationCancelling] = useState(false);
  const [translationProgressCompleted, setTranslationProgressCompleted] =
    useState(0);
  const [translationProgressTotal, setTranslationProgressTotal] = useState(0);
  const [selectedExcerptTranslation, setSelectedExcerptTranslation] =
    useState("");
  const [selectedExcerptTranslating, setSelectedExcerptTranslating] =
    useState(false);
  const [selectedExcerptError, setSelectedExcerptError] = useState("");

  const translatedCount = useMemo(
    () => countTranslatedBlocks(blockTranslations),
    [blockTranslations],
  );

  const {
    overrides: blockOverrides,
    getOverrideMarkdown,
    hiddenBlockIds: rawHiddenBlockIds,
  } = blockReparse;
  const hiddenBlockIds = rawHiddenBlockIds ?? EMPTY_HIDDEN_BLOCK_IDS;
  // 被用户判定为多余内容的块不参与翻译；已有译文在协调时一并移除。
  const customSourceBlockIds = useMemo(
    () => new Set([...Object.keys(blockOverrides), ...hiddenBlockIds]),
    [blockOverrides, hiddenBlockIds],
  );
  const knownBlockIds = useMemo(
    () =>
      new Set(
        flatBlocks
          .filter((block) => !block.contentSourceBlockId && !hiddenBlockIds.has(block.blockId))
          .map((block) => block.blockId),
      ),
    [flatBlocks, hiddenBlockIds],
  );
  const blockById = useMemo(
    () => new Map(flatBlocks.map((block) => [block.blockId, block])),
    [flatBlocks],
  );

  /**
   * 只计算候选块的当前源文本指纹。整篇逐块重算 markdown 代价高，而校验与
   * 失效只涉及已有译文的块；全文翻译的指纹在构造输入时直接产出。
   */
  const buildCurrentHashesFor = useCallback(
    (blockIds: Iterable<string>): Record<string, string> => {
      const hashes: Record<string, string> = {};

      for (const blockId of blockIds) {
        const block = blockById.get(blockId);

        if (!block || block.contentSourceBlockId) {
          continue;
        }

        hashes[blockId] = hashTranslationSourceText(
          resolveBlockTranslationText(block, getOverrideMarkdown),
        );
      }

      return hashes;
    },
    [blockById, getOverrideMarkdown],
  );

  /**
   * 同时更新内存译文与它们对应的源文本指纹。所有写入译文的位置都必须走这里，
   * 否则下一次校验会把刚生成的译文当成过期。
   */
  const applyTranslationState = useCallback(
    (translations: TranslationMap, sourceHashes: Record<string, string>) => {
      blockTranslationsRef.current = translations;
      translationSourceHashesRef.current = sourceHashes;
      setBlockTranslations(translations);
    },
    [],
  );

  const reconcileWithCurrentSources = useCallback(
    (
      translations: TranslationMap | null | undefined,
      sourceHashes: Record<string, string> | null | undefined,
    ) =>
      reconcileTranslations({
        translations,
        storedHashes: sourceHashes,
        currentHashes: buildCurrentHashesFor(Object.keys(translations ?? {})),
        customSourceBlockIds,
        knownBlockIds,
      }),
    [buildCurrentHashesFor, customSourceBlockIds, knownBlockIds],
  );

  // 译文缓存按目标语言 + 模型身份 + 源语言隔离；切换模型后不会读到另一套
  // 译文，旧版 <targetLanguage>.json 仍会作为读取候选。
  const documentTranslationCacheIdentity = useMemo(
    () =>
      createTranslationCacheIdentity(
        translationModelPreset?.baseUrl,
        translationModelPreset?.model,
        settings.translationSourceLanguage,
      ),
    [settings.translationSourceLanguage, translationModelPreset],
  );

  useEffect(() => {
    blockTranslationsRef.current = blockTranslations;
  }, [blockTranslations]);

  // 源文本或 AI 覆盖变化后立即剪掉不再对应的译文，避免界面继续显示旧译文。
  // 这里只改内存状态；磁盘缓存在下一次翻译写入时按新指纹覆盖，读取时仍会
  // 经过同一套校验，不会把已失效的译文又贴回来。
  useEffect(() => {
    if (!flatBlocks.length || translating) {
      return;
    }

    const currentTranslations = blockTranslationsRef.current;

    if (Object.keys(currentTranslations).length === 0) {
      return;
    }

    const reconciled = reconcileWithCurrentSources(
      currentTranslations,
      translationSourceHashesRef.current,
    );

    if (sameTranslationMap(reconciled.translations, currentTranslations)) {
      translationSourceHashesRef.current = reconciled.sourceHashes;
      return;
    }

    const staleCount =
      Object.keys(currentTranslations).length -
      Object.keys(reconciled.translations).length;

    applyTranslationState(reconciled.translations, reconciled.sourceHashes);
    setTranslationProgressCompleted(Object.keys(reconciled.translations).length);

    if (staleCount > 0) {
      setStatusMessage(
        lRef.current(
          `${staleCount} 段译文对应的原文已更新，已标记为待重新翻译`,
          `${staleCount} translation(s) no longer match the current source text and will be retranslated`,
        ),
      );
    }
  }, [applyTranslationState, flatBlocks.length, reconcileWithCurrentSources, setStatusMessage, translating, lRef]);

  useEffect(() => {
    translationProgressTotalRef.current = translationProgressTotal;
  }, [translationProgressTotal]);

  translationTaskIdRef.current = translationBackgroundTaskId(currentDocument.itemKey);

  const publishTranslationProgress = useCallback(
    (completed: number, total: number, force = false) => {
      const now = Date.now();

      if (
        !force
        && !shouldPublishBackgroundProgress(
          translationPublishGateRef.current,
          completed,
          total,
          now,
        )
      ) {
        return;
      }

      translationPublishGateRef.current = nextProgressPublishGate(completed, total, now);
      upsertBackgroundTask({
        id: translationBackgroundTaskId(currentDocument.itemKey),
        kind: "translate",
        title: currentDocument.title.trim() || currentDocument.itemKey,
        completed,
        total,
      });
    },
    [currentDocument.itemKey, currentDocument.title],
  );

  const settleTranslationTask = useCallback(
    (requestId: number, outcome: "success" | "error" | "dismiss", error?: string) => {
      if (documentTranslationRequestIdRef.current !== requestId) {
        return;
      }

      const taskId = translationBackgroundTaskId(currentDocument.itemKey);

      if (outcome === "success") {
        finishBackgroundTask(taskId);
        return;
      }

      if (outcome === "dismiss") {
        removeBackgroundTask(taskId);
        return;
      }

      failBackgroundTask(taskId, error || "翻译失败", {
        kind: "translate",
        title: currentDocument.title.trim() || currentDocument.itemKey,
      });
    },
    [currentDocument.itemKey, currentDocument.title],
  );

  const tryLoadSavedTranslations = useCallback(
    async (item: WorkspaceItem) =>
      readTranslationCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        targetLanguage: settings.translationTargetLanguage,
        identity: documentTranslationCacheIdentity,
      }),
    [
      documentTranslationCacheIdentity,
      settings.mineruCacheDir,
      settings.translationTargetLanguage,
    ],
  );

  const saveTranslationCache = useCallback(
    async (
      item: WorkspaceItem,
      translations: TranslationMap,
      sourceHashes: Record<string, string>,
    ) => {
      await writeTranslationCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        translations,
        sourceHashes,
        identity: documentTranslationCacheIdentity,
      });
    },
    [
      documentTranslationCacheIdentity,
      settings.mineruCacheDir,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
    ],
  );

  useEffect(() => {
    if (
      blockTranslationTargetLanguage &&
      blockTranslationTargetLanguage !== settings.translationTargetLanguage
    ) {
      applyTranslationState({}, {});
      setBlockTranslationTargetLanguage("");
    }
  }, [applyTranslationState, blockTranslationTargetLanguage, settings.translationTargetLanguage]);

  useEffect(() => {
    if (
      !translationSnapshot ||
      translationSnapshot.targetLanguage !== settings.translationTargetLanguage
    ) {
      return;
    }

    // 用户刚清除过译文时，文库页快照里的旧译文不应把清除结果又贴回来；
    // 新译文成功写入缓存后会解除这个会话标记。
    if (
      hasTranslationCacheClearedMarker(
        currentDocument,
        settings.translationTargetLanguage,
      )
    ) {
      return;
    }

    const incoming = reconcileWithCurrentSources(
      translationSnapshot.translations,
      translationSnapshot.sourceHashes,
    );
    const incomingCount = countTranslatedBlocks(incoming.translations);

    if (incomingCount === 0) {
      return;
    }

    if (
      blockTranslationTargetLanguage === translationSnapshot.targetLanguage &&
      translatedCount >= incomingCount
    ) {
      return;
    }

    applyTranslationState(incoming.translations, incoming.sourceHashes);
    setBlockTranslationTargetLanguage(translationSnapshot.targetLanguage);
    setStatusMessage(
      lRef.current(
        `已加载文库页刚生成的全文翻译 ${incomingCount} 条`,
        `Loaded ${incomingCount} translations generated from the library page`,
      ),
    );
  }, [
    applyTranslationState,
    blockTranslationTargetLanguage,
    currentDocument,
    reconcileWithCurrentSources,
    settings.translationTargetLanguage,
    setStatusMessage,
    translatedCount,
    translationSnapshot,
    lRef,
  ]);

  useEffect(() => {
    if (!flatBlocks.length || !settings.mineruCacheDir.trim()) {
      return;
    }

    if (
      blockTranslationTargetLanguage === settings.translationTargetLanguage &&
      translatedCount > 0
    ) {
      return;
    }

    // 清除标记存在时不再读磁盘；token 记录恢复开始时的 generation，
    // 读取期间若用户点了清除，结果会被丢弃而不是回填旧译文。
    const restoreToken = beginTranslationCacheRestore(
      currentDocument,
      settings.translationTargetLanguage,
    );

    if (!restoreToken) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const cachedTranslationResult =
        await tryLoadSavedTranslations(currentDocument);

      if (
        cancelled ||
        !cachedTranslationResult ||
        !isTranslationCacheRestoreTokenCurrent(restoreToken)
      ) {
        return;
      }

      const restored = reconcileWithCurrentSources(
        cachedTranslationResult.translations,
        cachedTranslationResult.sourceHashes,
      );
      const restoredCount = countTranslatedBlocks(restored.translations);
      const staleCount =
        countTranslatedBlocks(cachedTranslationResult.translations) - restoredCount;

      if (restoredCount === 0) {
        // 缓存全部过期（例如每段都修复过）：不要把空结果说成“已恢复 0 条”，
        // 而是明确提示需要重新翻译。
        if (staleCount > 0) {
          const staleMessage = lRef.current(
            `${staleCount} 段历史译文的原文已更新，需要重新翻译`,
            `${staleCount} saved translation(s) no longer match the current source text and need to be retranslated`,
          );
          setStatusMessage(staleMessage);
          updateLibraryOperation(
            "translation",
            "success",
            staleMessage,
            null,
            flatBlocks.length || null,
          );
        }

        return;
      }

      const restoredMessage = staleCount > 0
        ? lRef.current(
            `已恢复历史翻译 ${restoredCount} 条（${settings.translationTargetLanguage}）；${staleCount} 段因原文更新待重新翻译`,
            `Restored ${restoredCount} saved translations (${settings.translationTargetLanguage}); ${staleCount} need retranslation because the source text changed`,
          )
        : lRef.current(
            `已恢复历史翻译 ${restoredCount} 条（${settings.translationTargetLanguage}）`,
            `Restored ${restoredCount} saved translations (${settings.translationTargetLanguage})`,
          );

      applyTranslationState(restored.translations, restored.sourceHashes);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setStatusMessage(restoredMessage);
      updateLibraryOperation(
        "translation",
        "success",
        restoredMessage,
        restoredCount,
        flatBlocks.length || null,
      );
    })().catch((error) => {
      if (cancelled) {
        return;
      }

      const detail = translationCacheFailureMessage(error);
      const message = lRef.current(
        `读取已保存的全文译文失败：${detail}`,
        `Failed to restore saved full-document translations: ${detail}`,
      );
      console.error('Failed to restore translation cache', error);
      setError(message);
      setStatusMessage(message);
      updateLibraryOperation('translation', 'error', message, null, flatBlocks.length || null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    applyTranslationState,
    blockTranslationTargetLanguage,
    currentDocument,
    flatBlocks.length,
    reconcileWithCurrentSources,
    settings.mineruCacheDir,
    settings.translationTargetLanguage,
    setError,
    setStatusMessage,
    translatedCount,
    tryLoadSavedTranslations,
    updateLibraryOperation,
    lRef,
  ]);

  const handleTranslateDocument = useCallback(async () => {
    if (translating || libraryOperationRunning) {
      return;
    }

    const blocksToTranslate = buildBlockTranslationInputs(
      hiddenBlockIds.size > 0
        ? flatBlocks.filter((block) => !hiddenBlockIds.has(block.blockId))
        : flatBlocks,
      getOverrideMarkdown,
    );
    const blocksToTranslateHashes: Record<string, string> = {};

    for (const block of blocksToTranslate) {
      if (block.sourceHash) {
        blocksToTranslateHashes[block.blockId] = block.sourceHash;
      }
    }

    if (blocksToTranslate.length === 0) {
      const message = lRef.current(
        "当前没有可翻译的结构化文本",
        "There is no structured text available to translate",
      );
      setStatusMessage(message);
      updateLibraryOperation("translation", "error", message, 100, 100);
      return;
    }

    if (!translationModelPreset || !translationModelPreset.apiKey.trim()) {
      onOpenPreferences();
      const message = lRef.current(
        "请先在设置中填写 AI 接口 API Key",
        "Configure the AI API key in Settings first",
      );
      setError(message);
      updateLibraryOperation("translation", "error", message, 100, 100);
      return;
    }

    const requestId = documentTranslationRequestIdRef.current + 1;
    const abortController = new AbortController();

    documentTranslationRequestIdRef.current = requestId;
    documentTranslationAbortControllerRef.current = abortController;

    setTranslating(true);
    setTranslationCancelling(false);
    setTranslationProgressTotal(blocksToTranslate.length);
    translationPublishGateRef.current = null;
    publishTranslationProgress(0, blocksToTranslate.length, true);
    setError("");
    const translationStartMessage = lRef.current(
      `正在翻译 ${blocksToTranslate.length} 个结构块`,
      `Translating ${blocksToTranslate.length} structured blocks`,
    );
    setStatusMessage(translationStartMessage);
    updateLibraryOperation(
      "translation",
      "running",
      translationStartMessage,
      0,
      blocksToTranslate.length,
    );
    let cacheWriteError: unknown = null;

    try {
      // 用户清除后、新译文写入前，磁盘上的旧缓存（若删除失败）和文库页
      // 快照都不应作为续译基础，否则清除的旧译文会被静默恢复。
      const translationCacheCleared = hasTranslationCacheClearedMarker(
        currentDocument,
        settings.translationTargetLanguage,
      );
      const cachedTranslationResult = translationCacheCleared
        ? null
        : await tryLoadSavedTranslations(currentDocument).catch((cacheError) => {
            console.warn('Failed to read translation cache before translation resume', cacheError);
            return null;
          });
      // 旧缓存要与当前源文本逐块校验：修复过的块、或 blockId 已漂移的块
      // 不再参与续译，避免“看起来已翻译”把旧译文带回来。
      const cachedResumed = cachedTranslationResult
        ? reconcileWithCurrentSources(
            cachedTranslationResult.translations,
            cachedTranslationResult.sourceHashes,
          )
        : { translations: {}, sourceHashes: {} };
      const snapshotResumed = translationCacheCleared
        ? { translations: {}, sourceHashes: {} }
        : reconcileWithCurrentSources(
            translationSnapshot?.translations,
            translationSnapshot?.sourceHashes,
          );
      const resumedTranslations = mergeReaderTranslations(
        mergeReaderTranslations(
          blockTranslations,
          cachedResumed.translations,
        ),
        snapshotResumed.translations,
      );
      const resumedSourceHashes = withCurrentSourceHashes(
        resumedTranslations,
        mergeSourceHashes(
          translationSourceHashesRef.current,
          cachedResumed.sourceHashes,
          snapshotResumed.sourceHashes,
          blocksToTranslateHashes,
        ),
      );
      const resumedCount = countTranslatedBlocks(resumedTranslations);

      if (resumedCount > 0) {
        applyTranslationState(resumedTranslations, resumedSourceHashes);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setTranslationProgressCompleted(resumedCount);
      } else {
        setTranslationProgressCompleted(0);
      }

      publishTranslationProgress(resumedCount, blocksToTranslate.length, true);

      const result = await translateBlocksBestEffort({
        apiKey: translationModelPreset.apiKey.trim(),
        apiMode: translationModelPreset.apiMode,
        baseUrl: translationModelPreset.baseUrl,
        batchSize: Math.max(1, settings.translationBatchSize),
        blocks: blocksToTranslate,
        concurrency: Math.max(1, settings.translationConcurrency),
        existingTranslations: resumedTranslations,
        model: translationModelPreset.model,
        onProgress: async (progress) => {
          if (
            documentTranslationRequestIdRef.current !== requestId ||
            abortController.signal.aborted
          ) {
            return;
          }

          applyTranslationState(
            progress.translations,
            withCurrentSourceHashes(progress.translations, blocksToTranslateHashes),
          );
          setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
          setTranslationProgressCompleted(progress.translatedCount);
          publishTranslationProgress(progress.translatedCount, progress.totalBlocks);

          if (progress.translatedCount > 0) {
            try {
              await saveTranslationCache(
                currentDocument,
                progress.translations,
                withCurrentSourceHashes(progress.translations, blocksToTranslateHashes),
              );
              cacheWriteError = null;
            } catch (cacheError) {
              cacheWriteError = cacheError;
              console.error('Failed to save translation progress', cacheError);
            }
          }

          const progressMessage = lRef.current(
            `正在翻译 ${progress.translatedCount}/${progress.totalBlocks} 个块`,
            `Translating ${progress.translatedCount}/${progress.totalBlocks} blocks`,
          );
          setStatusMessage(progressMessage);
          updateLibraryOperation(
            "translation",
            "running",
            progressMessage,
            progress.translatedCount,
            progress.totalBlocks,
          );
        },
        reasoningEffort: getModelRuntimeConfig(settings, "translation")
          .reasoningEffort,
        requestsPerMinute: settings.translationRequestsPerMinute,
        signal: abortController.signal,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        temperature: getModelRuntimeConfig(settings, "translation").temperature,
        translateBatch: translateBlocksOpenAICompatible,
      });

      if (documentTranslationRequestIdRef.current !== requestId) {
        return;
      }

      const nextTranslations = result.translations;
      const nextTranslatedCount = countTranslatedBlocks(nextTranslations);
      const nextSourceHashes = withCurrentSourceHashes(
        nextTranslations,
        blocksToTranslateHashes,
      );

      applyTranslationState(nextTranslations, nextSourceHashes);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setTranslationProgressCompleted(nextTranslatedCount);

      try {
        await saveTranslationCache(currentDocument, nextTranslations, nextSourceHashes);
        cacheWriteError = null;
      } catch (cacheError) {
        cacheWriteError = cacheError;
        console.error('Failed to save completed translation cache', cacheError);
      }

      const cacheStatusSuffix = cacheWriteError
        ? lRef.current(
            '；译文缓存写入失败，本次结果仅保留在当前窗口',
            '; the translation cache could not be written, so this result is only available in the current window',
          )
        : '';

      if (result.cancelled) {
        const remainingCount = Math.max(0, blocksToTranslate.length - nextTranslatedCount);
        const cancelledMessage = lRef.current(
          `已取消全文翻译，已保留 ${nextTranslatedCount} 段译文，剩余 ${remainingCount} 段可再次点击翻译全文继续`,
          `Full-document translation cancelled. Kept ${nextTranslatedCount} translated blocks; click Translate Document again to continue the remaining ${remainingCount}`,
        );

        const finalCancelledMessage = `${cancelledMessage}${cacheStatusSuffix}`;
        setStatusMessage(finalCancelledMessage);
        updateLibraryOperation(
          "translation",
          cacheWriteError ? "error" : "success",
          finalCancelledMessage,
          nextTranslatedCount,
          blocksToTranslate.length,
        );
        if (cacheWriteError) {
          setError(translationCacheFailureMessage(cacheWriteError));
          settleTranslationTask(requestId, "error", finalCancelledMessage);
        } else {
          settleTranslationTask(requestId, "dismiss");
        }
        return;
      }

      const failedCount = result.failedBlocks.length;
      const finishedMessage =
        failedCount > 0
          ? lRef.current(
              `翻译已部分完成，已保存 ${nextTranslatedCount} 段译文，剩余 ${failedCount} 段可再次点击翻译全文继续`,
              `Translation partially completed. Saved ${nextTranslatedCount} translated blocks; click Translate Document again to continue the remaining ${failedCount}`,
            )
          : lRef.current(
              `翻译完成，已生成 ${nextTranslatedCount} 段译文`,
              `Translation complete. Generated ${nextTranslatedCount} translated blocks`,
            );
      const finalFinishedMessage = `${finishedMessage}${cacheStatusSuffix}`;
      setStatusMessage(finalFinishedMessage);
      updateLibraryOperation(
        "translation",
        failedCount > 0 || cacheWriteError ? "error" : "success",
        finalFinishedMessage,
        nextTranslatedCount,
        blocksToTranslate.length,
      );

      if (cacheWriteError) {
        setError(translationCacheFailureMessage(cacheWriteError));
      } else if (failedCount > 0) {
        setError(
          sanitizeTranslationErrorMessage(
            result.failureMessages[0],
            lRef.current,
            "document",
          ),
        );
      }

      if (failedCount > 0 || cacheWriteError) {
        settleTranslationTask(requestId, "error", finalFinishedMessage);
      } else {
        settleTranslationTask(requestId, "success");
      }
    } catch (error) {
      if (documentTranslationRequestIdRef.current !== requestId) {
        return;
      }

      const message = sanitizeTranslationErrorMessage(
        error,
        lRef.current,
        "document",
      );
      setError(message);
      setStatusMessage(message);
      updateLibraryOperation("translation", "error", message, 100, 100);
      settleTranslationTask(requestId, "error", message);
    } finally {
      if (documentTranslationRequestIdRef.current === requestId) {
        setTranslating(false);
        setTranslationCancelling(false);
        setTranslationProgressTotal(0);
        if (documentTranslationAbortControllerRef.current === abortController) {
          documentTranslationAbortControllerRef.current = null;
        }
      }
    }
  }, [
    applyTranslationState,
    blockTranslations,
    currentDocument,
    flatBlocks,
    getOverrideMarkdown,
    hiddenBlockIds,
    libraryOperationRunning,
    onOpenPreferences,
    reconcileWithCurrentSources,
    saveTranslationCache,
    setError,
    setStatusMessage,
    settings.translationBatchSize,
    settings.translationConcurrency,
    settings.translationRequestsPerMinute,
    settings.translationSourceLanguage,
    settings.translationTargetLanguage,
    translating,
    translationModelPreset,
    translationSnapshot?.sourceHashes,
    translationSnapshot?.translations,
    publishTranslationProgress,
    settleTranslationTask,
    tryLoadSavedTranslations,
    updateLibraryOperation,
    lRef,
  ]);

  const handleCancelDocumentTranslation = useCallback(() => {
    const abortController = documentTranslationAbortControllerRef.current;

    if (!abortController || abortController.signal.aborted) {
      return;
    }

    abortController.abort();
    setTranslationCancelling(true);

    const translatedBlockCount = countTranslatedBlocks(blockTranslationsRef.current);
    const totalBlockCount = translationProgressTotalRef.current || null;
    const message = lRef.current(
      "正在取消全文翻译，当前批次结束后会停止，并保留已完成译文。",
      "Cancelling full-document translation. It will stop after the current batch and keep completed translations.",
    );

    setStatusMessage(message);
    updateLibraryOperation(
      "translation",
      "running",
      message,
      translatedBlockCount,
      totalBlockCount,
    );
  }, [setStatusMessage, updateLibraryOperation, lRef]);

  const handleRetranslateBlock = useCallback(
    async (block: PositionedMineruBlock) => {
      if (translating || libraryOperationRunning) {
        return;
      }

      const blockToTranslate = buildBlockTranslationInput(block, getOverrideMarkdown);

      if (!blockToTranslate) {
        const message = lRef.current(
          "这个结构块没有可翻译文本",
          "This structured block has no translatable text",
        );
        setStatusMessage(message);
        return;
      }

      // 单块重译发生在“刚保存修复文本”之后：不能依赖上一次渲染的指纹表，
      // 必须使用本次输入同步算出的指纹。
      const blockSourceHashes: Record<string, string> = blockToTranslate.sourceHash
        ? { [block.blockId]: blockToTranslate.sourceHash }
        : {};

      if (!translationModelPreset || !translationModelPreset.apiKey.trim()) {
        onOpenPreferences();
        const message = lRef.current(
          "请先在设置中填写 AI 接口 API Key",
          "Configure the AI API key in Settings first",
        );
        setError(message);
        updateLibraryOperation("translation", "error", message, 100, 100);
        return;
      }

      const requestId = documentTranslationRequestIdRef.current + 1;
      const abortController = new AbortController();

      documentTranslationRequestIdRef.current = requestId;
      documentTranslationAbortControllerRef.current = abortController;

      setTranslating(true);
      setTranslationCancelling(false);
      setTranslationProgressCompleted(0);
      setTranslationProgressTotal(1);
      translationPublishGateRef.current = null;
      publishTranslationProgress(0, 1, true);
      setError("");

      const startMessage = lRef.current(
        `正在重新翻译第 ${block.pageIndex + 1} 页的结构块`,
        `Retranslating the structured block on page ${block.pageIndex + 1}`,
      );
      setStatusMessage(startMessage);
      updateLibraryOperation("translation", "running", startMessage, 0, 1);
      let cacheWriteError: unknown = null;

      try {
        const result = await translateBlocksBestEffort({
          apiKey: translationModelPreset.apiKey.trim(),
          apiMode: translationModelPreset.apiMode,
          baseUrl: translationModelPreset.baseUrl,
          batchSize: 1,
          blocks: [blockToTranslate],
          concurrency: 1,
          existingTranslations: {},
          model: translationModelPreset.model,
          onProgress: async (progress) => {
            if (
              documentTranslationRequestIdRef.current !== requestId ||
              abortController.signal.aborted
            ) {
              return;
            }

            const mergedTranslations = mergeReaderTranslations(
              blockTranslationsRef.current,
              progress.translations,
            );
            const mergedSourceHashes = withCurrentSourceHashes(
              mergedTranslations,
              mergeSourceHashes(translationSourceHashesRef.current, blockSourceHashes),
            );

            applyTranslationState(mergedTranslations, mergedSourceHashes);
            setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
            setTranslationProgressCompleted(progress.translatedCount);
            publishTranslationProgress(progress.translatedCount, progress.totalBlocks);

            if (progress.translatedCount > 0) {
              try {
                await saveTranslationCache(
                  currentDocument,
                  mergedTranslations,
                  mergedSourceHashes,
                );
                cacheWriteError = null;
              } catch (cacheError) {
                cacheWriteError = cacheError;
                console.error('Failed to save retranslated block progress', cacheError);
              }
            }
          },
          reasoningEffort: getModelRuntimeConfig(settings, "translation").reasoningEffort,
          requestsPerMinute: settings.translationRequestsPerMinute,
          signal: abortController.signal,
          sourceLanguage: settings.translationSourceLanguage,
          targetLanguage: settings.translationTargetLanguage,
          temperature: getModelRuntimeConfig(settings, "translation").temperature,
          translateBatch: translateBlocksOpenAICompatible,
        });

        if (documentTranslationRequestIdRef.current !== requestId) {
          return;
        }

        const nextTranslations = mergeReaderTranslations(
          blockTranslationsRef.current,
          result.translations,
        );
        const translatedText = result.translations[block.blockId]?.trim() ?? "";
        const nextSourceHashes = withCurrentSourceHashes(
          nextTranslations,
          mergeSourceHashes(translationSourceHashesRef.current, blockSourceHashes),
        );

        applyTranslationState(nextTranslations, nextSourceHashes);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setTranslationProgressCompleted(translatedText ? 1 : 0);
        try {
          await saveTranslationCache(currentDocument, nextTranslations, nextSourceHashes);
          cacheWriteError = null;
        } catch (cacheError) {
          cacheWriteError = cacheError;
          console.error('Failed to save retranslated block', cacheError);
        }

        const cacheStatusSuffix = cacheWriteError
          ? lRef.current(
              '；译文缓存写入失败，本次结果仅保留在当前窗口',
              '; the translation cache could not be written, so this result is only available in the current window',
            )
          : '';

        if (result.cancelled) {
          const message = lRef.current(
            "已取消单块重译，原有译文已保留。",
            "Block retranslation cancelled. Existing translation was kept.",
          );
          const finalMessage = `${message}${cacheStatusSuffix}`;
          setStatusMessage(finalMessage);
          updateLibraryOperation(
            "translation",
            cacheWriteError ? "error" : "success",
            finalMessage,
            translatedText ? 1 : 0,
            1,
          );
          if (cacheWriteError) {
            setError(translationCacheFailureMessage(cacheWriteError));
            settleTranslationTask(requestId, "error", finalMessage);
          } else {
            settleTranslationTask(requestId, "dismiss");
          }
          return;
        }

        if (!translatedText) {
          const message = lRef.current(
            "这个结构块重译失败，已保留原有译文。",
            "Failed to retranslate this block. Existing translation was kept.",
          );
          setStatusMessage(message);
          updateLibraryOperation("translation", "error", message, 1, 1);
          setError(
            sanitizeTranslationErrorMessage(
              result.failureMessages[0],
              lRef.current,
              "document",
            ),
          );
          settleTranslationTask(requestId, "error", message);
          return;
        }

        const message = lRef.current(
          "已重新翻译当前结构块",
          "Retranslated the selected structured block",
        );
        const finalMessage = `${message}${cacheStatusSuffix}`;
        setStatusMessage(finalMessage);
        updateLibraryOperation(
          "translation",
          cacheWriteError ? "error" : "success",
          finalMessage,
          1,
          1,
        );
        if (cacheWriteError) {
          setError(translationCacheFailureMessage(cacheWriteError));
          settleTranslationTask(requestId, "error", finalMessage);
        } else {
          settleTranslationTask(requestId, "success");
        }
      } catch (error) {
        if (documentTranslationRequestIdRef.current !== requestId) {
          return;
        }

        const message = sanitizeTranslationErrorMessage(
          error,
          lRef.current,
          "document",
        );
        setError(message);
        setStatusMessage(message);
        updateLibraryOperation("translation", "error", message, 1, 1);
        settleTranslationTask(requestId, "error", message);
      } finally {
        if (documentTranslationRequestIdRef.current === requestId) {
          setTranslating(false);
          setTranslationCancelling(false);
          setTranslationProgressTotal(0);
          if (documentTranslationAbortControllerRef.current === abortController) {
            documentTranslationAbortControllerRef.current = null;
          }
        }
      }
    },
    [
      applyTranslationState,
      currentDocument,
      getOverrideMarkdown,
      libraryOperationRunning,
      onOpenPreferences,
      saveTranslationCache,
      setError,
      setStatusMessage,
      settings.translationRequestsPerMinute,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      translating,
      publishTranslationProgress,
      settleTranslationTask,
      translationModelPreset,
      updateLibraryOperation,
      lRef,
    ],
  );

  const handleClearTranslations = useCallback(() => {
    const targetLanguage = settings.translationTargetLanguage;

    // 先同步推进清除标记与 generation：正在进行的磁盘恢复读取会在 await
    // 之后检查 token，发现已经清除就不再回填旧译文。
    markTranslationCacheCleared(currentDocument, targetLanguage);
    applyTranslationState({}, {});

    void deleteTranslationCache({
      item: currentDocument,
      mineruCacheDir: settings.mineruCacheDir,
      targetLanguage,
      identity: documentTranslationCacheIdentity,
    })
      .then(({ failed }) => {
        if (failed.length === 0) {
          setStatusMessage(
            lRef.current(
              "已清空当前文稿的译文缓存",
              "Cleared the translation cache for the current paper",
            ),
          );
          return;
        }

        // 删除失败时不假装成功：保留会话清除标记，并如实报告失败的缓存文件。
        const firstFailure = failed[0];
        const extraSuffix = failed.length > 1 ? ` (+${failed.length - 1})` : "";
        const detail = `${firstFailure.path}: ${firstFailure.message}${extraSuffix}`;

        setStatusMessage(
          lRef.current(
            `已清空当前文稿的译文缓存，但部分磁盘缓存删除失败：${detail}`,
            `Cleared the translation cache for the current paper, but some disk cache files could not be deleted: ${detail}`,
          ),
        );
      })
      .catch((error) => {
        const detail = translationCacheFailureMessage(error);

        setStatusMessage(
          lRef.current(
            `已清空当前文稿的译文缓存，但部分磁盘缓存删除失败：${detail}`,
            `Cleared the translation cache for the current paper, but some disk cache files could not be deleted: ${detail}`,
          ),
        );
      });
  }, [
    applyTranslationState,
    currentDocument,
    documentTranslationCacheIdentity,
    settings.mineruCacheDir,
    settings.translationTargetLanguage,
    setStatusMessage,
    lRef,
  ]);

  const applySelectedExcerptTranslation = useCallback(
    (translation: string) => {
      selectionRequestKeyRef.current = "";
      setSelectedExcerptTranslation(translation);
      setSelectedExcerptTranslating(false);
      setSelectedExcerptError("");
    },
    [],
  );

  const handleTranslateSelectedExcerpt = useCallback(
    async (openPreferencesOnMissingKey = true) => {
      if (!selectedExcerpt) {
        setStatusMessage(
          lRef.current("请先选中一段文本", "Select a text passage first"),
        );
        setSelectedExcerptError(
          lRef.current(
            "请先在 PDF 或结构块视图中选中需要翻译的文本。",
            "Select text in the PDF or structured block view before translating it.",
          ),
        );
        return;
      }

      const selectionRequestKey = `${selectedExcerpt.source}::${selectedExcerpt.text}`;

      if (selectionRequestKeyRef.current === selectionRequestKey) {
        return;
      }

      if (
        !selectionTranslationModelPreset ||
        !selectionTranslationModelPreset.baseUrl.trim()
      ) {
        setSelectedExcerptTranslation("");
        setSelectedExcerptError(
          lRef.current(
            "请先在设置中填写 OpenAI 兼容 Base URL。",
            "Configure the OpenAI-compatible Base URL in Settings first.",
          ),
        );
        setStatusMessage(
          lRef.current("缺少翻译接口 Base URL", "Missing translation Base URL"),
        );

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!selectionTranslationModelPreset.apiKey.trim()) {
        setSelectedExcerptTranslation("");
        setSelectedExcerptError(
          lRef.current(
            "请先在设置中填写 AI 接口 API Key。",
            "Configure the AI API key in Settings first.",
          ),
        );
        setStatusMessage(
          lRef.current("缺少翻译接口 API Key", "Missing translation API key"),
        );

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!selectionTranslationModelPreset.model.trim()) {
        setSelectedExcerptTranslation("");
        setSelectedExcerptError(
          lRef.current(
            "请先在设置中填写模型名称。",
            "Configure the model name in Settings first.",
          ),
        );
        setStatusMessage(
          lRef.current("缺少翻译模型名称", "Missing translation model name"),
        );

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      const requestId = selectedExcerptRequestIdRef.current + 1;
      selectedExcerptRequestIdRef.current = requestId;
      selectionRequestKeyRef.current = selectionRequestKey;

      setSelectedExcerptTranslating(true);
      setSelectedExcerptError("");
      setStatusMessage(
        lRef.current(
          "正在翻译划词内容…",
          "Translating the selected excerpt...",
        ),
      );

      try {
        const translatedText = (
          await translateTextOpenAICompatible({
            baseUrl: selectionTranslationModelPreset.baseUrl,
            apiKey: selectionTranslationModelPreset.apiKey.trim(),
            model: selectionTranslationModelPreset.model,
            apiMode: selectionTranslationModelPreset.apiMode,
            temperature: getModelRuntimeConfig(settings, "selectionTranslation")
              .temperature,
            reasoningEffort: getModelRuntimeConfig(
              settings,
              "selectionTranslation",
            ).reasoningEffort,
            sourceLanguage: settings.translationSourceLanguage,
            targetLanguage: settings.translationTargetLanguage,
            text: selectedExcerpt.text,
            requestsPerMinute: settings.translationRequestsPerMinute,
          })
        ).trim();

        if (selectedExcerptRequestIdRef.current !== requestId) {
          return;
        }

        setSelectedExcerptTranslation(translatedText);

        if (!translatedText) {
          setSelectedExcerptError(
            lRef.current(
              "翻译结果为空，请稍后重试。",
              "The translation result was empty. Please try again later.",
            ),
          );
          setStatusMessage(
            lRef.current(
              "划词翻译结果为空",
              "Selected-text translation returned no content",
            ),
          );
          return;
        }

        setStatusMessage(
          lRef.current("划词翻译完成", "Selected-text translation complete"),
        );
      } catch (error) {
        if (selectedExcerptRequestIdRef.current !== requestId) {
          return;
        }

        const message = sanitizeTranslationErrorMessage(
          error,
          lRef.current,
          "selection",
        );

        setSelectedExcerptTranslation("");
        setSelectedExcerptError(message);
        setStatusMessage(message);
      } finally {
        if (selectionRequestKeyRef.current === selectionRequestKey) {
          selectionRequestKeyRef.current = "";
        }

        if (selectedExcerptRequestIdRef.current === requestId) {
          setSelectedExcerptTranslating(false);
        }
      }
    },
    [
      onOpenPreferences,
      selectedExcerpt,
      selectionTranslationModelPreset,
      setStatusMessage,
      settings.translationRequestsPerMinute,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      lRef,
    ],
  );

  const resetDocumentTranslationState = useCallback(() => {
    documentTranslationAbortControllerRef.current?.abort();
    documentTranslationAbortControllerRef.current = null;
    documentTranslationRequestIdRef.current += 1;
    translationPublishGateRef.current = null;
    removeBackgroundTask(translationTaskIdRef.current);
    selectionRequestKeyRef.current = "";
    applyTranslationState({}, {});
    setBlockTranslationTargetLanguage("");
    setTranslating(false);
    setTranslationCancelling(false);
    setTranslationProgressCompleted(0);
    setTranslationProgressTotal(0);
    setSelectedExcerptTranslation("");
    setSelectedExcerptTranslating(false);
    setSelectedExcerptError("");
  }, [applyTranslationState]);

  const resetSelectedExcerptTranslationState = useCallback(() => {
    selectionRequestKeyRef.current = "";
    setSelectedExcerptTranslation("");
    setSelectedExcerptTranslating(false);
    setSelectedExcerptError("");
  }, []);

  return {
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
  };
}
