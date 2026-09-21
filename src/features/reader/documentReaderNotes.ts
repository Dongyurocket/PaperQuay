import type { JumpToNoteAnchorEventDetail } from '../../app/appEvents';
import type {
  CreateNoteRequest,
  Note,
  NoteAnchor,
  NoteAnchorInsertRequest,
  NotePdfLocation,
} from '../../types/notes';
import type { PdfHighlightTarget, SelectedExcerpt } from '../../types/reader';
import { resolveNoteAnchorLocation } from '../notes/noteAnchorLocation.ts';

export const READER_NOTES_EDITOR_SOURCE_ID_PREFIX = 'paperquay:reader-notes-sidebar';

type NotePdfLocationWithBBox = NotePdfLocation & {
  bbox: NonNullable<NotePdfLocation['bbox']>;
};

export function createNoteAnchorJumpRequestId(): string {
  return `note-anchor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createNoteAnchorInsertRequestId(): string {
  return `note-anchor-insert-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function buildReaderNotesEditorSourceId(tabId: string): string {
  return `${READER_NOTES_EDITOR_SOURCE_ID_PREFIX}:${tabId}`;
}

export function resolveNoteAnchorWorkspaceId(note: Note, anchor?: NoteAnchor): string {
  const rawTarget = (anchor?.paperId || note.paperId || '').trim();

  if (!rawTarget) {
    return '';
  }

  if (
    rawTarget.startsWith('native-library:') ||
    rawTarget.startsWith('standalone:') ||
    rawTarget.startsWith('onboarding:')
  ) {
    return rawTarget;
  }

  return `native-library:${rawTarget}`;
}

export function buildNoteAnchorJumpDetail(note: Note, anchor: NoteAnchor): JumpToNoteAnchorEventDetail {
  const targetPaperId = resolveNoteAnchorWorkspaceId(note, anchor) || anchor.paperId || note.paperId;
  // 锚点的 blockId / pageIndex 可能没有随笔记持久化（历史笔记只剩 id 与页码标签），
  // 这里统一从 id 中的分块信息与 `P20` 标签降级还原，避免「能打开文献但跳不过去」。
  const location = resolveNoteAnchorLocation(anchor);

  return {
    requestId: createNoteAnchorJumpRequestId(),
    targetPaperId,
    noteId: note.id,
    noteTitle: note.title,
    notePaperId: note.paperId,
    anchorId: anchor.id,
    anchorPaperId: anchor.paperId,
    anchorLabel: anchor.label,
    blockId: location.blockId,
    pageIndex: location.pageIndex,
    sourceType: anchor.source ?? null,
    previewText: anchor.excerpt || null,
    pdfLocation: location.pdfLocation,
  };
}

function hasPdfBoundingBox(
  location: NotePdfLocation | null | undefined,
): location is NotePdfLocationWithBBox {
  return Boolean(location?.bbox && location.pageNumber);
}

export function resolveNotePdfLocation(note: Note): NotePdfLocation | null {
  if (hasPdfBoundingBox(note.pdfLocation)) {
    return note.pdfLocation;
  }

  return note.anchors.find((anchor) => hasPdfBoundingBox(anchor.pdfLocation))?.pdfLocation ?? null;
}

export function buildPdfHighlightTargetFromNoteLocation(
  blockId: string,
  location: NotePdfLocation | null | undefined,
): PdfHighlightTarget | null {
  if (!hasPdfBoundingBox(location)) {
    return null;
  }

  return {
    blockId,
    pageIndex: Math.max(0, location.pageNumber - 1),
    bbox: location.bbox,
    bboxCoordinateSystem: location.bboxCoordinateSystem ?? 'normalized-1000',
    bboxPageSize: location.bboxPageSize ?? [1000, 1000],
  };
}

export function buildNotePdfHighlightTarget(note: Note): PdfHighlightTarget | null {
  return buildPdfHighlightTargetFromNoteLocation(`note:${note.id}`, resolveNotePdfLocation(note));
}

export function buildNoteAnchorPdfHighlightTarget(
  detail: JumpToNoteAnchorEventDetail,
): PdfHighlightTarget | null {
  return buildPdfHighlightTargetFromNoteLocation(
    `note-anchor:${detail.noteId}:${detail.anchorId}`,
    detail.pdfLocation,
  );
}

/** 跳转所需的锚点字段（笔记 id / 结构块 id / 页码 / 精确 PDF 位置）。 */
export type NoteAnchorJumpDetail = Pick<
  JumpToNoteAnchorEventDetail,
  'noteId' | 'anchorId' | 'blockId' | 'pageIndex' | 'pdfLocation'
>;

export interface NoteAnchorJumpBlock {
  blockId: string;
  pageIndex: number;
  type?: string;
}

export interface NoteAnchorJumpTarget<TBlock extends NoteAnchorJumpBlock> {
  /** 命中的结构块（精确命中，或引用所在页的正文块）。 */
  block: TBlock | null;
  pageIndex: number | null;
  /** 结构块缺失时的整页高亮兜底。 */
  highlightTarget: PdfHighlightTarget | null;
  /** 该文献确有结构块但还没加载完，值得挂起等待更精确的定位（无页码兜底时才等待）。 */
  shouldWaitForBlocks: boolean;
}

/**
 * 解析笔记跳转该落在哪里：精确块 → 引用所在页的正文块 → 整页高亮。
 *
 * 锚点的结构块信息可能已被历史数据丢掉（只剩页码标签），此时靠页码兜底，
 * 保证「芯片显示 P20 就一定跳到 P20」，不会只打开文献而停在原地。
 */
export function resolveNoteAnchorJumpTarget<TBlock extends NoteAnchorJumpBlock>(
  detail: NoteAnchorJumpDetail,
  blocks: TBlock[],
): NoteAnchorJumpTarget<TBlock> {
  const pageIndex =
    typeof detail.pageIndex === 'number' && Number.isFinite(detail.pageIndex)
      ? Math.max(0, Math.trunc(detail.pageIndex))
      : null;
  const samePageBlocks =
    pageIndex !== null ? blocks.filter((block) => block.pageIndex === pageIndex) : [];
  const samePageBodyBlock =
    samePageBlocks.find((block) => block.type !== 'title') ?? samePageBlocks[0] ?? null;
  const block =
    (detail.blockId ? blocks.find((item) => item.blockId === detail.blockId) : null) ??
    samePageBodyBlock ??
    null;
  const pageHighlightTarget: PdfHighlightTarget | null =
    pageIndex !== null
      ? {
          blockId: `agent-rag:${detail.anchorId || pageIndex}`,
          pageIndex,
          bbox: [0, 0, 1000, 1000],
          bboxCoordinateSystem: 'normalized-1000',
          bboxPageSize: [1000, 1000],
        }
      : null;
  const highlightTarget = buildNoteAnchorPdfHighlightTarget(detail) ?? pageHighlightTarget;

  return {
    block,
    pageIndex,
    highlightTarget,
    shouldWaitForBlocks: Boolean(detail.blockId) && blocks.length === 0 && !highlightTarget,
  };
}

export function isNoteEventRecord(value: unknown): value is Note {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<Note>;
  return typeof note.id === 'string' && typeof note.updatedAt === 'number';
}

export function sortReaderNotes(notes: Note[]): Note[] {
  return [...notes].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function resolveReaderNoteAnchorTarget(
  notes: Note[],
  activeNoteId: string | null,
): Note | null {
  return (activeNoteId ? notes.find((note) => note.id === activeNoteId) : null) ?? notes[0] ?? null;
}

export function buildSelectedExcerptNoteCreateRequest({
  paperId,
  selectedExcerpt,
  title,
}: {
  paperId: string;
  selectedExcerpt: SelectedExcerpt;
  title: string;
}): CreateNoteRequest {
  return {
    paperId,
    type: selectedExcerpt.source === 'pdf' || selectedExcerpt.blockId ? 'highlight' : 'standalone',
    title,
    content: '',
    tags: [],
    color: '#fef3c7',
  };
}

export function buildPendingNoteAnchorInsert(
  noteId: string,
  anchor: NoteAnchor,
  requestId = createNoteAnchorInsertRequestId(),
): NoteAnchorInsertRequest {
  return {
    requestId,
    noteId,
    anchor,
  };
}
