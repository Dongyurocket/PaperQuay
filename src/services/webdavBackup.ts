import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import type {
  WebdavBackupProgress,
  WebdavBackupResult,
  WebdavLatestBackupInfo,
  WebdavRestoreResult,
  WebdavBackupSettings,
  WebdavBackupSettingsInput,
  WebdavConnectionTestResult,
} from '../types/backup';

const WEBDAV_BACKUP_PROGRESS_EVENT = 'paperquay://webdav-backup-progress';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

export async function getWebdavBackupSettings(): Promise<WebdavBackupSettings> {
  try {
    return await invoke<WebdavBackupSettings>('webdav_get_backup_settings');
  } catch (error) {
    throw new Error(toErrorMessage(error, 'Failed to load WebDAV backup settings'));
  }
}

export async function updateWebdavBackupSettings(
  settings: WebdavBackupSettingsInput,
): Promise<WebdavBackupSettings> {
  try {
    return await invoke<WebdavBackupSettings>('webdav_update_backup_settings', { settings });
  } catch (error) {
    throw new Error(toErrorMessage(error, 'Failed to save WebDAV backup settings'));
  }
}

export async function testWebdavBackupConnection(): Promise<WebdavConnectionTestResult> {
  try {
    return await invoke<WebdavConnectionTestResult>('webdav_test_connection');
  } catch (error) {
    throw new Error(toErrorMessage(error, 'Failed to test the WebDAV connection'));
  }
}

export async function runWebdavBackupNow(): Promise<WebdavBackupResult> {
  try {
    return await invoke<WebdavBackupResult>('webdav_backup_now');
  } catch (error) {
    throw new Error(toErrorMessage(error, 'WebDAV manual backup failed'));
  }
}

export async function listenWebdavBackupProgress(
  handler: (progress: WebdavBackupProgress) => void,
): Promise<() => void> {
  return listen<WebdavBackupProgress>(WEBDAV_BACKUP_PROGRESS_EVENT, ({ payload }) => {
    if (payload) handler(payload);
  });
}

export async function inspectLatestWebdavBackup(): Promise<WebdavLatestBackupInfo> {
  try {
    return await invoke<WebdavLatestBackupInfo>('webdav_inspect_latest_backup');
  } catch (error) {
    throw new Error(toErrorMessage(error, 'Failed to inspect the latest WebDAV backup'));
  }
}

export async function restoreMissingFromLatestWebdavBackup(): Promise<WebdavRestoreResult> {
  try {
    return await invoke<WebdavRestoreResult>('webdav_restore_missing_from_latest');
  } catch (error) {
    throw new Error(toErrorMessage(error, 'WebDAV additive restore failed'));
  }
}
