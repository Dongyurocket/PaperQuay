import { invoke } from '../platform/electron/core.ts';
import { emitNoteChanged } from '../app/appEvents.ts';
import { collectPagedNotes } from '../features/notes/noteUtils.ts';
import { noteErrorCode } from '../features/notes/notesText.ts';
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
  expectedUpdatedAt?: number;
}

/**
 * 服务层稳定错误：code 供 UI 映射双语文案，message 固定为 `CODE: detail`。
 * detail 可能是后端原始错误，只用于日志/诊断，界面渲染必须走 noteErrorMessage()。
 */
export class NoteServiceError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, detail?: string, cause?: unknown) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'NoteServiceError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function errorDetail(error: unknown, code: string): string | undefined {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed === code) return undefined;

  const ownPrefix = `${code}:`;
  if (trimmed.startsWith(ownPrefix)) return trimmed.slice(ownPrefix.length).trim() || undefined;

  // 后端可能已经在 message 里带了别的稳定码（NOTE_CONFLICT: / PAPER_NOT_FOUND:）。
  const genericPrefix = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+:\s*/.exec(trimmed);
  if (genericPrefix) return trimmed.slice(genericPrefix[0].length).trim() || undefined;

  return trimmed;
}

function toNoteServiceError(error: unknown, fallbackCode: string): NoteServiceError {
  if (error instanceof NoteServiceError) {
    return error;
  }

  const code = noteErrorCode(error) ?? fallbackCode;
  return new NoteServiceError(code, errorDetail(error, code), error);
}

type PagedListNotesRequest = ListNotesRequest & { offset?: number };

export async function listNotes(request: PagedListNotesRequest = {}): Promise<Note[]> {
  try {
    return await invoke<Note[]>('notes_list', { request });
  } catch (error) {
    throw toNoteServiceError(error, 'NOTES_LIST_FAILED');
  }
}

/**
 * 拉取全部笔记。工作区的 notes_list 每次最多返回 5000 条，这里按 offset 分页
 * 直到短页，避免旧实现的 limit:1000 静默截断。onPage 用于逐页累积（渐进渲染）。
 */
export async function listAllNotes(
  request: Omit<ListNotesRequest, 'limit'> = {},
  options: {
    pageSize?: number;
    onPage?: (page: Note[], accumulated: Note[]) => void;
  } = {},
): Promise<Note[]> {
  return collectPagedNotes(
    ({ offset, limit }) => listNotes({ ...request, limit, offset }),
    options,
  );
}

export interface NoteSearchResponse {
  notes: Array<Note & { channels: Array<'vector' | 'fts' | 'like'>; score?: number }>;
  total: number;
  retrievalMode: 'keyword' | 'hybrid';
  embeddingModel?: string;
  warning?: string;
}

export async function searchNotes(request: Omit<ListNotesRequest, 'search'> & { query?: string; mode?: 'auto' | 'keyword' | 'hybrid' } = {}): Promise<NoteSearchResponse> {
  try {
    return await invoke<NoteSearchResponse>('notes_search', { request });
  } catch (error) {
    throw toNoteServiceError(error, 'NOTES_SEARCH_FAILED');
  }
}

export async function rebuildNotesIndex(): Promise<{ queued: number; warning?: string }> {
  try {
    return await invoke('notes_rebuild_index');
  } catch (error) {
    throw toNoteServiceError(error, 'NOTES_INDEX_REBUILD_FAILED');
  }
}

export async function getNotesIndexStatus(): Promise<{ pending: number; running: boolean; completed: number; failed: number; lastError: string | null }> {
  try {
    return await invoke('notes_index_status');
  } catch (error) {
    throw toNoteServiceError(error, 'NOTES_INDEX_STATUS_FAILED');
  }
}

export async function getNote(id: string): Promise<Note | null> {
  try {
    return await invoke<Note | null>('notes_get', { id });
  } catch (error) {
    throw toNoteServiceError(error, 'NOTE_READ_FAILED');
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
    throw toNoteServiceError(error, 'NOTE_CREATE_FAILED');
  }
}

export async function updateNote(
  id: string,
  patch: UpdateNoteRequest,
  options: NoteMutationOptions = {},
): Promise<Note> {
  try {
    const note = await invoke<Note>('notes_update', { id, patch, expectedUpdatedAt: options.expectedUpdatedAt });
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
    throw toNoteServiceError(error, 'NOTE_UPDATE_FAILED');
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
    throw toNoteServiceError(error, 'NOTE_DELETE_FAILED');
  }
}

