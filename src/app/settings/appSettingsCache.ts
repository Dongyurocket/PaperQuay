import {
  getAppSettings,
  getAppSettingsSecrets,
  patchAppSettings,
  patchAppSettingsSecrets,
  type AppSettingsSnapshot,
  type LegacyAppSettingsPayload,
} from '../../services/appSettings.ts';
import {
  DEFAULT_SECRETS,
  NOTE_CITATION_STYLE_STORAGE_KEY,
  SECRETS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  normalizeQaModelPresets,
  normalizeReaderSettings,
} from '../../features/reader/readerShared.ts';
import type { ReaderSecrets, ReaderSettings } from '../../types/reader';

/**
 * 渲染层的只读设置缓存。
 *
 * 主进程文档是唯一写入者；这里保存最近一次读取的规范文档，并叠加尚未确认的
 * 本地 patch，供 React 同步读取。所有写入都经过 revision 校验的 patch，
 * 冲突时基于主进程返回的最新文档重放，而不是整对象覆盖。
 */
export interface NormalizedAppSettingsSnapshot extends Omit<AppSettingsSnapshot, 'settings'> {
  settings: ReaderSettings;
}

type Listener = () => void;

interface PendingSettingsPatch {
  id: number;
  patch: Partial<ReaderSettings>;
}

interface PendingSecretsPatch {
  id: number;
  patch: Partial<ReaderSecrets>;
}

let canonical: NormalizedAppSettingsSnapshot | null = null;
let canonicalSecrets: ReaderSecrets | null = null;
let snapshot: NormalizedAppSettingsSnapshot | null = null;
let secretsSnapshot: ReaderSecrets | null = null;
let pendingSettings: PendingSettingsPatch[] = [];
let pendingSecrets: PendingSecretsPatch[] = [];
let pendingZoteroDir: string | null = null;
let nextPatchId = 1;
let writeQueue: Promise<unknown> = Promise.resolve();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 订阅者异常不应中断其它订阅者。
    }
  }
}

function normalizeSnapshot(document: AppSettingsSnapshot): NormalizedAppSettingsSnapshot {
  return {
    ...document,
    settings: normalizeReaderSettings(document.settings),
    zoteroLocalDataDir: String(document.zoteroLocalDataDir ?? '').trim(),
  };
}

function normalizeSecrets(value: Partial<ReaderSecrets> | null | undefined): ReaderSecrets {
  return {
    ...DEFAULT_SECRETS,
    ...(value ?? {}),
    qaModelPresets: normalizeQaModelPresets(value?.qaModelPresets),
  };
}

function mergedPendingSettings(): Partial<ReaderSettings> {
  return pendingSettings.reduce<Partial<ReaderSettings>>(
    (merged, entry) => ({ ...merged, ...entry.patch }),
    {},
  );
}

function mergedPendingSecrets(): Partial<ReaderSecrets> {
  return pendingSecrets.reduce<Partial<ReaderSecrets>>(
    (merged, entry) => ({ ...merged, ...entry.patch }),
    {},
  );
}

function recompute(): void {
  if (!canonical) {
    snapshot = null;
  } else {
    snapshot = {
      ...canonical,
      settings: normalizeReaderSettings({
        ...canonical.settings,
        ...mergedPendingSettings(),
      }),
      zoteroLocalDataDir: pendingZoteroDir ?? canonical.zoteroLocalDataDir,
    };
  }

  if (!canonicalSecrets) {
    secretsSnapshot = null;
  } else {
    secretsSnapshot = normalizeSecrets({
      ...canonicalSecrets,
      ...mergedPendingSecrets(),
    });
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => undefined);
  return next;
}

function applyCanonical(document: AppSettingsSnapshot): void {
  canonical = normalizeSnapshot(document);
  recompute();
  emit();
}

export function getAppSettingsSnapshot(): NormalizedAppSettingsSnapshot | null {
  return snapshot;
}

export function getAppSettingsSecretsSnapshot(): ReaderSecrets | null {
  return secretsSnapshot;
}

export function subscribeAppSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetAppSettingsCache(): void {
  canonical = null;
  canonicalSecrets = null;
  snapshot = null;
  secretsSnapshot = null;
  pendingSettings = [];
  pendingSecrets = [];
  pendingZoteroDir = null;
  nextPatchId = 1;
  writeQueue = Promise.resolve();
  listeners.clear();
}

/** 用主进程返回的文档与密钥预热缓存（hydration 迁移后避免重复 IPC）。 */
export function primeAppSettingsCache(
  document: AppSettingsSnapshot,
  secretDocument: Partial<ReaderSecrets> | null | undefined,
): NormalizedAppSettingsSnapshot {
  canonical = normalizeSnapshot(document);
  canonicalSecrets = normalizeSecrets(secretDocument);
  recompute();
  emit();
  return snapshot!;
}

export async function hydrateAppSettings(): Promise<NormalizedAppSettingsSnapshot> {
  const [document, secretDocument] = await Promise.all([
    getAppSettings(),
    getAppSettingsSecrets(),
  ]);
  return primeAppSettingsCache(document, secretDocument);
}

export interface SettingsPatchOutcome {
  ok: boolean;
  code?: string;
  snapshot: NormalizedAppSettingsSnapshot | null;
}

export interface SettingsPatchOptions {
  expectedRevision?: number;
  rebaseOnConflict?: boolean;
}

type FailedAppSettingsResult = {
  ok: false;
  code: string;
  message?: string;
  current: AppSettingsSnapshot;
};

function isFailedResult(result: { ok: boolean }): result is FailedAppSettingsResult {
  return result.ok === false;
}

