import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const name of ['window', 'document', 'navigator', 'Event', 'CustomEvent', 'localStorage']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

/**
 * A3 的原始缺陷在 useReaderSettings 里：读取失败被当成首次运行，防抖写回覆盖 API Key。
 * 现在设置由主进程文档持有；这里用真实的 hook + 假的 app settings bridge，
 * 断言失败路径不写 patch、Zotero 目录不被清空，成功路径按 patch 持久化。
 */
const bundle = await build({
  entryPoints: ['src/features/reader/useReaderSettings.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'reader-settings-mocks',
    setup(builder) {
      // 同时覆盖 './desktop'（内部）与 '../../services/desktop'（hook 内部）。
      builder.onResolve({ filter: /(^|\/)desktop(\.ts)?$/ }, () => ({ path: 'desktop', namespace: 'mock' }));
      builder.onResolve({ filter: /(^|\/)library(\.ts)?$/ }, () => ({ path: 'library', namespace: 'mock' }));
      builder.onResolve({ filter: /(^|\/)appSettings(\.ts)?$/ }, () => ({ path: 'appSettings', namespace: 'mock' }));
      builder.onResolve({ filter: /(^|\/)toast(\.tsx?)?$/ }, () => ({ path: 'toast', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => {
        if (args.path === 'desktop') {
          return {
            loader: 'js',
            contents: `
              export const getAppDefaultPaths = async () => globalThis.__desktop.getAppDefaultPaths();
            `,
          };
        }
        if (args.path === 'library') {
          return {
            loader: 'js',
            contents: `
              export const getLibrarySettings = async () => globalThis.__library.getLibrarySettings();
              export const updateLibrarySettings = async (s) => globalThis.__library.updateLibrarySettings(s);
            `,
          };
        }
        if (args.path === 'appSettings') {
          return {
            loader: 'js',
            contents: `
              export const getAppSettings = (options) => globalThis.__appSettings.getAppSettings(options);
              export const getAppSettingsSecrets = () => globalThis.__appSettings.getAppSettingsSecrets();
              export const migrateLegacyAppSettings = (legacy) => globalThis.__appSettings.migrateLegacyAppSettings(legacy);
              export const patchAppSettings = (patch, options) => globalThis.__appSettings.patchAppSettings(patch, options);
              export const patchAppSettingsSecrets = (patch, options) => globalThis.__appSettings.patchAppSettingsSecrets(patch, options);
            `,
          };
        }
        return {
          loader: 'js',
          contents: 'export const toast = (input) => globalThis.__toasts.push(input);',
        };
      });
    },
  }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { useReaderSettings } = module.exports;

function createBridge({ document: initialDocument = null, readError = null, nativeZoteroDir = '' } = {}) {
  const calls = { patches: [], secretPatches: [], libraryUpdates: [], migrations: [] };
  const state = {
    document: initialDocument
      ? JSON.parse(JSON.stringify(initialDocument))
      : {
          version: 2,
          revision: 1,
          settings: {},
          secrets: {},
          zoteroLocalDataDir: nativeZoteroDir,
          leftSidebarCollapsed: false,
          updatedAt: 1,
        },
  };

  const publicDocument = () => ({
    version: state.document.version,
    revision: state.document.revision,
    settings: { ...state.document.settings },
    zoteroLocalDataDir: state.document.zoteroLocalDataDir,
    leftSidebarCollapsed: state.document.leftSidebarCollapsed,
    updatedAt: state.document.updatedAt,
  });

  globalThis.__desktop = {
    getAppDefaultPaths: async () => ({
      executableDir: '/app',
      configPath: '/data/paperquay.config.json',
      mineruCacheDir: '/cache',
      remotePdfDownloadDir: '/downloads',
    }),
  };
  globalThis.__library = {
    getLibrarySettings: async () => ({
      storageDir: '',
      translatedPdfDir: '',
      zoteroLocalDataDir: nativeZoteroDir,
      notesVaultDir: '',
      importMode: 'copy',
    }),
    updateLibrarySettings: async (settings) => {
      calls.libraryUpdates.push(settings);
      return settings;
    },
  };
  globalThis.__appSettings = {
    async migrateLegacyAppSettings(legacy) {
      if (readError) throw readError;
      calls.migrations.push(legacy);
      state.document.settings = {
        ...(legacy.settings ?? {}),
        ...state.document.settings,
      };
      if (legacy.noteCitationStyle) {
        state.document.settings.noteCitationStyle = legacy.noteCitationStyle;
      }
      if (!state.document.zoteroLocalDataDir && nativeZoteroDir) {
        state.document.zoteroLocalDataDir = nativeZoteroDir;
      }
      state.document.revision += 1;
      return { ok: true, ...publicDocument() };
    },
    async getAppSettings() {
      if (readError) throw readError;
      return publicDocument();
    },
    async getAppSettingsSecrets() {
      if (readError) throw readError;
      return { ...state.document.secrets };
    },
    async patchAppSettings(patch, options = {}) {
      calls.patches.push({ patch, options });
      if (options.expectedRevision !== undefined && options.expectedRevision !== state.document.revision) {
        return { ok: false, code: 'SETTINGS_CONFLICT', current: publicDocument() };
      }
      state.document.settings = { ...state.document.settings, ...patch };
      if (options.zoteroLocalDataDir !== undefined) {
        state.document.zoteroLocalDataDir = options.zoteroLocalDataDir;
      }
      state.document.revision += 1;
      return { ok: true, ...publicDocument() };
    },
    async patchAppSettingsSecrets(patch, options = {}) {
      calls.secretPatches.push({ patch, options });
      if (options.expectedRevision !== undefined && options.expectedRevision !== state.document.revision) {
        return { ok: false, code: 'SETTINGS_CONFLICT', current: publicDocument() };
      }
      state.document.secrets = { ...state.document.secrets, ...patch };
      state.document.revision += 1;
      return { ok: true, ...publicDocument() };
    },
  };
  globalThis.__toasts = [];
  return { calls, state };
}

async function renderHook() {
  const state = { current: null };
  const errors = [];

  function Harness() {
    state.current = useReaderSettings({
      setError: (value) => errors.push(value),
      setStatusMessage: () => {},
    });
    return null;
  }

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Harness)));

  return {
    state,
    errors,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/**
 * 轮询等待 React 状态稳定，替代固定 100/50ms 延时：
 * 回调在 act 内执行，条件满足即返回，超时才失败。
 */
async function waitFor(condition, label, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail(`Timed out waiting for ${label}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

test('an unreadable settings document disables persistence, warns the user and keeps the Zotero dir', async () => {
  const bridge = createBridge({
    readError: new Error('SETTINGS_FILE_CORRUPT: empty settings file'),
    nativeZoteroDir: 'C:\\Users\\me\\Zotero',
  });
  const harness = await renderHook();

  try {
    await waitFor(() => harness.state.current.configHydrated === true, 'settings hydration');

    assert.equal(harness.state.current.configHydrated, true);
    assert.ok(harness.state.current.configLoadError, 'configLoadError should be populated');
    assert.ok(globalThis.__toasts.some((item) => item.tone === 'error'), 'a visible error toast is required');
    assert.equal(bridge.calls.patches.length, 0, 'must not write over an unreadable settings document');
    assert.equal(harness.state.current.zoteroLocalDataDir, 'C:\\Users\\me\\Zotero');
    assert.equal(
      bridge.calls.libraryUpdates.some((settings) => settings.zoteroLocalDataDir === ''),
      false,
      'must not wipe the native Zotero directory',
    );
  } finally {
    await harness.unmount();
  }
});

test('a readable document hydrates and later changes persist as patches', async () => {
  const bridge = createBridge({
    document: {
      version: 2,
      revision: 4,
      settings: { uiLanguage: 'en-US', smoothScroll: true },
      secrets: { qaModelPresets: [] },
      zoteroLocalDataDir: '',
      leftSidebarCollapsed: false,
      updatedAt: 1,
    },
  });
  const harness = await renderHook();

  try {
    await waitFor(() => harness.state.current.configHydrated === true, 'settings hydration');

    assert.equal(harness.state.current.configHydrated, true);
    assert.equal(harness.state.current.configLoadError, '');
    assert.equal(harness.state.current.settings.uiLanguage, 'en-US');

    await act(async () => {
      harness.state.current.updateSetting('smoothScroll', false);
    });
    await waitFor(() => bridge.calls.patches.length > 0, 'the settings patch');

    assert.equal(bridge.state.document.settings.smoothScroll, false);
    const patch = bridge.calls.patches.at(-1)?.patch ?? {};
    assert.deepEqual(Object.keys(patch), ['smoothScroll']);
  } finally {
    await harness.unmount();
  }
});

test('a damaged document surfaces a recoverable error and writes nothing', async () => {
  const bridge = createBridge({
    readError: new Error('SETTINGS_FILE_CORRUPT: Settings file is not valid JSON'),
  });
  const harness = await renderHook();

  try {
    await waitFor(() => Boolean(harness.state.current.configLoadError), 'the damaged-document error');

    assert.ok(harness.state.current.configLoadError, 'damaged document must surface a recoverable error');
    assert.equal(bridge.calls.patches.length, 0);
  } finally {
    await harness.unmount();
  }
});
