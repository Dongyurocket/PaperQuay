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
  setNotes: (value) => set((state) => ({ notes: resolveStateValue(value, state.notes) })),
  setActiveNoteId: (value) =>
    set((state) => ({ activeNoteId: resolveStateValue(value, state.activeNoteId) })),
  setNotesLoading: (value) =>
    set((state) => ({ notesLoading: resolveStateValue(value, state.notesLoading) })),
  setNotesSaving: (value) =>
    set((state) => ({ notesSaving: resolveStateValue(value, state.notesSaving) })),
  setNotesError: (value) =>
    set((state) => ({ notesError: resolveStateValue(value, state.notesError) })),
}));
