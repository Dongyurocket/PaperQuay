import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getAppDefaultPaths,
} from '../../services/desktop';
import type { AppDefaultPaths } from '../../services/desktop';
import {
  getLibrarySettings,
  updateLibrarySettings,
} from '../../services/library';
import {
  getAppSettingsSecrets,
  migrateLegacyAppSettings,
} from '../../services/appSettings';
import {
  clearLegacyAppSettingsStorage,
  getAppSettingsSnapshot,
  patchAppSettingsAndSync,
  patchAppSettingsSecretsAndSync,
  patchZoteroLocalDataDirAndSync,
  primeAppSettingsCache,
  readLegacyAppSettingsStorage,
  subscribeAppSettings,
} from '../../app/settings/appSettingsCache';
import type {
  QaModelPreset,
  ReaderSecrets,
  ReaderSettings,
} from '../../types/reader';
import type { LibrarySettings } from '../../types/library';
import {
  LIBRARY_SETTINGS_UPDATED_EVENT,
  emitLibrarySettingsUpdated,
  type LibrarySettingsUpdatedEventDetail,
} from '../literature/libraryEvents';
import {
  emitUiLanguageChanged,
} from '../../app/appEvents';
import { toast } from '../../ui/toast';
import {
  buildLegacyModelPresets,
  createQaPreset,
  DEFAULT_QA_PRESET,
  DEFAULT_QA_PRESET_ID,
  DEFAULT_SECRETS,
  loadSecrets,
  loadSettings,
  mergeReaderConfigWithDefaults,
  normalizeReaderSettings,
  pickLocaleText,
  resolveModelPreset,
} from './readerShared';

type LocaleTextFn = <T,>(zh: T, en: T) => T;

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    left && right &&
    typeof left === 'object' &&
    typeof right === 'object'
  ) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }
  return false;
}

