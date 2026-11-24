import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Note, NoteAnchor } from '../../../types/notes';
import { extractNoteAnchorIds } from '../notesTiptap.ts';
import {
  clearNoteEditorDraft,
  fastSignature,
  mergeAnchors,
  readNoteEditorDraft,
  writeNoteEditorDraft,
  type EditorSnapshot,
  type NoteEditorDraft,
} from '../noteEditorUtils.ts';

export interface NoteEditorDraftPersistenceOptions {
  note: Note | null;
  loadedStateNoteId: string | null;
  currentSignature: string;
  dirty: boolean;
  revision: number;
  title: string;
  tagText: string;
  color: string;
  editorSourceIdRef: MutableRefObject<string>;
  loadedNoteIdRef: MutableRefObject<string | null>;
  snapshotRef: MutableRefObject<EditorSnapshot>;
  pendingDraftRef: MutableRefObject<NoteEditorDraft | null>;
  pendingAnchorsRef: MutableRefObject<Map<string, NoteAnchor>>;
  appliedUpdatedAtRef: MutableRefObject<number | null>;
  lastSavedSignatureRef: MutableRefObject<string>;
  restoringDraftRef: MutableRefObject<boolean>;
  /** 当前编辑器实例持有的笔记 id；用于判断能否用实时快照补全草稿。 */
  editorNoteIdRef: MutableRefObject<string | null>;
  /** 草稿落盘前同步读取完整快照（含 HTML/字数）；按键期间只维护廉价快照。 */
  snapshotProvider?: () => EditorSnapshot;
  /** 正文改动是否仍在 120ms 节流窗口内（尚未并入 revision）；关闭/隐藏时用于补建草稿。 */
  hasPendingContent?: () => boolean;
}

export interface NoteEditorDraftPersistenceHandle {
  /**
   * 立即落盘草稿。传入 liveSnapshot 时使用编辑器实时完整快照，缺省时现场读取。
   * 已有 payload 时用实时快照刷新；首个正文按键后 120ms 窗口内切换/卸载时
   * payload 尚不存在，这里按 dirty/未提交正文补建，避免丢字。
   */
  flushDraft(liveSnapshot?: EditorSnapshot, hasPendingContent?: boolean): void;
}

/** 补建/刷新草稿 payload 所需的实时状态；调用方须从 ref 读取，避免闭包过期。 */
export interface NoteEditorDraftFlushState {
  note: Note | null;
  loadedNoteId: string | null;
  title: string;
  tagText: string;
  color: string;
  dirty: boolean;
  currentSignature: string;
  appliedUpdatedAt: number | null;
  lastSavedSignature: string;
  hasPendingContent: boolean;
  baseAnchors: NoteAnchor[];
  previousAnchors: NoteAnchor[];
  pendingAnchors: NoteAnchor[];
}

/**
 * 决定切换/卸载/隐藏时要写入的草稿：
 * - 已有本笔记的 payload：用实时快照刷新（正文可能还在节流窗口里）；
 * - 没有 payload 但仍有未提交正文或 dirty：用实时快照补建；
 * - 干净状态返回 null，避免写出与已保存内容相同的空草稿。
 */
export function resolveNoteEditorDraftFlush(
  state: NoteEditorDraftFlushState,
  liveSnapshot: EditorSnapshot,
  existing: NoteEditorDraft | null,
): NoteEditorDraft | null {
  const currentNote = state.note;
  if (!currentNote || state.loadedNoteId !== currentNote.id || !state.lastSavedSignature) {
    return null;
  }

  const hasExistingPayload = existing?.noteId === currentNote.id;
  if (!hasExistingPayload && !state.dirty && !state.hasPendingContent) return null;

  const contentAnchorIds = extractNoteAnchorIds(liveSnapshot.contentJson);
  const pendingAnchors = mergeAnchors(state.baseAnchors, [
    ...state.previousAnchors,
    ...state.pendingAnchors,
  ]).filter((anchor) => contentAnchorIds.has(anchor.id));

  return {
    noteId: currentNote.id,
    baseUpdatedAt: state.appliedUpdatedAt ?? currentNote.updatedAt ?? null,
    savedSignature: state.lastSavedSignature,
    // 正文改动尚未并入 revision 时 currentSignature 还是旧的，必须按实时快照重算。
    draftSignature: state.hasPendingContent
      ? fastSignature({
        title: state.title,
        tagText: state.tagText,
        color: state.color,
        contentJson: liveSnapshot.contentJson,
        contentText: liveSnapshot.contentText,
      })
      : state.currentSignature,
    title: state.title,
    tagText: state.tagText,
    color: state.color,
    snapshot: liveSnapshot,
    pendingAnchors,
    updatedAt: Date.now(),
  };
}

