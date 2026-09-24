import { invoke } from '../platform/electron/core';
import { emitNoteChanged } from '../app/appEvents';
import type {
  CreateNoteRequest,
  ListNotesRequest,
  Note,
  NoteBacklink,
  NoteFolder,
  NoteTagSummary,
  UpdateNoteRequest,
} from '../types/notes';

export interface NoteMutationOptions {
  sourceId?: string;
  silent?: boolean;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

export async function listNotes(request: ListNotesRequest = {}): Promise<Note[]> {
  try {
    return await invoke<Note[]>('notes_list', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取笔记失败'));
  }
}

export async function getNote(id: string): Promise<Note | null> {
  try {
    return await invoke<Note | null>('notes_get', { id });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取笔记详情失败'));
  }
}

export async function createNote(request: CreateNoteRequest, options: NoteMutationOptions = {}): Promise<Note> {
  try {
    const note = await invoke<Note>('notes_create', { request });
    if (!options.silent) {
      emitNoteChanged({
        action: 'created',
        noteId: note.id,
        note,
        updatedAt: note.updatedAt,
        sourceId: options.sourceId,
      });
    }
    return note;
  } catch (error) {
    throw new Error(toErrorMessage(error, '创建笔记失败'));
  }
}

export async function updateNote(
  id: string,
  patch: UpdateNoteRequest,
  options: NoteMutationOptions = {},
): Promise<Note> {
  try {
    const note = await invoke<Note>('notes_update', { id, patch });
    if (!options.silent) {
      emitNoteChanged({
        action: 'updated',
        noteId: note.id,
        note,
        updatedAt: note.updatedAt,
        sourceId: options.sourceId,
      });
    }
    return note;
  } catch (error) {
    throw new Error(toErrorMessage(error, '保存笔记失败'));
  }
}

export async function deleteNote(id: string, options: NoteMutationOptions = {}): Promise<void> {
  try {
    await invoke('notes_delete', { id });
    if (!options.silent) {
      emitNoteChanged({
        action: 'deleted',
        noteId: id,
        sourceId: options.sourceId,
      });
    }
  } catch (error) {
    throw new Error(toErrorMessage(error, '删除笔记失败'));
  }
}

export async function listNoteTags(
  request: Pick<ListNotesRequest, 'paperId'> = {},
): Promise<NoteTagSummary[]> {
  try {
    return await invoke<NoteTagSummary[]>('notes_tags', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取笔记标签失败'));
  }
}

export async function listNoteBacklinks(noteId: string): Promise<NoteBacklink[]> {
  try {
    return await invoke<NoteBacklink[]>('notes_backlinks', { noteId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取反向链接失败'));
  }
}

export interface NotesVaultSettings {
  dir: string;
  updatedAtMs: number;
}

export interface NotesVaultSyncStats {
  vaultDir: string;
  exported: number;
  imported: number;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  total: number;
  createdFolders: number;
}

export async function getNotesVaultSettings(): Promise<NotesVaultSettings> {
  try {
    return await invoke<NotesVaultSettings>('notes_vault_get_settings');
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取笔记 vault 设置失败'));
  }
}

export async function updateNotesVaultSettings(settings: {
  dir: string;
}): Promise<NotesVaultSettings> {
  try {
    return await invoke<NotesVaultSettings>('notes_vault_update_settings', { settings });
  } catch (error) {
    throw new Error(toErrorMessage(error, '保存笔记 vault 设置失败'));
  }
}

export async function syncNotesVaultNow(): Promise<NotesVaultSyncStats> {
  try {
    const stats = await invoke<NotesVaultSyncStats>('notes_vault_sync_now');
    // 同步可能从 vault 导入了新笔记/文件夹，广播一次让工作区刷新。
    emitNoteChanged({
      action: 'updated',
      noteId: 'folder:vault-sync',
      sourceId: 'notes-vault',
    });
    return stats;
  } catch (error) {
    throw new Error(toErrorMessage(error, '同步笔记 vault 失败'));
  }
}

// 文件夹增删改会连带影响笔记列表（删除时笔记归入未分类），因此复用 NOTE_CHANGED_EVENT
// 通知各工作区刷新，而不是新建一套事件。
export async function listNoteFolders(): Promise<NoteFolder[]> {
  try {
    return await invoke<NoteFolder[]>('notes_folders_list');
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取笔记文件夹失败'));
  }
}

export async function createNoteFolder(request: {
  // id 仅用于 localStorage → 数据库的一次性迁移，保留旧 id 可免去笔记 folderId 重映射。
  id?: string;
  name: string;
  parentId?: string | null;
}): Promise<NoteFolder> {
  try {
    const folder = await invoke<NoteFolder>('notes_folder_create', { request });
    emitNoteChanged({
      action: 'created',
      noteId: `folder:${folder.id}`,
      sourceId: 'note-folder',
    });
    return folder;
  } catch (error) {
    throw new Error(toErrorMessage(error, '创建文件夹失败'));
  }
}

export async function renameNoteFolder(id: string, name: string): Promise<NoteFolder> {
  try {
    const folder = await invoke<NoteFolder>('notes_folder_rename', { id, name });
    emitNoteChanged({
      action: 'updated',
      noteId: `folder:${folder.id}`,
      sourceId: 'note-folder',
    });
    return folder;
  } catch (error) {
    throw new Error(toErrorMessage(error, '重命名文件夹失败'));
  }
}

export async function deleteNoteFolder(id: string): Promise<{ deletedFolderIds: string[] }> {
  try {
    const result = await invoke<{ deletedFolderIds: string[] }>('notes_folder_delete', { id });
    emitNoteChanged({
      action: 'deleted',
      noteId: `folder:${id}`,
      sourceId: 'note-folder',
    });
    return result;
  } catch (error) {
    throw new Error(toErrorMessage(error, '删除文件夹失败'));
  }
}
