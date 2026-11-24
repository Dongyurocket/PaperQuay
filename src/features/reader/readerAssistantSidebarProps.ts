import type { AssistantSidebarCoreProps } from './AssistantSidebar';
import type {
  AssistantPanelKey,
  DocumentChatCitation,
  DocumentChatMessage,
  DocumentChatQaContext,
  DocumentChatRenderMode,
  DocumentChatSession,
} from '../../types/reader';
import type { LocaleTextFn, ReaderWorkspaceDocument } from './readerWorkspaceShared.ts';
import { formatReaderDocumentMeta } from './readerWorkspaceShared.ts';

export interface BuildReaderAssistantSidebarInput {
  l: LocaleTextFn;
  activePanel: AssistantPanelKey;
  onActivePanelChange: (panel: AssistantPanelKey) => void;
  currentDocument: ReaderWorkspaceDocument;
  documentSource: string;
  currentPdfName: string;
  currentJsonName: string;
  blockCount: number;
  translatedCount: number;
  statusMessage: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
  notes: AssistantSidebarCoreProps['notes'];
  activeNoteId: AssistantSidebarCoreProps['activeNoteId'];
  notePaperCandidates?: AssistantSidebarCoreProps['notePaperCandidates'];
  notesLoading: AssistantSidebarCoreProps['notesLoading'];
  notesSaving: AssistantSidebarCoreProps['notesSaving'];
  notesError: AssistantSidebarCoreProps['notesError'];
  pendingAnchorInsert: AssistantSidebarCoreProps['pendingAnchorInsert'];
  onPendingAnchorInsertHandled: AssistantSidebarCoreProps['onPendingAnchorInsertHandled'];
  noteEditorSourceId: AssistantSidebarCoreProps['noteEditorSourceId'];
  externalUpdateNote: AssistantSidebarCoreProps['externalUpdateNote'];
  onExternalUpdateApply: AssistantSidebarCoreProps['onExternalUpdateApply'];
  qaSessions: AssistantSidebarCoreProps['qaSessions'];
  selectedQaSessionId: AssistantSidebarCoreProps['selectedQaSessionId'];
  qaMessages: AssistantSidebarCoreProps['qaMessages'];
  qaInput: AssistantSidebarCoreProps['qaInput'];
  qaAttachments: AssistantSidebarCoreProps['qaAttachments'];
  qaModelPresets: AssistantSidebarCoreProps['qaModelPresets'];
  selectedQaPresetId: AssistantSidebarCoreProps['selectedQaPresetId'];
  qaRagEnabled: AssistantSidebarCoreProps['qaRagEnabled'];
  qaScopeMode: AssistantSidebarCoreProps['qaScopeMode'];
  qaScopePaperIds: AssistantSidebarCoreProps['qaScopePaperIds'];
  qaScopePaperOptions: AssistantSidebarCoreProps['qaScopePaperOptions'];
  qaAnswerRenderMode: AssistantSidebarCoreProps['qaAnswerRenderMode'];
  qaReasoningEffort: AssistantSidebarCoreProps['qaReasoningEffort'];
  qaLoading: AssistantSidebarCoreProps['qaLoading'];
  qaRunningSessionIds: AssistantSidebarCoreProps['qaRunningSessionIds'];
  qaError: AssistantSidebarCoreProps['qaError'];
  screenshotLoading: NonNullable<AssistantSidebarCoreProps['screenshotLoading']>;
  onQaInputChange: AssistantSidebarCoreProps['onQaInputChange'];
  onQaSubmit: AssistantSidebarCoreProps['onQaSubmit'];
  onQaStop?: AssistantSidebarCoreProps['onQaStop'];
  onQaPresetChange: AssistantSidebarCoreProps['onQaPresetChange'];
  onQaRagEnabledChange: AssistantSidebarCoreProps['onQaRagEnabledChange'];
  onQaScopeChange: AssistantSidebarCoreProps['onQaScopeChange'];
  onQaAnswerRenderModeChange: AssistantSidebarCoreProps['onQaAnswerRenderModeChange'];
  onQaReasoningEffortChange: AssistantSidebarCoreProps['onQaReasoningEffortChange'];
  onQaSessionCreate: AssistantSidebarCoreProps['onQaSessionCreate'];
  onQaSessionSelect: AssistantSidebarCoreProps['onQaSessionSelect'];
  onQaSessionDelete: AssistantSidebarCoreProps['onQaSessionDelete'];
  onSelectImageAttachments: AssistantSidebarCoreProps['onSelectImageAttachments'];
  onSelectFileAttachments: AssistantSidebarCoreProps['onSelectFileAttachments'];
  onCaptureScreenshot: AssistantSidebarCoreProps['onCaptureScreenshot'];
  onRemoveAttachment: AssistantSidebarCoreProps['onRemoveAttachment'];
  onCitationClick: AssistantSidebarCoreProps['onCitationClick'];
  onCitationContext?: AssistantSidebarCoreProps['onCitationContext'];
  onCreateStandaloneNote: AssistantSidebarCoreProps['onCreateStandaloneNote'];
  onSelectNote: AssistantSidebarCoreProps['onSelectNote'];
  onUpdateNote: AssistantSidebarCoreProps['onUpdateNote'];
  onDeleteNote: AssistantSidebarCoreProps['onDeleteNote'];
  onJumpToNoteAnchor: AssistantSidebarCoreProps['onJumpToNoteAnchor'];
  onNotePaperClick?: AssistantSidebarCoreProps['onNotePaperClick'];
  onAddSelectionToNote: AssistantSidebarCoreProps['onAddSelectionToNote'];
  onSaveAssistantMessageAsNote: AssistantSidebarCoreProps['onSaveAssistantMessageAsNote'];
  selectedExcerpt: AssistantSidebarCoreProps['selectedExcerpt'];
  selectedExcerptTranslation: AssistantSidebarCoreProps['selectedExcerptTranslation'];
  selectedExcerptTranslating: AssistantSidebarCoreProps['selectedExcerptTranslating'];
  selectedExcerptError: AssistantSidebarCoreProps['selectedExcerptError'];
  onAppendSelectedExcerptToQa: AssistantSidebarCoreProps['onAppendSelectedExcerptToQa'];
  onTranslateSelectedExcerpt: AssistantSidebarCoreProps['onTranslateSelectedExcerpt'];
  onClearSelectedExcerpt: AssistantSidebarCoreProps['onClearSelectedExcerpt'];
  onOpenPreferences: NonNullable<AssistantSidebarCoreProps['onOpenPreferences']>;
}

