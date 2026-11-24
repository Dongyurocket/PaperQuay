import { invoke } from '../platform/electron/core.ts';
import type { ReaderSecrets, ReaderSettings } from '../types/reader';

/**
 * 单一应用设置文档的渲染层 IPC 封装。
 *
 * 主进程是唯一写入者：这里只发送「按键 patch + revision」，并把预期内的
 * 版本冲突作为结构化结果返回（不抛错），方便调用方基于最新文档重放。
 */
export interface AppSettingsSnapshot {
  version: number;
  revision: number;
  settings: Partial<ReaderSettings>;
  zoteroLocalDataDir: string;
  leftSidebarCollapsed: boolean;
  updatedAt: number;
}

export type AppSettingsPatchResult =
  | ({ ok: true } & AppSettingsSnapshot)
  | {
      ok: false;
      code: string;
      message?: string;
      current: AppSettingsSnapshot;
    };

export type AppSettingsSecretsPatchResult =
  | ({ ok: true } & AppSettingsSnapshot)
  | {
      ok: false;
      code: string;
      message?: string;
      current: AppSettingsSnapshot;
    };

export interface LegacyAppSettingsPayload {
  settings?: Partial<ReaderSettings> | null;
  secrets?: Partial<ReaderSecrets> | null;
  noteCitationStyle?: string | null;
  zoteroLocalDataDir?: string | null;
}

export async function getAppSettings(): Promise<AppSettingsSnapshot> {
  return invoke<AppSettingsSnapshot>('app_settings_get');
}

export async function getAppSettingsSecrets(): Promise<Partial<ReaderSecrets>> {
  return invoke<Partial<ReaderSecrets>>('app_settings_get_secrets');
}

export async function patchAppSettings(
  patch: Partial<ReaderSettings>,
  options: { expectedRevision?: number; zoteroLocalDataDir?: string } = {},
): Promise<AppSettingsPatchResult> {
  return invoke<AppSettingsPatchResult>('app_settings_patch', {
    patch,
    ...(options.zoteroLocalDataDir !== undefined
      ? { zoteroLocalDataDir: options.zoteroLocalDataDir }
      : {}),
    ...(options.expectedRevision !== undefined
      ? { expectedRevision: options.expectedRevision }
      : {}),
  });
}

export async function patchAppSettingsSecrets(
  patch: Partial<ReaderSecrets>,
  options: { expectedRevision?: number } = {},
): Promise<AppSettingsSecretsPatchResult> {
  return invoke<AppSettingsSecretsPatchResult>('app_settings_patch_secrets', {
    patch,
    ...(options.expectedRevision !== undefined
      ? { expectedRevision: options.expectedRevision }
      : {}),
  });
}

export async function migrateLegacyAppSettings(
  legacy: LegacyAppSettingsPayload,
): Promise<AppSettingsPatchResult> {
  return invoke<AppSettingsPatchResult>('app_settings_migrate_legacy', {
    settings: legacy.settings ?? null,
    secrets: legacy.secrets ?? null,
    noteCitationStyle: legacy.noteCitationStyle ?? null,
    zoteroLocalDataDir: legacy.zoteroLocalDataDir ?? null,
  });
}
