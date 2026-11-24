'use strict';

const fs = require('node:fs');
const { writeJsonSync } = require('./utils.cjs');
const {
  assertSettingsRevision,
  buildPublicAppSettings,
  contractError,
  mergeLegacyAppSettings,
  migrateAppSettingsDocument,
  normalizeSecretsPatch,
  normalizeSettingsPatch,
} = require('../../src/shared/appSettingsContract.cjs');
const { decryptSecretValue, encryptSecretValue } = require('./secretStorage.cjs');

/**
 * 主进程唯一的应用设置存储。
 *
 * 文件仍是 `appPaths.configPath`（MCP 与 noteEmbedding 直接读取同一份），
 * 但写入方从渲染层改为这里：
 *   - 文档带 `version` 与单调递增的 `revision`；
 *   - 写入只接受按键 patch，并与调用方读到的 revision 校验；
 *   - secrets 在落盘前用 secretStorage 加密，读取时解密。
 */
function createAppSettingsStore({
  appPaths,
  legacyZoteroDir = () => '',
  now = () => Date.now(),
}) {
  const configPath = appPaths.configPath;

  function readRawDocument() {
    let text;
    try {
      text = fs.readFileSync(configPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw contractError('SETTINGS_FILE_CORRUPT', `Failed to read ${configPath}: ${error?.message ?? error}`);
    }

    if (!text.trim()) {
      throw contractError('SETTINGS_FILE_CORRUPT', `Settings file is empty: ${configPath}`);
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw contractError('SETTINGS_FILE_CORRUPT', `Settings file is not valid JSON: ${error?.message ?? error}`);
    }
  }

  function serialize(document) {
    const serialized = {
      version: document.version,
      revision: document.revision,
      settings: document.settings,
      zoteroLocalDataDir: document.zoteroLocalDataDir,
      leftSidebarCollapsed: document.leftSidebarCollapsed,
      updatedAt: document.updatedAt,
    };

    if (document.secrets && Object.keys(document.secrets).length > 0) {
      serialized.secretsEncrypted = encryptSecretValue(
        JSON.stringify(document.secrets),
        appPaths,
      );
    } else if (document.secretsEncrypted) {
      serialized.secretsEncrypted = document.secretsEncrypted;
    }

    return serialized;
  }

  function persist(document) {
    writeJsonSync(configPath, serialize(document));
    return document;
  }

  function decryptSecrets(document) {
    if (document.secrets) return document.secrets;
    if (!document.secretsEncrypted) {
      document.secrets = {};
      return document.secrets;
    }

    const decrypted = decryptSecretValue(document.secretsEncrypted, appPaths);
    const parsed = JSON.parse(decrypted);
    document.secrets =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    return document.secrets;
  }

  function loadDocument() {
    const raw = readRawDocument();
    const document = migrateAppSettingsDocument(raw);

    // 旧版本文件在第一次读取时原地升级；升级失败向上抛错，调用方据此
    // 暂停写入，而不是继续用旧格式覆盖。
    if (raw !== null && document.changed) {
      document.updatedAt = document.updatedAt || now();
      persist(document);
      document.changed = false;
    }

    return document;
  }

  function publicResult(extra = {}) {
    const document = loadDocument();
    return { ok: true, ...buildPublicAppSettings(document), ...extra };
  }

  function patch(patchValue, { expectedRevision, requireRevision = false } = {}) {
    const document = loadDocument();

    try {
      assertSettingsRevision(document, expectedRevision, { required: requireRevision });
    } catch (error) {
      if (error?.code === 'SETTINGS_CONFLICT') {
        return {
          ok: false,
          code: error.code,
          message: error.message,
          current: buildPublicAppSettings(document),
        };
      }
      throw error;
    }

    const normalized = normalizeSettingsPatch(patchValue);
    if (Object.keys(normalized).length === 0) {
      return { ok: true, ...buildPublicAppSettings(document) };
    }

    const next = {
      ...document,
      settings: { ...document.settings, ...normalized },
      revision: document.revision + 1,
      updatedAt: now(),
    };
    persist(next);
    return { ok: true, ...buildPublicAppSettings(next) };
  }

  function patchSecrets(patchValue, { expectedRevision, requireRevision = false } = {}) {
    const document = loadDocument();
    decryptSecrets(document);

    try {
      assertSettingsRevision(document, expectedRevision, { required: requireRevision });
    } catch (error) {
      if (error?.code === 'SETTINGS_CONFLICT') {
        return {
          ok: false,
          code: error.code,
          message: error.message,
          current: buildPublicAppSettings(document),
        };
      }
      throw error;
    }

    const normalized = normalizeSecretsPatch(patchValue);
    if (Object.keys(normalized).length === 0) {
      return { ok: true, ...buildPublicAppSettings(document) };
    }

    const next = {
      ...document,
      secrets: { ...document.secrets, ...normalized },
      revision: document.revision + 1,
      updatedAt: now(),
    };
    persist(next);
    return { ok: true, ...buildPublicAppSettings(next) };
  }

  function patchZoteroDir(value, { expectedRevision, requireRevision = false } = {}) {
    const document = loadDocument();

    try {
      assertSettingsRevision(document, expectedRevision, { required: requireRevision });
    } catch (error) {
      if (error?.code === 'SETTINGS_CONFLICT') {
        return {
          ok: false,
          code: error.code,
          message: error.message,
          current: buildPublicAppSettings(document),
        };
      }
      throw error;
    }

    const nextDir = typeof value === 'string' ? value.trim() : '';
    if (nextDir === document.zoteroLocalDataDir) {
      return { ok: true, ...buildPublicAppSettings(document) };
    }

    const next = {
      ...document,
      zoteroLocalDataDir: nextDir,
      revision: document.revision + 1,
      updatedAt: now(),
    };
    persist(next);
    return { ok: true, ...buildPublicAppSettings(next) };
  }

  function migrateLegacy(legacy = {}) {
    const document = loadDocument();
    let legacyZotero = '';
    try {
      legacyZotero = legacyZoteroDir() || '';
    } catch {
      legacyZotero = '';
    }

    const merged = mergeLegacyAppSettings(document, legacy, { legacyZoteroDir: legacyZotero });
    const needsUpgrade = document.migratedFromVersion !== null;

    if (!merged.changed && !needsUpgrade) {
      return { ok: true, ...buildPublicAppSettings(merged) };
    }

    const next = {
      ...merged,
      revision: merged.revision + 1,
      updatedAt: now(),
    };
    persist(next);
    return { ok: true, ...buildPublicAppSettings(next) };
  }

  return {
    configPath,
    getPublic() {
      return buildPublicAppSettings(loadDocument());
    },
    getSecrets() {
      const document = loadDocument();
      return { ...decryptSecrets(document) };
    },
    migrateLegacy,
    patch,
    patchSecrets,
    patchZoteroDir,
    publicResult,
  };
}

module.exports = { createAppSettingsStore };
