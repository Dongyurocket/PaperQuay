import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getCurrentWindow } from '../../platform/electron/window';

import {
  JUMP_TO_NOTE_ANCHOR_EVENT,
  OPEN_LIBRARY_PAPER_EVENT,
  OPEN_PREFERENCES_EVENT,
  OPEN_STANDALONE_PDF_EVENT,
  type JumpToNoteAnchorEventDetail,
  type OpenLibraryPaperEventDetail,
  type OpenPreferencesEventDetail,
} from '../../app/appEvents';
import { localPathsExist, repairMineruCacheImages, selectDirectory, selectLocalPdfSource } from '../../services/desktop';
import { ragCompactStorage, ragStorageStats } from '../../services/rag';
import { buildMineruCachePathCandidates } from '../../utils/mineruCache';
import { formatFileSize } from '../../utils/files';
import {
  addLibraryAttachment,
  getLibraryPaper,
  listAllLibraryPapers,
} from '../../services/library';
import { AppLocaleProvider } from '../../i18n/uiLanguage';
import { getHomeTabTitle, HOME_TAB_ID, type ReaderTab, useTabsStore } from '../../stores/useTabsStore';
import {
  createQaSession,
  type ReaderTabBridgeState,
} from './documentReaderShared';
import type {
  LiteraturePaper,
  LiteraturePaperTaskKind,
  LiteraturePaperTaskState,
} from '../../types/library';
import { ATTACHMENT_KIND_TRANSLATED_PDF } from '../../utils/libraryPaper';
import type {
  RagStorageStats,
  DocumentChatSession,
  TranslationDisplayMode,
  WorkspaceItem,
} from '../../types/reader';
import DocumentReaderTab from './DocumentReaderTab';
import { chooseMountedReaderTabIds, collectBusyReaderTabIds } from './readerResourceBudget';
import { canSeedInitialQaSession } from './readerQaSessionLifecycle';
import { AssistantSidebar } from './AssistantSidebar';
import { usePointerDragResize } from './usePointerDragResize';
import LiteratureLibraryView from '../literature/LiteratureLibraryView';
import { mineruOutputPathCandidatesForPaper } from '../literature/literatureLibraryUtils';
import TranslatedPdfLanguageConfirmDialog from '../literature/components/TranslatedPdfLanguageConfirmDialog';
import {
  emitLibraryMetadataEnrichRequest,
  emitNativePaperUpdated,
  NATIVE_PAPER_UPDATED_EVENT,
  type NativePaperUpdatedEventDetail,
} from '../literature/libraryEvents';
import { readPdfPageCount } from '../literature/pdfPageCount';
import ReaderPreferencesWindow from './ReaderPreferencesWindow';
import { useReaderLibraryActions } from './useReaderLibraryActions';
import { useReaderRagIndexActions } from './useReaderRagIndexActions';
import { useReaderLibraryPreview } from './useReaderLibraryPreview';
import { useReaderSettings } from './useReaderSettings';
import { useReaderZoteroSync } from './useReaderZoteroSync';
import {
  buildPaperTaskState as buildLocalizedPaperTaskState,
} from './paperTaskState';
import {
  MAX_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
} from './readerWorkspaceShared';
import { useReaderLayoutStore } from '../../stores/useReaderLayoutStore';
import { createReaderQaTabActions, removeReaderQaTab, useReaderQaStore } from '../../stores/useReaderQaStore';
import {
  mergeLocalPdfPath,
  createNativeLibraryWorkspaceItem,
  resolveLanguageLabel,
  type PreferencesSectionKey,
} from './readerShared';
import { confirmAction } from '../../ui/confirmHost';
import { normalizeNotePaperTarget } from '../notes/notePaperTarget';

const EMPTY_READER_QA_SESSIONS: DocumentChatSession[] = [];

interface ReaderProps {  workspaceActive?: boolean;
}

function resolveNoteAnchorWorkspaceId(detail: JumpToNoteAnchorEventDetail) {
  const rawTarget = (
    detail.targetPaperId ||
    detail.anchorPaperId ||
    detail.notePaperId ||
    ''
  ).trim();

  return normalizeNotePaperTarget(rawTarget);
}

function isNoteAnchorJumpForWorkspace(
  detail: JumpToNoteAnchorEventDetail | null,
  workspaceId: string,
) {
  return Boolean(detail && resolveNoteAnchorWorkspaceId(detail) === workspaceId);
}

function areReaderTabBridgeStatesEqual(
  left: ReaderTabBridgeState | null | undefined,
  right: ReaderTabBridgeState | null | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.translating === right.translating &&
    left.qaRunning === right.qaRunning &&
    left.translatedCount === right.translatedCount &&
    left.assistantSidebarProps === right.assistantSidebarProps &&
    left.onDetachAssistant === right.onDetachAssistant &&
    left.onAttachAssistant === right.onAttachAssistant &&
    left.onTranslate === right.onTranslate &&
    left.onCancelTranslate === right.onCancelTranslate &&
    left.onClearTranslations === right.onClearTranslations &&
    left.onCloudParse === right.onCloudParse &&
    left.onGenerateSummary === right.onGenerateSummary
  );
}

