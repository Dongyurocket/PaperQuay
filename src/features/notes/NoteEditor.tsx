import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { NOTE_CHANGED_EVENT, type NoteChangedEventDetail } from '../../app/appEvents';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import type { LiteraturePaper } from '../../types/library';
import type {
  Note,
  NoteAnchor,
  NoteAnchorInsertRequest,
  NotePageKind,
  NoteTagSummary,
  UpdateNoteRequest,
} from '../../types/notes';
import { cn } from '../../utils/cn';
import { confirmAction } from '../../ui/confirmHost';
import { NotesContextMenu, type NotesContextMenuEntry } from './NotesContextMenu';
import {
  collectText,
  extractNoteAnchorIds,
  extractPaperRefs,
  extractWikiTitles,
  noteContentToTiptap,
  titleFromNoteContent,
} from './notesTiptap';
import { NoteBlockControls } from './NoteBlockControls';
import { NoteEditorToolbar } from './NoteEditorToolbar';
import { UNTITLED_NOTE_TITLE } from './notesText';
import type { PaperReferenceLocation } from './extensions/PaperReference';
import {
  loadNoteCitationStyle,
  normalizeNoteCitationStyle,
  saveNoteCitationStyle,
  type NoteCitationStyle,
} from './bibliography';
import {
  getAppSettingsSnapshot,
  subscribeAppSettings,
} from '../../app/settings/appSettingsCache';
import { getNote, type NoteMutationOptions } from '../../services/notes';
import {
  clampDocPosition,
  getBlockLabelFromNode,
  getEditorContextAtPoint,
  type NoteEditorContextMenuState,
} from './noteEditorBlockUtils';
import { normalizeTagInput, noteAnchorBlockFromAnchor } from './noteUtils';
import {
  clearNoteEditorDraft,
  contentHash,
  contentSnapshotFromSource,
  createEditorSnapshotSource,
  createNoteEditorSnapshotTracker,
  fastContentSignature,
  fastSignature,
  fastSignatureFromContent,
  isNoteRecord,
  legacyFastSignatureV2,
  mergeAnchors,
  NOTE_EDITOR_SNAPSHOT_THROTTLE_MS,
  paragraphNode,
  readEditorWordCount,
  readNoteEditorDraft,
  signature,
  snapshotFromEditor,
  snapshotFromNote,
  type ContentSnapshot,
  type EditorSnapshot,
  type NoteEditorDraft,
  type NoteEditorSnapshotTracker,
} from './noteEditorUtils';
import { createNoteEditorExtensions } from './editor/extensions';
import { useNoteEditorDraftPersistence } from './editor/draft';
import { createImageEditorProps } from './editor/images';
import {
  buildEditorContextMenuEntries,
  localizeNoteText,
  NoteEditorFooter,
  NoteEditorHeader,
} from './editor/toolbar';
import { slashCommandItems } from './editor/slashMenu';
import { createTableCellEditorProps } from './editor/tableCell';
import 'katex/dist/katex.min.css';