function outcomeFromResult(
  result: { ok: boolean } | FailedAppSettingsResult,
  snapshotValue: NormalizedAppSettingsSnapshot | null,
): SettingsPatchOutcome {
  return {
    ok: result.ok,
    ...(isFailedResult(result) ? { code: result.code } : {}),
    snapshot: snapshotValue,
  };
}

async function runSettingsPatch(
  patch: Partial<ReaderSettings>,
  entryId: number,
  options: SettingsPatchOptions,
): Promise<SettingsPatchOutcome> {
  try {
    if (!canonical) {
      await hydrateAppSettings();
    }

    let result = await patchAppSettings(patch, {
      expectedRevision: options.expectedRevision ?? canonical?.revision,
    });

    if (
      isFailedResult(result) &&
      result.code === 'SETTINGS_CONFLICT' &&
      options.rebaseOnConflict !== false
    ) {
      applyCanonical(result.current);
      result = await patchAppSettings(patch, {
        expectedRevision: canonical?.revision,
      });
    }

    if (result.ok) {
      applyCanonical(result);
    } else if (isFailedResult(result)) {
      applyCanonical(result.current);
    }

    return outcomeFromResult(result, snapshot);
  } catch (error) {
    console.warn('[paperquay] Failed to persist app settings.', error);
    return { ok: false, code: 'SETTINGS_WRITE_FAILED', snapshot };
  } finally {
    pendingSettings = pendingSettings.filter((entry) => entry.id !== entryId);
    recompute();
    emit();
  }
}

export function patchAppSettingsAndSync(
  patch: Partial<ReaderSettings>,
  options: SettingsPatchOptions = {},
): Promise<SettingsPatchOutcome> {
  const entryId = nextPatchId++;
  pendingSettings.push({ id: entryId, patch: { ...patch } });
  recompute();
  emit();

  return enqueue(() => runSettingsPatch({ ...patch }, entryId, options));
}

async function runSecretsPatch(
  patch: Partial<ReaderSecrets>,
  entryId: number,
  options: SettingsPatchOptions,
): Promise<SettingsPatchOutcome> {
  try {
    if (!canonical) {
      await hydrateAppSettings();
    }

    let result = await patchAppSettingsSecrets(patch, {
      expectedRevision: options.expectedRevision ?? canonical?.revision,
    });

    if (
      isFailedResult(result) &&
      result.code === 'SETTINGS_CONFLICT' &&
      options.rebaseOnConflict !== false
    ) {
      applyCanonical(result.current);
      result = await patchAppSettingsSecrets(patch, {
        expectedRevision: canonical?.revision,
      });
    }

    if (result.ok) {
      applyCanonical(result);
    } else if (isFailedResult(result)) {
      applyCanonical(result.current);
    }

    return outcomeFromResult(result, snapshot);
  } catch (error) {
    console.warn('[paperquay] Failed to persist app secrets.', error);
    return { ok: false, code: 'SETTINGS_WRITE_FAILED', snapshot };
  } finally {
    pendingSecrets = pendingSecrets.filter((entry) => entry.id !== entryId);
    recompute();
    emit();
  }
}

export function patchAppSettingsSecretsAndSync(
  patch: Partial<ReaderSecrets>,
  options: SettingsPatchOptions = {},
): Promise<SettingsPatchOutcome> {
  const entryId = nextPatchId++;
  pendingSecrets.push({ id: entryId, patch: { ...patch } });
  recompute();
  emit();

  return enqueue(() => runSecretsPatch({ ...patch }, entryId, options));
}

export function patchZoteroLocalDataDirAndSync(
  value: string,
  options: SettingsPatchOptions = {},
): Promise<SettingsPatchOutcome> {
  const normalized = value.trim();
  pendingZoteroDir = normalized;
  recompute();
  emit();

  return enqueue(async () => {
    try {
      if (!canonical) {
        await hydrateAppSettings();
      }

      let result = await patchAppSettings({}, {
        zoteroLocalDataDir: normalized,
        expectedRevision: options.expectedRevision ?? canonical?.revision,
      });

      if (
        isFailedResult(result) &&
        result.code === 'SETTINGS_CONFLICT' &&
        options.rebaseOnConflict !== false
      ) {
        applyCanonical(result.current);
        result = await patchAppSettings({}, {
          zoteroLocalDataDir: normalized,
          expectedRevision: canonical?.revision,
        });
      }

      if (result.ok) {
        applyCanonical(result);
      } else if (isFailedResult(result)) {
        applyCanonical(result.current);
      }

      return outcomeFromResult(result, snapshot);
    } catch (error) {
      console.warn('[paperquay] Failed to persist the Zotero data directory.', error);
      return { ok: false, code: 'SETTINGS_WRITE_FAILED', snapshot };
    } finally {
      pendingZoteroDir = null;
      recompute();
      emit();
    }
  });
}

/** 读取旧 localStorage 快照；只在首次启动迁移时调用。 */
export function readLegacyAppSettingsStorage(): LegacyAppSettingsPayload {
  try {
    if (typeof window === 'undefined') return {};
    const settings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const secrets = window.localStorage.getItem(SECRETS_STORAGE_KEY);
    const noteCitationStyle = window.localStorage.getItem(NOTE_CITATION_STYLE_STORAGE_KEY);

    return {
      settings: settings ? JSON.parse(settings) : null,
      secrets: secrets ? JSON.parse(secrets) : null,
      noteCitationStyle,
    };
  } catch {
    return {};
  }
}

export function clearLegacyAppSettingsStorage(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(SECRETS_STORAGE_KEY);
    window.localStorage.removeItem(NOTE_CITATION_STYLE_STORAGE_KEY);
    window.localStorage.removeItem(`${NOTE_CITATION_STYLE_STORAGE_KEY}:migrated`);
  } catch {
    // 清理失败不阻断启动；下一次启动会再迁移一次（幂等）。
  }
}