export function buildReaderAssistantSidebarProps(
  input: BuildReaderAssistantSidebarInput,
): AssistantSidebarCoreProps {
  return {
    activePanel: input.activePanel,
    onActivePanelChange: input.onActivePanelChange,
    documentTitle: input.currentDocument.title,
    documentMeta: formatReaderDocumentMeta(input.l, input.currentDocument),
    documentSource: input.documentSource,
    documentPdfName: input.currentPdfName,
    documentJsonName: input.currentJsonName,
    blockCount: input.blockCount,
    translatedCount: input.translatedCount,
    statusMessage: input.statusMessage,
    hasBlocks: input.hasBlocks,
    aiConfigured: input.aiConfigured,
    notes: input.notes,
    activeNoteId: input.activeNoteId,
    notePaperCandidates: input.notePaperCandidates,
    notesLoading: input.notesLoading,
    notesSaving: input.notesSaving,
    notesError: input.notesError,
    pendingAnchorInsert: input.pendingAnchorInsert,
    onPendingAnchorInsertHandled: input.onPendingAnchorInsertHandled,
    noteEditorSourceId: input.noteEditorSourceId,
    externalUpdateNote: input.externalUpdateNote,
    onExternalUpdateApply: input.onExternalUpdateApply,
    qaSessions: input.qaSessions,
    selectedQaSessionId: input.selectedQaSessionId,
    qaMessages: input.qaMessages,
    qaInput: input.qaInput,
    qaAttachments: input.qaAttachments,
    qaModelPresets: input.qaModelPresets,
    selectedQaPresetId: input.selectedQaPresetId,
    qaRagEnabled: input.qaRagEnabled,
    qaScopeMode: input.qaScopeMode,
    qaScopePaperIds: input.qaScopePaperIds,
    qaScopePaperOptions: input.qaScopePaperOptions,
    qaAnswerRenderMode: input.qaAnswerRenderMode,
    qaReasoningEffort: input.qaReasoningEffort,
    qaLoading: input.qaLoading,
    qaRunningSessionIds: input.qaRunningSessionIds,
    qaError: input.qaError,
    screenshotLoading: input.screenshotLoading,
    onQaInputChange: input.onQaInputChange,
    onQaSubmit: input.onQaSubmit,
    onQaStop: input.onQaStop,
    onQaPresetChange: input.onQaPresetChange,
    onQaRagEnabledChange: input.onQaRagEnabledChange,
    onQaScopeChange: input.onQaScopeChange,
    onQaAnswerRenderModeChange: input.onQaAnswerRenderModeChange,
    onQaReasoningEffortChange: input.onQaReasoningEffortChange,
    onQaSessionCreate: input.onQaSessionCreate,
    onQaSessionSelect: input.onQaSessionSelect,
    onQaSessionDelete: input.onQaSessionDelete,
    onSelectImageAttachments: input.onSelectImageAttachments,
    onSelectFileAttachments: input.onSelectFileAttachments,
    onCaptureScreenshot: input.onCaptureScreenshot,
    onRemoveAttachment: input.onRemoveAttachment,
    onCitationClick: input.onCitationClick,
    onCitationContext: input.onCitationContext,
    onCreateStandaloneNote: input.onCreateStandaloneNote,
    onSelectNote: input.onSelectNote,
    onUpdateNote: input.onUpdateNote,
    onDeleteNote: input.onDeleteNote,
    onJumpToNoteAnchor: input.onJumpToNoteAnchor,
    onNotePaperClick: input.onNotePaperClick,
    onAddSelectionToNote: input.onAddSelectionToNote,
    onSaveAssistantMessageAsNote: input.onSaveAssistantMessageAsNote,
    selectedExcerpt: input.selectedExcerpt,
    selectedExcerptTranslation: input.selectedExcerptTranslation,
    selectedExcerptTranslating: input.selectedExcerptTranslating,
    selectedExcerptError: input.selectedExcerptError,
    onAppendSelectedExcerptToQa: input.onAppendSelectedExcerptToQa,
    onTranslateSelectedExcerpt: input.onTranslateSelectedExcerpt,
    onClearSelectedExcerpt: input.onClearSelectedExcerpt,
    onOpenPreferences: input.onOpenPreferences,
  };
}