function createNoteEditorSourceId() {
  return `note-editor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/** 旧版把中文「未命名笔记」或英文「Untitled Note」哨兵写进数据层；编辑器统一视为空标题。 */
function normalizeEditableNoteTitle(value: string | null | undefined): string {
  const title = value ?? '';
  return title === UNTITLED_NOTE_TITLE || title.trim() === 'Untitled Note' ? '' : title;
}

interface NoteEditorProps {
  note: Note | null;
  saving: boolean;
  onUpdate: (
    noteId: string,
    patch: UpdateNoteRequest,
    options?: NoteMutationOptions,
  ) => Note | void | Promise<Note | void>;
  notes?: Note[];
  tags?: NoteTagSummary[];
  papers?: LiteraturePaper[];
  pendingAnchorInsert?: NoteAnchorInsertRequest | null;
  onPendingAnchorInsertHandled?: (requestId: string) => void;
  compact?: boolean;
  workspaceActive?: boolean;
  editorSourceId?: string;
  externalUpdateNote?: Note | null;
  onExternalUpdateChange?: (noteId: string, externalUpdate: boolean) => void;
  onExternalUpdateApply?: (note: Note) => void;
  onOpenNote?: (noteId: string) => void;
  onTagClick?: (tag: string) => void;
  onPaperClick?: (paperId: string, location?: PaperReferenceLocation) => void;
  onJumpToNoteAnchor?: (note: Note, anchor: NoteAnchor) => void;
  onPageKindChange?: (pageKind: NotePageKind) => void;
}

export function NoteEditor({
  note,
  saving,
  onUpdate,
  notes = [],
  tags = [],
  papers = [],
  pendingAnchorInsert = null,
  onPendingAnchorInsertHandled,
  compact = false,
  workspaceActive = true,
  editorSourceId,
  externalUpdateNote = null,
  onExternalUpdateChange,
  onExternalUpdateApply,
  onOpenNote,
  onTagClick,
  onPaperClick,
  onJumpToNoteAnchor,
  onPageKindChange,
}: NoteEditorProps) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const TEXT = useMemo(() => localizeNoteText(l), [l]);
  const initialTitle = normalizeEditableNoteTitle(note?.title);
  const [title, setTitle] = useState(initialTitle);
  const [loadedStateNoteId, setLoadedStateNoteId] = useState<string | null>(note?.id ?? null);
  const [tagText, setTagText] = useState(note?.tags.join(', ') ?? '');
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [color, setColor] = useState(note?.color ?? '#fef3c7');
  const [pageKind, setPageKind] = useState<NotePageKind | null>(note?.pageKind ?? null);
  const [revision, setRevision] = useState(0);
  const [externalUpdateAvailable, setExternalUpdateAvailable] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [editorContextMenu, setEditorContextMenu] = useState<NoteEditorContextMenuState | null>(null);
  const snapshotRef = useRef<EditorSnapshot>(snapshotFromNote(note));
  // 廉价内容快照（JSON + 纯文本），供按键期间的签名/脏标记使用，不含 HTML。
  const contentRef = useRef<ContentSnapshot>({
    contentJson: snapshotRef.current.contentJson,
    contentText: snapshotRef.current.contentText,
  });
  const snapshotTrackerRef = useRef<NoteEditorSnapshotTracker | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // 当前编辑器实例持有的笔记 id；切换笔记时用于把草稿写回正确的笔记。
  const editorNoteIdRef = useRef<string | null>(note?.id ?? null);
  const editorSourceIdRef = useRef(editorSourceId ?? createNoteEditorSourceId());
  const lastSavedSignatureRef = useRef(fastSignature({
    title: initialTitle,
    tagText: note?.tags.join(', ') ?? '',
    color: note?.color ?? '#fef3c7',
    contentJson: snapshotRef.current.contentJson,
    contentText: snapshotRef.current.contentText,
  }));
  const latestCandidatesRef = useRef({ notes, tags, papers });
  const latestAnchorsRef = useRef<NoteAnchor[]>(note?.anchors ?? []);
  const latestNoteRef = useRef<Note | null>(note);
  const externalNoteRef = useRef<Note | null>(null);
  const tagEditorRef = useRef<HTMLDivElement | null>(null);
  const editorBodyRef = useRef<HTMLDivElement | null>(null);
  const loadedNoteIdRef = useRef<string | null>(note?.id ?? null);
  const appliedUpdatedAtRef = useRef<number | null>(note?.updatedAt ?? null);
  const dirtyRef = useRef(false);
  // 正文首键后 120ms 节流窗口内 currentSignature 还没推进；用 liveDirty 立即
  // 点亮保存按钮/Ctrl+S，节流提交或保存成功后清除。
  const [liveDirty, setLiveDirty] = useState(false);
  const restoringDraftRef = useRef(false);
  const draftContentSyncPendingRef = useRef(false);
  const pendingDraftRef = useRef<NoteEditorDraft | null>(null);
  const externalUpdateAvailableRef = useRef(false);
  const externalUpdateGenerationRef = useRef(0);
  const noteSessionRef = useRef({ noteId: note?.id ?? null, generation: 0 });
  if (noteSessionRef.current.noteId !== (note?.id ?? null)) {
    noteSessionRef.current = { noteId: note?.id ?? null, generation: noteSessionRef.current.generation + 1 };
  }
  const forceApplyIncomingRef = useRef(false);
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const handledAnchorInsertRequestRef = useRef('');
  const pendingAnchorsRef = useRef(new Map<string, NoteAnchor>());
  const [citationStyle, setCitationStyle] = useState<NoteCitationStyle>(() => loadNoteCitationStyle());
  const latestCitationStyleRef = useRef<NoteCitationStyle>(citationStyle);
  // 切换/卸载时由 flushLiveEditor 调用的草稿冲刷入口（hook 在下方声明，运行期已就绪）。
  const draftFlushRef = useRef<((snapshot: EditorSnapshot, hasPendingContent: boolean) => void) | null>(null);

  // 切换笔记或卸载前同步冲刷：声明在 useEditor 之前，确保 Tiptap 销毁编辑器前还能读到最新内容。
  useEffect(() => {
    const flushLiveEditor = () => {
      const instance = editorRef.current;
      if (!instance || instance.isDestroyed) return;
      // 草稿正文尚未回填到编辑器时，编辑器内容落后于草稿，不能拿它覆盖草稿快照。
      if (draftContentSyncPendingRef.current) return;
      const tracker = snapshotTrackerRef.current;
      const hasPendingContent = Boolean(tracker?.hasPending()) || dirtyRef.current;
      const full = snapshotFromEditor(instance);
      snapshotRef.current = full;
      contentRef.current = {
        contentJson: full.contentJson,
        contentText: full.contentText,
      };
      // 首个正文按键后 120ms 节流窗口内切换/卸载时，草稿 effect 还没生成 payload；
      // 这里用完整实时快照补建并落盘，保证刚输入的正文不会丢。
      draftFlushRef.current?.(full, hasPendingContent);
    };
    return () => flushLiveEditor();
  }, [note?.id]);

  useEffect(() => {
    if (editorSourceId && editorSourceIdRef.current !== editorSourceId) {
      editorSourceIdRef.current = editorSourceId;
    }
  }, [editorSourceId]);

  useEffect(() => {
    latestCandidatesRef.current = { notes, tags, papers };
  }, [notes, papers, tags]);

  useEffect(() => {
    latestAnchorsRef.current = note?.anchors ?? [];
  }, [note?.anchors]);

  useEffect(() => {
    latestCitationStyleRef.current = citationStyle;
  }, [citationStyle]);

  // Reader 设置页或另一个笔记实例改引用样式后，同步到当前编辑器并重建编号。
  useEffect(() => subscribeAppSettings(() => {
    const snapshot = getAppSettingsSnapshot();
    if (!snapshot) return;

    const nextStyle = normalizeNoteCitationStyle(snapshot.settings.noteCitationStyle);
    setCitationStyle((current) => (current === nextStyle ? current : nextStyle));
  }), []);

  useEffect(() => {
    if (!tagEditorOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!tagEditorRef.current?.contains(event.target as Node)) {
        setTagEditorOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [tagEditorOpen]);

  useEffect(() => {
    latestNoteRef.current = note;
    setPageKind(note?.pageKind ?? null);
    if (note) {
      for (const anchor of note.anchors) {
        pendingAnchorsRef.current.delete(anchor.id);
      }
    }
  }, [note]);

  const jumpToAnchorId = useCallback((anchorId: string) => {
    const currentNote = latestNoteRef.current;
    const anchor =
      currentNote?.anchors.find((item) => item.id === anchorId) ??
      pendingAnchorsRef.current.get(anchorId);

    if (currentNote && anchor) {
      onJumpToNoteAnchor?.(currentNote, anchor);
    }
  }, [onJumpToNoteAnchor]);

  const extensions = useMemo(() => createNoteEditorExtensions({
    text: TEXT,
    noteId: note?.id ?? null,
    locale,
    slashCommandItems,
    latestCandidatesRef,
    latestAnchorsRef,
    latestCitationStyleRef,
    jumpToAnchorId,
    onOpenNote,
    onTagClick,
    onPaperClick,
    setReferencePickerOpen,
    setPageKind,
    onPageKindChange,
  }), [jumpToAnchorId, locale, note?.id, onOpenNote, onPaperClick, onTagClick]);

  const editor = useEditor({
    extensions,
    content: noteContentToTiptap(note),
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      ...createTableCellEditorProps(),
      ...createImageEditorProps(),
      // contenteditable 默认没有可访问名称；axe 的 label-content-name-mismatch
      // 会把它当成未标注控件。显式 textbox 角色让 aria-label 合法，标签随界面语言切换。
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': l('笔记正文', 'Note body'),
      },
    },
    onUpdate: ({ editor: instance }) => {
      const tracker = snapshotTrackerRef.current;
      if (tracker) {
        // S5：按键只标记脏，快照按 120ms 节流合并，避免每次按键 getJSON+getHTML。
        // liveDirty 让保存入口在节流窗口内立即可用。
        setLiveDirty(true);
        tracker.markDirty();
        return;
      }
      const content = contentSnapshotFromSource(createEditorSnapshotSource(instance));
      contentRef.current = content;
      snapshotRef.current = {
        ...snapshotRef.current,
        contentJson: content.contentJson,
        contentText: content.contentText,
        wordCount: readEditorWordCount(instance),
      };
      setRevision((value) => value + 1);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      lastSelectionRef.current = { from, to };
    },
  }, [note?.id]);

  const commitContentSnapshot = useCallback((content: ContentSnapshot, instance: Editor | null) => {
    // 草稿正文尚未回填到编辑器时，编辑器内容落后于草稿，不能覆盖权威快照。
    if (draftContentSyncPendingRef.current) return;
    contentRef.current = content;
    snapshotRef.current = {
      ...snapshotRef.current,
      contentJson: content.contentJson,
      contentText: content.contentText,
      wordCount: instance && !instance.isDestroyed
        ? readEditorWordCount(instance)
        : snapshotRef.current.wordCount,
    };
    setRevision((value) => value + 1);
    // 节流提交后 currentSignature 已包含最新正文，dirty 回到签名比较。
    setLiveDirty(false);
  }, []);

  // 编辑器实例（切换笔记时）重建 tracker；旧 tracker 的挂起计时器一并取消。
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      snapshotTrackerRef.current?.dispose();
      snapshotTrackerRef.current = null;
      editorNoteIdRef.current = null;
      return undefined;
    }
    editorNoteIdRef.current = note?.id ?? null;
    const tracker = createNoteEditorSnapshotTracker(createEditorSnapshotSource(editor), {
      intervalMs: NOTE_EDITOR_SNAPSHOT_THROTTLE_MS,
      onCommit: (content) => commitContentSnapshot(content, editor),
    });
    snapshotTrackerRef.current = tracker;
    return () => {
      tracker.dispose();
      if (snapshotTrackerRef.current === tracker) snapshotTrackerRef.current = null;
      editorNoteIdRef.current = null;
    };
  }, [commitContentSnapshot, editor, note?.id]);

  /** 立即提交挂起的廉价快照，用于外部更新比较。 */
  const flushContentSnapshot = useCallback((): ContentSnapshot => {
    // 恢复草稿后、编辑器回填前，以草稿内容为准，避免读到旧编辑器内容。
    if (draftContentSyncPendingRef.current) return contentRef.current;
    if (!editor || editor.isDestroyed) return contentRef.current;
    const tracker = snapshotTrackerRef.current;
    if (!tracker) {
      const content = contentSnapshotFromSource(createEditorSnapshotSource(editor));
      contentRef.current = content;
      return content;
    }
    const content = tracker.flushContent();
    contentRef.current = content;
    return content;
  }, [editor]);

  /** 立即读取完整快照（含 HTML/字数），用于保存、草稿与切换笔记。 */
  const flushSnapshot = useCallback((): EditorSnapshot => {
    // 草稿刚恢复、编辑器尚未回填时，以草稿快照为准。
    if (draftContentSyncPendingRef.current) return snapshotRef.current;
    if (!editor || editor.isDestroyed) return snapshotRef.current;
    const tracker = snapshotTrackerRef.current;
    const full = tracker ? tracker.flush() : snapshotFromEditor(editor);
    snapshotRef.current = full;
    contentRef.current = {
      contentJson: full.contentJson,
      contentText: full.contentText,
    };
    return full;
  }, [editor]);
  editorRef.current = editor;

  // 引用样式切换：通过单一设置文档的 patch 持久化，并用 meta 事务触发编号 decoration 重建。
  const handleCitationStyleChange = useCallback(
    (style: NoteCitationStyle) => {
      const normalized = normalizeNoteCitationStyle(style);
      saveNoteCitationStyle(normalized);
      setCitationStyle(normalized);
      if (editor && !editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta('noteCitationStyleChanged', true));
      }
    },
    [editor],
  );

  const lastAppliedCitationStyleRef = useRef<NoteCitationStyle>(citationStyle);
  useEffect(() => {
    if (lastAppliedCitationStyleRef.current === citationStyle) {
      return;
    }

    lastAppliedCitationStyleRef.current = citationStyle;
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta('noteCitationStyleChanged', true));
    }
  }, [citationStyle, editor]);

  const editorContextMenuEntries = useMemo<NotesContextMenuEntry[]>(() => {
    if (!editor || editor.isDestroyed || !editorContextMenu) return [];

    return buildEditorContextMenuEntries(editor, editorContextMenu, l);
  }, [editor, editorContextMenu, l]);

  // S5：内容签名只在正文 revision 变化时重算；标题/标签/颜色按键复用缓存，
  // 不再重新遍历 contentJson（8 张 base64 截图约 11ms/键）。
  const contentSignature = useMemo(
    () => fastContentSignature(contentRef.current.contentJson, contentRef.current.contentText),
    [revision],
  );
  const currentSignature = useMemo(
    () => fastSignatureFromContent({ title, tagText, color }, contentSignature),
    [color, contentSignature, tagText, title],
  );
  const currentSignatureRef = useRef(currentSignature);
  currentSignatureRef.current = currentSignature;
  const dirty = Boolean(note && (liveDirty || currentSignature !== lastSavedSignatureRef.current));
  const currentTags = useMemo(() => normalizeTagInput(tagText), [tagText]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // 切换笔记时编辑器实例重建，节流窗口的脏标记不能带到下一篇。
  useEffect(() => {
    setLiveDirty(false);
  }, [note?.id]);

  useEffect(() => {
    externalUpdateAvailableRef.current = externalUpdateAvailable;
  }, [externalUpdateAvailable]);

  const setExternalUpdateState = useCallback((value: boolean, noteId = note?.id) => {
    if (value) externalUpdateGenerationRef.current += 1;
    externalUpdateAvailableRef.current = value;
    setExternalUpdateAvailable(value);
    if (noteId) {
      onExternalUpdateChange?.(noteId, value);
    }
  }, [note?.id, onExternalUpdateChange]);

  useEffect(() => {
    if (!note) {
      setExternalUpdateState(false, loadedNoteIdRef.current ?? undefined);
      appliedUpdatedAtRef.current = null;
      return;
    }

    const handleNoteChanged = (event: Event) => {
      const detail = (event as CustomEvent<NoteChangedEventDetail>).detail;
      if (!detail || detail.noteId !== note.id) return;
      if (detail.sourceId && detail.sourceId === editorSourceIdRef.current) return;
      if (detail.action === 'deleted') return;

      const nextUpdatedAt = detail.updatedAt ?? (detail.note as Note | undefined)?.updatedAt ?? 0;
      const appliedUpdatedAt = appliedUpdatedAtRef.current ?? 0;

      if (isNoteRecord(detail.note, note.id)) {
        const incomingNote = detail.note;
        const incomingSnapshot = snapshotFromNote(incomingNote);
        const incomingSignature = fastSignature({
          title: normalizeEditableNoteTitle(incomingNote.title),
          tagText: incomingNote.tags.join(', '),
          color: incomingNote.color ?? '#fef3c7',
          contentJson: incomingSnapshot.contentJson,
          contentText: incomingSnapshot.contentText,
        });
        const localContent = flushContentSnapshot();
        const localSignature = fastSignature({
          title,
          tagText,
          color,
          contentJson: localContent.contentJson,
          contentText: localContent.contentText,
        });

        if (incomingSignature === localSignature) {
          if (nextUpdatedAt > appliedUpdatedAt) {
            appliedUpdatedAtRef.current = nextUpdatedAt;
          }
          return;
        }

        externalNoteRef.current = incomingNote;
        setExternalUpdateState(true, note.id);
        return;
      }

      if (nextUpdatedAt && nextUpdatedAt <= appliedUpdatedAt) return;
      setExternalUpdateState(true, note.id);
    };

    window.addEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
    return () => window.removeEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
  }, [color, flushContentSnapshot, note, setExternalUpdateState, tagText, title]);

  useEffect(() => {
    if (!note || !isNoteRecord(externalUpdateNote, note.id)) return;

    const incomingSnapshot = snapshotFromNote(externalUpdateNote);
    const incomingSignature = fastSignature({
      title: normalizeEditableNoteTitle(externalUpdateNote.title),
      tagText: externalUpdateNote.tags.join(', '),
      color: externalUpdateNote.color ?? '#fef3c7',
      contentJson: incomingSnapshot.contentJson,
      contentText: incomingSnapshot.contentText,
    });
    const localContent = flushContentSnapshot();
    const localSignature = fastSignature({
      title,
      tagText,
      color,
      contentJson: localContent.contentJson,
      contentText: localContent.contentText,
    });
    const appliedUpdatedAt = appliedUpdatedAtRef.current ?? 0;

    if (incomingSignature !== localSignature && (!externalUpdateNote.updatedAt || externalUpdateNote.updatedAt >= appliedUpdatedAt)) {
      externalNoteRef.current = externalUpdateNote;
      setExternalUpdateState(true, note.id);
    }
  }, [color, externalUpdateNote, flushContentSnapshot, note, setExternalUpdateState, tagText, title]);

  useEffect(() => {
    const incomingSnapshot = snapshotFromNote(note);
    const nextTitle = normalizeEditableNoteTitle(note?.title);
    const nextTagText = note?.tags.join(', ') ?? '';
    const nextColor = note?.color ?? '#fef3c7';
    const incomingContentSignature = fastContentSignature(
      incomingSnapshot.contentJson,
      incomingSnapshot.contentText,
    );
    const incomingSignature = fastSignatureFromContent({
      title: nextTitle,
      tagText: nextTagText,
      color: nextColor,
    }, incomingContentSignature);
    // 兼容旧版本写入的草稿（v2 快速签名 / v1 完整 JSON.stringify 签名），避免升级后误报冲突。
    const incomingLegacyFastSignature = legacyFastSignatureV2({
      title: nextTitle,
      tagText: nextTagText,
      color: nextColor,
      contentJson: incomingSnapshot.contentJson,
      contentText: incomingSnapshot.contentText,
    });
    const incomingLegacySignature = signature({
      title: nextTitle,
      tagText: nextTagText,
      color: nextColor,
      snapshot: incomingSnapshot,
    });
    const noteId = note?.id ?? null;
    const sameNote = loadedNoteIdRef.current === noteId;
    const forceApplyIncoming = forceApplyIncomingRef.current;
    forceApplyIncomingRef.current = false;
    const incomingUpdatedAt = note?.updatedAt ?? 0;
    const appliedUpdatedAt = appliedUpdatedAtRef.current ?? 0;
    const localContent = flushContentSnapshot();
    const localSignature = fastSignature({
      title,
      tagText,
      color,
      contentJson: localContent.contentJson,
      contentText: localContent.contentText,
    });
    const draft = !forceApplyIncoming && noteId
      ? readNoteEditorDraft(editorSourceIdRef.current, noteId)
      : null;
    const draftSignatureMatches = (stored: string) =>
      stored === incomingSignature ||
      stored === incomingLegacyFastSignature ||
      stored === incomingLegacySignature;
    const canRestoreDraft =
      draft &&
      !draftSignatureMatches(draft.draftSignature) &&
      (!sameNote || !dirtyRef.current || localSignature === incomingSignature);

    if (canRestoreDraft) {
      restoringDraftRef.current = true;
      draftContentSyncPendingRef.current = true;
      setTitle(normalizeEditableNoteTitle(draft.title));
      setTagText(draft.tagText);
      setColor(draft.color);

      snapshotRef.current = draft.snapshot;
      contentRef.current = {
        contentJson: draft.snapshot.contentJson,
        contentText: draft.snapshot.contentText,
      };
      // 编辑器已就绪时立即回填草稿正文；未就绪则由下方 sync effect 在编辑器创建后补上。
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(draft.snapshot.contentJson, { emitUpdate: false });
      }
      pendingAnchorsRef.current = new Map(draft.pendingAnchors.map((anchor) => [anchor.id, anchor]));
      loadedNoteIdRef.current = noteId;
      setLoadedStateNoteId(noteId);
      const hasConflict = !draftSignatureMatches(draft.savedSignature);
      appliedUpdatedAtRef.current = hasConflict ? draft.baseUpdatedAt : note?.updatedAt ?? null;
      lastSavedSignatureRef.current = hasConflict ? draft.savedSignature : incomingSignature;
      externalNoteRef.current = hasConflict ? note : null;
      setExternalUpdateState(hasConflict, noteId ?? undefined);
      setRevision((value) => value + 1);
      return;
    }

    if (draft && noteId && draftSignatureMatches(draft.draftSignature)) {
      clearNoteEditorDraft(editorSourceIdRef.current, noteId);
    }

    const incomingHasUnappliedChanges =
      sameNote &&
      !forceApplyIncoming &&
      incomingUpdatedAt > appliedUpdatedAt &&
      localSignature !== incomingSignature;

    if (incomingHasUnappliedChanges) {
      if (isNoteRecord(note, noteId)) {
        externalNoteRef.current = note;
      }
      setExternalUpdateState(true, noteId ?? undefined);
      return;
    }

    if (sameNote && externalUpdateAvailableRef.current && !forceApplyIncoming) {
      if (!isNoteRecord(externalNoteRef.current, noteId) && isNoteRecord(note, noteId)) {
        externalNoteRef.current = note;
      }
      return;
    }

    if (!sameNote || !dirtyRef.current || forceApplyIncoming) {
      setTitle(nextTitle);
      setTagText(nextTagText);
      setColor(nextColor);
    }

    if (editor && !editor.isDestroyed) {
      const editorContentChanged =
        JSON.stringify(editor.getJSON()) !== JSON.stringify(incomingSnapshot.contentJson);
      const shouldApplyContent =
        !sameNote ||
        forceApplyIncoming ||
        (!editor.isFocused && !dirtyRef.current && editorContentChanged);

      if (shouldApplyContent) {
        editor.commands.setContent(incomingSnapshot.contentJson, { emitUpdate: false });
        snapshotRef.current = incomingSnapshot;
        contentRef.current = {
          contentJson: incomingSnapshot.contentJson,
          contentText: incomingSnapshot.contentText,
        };
      }
    } else {
      snapshotRef.current = incomingSnapshot;
      contentRef.current = {
        contentJson: incomingSnapshot.contentJson,
        contentText: incomingSnapshot.contentText,
      };
    }

    loadedNoteIdRef.current = noteId;
    setLoadedStateNoteId(noteId);
    appliedUpdatedAtRef.current = note?.updatedAt ?? null;
    lastSavedSignatureRef.current = incomingSignature;
    if (forceApplyIncoming || !sameNote) {
      externalNoteRef.current = null;
      setExternalUpdateState(false, noteId ?? undefined);
    }
    setRevision((value) => value + 1);
    // S5：标题/标签/颜色不列入依赖——它们只影响本地签名比较，按当前渲染的闭包取值即可；
    // 若列入依赖，每次元数据按键都会重跑本 effect 并推进 revision，导致内容签名缓存失效。
  }, [editor, flushContentSnapshot, note, note?.id, note?.updatedAt, setExternalUpdateState]);

  useEffect(() => {
    // 只有恢复草稿后才需要把草稿正文补进编辑器；其余按键提交不走这里。
    if (!draftContentSyncPendingRef.current) return;
    if (!editor || editor.isDestroyed || !note || loadedNoteIdRef.current !== note.id) return;
    const draft = readNoteEditorDraft(editorSourceIdRef.current, note.id);
    if (!draft) {
      draftContentSyncPendingRef.current = false;
      return;
    }
    const draftFastSignature = fastSignature({
      title: draft.title,
      tagText: draft.tagText,
      color: draft.color,
      contentJson: draft.snapshot.contentJson,
      contentText: draft.snapshot.contentText,
    });
    if (currentSignatureRef.current !== draftFastSignature) return;
    if (contentHash(editor.getJSON()) !== contentHash(draft.snapshot.contentJson)) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled || editor.isDestroyed || noteSessionRef.current.noteId !== note.id || currentSignatureRef.current !== draftFastSignature) return;
        editor.commands.setContent(draft.snapshot.contentJson, { emitUpdate: false });
        draftContentSyncPendingRef.current = false;
      });
      return () => { cancelled = true; };
    }
    draftContentSyncPendingRef.current = false;
  }, [currentSignature, editor, note?.id]);

  const draftPersistence = useNoteEditorDraftPersistence({
    note,
    loadedStateNoteId,
    currentSignature,
    dirty,
    revision,
    title,
    tagText,
    color,
    editorSourceIdRef,
    loadedNoteIdRef,
    snapshotRef,
    pendingDraftRef,
    pendingAnchorsRef,
    appliedUpdatedAtRef,
    lastSavedSignatureRef,
    restoringDraftRef,
    editorNoteIdRef,
    snapshotProvider: flushSnapshot,
    // 正文首键后 120ms 内切换/卸载时 revision 还没推进，靠这里判断要补建草稿。
    hasPendingContent: () => Boolean(snapshotTrackerRef.current?.hasPending()),
  });
  // flushLiveEditor 的 cleanup 先于 tracker 销毁执行，届时通过这个入口补建草稿。
  draftFlushRef.current = draftPersistence.flushDraft;

  useEffect(() => {
    if (!editor || editor.isDestroyed || !note || !pendingAnchorInsert) return;
    if (pendingAnchorInsert.noteId && pendingAnchorInsert.noteId !== note.id) return;
    if (handledAnchorInsertRequestRef.current === pendingAnchorInsert.requestId) return;

    handledAnchorInsertRequestRef.current = pendingAnchorInsert.requestId;
    pendingAnchorsRef.current.set(pendingAnchorInsert.anchor.id, pendingAnchorInsert.anchor);

    const currentSelection = lastSelectionRef.current ?? {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    const insertAt = clampDocPosition(editor, currentSelection.to);

    editor
      .chain()
      .focus(insertAt)
      .insertContentAt(insertAt, [noteAnchorBlockFromAnchor(pendingAnchorInsert.anchor), paragraphNode()], {
        updateSelection: true,
      })
      .run();

    window.requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const endPosition = editor.state.selection.to;
      lastSelectionRef.current = { from: endPosition, to: endPosition };
      flushSnapshot();
      setRevision((value) => value + 1);
      onPendingAnchorInsertHandled?.(pendingAnchorInsert.requestId);
    });
  }, [editor, flushSnapshot, note, onPendingAnchorInsertHandled, pendingAnchorInsert]);

  const save = useCallback(async () => {
    if (!note || saving) return;
    const overwritingExternal = externalUpdateAvailableRef.current;
    if (overwritingExternal && !(await confirmAction({
      title: l('覆盖外部版本？', 'Overwrite external version?'),
      description: l(
        '此笔记已有外部更新。保存会覆盖外部版本，确定继续？',
        'This note has changed elsewhere. Saving will overwrite the external version. Continue?',
      ),
      danger: true,
    }))) return;

    // 保存前同步冲刷节流快照，确保写入的是最新正文与 HTML。
    const snapshot = flushSnapshot();
    const savedInputSignature = fastSignature({
      title,
      tagText,
      color,
      contentJson: snapshot.contentJson,
      contentText: snapshot.contentText,
    });
    const noteSession = noteSessionRef.current.generation;
    const externalGeneration = externalUpdateGenerationRef.current;
    const contentText = snapshot.contentText || collectText(snapshot.contentJson);
    const nextTitle = title.trim() || titleFromNoteContent(contentText);
    const tags = normalizeTagInput(tagText);
    const contentAnchorIds = extractNoteAnchorIds(snapshot.contentJson);
    const savedDraft = readNoteEditorDraft(editorSourceIdRef.current, note.id);
    const pendingAnchors = [...(savedDraft?.pendingAnchors ?? []), ...pendingAnchorsRef.current.values()].filter((anchor) =>
      contentAnchorIds.has(anchor.id),
    );
    const nextAnchors = mergeAnchors(note.anchors, pendingAnchors).filter((anchor) =>
      contentAnchorIds.has(anchor.id),
    );

    let updatedNote: Note | void;
    try {
      updatedNote = await onUpdate(
        note.id,
        {
        title: nextTitle,
        color,
        tags,
        content: contentText,
        contentJson: snapshot.contentJson,
        contentHtml: snapshot.contentHtml,
        contentText,
        wordCount: snapshot.wordCount,
        anchors: nextAnchors,
        pdfLocation: nextAnchors[0]?.pdfLocation ?? null,
        linkedNoteTitles: extractWikiTitles(contentText),
        pageKind,
        linkedPaperIds: extractPaperRefs(contentText),
        },
        { sourceId: editorSourceIdRef.current, expectedUpdatedAt: overwritingExternal
          ? externalNoteRef.current?.updatedAt ?? appliedUpdatedAtRef.current ?? note.updatedAt
          : appliedUpdatedAtRef.current ?? note.updatedAt },
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('NOTE_CONFLICT') &&
          noteSessionRef.current.generation === noteSession && noteSessionRef.current.noteId === note.id) {
        const current = await getNote(note.id).catch(() => null);
        if (noteSessionRef.current.generation !== noteSession || noteSessionRef.current.noteId !== note.id) return;
        externalNoteRef.current = current;
        setExternalUpdateState(true, note.id);
      }
      return;
    }

    if (!updatedNote) return;
    if (noteSessionRef.current.generation !== noteSession || noteSessionRef.current.noteId !== note.id) return;
    appliedUpdatedAtRef.current = updatedNote?.updatedAt ?? note.updatedAt ?? Date.now();
    if (externalUpdateGenerationRef.current === externalGeneration) {
      setExternalUpdateState(false, note.id);
    }
    lastSavedSignatureRef.current = fastSignature({
      title: nextTitle,
      tagText,
      color,
      contentJson: snapshot.contentJson,
      contentText: snapshot.contentText,
    });
    if (currentSignatureRef.current === savedInputSignature) {
      clearNoteEditorDraft(editorSourceIdRef.current, note.id);
      setTitle(nextTitle);
    }
    setLiveDirty(false);
    setRevision((value) => value + 1);
  }, [color, editor, flushSnapshot, l, note, onUpdate, pageKind, saving, setExternalUpdateState, tagText, title]);

  const refreshFromExternalUpdate = useCallback(async () => {
    if (dirty && !(await confirmAction({
      title: l('丢弃未保存的编辑？', 'Discard unsaved edits?'),
      description: l('刷新会丢弃当前未保存的编辑，确定继续？', 'Refreshing will discard your unsaved edits. Continue?'),
      danger: true,
    }))) return;
    const incomingNote =
      note && isNoteRecord(externalUpdateNote, note.id)
        ? externalUpdateNote
        : externalNoteRef.current ?? note;
    if (!incomingNote) return;

    const incomingSnapshot = snapshotFromNote(incomingNote);
    const nextTitle = normalizeEditableNoteTitle(incomingNote.title);
    const nextTagText = incomingNote.tags.join(', ');
    const nextColor = incomingNote.color ?? '#fef3c7';

    setTitle(nextTitle);
    setTagText(nextTagText);
    setColor(nextColor);
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(incomingSnapshot.contentJson, { emitUpdate: false });
    }
    snapshotRef.current = incomingSnapshot;
    contentRef.current = {
      contentJson: incomingSnapshot.contentJson,
      contentText: incomingSnapshot.contentText,
    };
    loadedNoteIdRef.current = incomingNote.id;
    appliedUpdatedAtRef.current = incomingNote.updatedAt ?? null;
    lastSavedSignatureRef.current = fastSignature({
      title: nextTitle,
      tagText: nextTagText,
      color: nextColor,
      contentJson: incomingSnapshot.contentJson,
      contentText: incomingSnapshot.contentText,
    });
    pendingAnchorsRef.current.clear();
    externalNoteRef.current = null;
    clearNoteEditorDraft(editorSourceIdRef.current, incomingNote.id);
    setExternalUpdateState(false, incomingNote.id);
    onExternalUpdateApply?.(incomingNote);
    setRevision((value) => value + 1);
  }, [dirty, editor, externalUpdateNote, l, note, onExternalUpdateApply, setExternalUpdateState]);

  const handleEditorKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
      event.preventDefault();
      if (!dirty || saving) return;
      void save();
    }
  }, [dirty, save, saving]);

  const openEditorContextMenu = useCallback((clientX: number, clientY: number) => {
    if (!editor || editor.isDestroyed) return false;

    const context = getEditorContextAtPoint(editor, clientX, clientY);
    if (!context) return false;

    setEditorContextMenu({
      x: clientX,
      y: clientY,
      ...context,
    });
    return true;
  }, [editor]);

  const handleEditorContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const editorBody = event.currentTarget;
    if (!editorBody.contains(target)) return;
    if (target.closest('input, textarea, select')) {
      setEditorContextMenu(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openEditorContextMenu(event.clientX, event.clientY);
  }, [editor, openEditorContextMenu]);

  useEffect(() => {
    const editorBody = editorBodyRef.current;
    if (!editorBody || !editor || editor.isDestroyed) return undefined;

    const handleNativeContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!editorBody.contains(target)) return;
      if (target.closest('input, textarea, select')) {
        setEditorContextMenu(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openEditorContextMenu(event.clientX, event.clientY);
    };

    editorBody.addEventListener('contextmenu', handleNativeContextMenu, true);

    return () => {
      editorBody.removeEventListener('contextmenu', handleNativeContextMenu, true);
    };
  }, [editor, openEditorContextMenu]);

  if (!note) {
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center rounded-[var(--pq-radius-md)] border border-dashed border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-4 text-center text-sm leading-6 text-[var(--pq-text-muted)]">
        {TEXT.noNote}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)]',
        compact ? 'pq-note-editor-compact' : '',
      )}
      onKeyDown={handleEditorKeyDown}
    >
      <NoteEditorHeader
        compact={compact}
        text={TEXT}
        title={title}
        onTitleChange={setTitle}
        saving={saving}
        dirty={dirty}
        externalUpdateAvailable={externalUpdateAvailable}
        onRefresh={() => void refreshFromExternalUpdate()}
        tagText={tagText}
        onTagTextChange={setTagText}
        tagEditorOpen={tagEditorOpen}
        onTagEditorToggle={() => setTagEditorOpen((value) => !value)}
        tagEditorRef={tagEditorRef}
        currentTags={currentTags}
        tags={tags}
      />

      <NoteEditorToolbar
        editor={editor}
        papers={papers ?? []}
        citationStyle={citationStyle}
        onCitationStyleChange={handleCitationStyleChange}
        referencePickerOpen={referencePickerOpen}
        onReferencePickerToggle={() => setReferencePickerOpen((open) => !open)}
        onReferencePickerClose={() => setReferencePickerOpen(false)}
      />

      <div
        ref={editorBodyRef}
        className="pq-note-editor-body min-h-0 flex-1 overflow-y-auto"
        onContextMenu={handleEditorContextMenu}
        onScroll={() => setEditorContextMenu(null)}
      >
        <EditorContent editor={editor} className={cn('pq-tiptap-editor', compact ? 'is-compact' : '')} />
        {workspaceActive ? <NoteBlockControls editor={editor} compact={compact} /> : null}
      </div>

      {editorContextMenu ? (
        <NotesContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          title={getBlockLabelFromNode(editorContextMenu.block.node, l)}
          entries={editorContextMenuEntries}
          onClose={() => setEditorContextMenu(null)}
          width={244}
        />
      ) : null}

      <NoteEditorFooter
        l={l}
        text={TEXT}
        wordCount={snapshotRef.current.wordCount || 0}
        contentText={snapshotRef.current.contentText}
        externalUpdateAvailable={externalUpdateAvailable}
        onRefresh={() => void refreshFromExternalUpdate()}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
      />
    </div>
  );
}
