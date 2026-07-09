import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPendingNoteAnchorInsert,
  buildNoteAnchorJumpDetail,
  buildNoteAnchorPdfHighlightTarget,
  buildNotePdfHighlightTarget,
  buildReaderNotesEditorSourceId,
  buildSelectedExcerptNoteCreateRequest,
  isNoteEventRecord,
  resolveReaderNoteAnchorTarget,
  resolveNotePdfLocation,
  resolveNoteAnchorWorkspaceId,
  sortReaderNotes,
} from '../src/features/reader/documentReaderNotes.ts';
import type { Note, NoteAnchor } from '../src/types/notes.ts';
import type { SelectedExcerpt } from '../src/types/reader.ts';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? 'note-1',
    paperId: overrides.paperId ?? 'paper-1',
    type: overrides.type ?? 'standalone',
    title: overrides.title ?? 'Reader Note',
    content: overrides.content ?? '',
    aiChatMessageIds: overrides.aiChatMessageIds ?? [],
    anchors: overrides.anchors ?? [],
    tags: overrides.tags ?? [],
    color: overrides.color ?? '#fef3c7',
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    linkedNoteIds: overrides.linkedNoteIds ?? [],
    linkedPaperIds: overrides.linkedPaperIds ?? [],
    ...overrides,
  };
}

function anchor(overrides: Partial<NoteAnchor> = {}): NoteAnchor {
  return {
    id: overrides.id ?? 'anchor-1',
    label: overrides.label ?? 'P3',
    excerpt: overrides.excerpt ?? 'quoted text',
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  };
}

test('buildReaderNotesEditorSourceId namespaces source ids by tab', () => {
  assert.equal(
    buildReaderNotesEditorSourceId('tab-1'),
    'paperquay:reader-notes-sidebar:tab-1',
  );
});

test('resolveNoteAnchorWorkspaceId preserves workspace ids and wraps library ids', () => {
  assert.equal(resolveNoteAnchorWorkspaceId(note({ paperId: 'paper-1' })), 'native-library:paper-1');
  assert.equal(resolveNoteAnchorWorkspaceId(note({ paperId: 'standalone:abc' })), 'standalone:abc');
  assert.equal(
    resolveNoteAnchorWorkspaceId(note({ paperId: 'paper-1' }), anchor({ paperId: 'paper-2' })),
    'native-library:paper-2',
  );
});

test('buildNoteAnchorJumpDetail carries note and anchor targeting fields', () => {
  const targetNote = note({ id: 'n1', paperId: 'paper-1', title: 'Title' });
  const targetAnchor = anchor({
    id: 'a1',
    paperId: 'paper-2',
    label: 'P8',
    blockId: 'block-8',
    pageIndex: 7,
    pdfLocation: { pageNumber: 8 },
  });
  const detail = buildNoteAnchorJumpDetail(targetNote, targetAnchor);

  assert.match(detail.requestId ?? '', /^note-anchor-/);
  assert.equal(detail.targetPaperId, 'native-library:paper-2');
  assert.equal(detail.noteId, 'n1');
  assert.equal(detail.noteTitle, 'Title');
  assert.equal(detail.anchorId, 'a1');
  assert.equal(detail.blockId, 'block-8');
  assert.equal(detail.pageIndex, 7);
  assert.equal(detail.previewText, 'quoted text');
  assert.deepEqual(detail.pdfLocation, { pageNumber: 8 });
});

test('note PDF highlight helpers prefer note location and fall back to anchor location', () => {
  const primary = note({
    id: 'n1',
    pdfLocation: {
      pageNumber: 3,
      bbox: [1, 2, 3, 4],
      bboxCoordinateSystem: 'pdf',
      bboxPageSize: [600, 800],
    },
    anchors: [
      anchor({
        pdfLocation: {
          pageNumber: 5,
          bbox: [5, 6, 7, 8],
        },
      }),
    ],
  });
  const fallback = note({
    id: 'n2',
    anchors: [
      anchor({
        pdfLocation: {
          pageNumber: 5,
          bbox: [5, 6, 7, 8],
        },
      }),
    ],
  });

  assert.equal(resolveNotePdfLocation(primary)?.pageNumber, 3);
  assert.deepEqual(buildNotePdfHighlightTarget(primary), {
    blockId: 'note:n1',
    pageIndex: 2,
    bbox: [1, 2, 3, 4],
    bboxCoordinateSystem: 'pdf',
    bboxPageSize: [600, 800],
  });
  assert.deepEqual(buildNotePdfHighlightTarget(fallback), {
    blockId: 'note:n2',
    pageIndex: 4,
    bbox: [5, 6, 7, 8],
    bboxCoordinateSystem: 'normalized-1000',
    bboxPageSize: [1000, 1000],
  });
  assert.equal(buildNotePdfHighlightTarget(note({ pdfLocation: { pageNumber: 1 } })), null);
});