/**
 * 草稿持久化：防抖写入 + 卸载/切换/窗口隐藏时立即冲刷。
 * 只移动自 NoteEditor 的 effect，执行顺序与依赖保持不变。
 */
export function useNoteEditorDraftPersistence({
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
  snapshotProvider,
  hasPendingContent,
}: NoteEditorDraftPersistenceOptions): NoteEditorDraftPersistenceHandle {
  // 写入时才冲刷完整快照，避免每次按键都 getHTML。
  const snapshotProviderRef = useRef(snapshotProvider);
  snapshotProviderRef.current = snapshotProvider;
  const hasPendingContentRef = useRef(hasPendingContent);
  hasPendingContentRef.current = hasPendingContent;
  // 上次落盘草稿携带的锚点；按笔记切换时读取一次，避免每次节流提交深拷贝草稿。
  const previousAnchorsRef = useRef<NoteAnchor[]>([]);
  // 渲染值只能在 effect 里更新：切换笔记时 cleanup 先于新 effect 执行，
  // 那时这里必须仍是旧笔记的标题/标签，才能把草稿写回正确的笔记。
  const latestRef = useRef({ note, title, tagText, color, dirty, currentSignature });
  useEffect(() => {
    latestRef.current = { note, title, tagText, color, dirty, currentSignature };
  });

  useEffect(() => {
    const noteId = note?.id ?? null;
    previousAnchorsRef.current = noteId
      ? readNoteEditorDraft(editorSourceIdRef.current, noteId)?.pendingAnchors ?? []
      : [];
  }, [editorSourceIdRef, note?.id]);

  const writePendingDraft = useCallback((payload: NoteEditorDraft, snapshotOverride?: EditorSnapshot) => {
    // 只补全 HTML/字数；锚点已在 effect 中按当前笔记计算并捕获。
    // 仅在 payload 属于当前编辑器所持有的笔记时才冲刷，避免切换笔记时
    // 把新笔记的编辑器内容写进旧笔记的草稿。
    const provider = snapshotProviderRef.current;
    const snapshot = snapshotOverride
      ?? (provider && editorNoteIdRef.current === payload.noteId
        ? provider()
        : payload.snapshot);
    previousAnchorsRef.current = payload.pendingAnchors;
    writeNoteEditorDraft(editorSourceIdRef.current, {
      ...payload,
      snapshot,
    });
  }, [editorNoteIdRef, editorSourceIdRef]);

  const flushDraft = useCallback((
    liveSnapshot?: EditorSnapshot,
    hasPendingContentOverride?: boolean,
  ) => {
    const state = latestRef.current;
    const pendingContent = hasPendingContentOverride
      ?? hasPendingContentRef.current?.()
      ?? false;
    const existing = pendingDraftRef.current;
    // 缺省时现场读取完整快照（pagehide/隐藏）；卸载 cleanup 阶段 tracker 已销毁，
    // snapshotProvider 会退回 snapshotRef 里的最近一次权威快照。
    const snapshot = liveSnapshot
      ?? (snapshotProviderRef.current ? snapshotProviderRef.current() : snapshotRef.current);
    const payload = resolveNoteEditorDraftFlush({
      note: state.note,
      loadedNoteId: loadedNoteIdRef.current,
      title: state.title,
      tagText: state.tagText,
      color: state.color,
      dirty: state.dirty,
      currentSignature: state.currentSignature,
      appliedUpdatedAt: appliedUpdatedAtRef.current,
      lastSavedSignature: lastSavedSignatureRef.current,
      hasPendingContent: pendingContent,
      baseAnchors: state.note?.anchors ?? [],
      previousAnchors: previousAnchorsRef.current,
      pendingAnchors: [...pendingAnchorsRef.current.values()],
    }, snapshot, existing);
    if (!payload) return;
    // 已同步落盘，清掉指针避免 hook 的卸载 cleanup 再写一遍大草稿。
    pendingDraftRef.current = null;
    writePendingDraft(payload, snapshot);
  }, [
    appliedUpdatedAtRef,
    editorNoteIdRef,
    editorSourceIdRef,
    lastSavedSignatureRef,
    loadedNoteIdRef,
    pendingAnchorsRef,
    pendingDraftRef,
    snapshotRef,
    writePendingDraft,
  ]);

  useEffect(() => {
    if (!note || loadedStateNoteId !== note.id || loadedNoteIdRef.current !== note.id || !lastSavedSignatureRef.current) {
      return;
    }

    if (restoringDraftRef.current) {
      restoringDraftRef.current = false;
      return;
    }

    if (!dirty) {
      // 保存后要同时丢弃 payload 指针，否则卸载时会把刚清掉的草稿又写回去。
      pendingDraftRef.current = null;
      clearNoteEditorDraft(editorSourceIdRef.current, note.id);
      return;
    }

    // 锚点在这里按当前笔记计算并捕获：切换笔记时 ref 已指向新笔记，
    // 延迟到写入阶段再读会丢失旧笔记的锚点元数据。
    const payload = resolveNoteEditorDraftFlush({
      note,
      loadedNoteId: loadedNoteIdRef.current,
      title,
      tagText,
      color,
      dirty,
      currentSignature,
      appliedUpdatedAt: appliedUpdatedAtRef.current,
      lastSavedSignature: lastSavedSignatureRef.current,
      hasPendingContent: false,
      baseAnchors: note.anchors,
      previousAnchors: previousAnchorsRef.current,
      pendingAnchors: [...pendingAnchorsRef.current.values()],
    }, snapshotRef.current, null);
    if (!payload) return;

    // S5：每次按键都全量序列化 + 写 localStorage 会拖慢输入；
    // 草稿写入防抖 300ms，切换笔记或卸载时立即冲刷（见下方 effect）。
    pendingDraftRef.current = payload;

    const timer = window.setTimeout(() => {
      const pending = pendingDraftRef.current;
      if (pending) writePendingDraft(pending);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [appliedUpdatedAtRef, color, currentSignature, dirty, editorSourceIdRef, lastSavedSignatureRef, loadedNoteIdRef, loadedStateNoteId, note, note?.id, note?.updatedAt, pendingAnchorsRef, pendingDraftRef, restoringDraftRef, revision, snapshotRef, tagText, title, writePendingDraft]);

  // 卸载或切换笔记时立即冲刷未落盘的草稿，避免防抖窗口内丢失编辑。
  useEffect(() => () => {
    const payload = pendingDraftRef.current;
    if (payload) writePendingDraft(payload);
  }, [note?.id, pendingDraftRef, writePendingDraft]);

  // 窗口关闭/刷新前同步冲刷草稿；localStorage 写入是同步的，可在 unload 阶段完成。
  // pagehide 覆盖 Electron 关闭窗口与进入后台，比 beforeunload 更稳定。
  useEffect(() => {
    const flushPendingDraft = () => {
      const payload = pendingDraftRef.current;
      if (payload) {
        writePendingDraft(payload);
        pendingDraftRef.current = null;
        return;
      }
      // 首个正文按键后 120ms 窗口内关闭窗口：payload 还没生成，用实时快照补建。
      flushDraft();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushPendingDraft();
    };

    window.addEventListener('beforeunload', flushPendingDraft);
    window.addEventListener('pagehide', flushPendingDraft);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('beforeunload', flushPendingDraft);
      window.removeEventListener('pagehide', flushPendingDraft);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      // 卸载时的落盘由 NoteEditor 的 flushLiveEditor（先行 cleanup）与上方
      // pending payload cleanup 负责，这里再冲刷会重复写一份大草稿。
    };
  }, [flushDraft, pendingDraftRef, writePendingDraft]);

  return { flushDraft };
}
