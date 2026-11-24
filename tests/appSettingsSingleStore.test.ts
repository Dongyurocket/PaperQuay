import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Renderer-level regression for S4/D4-5: Notes and Reader must write through the
// same revisioned settings document, so a Reader write can never roll back a
// Notes citation-style change, and a restart hydrates the merged document.

function createMainStore(initial: { settings?: Record<string, unknown> } = {}) {
  const state = {
    version: 2,
    revision: 1,
    settings: {
      noteCitationStyle: 'gbt7714',
      smoothScroll: true,
      compactReading: false,
      ...initial.settings,
    },
    zoteroLocalDataDir: '',
    leftSidebarCollapsed: false,
    updatedAt: 1,
    secrets: {},
  };

  const publicDoc = () => ({
    version: state.version,
    revision: state.revision,
    settings: { ...state.settings },
    zoteroLocalDataDir: state.zoteroLocalDataDir,
    leftSidebarCollapsed: state.leftSidebarCollapsed,
    updatedAt: state.updatedAt,
  });

  return {
    state,
    async invoke(command: string, args: any = {}) {
      if (command === 'app_settings_get') return publicDoc();
      if (command === 'app_settings_get_secrets') return { ...state.secrets };
      if (command === 'app_settings_migrate_legacy') {
        return publicDoc();
      }
      if (command === 'app_settings_patch') {
        const patch = args.patch ?? {};
        if (args.expectedRevision !== undefined && args.expectedRevision !== state.revision) {
          return { ok: false, code: 'SETTINGS_CONFLICT', current: publicDoc() };
        }
        state.settings = { ...state.settings, ...patch };
        state.revision += 1;
        state.updatedAt += 1;
        return { ok: true, ...publicDoc() };
      }
      if (command === 'app_settings_patch_secrets') {
        state.secrets = { ...state.secrets, ...(args.patch ?? {}) };
        state.revision += 1;
        return { ok: true, ...publicDoc() };
      }
      throw new Error(`unexpected command: ${command}`);
    },
  };
}

const bundle = await build({
  stdin: {
    contents: `
      export * from './src/app/settings/appSettingsCache.ts';
      export { loadNoteCitationStyle, saveNoteCitationStyle } from './src/features/notes/bibliography.ts';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  plugins: [{
    name: 'app-settings-bridge-mock',
    setup(builder) {
      builder.onResolve({ filter: /platform\/electron\/core(\.ts)?$/ }, () => ({
        path: 'bridge',
        namespace: 'mock',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        loader: 'js',
        contents: `
          export async function invoke(command, args) {
            return globalThis.__appSettingsBridge.invoke(command, args);
          }
        `,
      }));
    },
  }],
});

const module = { exports: {} } as { exports: any };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  (await import('node:module')).createRequire(import.meta.url),
  module,
  module.exports,
);
const cache = module.exports as {
  hydrateAppSettings: () => Promise<unknown>;
  resetAppSettingsCache: () => void;
  getAppSettingsSnapshot: () => { revision: number; settings: Record<string, unknown> } | null;
  patchAppSettingsAndSync: (
    patch: Record<string, unknown>,
    options?: { expectedRevision?: number; rebaseOnConflict?: boolean },
  ) => Promise<{ ok: boolean; code?: string; snapshot?: { revision: number; settings: Record<string, unknown> } }>;
  loadNoteCitationStyle: () => string;
  saveNoteCitationStyle: (style: string) => Promise<void>;
};

test('Notes apa7 survives a later Reader write and a restart hydration', async () => {
  const main = createMainStore();
  (globalThis as any).__appSettingsBridge = main;
  cache.resetAppSettingsCache();
  await cache.hydrateAppSettings();

  assert.equal(cache.loadNoteCitationStyle(), 'gbt7714');
  await cache.saveNoteCitationStyle('apa7');
  assert.equal(main.state.settings.noteCitationStyle, 'apa7');

  // Reader writes an unrelated setting with the revision it hydrated.
  const readerResult = await cache.patchAppSettingsAndSync({ smoothScroll: false });
  assert.equal(readerResult.ok, true);
  assert.equal(main.state.settings.noteCitationStyle, 'apa7');
  assert.equal(main.state.settings.smoothScroll, false);

  // Restart: a fresh renderer cache hydrates from the same document.
  cache.resetAppSettingsCache();
  await cache.hydrateAppSettings();
  assert.equal(cache.loadNoteCitationStyle(), 'apa7');
  assert.equal(cache.getAppSettingsSnapshot()?.settings.smoothScroll, false);
});

test('a stale Reader write is rebased instead of rolling the document back', async () => {
  const main = createMainStore();
  (globalThis as any).__appSettingsBridge = main;
  cache.resetAppSettingsCache();
  await cache.hydrateAppSettings();

  const staleRevision = cache.getAppSettingsSnapshot()!.revision;

  // Another writer (Notes) moves the document forward after Reader hydrated.
  await main.invoke('app_settings_patch', {
    patch: { noteCitationStyle: 'apa7' },
    expectedRevision: staleRevision,
  });

  const result = await cache.patchAppSettingsAndSync(
    { compactReading: true },
    { expectedRevision: staleRevision },
  );

  assert.equal(result.ok, true);
  assert.equal(main.state.settings.noteCitationStyle, 'apa7');
  assert.equal(main.state.settings.compactReading, true);
  assert.equal(cache.getAppSettingsSnapshot()?.settings.noteCitationStyle, 'apa7');
});

test('a conflict on an explicitly stale citation-style write is rejected', async () => {
  const main = createMainStore();
  (globalThis as any).__appSettingsBridge = main;
  cache.resetAppSettingsCache();
  await cache.hydrateAppSettings();

  const staleRevision = cache.getAppSettingsSnapshot()!.revision;
  await main.invoke('app_settings_patch', {
    patch: { smoothScroll: false },
    expectedRevision: staleRevision,
  });

  const result = await cache.patchAppSettingsAndSync(
    { noteCitationStyle: 'ieee' },
    { expectedRevision: staleRevision, rebaseOnConflict: false },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SETTINGS_CONFLICT');
  assert.equal(main.state.settings.noteCitationStyle, 'gbt7714');
});
