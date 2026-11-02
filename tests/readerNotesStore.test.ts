import test from 'node:test';
import assert from 'node:assert/strict';

import { useReaderNotesStore } from '../src/stores/useReaderNotesStore.ts';
import type { Note } from '../src/types/notes.ts';

function note(id: string): Note {
  return {
    id,
    paperId: 'paper-1',
    type: 'standalone',
    title: id,
    content: '',
    createdAt: 1,
    updatedAt: 1,
    anchors: [],
    tags: [],
    color: '#fff',
    linkedNoteIds: [],
    linkedPaperIds: [],
    linkedNoteTitles: [],
    linkedPaperId: null,
    folderId: null,
    pageKind: null,
    contentJson: null,
    contentHtml: null,
    contentText: '',
    excerpt: null,
    pdfLocation: null,
    wordCount: 0,
    isFavorite: false,
    isPinned: false,
  };
}

function resetStore() {
  useReaderNotesStore.setState({
    notes: [],
    activeNoteId: null,
    notesLoading: false,
    notesSaving: false,
    notesError: '',
  });
}

test('reader notes store exposes the original defaults', () => {
  resetStore();
  const state = useReaderNotesStore.getState();

  assert.deepEqual(state.notes, []);
  assert.equal(state.activeNoteId, null);
  assert.equal(state.notesLoading, false);
  assert.equal(state.notesSaving, false);
  assert.equal(state.notesError, '');
});

test('reader notes store setters preserve note identity and functional updates', () => {
  resetStore();
  const notes = [note('n1'), note('n2')];
  const state = useReaderNotesStore.getState();

  state.setNotes(notes);
  state.setActiveNoteId('n1');
  state.setNotesLoading(true);
  state.setNotesSaving(true);
  state.setNotesError('save failed');
  state.setActiveNoteId((current) => current === 'n1' ? 'n2' : current);
  state.setNotes((current) => [...current, note('n3')]);
  state.setNotesLoading((current) => !current);
  state.setNotesSaving((current) => !current);
  state.setNotesError((current) => `${current}!`);

  const next = useReaderNotesStore.getState();
  assert.equal(next.notes[0], notes[0]);
  assert.deepEqual(next.notes.map((item) => item.id), ['n1', 'n2', 'n3']);
  assert.equal(next.activeNoteId, 'n2');
  assert.equal(next.notesLoading, false);
  assert.equal(next.notesSaving, false);
  assert.equal(next.notesError, 'save failed!');
});
