'use strict';

/**
 * 单一应用设置文档的契约（主进程与渲染层共用）。
 *
 * 文档取代了此前四个所有者：
 *   - Notes 整对象写 localStorage；
 *   - Reader 整对象写 localStorage 与配置文件；
 *   - SQLite library_settings 的 zoteroLocalDataDir；
 *   - Reader 的 500ms 双写 effect。
 *
 * 主进程持有唯一副本，写入只接受「按键 patch + revision 校验」，渲染层只做
 * 只读缓存。`SETTING_KEYS` / `SECRET_KEYS` 与 ReaderSettings / ReaderSecrets
 * 的键集合由 tests/appSettingsStore.test.ts 对照 DEFAULT_SETTINGS 锁定。
 */

const APP_SETTINGS_VERSION = 2;

const SETTING_KEYS = Object.freeze([
  'uiLanguage',
  'autoLoadSiblingJson',
  'autoMineruParse',
  'autoGenerateSummary',
  'localRagEnabled',
  'localRagTopK',
  'ragSourceMode',
  'libraryBatchConcurrency',
  'showLibraryReadingHeatmap',
  'enablePdfReadingHeatmap',
  'enableSelectionTranslation',
  'highlightSelectionTranslation',
  'enablePdfParagraphTranslationPopover',
  'autoTranslateSelection',
  'smoothScroll',
  'compactReading',
  'showBlockMeta',
  'hidePageDecorationsInBlockView',
  'softPageShadow',
  'mineruApiBaseUrl',
  'mineruCacheDir',
  'remotePdfDownloadDir',
  'translationBatchSize',
  'translationConcurrency',
  'translationRequestsPerMinute',
  'translationBaseUrl',
  'translationModel',
  'summaryBaseUrl',
  'summaryModel',
  'translationModelPresetId',
  'selectionTranslationModelPresetId',
  'summaryModelPresetId',
  'reviewModelPresetId',
  'embeddingBaseUrl',
  'embeddingModel',
  'embeddingDimensions',
  'embeddingRequestTimeoutSeconds',
  'embeddingBatchSize',
  'modelRuntimeConfigs',
  'ragEmbeddingModelPresetId',
  'summarySourceMode',
  'summaryOutputLanguage',
  'qaSourceMode',
  'translationSourceLanguage',
  'translationTargetLanguage',
  'translationDisplayMode',
  'qaActivePresetId',
  'noteCitationStyle',
  'notesVaultAutoSyncEnabled',
  'notesVaultAutoSyncIntervalMinutes',
]);

const SECRET_KEYS = Object.freeze([
  'mineruApiToken',
  'translationApiKey',
  'summaryApiKey',
  'embeddingApiKey',
  'zoteroApiKey',
  'zoteroUserId',
  'qaModelPresets',
]);

