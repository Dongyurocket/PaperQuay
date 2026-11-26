import type { NotePdfLocation } from '../types/notes';

export const OPEN_PREFERENCES_EVENT = 'paperquay:open-preferences';
export const UI_LANGUAGE_CHANGED_EVENT = 'paperquay:ui-language-changed';
export const OPEN_STANDALONE_PDF_EVENT = 'paperquay:open-standalone-pdf';
export const OPEN_LIBRARY_PAPER_EVENT = 'paperquay:open-library-paper';
export const JUMP_TO_NOTE_ANCHOR_EVENT = 'paperquay:jump-to-note-anchor';
export const NOTE_CHANGED_EVENT = 'paperquay:note-changed';
export const OPEN_AGENT_WITH_INSTRUCTION_EVENT = 'paperquay:open-agent-with-instruction';
export const OPEN_GRAPH_FOCUS_EVENT = 'paperquay:open-graph-focus';

export interface OpenPreferencesEventDetail {
  section?:
    | 'general'
    | 'library'
    | 'reading'
    | 'mineru'
    | 'backup'
    | 'translation'
    | 'models'
    | 'embedding'
    | 'summaryQa';
}

export function emitOpenPreferences(section?: OpenPreferencesEventDetail['section']) {
  window.dispatchEvent(
    new CustomEvent<OpenPreferencesEventDetail>(OPEN_PREFERENCES_EVENT, {
      detail: { section },
    }),
  );
}

export interface JumpToNoteAnchorEventDetail {
  requestId?: string;
  jumpSource?: 'note-anchor' | 'agent-rag';
  targetPaperId?: string;
  noteId: string;
  noteTitle?: string;
  notePaperId?: string;
  anchorId: string;
  anchorPaperId?: string;
  anchorLabel?: string;
  blockId?: string | null;
  pageIndex?: number | null;
  previewText?: string | null;
  sourceType?: string | null;
  pdfLocation?: NotePdfLocation | null;
}

export interface NoteChangedEventDetail {
  action: 'created' | 'updated' | 'deleted';
  noteId: string;
  note?: unknown;
  updatedAt?: number;
  sourceId?: string;
}

export interface OpenGraphFocusEventDetail {
  /** 直接指定图节点 id（paper:xxx / note:xxx）。 */
  nodeId?: string;
  paperId?: string;
  noteId?: string;
}

// 图谱是懒加载工作区：首次“在图中查看”时组件尚未挂载，事件会丢。
// 这里保留最后一次请求，图谱挂载后主动消费。
let pendingGraphFocus: OpenGraphFocusEventDetail | null = null;

/** 打开图谱并聚焦到指定论文/笔记；App 负责切换工作区，图谱负责定位。 */
export function emitOpenGraphFocus(detail: OpenGraphFocusEventDetail) {
  pendingGraphFocus = detail;
  window.dispatchEvent(
    new CustomEvent<OpenGraphFocusEventDetail>(OPEN_GRAPH_FOCUS_EVENT, { detail }),
  );
}

export function consumePendingGraphFocus(): OpenGraphFocusEventDetail | null {
  const detail = pendingGraphFocus;
  pendingGraphFocus = null;
  return detail;
}

export function emitOpenStandalonePdf() {
  window.dispatchEvent(new CustomEvent(OPEN_STANDALONE_PDF_EVENT));
}

export interface OpenLibraryPaperEventDetail {
  paperId: string;
}

export function emitOpenLibraryPaper(paperId: string) {
  window.dispatchEvent(
    new CustomEvent<OpenLibraryPaperEventDetail>(OPEN_LIBRARY_PAPER_EVENT, {
      detail: { paperId },
    }),
  );
}

export function emitJumpToNoteAnchor(detail: JumpToNoteAnchorEventDetail) {
  window.dispatchEvent(
    new CustomEvent<JumpToNoteAnchorEventDetail>(JUMP_TO_NOTE_ANCHOR_EVENT, {
      detail,
    }),
  );
}

export function emitNoteChanged(detail: NoteChangedEventDetail) {
  window.dispatchEvent(
    new CustomEvent<NoteChangedEventDetail>(NOTE_CHANGED_EVENT, {
      detail,
    }),
  );
}

export function emitOpenAgentWithInstruction(instruction: string) {
  window.dispatchEvent(
    new CustomEvent<{ instruction: string }>(OPEN_AGENT_WITH_INSTRUCTION_EVENT, {
      detail: { instruction },
    }),
  );
}

export function emitUiLanguageChanged(language: 'zh-CN' | 'en-US') {
  window.dispatchEvent(
    new CustomEvent<{ language: 'zh-CN' | 'en-US' }>(UI_LANGUAGE_CHANGED_EVENT, {
      detail: { language },
    }),
  );
}