test('buildNoteAnchorPdfHighlightTarget converts jump details into highlight targets', () => {
  const detail = buildNoteAnchorJumpDetail(
    note({ id: 'n1' }),
    anchor({
      id: 'a1',
      pdfLocation: {
        pageNumber: 1,
        bbox: [10, 20, 30, 40],
      },
    }),
  );

  assert.deepEqual(buildNoteAnchorPdfHighlightTarget(detail), {
    blockId: 'note-anchor:n1:a1',
    pageIndex: 0,
    bbox: [10, 20, 30, 40],
    bboxCoordinateSystem: 'normalized-1000',
    bboxPageSize: [1000, 1000],
  });
  assert.equal(
    buildNoteAnchorPdfHighlightTarget({ ...detail, pdfLocation: { pageNumber: 1 } }),
    null,
  );
});

test('isNoteEventRecord validates note-like event payloads', () => {
  assert.equal(isNoteEventRecord(note({ id: 'n1', updatedAt: 5 })), true);
  assert.equal(isNoteEventRecord({ id: 'n1' }), false);
  assert.equal(isNoteEventRecord(null), false);
});

test('sortReaderNotes orders notes by newest update first without mutating input', () => {
  const older = note({ id: 'old', updatedAt: 1 });
  const newer = note({ id: 'new', updatedAt: 3 });
  const notes = [older, newer];
  const sorted = sortReaderNotes(notes);

  assert.deepEqual(sorted.map((item) => item.id), ['new', 'old']);
  assert.deepEqual(notes.map((item) => item.id), ['old', 'new']);
});

test('reader note anchor helpers choose targets and build insert requests', () => {
  const first = note({ id: 'first' });
  const active = note({ id: 'active' });
  const targetAnchor = anchor({ id: 'anchor-1' });

  assert.equal(resolveReaderNoteAnchorTarget([first, active], 'active')?.id, 'active');
  assert.equal(resolveReaderNoteAnchorTarget([first, active], 'missing')?.id, 'first');
  assert.equal(resolveReaderNoteAnchorTarget([], null), null);

  assert.deepEqual(buildPendingNoteAnchorInsert('active', targetAnchor, 'request-1'), {
    requestId: 'request-1',
    noteId: 'active',
    anchor: targetAnchor,
  });
});

test('buildSelectedExcerptNoteCreateRequest derives note type from excerpt source', () => {
  const pdfExcerpt: SelectedExcerpt = {
    text: 'Important quote',
    source: 'pdf',
    createdAt: 1,
  };
  const blockExcerpt: SelectedExcerpt = {
    text: 'Structured block quote',
    source: 'blocks',
    createdAt: 1,
  };
  const locatedBlockExcerpt: SelectedExcerpt = {
    text: 'Located structured block quote',
    source: 'blocks',
    blockId: 'block-1',
    createdAt: 1,
  };

  assert.deepEqual(
    buildSelectedExcerptNoteCreateRequest({
      paperId: 'paper-1',
      selectedExcerpt: pdfExcerpt,
      title: 'Important quote',
    }),
    {
      paperId: 'paper-1',
      type: 'highlight',
      title: 'Important quote',
      content: '',
      tags: [],
      color: '#fef3c7',
    },
  );
  assert.equal(
    buildSelectedExcerptNoteCreateRequest({
      paperId: 'paper-1',
      selectedExcerpt: blockExcerpt,
      title: 'Structured block quote',
    }).type,
    'standalone',
  );
  assert.equal(
    buildSelectedExcerptNoteCreateRequest({
      paperId: 'paper-1',
      selectedExcerpt: locatedBlockExcerpt,
      title: 'Located structured block quote',
    }).type,
    'highlight',
  );
});