export async function listNoteTags(
  request: Pick<ListNotesRequest, 'paperId'> = {},
): Promise<NoteTagSummary[]> {
  try {
    return await invoke<NoteTagSummary[]>('notes_tags', { request });
  } catch (error) {
    throw toNoteServiceError(error, 'NOTE_TAGS_FAILED');
  }
}

export async function listNoteBacklinks(noteId: string): Promise<NoteBacklink[]> {
  try {
    return await invoke<NoteBacklink[]>('notes_backlinks', { noteId });
  } catch (error) {
    throw toNoteServiceError(error, 'NOTE_BACKLINKS_FAILED');
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
  conflicts: number;
  total: number;
  createdFolders: number;
  /** 本轮检测到但被删除熔断拦下的待清理文件数。 */
  pendingRemovals?: number;
  /** 为 true 时本轮没有删除任何文件，调用方确认后需带 confirmRemoval 重试。 */
  removalConfirmationRequired?: boolean;
  /** 为 true 时本轮被取消（自动同步关闭/手动取消）：manifest 未写、文件未清理。 */
  cancelled?: boolean;
}

export async function getNotesVaultSettings(): Promise<NotesVaultSettings> {
  try {
    return await invoke<NotesVaultSettings>('notes_vault_get_settings');
  } catch (error) {
    throw toNoteServiceError(error, 'NOTE_VAULT_SETTINGS_READ_FAILED');
  }
}

export async function updateNotesVaultSettings(settings: {
  dir: string;
}): Promise<NotesVaultSettings> {
  try {
    return await invoke<NotesVaultSettings>('notes_vault_update_settings', { settings });
  } catch (error) {
    throw toNoteServiceError(error, 'NOTE_VAULT_SETTINGS_WRITE_FAILED');
  }
}

/**
 * 请求主进程取消正在跑的「自动同步」（调度器以 background 模式启动的那一次）。
 *
 * 复用设置 IPC 而不是新增通道：主进程收到 cancelAutoSync 后只中断在跑的自动
 * 同步，不写设置。清理函数不能 await，调用方以 `void` 触发即可；失败静默。
 */
export async function cancelNotesVaultAutoSync(): Promise<void> {
  try {
    await invoke('notes_vault_update_settings', { settings: { cancelAutoSync: true } });
  } catch {
    // 取消是尽力而为：自动同步已经关闭，失败不应影响清理流程。
  }
}

export async function syncNotesVaultNow(options?: {
  /** 数量超过熔断阈值时，显式确认后才真正删除 vault 文件。 */
  confirmRemoval?: boolean;
  /** 调度器发起的自动同步：从异步驱动起步，并允许被 cancelNotesVaultAutoSync 中断。 */
  background?: boolean;
}): Promise<NotesVaultSyncStats> {
  try {
    const stats = await invoke<NotesVaultSyncStats>('notes_vault_sync_now', {
      options: options ?? {},
    });
    // 取消的同步可能什么都没写，不广播变更。
    if (!stats.cancelled) {
      // 同步可能从 vault 导入了新笔记/文件夹，广播一次让工作区刷新。
      emitNoteChanged({
        action: 'updated',
        noteId: 'folder:vault-sync',
        sourceId: 'notes-vault',
      });
    }
    return stats;
  } catch (error) {
    throw toNoteServiceError(error, 'NOTE_VAULT_SYNC_FAILED');
  }
}

// 文件夹增删改会连带影响笔记列表（删除时笔记归入未分类），因此复用 NOTE_CHANGED_EVENT
// 通知各工作区刷新，而不是新建一套事件。
export async function listNoteFolders(): Promise<NoteFolder[]> {
  try {
    return await invoke<NoteFolder[]>('notes_folders_list');
  } catch (error) {
    throw toNoteServiceError(error, 'NOTE_FOLDERS_LIST_FAILED');
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
    throw toNoteServiceError(error, 'NOTE_FOLDER_CREATE_FAILED');
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
    throw toNoteServiceError(error, 'NOTE_FOLDER_RENAME_FAILED');
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
    throw toNoteServiceError(error, 'NOTE_FOLDER_DELETE_FAILED');
  }
}
