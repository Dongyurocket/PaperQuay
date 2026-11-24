import type {
  AppSettingsPatchResult,
  AppSettingsSecretsPatchResult,
  AppSettingsSnapshot,
  LegacyAppSettingsPayload,
} from './appSettings';
import type { RagEmbeddingOptions, RagRetrieveRequest } from './rag';
import type {
  BackupImportInspectResult,
  BackupImportStageResult,
  BackupImportTargets,
  BackupRendererState,
} from '../types/backupPackage';
import type {
  ImportPdfRequest,
  ImportedPdfResult,
  LibrarySettings,
  LiteraturePaper,
  UpdatePaperRequest,
} from '../types/library';
import type { Note, UpdateNoteRequest } from '../types/notes';
import type {
  RagIndexDocumentRequest,
  RagRetrievalDiagnostics,
  RagRetrievalResult,
  ReaderSecrets,
  ReaderSettings,
  ZoteroLibraryItem,
} from '../types/reader';

/**
 * 渲染层类型化 IPC 命令清单（D1-14）。
 *
 * 主进程的权威 schema 在 `electron/ipcCommandRegistry.cjs`；这里只维护
 * 同一组命令的 args/result 类型，供调用方以 `TypedIpcCommandTypes` 收窄。
 * 两份清单由 `tests/ipcCommandRegistry.test.ts` 对照，新增命令必须同时登记
 * `ipcAllowlist.cjs`、主进程 schema 与本文件。
 *
 * 只放类型：本模块会被测试直接 import，不能引入 electron 运行时依赖。
 */
export const TYPED_IPC_COMMANDS = [
  'app_settings_get',
  'app_settings_get_secrets',
  'app_settings_patch',
  'app_settings_patch_secrets',
  'app_settings_migrate_legacy',
  'library_update_settings',
  'library_import_pdfs',
  'library_update_paper',
  'notes_update',
  'delete_text_file',
  'backup_import_inspect',
  'backup_import_stage',
  'rag_retrieve_document_chunks',
  'rag_index_document',
  'rag_embed_text',
  'zotero_list_local_library_items',
] as const;

export type TypedIpcCommand = (typeof TYPED_IPC_COMMANDS)[number];

export interface TypedIpcCommandTypes {
  app_settings_get: { args: Record<string, never>; result: AppSettingsSnapshot };
  app_settings_get_secrets: { args: Record<string, never>; result: Partial<ReaderSecrets> };
  app_settings_patch: {
    args: {
      patch: Partial<ReaderSettings>;
      zoteroLocalDataDir?: string;
      expectedRevision?: number;
    };
    result: AppSettingsPatchResult;
  };
  app_settings_patch_secrets: {
    args: { patch: Partial<ReaderSecrets>; expectedRevision?: number };
    result: AppSettingsSecretsPatchResult;
  };
  app_settings_migrate_legacy: {
    args: LegacyAppSettingsPayload;
    result: AppSettingsPatchResult;
  };
  library_update_settings: { args: { settings: LibrarySettings }; result: LibrarySettings };
  library_import_pdfs: { args: { request: ImportPdfRequest }; result: ImportedPdfResult[] };
  library_update_paper: { args: { request: UpdatePaperRequest }; result: LiteraturePaper };
  notes_update: {
    args: { id: string; patch: UpdateNoteRequest; expectedUpdatedAt?: number };
    result: Note;
  };
  delete_text_file: { args: { path: string }; result: boolean };
  backup_import_inspect: {
    args: { packagePath: string; password: string };
    result: BackupImportInspectResult;
  };
  backup_import_stage: {
    args: {
      packagePath: string;
      password: string;
      targets: BackupImportTargets;
      currentRendererState: BackupRendererState;
    };
    result: BackupImportStageResult;
  };
  rag_retrieve_document_chunks: {
    args: { request: RagRetrieveRequest };
    result: RagRetrievalResult[] | RagRetrievalDiagnostics;
  };
  rag_index_document: { args: { request: RagIndexDocumentRequest }; result: void };
  rag_embed_text: {
    args: { request: { text: string; embedding: RagEmbeddingOptions } };
    result: number[];
  };
  zotero_list_local_library_items: {
    args: { options: { dataDir?: string; limit?: number } };
    result: ZoteroLibraryItem[];
  };
}

export function isTypedIpcCommand(command: string): command is TypedIpcCommand {
  return (TYPED_IPC_COMMANDS as readonly string[]).includes(command);
}
