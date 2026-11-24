'use strict';

/**
 * 应用设置 IPC 命令。
 *
 * 所有写入都返回结构化结果：预期内的版本冲突（SETTINGS_CONFLICT）不抛错，
 * 而是带回当前文档，渲染层可以基于最新 revision 重放 patch；只有调用方
 * 传了未知键等编程错误才抛出。
 */
function createAppSettingsCommands(context) {
  const { appSettings, store } = context;

  if (!appSettings) {
    return {};
  }

  function mirrorZoteroDir(document) {
    if (!store || !document) return;
    try {
      const library = store.load();
      const nextDir = String(document.zoteroLocalDataDir ?? '').trim();
      if (library.settings.zoteroLocalDataDir === nextDir) return;
      library.settings = { ...library.settings, zoteroLocalDataDir: nextDir };
      store.saveSettings(library.settings);
    } catch (error) {
      console.warn('[paperquay] Failed to mirror the Zotero data directory into library settings.', error);
    }
  }

  return {
    app_settings_get() {
      return appSettings.getPublic();
    },

    app_settings_get_secrets() {
      return appSettings.getSecrets();
    },

    app_settings_patch({ patch, zoteroLocalDataDir, expectedRevision } = {}) {
      const result = appSettings.patch(patch ?? {}, { expectedRevision });

      if (!result.ok) {
        return result;
      }

      if (zoteroLocalDataDir !== undefined) {
        const zoteroResult = appSettings.patchZoteroDir(zoteroLocalDataDir, {
          expectedRevision: result.revision,
        });

        if (!zoteroResult.ok) {
          return zoteroResult;
        }

        mirrorZoteroDir(zoteroResult);
        return zoteroResult;
      }

      return result;
    },

    app_settings_patch_secrets({ patch, expectedRevision } = {}) {
      return appSettings.patchSecrets(patch ?? {}, { expectedRevision });
    },

    app_settings_migrate_legacy({ settings, secrets, noteCitationStyle, zoteroLocalDataDir } = {}) {
      const result = appSettings.migrateLegacy({
        settings,
        secrets,
        noteCitationStyle,
        zoteroLocalDataDir,
      });

      if (result.ok) {
        mirrorZoteroDir(result);
      }

      return result;
    },
  };
}

module.exports = { createAppSettingsCommands };
