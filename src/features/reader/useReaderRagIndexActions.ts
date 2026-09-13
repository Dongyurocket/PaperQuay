import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { flattenMineruPages, parseMineruPages } from '../../services/mineru';
import { ragListIndexStatuses } from '../../services/rag';
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

interface UseReaderRagIndexActionsOptions {
  allKnownItems: WorkspaceItem[];
  configHydrated: boolean;
  embeddingApiKey: string;
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
  handleBatchRagIndex: (options?: { onlyFailed?: boolean }) => Promise<void>;
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

  const indexableItems = useMemo(
    () =>
      allKnownItems
        .filter((item) => item.source === 'native-library')
        .map((item) => ({
          documentKey: item.itemKey,
          workspaceId: item.workspaceId,
          title: item.title,
          item,
        })),
    [allKnownItems],
  );

  const ragBadgeByDocumentKey = useMemo(() => {
    const badges: Record<string, RagAggregateStatus> = {};

    for (const { documentKey } of indexableItems) {
      badges[documentKey] = aggregateRagIndexStatus(ragStatusByDocumentKey[documentKey]);
    }

    return badges;
  }, [indexableItems, ragStatusByDocumentKey]);

  const ragIndexOverview = useMemo(
    () =>
      summarizeRagIndexOverview({
        items: indexableItems,
        mineruParsedByWorkspaceId: itemParseStatusMap,
        statusByDocumentKey: ragStatusByDocumentKey,
      }),
    [indexableItems, itemParseStatusMap, ragStatusByDocumentKey],
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
    async ({ onlyFailed = false }: { onlyFailed?: boolean } = {}) => {
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
        mineruParsedByWorkspaceId: itemParseStatusMap,
        statusByDocumentKey: ragStatusByDocumentKey,
        onlyFailed,
      });

      if (candidates.length === 0) {
        setStatusMessage(
          onlyFailed
            ? l('当前没有索引失败的文献。', 'No papers with failed indexes right now.')
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

            if (result.outcome === 'failed') progress.failed += 1;
            else if (result.outcome === 'skipped') progress.skipped += 1;
            else progress.succeeded += 1;
          } catch {
            progress.failed += 1;
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
      setStatusMessage(
        l(
          `RAG 索引${cancelled ? '已取消，' : ''}完成 ${progress.completed}/${progress.total}：成功 ${progress.succeeded}，跳过 ${progress.skipped}，失败 ${progress.failed}。`,
          `RAG indexing ${cancelled ? 'cancelled, ' : ''}finished ${progress.completed}/${progress.total}: ${progress.succeeded} succeeded, ${progress.skipped} skipped, ${progress.failed} failed.`,
        ),
      );
    },
    [
      indexOneItem,
      indexableItems,
      itemParseStatusMap,
      l,
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

      const entry = indexableItems.find((candidate) => candidate.documentKey === documentKey);

      if (!entry) {
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
        } else if (result.outcome === 'skipped') {
          setStatusMessage(
            l(`《${entry.title}》暂无可索引内容。`, `Nothing indexable for "${entry.title}" yet.`),
          );
        } else {
          setStatusMessage(l(`《${entry.title}》索引完成。`, `Finished indexing "${entry.title}".`));
        }
      } finally {
        setRagIndexingDocumentKey('');
        await refreshRagIndexStatuses();
      }
    },
    [indexOneItem, indexableItems, l, ragIndexAvailable, refreshRagIndexStatuses, setStatusMessage],
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
