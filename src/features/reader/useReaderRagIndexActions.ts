import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { flattenMineruPages, parseMineruPages } from '../../services/mineru';
import { buildRagEmbeddingModelKey, ragListIndexStatuses } from '../../services/rag';
import {
  aggregateRagIndexStatus,
  groupRagIndexStatuses,
  RAG_INDEX_STATUS_UPDATED_EVENT,
  selectRagIndexCandidates,
  summarizeRagIndexOverview,
  type RagAggregateStatus,
  type RagIndexOverview,
} from '../../services/ragIndexStatus';
import type { RagDocumentIndexStatus, ReaderSettings, WorkspaceItem } from '../../types/reader';
import { indexLibraryPaperMineruSource } from './libraryRagIndexing';
import { EMPTY_BATCH_PROGRESS, sleep, type BatchProgressState } from './readerShared';

type LocaleTextPicker = <T>(zh: T, en: T) => T;

/** embedding 认证/余额错误：批量任务应立即停止，而不是逐篇失败。 */
function isRagAuthOrBillingError(message: string | undefined | null): boolean {
  return /HTTP\s+(401|402|403)\b/i.test(String(message ?? ''));
}

interface UseReaderRagIndexActionsOptions {
  allKnownItems: WorkspaceItem[];
  configHydrated: boolean;
  embeddingApiKey: string;
  /** 全库文献条目（按需加载）；缺省时只覆盖已打开文献。 */
  libraryItems?: WorkspaceItem[];
  /** 全库 MinerU 解析状态（workspaceId → 是否已解析）。 */
  libraryMineruParsed?: Record<string, boolean | undefined>;
  /** 单篇按需解析：文献库详情页或批量任务遇到尚未加载的文献时使用。 */
  resolveIndexableItem?: (documentKey: string) => Promise<WorkspaceItem | null>;
  findExistingMineruJson: (
    item: WorkspaceItem,
  ) => Promise<{ jsonText: string; path: string } | null>;
  itemParseStatusMap: Record<string, boolean | undefined>;
  l: LocaleTextPicker;
  setStatusMessage: (message: string) => void;
  settings: ReaderSettings;
}

export interface UseReaderRagIndexActionsResult {
  ragIndexAvailable: boolean;
  /** documentKey（native-library 即 paper id）→ 聚合角标状态 */
  ragBadgeByDocumentKey: Record<string, RagAggregateStatus>;
  ragIndexOverview: RagIndexOverview;
  ragIndexPaused: boolean;
  ragIndexProgress: BatchProgressState;
  ragIndexRunning: boolean;
  ragIndexingDocumentKey: string;
  ragStatusByDocumentKey: Record<string, RagDocumentIndexStatus[]>;
  handleBatchRagIndex: (options?: { onlyFailed?: boolean; onlyStale?: boolean }) => Promise<void>;
  handleCancelRagIndex: () => void;
  handleIndexPaperRag: (documentKey: string) => Promise<void>;
  handleToggleRagIndexPause: () => void;
  refreshRagIndexStatuses: () => Promise<void>;
}

