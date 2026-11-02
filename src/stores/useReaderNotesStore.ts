import { create } from 'zustand';
import type { Note } from '../types/notes.ts';

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export interface ReaderNotesState {
  notes: Note[];
  activeNoteId: string | null;
  notesLoading: boolean;
  notesSaving: boolean;
  notesError: string;
  setNotes: StateSetter<Note[]>;
  setActiveNoteId: StateSetter<string | null>;
  setNotesLoading: StateSetter<boolean>;
  setNotesSaving: StateSetter<boolean>;
  setNotesError: StateSetter<string>;
}

function resolveStateValue<T>(value: T | ((current: T) => T), current: T): T {
  return typeof value === 'function'
    ? (value as (current: T) => T)(current)
    : value;
}

export const useReaderNotesStore = create<ReaderNotesState>()((set) => ({
  notes: [],
  activeNoteId: null,
  notesLoading: false,
  notesSaving: false,
  notesError: '',
  setNotes: (value) => set((state) => {
    const next = resolveStateValue(value, state.notes);
    return Object.is(next, state.notes) ? state : { notes: next };
  }),
  setActiveNoteId: (value) => set((state) => {
    const next = resolveStateValue(value, state.activeNoteId);
    return Object.is(next, state.activeNoteId) ? state : { activeNoteId: next };
  }),
  setNotesLoading: (value) => set((state) => {
    const next = resolveStateValue(value, state.notesLoading);
    return Object.is(next, state.notesLoading) ? state : { notesLoading: next };
  }),
  setNotesSaving: (value) => set((state) => {
    const next = resolveStateValue(value, state.notesSaving);
    return Object.is(next, state.notesSaving) ? state : { notesSaving: next };
  }),
  setNotesError: (value) => set((state) => {
    const next = resolveStateValue(value, state.notesError);
    return Object.is(next, state.notesError) ? state : { notesError: next };
  }),
}));
