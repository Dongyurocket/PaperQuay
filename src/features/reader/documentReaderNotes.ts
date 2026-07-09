import type { JumpToNoteAnchorEventDetail } from '../../app/appEvents';
import type {
  CreateNoteRequest,
  Note,
  NoteAnchor,
  NoteAnchorInsertRequest,
  NotePdfLocation,
} from '../../types/notes';
import type { PdfHighlightTarget, SelectedExcerpt } from '../../types/reader';

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

  return {
    requestId: createNoteAnchorJumpRequestId(),
    targetPaperId,
    noteId: note.id,
    noteTitle: note.title,
    notePaperId: note.paperId,
    anchorId: anchor.id,
    anchorPaperId: anchor.paperId,
    anchorLabel: anchor.label,
    blockId: anchor.blockId ?? null,
    pageIndex:
      typeof anchor.pageIndex === 'number'
        ? anchor.pageIndex
        : typeof anchor.pdfLocation?.pageNumber === 'number'
          ? Math.max(0, anchor.pdfLocation.pageNumber - 1)
          : null,
    sourceType: anchor.source ?? null,
    previewText: anchor.excerpt || null,
    pdfLocation: anchor.pdfLocation ?? null,
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