export function useReaderRagIndexActions({
  allKnownItems,
  configHydrated,
  embeddingApiKey,
  findExistingMineruJson,
  libraryItems,
  libraryMineruParsed,
  resolveIndexableItem,
  itemParseStatusMap,
  l,
  setStatusMessage,
  settings,
}: UseReaderRagIndexActionsOptions): UseReaderRagIndexActionsResult {
  const [statusEntries, setStatusEntries] = useState<RagDocumentIndexStatus[]>([]);
  const [ragIndexRunning, setRagIndexRunning] = useState(false);
  const [ragIndexPaused, setRagIndexPaused] = useState(false);
  const [ragIndexingDocumentKey, setRagIndexingDocumentKey] = useState('');
  const [ragIndexProgress, setRagIndexProgress] =
    useState<BatchProgressState>(EMPTY_BATCH_PROGRESS);

  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const cancelRequestedRef = useRef(false);

  const ragIndexAvailable = Boolean(
    settings.localRagEnabled &&
      settings.ragSourceMode !== 'off' &&
      settings.embeddingBaseUrl.trim() &&
      settings.embeddingModel.trim() &&
      embeddingApiKey.trim(),
  );

  const refreshRagIndexStatuses = useCallback(async () => {
    try {
      setStatusEntries(await ragListIndexStatuses());
    } catch {
      // 状态列表仅用于展示，失败时不打断使用；保留旧数据。
    }
  }, []);

  useEffect(() => {
    if (configHydrated) {
      void refreshRagIndexStatuses();
    }
  }, [configHydrated, refreshRagIndexStatuses]);

  // 任意索引路径（自动/手动、本组件或阅读器懒索引）完成后都会派发该事件，统一刷新角标。
  useEffect(() => {
    let timer: number | undefined;

    const handleUpdated = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void refreshRagIndexStatuses();
      }, 400);
    };

    window.addEventListener(RAG_INDEX_STATUS_UPDATED_EVENT, handleUpdated);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(RAG_INDEX_STATUS_UPDATED_EVENT, handleUpdated);
    };
  }, [refreshRagIndexStatuses]);

  const ragStatusByDocumentKey = useMemo(
    () => groupRagIndexStatuses(statusEntries),
    [statusEntries],
  );

  const aggregateOptions = useMemo(
    () => ({
      embeddingModelKey: buildRagEmbeddingModelKey({
        baseUrl: settings.embeddingBaseUrl,
        apiKey: embeddingApiKey,
        model: settings.embeddingModel,
        dimensions: settings.embeddingDimensions,
        timeoutSeconds: settings.embeddingRequestTimeoutSeconds,
      }),
    }),
    [
      embeddingApiKey,
      settings.embeddingBaseUrl,
      settings.embeddingDimensions,
      settings.embeddingModel,
      settings.embeddingRequestTimeoutSeconds,
    ],
  );

  const mergedParseStatusMap = useMemo(
    () => ({ ...itemParseStatusMap, ...libraryMineruParsed }),
    [itemParseStatusMap, libraryMineruParsed],
  );

  const indexableItems = useMemo(() => {
    const byDocumentKey = new Map<
      string,
      {
        documentKey: string;
        workspaceId: string;
        title: string;
        ragEnabled?: boolean;
        item: WorkspaceItem;
      }
    >();

    for (const item of [...allKnownItems, ...(libraryItems ?? [])]) {
      if (item.source !== 'native-library' || byDocumentKey.has(item.itemKey)) {
        continue;
      }

      byDocumentKey.set(item.itemKey, {
        documentKey: item.itemKey,
        workspaceId: item.workspaceId,
        title: item.title,
        ragEnabled: item.ragEnabled,
        item,
      });
    }

    return Array.from(byDocumentKey.values());
  }, [allKnownItems, libraryItems]);

  // 角标必须以索引状态列表为准：它覆盖全库，不依赖文献是否已打开。
  const ragBadgeByDocumentKey = useMemo(() => {
    const badges: Record<string, RagAggregateStatus> = {};

    for (const [documentKey, entries] of Object.entries(ragStatusByDocumentKey)) {
      badges[documentKey] = aggregateRagIndexStatus(entries, aggregateOptions);
    }

    return badges;
  }, [aggregateOptions, ragStatusByDocumentKey]);

  const ragIndexOverview = useMemo(
    () =>
      summarizeRagIndexOverview({
        items: indexableItems,
        mineruParsedByWorkspaceId: mergedParseStatusMap,
        statusByDocumentKey: ragStatusByDocumentKey,
        aggregateOptions,
      }),
    [aggregateOptions, indexableItems, mergedParseStatusMap, ragStatusByDocumentKey],
  );

  const indexOneItem = useCallback(
    async (entry: (typeof indexableItems)[number]) => {
      const existingParse = await findExistingMineruJson(entry.item);

      if (!existingParse) {
        return { outcome: 'skipped' as const };
      }

      const blocks = flattenMineruPages(parseMineruPages(existingParse.jsonText));

      return indexLibraryPaperMineruSource({
        item: entry.item,
        settings,
        embeddingApiKey,
        blocks,
        mineruPath: existingParse.path,
        force: true,
        l,
      });
    },
    [embeddingApiKey, findExistingMineruJson, l, settings],
  );

  const handleBatchRagIndex = useCallback(
    async ({ onlyFailed = false, onlyStale = false }: { onlyFailed?: boolean; onlyStale?: boolean } = {}) => {
      if (runningRef.current) {
        return;
      }

      if (!ragIndexAvailable) {
        setStatusMessage(
          l(
            '请先在设置中启用本地 RAG 并完成 Embedding 配置。',
            'Enable local RAG and finish the embedding configuration in settings first.',
          ),
        );
        return;
      }

      const candidates = selectRagIndexCandidates({
        items: indexableItems,
        mineruParsedByWorkspaceId: mergedParseStatusMap,
        statusByDocumentKey: ragStatusByDocumentKey,
        aggregateOptions,
        onlyFailed,
        onlyStale,
      });

      if (candidates.length === 0) {
        setStatusMessage(
          onlyFailed
            ? l('当前没有索引失败的文献。', 'No papers with failed indexes right now.')
            : onlyStale
              ? l('当前没有需要更新的索引。', 'No indexes need updating right now.')
              : l('当前没有需要建立索引的文献。', 'No papers need indexing right now.'),
        );
        return;
      }

      runningRef.current = true;
      cancelRequestedRef.current = false;
      pausedRef.current = false;
      setRagIndexRunning(true);
      setRagIndexPaused(false);
      setRagIndexProgress({
        running: true,
        paused: false,
        cancelRequested: false,
        total: candidates.length,
        completed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        currentLabel: '',
      });

      const progress: BatchProgressState = {
        running: true,
        paused: false,
        cancelRequested: false,
        total: candidates.length,
        completed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        currentLabel: '',
      };

      const syncProgress = () => setRagIndexProgress({ ...progress });
      let firstFailureMessage = '';
      let haltedForAuth = false;

      try {
        for (const entry of candidates) {
          if (cancelRequestedRef.current) {
            break;
          }

          while (pausedRef.current && !cancelRequestedRef.current) {
            progress.paused = true;
            syncProgress();
            await sleep(400);
          }

          if (cancelRequestedRef.current) {
            break;
          }

          progress.paused = false;
          progress.currentLabel = entry.title;
          syncProgress();
          setRagIndexingDocumentKey(entry.documentKey);

          try {
            const result = await indexOneItem(entry);

            if (result.outcome === 'failed') {
              progress.failed += 1;
              firstFailureMessage ||= result.errorMessage ?? '';

              if (isRagAuthOrBillingError(result.errorMessage)) {
                // 余额不足 / Key 失效时继续只会把剩余文献全部标失败。
                haltedForAuth = true;
                cancelRequestedRef.current = true;
                break;
              }
            } else if (result.outcome === 'skipped' || result.outcome === 'excluded') {
              progress.skipped += 1;
            } else {
              progress.succeeded += 1;
            }
          } catch (error) {
            progress.failed += 1;
            const message = error instanceof Error ? error.message : String(error ?? '');
            firstFailureMessage ||= message;

            if (isRagAuthOrBillingError(message)) {
              haltedForAuth = true;
              cancelRequestedRef.current = true;
              break;
            }
          }

          progress.completed += 1;
          syncProgress();
          await refreshRagIndexStatuses();
        }
      } finally {
        setRagIndexingDocumentKey('');
        runningRef.current = false;
        pausedRef.current = false;
        setRagIndexRunning(false);
        setRagIndexPaused(false);
        setRagIndexProgress((current) => ({ ...current, running: false, paused: false }));
        await refreshRagIndexStatuses();
      }

      const cancelled = cancelRequestedRef.current;
      const failureSuffix =
        progress.failed > 0 && firstFailureMessage
          ? l(` 首个失败原因：${firstFailureMessage}`, ` First failure: ${firstFailureMessage}`)
          : '';
      const stopReason = haltedForAuth
        ? l('已暂停（Embedding 认证或余额异常），', 'paused after an embedding auth/balance error, ')
        : cancelled
          ? l('已取消，', 'cancelled, ')
          : '';
      setStatusMessage(
        l(
          `RAG 索引${stopReason}完成 ${progress.completed}/${progress.total}：成功 ${progress.succeeded}，跳过 ${progress.skipped}，失败 ${progress.failed}。${failureSuffix}`,
          `RAG indexing ${stopReason}finished ${progress.completed}/${progress.total}: ${progress.succeeded} succeeded, ${progress.skipped} skipped, ${progress.failed} failed.${failureSuffix}`,
        ),
      );
    },
    [
      aggregateOptions,
      indexOneItem,
      indexableItems,
      l,
      mergedParseStatusMap,
      ragIndexAvailable,
      ragStatusByDocumentKey,
      refreshRagIndexStatuses,
      setStatusMessage,
    ],
  );

  const handleIndexPaperRag = useCallback(
    async (documentKey: string) => {
      if (!ragIndexAvailable) {
        setStatusMessage(
          l(
            '请先在设置中启用本地 RAG 并完成 Embedding 配置。',
            'Enable local RAG and finish the embedding configuration in settings first.',
          ),
        );
        return;
      }

      let entry = indexableItems.find((candidate) => candidate.documentKey === documentKey);

      if (!entry && resolveIndexableItem) {
        try {
          const item = await resolveIndexableItem(documentKey);

          if (item) {
            entry = {
              documentKey: item.itemKey,
              workspaceId: item.workspaceId,
              title: item.title,
              ragEnabled: item.ragEnabled,
              item,
            };
          }
        } catch {
          // 解析失败按未找到处理，状态栏给出提示。
        }
      }

      if (!entry) {
        setStatusMessage(
          l('未找到该文献对应的阅读器条目。', 'Document entry not found for this paper.'),
        );
        return;
      }

      setRagIndexingDocumentKey(documentKey);
      setStatusMessage(l(`正在为《${entry.title}》建立 RAG 索引…`, `Indexing "${entry.title}"…`));

      try {
        const result = await indexOneItem(entry);

        if (result.outcome === 'failed') {
          setStatusMessage(
            l(
              `《${entry.title}》索引失败：${result.errorMessage ?? '未知错误'}`,
              `Failed to index "${entry.title}": ${result.errorMessage ?? 'unknown error'}`,
            ),
          );
        } else if (result.outcome === 'excluded') {
          setStatusMessage(
            l(
              `《${entry.title}》已移出本地知识库，请先加入后再建立索引。`,
              `"${entry.title}" is excluded from the local knowledge base. Include it before indexing.`,
            ),
          );
        } else if (result.outcome === 'skipped') {
          setStatusMessage(
            l(`《${entry.title}》暂无可索引内容。`, `Nothing indexable for "${entry.title}" yet.`),
          );
        } else {
          setStatusMessage(l(`《${entry.title}》索引完成。`, `Finished indexing "${entry.title}".`));
        }
      } catch (error) {
        // indexOneItem 上层（状态查询/缓存读取等 IPC）可能直接抛错，
        // 必须在状态栏给出反馈，否则按钮看起来“点了没反应”。
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(
          l(
            `《${entry.title}》索引失败：${message || '未知错误'}`,
            `Failed to index "${entry.title}": ${message || 'unknown error'}`,
          ),
        );
      } finally {
        setRagIndexingDocumentKey('');
        await refreshRagIndexStatuses();
      }
    },
    [
      indexOneItem,
      indexableItems,
      l,
      ragIndexAvailable,
      refreshRagIndexStatuses,
      resolveIndexableItem,
      setStatusMessage,
    ],
  );

  const handleToggleRagIndexPause = useCallback(() => {
    if (!runningRef.current) {
      return;
    }

    pausedRef.current = !pausedRef.current;
    setRagIndexPaused(pausedRef.current);
    setRagIndexProgress((current) => ({ ...current, paused: pausedRef.current }));
  }, []);

  const handleCancelRagIndex = useCallback(() => {
    if (!runningRef.current) {
      return;
    }

    cancelRequestedRef.current = true;
    pausedRef.current = false;
    setRagIndexProgress((current) => ({ ...current, cancelRequested: true, paused: false }));
  }, []);

  return {
    ragIndexAvailable,
    ragBadgeByDocumentKey,
    ragIndexOverview,
    ragIndexPaused,
    ragIndexProgress,
    ragIndexRunning,
    ragIndexingDocumentKey,
    ragStatusByDocumentKey,
    handleBatchRagIndex,
    handleCancelRagIndex,
    handleIndexPaperRag,
    handleToggleRagIndexPause,
    refreshRagIndexStatuses,
  };
}
