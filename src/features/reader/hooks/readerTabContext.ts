import { useCallback, useMemo, useRef, useState } from 'react';
import { createOverviewCacheWriter } from '../overview/overviewCacheWrites';
import type { LocalDirectoryFileEntry } from '../../../services/desktop';
import { createPdfTextCache } from '../pdfTextCache';
import { createDocumentOpenGeneration } from '../documentOpenGeneration';
import { type MineruOutlineIndexItem } from '../mineruSegments.ts';
import {
  type ScopedRagDocument,
} from '../../../services/localRag';
import {
  type JumpToNoteAnchorEventDetail,
} from '../../../app/appEvents';
import { useAppLocale, useLocaleText } from '../../../i18n/uiLanguage';
import { buildReaderNotesEditorSourceId } from '../documentReaderNotes';
import type { LiteraturePaper, LiteraturePaperTaskState } from '../../../types/library';
import type {
  Note,
  NoteAnchorInsertRequest,
} from '../../../types/notes';
import {
  buildPaperTaskState as buildLocalizedPaperTaskState,
} from '../paperTaskState';
import type {
  DocumentChatSession,
  MineruPage,
  PaperAnnotation,
  PaperSummary,
  PdfHighlightTarget,
  PdfReadingHeatmap,
  PdfScrollPosition,
  PdfSource,
  PositionedMineruBlock,
  ReaderQaScopeMode,
  ReaderViewMode,
  ReaderSecrets,
  ReaderSettings,
  SelectedExcerpt,
  TextSelectionSource,
  TranslationDisplayMode,
  WorkspaceItem,
  WorkspaceStage,
  ZoteroRelatedNote,
} from '../../../types/reader';
import { getPdfSourceSignature } from '../../pdf/pdfDocumentSource';
import {
  LibraryPreviewSyncPayload,
  loadPaneRatio,
  ReaderDocumentTranslationSnapshot,
  ReaderTabBridgeState,
} from '../documentReaderShared';
import {
  resolveActiveQaSession,
  resolveQaModelPreset,
} from '../documentReaderQaSessions';
import {
  type DistillPreviewState,
} from '../../notes/noteDistillPreview';
import {
  pickLocaleText,
  resolveModelPreset,
} from '../readerShared';
import { usePointerDragResize } from '../usePointerDragResize';
import { useReaderLayoutStore } from '../../../stores/useReaderLayoutStore';
import {
  getReaderQaAbortControllers,
  useReaderQaTab,
} from '../../../stores/useReaderQaStore';
import { useReaderNotesStore } from '../../../stores/useReaderNotesStore';

interface DocumentReaderTabCallbacks {
  onZoteroUserIdChange: (value: string) => void;
  onQaActivePresetChange: (presetId: string) => void;
  onDocumentResolved: (item: WorkspaceItem) => void;
  onLibraryPreviewSync: (payload: LibraryPreviewSyncPayload) => void;
  onOpenPreferences: () => void;
  onOpenStandalonePdf: () => void;
  onAttachTranslatedPdf?: (document: WorkspaceItem) => Promise<boolean>;
  onBridgeStateChange: (tabId: string, bridge: ReaderTabBridgeState | null) => void;
  onTranslationDisplayModeChange: (mode: TranslationDisplayMode) => void;
  onNotePaperClick?: (paperId: string) => void;
  onPendingNoteAnchorJumpHandled?: (requestId?: string) => void;
}


interface DocumentReaderTabProps {
  tabId: string;
  document: WorkspaceItem;
  isActive: boolean;
  settings: ReaderSettings;
  readerApiConfig: ReaderSecrets;
  zoteroLocalDataDir: string;
  readerCallbacks: DocumentReaderTabCallbacks;
  translationTargetLanguageLabel: string;
  notePaperCandidates?: LiteraturePaper[];
  loadLibraryPreviewBlocks?: (item: WorkspaceItem) => Promise<{ blocks: PositionedMineruBlock[] }>;
  pendingNoteAnchorJump?: JumpToNoteAnchorEventDetail | null;
  translationSnapshot?: ReaderDocumentTranslationSnapshot | null;
  /** 文库侧已加载的同一文档概览；阅读器尚无概览时先行显示。 */
  libraryPreviewSummary?: PaperSummary | null;
  overviewPaper?: LiteraturePaper;
  libraryStorageDir?: string;
}



