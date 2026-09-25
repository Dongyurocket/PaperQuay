import { create } from 'zustand';
import type { CreateNoteRequest, ListNotesRequest, Note, NoteTagSummary, UpdateNoteRequest } from '../types/notes';
import {
  createNote,
  deleteNote,
  listNoteTags,
  listNotes,
  type NoteMutationOptions,
  updateNote,
} from '../services/notes';

export const GLOBAL_NOTES_PAPER_ID = 'global-notes';

interface NotesState {
  notes: Note[];
  tags: NoteTagSummary[];
  activeNoteId: string | null;
  search: string;
  tag: string | null;
  loading: boolean;
  saving: boolean;
  error: string;
  setActiveNoteId: (noteId: string | null) => void;
  setSearch: (search: string) => void;
  setTag: (tag: string | null) => void;
  loadNotes: (request?: ListNotesRequest) => Promise<void>;
  refreshTags: () => Promise<void>;
  createWorkspaceNote: (draft?: Partial<CreateNoteRequest>, options?: NoteMutationOptions) => Promise<Note>;
  updateWorkspaceNote: (noteId: string, patch: UpdateNoteRequest, options?: NoteMutationOptions) => Promise<Note>;
  deleteWorkspaceNote: (noteId: string, options?: NoteMutationOptions) => Promise<void>;
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  tags: [],
  activeNoteId: null,
  search: '',
  tag: null,
  loading: false,
  saving: false,
  error: '',

  setActiveNoteId: (noteId) => set({ activeNoteId: noteId }),
  setSearch: (search) => set({ search }),
  setTag: (tag) => set({ tag }),

  async loadNotes(request = {}) {
    const { search, tag } = get();
    set({ loading: true, error: '' });

    try {
      const notes = await listNotes({
        search: search || undefined,
        tag: tag || undefined,
        limit: 1000,
        ...request,
      });

      set((state) => ({
        notes,
        activeNoteId:
          state.activeNoteId && notes.some((note) => note.id === state.activeNoteId)
            ? state.activeNoteId
            : notes[0]?.id ?? null,
      }));
    } catch (error) {
      set({
        notes: [],
        activeNoteId: null,
        error: error instanceof Error ? error.message : '加载笔记失败',
      });
    } finally {
      set({ loading: false });
    }
  },

  async refreshTags() {
    try {
      set({ tags: await listNoteTags() });
    } catch {
      set({ tags: [] });
    }
  },

  async createWorkspaceNote(draft = {}, options = {}) {
    set({ saving: true, error: '' });

    try {
      const note = await createNote(
        {
          paperId: draft.paperId || GLOBAL_NOTES_PAPER_ID,
          type: draft.type || 'standalone',
          pageKind: draft.pageKind ?? null,
          title: draft.title || '未命名笔记',
          content: draft.content ?? '',
          contentJson: draft.contentJson ?? null,
          contentHtml: draft.contentHtml ?? null,
          contentText: draft.contentText ?? '',
          excerpt: draft.excerpt ?? null,
          pdfLocation: draft.pdfLocation ?? null,
          anchors: draft.anchors ?? [],
          tags: draft.tags ?? [],
          color: draft.color || '#f3f4f6',
          linkedNoteIds: draft.linkedNoteIds ?? [],
          linkedPaperIds: draft.linkedPaperIds ?? [],
          linkedNoteTitles: draft.linkedNoteTitles ?? [],
          linkedPaperId: draft.linkedPaperId ?? null,
          folderId: draft.folderId ?? null,
          wordCount: draft.wordCount ?? 0,
          isFavorite: draft.isFavorite ?? false,
          isPinned: draft.isPinned ?? false,
        },
        options,
      );

      set((state) => ({
        notes: [note, ...state.notes.filter((item) => item.id !== note.id)],
        activeNoteId: note.id,
      }));
      void get().refreshTags();
      return note;
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建笔记失败';
      set({ error: message });
      throw new Error(message);
    } finally {
      set({ saving: false });
    }
  },

  async updateWorkspaceNote(noteId, patch, options = {}) {
    set({ saving: true, error: '' });

    try {
      const note = await updateNote(noteId, patch, options);

      set((state) => ({
        notes: state.notes
          .map((item) => (item.id === note.id ? note : item))
          .sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || right.updatedAt - left.updatedAt),
        activeNoteId: note.id,
      }));
      void get().refreshTags();
      return note;
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存笔记失败';
      set({ error: message });
      throw new Error(message);
    } finally {
      set({ saving: false });
    }
  },

  async deleteWorkspaceNote(noteId, options = {}) {
    set({ saving: true, error: '' });

    try {
      await deleteNote(noteId, options);
      set((state) => {
        const notes = state.notes.filter((note) => note.id !== noteId);
        return {
          notes,
          activeNoteId: state.activeNoteId === noteId ? notes[0]?.id ?? null : state.activeNoteId,
        };
      });
      void get().refreshTags();
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除笔记失败';
      set({ error: message });
      throw new Error(message);
    } finally {
      set({ saving: false });
    }
  },
}));
