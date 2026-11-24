import {
  getAppSettings,
  getAppSettingsSecrets,
} from './appSettings';
import {
  getAppSettingsSecretsSnapshot,
  getAppSettingsSnapshot,
} from '../app/settings/appSettingsCache';
import type {
  QaModelPreset,
  ReaderSecrets,
  ReaderSettings,
} from '../types/reader';

/**
 * 阅读器共享的模型预设读取。
 *
 * 阅读器问答、块重解析、选区提炼和笔记提炼共用同一份持久化预设：
 * 显式传入 preset id 时优先使用它，否则按问答 → 概览 → 翻译的顺序回退，
 * 最后才使用列表中的第一个预设。旧配置里的 `agentModelPresetId` 不再参与回退。
 *
 * 数据来源是主进程的单一设置文档；渲染层缓存未 hydrate 时退回 IPC 读取。
 */

function normalizeModelApiMode(value: unknown) {
  return value === 'responses' ? 'responses' as const : 'chat_completions' as const;
}

export function normalizeModelPreset(preset: QaModelPreset): QaModelPreset {
  return {
    ...preset,
    apiMode: normalizeModelApiMode((preset as Partial<QaModelPreset>).apiMode),
  };
}

async function loadMergedConfig() {
  const snapshot = getAppSettingsSnapshot();
  const cachedSecrets = getAppSettingsSecretsSnapshot();

  if (snapshot && cachedSecrets) {
    return {
      settings: snapshot.settings as Partial<ReaderSettings>,
      secrets: cachedSecrets as Partial<ReaderSecrets>,
    };
  }

  try {
    const [document, secrets] = await Promise.all([
      getAppSettings(),
      getAppSettingsSecrets(),
    ]);
    return {
      settings: document.settings as Partial<ReaderSettings>,
      secrets: secrets as Partial<ReaderSecrets>,
    };
  } catch {
    return { settings: {}, secrets: {} };
  }
}

export async function loadAvailableModelPresets(): Promise<QaModelPreset[]> {
  const { secrets } = await loadMergedConfig();
  return Array.isArray(secrets.qaModelPresets)
    ? secrets.qaModelPresets.map(normalizeModelPreset)
    : [];
}

export async function loadModelPresetById(
  preferredPresetId?: string | null,
): Promise<QaModelPreset | null> {
  const { settings, secrets } = await loadMergedConfig();
  const presets = Array.isArray(secrets.qaModelPresets)
    ? secrets.qaModelPresets.map(normalizeModelPreset)
    : [];
  const preferredId =
    preferredPresetId?.trim() ||
    settings.qaActivePresetId?.trim() ||
    settings.summaryModelPresetId?.trim() ||
    settings.translationModelPresetId?.trim() ||
    presets[0]?.id;

  return presets.find((item) => item.id === preferredId) ?? presets[0] ?? null;
}

/** 阅读器问答使用的模型：默认回退顺序以当前问答预设开头。 */
export async function loadQaModelPreset(): Promise<QaModelPreset | null> {
  return loadModelPresetById();
}
