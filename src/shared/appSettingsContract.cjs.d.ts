import type { ReaderSecrets, ReaderSettings } from '../types/reader';

export interface AppSettingsDocument {
  version: number;
  revision: number;
  settings: Partial<ReaderSettings>;
  secrets: Partial<ReaderSecrets> | null;
  secretsEncrypted: string | null;
  zoteroLocalDataDir: string;
  leftSidebarCollapsed: boolean;
  updatedAt: number;
  migratedFromVersion: number | null;
  changed: boolean;
}

export interface AppSettingsPublicDocument {
  version: number;
  revision: number;
  settings: Partial<ReaderSettings>;
  zoteroLocalDataDir: string;
  leftSidebarCollapsed: boolean;
  updatedAt: number;
}

export interface LegacyAppSettingsSnapshot {
  settings?: Partial<ReaderSettings> | null;
  secrets?: Partial<ReaderSecrets> | null;
  noteCitationStyle?: string | null;
  zoteroLocalDataDir?: string | null;
}

export const APP_SETTINGS_VERSION: number;
export const NOTE_CITATION_STYLES: readonly string[];
export const SETTING_KEYS: readonly (keyof ReaderSettings)[];
export const SECRET_KEYS: readonly (keyof ReaderSecrets)[];

export function assertSettingsRevision(
  document: AppSettingsDocument,
  expectedRevision: number | undefined,
  options?: { required?: boolean },
): void;
export function buildPublicAppSettings(document: AppSettingsDocument): AppSettingsPublicDocument;
export function contractError(code: string, message: string, details?: unknown): Error;
export function isPlainObject(value: unknown): value is Record<string, unknown>;
export function mergeLegacyAppSettings(
  document: AppSettingsDocument,
  legacy?: LegacyAppSettingsSnapshot,
  options?: { legacyZoteroDir?: string },
): AppSettingsDocument;
export function migrateAppSettingsDocument(raw: unknown): AppSettingsDocument;
export function normalizeNoteCitationStyle(value: unknown): string | null;
export function normalizeSecretsPatch(patch: unknown): Partial<ReaderSecrets>;
export function normalizeSettingsPatch(patch: unknown): Partial<ReaderSettings>;