/**
 * Transient streaming state for document QA.
 *
 * Model deltas used to rebuild the whole `qaSessions` array (and every message object)
 * on each token. The streaming answer now lives in this small external store, keyed by
 * session + assistant message, and only the streaming bubble subscribes to it. The final
 * answer is committed into `qaSessions` once, when the stream finishes.
 */
export interface ReaderQaStreamMeta {
  qaContext?: DocumentChatQaContext;
  citations?: DocumentChatCitation[];
  modelId?: string;
  modelLabel?: string;
  renderMode?: DocumentChatRenderMode;
}

export interface ReaderQaStreamEntry {
  key: string;
  sessionId: string;
  messageId: string;
  text: string;
  updatedAt: number;
  meta: ReaderQaStreamMeta;
}

export type ReaderQaStreamListener = () => void;

export interface ReaderQaStreamScheduler {
  schedule(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const READER_QA_STREAM_KEY_SEPARATOR = '\u0000';

export function buildReaderQaStreamKey(sessionId: string, messageId: string): string {
  return `${sessionId}${READER_QA_STREAM_KEY_SEPARATOR}${messageId}`;
}

/** Falls back to ~50 ms frames when requestAnimationFrame is unavailable (tests/SSR). */
export function createReaderQaStreamScheduler(): ReaderQaStreamScheduler {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return {
      schedule: (callback) => window.requestAnimationFrame(() => callback()),
      cancel: (handle) => window.cancelAnimationFrame(handle as number),
    };
  }

  return {
    schedule: (callback) => setTimeout(callback, 50),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function mergeReaderQaStreamMeta(
  previous: ReaderQaStreamMeta | undefined,
  next: ReaderQaStreamMeta | undefined,
): ReaderQaStreamMeta {
  if (!next) {
    return previous ?? {};
  }

  if (
    previous &&
    previous.qaContext === next.qaContext &&
    previous.citations === next.citations &&
    previous.modelId === next.modelId &&
    previous.modelLabel === next.modelLabel &&
    previous.renderMode === next.renderMode
  ) {
    return previous;
  }

  return { ...previous, ...next };
}

export class ReaderQaStreamStore {
  private entries = new Map<string, ReaderQaStreamEntry>();
  private listeners = new Map<string, Set<ReaderQaStreamListener>>();
  private pendingKeys = new Set<string>();
  private scheduledHandle: unknown = null;
  private flushScheduled = false;
  private scheduler: ReaderQaStreamScheduler;
  private now: () => number;
  readonly stats = {
    started: 0,
    updates: 0,
    flushes: 0,
    notifications: 0,
    finished: 0,
  };

  constructor(options: { scheduler?: ReaderQaStreamScheduler; now?: () => number } = {}) {
    this.scheduler = options.scheduler ?? createReaderQaStreamScheduler();
    this.now = options.now ?? Date.now;
  }

  subscribe(sessionId: string, messageId: string, listener: ReaderQaStreamListener): () => void {
    const key = buildReaderQaStreamKey(sessionId, messageId);
    let listeners = this.listeners.get(key);

    if (!listeners) {
      listeners = new Set();
      this.listeners.set(key, listeners);
    }

    listeners.add(listener);

    return () => {
      const current = this.listeners.get(key);

      if (!current) {
        return;
      }

      current.delete(listener);

      if (current.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  getSnapshot(sessionId: string, messageId: string): ReaderQaStreamEntry | null {
    return this.entries.get(buildReaderQaStreamKey(sessionId, messageId)) ?? null;
  }

  hasActive(sessionId: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId) {
        return true;
      }
    }

    return false;
  }

  start(sessionId: string, messageId: string, meta: ReaderQaStreamMeta = {}): void {
    const key = buildReaderQaStreamKey(sessionId, messageId);

    if (this.entries.has(key)) {
      return;
    }

    this.entries.set(key, {
      key,
      sessionId,
      messageId,
      text: '',
      updatedAt: this.now(),
      meta,
    });
    this.stats.started += 1;
    this.queueNotification(key);
  }

  update(sessionId: string, messageId: string, text: string, meta?: ReaderQaStreamMeta): void {
    const key = buildReaderQaStreamKey(sessionId, messageId);
    const previous = this.entries.get(key);
    const mergedMeta = mergeReaderQaStreamMeta(previous?.meta, meta);

    if (previous && previous.text === text && previous.meta === mergedMeta) {
      return;
    }

    this.entries.set(key, {
      key,
      sessionId,
      messageId,
      text,
      updatedAt: this.now(),
      meta: mergedMeta,
    });
    this.stats.updates += 1;
    this.queueNotification(key);
  }

  finish(sessionId: string, messageId: string): void {
    const key = buildReaderQaStreamKey(sessionId, messageId);

    if (!this.entries.delete(key)) {
      return;
    }

    this.stats.finished += 1;
    this.queueNotification(key);
  }

  clearSession(sessionId: string): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.sessionId !== sessionId) {
        continue;
      }

      this.entries.delete(key);
      this.stats.finished += 1;
      this.queueNotification(key);
    }
  }

  /** Drains pending notifications immediately (tests and unmount safety). */
  flushNow(): void {
    if (this.scheduledHandle !== null) {
      this.scheduler.cancel(this.scheduledHandle);
      this.scheduledHandle = null;
    }

    this.flushScheduled = false;
    this.flush();
  }

  private queueNotification(key: string): void {
    this.pendingKeys.add(key);

    if (this.flushScheduled) {
      return;
    }

    // Mark before scheduling: a test scheduler may invoke the callback synchronously.
    this.flushScheduled = true;
    this.scheduledHandle = this.scheduler.schedule(() => {
      this.flushScheduled = false;
      this.scheduledHandle = null;
      this.flush();
    });
  }

  private flush(): void {
    if (this.pendingKeys.size === 0) {
      return;
    }

    const keys = [...this.pendingKeys];
    this.pendingKeys.clear();
    this.stats.flushes += 1;

    for (const key of keys) {
      const listeners = this.listeners.get(key);

      if (!listeners) {
        continue;
      }

      for (const listener of [...listeners]) {
        this.stats.notifications += 1;
        listener();
      }
    }
  }
}

export const readerQaStreamStore = new ReaderQaStreamStore();

export interface ReaderQaStreamAbortCleanupInput {
  aborted: boolean;
  /** False when the reader switched documents and the old slice no longer owns persistence. */
  sameGeneration: boolean;
  streamedAnswer: string;
}

export type ReaderQaStreamAbortCleanup =
  | 'commit-partial'
  | 'remove-placeholder'
  | 'discard'
  | 'none';

/** Abort rules shared with `useReaderQa`'s finally block. */
export function resolveReaderQaStreamAbortCleanup(
  input: ReaderQaStreamAbortCleanupInput,
): ReaderQaStreamAbortCleanup {
  if (!input.aborted) {
    return 'none';
  }

  if (!input.sameGeneration) {
    return 'discard';
  }

  return input.streamedAnswer.trim() ? 'commit-partial' : 'remove-placeholder';
}

/**
 * Builds the session written to `qaSessions` once at the end of a stream. Deltas must not
 * touch the previous messages, so completed rows keep their object identity for React.memo.
 */
export function buildStreamedQaSession(
  pendingSession: DocumentChatSession,
  historyMessages: DocumentChatMessage[],
  assistantMessage: DocumentChatMessage,
  answer: string,
  updatedAt: number,
): DocumentChatSession {
  return {
    ...pendingSession,
    updatedAt,
    messages: [
      ...historyMessages,
      {
        ...assistantMessage,
        content: answer,
        createdAt: updatedAt,
      },
    ],
  };
}

export interface BoundedStringCache {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  clear(): void;
  readonly size: number;
  readonly characterCount: number;
}

/** Small LRU used to memoize normalized markdown for completed messages. */
export function createBoundedStringCache(options: {
  maxEntries?: number;
  maxCharacters?: number;
} = {}): BoundedStringCache {
  const maxEntries = options.maxEntries ?? 200;
  const maxCharacters = options.maxCharacters ?? 400_000;
  const entries = new Map<string, string>();
  let characterCount = 0;

  return {
    get(key) {
      const value = entries.get(key);

      if (value === undefined) {
        return undefined;
      }

      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (maxEntries <= 0 || maxCharacters <= 0 || value.length > maxCharacters) {
        return;
      }

      const existing = entries.get(key);

      if (existing !== undefined) {
        entries.delete(key);
        characterCount -= existing.length;
      }

      entries.set(key, value);
      characterCount += value.length;

      while (entries.size > maxEntries || characterCount > maxCharacters) {
        const oldestKey = entries.keys().next().value as string | undefined;

        if (oldestKey === undefined) {
          break;
        }

        const oldestValue = entries.get(oldestKey);
        entries.delete(oldestKey);
        characterCount -= oldestValue?.length ?? 0;
      }
    },
    clear() {
      entries.clear();
      characterCount = 0;
    },
    get size() {
      return entries.size;
    },
    get characterCount() {
      return characterCount;
    },
  };
}

/** Shared cache for `normalizeMarkdownMath` output; streaming prefixes are never cached. */
export const readerMarkdownNormalizationCache = createBoundedStringCache();
