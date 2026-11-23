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
 * 这里用真实的 hook + 假的 bridge，断言失败路径不写配置、Zotero 目录不被清空。
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
      // 同时覆盖 './desktop'（readerConfig 内部）与 '../../services/desktop'（hook 内部）。
      builder.onResolve({ filter: /(^|\/)desktop(\.ts)?$/ }, () => ({ path: 'desktop', namespace: 'mock' }));
      builder.onResolve({ filter: /(^|\/)library(\.ts)?$/ }, () => ({ path: 'library', namespace: 'mock' }));
      builder.onResolve({ filter: /(^|\/)toast(\.tsx?)?$/ }, () => ({ path: 'toast', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => {
        if (args.path === 'desktop') {
          return {
            loader: 'js',
            contents: `
              export const approveWritePath = async () => {};
              export const getAppDefaultPaths = async () => globalThis.__desktop.getAppDefaultPaths();
              export const readLocalTextFileIfExists = async (p) => globalThis.__desktop.readTextFileIfExists(p);
              export const writeLocalTextFile = async (p, c) => globalThis.__desktop.writeTextFile(p, c);
              // 批量 2 的 B5 让 readerConfig 走 safeStorage 加解密；测试里保持明文直通。
              export const encryptReaderSecretPayload = async (payload) => payload;
              export const decryptReaderSecretPayload = async (payload) => payload;
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

function createBridge(overrides) {
  const calls = { reads: [], writes: [], libraryUpdates: [] };
  // 模拟磁盘：写入后能读回，writeReaderConfigFile 的读回校验才会通过。
  const files = new Map();
  globalThis.__desktop = {
    getAppDefaultPaths: async () => ({
      executableDir: '/app',
      configPath: '/data/paperquay.config.json',
      mineruCacheDir: '/cache',
      remotePdfDownloadDir: '/downloads',
    }),
    readTextFileIfExists: async (filePath) => {
      calls.reads.push(filePath);
      if (overrides.readTextFileIfExists) {
        const value = await overrides.readTextFileIfExists(filePath);
        if (value !== undefined) return value;
      }
      return files.get(filePath) ?? null;
    },
    writeTextFile: async (filePath, content) => {
      calls.writes.push({ path: filePath, content });
      if (!overrides.dropWrites) files.set(filePath, content);
    },
  };
  globalThis.__library = {
    getLibrarySettings: async () => ({
      storageDir: '',
      translatedPdfDir: '',
      zoteroLocalDataDir: overrides.nativeZoteroDir ?? '',
      notesVaultDir: '',
      importMode: 'copy',
    }),
    updateLibrarySettings: async (settings) => {
      calls.libraryUpdates.push(settings);
      return settings;
    },
  };
  globalThis.__toasts = [];
  return calls;
}

const configWrites = (calls) =>
  calls.writes.filter((write) => write.path === '/data/paperquay.config.json');

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a corrupt config disables persistence, warns the user and keeps the Zotero dir', async () => {
  const calls = createBridge({
    readTextFileIfExists: async () => '{ "secrets": ',
    nativeZoteroDir: 'C:\\Users\\me\\Zotero',
  });
  const harness = await renderHook();

  try {
    // 等 hydration 完成 + 350ms 配置防抖窗口过去。
    await act(async () => { await wait(500); });

    assert.equal(harness.state.current.configHydrated, true);
    assert.ok(harness.state.current.configLoadError, 'configLoadError should be populated');
    assert.ok(globalThis.__toasts.some((item) => item.tone === 'error'), 'a visible error toast is required');
    assert.equal(configWrites(calls).length, 0, 'must not overwrite an unreadable config file');
    assert.equal(harness.state.current.zoteroLocalDataDir, 'C:\\Users\\me\\Zotero');
    assert.equal(
      calls.libraryUpdates.some((settings) => settings.zoteroLocalDataDir === ''),
      false,
      'must not wipe the native Zotero directory',
    );
  } finally {
    await harness.unmount();
  }
});

test('a readable config is hydrated and persisted once hydration succeeds', async () => {
  const originalConfig = JSON.stringify({ version: 1, settings: { uiLanguage: 'en-US' }, secrets: { qaModelPresets: [] } });
  const calls = createBridge({
    // 只在首次读取（hydration）时返回原文件；之后走模拟磁盘，让写回校验能通过。
    readTextFileIfExists: async (filePath) =>
      filePath === '/data/paperquay.config.json' && calls.writes.length === 0
        ? originalConfig
        : undefined,
  });
  const harness = await renderHook();

  try {
    await act(async () => { await wait(500); });

    assert.equal(harness.state.current.configHydrated, true);
    assert.equal(harness.state.current.configLoadError, '');
    assert.equal(harness.state.current.settings.uiLanguage, 'en-US');
    const writes = configWrites(calls);
    assert.equal(writes.length >= 1, true, 'a readable config should be persisted');
    assert.equal(JSON.parse(writes[writes.length - 1].content).settings.uiLanguage, 'en-US');
  } finally {
    await harness.unmount();
  }
});

test('an empty config file is treated as damaged, not as first run', async () => {
  const calls = createBridge({ readTextFileIfExists: async () => '   \n' });
  const harness = await renderHook();

  try {
    await act(async () => { await wait(500); });

    assert.ok(harness.state.current.configLoadError, 'empty file must surface a recoverable error');
    assert.equal(configWrites(calls).length, 0);
  } finally {
    await harness.unmount();
  }
});