const GLOBAL_READER_NOTE_EDITOR_SOURCE_ID = buildReaderNotesEditorSourceId('global');

export function useReaderTabState(props: DocumentReaderTabProps) {
  const {
  tabId,
  document,
  isActive,
  settings,
  readerApiConfig,
  zoteroLocalDataDir,
  readerCallbacks,
  translationTargetLanguageLabel,
  notePaperCandidates = [],
  loadLibraryPreviewBlocks,
  pendingNoteAnchorJump = null,
  translationSnapshot = null,
  libraryPreviewSummary = null,
  overviewPaper,
  libraryStorageDir,
} = props;

  const {
      embeddingApiKey,
      mineruApiToken,
      translationApiKey,
      summaryApiKey,
      qaModelPresets,
      zoteroApiKey,
      zoteroUserId,
    } = readerApiConfig;
  const {
      onZoteroUserIdChange,
      onQaActivePresetChange,
      onDocumentResolved,
      onLibraryPreviewSync,
      onOpenPreferences,
      onOpenStandalonePdf,
      onAttachTranslatedPdf,
      onBridgeStateChange,
      onTranslationDisplayModeChange,
      onNotePaperClick,
      onPendingNoteAnchorJumpHandled,
    } = readerCallbacks;
  const assistantActivePanel = useReaderLayoutStore((state) => state.assistantActivePanel);
  const setAssistantActivePanel = useReaderLayoutStore((state) => state.setAssistantActivePanel);
  const assistantDetached = useReaderLayoutStore((state) => state.assistantDetached);
  const setAssistantDetached = useReaderLayoutStore((state) => state.setAssistantDetached);
  const {
      setWorkspaceId: setQaWorkspaceId,
      qaSessions,
      setQaSessions,
      selectedQaSessionId,
      setSelectedQaSessionId,
      qaInput,
      setQaInput,
      qaAttachments,
      setQaAttachments,
      selectedQaPresetId,
      setSelectedQaPresetId,
      qaRagEnabled,
      setQaRagEnabled,
      qaAnswerRenderMode,
      setQaAnswerRenderMode,
      qaReasoningEffort,
      setQaReasoningEffort,
      qaRunningSessionIds,
      setQaRunningSessionIds,
      qaError,
      setQaError,
    } = useReaderQaTab(tabId);
  const notes = useReaderNotesStore((state) => state.notes);
  const setNotes = useReaderNotesStore((state) => state.setNotes);
  const activeNoteId = useReaderNotesStore((state) => state.activeNoteId);
  const setActiveNoteId = useReaderNotesStore((state) => state.setActiveNoteId);
  const notesLoading = useReaderNotesStore((state) => state.notesLoading);
  const setNotesLoading = useReaderNotesStore((state) => state.setNotesLoading);
  const notesSaving = useReaderNotesStore((state) => state.notesSaving);
  const setNotesSaving = useReaderNotesStore((state) => state.setNotesSaving);
  const notesError = useReaderNotesStore((state) => state.notesError);
  const setNotesError = useReaderNotesStore((state) => state.setNotesError);
  const locale = useAppLocale();
  const l = useLocaleText();
  const readerNoteEditorSourceId = GLOBAL_READER_NOTE_EDITOR_SOURCE_ID;
  const layoutRef = useRef<HTMLDivElement>(null);
  const summaryRequestIdRef = useRef(0);
  const summaryCacheWriter = useRef(createOverviewCacheWriter());
  const documentOpenGenerationRef = useRef(createDocumentOpenGeneration());
  const lastDocumentSignatureRef = useRef('');
  const lastCapturedSelectionRef = useRef<{
      source: TextSelectionSource;
      text: string;
      capturedAt: number;
    } | null>(null);
  const paperOpenedAtRef = useRef(Date.now());
  const restoredHistoryRef = useRef('');
  const qaHistoryReadyWorkspaceRef = useRef('');
  const qaHistoryGenerationRef = useRef(0);
  const qaAbortWorkspaceRef = useRef<string | null>(null);
  const qaAbortControllersRef = useRef(getReaderQaAbortControllers(tabId));
  const qaHistoryExpectedRef = useRef<{
      workspaceId: string;
      qaSessions: DocumentChatSession[];
      selectedQaSessionId: string;
    } | null>(null);
  const qaSessionsRef = useRef(qaSessions);
  const selectedQaSessionIdRef = useRef(selectedQaSessionId);
  const selectedQaPresetIdRef = useRef(selectedQaPresetId);
  const autoTranslatedSelectionKeyRef = useRef('');
  const autoSummarySourceKeyRef = useRef('');
  const cachedSummaryAttemptKeyRef = useRef('');
  const cachedSummaryRequestIdRef = useRef(0);
  const pendingHistoryActiveBlockIdRef = useRef<string | null>(null);
  const pdfTextCacheRef = useRef(createPdfTextCache());
  const localeRef = useRef(locale);
  const lRef = useRef(l);
  const [currentDocument, setCurrentDocument] = useState<WorkspaceItem>(document);
  const [attachTranslatedPdfBusy, setAttachTranslatedPdfBusy] = useState(false);
  const [pdfSource, setPdfSource] = useState<PdfSource>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfPageCountSnapshot, setPdfPageCountSnapshot] = useState<{
      sourceKey: string;
      data: Uint8Array | null;
      count: number;
    } | null>(null);
  const handlePdfPageCountChange = useCallback((count: number, source: PdfSource, data: Uint8Array | null) => {
      const sourceKey = getPdfSourceSignature(source);
      setPdfPageCountSnapshot((current) =>
        current?.sourceKey === sourceKey && current.data === data && current.count === count
          ? current
          : { sourceKey, data, count },
      );
    }, []);
  const [pdfDocumentErrorSnapshot, setPdfDocumentErrorSnapshot] = useState<{ sourceKey: string; error: string } | null>(null);
  const handlePdfDocumentErrorChange = useCallback((error: string, source: PdfSource) => {
      setPdfDocumentErrorSnapshot({ sourceKey: getPdfSourceSignature(source), error });
    }, []);
  const [pdfOpenFailed, setPdfOpenFailed] = useState(false);
  const [restoringDocumentBlocks, setRestoringDocumentBlocks] = useState(false);
  const [pdfPath, setPdfPath] = useState('');
  const pdfScrollPositionsRef = useRef<Record<string, PdfScrollPosition>>({});
  const pdfReadingHeatmapsRef = useRef<Record<string, PdfReadingHeatmap>>({});
  const [mineruPath, setMineruPath] = useState('');
  const [mineruPages, setMineruPages] = useState<MineruPage[]>([]);
  const [flatBlocks, setFlatBlocks] = useState<PositionedMineruBlock[]>([]);
  const [mineruOutlineIndex, setMineruOutlineIndex] = useState<MineruOutlineIndexItem[] | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [activePdfHighlight, setActivePdfHighlight] = useState<PdfHighlightTarget | null>(null);
  const [pdfHighlightSignal, setPdfHighlightSignal] = useState(0);
  const [blockScrollSignal, setBlockScrollSignal] = useState(0);
  const [leftPaneWidthRatio, setLeftPaneWidthRatio] = useState(loadPaneRatio);
  const latestPaneWidthRatioRef = useRef(leftPaneWidthRatio);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const startSplitResize = usePointerDragResize();
  const [workspaceStage, setWorkspaceStage] = useState<WorkspaceStage>('reading');
  const [readingViewMode, setReadingViewMode] = useState<ReaderViewMode>('dual-pane');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState(() => l('就绪', 'Ready'));
  const [paperSummary, setPaperSummary] = useState<PaperSummary | null>(null);
  const [paperSummaryLoading, setPaperSummaryLoading] = useState(false);
  const [summaryCacheLoading, setSummaryCacheLoading] = useState(false);
  const [paperSummaryError, setPaperSummaryError] = useState('');
  const [paperSummarySourceKey, setPaperSummarySourceKey] = useState('');
  const [libraryOperation, setLibraryOperation] = useState<LiteraturePaperTaskState | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [selectedExcerpt, setSelectedExcerpt] = useState<SelectedExcerpt | null>(null);
  const [selectionDistilling, setSelectionDistilling] = useState(false);
  const [distillPreview, setDistillPreview] = useState<DistillPreviewState | null>(null);
  const [distillPreviewAppendTarget, setDistillPreviewAppendTarget] = useState<Note | null>(null);
  const [distillVisionBusy, setDistillVisionBusy] = useState(false);
  const [distillVisionAvailable, setDistillVisionAvailable] = useState(false);
  const [pendingNoteAnchorInsert, setPendingNoteAnchorInsert] = useState<NoteAnchorInsertRequest | null>(null);
  const [pendingBlockAnchorJump, setPendingBlockAnchorJump] =
      useState<JumpToNoteAnchorEventDetail | null>(null);
  const [readerNoteExternalUpdate, setReaderNoteExternalUpdate] = useState<Note | null>(null);
  const updateLibraryOperation = useCallback(
      (
        kind: LiteraturePaperTaskState['kind'],
        status: LiteraturePaperTaskState['status'],
        message: string,
        completed?: number | null,
        total?: number | null,
      ) => {
        setLibraryOperation(
          buildLocalizedPaperTaskState({
            locale: localeRef.current,
            kind,
            status,
            message,
            completed,
            total,
          }),
        );
      },
      [],
    );
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [zoteroRelatedNotes, setZoteroRelatedNotes] = useState<ZoteroRelatedNote[]>([]);
  const [zoteroRelatedNotesLoading, setZoteroRelatedNotesLoading] = useState(false);
  const [zoteroRelatedNotesError, setZoteroRelatedNotesError] = useState('');
  const [projectPdfFiles, setProjectPdfFiles] = useState<LocalDirectoryFileEntry[]>([]);
  const readerLocaleText = useCallback(
      (zh: string, en: string) => pickLocaleText(settings.uiLanguage, zh, en),
      [settings.uiLanguage],
    );
  const translationModelPreset =
      resolveModelPreset(qaModelPresets, settings.translationModelPresetId) ?? qaModelPresets[0] ?? null;
  const selectionTranslationModelPreset =
      resolveModelPreset(qaModelPresets, settings.selectionTranslationModelPresetId) ??
      translationModelPreset;
  const summaryModelPreset =
      resolveModelPreset(qaModelPresets, settings.summaryModelPresetId) ?? translationModelPreset;
  const activeQaSession = useMemo(
      () => resolveActiveQaSession(qaSessions, selectedQaSessionId),
      [qaSessions, selectedQaSessionId],
    );
  const qaMessages = activeQaSession?.messages ?? [];
  const [qaScopeMode, setQaScopeMode] = useState<ReaderQaScopeMode>(
      activeQaSession?.ragScopeMode ?? 'current',
    );
  const [qaScopePaperIds, setQaScopePaperIds] = useState<string[]>(
      activeQaSession?.ragScopePaperIds ?? [],
    );
  const qaScopeSessionIdRef = useRef(activeQaSession?.id ?? '');
  const qaScopeDocumentsRef = useRef(new Map<string, ScopedRagDocument>());
  const translationConfigured = Boolean(
      translationModelPreset &&
        translationModelPreset.apiKey.trim() &&
        translationModelPreset.baseUrl.trim() &&
        translationModelPreset.model.trim(),
    );
  const summaryConfigured = Boolean(
      summaryModelPreset &&
        summaryModelPreset.apiKey.trim() &&
        summaryModelPreset.baseUrl.trim() &&
        summaryModelPreset.model.trim(),
    );
  const activeQaPreset = resolveQaModelPreset(qaModelPresets, selectedQaPresetId);
  const qaConfigured = Boolean(
    activeQaPreset?.apiKey.trim() &&
      activeQaPreset.baseUrl.trim() &&
      activeQaPreset.model.trim(),
  );
  const aiConfigured = translationConfigured || summaryConfigured || qaConfigured;
  const screenshotBusy = capturingScreenshot;
  const forceSaveCurrentPaperHistoryRef = useRef<() => void>(() => undefined);
  return { activeBlockId, activeNoteId, activePdfHighlight, activeQaPreset, activeQaSession, aiConfigured, annotations, assistantActivePanel, assistantDetached, attachTranslatedPdfBusy, autoSummarySourceKeyRef, autoTranslatedSelectionKeyRef, blockScrollSignal, cachedSummaryAttemptKeyRef, cachedSummaryRequestIdRef, capturingScreenshot, currentDocument, distillPreview, distillPreviewAppendTarget, distillVisionAvailable, distillVisionBusy, document, documentOpenGenerationRef, embeddingApiKey, error, flatBlocks, forceSaveCurrentPaperHistoryRef, handlePdfDocumentErrorChange, handlePdfPageCountChange, hoveredBlockId, isActive, isDraggingSplitter, l, lRef, lastCapturedSelectionRef, lastDocumentSignatureRef, latestPaneWidthRatioRef, layoutRef, leftPaneWidthRatio, libraryOperation, libraryPreviewSummary, libraryStorageDir, loadLibraryPreviewBlocks, loading, locale, localeRef, mineruApiToken, mineruOutlineIndex, mineruPages, mineruPath, notePaperCandidates, notes, notesError, notesLoading, notesSaving, onAttachTranslatedPdf, onBridgeStateChange, onDocumentResolved, onLibraryPreviewSync, onNotePaperClick, onOpenPreferences, onOpenStandalonePdf, onPendingNoteAnchorJumpHandled, onQaActivePresetChange, onTranslationDisplayModeChange, onZoteroUserIdChange, overviewPaper, paperOpenedAtRef, paperSummary, paperSummaryError, paperSummaryLoading, paperSummarySourceKey, pdfData, pdfDocumentErrorSnapshot, pdfHighlightSignal, pdfOpenFailed, pdfPageCountSnapshot, pdfPath, pdfReadingHeatmapsRef, pdfScrollPositionsRef, pdfSource, pdfTextCacheRef, pendingBlockAnchorJump, pendingHistoryActiveBlockIdRef, pendingNoteAnchorInsert, pendingNoteAnchorJump, projectPdfFiles, qaAbortControllersRef, qaAbortWorkspaceRef, qaAnswerRenderMode, qaAttachments, qaConfigured, qaError, qaHistoryExpectedRef, qaHistoryGenerationRef, qaHistoryReadyWorkspaceRef, qaInput, qaMessages, qaModelPresets, qaRagEnabled, qaReasoningEffort, qaRunningSessionIds, qaScopeDocumentsRef, qaScopeMode, qaScopePaperIds, qaScopeSessionIdRef, qaSessions, qaSessionsRef, readerApiConfig, readerCallbacks, readerLocaleText, readerNoteEditorSourceId, readerNoteExternalUpdate, readingViewMode, restoredHistoryRef, restoringDocumentBlocks, screenshotBusy, selectedAnnotationId, selectedExcerpt, selectedQaPresetId, selectedQaPresetIdRef, selectedQaSessionId, selectedQaSessionIdRef, selectionDistilling, selectionTranslationModelPreset, setActiveBlockId, setActiveNoteId, setActivePdfHighlight, setAnnotations, setAssistantActivePanel, setAssistantDetached, setAttachTranslatedPdfBusy, setBlockScrollSignal, setCapturingScreenshot, setCurrentDocument, setDistillPreview, setDistillPreviewAppendTarget, setDistillVisionAvailable, setDistillVisionBusy, setError, setFlatBlocks, setHoveredBlockId, setIsDraggingSplitter, setLeftPaneWidthRatio, setLibraryOperation, setLoading, setMineruOutlineIndex, setMineruPages, setMineruPath, setNotes, setNotesError, setNotesLoading, setNotesSaving, setPaperSummary, setPaperSummaryError, setPaperSummaryLoading, setPaperSummarySourceKey, setPdfData, setPdfDocumentErrorSnapshot, setPdfHighlightSignal, setPdfOpenFailed, setPdfPageCountSnapshot, setPdfPath, setPdfSource, setPendingBlockAnchorJump, setPendingNoteAnchorInsert, setProjectPdfFiles, setQaAnswerRenderMode, setQaAttachments, setQaError, setQaInput, setQaRagEnabled, setQaReasoningEffort, setQaRunningSessionIds, setQaScopeMode, setQaScopePaperIds, setQaSessions, setQaWorkspaceId, setReaderNoteExternalUpdate, setReadingViewMode, setRestoringDocumentBlocks, setSelectedAnnotationId, setSelectedExcerpt, setSelectedQaPresetId, setSelectedQaSessionId, setSelectionDistilling, setStatusMessage, setSummaryCacheLoading, setWorkspaceStage, setZoteroRelatedNotes, setZoteroRelatedNotesError, setZoteroRelatedNotesLoading, settings, startSplitResize, statusMessage, summaryApiKey, summaryCacheLoading, summaryCacheWriter, summaryConfigured, summaryModelPreset, summaryRequestIdRef, tabId, translationApiKey, translationConfigured, translationModelPreset, translationSnapshot, translationTargetLanguageLabel, updateLibraryOperation, workspaceStage, zoteroApiKey, zoteroLocalDataDir, zoteroRelatedNotes, zoteroRelatedNotesError, zoteroRelatedNotesLoading, zoteroUserId };
}

export type ReaderTabState = ReturnType<typeof useReaderTabState>;