/** 只把真正变化的键发给主进程，避免整对象写回覆盖其它写入者。 */
function buildSettingsPatch(
  previous: ReaderSettings,
  next: ReaderSettings,
): Partial<ReaderSettings> {
  const patch: Partial<ReaderSettings> = {};

  for (const key of Object.keys(next) as Array<keyof ReaderSettings>) {
    if (!valuesEqual(previous[key], next[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }

  return patch;
}

function buildSecretsPatch(
  previous: ReaderSecrets,
  next: ReaderSecrets,
): Partial<ReaderSecrets> {
  const patch: Partial<ReaderSecrets> = {};

  for (const key of Object.keys(next) as Array<keyof ReaderSecrets>) {
    if (!valuesEqual(previous[key], next[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }

  return patch;
}

export interface UseReaderSettingsOptions {
  setError: (value: string) => void;
  setStatusMessage: (value: string) => void;
}

export function useReaderSettings({
  setError,
  setStatusMessage,
}: UseReaderSettingsOptions) {
  const legacyModelPresetMigrationDoneRef = useRef(false);
  const persistedSettingsRef = useRef<ReaderSettings | null>(null);
  const persistedSecretsRef = useRef<ReaderSecrets | null>(null);

  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [readerSecrets, setReaderSecrets] = useState<ReaderSecrets>(DEFAULT_SECRETS);
  const [zoteroLocalDataDir, setZoteroLocalDataDirState] = useState('');
  const [librarySettings, setLibrarySettings] = useState<LibrarySettings | null>(null);
  const [appDefaultPaths, setAppDefaultPaths] = useState<AppDefaultPaths | null>(null);
  const [configHydrated, setConfigHydrated] = useState(false);
  const [configPersistenceEnabled, setConfigPersistenceEnabled] = useState(false);
  const [configLoadError, setConfigLoadError] = useState('');

  const l = useCallback<LocaleTextFn>(
    (zh, en) => pickLocaleText(settings.uiLanguage, zh, en),
    [settings.uiLanguage],
  );

  const qaModelPresets = readerSecrets.qaModelPresets;

  const translationModelPreset = useMemo(
    () => resolveModelPreset(qaModelPresets, settings.translationModelPresetId),
    [qaModelPresets, settings.translationModelPresetId],
  );
  const selectionTranslationModelPreset = useMemo(
    () =>
      resolveModelPreset(qaModelPresets, settings.selectionTranslationModelPresetId) ??
      translationModelPreset,
    [qaModelPresets, settings.selectionTranslationModelPresetId, translationModelPreset],
  );
  const summaryModelPreset = useMemo(
    () => resolveModelPreset(qaModelPresets, settings.summaryModelPresetId) ?? translationModelPreset,
    [qaModelPresets, settings.summaryModelPresetId, translationModelPreset],
  );
  const summaryConfigured = Boolean(
    summaryModelPreset?.apiKey.trim() &&
      summaryModelPreset?.baseUrl.trim() &&
      summaryModelPreset?.model.trim(),
  );

  const setZoteroLocalDataDir = useCallback(
    (value: string) => {
      const normalized = value.trim();
      setZoteroLocalDataDirState(normalized);

      void patchZoteroLocalDataDirAndSync(normalized).then(async (result) => {
        if (result.ok && result.snapshot) {
          const canonical = result.snapshot.zoteroLocalDataDir;
          setZoteroLocalDataDirState(canonical);

          // 主进程已把规范值镜像到 library_settings；广播给文库侧，
          // 取代过去 Reader 里 500ms 的二次写回。
          try {
            const nextSettings = {
              ...(librarySettings ?? await getLibrarySettings()),
              zoteroLocalDataDir: canonical,
            };
            setLibrarySettings(nextSettings);
            emitLibrarySettingsUpdated(nextSettings, 'reader-settings');
          } catch {
          }
          return;
        }

        const message = l(
          '保存 Zotero 数据目录失败',
          'Failed to save the Zotero data directory',
        );
        setError(message);
        setStatusMessage(message);
      });
    },
    [l, librarySettings, setError, setStatusMessage],
  );

  const updateNativeLibrarySettings = useCallback(
    async (
      patch: Partial<LibrarySettings> | LibrarySettings,
      source = 'reader-preferences',
    ): Promise<LibrarySettings | null> => {
      try {
        const { zoteroLocalDataDir: nextZoteroDir, ...libraryPatch } = patch;
        let nextSettings = librarySettings;

        if (Object.keys(libraryPatch).length > 0) {
          const base = librarySettings ?? await getLibrarySettings();
          nextSettings = await updateLibrarySettings({
            ...base,
            ...libraryPatch,
          });
          setLibrarySettings(nextSettings);
        }

        if (nextZoteroDir !== undefined) {
          const result = await patchZoteroLocalDataDirAndSync(nextZoteroDir);
          if (!result.ok) {
            throw new Error(result.code ?? 'Failed to save the Zotero data directory');
          }

          const canonicalDir = result.snapshot?.zoteroLocalDataDir ?? nextZoteroDir.trim();
          setZoteroLocalDataDirState(canonicalDir);
          nextSettings = {
            ...(nextSettings ?? librarySettings ?? await getLibrarySettings()),
            zoteroLocalDataDir: canonicalDir,
          };
          setLibrarySettings(nextSettings);
        }

        if (nextSettings) {
          emitLibrarySettingsUpdated(nextSettings, source);
        }
        return nextSettings;
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('保存文库设置失败', 'Failed to save library settings');

        setError(message);
        setStatusMessage(message);
        return null;
      }
    },
    [l, librarySettings, setError, setStatusMessage],
  );

  const syncNativeLibraryZoteroDir = useCallback(
    async (dataDir: string, source = 'reader-settings'): Promise<LibrarySettings | null> => {
      const normalizedDataDir = dataDir.trim();

      try {
        const currentSettings = librarySettings ?? await getLibrarySettings();

        if (currentSettings.zoteroLocalDataDir.trim() === normalizedDataDir) {
          setLibrarySettings(currentSettings);
          return currentSettings;
        }

        return await updateNativeLibrarySettings(
          { zoteroLocalDataDir: normalizedDataDir },
          source,
        );
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('同步 Zotero 文库设置失败', 'Failed to sync Zotero library settings');

        setError(message);
        setStatusMessage(message);
        return null;
      }
    },
    [l, librarySettings, setError, setStatusMessage, updateNativeLibrarySettings],
  );

  const updateSetting = useCallback(<Key extends keyof ReaderSettings>(
    key: Key,
    value: ReaderSettings[Key],
  ) => {
    setSettings((current) => {
      if (Object.is(current[key], value)) {
        return current;
      }

      const nextSettings = normalizeReaderSettings({
        ...current,
        [key]: value,
      });

      return Object.is(current[key], nextSettings[key]) ? current : nextSettings;
    });
  }, []);

  const updateReaderSecret = useCallback(<Key extends keyof ReaderSecrets>(
    key: Key,
    value: ReaderSecrets[Key],
  ) => {
    setReaderSecrets((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const updateQaModelPreset = useCallback((presetId: string, patch: Partial<QaModelPreset>) => {
    setReaderSecrets((current) => ({
      ...current,
      qaModelPresets: current.qaModelPresets.map((preset) => {
        if (preset.id !== presetId) {
          return preset;
        }

        const nextModel = Object.prototype.hasOwnProperty.call(patch, 'model')
          ? patch.model ?? ''
          : preset.model;
        const hasExplicitLabel = Object.prototype.hasOwnProperty.call(patch, 'label');
        const nextLabelSource = hasExplicitLabel ? patch.label ?? '' : preset.label;
        const currentLabelCustomized = preset.labelCustomized ?? false;
        const nextLabelCustomized =
          patch.labelCustomized ??
          (hasExplicitLabel
            ? nextLabelSource.trim() !== '' && nextLabelSource.trim() !== nextModel.trim()
            : currentLabelCustomized);
        const nextLabel =
          hasExplicitLabel
            ? nextLabelSource || (!nextLabelCustomized ? nextModel : '')
            : Object.prototype.hasOwnProperty.call(patch, 'model') &&
                (!currentLabelCustomized || preset.label.trim() === preset.model.trim())
              ? nextModel
              : preset.label;

        return createQaPreset({
          ...preset,
          ...patch,
          model: nextModel,
          label: nextLabel,
          labelCustomized: nextLabelCustomized,
        });
      }),
    }));
  }, []);

  const addQaModelPreset = useCallback(() => {
    const nextPreset: QaModelPreset = createQaPreset({
      baseUrl: '',
      model: '',
      label: '',
      apiKey: '',
      labelCustomized: false,
    });

    setReaderSecrets((current) => ({
      ...current,
      qaModelPresets: [...current.qaModelPresets, nextPreset],
    }));
  }, []);

  const removeQaModelPreset = useCallback((presetId: string) => {
    const nextPresets = qaModelPresets.filter((preset) => preset.id !== presetId);

    if (nextPresets.length === 0 || nextPresets.length === qaModelPresets.length) {
      return;
    }

    setReaderSecrets((current) => ({
      ...current,
      qaModelPresets: nextPresets,
    }));

    const fallbackPresetId = nextPresets[0]?.id ?? DEFAULT_QA_PRESET_ID;

    setSettings((current) => ({
      ...current,
      qaActivePresetId:
        current.qaActivePresetId === presetId ? fallbackPresetId : current.qaActivePresetId,
      translationModelPresetId:
        current.translationModelPresetId === presetId
          ? fallbackPresetId
          : current.translationModelPresetId,
      selectionTranslationModelPresetId:
        current.selectionTranslationModelPresetId === presetId
          ? fallbackPresetId
          : current.selectionTranslationModelPresetId,
      summaryModelPresetId:
        current.summaryModelPresetId === presetId
          ? fallbackPresetId
          : current.summaryModelPresetId,
      reviewModelPresetId:
        current.reviewModelPresetId === presetId
          ? fallbackPresetId
          : current.reviewModelPresetId,
    }));
  }, [qaModelPresets]);

  useEffect(() => {
    let cancelled = false;
    let defaultPaths: AppDefaultPaths | null = null;

    void (async () => {
      try {
        defaultPaths = await getAppDefaultPaths();

        if (cancelled) {
          return;
        }

        setAppDefaultPaths(defaultPaths);

        const legacySettings = loadSettings();
        const legacySecrets = loadSecrets();
        const legacyStorage = readLegacyAppSettingsStorage();

        // 旧 localStorage 与旧配置文件在第一次启动时并入主进程文档；
        // Notes 专用引用样式键优先，避免被 Reader 的旧快照覆盖。
        const migrated = await migrateLegacyAppSettings({
          settings: legacyStorage.settings ?? legacySettings,
          secrets: legacyStorage.secrets ?? legacySecrets,
          noteCitationStyle:
            legacyStorage.noteCitationStyle ?? legacySettings.noteCitationStyle,
        });

        if (cancelled) {
          return;
        }

        if (!migrated.ok) {
          throw new Error(migrated.message || 'Failed to migrate the settings document');
        }

        const secretDocument = await getAppSettingsSecrets();

        if (cancelled) {
          return;
        }

        const nextConfig = mergeReaderConfigWithDefaults(
          {
            version: migrated.version,
            settings: migrated.settings,
            secrets: secretDocument,
            zoteroLocalDataDir: migrated.zoteroLocalDataDir,
            leftSidebarCollapsed: migrated.leftSidebarCollapsed,
          },
          legacySettings,
          legacySecrets,
          defaultPaths,
        );

        primeAppSettingsCache(migrated, secretDocument);
        setSettings(nextConfig.settings);
        setReaderSecrets(nextConfig.secrets ?? DEFAULT_SECRETS);
        setZoteroLocalDataDirState(nextConfig.zoteroLocalDataDir.trim());
        persistedSettingsRef.current = nextConfig.settings;
        persistedSecretsRef.current = nextConfig.secrets ?? DEFAULT_SECRETS;
        setConfigPersistenceEnabled(true);
        setConfigLoadError('');
        clearLegacyAppSettingsStorage();

        let nativeLibrarySettings: LibrarySettings | null = null;

        try {
          nativeLibrarySettings = await getLibrarySettings();
        } catch {
        }

        if (cancelled) {
          return;
        }

        setLibrarySettings(nativeLibrarySettings);

        // 主进程迁移已把 SQLite 旧值并入设置文档；这里只在文档仍为空时兜底。
        if (!nextConfig.zoteroLocalDataDir.trim() && nativeLibrarySettings?.zoteroLocalDataDir) {
          setZoteroLocalDataDirState(nativeLibrarySettings.zoteroLocalDataDir.trim());
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        // 读取/迁移失败时保留 localStorage 供本次会话使用，并暂停写回，
        // 避免用默认值覆盖文件里的 API Key。
        setReaderSecrets(loadSecrets());
        setConfigPersistenceEnabled(false);

        // 设置文档读不出来时，文库里的 Zotero 目录仍应回填，避免被空值覆盖。
        try {
          const nativeLibrarySettings = await getLibrarySettings();
          if (!cancelled) {
            setLibrarySettings(nativeLibrarySettings);
            if (nativeLibrarySettings?.zoteroLocalDataDir) {
              setZoteroLocalDataDirState(nativeLibrarySettings.zoteroLocalDataDir.trim());
            }
          }
        } catch {
        }

        if (cancelled) {
          return;
        }

        const message = l(
          `读取设置文件失败，已暂停写回以保护 API Key：${defaultPaths?.configPath ?? ''}（${error instanceof Error ? error.message : String(error)}）。修复或删除该文件后重启应用。`,
          `Failed to read the settings file. Writing is paused to protect API keys: ${defaultPaths?.configPath ?? ''} (${error instanceof Error ? error.message : String(error)}). Fix or remove the file, then restart the app.`,
        );
        console.error('Failed to read the app settings document.', error);
        setConfigLoadError(message);
        setError(message);
        setStatusMessage(message);
        toast({ tone: 'error', message, duration: 0, key: 'reader-config-load-error' });
      } finally {
        if (!cancelled) {
          setConfigHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleLibrarySettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<LibrarySettingsUpdatedEventDetail>).detail;

      if (!detail?.settings || detail.source?.startsWith('reader')) {
        return;
      }

      setLibrarySettings(detail.settings);
      setZoteroLocalDataDirState(detail.settings.zoteroLocalDataDir.trim());
    };

    window.addEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);

    return () => {
      window.removeEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);
    };
  }, []);

  // Notes 与 Reader 共享同一份文档：任一入口改引用样式/界面语言后同步到本 hook。
  useEffect(() => subscribeAppSettings(() => {
    const next = getAppSettingsSnapshot();
    if (!next) return;

    setSettings((current) => {
      if (
        valuesEqual(current.noteCitationStyle, next.settings.noteCitationStyle) &&
        valuesEqual(current.uiLanguage, next.settings.uiLanguage)
      ) {
        return current;
      }

      return {
        ...current,
        noteCitationStyle: next.settings.noteCitationStyle,
        uiLanguage: next.settings.uiLanguage,
      };
    });
  }), []);

  useEffect(() => {
    emitUiLanguageChanged(settings.uiLanguage);
  }, [settings.uiLanguage]);

  useEffect(() => {
    if (!configHydrated || !configPersistenceEnabled) return;
    const previous = persistedSettingsRef.current;
    if (!previous) return;

    const patch = buildSettingsPatch(previous, settings);
    if (Object.keys(patch).length === 0) return;

    void patchAppSettingsAndSync(patch).then((result) => {
      if (result.ok) {
        persistedSettingsRef.current = settings;
        return;
      }

      const message = l('保存设置失败', 'Failed to save settings');
      setError(message);
      setStatusMessage(message);
    });
  }, [configHydrated, configPersistenceEnabled, l, setError, setStatusMessage, settings]);

  useEffect(() => {
    if (!configHydrated || !configPersistenceEnabled) return;
    const previous = persistedSecretsRef.current;
    if (!previous) return;

    const patch = buildSecretsPatch(previous, readerSecrets);
    if (Object.keys(patch).length === 0) return;

    void patchAppSettingsSecretsAndSync(patch).then((result) => {
      if (result.ok) {
        persistedSecretsRef.current = readerSecrets;
        return;
      }

      const message = l('保存密钥失败', 'Failed to save API keys');
      setError(message);
      setStatusMessage(message);
    });
  }, [configHydrated, configPersistenceEnabled, l, readerSecrets, setError, setStatusMessage]);

  useEffect(() => {
    if (qaModelPresets.some((preset) => preset.id === settings.qaActivePresetId)) {
      return;
    }

    const fallbackPresetId = qaModelPresets[0]?.id ?? DEFAULT_QA_PRESET_ID;

    setSettings((current) => ({
      ...current,
      qaActivePresetId: fallbackPresetId,
    }));
  }, [qaModelPresets, settings.qaActivePresetId]);

  useEffect(() => {
    if (legacyModelPresetMigrationDoneRef.current) {
      return;
    }

    legacyModelPresetMigrationDoneRef.current = true;

    const nextPresets = buildLegacyModelPresets(settings, readerSecrets);
    const hasPresetMismatch =
      nextPresets.length !== qaModelPresets.length ||
      nextPresets.some((preset, index) => qaModelPresets[index]?.id !== preset.id);
    const fallbackPresetId = nextPresets[0]?.id ?? DEFAULT_QA_PRESET_ID;
    const nextTranslationPresetId =
      resolveModelPreset(nextPresets, settings.translationModelPresetId)?.id ?? fallbackPresetId;
    const nextSelectionTranslationPresetId =
      resolveModelPreset(nextPresets, settings.selectionTranslationModelPresetId)?.id ??
      nextTranslationPresetId;
    const nextSummaryPresetId =
      resolveModelPreset(nextPresets, settings.summaryModelPresetId)?.id ?? fallbackPresetId;
    const nextReviewPresetId =
      resolveModelPreset(nextPresets, settings.reviewModelPresetId)?.id ?? nextSummaryPresetId;
    const nextQaPresetId =
      resolveModelPreset(nextPresets, settings.qaActivePresetId)?.id ?? fallbackPresetId;
    const nextTranslationPreset =
      resolveModelPreset(nextPresets, nextTranslationPresetId) ?? DEFAULT_QA_PRESET;
    const nextSummaryPreset =
      resolveModelPreset(nextPresets, nextSummaryPresetId) ?? DEFAULT_QA_PRESET;
    const nextEmbeddingPreset =
      resolveModelPreset(nextPresets, settings.ragEmbeddingModelPresetId) ?? DEFAULT_QA_PRESET;

    if (hasPresetMismatch) {
      setReaderSecrets((current) => ({
        ...current,
        qaModelPresets: nextPresets,
        translationApiKey: nextTranslationPreset.apiKey,
        summaryApiKey: nextSummaryPreset.apiKey,
        embeddingApiKey: current.embeddingApiKey || nextEmbeddingPreset.apiKey,
      }));
    } else if (
      readerSecrets.translationApiKey !== nextTranslationPreset.apiKey ||
      readerSecrets.summaryApiKey !== nextSummaryPreset.apiKey ||
      (!readerSecrets.embeddingApiKey && nextEmbeddingPreset.apiKey)
    ) {
      setReaderSecrets((current) => ({
        ...current,
        translationApiKey: nextTranslationPreset.apiKey,
        summaryApiKey: nextSummaryPreset.apiKey,
        embeddingApiKey: current.embeddingApiKey || nextEmbeddingPreset.apiKey,
      }));
    }

    if (
      settings.translationModelPresetId !== nextTranslationPresetId ||
      settings.selectionTranslationModelPresetId !== nextSelectionTranslationPresetId ||
      settings.summaryModelPresetId !== nextSummaryPresetId ||
      settings.reviewModelPresetId !== nextReviewPresetId ||
      settings.qaActivePresetId !== nextQaPresetId ||
      settings.translationBaseUrl !== nextTranslationPreset.baseUrl ||
      settings.translationModel !== nextTranslationPreset.model ||
      settings.summaryBaseUrl !== nextSummaryPreset.baseUrl ||
      settings.summaryModel !== nextSummaryPreset.model ||
      !settings.embeddingBaseUrl ||
      !settings.embeddingModel
    ) {
      setSettings((current) => ({
        ...current,
        translationModelPresetId: nextTranslationPresetId,
        selectionTranslationModelPresetId: nextSelectionTranslationPresetId,
        summaryModelPresetId: nextSummaryPresetId,
        reviewModelPresetId: nextReviewPresetId,
        qaActivePresetId: nextQaPresetId,
        translationBaseUrl: nextTranslationPreset.baseUrl,
        translationModel: nextTranslationPreset.model,
        summaryBaseUrl: nextSummaryPreset.baseUrl,
        summaryModel: nextSummaryPreset.model,
        embeddingBaseUrl: current.embeddingBaseUrl || nextEmbeddingPreset.baseUrl,
        embeddingModel: current.embeddingModel || nextEmbeddingPreset.model,
      }));
    }
  }, [
    qaModelPresets,
    readerSecrets,
    settings,
  ]);

  useEffect(() => {
    const fallbackPresetId = qaModelPresets[0]?.id ?? DEFAULT_QA_PRESET_ID;
    const nextTranslationPresetId =
      resolveModelPreset(qaModelPresets, settings.translationModelPresetId)?.id ?? fallbackPresetId;
    const nextSelectionTranslationPresetId =
      resolveModelPreset(qaModelPresets, settings.selectionTranslationModelPresetId)?.id ??
      nextTranslationPresetId;
    const nextSummaryPresetId =
      resolveModelPreset(qaModelPresets, settings.summaryModelPresetId)?.id ?? fallbackPresetId;
    const nextReviewPresetId =
      resolveModelPreset(qaModelPresets, settings.reviewModelPresetId)?.id ?? nextSummaryPresetId;
    const nextQaPresetId =
      resolveModelPreset(qaModelPresets, settings.qaActivePresetId)?.id ?? fallbackPresetId;
    const nextTranslationPreset =
      resolveModelPreset(qaModelPresets, nextTranslationPresetId) ?? DEFAULT_QA_PRESET;
    const nextSummaryPreset =
      resolveModelPreset(qaModelPresets, nextSummaryPresetId) ?? DEFAULT_QA_PRESET;

    if (
      settings.translationModelPresetId !== nextTranslationPresetId ||
      settings.selectionTranslationModelPresetId !== nextSelectionTranslationPresetId ||
      settings.summaryModelPresetId !== nextSummaryPresetId ||
      settings.reviewModelPresetId !== nextReviewPresetId ||
      settings.qaActivePresetId !== nextQaPresetId ||
      settings.translationBaseUrl !== nextTranslationPreset.baseUrl ||
      settings.translationModel !== nextTranslationPreset.model ||
      settings.summaryBaseUrl !== nextSummaryPreset.baseUrl ||
      settings.summaryModel !== nextSummaryPreset.model
    ) {
      setSettings((current) => ({
        ...current,
        translationModelPresetId: nextTranslationPresetId,
        selectionTranslationModelPresetId: nextSelectionTranslationPresetId,
        summaryModelPresetId: nextSummaryPresetId,
        reviewModelPresetId: nextReviewPresetId,
        qaActivePresetId: nextQaPresetId,
        translationBaseUrl: nextTranslationPreset.baseUrl,
        translationModel: nextTranslationPreset.model,
        summaryBaseUrl: nextSummaryPreset.baseUrl,
        summaryModel: nextSummaryPreset.model,
      }));
    }

    if (
      readerSecrets.translationApiKey !== nextTranslationPreset.apiKey ||
      readerSecrets.summaryApiKey !== nextSummaryPreset.apiKey
    ) {
      setReaderSecrets((current) => ({
        ...current,
        translationApiKey: nextTranslationPreset.apiKey,
        summaryApiKey: nextSummaryPreset.apiKey,
      }));
    }
  }, [
    qaModelPresets,
    readerSecrets.summaryApiKey,
    readerSecrets.translationApiKey,
    settings.qaActivePresetId,
    settings.reviewModelPresetId,
    settings.selectionTranslationModelPresetId,
    settings.summaryBaseUrl,
    settings.summaryModel,
    settings.summaryModelPresetId,
    settings.translationBaseUrl,
    settings.translationModel,
    settings.translationModelPresetId,
  ]);

  return {
    appDefaultPaths,
    configHydrated,
    configLoadError,
    l,
    qaModelPresets,
    readerSecrets,
    selectionTranslationModelPreset,
    setReaderSecrets,
    setSettings,
    settings,
    librarySettings,
    setZoteroLocalDataDir,
    summaryConfigured,
    summaryModelPreset,
    syncNativeLibraryZoteroDir,
    translationModelPreset,
    updateNativeLibrarySettings,
    updateQaModelPreset,
    updateReaderSecret,
    updateSetting,
    addQaModelPreset,
    removeQaModelPreset,
    zoteroLocalDataDir,
  };
}
