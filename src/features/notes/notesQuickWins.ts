import type { Note, NoteFolder, UpdateNoteRequest } from '../../types/notes';

export type NoteListSort = 'updatedAt' | 'createdAt' | 'title';

export function compareNotes(left: Note, right: Note, sort: NoteListSort): number {
  if (sort === 'title') {
    return left.title.localeCompare(right.title, 'zh-CN', { sensitivity: 'base' }) ||
      right.updatedAt - left.updatedAt ||
      left.id.localeCompare(right.id);
  }

  const timeDifference = (sort === 'createdAt' ? right.createdAt - left.createdAt : right.updatedAt - left.updatedAt);
  return timeDifference || right.updatedAt - left.updatedAt || left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id);
}

export function sortNotes(notes: Note[], sort: NoteListSort): Note[] {
  return [...notes].sort((left, right) => compareNotes(left, right, sort));
}

export function buildBatchNotePatches(
  noteIds: string[],
  patch: Pick<UpdateNoteRequest, 'tags' | 'folderId'>,
): Array<{ noteId: string; patch: UpdateNoteRequest }> {
  return [...new Set(noteIds.filter(Boolean))].map((noteId) => ({
    noteId,
    patch: { ...patch },
  }));
}

export function buildBatchTagPatches(notes: Note[], noteIds: string[], tag: string) {
  const selected = new Set(noteIds);
  return notes
    .filter((note) => selected.has(note.id))
    .map((note) => ({
      noteId: note.id,
      patch: { tags: [...new Set([...note.tags, tag.trim()])] },
    }));
}

export function normalizeVaultAutoSyncInterval(value: unknown, fallback = 30): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(60, Math.max(15, Math.trunc(parsed)));
}

export function shouldRunVaultAutoSync(input: {
  now: number;
  lastRunAt: number | null;
  intervalMinutes: number;
}): boolean {
  if (input.lastRunAt === null) return true;
  return input.now - input.lastRunAt >= normalizeVaultAutoSyncInterval(input.intervalMinutes) * 60_000;
}