function Reader({ workspaceActive = true }: ReaderProps) {
  const appWindow = getCurrentWindow();
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openTab = useTabsStore((state) => state.openTab);
  const setHomeTabTitle = useTabsStore((state) => state.setHomeTabTitle);

  const [, setStatusMessage] = useState('');
  const [, setError] = useState('');
  const {
    configHydrated,
    l,
    librarySettings,
    qaModelPresets,
    readerSecrets,
    settings,
    setZoteroLocalDataDir,
    summaryConfigured,
    summaryModelPreset,
    syncNativeLibraryZoteroDir,
    translationModelPreset,
    updateNativeLibrarySettings,
    updateQaModelPreset,
    updateReaderSecret,
    updateSetting,
    addQaModelPreset,
    removeQaModelPreset,
    zoteroLocalDataDir,
  } = useReaderSettings({
    setError,
    setStatusMessage,
  });

  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferredPreferencesSection, setPreferredPreferencesSection] = useState<PreferencesSectionKey | undefined>(undefined);
  const readerMainRef = useRef<HTMLDivElement | null>(null);

  const [standaloneItems, setStandaloneItems] = useState<WorkspaceItem[]>([]);
  const [nativeLibraryItems, setNativeLibraryItems] = useState<WorkspaceItem[]>([]);
  const [translatedPdfAttachDraft, setTranslatedPdfAttachDraft] = useState<{ item: WorkspaceItem; sourcePath: string } | null>(null);
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [readerBridges, setReaderBridges] = useState<Record<string, ReaderTabBridgeState>>({});
  const [recentReaderTabIds, setRecentReaderTabIds] = useState<string[]>([]);
  const readerAssistantDetached = useReaderLayoutStore((state) => state.assistantDetached);
  const readerAssistantPanelWidth = useReaderLayoutStore((state) => state.assistantPanelWidth);
  const setReaderAssistantPanelWidth = useReaderLayoutStore((state) => state.setAssistantPanelWidth);
  const readerAssistantPanelResizing = useReaderLayoutStore((state) => state.assistantPanelResizing);
  const setReaderAssistantPanelResizing = useReaderLayoutStore((state) => state.setAssistantPanelResizing);
  const persistReaderAssistantPanelWidth = useReaderLayoutStore((state) => state.persistAssistantPanelWidth);
  const latestAssistantPanelWidthRef = useRef(readerAssistantPanelWidth);
  const startAssistantPanelResize = usePointerDragResize();
  const activeReaderTabId = useMemo(() => {
    const tab = tabs.find((item) => item.id === activeTabId);
    return tab?.type === 'reader' ? tab.id : '';
  }, [activeTabId, tabs]);
  const readerQaActions = useMemo(
    () => createReaderQaTabActions(activeReaderTabId),
    [activeReaderTabId],
  );
  const readerQaSessions = useReaderQaStore(
    (state) => (activeReaderTabId ? state.tabs[activeReaderTabId]?.qaSessions : undefined)
      ?? EMPTY_READER_QA_SESSIONS,
  );
  const readerSelectedQaSessionId = useReaderQaStore(
    (state) => (activeReaderTabId ? state.tabs[activeReaderTabId]?.selectedQaSessionId : undefined)
      ?? '',
  );
  const readerSelectedQaPresetId = useReaderQaStore(
    (state) => (activeReaderTabId ? state.tabs[activeReaderTabId]?.selectedQaPresetId : undefined)
      ?? '',
  );
  const {
    setQaSessions: setReaderQaSessions,
    setSelectedQaSessionId: setReaderSelectedQaSessionId,
    setSelectedQaPresetId: setReaderSelectedQaPresetId,
  } = readerQaActions;
  const [libraryPaperStatuses, setLibraryPaperStatuses] = useState<Record<string, { mineruParsed?: boolean }>>({});
  const [notePaperCandidates, setNotePaperCandidates] = useState<LiteraturePaper[]>([]);
  const [resolvedLibraryPapers, setResolvedLibraryPapers] = useState<Record<string, LiteraturePaper>>({});
  // 全库 RAG 候选：只有打开设置里的索引管理或执行批量任务时才加载，保持启动轻量。
  const [ragLibraryItems, setRagLibraryItems] = useState<WorkspaceItem[]>([]);
  const [ragLibraryMineruParsed, setRagLibraryMineruParsed] =
    useState<Record<string, boolean | undefined>>({});
  const ragLibraryLoadedRef = useRef(false);
  const [ragStorageInfo, setRagStorageInfo] = useState<RagStorageStats | null>(null);
  const [ragCompacting, setRagCompacting] = useState(false);
  const notePaperCandidatesRequestedRef = useRef(false);
  const resolvedLibraryPaperIdsRef = useRef<Set<string>>(new Set());
  const [pendingNoteAnchorJump, setPendingNoteAnchorJump] =
    useState<JumpToNoteAnchorEventDetail | null>(null);

  const {
    mineruApiToken,
    translationApiKey,
    summaryApiKey,
    embeddingApiKey,
    zoteroApiKey,
    zoteroUserId,
  } = readerSecrets;

  const createPaperTaskState = useCallback(
    (
      kind: LiteraturePaperTaskKind,
      status: LiteraturePaperTaskState['status'],
      message: string,
      completed?: number | null,
      total?: number | null,
    ) =>
      buildLocalizedPaperTaskState({
        locale: settings.uiLanguage,
        kind,
        status,
        message,
        completed,
        total,
      }),
    [settings.uiLanguage],
  );

  useEffect(() => {
    setHomeTabTitle(getHomeTabTitle(settings.uiLanguage));
  }, [setHomeTabTitle, settings.uiLanguage]);

  useEffect(() => {
    if (!preferencesOpen || !configHydrated || ragLibraryLoadedRef.current) {
      return undefined;
    }

    ragLibraryLoadedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const papers = await listAllLibraryPapers({
          sortBy: 'updatedAt',
          sortDirection: 'desc',
        });
        const entries = papers
          .map((paper) => ({
            paper,
            item: createNativeLibraryWorkspaceItem(paper, librarySettings?.storageDir),
          }))
          .filter((entry): entry is { paper: LiteraturePaper; item: WorkspaceItem } =>
            Boolean(entry.item),
          );

        if (cancelled) return;
        setRagLibraryItems(entries.map((entry) => entry.item));

        const pathSets = entries.map((entry) =>
          mineruOutputPathCandidatesForPaper(
            entry.paper,
            settings.mineruCacheDir,
            settings.autoLoadSiblingJson,
            librarySettings?.storageDir,
          ),
        );
        const allPaths = Array.from(new Set(pathSets.flat()));
        const existence = new Map<string, boolean>();
        const batchSize = 200;

        for (let index = 0; index < allPaths.length; index += batchSize) {
          const slice = allPaths.slice(index, index + batchSize);
          const found = await localPathsExist(slice);
          slice.forEach((path, pathIndex) => existence.set(path, found[pathIndex] === true));
          if (cancelled) return;
        }

        const parsed: Record<string, boolean | undefined> = {};
        entries.forEach((entry, index) => {
          parsed[entry.item.workspaceId] = pathSets[index].some(
            (path) => existence.get(path) === true,
          );
        });
        setRagLibraryMineruParsed(parsed);
      } catch {
        // 允许下次打开设置时重试。
        ragLibraryLoadedRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    configHydrated,
    librarySettings?.storageDir,
    preferencesOpen,
    settings.autoLoadSiblingJson,
    settings.mineruCacheDir,
  ]);

  useEffect(() => {
    if (!activeReaderTabId) {
      return;
    }

    const fallbackPresetId =
      qaModelPresets.find((preset) => preset.id === settings.qaActivePresetId)?.id ??
      qaModelPresets[0]?.id ??
      '';

    if (!fallbackPresetId) {
      return;
    }

    if (qaModelPresets.some((preset) => preset.id === readerSelectedQaPresetId)) {
      return;
    }

    setReaderSelectedQaPresetId(fallbackPresetId);
  }, [activeReaderTabId, qaModelPresets, readerSelectedQaPresetId, settings.qaActivePresetId]);

  useEffect(() => {
    if (!activeReaderTabId) {
      return;
    }

    // 历史恢复由 DocumentReaderTab 的 effect 完成（restorePaperQaHistory 至少写入一个会话）。
    // 这里若在恢复完成前抢先写入初始会话，会覆盖刚恢复的历史，
    // 并让问答就绪标记永远对不上，提交的提问会被静默丢弃。
    if (!canSeedInitialQaSession(useReaderQaStore.getState().tabs[activeReaderTabId])) {
      return;
    }

    if (readerQaSessions.length === 0) {
      const initialSession = createQaSession(settings.uiLanguage);

      setReaderQaSessions([initialSession]);
      setReaderSelectedQaSessionId(initialSession.id);
      return;
    }

    if (
      !readerSelectedQaSessionId ||
      !readerQaSessions.some((session) => session.id === readerSelectedQaSessionId)
    ) {
      setReaderSelectedQaSessionId(readerQaSessions[0].id);
    }
  }, [activeReaderTabId, readerQaSessions, readerSelectedQaSessionId, settings.uiLanguage]);

  const handleOpenPreferences = useCallback(() => {
    setPreferredPreferencesSection(undefined);
    setPreferencesOpen(true);
  }, []);

  useEffect(() => {
    const handleOpenPreferencesEvent = (event: Event) => {
      const detail = (event as CustomEvent<OpenPreferencesEventDetail>).detail;

      setPreferredPreferencesSection(detail?.section);
      setPreferencesOpen(true);
    };

    window.addEventListener(OPEN_PREFERENCES_EVENT, handleOpenPreferencesEvent);

    return () => {
      window.removeEventListener(OPEN_PREFERENCES_EVENT, handleOpenPreferencesEvent);
    };
  }, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const workspaceItemMap = useMemo(() => {
    const itemMap = new Map<string, WorkspaceItem>();

    const applyItems = (items: WorkspaceItem[]) => {
      for (const item of items) {
        const existingItem = itemMap.get(item.workspaceId);

        if (!existingItem) {
          itemMap.set(item.workspaceId, item);
          continue;
        }

        itemMap.set(item.workspaceId, {
          ...existingItem,
          ...item,
          localPdfPath: mergeLocalPdfPath(existingItem, item),
        });
      }
    };

    // 只合并已打开/已解析的工作区条目；全库文献不再在启动时构造成
    // WorkspaceItem，持久化标签页按 id 懒解析（见下方 effect）。
    applyItems(standaloneItems);
    applyItems(nativeLibraryItems);

    return itemMap;
  }, [nativeLibraryItems, standaloneItems]);

  const allKnownItems = useMemo(
    () => Array.from(workspaceItemMap.values()),
    [workspaceItemMap],
  );

  const readerTabs = useMemo(
    () => tabs.filter((tab): tab is ReaderTab => tab.type === 'reader'),
    [tabs],
  );
  const previousReaderTabIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentTabIds = readerTabs.map((tab) => tab.id);
    const currentTabIdSet = new Set(currentTabIds);
    for (const tabId of previousReaderTabIdsRef.current) {
      if (!currentTabIdSet.has(tabId)) removeReaderQaTab(tabId);
    }
    previousReaderTabIdsRef.current = currentTabIds;
  }, [readerTabs]);
  const mountedReaderTabIds = useMemo(
    () => chooseMountedReaderTabIds({
      readerTabIds: readerTabs.map((tab) => tab.id),
      activeTabId,
      recentTabIds: recentReaderTabIds,
      // 翻译中与问答生成中的标签都必须保持挂载：切走后任务仍在继续。
      busyTabIds: collectBusyReaderTabIds(
        readerTabs.map((tab) => tab.id),
        readerBridges,
      ),
    }),
    [activeTabId, readerBridges, readerTabs, recentReaderTabIds],
  );

  useEffect(() => {
    if (!readerTabs.some((tab) => tab.id === activeTabId)) {
      return;
    }

    setRecentReaderTabIds((current) => [
      activeTabId,
      ...current.filter((id) => id !== activeTabId),
    ].slice(0, 8));
  }, [activeTabId, readerTabs]);

  const selectedLibraryItem = useMemo(() => {
    if (!selectedLibraryItemId) {
      return null;
    }

    return workspaceItemMap.get(selectedLibraryItemId) ?? null;
  }, [selectedLibraryItemId, workspaceItemMap]);

  const activeReaderBridge =
    activeTab?.type === 'reader' ? readerBridges[activeTab.id] ?? null : null;
  const activeAssistantSidebarProps =
    workspaceActive && activeReaderBridge ? activeReaderBridge.assistantSidebarProps : null;
  const showReaderAssistantSidebar = Boolean(
    activeAssistantSidebarProps && !readerAssistantDetached,
  );

  const handleAssistantPanelResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    startAssistantPanelResize(event, {
      onStart: () => setReaderAssistantPanelResizing(true),
      onMove: (moveEvent) => {
        const mainRect = readerMainRef.current?.getBoundingClientRect();

        if (!mainRect) {
          return;
        }

        const boundedMaxWidth = Math.min(
          MAX_ASSISTANT_PANEL_WIDTH,
          Math.max(MIN_ASSISTANT_PANEL_WIDTH, mainRect.width - 120),
        );
        const nextWidth = Math.round(
          Math.min(
            boundedMaxWidth,
            Math.max(MIN_ASSISTANT_PANEL_WIDTH, mainRect.right - moveEvent.clientX),
          ),
        );

        latestAssistantPanelWidthRef.current = nextWidth;
        setReaderAssistantPanelWidth(nextWidth);
      },
      onEnd: () => {
        setReaderAssistantPanelResizing(false);
        // 只在拖拽结束时写一次，避免拖动过程中每帧同步写 localStorage。
        persistReaderAssistantPanelWidth();
      },
    });
  };

  const {
    findExistingMineruJson,
    generateLibraryPreview,
    handleLibraryPreviewSync,
    itemParseStatusMap,
    libraryPreviewStates,
    libraryTranslationSnapshots,
    loadLibraryPreviewBlocks,
    saveLibraryMineruParseCache,
    setLibraryPreviewStates,
    setLibraryTranslationSnapshots,
    syncLibraryParsedState,
    updateLibraryPreviewOperation,
  } = useReaderLibraryPreview({
    activeTabId: workspaceActive ? activeTabId : null,
    allKnownItems,
    createPaperTaskState,
    l,
    selectedLibraryItem,
    setError,
    setPreferencesOpen,
    setPreferredPreferencesSection,
    setStatusMessage,
    settings,
    summaryModelPreset,
  });

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
    handleNativeLibraryGenerateSummary,
    handleNativeLibraryMineruParse,
    handleNativeLibraryTranslate,
    handleNativeLibraryTranslatePaperTitle,
    handleBatchTranslatePaperTitles,
    batchTitleTranslationRunning,
    handleBatchExportBib,
    handleOpenNativeLibraryPaper,
    handleOpenStandalonePdf,
    handleSelectMineruCacheDir,
    handleSelectRemotePdfDownloadDir,
    handleListLlmModels,
    handleTestLlmConnection,
    handleToggleBatchMineruPause,
    handleToggleBatchSummaryPause,
    handleWorkspaceItemResolved,
    nativePaperActionStates,
  } = useReaderLibraryActions({
    allKnownItems,
    appWindow,
    configHydrated,
    createPaperTaskState,
    embeddingApiKey,
    findExistingMineruJson,
    generateLibraryPreview,
    itemParseStatusMap,
    l,
    libraryPreviewStates,
    librarySettings,
    loadLibraryPreviewBlocks,
    libraryTranslationSnapshots,
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
  });

  /**
   * 全库扫描解析缓存，把指向不存在文件的图片引用重新指向实际存在的 part_N_ 文件。
   *
   * 用于修复历史「拆分合并」产物：图片被重命名成 part_N_ 前缀，但 content_list
   * 里的引用没有同步改写。后端幂等且按 mtime+size 记忆化，可随时重复执行。
   */
  const handleRepairMineruCacheImages = useCallback(async () => {
    const cacheDir = settings.mineruCacheDir.trim();

    if (!cacheDir) {
      const message = l(
        '请先在设置中配置解析缓存目录',
        'Configure the parse cache directory in Settings first',
      );
      setError(message);
      setStatusMessage(message);
      return;
    }

    setError('');
    setStatusMessage(l('正在检查解析缓存的图片引用…', 'Checking image references in parse caches...'));

    let fixed = 0;
    let unresolved = 0;
    let changedDocuments = 0;
    const seenDirectories = new Set<string>();

    for (const item of allKnownItems) {
      for (const cachePaths of buildMineruCachePathCandidates(cacheDir, item)) {
        if (seenDirectories.has(cachePaths.directory)) continue;
        seenDirectories.add(cachePaths.directory);

        try {
          const report = await repairMineruCacheImages(cachePaths.directory);

          if (report.fixed > 0) {
            fixed += report.fixed;
            changedDocuments += 1;
          }

          unresolved += report.unresolved;
        } catch {
          // 不存在的候选目录或权限问题：跳过，不中断整库扫描。
        }
      }
    }

    const summary = changedDocuments > 0
      ? l(
          `图片引用修复完成：修复 ${fixed} 条，涉及 ${changedDocuments} 份文献${unresolved > 0 ? `，仍有 ${unresolved} 条无法定位` : ''}`,
          `Image reference repair finished: fixed ${fixed} across ${changedDocuments} document(s)${unresolved > 0 ? `, ${unresolved} could not be resolved` : ''}`,
        )
      : l('图片引用检查完成：没有需要修复的引用', 'Image reference check finished: nothing to repair');

    setStatusMessage(summary);
  }, [allKnownItems, l, settings.mineruCacheDir, setError, setStatusMessage]);

  const effectiveItemParseStatusMap = useMemo(() => {
    const merged: Record<string, boolean | undefined> = { ...itemParseStatusMap };
    for (const [paperId, status] of Object.entries(libraryPaperStatuses)) {
      if (status?.mineruParsed) {
        merged[`native-library:${paperId}`] = true;
      }
    }
    return merged;
  }, [itemParseStatusMap, libraryPaperStatuses]);

  const resolveIndexableItemForRag = useCallback(async (documentKey: string) => {
    try {
      const paper = await getLibraryPaper(documentKey);
      return paper ? createNativeLibraryWorkspaceItem(paper, librarySettings?.storageDir) : null;
    } catch {
      return null;
    }
  }, [librarySettings?.storageDir]);

  const refreshRagStorageStats = useCallback(async () => {
    try {
      setRagStorageInfo(await ragStorageStats());
    } catch {
      // 存储统计仅用于展示，失败时保留旧值。
    }
  }, []);

  useEffect(() => {
    if (preferencesOpen) {
      void refreshRagStorageStats();
    }
  }, [preferencesOpen, refreshRagStorageStats]);

  const handleCompactRagStorage = useCallback(async () => {
    if (ragCompacting) {
      return;
    }

    setRagCompacting(true);

    try {
      const result = await ragCompactStorage();
      setStatusMessage(
        l(
          `索引存储整理完成：${formatFileSize(result.beforeBytes)} → ${formatFileSize(result.afterBytes)}。`,
          `Index storage compacted: ${formatFileSize(result.beforeBytes)} → ${formatFileSize(result.afterBytes)}.`,
        ),
      );
      await refreshRagStorageStats();
    } catch (error) {
      setStatusMessage(
        l(
          `整理索引存储失败：${error instanceof Error ? error.message : String(error)}`,
          `Failed to compact index storage: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    } finally {
      setRagCompacting(false);
    }
  }, [l, ragCompacting, refreshRagStorageStats, setStatusMessage]);

  const {
    ragIndexAvailable,
    ragBadgeByDocumentKey,
    ragStatusByDocumentKey,
    ragIndexOverview,
    ragIndexPaused,
    ragIndexProgress,
    ragIndexRunning,
    ragIndexingDocumentKey,
    handleBatchRagIndex,
    previewBatchRagIndex,
    handleCancelRagIndex,
    handleIndexPaperRag,
    handleToggleRagIndexPause,
  } = useReaderRagIndexActions({
    allKnownItems,
    configHydrated,
    embeddingApiKey,
    findExistingMineruJson,
    libraryItems: ragLibraryItems,
    libraryMineruParsed: ragLibraryMineruParsed,
    resolveIndexableItem: resolveIndexableItemForRag,
    itemParseStatusMap: effectiveItemParseStatusMap,
    l,
    setStatusMessage,
    settings,
  });

  const handleReaderZoteroUserIdChange = useCallback(
    (value: string) => updateReaderSecret('zoteroUserId', value),
    [updateReaderSecret],
  );

  const handleReaderQaActivePresetChange = useCallback(
    (presetId: string) => updateSetting('qaActivePresetId', presetId),
    [updateSetting],
  );

  const handleReaderOpenStandalonePdf = useCallback(() => {
    void handleOpenStandalonePdf();
  }, [handleOpenStandalonePdf]);

  const handleReaderTranslationDisplayModeChange = useCallback(
    (mode: TranslationDisplayMode) => updateSetting('translationDisplayMode', mode),
    [updateSetting],
  );

  const translationTargetLanguageLabel = useMemo(
    () => resolveLanguageLabel(settings.uiLanguage, settings.translationTargetLanguage),
    [settings.translationTargetLanguage, settings.uiLanguage],
  );

  const handlePendingNoteAnchorJumpHandled = useCallback((requestId?: string) => {
    setPendingNoteAnchorJump((current) =>
      !requestId || current?.requestId === requestId ? null : current,
    );
  }, []);

  // 持久化标签页按需解析：只对已打开且尚未恢复的 native-library 标签按 id
  // 单条查询，不再在启动时拉取并构造全库 workspaceItemMap。
  useEffect(() => {
    if (!configHydrated) {
      return;
    }

    for (const tab of readerTabs) {
      const workspaceId = tab.documentId;
      if (!workspaceId.startsWith('native-library:')) continue;
      if (workspaceItemMap.has(workspaceId) || resolvedLibraryPaperIdsRef.current.has(workspaceId)) continue;

      resolvedLibraryPaperIdsRef.current.add(workspaceId);
      const paperId = workspaceId.slice('native-library:'.length);
      void getLibraryPaper(paperId)
        .then((paper) => {
          if (!paper) return;
          setResolvedLibraryPapers((current) => (
            current[paper.id] ? current : { ...current, [paper.id]: paper }
          ));
          const item = createNativeLibraryWorkspaceItem(paper, librarySettings?.storageDir);
          if (!item) return;
          setNativeLibraryItems((current) => (
            current.some((entry) => entry.workspaceId === item.workspaceId)
              ? current
              : [item, ...current]
          ));
        })
        .catch(() => {
          // 下次依赖变化时允许重试。
          resolvedLibraryPaperIdsRef.current.delete(workspaceId);
        });
    }
  }, [configHydrated, librarySettings?.storageDir, readerTabs, workspaceItemMap]);

  // 问答范围/笔记引用候选按需加载：只有助手侧栏真正打开时才拉取全库候选，
  // 首屏与纯阅读不承担整库水合成本。
  useEffect(() => {
    if (!showReaderAssistantSidebar || notePaperCandidatesRequestedRef.current) {
      return;
    }

    notePaperCandidatesRequestedRef.current = true;
    void listAllLibraryPapers({ sortBy: 'updatedAt', sortDirection: 'desc' })
      .then((papers) => setNotePaperCandidates(papers))
      .catch(() => {
        notePaperCandidatesRequestedRef.current = false;
      });
  }, [showReaderAssistantSidebar]);

  const {
    handleDetectLocalZotero,
    handleImportLocalZoteroToNativeLibrary,
    handleReloadLocalZotero,
    handleSelectLocalZoteroDir,
  } = useReaderZoteroSync({
    l,
    zoteroLocalDataDir,
    setZoteroLocalDataDir,
    setLibraryLoading,
    setError,
    setStatusMessage,
    syncNativeLibraryZoteroDir,
  });

  const handleSelectLibraryStorageDir = useCallback(async () => {
    const directory = await selectDirectory(
      l('选择默认文献存储文件夹', 'Select the default paper storage folder'),
    );

    if (!directory) {
      return;
    }

    await updateNativeLibrarySettings(
      { storageDir: directory },
      'reader-library-storage-dir',
    );
  }, [l, updateNativeLibrarySettings]);

  const handleSelectTranslatedPdfStorageDir = useCallback(async () => {
    const directory = await selectDirectory(
      l('选择统一译文 PDF 存放文件夹', 'Select the unified folder for translated PDFs'),
    );

    if (!directory) {
      return;
    }

    await updateNativeLibrarySettings(
      { translatedPdfDir: directory },
      'reader-translated-pdf-dir',
    );
  }, [l, updateNativeLibrarySettings]);

  const handleBridgeStateChange = useCallback((tabId: string, bridge: ReaderTabBridgeState | null) => {
    setReaderBridges((current) => {
      if (!bridge) {
        if (!(tabId in current)) return current;
        const next = { ...current };
        delete next[tabId];
        return next;
      }
      if (areReaderTabBridgeStatesEqual(current[tabId], bridge)) return current;
      return { ...current, [tabId]: bridge };
    });
  }, []);

  const openNoteAnchorJump = useCallback(
    async (detail: JumpToNoteAnchorEventDetail) => {
      const workspaceId = resolveNoteAnchorWorkspaceId(detail);

      if (!workspaceId) {
        const message = l('该引用没有关联文献，无法定位', 'This reference is not linked to a paper.');
        setError(message);
        setStatusMessage(message);
        return;
      }

      const pendingDetail: JumpToNoteAnchorEventDetail = {
        ...detail,
        targetPaperId: workspaceId,
      };

      const existingItem = workspaceItemMap.get(workspaceId);
      if (existingItem) {
        setSelectedLibraryItemId(existingItem.workspaceId);
        openTab(existingItem.workspaceId, existingItem.title);
        setPendingNoteAnchorJump(pendingDetail);
        return;
      }

      if (!workspaceId.startsWith('native-library:')) {
        const message = l('暂不支持自动打开该引用来源', 'This reference source cannot be opened automatically yet.');
        setError(message);
        setStatusMessage(message);
        return;
      }

      const paperId = workspaceId.slice('native-library:'.length);

      try {
        // 单条查询：不拉取、也不覆盖全库快照，避免 1000 条截断影响窗口外文献。
        const paper = await getLibraryPaper(paperId);
        const workspaceItem = paper
          ? createNativeLibraryWorkspaceItem(paper, librarySettings?.storageDir)
          : null;

        if (paper) {
          setResolvedLibraryPapers((current) => (
            current[paper.id] ? current : { ...current, [paper.id]: paper }
          ));
        }

        if (!workspaceItem) {
          const message = l('没有找到该引用对应的可打开 PDF', 'No openable PDF was found for this reference.');
          setError(message);
          setStatusMessage(message);
          return;
        }

        setNativeLibraryItems((current) => [
          workspaceItem,
          ...current.filter((item) => item.workspaceId !== workspaceItem.workspaceId),
        ]);
        setSelectedLibraryItemId(workspaceItem.workspaceId);
        openTab(workspaceItem.workspaceId, workspaceItem.title);
        setPendingNoteAnchorJump(pendingDetail);
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('打开引用来源失败', 'Failed to open the reference source.');
        setError(message);
        setStatusMessage(message);
      }
    },
    [l, librarySettings?.storageDir, openTab, setError, setNativeLibraryItems, setSelectedLibraryItemId, setStatusMessage, workspaceItemMap],
  );

  const handleOpenLibraryPaperFromShelf = useCallback(
    (paper: LiteraturePaper) => {
      setResolvedLibraryPapers((current) => (
        current[paper.id] ? current : { ...current, [paper.id]: paper }
      ));
      handleOpenNativeLibraryPaper(paper);
    },
    [handleOpenNativeLibraryPaper],
  );

  const handleNotePaperClick = useCallback(
    async (paperId: string) => {
      const normalizedPaperId = paperId.trim();

      if (!normalizedPaperId) {
        return;
      }

      const openPaper = (paper: LiteraturePaper) => {
        setResolvedLibraryPapers((current) => (
          current[paper.id] ? current : { ...current, [paper.id]: paper }
        ));
        const workspaceItem = createNativeLibraryWorkspaceItem(paper, librarySettings?.storageDir);

        if (!workspaceItem) {
          const message = l('这篇文献缺少可打开的 PDF 附件', 'This paper has no openable PDF attachment');
          setError(message);
          setStatusMessage(message);
          return false;
        }

        setNativeLibraryItems((current) => [
          workspaceItem,
          ...current.filter((item) => item.workspaceId !== workspaceItem.workspaceId),
        ]);
        setSelectedLibraryItemId(workspaceItem.workspaceId);
        openTab(workspaceItem.workspaceId, workspaceItem.title);
        return true;
      };

      const cachedPaper = notePaperCandidates.find((paper) => paper.id === normalizedPaperId);
      if (cachedPaper && openPaper(cachedPaper)) {
        return;
      }

      try {
        const paper = await getLibraryPaper(normalizedPaperId);

        if (!paper || !openPaper(paper)) {
          const message = l('没有找到该引用对应的文献', 'No paper was found for this reference.');
          setError(message);
          setStatusMessage(message);
        }
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('打开引用文献失败', 'Failed to open the referenced paper.');
        setError(message);
        setStatusMessage(message);
      }
    },
    [
      l,
      librarySettings?.storageDir,
      notePaperCandidates,
      openTab,
      setError,
      setNativeLibraryItems,
      setSelectedLibraryItemId,
      setStatusMessage,
    ],
  );

  // 阅读器内为当前文献附加翻译版 PDF（retainpdf 输出），附加后同步更新打开的文档与文献库视图
  const handleReaderAttachTranslatedPdf = useCallback(
    async (item: WorkspaceItem): Promise<boolean> => {
      if (item.source !== 'native-library') {
        return false;
      }

      setError('');

      try {
        const source = await selectLocalPdfSource();
        const sourcePath = source?.kind === 'local-path' ? source.path : '';

        if (!sourcePath) {
          return false;
        }
        setTranslatedPdfAttachDraft({ item, sourcePath });
        return true;
      } catch (nextError) {
        const message = nextError instanceof Error
          ? nextError.message
          : l('附加翻译版 PDF 失败', 'Failed to attach the translated PDF');
        setError(message);
        setStatusMessage(message);
        return false;
      }
    },
    [
      l,
      setError,
      setStatusMessage,
    ],
  );

  const handleConfirmReaderTranslatedPdfLanguage = useCallback(async (language: string | null) => {
    if (!translatedPdfAttachDraft) return;
    const { item, sourcePath } = translatedPdfAttachDraft;
    try {
      const [originalPages, translatedPages] = await Promise.all([
        item.localPdfPath ? readPdfPageCount(item.localPdfPath) : Promise.resolve(null),
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
        if (!proceed) { setTranslatedPdfAttachDraft(null); return; }
      }
      const currentPaper = resolvedLibraryPapers[item.itemKey]
        ?? await getLibraryPaper(item.itemKey).catch(() => null);
      if (currentPaper) {
        setResolvedLibraryPapers((current) => (
          current[currentPaper.id] ? current : { ...current, [currentPaper.id]: currentPaper }
        ));
      }
      const existingIds = new Set((currentPaper?.attachments ?? [])
        .filter((attachment) => attachment.kind === ATTACHMENT_KIND_TRANSLATED_PDF).map((attachment) => attachment.id));
      const updatedPaper = await addLibraryAttachment({ paperId: item.itemKey, sourcePath, kind: ATTACHMENT_KIND_TRANSLATED_PDF, language });
      setResolvedLibraryPapers((current) => ({ ...current, [updatedPaper.id]: updatedPaper }));
      const refreshedItem = createNativeLibraryWorkspaceItem(updatedPaper, librarySettings?.storageDir);
      if (refreshedItem) handleWorkspaceItemResolved(refreshedItem);
      emitNativePaperUpdated(updatedPaper);
      const duplicate = updatedPaper.attachments.some((attachment) => attachment.kind === ATTACHMENT_KIND_TRANSLATED_PDF && existingIds.has(attachment.id));
      setStatusMessage(duplicate
        ? l('该译版已存在，可通过文献库中的“设置语言”修改', 'This translated PDF already exists. Use Set language in the library to update it.')
        : l('已附加翻译版 PDF，可在阅读视图中启用 PDF 对照', 'Translated PDF attached. Enable PDF Compare in the reading view.'));
      setTranslatedPdfAttachDraft(null);
      setError('');
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('附加翻译版 PDF 失败', 'Failed to attach the translated PDF');
      setError(message);
      setStatusMessage(message);
    }
  }, [translatedPdfAttachDraft, resolvedLibraryPapers, l, librarySettings?.storageDir, handleWorkspaceItemResolved, setError, setStatusMessage]);

  // 文献库视图中附加/移除翻译版 PDF 后，同步更新已打开的阅读标签页文档
  useEffect(() => {
    const handleNativePaperUpdated = (event: Event) => {
      const detail = (event as CustomEvent<NativePaperUpdatedEventDetail>).detail;

      if (!detail?.paper) {
        return;
      }

      setResolvedLibraryPapers((current) => ({ ...current, [detail.paper.id]: detail.paper }));
      setNotePaperCandidates((current) => (
        current.some((paper) => paper.id === detail.paper.id)
          ? current.map((paper) => (paper.id === detail.paper.id ? detail.paper : paper))
          : current
      ));

      const refreshedItem = createNativeLibraryWorkspaceItem(detail.paper, librarySettings?.storageDir);

      if (refreshedItem) {
        handleWorkspaceItemResolved(refreshedItem);
      }
    };

    window.addEventListener(NATIVE_PAPER_UPDATED_EVENT, handleNativePaperUpdated);
    return () => window.removeEventListener(NATIVE_PAPER_UPDATED_EVENT, handleNativePaperUpdated);
  }, [handleWorkspaceItemResolved, librarySettings?.storageDir]);

  useEffect(() => {
    const handleOpenStandalonePdfEvent = () => {
      void handleOpenStandalonePdf();
    };
    const handleOpenLibraryPaperEvent = (event: Event) => {
      const detail = (event as CustomEvent<OpenLibraryPaperEventDetail>).detail;
      if (!detail?.paperId) {
        return;
      }

      void handleNotePaperClick(detail.paperId);
    };
    const handleJumpToNoteAnchorEvent = (event: Event) => {
      const detail = (event as CustomEvent<JumpToNoteAnchorEventDetail>).detail;
      if (!detail?.noteId || !detail.anchorId) {
        return;
      }

      void openNoteAnchorJump(detail);
    };

    window.addEventListener(OPEN_STANDALONE_PDF_EVENT, handleOpenStandalonePdfEvent);
    window.addEventListener(OPEN_LIBRARY_PAPER_EVENT, handleOpenLibraryPaperEvent);
    window.addEventListener(JUMP_TO_NOTE_ANCHOR_EVENT, handleJumpToNoteAnchorEvent);

    return () => {
      window.removeEventListener(OPEN_STANDALONE_PDF_EVENT, handleOpenStandalonePdfEvent);
      window.removeEventListener(OPEN_LIBRARY_PAPER_EVENT, handleOpenLibraryPaperEvent);
      window.removeEventListener(JUMP_TO_NOTE_ANCHOR_EVENT, handleJumpToNoteAnchorEvent);
    };
  }, [handleNotePaperClick, handleOpenStandalonePdf, openNoteAnchorJump]);

  useEffect(() => {
    if (!workspaceActive) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && preferencesOpen) {
        setPreferencesOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preferencesOpen, workspaceActive]);

  return (
    <AppLocaleProvider value={settings.uiLanguage}>
      <div className="relative h-full min-h-0 overflow-hidden bg-[var(--pq-bg-secondary)] text-[var(--pq-text)]">
        <div className="flex h-full min-h-0 flex-col bg-[var(--pq-bg-primary)]">
          <main ref={readerMainRef} className="relative flex min-h-0 flex-1 overflow-hidden">
            <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
              <div
                className="h-full min-h-0 overflow-hidden"
                hidden={!workspaceActive || activeTabId !== HOME_TAB_ID}
              >
                <LiteratureLibraryView
                  onOpenPaper={handleOpenLibraryPaperFromShelf}
                  mineruCacheDir={settings.mineruCacheDir}
                  autoLoadSiblingJson={settings.autoLoadSiblingJson}
                  showReadingHeatmap={settings.showLibraryReadingHeatmap}
                  onRunMineruParse={handleNativeLibraryMineruParse}
                  onTranslatePaper={handleNativeLibraryTranslate}
                  onTranslatePaperTitle={handleNativeLibraryTranslatePaperTitle}
                  onGenerateSummary={handleNativeLibraryGenerateSummary}
                  onBatchTranslatePaperTitles={(papers) => void handleBatchTranslatePaperTitles(papers)}
                  batchTitleTranslationRunning={batchTitleTranslationRunning}
                  onBatchExportBib={(papers, mode) => void handleBatchExportBib(papers, mode)}
                  paperActionStates={nativePaperActionStates}
                  metadataLlmPreset={summaryModelPreset ?? translationModelPreset}
                  ragIndexAvailable={ragIndexAvailable}
                  ragBadgeByDocumentKey={ragBadgeByDocumentKey}
                  ragStatusEntriesByDocumentKey={ragStatusByDocumentKey}
                  ragIndexingDocumentKey={ragIndexingDocumentKey}
                  onIndexPaperRag={(paperId) => void handleIndexPaperRag(paperId)}
                  onBatchRagIndex={(options) => void handleBatchRagIndex(options)}
                  onPreviewBatchRagIndex={(options) => previewBatchRagIndex(options)}
                  ragIndexRunning={ragIndexRunning}
                  ragIndexPaused={ragIndexPaused}
                  ragIndexProgress={ragIndexProgress}
                  onToggleRagIndexPause={handleToggleRagIndexPause}
                  onCancelRagIndex={handleCancelRagIndex}
                  onPaperStatusesChange={setLibraryPaperStatuses}
                />
              </div>

              {readerTabs.map((tab) => {
              const item = workspaceItemMap.get(tab.documentId);

              if (!item) {
                return null;
              }

              const mounted = mountedReaderTabIds.includes(tab.id);

              return (
                <div key={tab.id} className="h-full min-h-0 overflow-hidden" hidden={tab.id !== activeTabId}>
                  {mounted ? (
                  <DocumentReaderTab
                    tabId={tab.id}
                    document={item}
                    isActive={workspaceActive && tab.id === activeTabId}
                    settings={settings}
                    readerApiConfig={readerSecrets}
                    zoteroLocalDataDir={zoteroLocalDataDir}
                    readerCallbacks={{
                      onZoteroUserIdChange: handleReaderZoteroUserIdChange,
                      onQaActivePresetChange: handleReaderQaActivePresetChange,
                      onDocumentResolved: handleWorkspaceItemResolved,
                      onLibraryPreviewSync: handleLibraryPreviewSync,
                      onOpenPreferences: handleOpenPreferences,
                      onOpenStandalonePdf: handleReaderOpenStandalonePdf,
                      onAttachTranslatedPdf: handleReaderAttachTranslatedPdf,
                      onBridgeStateChange: handleBridgeStateChange,
                      onTranslationDisplayModeChange: handleReaderTranslationDisplayModeChange,
                      onNotePaperClick: handleNotePaperClick,
                      onPendingNoteAnchorJumpHandled: handlePendingNoteAnchorJumpHandled,
                    }}
                    pendingNoteAnchorJump={
                      isNoteAnchorJumpForWorkspace(pendingNoteAnchorJump, item.workspaceId)
                        ? pendingNoteAnchorJump
                        : null
                    }
                    translationTargetLanguageLabel={translationTargetLanguageLabel}
                    notePaperCandidates={notePaperCandidates}
                    loadLibraryPreviewBlocks={loadLibraryPreviewBlocks}
                    translationSnapshot={libraryTranslationSnapshots[item.workspaceId] ?? null}
                    libraryPreviewSummary={libraryPreviewStates[item.workspaceId]?.summary ?? null}
                    overviewPaper={item.source === 'native-library' ? resolvedLibraryPapers[item.itemKey] : undefined}
                    libraryStorageDir={librarySettings?.storageDir}
                  />
                  ) : null}
                </div>
              );
              })}
            </div>

            {showReaderAssistantSidebar && activeAssistantSidebarProps ? (
              <>
                {activeAssistantSidebarProps.activePanel ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={l('调整问答侧栏宽度', 'Resize assistant sidebar')}
                    onPointerDown={handleAssistantPanelResizeStart}
                    className="group relative z-20 ml-auto w-2 shrink-0 cursor-col-resize bg-transparent transition-all duration-200"
                  >
                    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--pq-border-strong)] transition-all duration-200 group-hover:w-[3px] group-hover:bg-[var(--pq-accent-bg)]" />
                    <div className="absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--pq-surface-3)] transition-all duration-200 group-hover:w-1.5 group-hover:bg-[var(--pq-accent)]" />
                  </div>
                ) : null}

                <aside
                  className={`flex min-h-0 shrink-0 self-stretch ${
                    readerAssistantPanelResizing ? 'transition-none' : 'transition-all duration-300'
                  }`}
                >
                  <AssistantSidebar
                    {...activeAssistantSidebarProps}
                    panelWidth={readerAssistantPanelWidth}
                    resizing={readerAssistantPanelResizing}
                    chatLayoutMode="compact"
                    onDetach={activeReaderBridge?.onDetachAssistant}
                  />
                </aside>
              </>
            ) : null}
          </main>
        </div>

        <ReaderPreferencesWindow
          open={preferencesOpen}
          onClose={() => setPreferencesOpen(false)}
          preferredSection={preferredPreferencesSection}
          settings={settings}
          librarySettings={librarySettings}
          zoteroLocalDataDir={zoteroLocalDataDir}
          mineruApiToken={mineruApiToken}
          translationApiKey={translationApiKey}
          summaryApiKey={summaryApiKey}
          embeddingApiKey={embeddingApiKey}
          qaModelPresets={qaModelPresets}
          zoteroApiKey={zoteroApiKey}
          zoteroUserId={zoteroUserId}
          libraryLoading={libraryLoading}
          translating={activeReaderBridge?.translating ?? false}
          translatedCount={activeReaderBridge?.translatedCount ?? 0}
          onSettingChange={updateSetting}
          onNativeLibrarySettingsChange={(patch) => void updateNativeLibrarySettings(patch)}
          onSelectLibraryStorageDir={() => handleSelectLibraryStorageDir()}
          onSelectTranslatedPdfStorageDir={() => handleSelectTranslatedPdfStorageDir()}
          onZoteroLocalDataDirChange={setZoteroLocalDataDir}
          onMineruApiTokenChange={(value) => updateReaderSecret('mineruApiToken', value)}
          onRepairMineruCacheImages={() => void handleRepairMineruCacheImages()}
          onTranslationApiKeyChange={(value) => updateReaderSecret('translationApiKey', value)}
          onSummaryApiKeyChange={(value) => updateReaderSecret('summaryApiKey', value)}
          onEmbeddingApiKeyChange={(value) => updateReaderSecret('embeddingApiKey', value)}
          onZoteroApiKeyChange={(value) => updateReaderSecret('zoteroApiKey', value)}
          onZoteroUserIdChange={(value) => updateReaderSecret('zoteroUserId', value)}
          onDetectLocalZotero={() => void handleDetectLocalZotero()}
          onSelectLocalZoteroDir={() => void handleSelectLocalZoteroDir()}
          onReloadLocalZotero={() => void handleReloadLocalZotero()}
          onImportLocalZotero={() => void handleImportLocalZoteroToNativeLibrary()}
          onEnrichAllLibraryMetadata={emitLibraryMetadataEnrichRequest}
          onSelectMineruCacheDir={() => handleSelectMineruCacheDir()}
          onSelectRemotePdfDownloadDir={() => void handleSelectRemotePdfDownloadDir()}
          onListLlmModels={handleListLlmModels}
          onTestLlmConnection={handleTestLlmConnection}
          onQaModelPresetAdd={addQaModelPreset}
          onQaModelPresetRemove={removeQaModelPreset}
          onQaModelPresetChange={updateQaModelPreset}
          onTranslate={activeReaderBridge?.onTranslate}
          onCancelTranslate={activeReaderBridge?.onCancelTranslate}
          onClearTranslations={activeReaderBridge?.onClearTranslations}
          onBatchMineruParse={() => void handleBatchMineruParse()}
          onBatchGenerateSummaries={() => void handleBatchGenerateSummaries()}
          onToggleBatchMineruPause={handleToggleBatchMineruPause}
          onCancelBatchMineru={handleCancelBatchMineru}
          onToggleBatchSummaryPause={handleToggleBatchSummaryPause}
          onCancelBatchSummary={handleCancelBatchSummary}
          batchMineruRunning={batchMineruRunning}
          batchSummaryRunning={batchSummaryRunning}
          batchMineruPaused={batchMineruPaused}
          batchSummaryPaused={batchSummaryPaused}
          batchMineruProgress={batchMineruProgress}
          batchSummaryProgress={batchSummaryProgress}
          ragIndexAvailable={ragIndexAvailable}
          ragIndexOverview={ragIndexOverview}
          ragIndexPaused={ragIndexPaused}
          ragIndexProgress={ragIndexProgress}
          ragIndexRunning={ragIndexRunning}
          ragStorageStats={ragStorageInfo}
          ragCompacting={ragCompacting}
          onBatchRagIndex={(options) => void handleBatchRagIndex(options)}
          onCompactRagStorage={() => void handleCompactRagStorage()}
          onToggleRagIndexPause={handleToggleRagIndexPause}
          onCancelRagIndex={handleCancelRagIndex}
        />
        {translatedPdfAttachDraft ? <TranslatedPdfLanguageConfirmDialog
          paperTitle={translatedPdfAttachDraft.item.title}
          fileName={translatedPdfAttachDraft.sourcePath.split(/[\\/]/).pop() ?? translatedPdfAttachDraft.sourcePath}
          defaultLanguage={settings.translationTargetLanguage}
          onClose={() => setTranslatedPdfAttachDraft(null)}
          onConfirm={handleConfirmReaderTranslatedPdfLanguage}
        /> : null}
      </div>
    </AppLocaleProvider>
  );
}

export default Reader;
