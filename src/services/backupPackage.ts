import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import type {
  BackupDeleteOldDataResult,
  BackupExportEstimate,
  BackupExportOptions,
  BackupExportResult,
  BackupImportInspectResult,
  BackupImportStageResult,
  BackupImportTargets,
  BackupProgress,
  BackupRendererState,
  BackupRollbackResult,
  BackupStatus,
} from '../types/backupPackage';

export const BACKUP_PROGRESS_EVENT = 'paperquay://backup-progress';
export const MAX_RENDERER_STATE_CODE_UNITS = 4_000_000;

function toErrorMessage(error: unknown, fallback: string, secret?: string): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : fallback;

  return secret ? message.split(secret).join('[redacted]') : message || fallback;
}

function throwSafe(error: unknown, fallback: string, secret?: string): never {
  throw new Error(toErrorMessage(error, fallback, secret));
}

export function captureRendererState(): BackupRendererState {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('Browser storage is not available');
  }

  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key !== null) keys.push(key);
  }

  return Object.fromEntries(
    keys.map((key) => [key, window.localStorage.getItem(key) ?? '']),
  );
}

export function rendererStateCodeUnits(state: BackupRendererState): number {
  return Object.entries(state).reduce(
    (total, [key, value]) => total + key.length + value.length,
    0,
  );
}

export function assertRendererStateWithinLimit(state: BackupRendererState): void {
  const codeUnits = rendererStateCodeUnits(state);
  if (codeUnits > MAX_RENDERER_STATE_CODE_UNITS) {
    throw new Error(
      `Browser state is ${codeUnits.toLocaleString()} UTF-16 code units; the limit is ${MAX_RENDERER_STATE_CODE_UNITS.toLocaleString()}.`,
    );
  }
}

export async function selectBackupDestination(): Promise<string | null> {
  try {
    return await invoke<string | null>('backup_select_destination');
  } catch (error) {
    throwSafe(error, 'Failed to select a backup destination');
  }
}

export async function selectBackupPackage(): Promise<string | null> {
  try {
    return await invoke<string | null>('backup_select_package');
  } catch (error) {
    throwSafe(error, 'Failed to select a backup package');
  }
}

export async function selectBackupLibraryDirectory(): Promise<string | null> {
  try {
    return await invoke<string | null>('backup_select_library_dir');
  } catch (error) {
    throwSafe(error, 'Failed to select the library directory');
  }
}

export async function selectBackupVaultDirectory(): Promise<string | null> {
  try {
    return await invoke<string | null>('backup_select_vault_dir');
  } catch (error) {
    throwSafe(error, 'Failed to select the notes vault directory');
  }
}

export async function estimateBackup(
  options: BackupExportOptions,
  rendererState: BackupRendererState,
): Promise<BackupExportEstimate> {
  try {
    return await invoke<BackupExportEstimate>('backup_export_estimate', { options, rendererState });
  } catch (error) {
    throwSafe(error, 'Failed to estimate the backup size');
  }
}

export async function startBackupExport(input: {
  destinationPath: string;
  password: string;
  options: BackupExportOptions;
  rendererState: BackupRendererState;
}): Promise<BackupExportResult> {
  try {
    return await invoke<BackupExportResult>('backup_export_start', input);
  } catch (error) {
    throwSafe(error, 'Backup export failed', input.password);
  }
}

export async function cancelBackupTask(): Promise<{ cancelled: boolean }> {
  try {
    return await invoke<{ cancelled: boolean }>('backup_export_cancel');
  } catch (error) {
    throwSafe(error, 'Failed to cancel the backup task');
  }
}

export async function inspectBackupPackage(
  packagePath: string,
  password: string,
): Promise<BackupImportInspectResult> {
  try {
    return await invoke<BackupImportInspectResult>('backup_import_inspect', { packagePath, password });
  } catch (error) {
    throwSafe(error, 'Password is incorrect or the backup package is damaged', password);
  }
}

export async function stageBackupImport(input: {
  packagePath: string;
  password: string;
  targets: BackupImportTargets;
  currentRendererState: BackupRendererState;
}): Promise<BackupImportStageResult> {
  try {
    return await invoke<BackupImportStageResult>('backup_import_stage', input);
  } catch (error) {
    throwSafe(error, 'Failed to stage the backup import', input.password);
  }
}

export async function getBackupStatus(): Promise<BackupStatus> {
  try {
    return await invoke<BackupStatus>('backup_get_status');
  } catch (error) {
    throwSafe(error, 'Failed to read backup status');
  }
}

export async function deleteBackupOldData(path: string): Promise<BackupDeleteOldDataResult> {
  try {
    return await invoke<BackupDeleteOldDataResult>('backup_delete_old_data', { path });
  } catch (error) {
    throwSafe(error, 'Failed to delete old backup data');
  }
}

export async function prepareBackupRollback(oldDataDir: string): Promise<BackupRollbackResult> {
  try {
    return await invoke<BackupRollbackResult>('backup_rollback_prepare', { oldDataDir });
  } catch (error) {
    throwSafe(error, 'Failed to prepare rollback');
  }
}

export async function openBackupDestinationFolder(path: string): Promise<void> {
  try {
    await invoke<{ ok: boolean }>('backup_open_path', { path });
  } catch (error) {
    throwSafe(error, 'Failed to open the backup folder');
  }
}

export async function listenBackupProgress(
  handler: (progress: BackupProgress) => void,
): Promise<() => void> {
  return listen<BackupProgress>(BACKUP_PROGRESS_EVENT, ({ payload }) => {
    if (payload) handler(payload);
  });
}