const NOTE_CITATION_STYLES = Object.freeze(['gbt7714', 'apa7', 'ieee']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function contractError(code, message, details) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizePatch(patch, allowedKeys, label) {
  if (!isPlainObject(patch)) {
    throw contractError('SETTINGS_INVALID_PATCH', `${label} patch must be a JSON object`);
  }

  const normalized = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowedKeys.includes(key)) {
      throw contractError('SETTINGS_UNKNOWN_KEY', `Unknown ${label} key: ${key}`, { key });
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeSettingsPatch(patch) {
  return normalizePatch(patch, SETTING_KEYS, 'settings');
}

function normalizeSecretsPatch(patch) {
  return normalizePatch(patch, SECRET_KEYS, 'secrets');
}

function normalizeNoteCitationStyle(value) {
  return NOTE_CITATION_STYLES.includes(value) ? value : null;
}

/**
 * 读取任意历史版本的配置文档并迁移到当前版本。
 * - 版本 0/1（旧配置文件、localStorage 快照）直接升级；
 * - 更高版本视为不兼容，拒绝读取而不是用旧代码覆盖；
 * - 损坏/非对象文档抛 SETTINGS_FILE_CORRUPT。
 */
function migrateAppSettingsDocument(raw) {
  if (raw === null || raw === undefined) {
    return {
      version: APP_SETTINGS_VERSION,
      revision: 0,
      settings: {},
      secrets: null,
      secretsEncrypted: null,
      zoteroLocalDataDir: '',
      leftSidebarCollapsed: false,
      updatedAt: 0,
      migratedFromVersion: null,
      changed: false,
    };
  }

  if (!isPlainObject(raw)) {
    throw contractError('SETTINGS_FILE_CORRUPT', 'The settings document must be a JSON object');
  }

  const rawVersion = Number(raw.version);
  const version = Number.isFinite(rawVersion) && rawVersion >= 0 ? rawVersion : 0;

  if (version > APP_SETTINGS_VERSION) {
    throw contractError(
      'SETTINGS_VERSION_UNSUPPORTED',
      `Settings version ${version} is newer than this build supports (${APP_SETTINGS_VERSION})`,
      { version, supported: APP_SETTINGS_VERSION },
    );
  }

  const revision = Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 1;
  const document = {
    version: APP_SETTINGS_VERSION,
    revision,
    settings: isPlainObject(raw.settings) ? { ...raw.settings } : {},
    secrets: isPlainObject(raw.secrets) ? { ...raw.secrets } : null,
    secretsEncrypted:
      typeof raw.secretsEncrypted === 'string' && raw.secretsEncrypted ? raw.secretsEncrypted : null,
    zoteroLocalDataDir:
      typeof raw.zoteroLocalDataDir === 'string' ? raw.zoteroLocalDataDir.trim() : '',
    leftSidebarCollapsed: raw.leftSidebarCollapsed === true,
    updatedAt: Number(raw.updatedAt) || 0,
    migratedFromVersion: version < APP_SETTINGS_VERSION ? version : null,
    changed: version !== APP_SETTINGS_VERSION,
  };

  return document;
}

function assertSettingsRevision(document, expectedRevision, { required = false } = {}) {
  const hasExpected =
    Number.isSafeInteger(expectedRevision) && Number(expectedRevision) >= 0;

  if (!hasExpected) {
    if (required) {
      throw contractError('SETTINGS_CONFLICT', 'expectedRevision is required for this write', {
        currentRevision: document.revision,
        reason: 'missing-revision',
      });
    }
    return;
  }

  if (Number(expectedRevision) !== Number(document.revision)) {
    throw contractError(
      'SETTINGS_CONFLICT',
      `Settings changed since revision ${expectedRevision} (current ${document.revision})`,
      {
        expectedRevision: Number(expectedRevision),
        currentRevision: Number(document.revision),
        reason: 'stale-revision',
      },
    );
  }
}

function buildPublicAppSettings(document) {
  return {
    version: document.version,
    revision: document.revision,
    settings: { ...document.settings },
    zoteroLocalDataDir: document.zoteroLocalDataDir,
    leftSidebarCollapsed: document.leftSidebarCollapsed,
    updatedAt: document.updatedAt,
  };
}

/**
 * 合并渲染层 localStorage 的旧快照。
 * 规则：
 *   - 配置文件里已有的键优先（它是主进程持久化的上一份权威值）；
 *   - 缺失键由 localStorage 补齐；
 *   - Notes 专用 `noteCitationStyle` 键优先于两份快照，因为它是 Notes 唯一
 *     的写入通道，而 Reader 的整对象写回正是历史上覆盖它的来源；
 *   - zoteroLocalDataDir 只在文档为空时用 SQLite 旧值补齐。
 */
function mergeLegacyAppSettings(document, legacy = {}, { legacyZoteroDir = '' } = {}) {
  const legacySettings = isPlainObject(legacy.settings) ? legacy.settings : {};
  const legacySecrets = isPlainObject(legacy.secrets) ? legacy.secrets : {};
  const nextSettings = { ...legacySettings, ...document.settings };
  const dedicatedStyle = normalizeNoteCitationStyle(legacy.noteCitationStyle);

  if (dedicatedStyle) {
    nextSettings.noteCitationStyle = dedicatedStyle;
  }

  let nextSecrets = document.secrets ? { ...document.secrets } : null;
  if (!document.secretsEncrypted) {
    nextSecrets = { ...legacySecrets, ...(nextSecrets ?? {}) };
  }

  const nextZoteroDir =
    document.zoteroLocalDataDir ||
    (typeof legacy.zoteroLocalDataDir === 'string' ? legacy.zoteroLocalDataDir.trim() : '') ||
    (typeof legacyZoteroDir === 'string' ? legacyZoteroDir.trim() : '');

  const changed =
    JSON.stringify(nextSettings) !== JSON.stringify(document.settings) ||
    JSON.stringify(nextSecrets) !== JSON.stringify(document.secrets) ||
    nextZoteroDir !== document.zoteroLocalDataDir;

  return {
    ...document,
    settings: nextSettings,
    secrets: nextSecrets,
    zoteroLocalDataDir: nextZoteroDir,
    changed,
  };
}

module.exports = {
  APP_SETTINGS_VERSION,
  NOTE_CITATION_STYLES,
  SECRET_KEYS,
  SETTING_KEYS,
  assertSettingsRevision,
  buildPublicAppSettings,
  contractError,
  isPlainObject,
  mergeLegacyAppSettings,
  migrateAppSettingsDocument,
  normalizeNoteCitationStyle,
  normalizeSecretsPatch,
  normalizeSettingsPatch,
};
