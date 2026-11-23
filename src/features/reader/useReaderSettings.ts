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
  resolveReaderConfigForHydration,
  writeReaderConfigFile,
} from '../../services/readerConfig';
import {
  getLibrarySettings,
  updateLibrarySettings,
} from '../../services/library';
import type {
  QaModelPreset,
  ReaderConfigFile,
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
  buildLegacyConfigPath,
  buildLegacyModelPresets,
  CONFIG_WRITE_DEBOUNCE_MS,
  createQaPreset,
  DEFAULT_QA_PRESET,
  DEFAULT_QA_PRESET_ID,
  DEFAULT_SECRETS,
  loadSecrets,
  loadSettings,
  mergeReaderConfigWithDefaults,
  normalizeReaderSettings,
  pickLocaleText,
  READER_CONFIG_VERSION,
  resolveModelPreset,
  SECRETS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from './readerShared';

type LocaleTextFn = <T,>(zh: T, en: T) => T;

export interface UseReaderSettingsOptions {
  setError: (value: string) => void;
  setStatusMessage: (value: string) => void;
}

export function useReaderSettings({
  setError,
  setStatusMessage,
}: UseReaderSettingsOptions) {
  const legacyModelPresetMigrationDoneRef = useRef(false);

  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [readerSecrets, setReaderSecrets] = useState<ReaderSecrets>(DEFAULT_SECRETS);
  const [zoteroLocalDataDir, setZoteroLocalDataDir] = useState('');
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

  const updateNativeLibrarySettings = useCallback(
    async (
      patch: Partial<LibrarySettings> | LibrarySettings,
      source = 'reader-preferences',
    ): Promise<LibrarySettings | null> => {
      try {
        const base = librarySettings ?? await getLibrarySettings();
        const nextSettings = await updateLibrarySettings({
          ...base,
          ...patch,
        });

        setLibrarySettings(nextSettings);

        if (Object.prototype.hasOwnProperty.call(patch, 'zoteroLocalDataDir')) {
          setZoteroLocalDataDir(nextSettings.zoteroLocalDataDir.trim());
        }

        emitLibrarySettingsUpdated(nextSettings, source);
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

    void (async () => {
      try {
        const defaultPaths = await getAppDefaultPaths();

        if (cancelled) {
          return;
        }

        setAppDefaultPaths(defaultPaths);
        const legacySecrets = loadSecrets();
        let nextConfig = mergeReaderConfigWithDefaults(
          null,
          loadSettings(),
          legacySecrets,
          defaultPaths,
        );

        // 主配置缺失（ENOENT）才回退旧路径；读取/解析失败一律视为错误，
        // 不拿默认值继续写回，否则会用回退值覆盖文件里的 API Key。
        const hydration = await resolveReaderConfigForHydration({
          defaultPaths,
          legacyConfigPath: buildLegacyConfigPath(defaultPaths.executableDir),
        });

        if (cancelled) {
          return;
        }

        if (hydration.error) {
          // 保留 localStorage 里的上次设置/密钥供本次会话使用，但禁用配置持久化，
          // 并保留 raw 文件原样，等待用户修复或删除后重启。
          setReaderSecrets(legacySecrets);
          setConfigPersistenceEnabled(false);
          const message = l(
            `读取配置文件失败，已暂停写回以保护 API Key：${defaultPaths.configPath}（${hydration.error.message}）。修复或删除该文件后重启应用。`,
            `Failed to read the settings file. Writing is paused to protect API keys: ${defaultPaths.configPath} (${hydration.error.message}). Fix or remove the file, then restart the app.`,
          );
          console.error('Failed to read the reader config file.', hydration.error);
          setConfigLoadError(message);
          setError(message);
          setStatusMessage(message);
          toast({ tone: 'error', message, duration: 0, key: 'reader-config-load-error' });
        } else {
          if (hydration.config) {
            nextConfig = mergeReaderConfigWithDefaults(
              hydration.config,
              loadSettings(),
              legacySecrets,
              defaultPaths,
            );
          }
          setSettings(nextConfig.settings);
          setReaderSecrets(nextConfig.secrets ?? DEFAULT_SECRETS);
          setConfigPersistenceEnabled(true);
          setConfigLoadError('');
        }

        let nativeLibrarySettings: LibrarySettings | null = null;

        try {
          nativeLibrarySettings = await getLibrarySettings();
        } catch {
        }

        const configZoteroDir = nextConfig.zoteroLocalDataDir.trim();
        const nativeZoteroDir = nativeLibrarySettings?.zoteroLocalDataDir.trim() ?? '';
        const resolvedZoteroDir = nativeZoteroDir || configZoteroDir;

        // 必须始终用文库里的 Zotero 目录回填：读取失败时 configZoteroDir 为空，
        // 若跳过赋值，Reader 的 500ms 同步 effect 会把空值写回文库，抹掉用户已配置的目录。
        setZoteroLocalDataDir(resolvedZoteroDir);
        setLibrarySettings(nativeLibrarySettings);
        if (nativeLibrarySettings && !hydration.error && configZoteroDir && !nativeZoteroDir) {
          const syncedSettings = await updateLibrarySettings({
            ...nativeLibrarySettings,
            zoteroLocalDataDir: configZoteroDir,
          });

          setLibrarySettings(syncedSettings);
          emitLibrarySettingsUpdated(syncedSettings, 'reader-config-hydration');
        }
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
      setZoteroLocalDataDir(detail.settings.zoteroLocalDataDir.trim());
    };

    window.addEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);

    return () => {
      window.removeEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    emitUiLanguageChanged(settings.uiLanguage);
  }, [settings]);

  // MinerU 缓存目录的写权限由主进程按配置文件登记，渲染层不再自行批准路径。

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
    if (!configHydrated || !configPersistenceEnabled || !appDefaultPaths) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const nextConfig: Partial<ReaderConfigFile> = {
        version: READER_CONFIG_VERSION,
        settings,
        secrets: readerSecrets,
        zoteroLocalDataDir,
        leftSidebarCollapsed: false,
      };

      void writeReaderConfigFile(nextConfig, appDefaultPaths)
        .then(() => {
          window.localStorage.removeItem(SECRETS_STORAGE_KEY);
        })
        .catch((error) => {
          console.error('Failed to persist reader config to file.', error);
        });
    }, CONFIG_WRITE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    appDefaultPaths,
    configHydrated,
    configPersistenceEnabled,
    readerSecrets,
    settings,
    zoteroLocalDataDir,
  ]);

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
