import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Regression for the vault auto-sync effect reading loadSettings() once:
// toggling notesVaultAutoSyncEnabled / changing the interval must clear the old
// interval immediately and re-arm with the new cadence, while unrelated settings
// changes must not reset the countdown.

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const name of [
  'window', 'document', 'navigator', 'Event', 'CustomEvent', 'localStorage',
  'Node', 'Element', 'HTMLElement', 'MutationObserver',
]) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The hook calls window.setInterval; forward to the (mockable) global timer so
// node:test fake timers control it.
Object.defineProperty(dom.window, 'setInterval', {
  configurable: true,
  value: (...args) => globalThis.setInterval(...args),
});
Object.defineProperty(dom.window, 'clearInterval', {
  configurable: true,
  value: (...args) => globalThis.clearInterval(...args),
});

const realRequire = createRequire(import.meta.url);
const React = realRequire('react');
const { act } = React;
const { createRoot } = realRequire('react-dom/client');

// Minimal single settings store matching appSettingsCache's subscribe/getSnapshot.
const listeners = new Set();
let settingsSnapshot = null;
const settingsStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return settingsSnapshot;
  },
  set(next) {
    settingsSnapshot = next;
    for (const listener of [...listeners]) listener();
  },
};

function settings(options) {
  return {
    version: 2,
    revision: options.revision ?? 1,
    settings: {
      notesVaultAutoSyncEnabled: options.enabled,
      notesVaultAutoSyncIntervalMinutes: options.interval,
      uiLanguage: options.uiLanguage ?? 'zh-CN',
    },
    zoteroLocalDataDir: '',
    leftSidebarCollapsed: false,
    updatedAt: options.revision ?? 1,
  };
}

function emptyModule() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === '__esModule') return true;
      return () => null;
    },
  });
}

function makeNotesService() {
  const base = {
    __esModule: true,
    getNotesVaultSettings: async () => ({ dir: '/tmp/paperquay-vault' }),
    syncNotesVaultNow: async (options) => {
      globalThis.__vaultSyncCalls.push(options ?? {});
      return {};
    },
    listNoteFolders: async () => [],
    getNote: async () => null,
    getNotesIndexStatus: async () => ({ running: false, completed: 0, failed: 0, pending: 0 }),
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => null;
    },
  });
}

function customRequire(id) {
  if (id === 'react' || id.startsWith('react/') || id === 'react-dom' || id.startsWith('react-dom/')) {
    return realRequire(id);
  }
  if (id.includes('app/settings/useAppSettings')) {
    return {
      useAppSettingsSnapshot: () => React.useSyncExternalStore(
        settingsStore.subscribe,
        settingsStore.getSnapshot,
        settingsStore.getSnapshot,
      ),
    };
  }
  if (id.includes('services/notes')) {
    return makeNotesService();
  }
  if (id.includes('reader/readerShared')) {
    return {
      loadSettings: () => ({
        notesVaultAutoSyncEnabled: false,
        notesVaultAutoSyncIntervalMinutes: 30,
      }),
    };
  }
  if (id.includes('notesQuickWins')) {
    return { shouldRunVaultAutoSync: () => true };
  }
  return emptyModule();
}

const bundle = await build({
  entryPoints: ['src/features/notes/NotesWorkspace.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'externalize-everything',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => (
        args.kind === 'entry-point' ? undefined : { external: true }
      ));
    },
  }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  customRequire,
  loaded,
  loaded.exports,
);
const { useVaultAutoSyncSchedule } = loaded.exports;
assert.equal(typeof useVaultAutoSyncSchedule, 'function');

// Stable identities, like the useCallback-wrapped functions in NotesWorkspace;
// otherwise every re-render would restart the effect for an unrelated reason.
const stableLoadNotes = async () => { globalThis.__loadNotesCalls += 1; };
const stableRefreshFolders = async () => { globalThis.__refreshFoldersCalls += 1; };

function Harness() {
  const lastRunAtRef = React.useRef(null);
  useVaultAutoSyncSchedule({
    loadNotes: stableLoadNotes,
    refreshFolders: stableRefreshFolders,
    lastRunAtRef,
  });
  return null;
}

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness));
  });
  return {
    root,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

async function tick(ms) {
  await act(async () => {
    mock.timers.tick(ms);
    await flushMicrotasks();
  });
}

async function withFakeTimers(run) {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    await run();
  } finally {
    mock.timers.reset();
  }
}

function resetCounters() {
  globalThis.__vaultSyncCalls = [];
  globalThis.__loadNotesCalls = 0;
  globalThis.__refreshFoldersCalls = 0;
}

const MINUTE = 60_000;

test('enabled at 30 minutes fires once at the 30 minute mark', async () => {
  await withFakeTimers(async () => {
    resetCounters();
    settingsStore.set(settings({ enabled: true, interval: 30 }));
    const mounted = await mount();
    try {
      await tick(29 * MINUTE);
      assert.equal(globalThis.__vaultSyncCalls.length, 0);
      await tick(MINUTE);
      assert.equal(globalThis.__vaultSyncCalls.length, 1);
      await tick(30 * MINUTE);
      assert.equal(globalThis.__vaultSyncCalls.length, 2);
    } finally {
      await mounted.unmount();
    }
  });
});

test('disabling clears the pending interval immediately', async () => {
  await withFakeTimers(async () => {
    resetCounters();
    settingsStore.set(settings({ enabled: true, interval: 30 }));
    const mounted = await mount();
    try {
      await tick(10 * MINUTE);
      assert.equal(globalThis.__vaultSyncCalls.length, 0);

      // Turn auto-sync off well before the 30 minute mark.
      await act(async () => {
        settingsStore.set(settings({ enabled: false, interval: 30, revision: 2 }));
      });

      await tick(60 * MINUTE);
      assert.equal(globalThis.__vaultSyncCalls.length, 0);
      assert.equal(globalThis.__loadNotesCalls, 0);
    } finally {
      await mounted.unmount();
    }
  });
});

test('changing the interval swaps the old timer for the new cadence', async () => {
  await withFakeTimers(async () => {
    resetCounters();
    settingsStore.set(settings({ enabled: true, interval: 30 }));
    const mounted = await mount();
    try {
      await tick(10 * MINUTE);
      assert.equal(globalThis.__vaultSyncCalls.length, 0);

      await act(async () => {
        settingsStore.set(settings({ enabled: true, interval: 15, revision: 2 }));
      });

      // 15 minute cadence starts at t=10 -> first fire at t=25.
      await tick(11 * MINUTE); // t=21
      assert.equal(globalThis.__vaultSyncCalls.length, 0);
      await tick(4 * MINUTE); // t=25 -> 1
      assert.equal(globalThis.__vaultSyncCalls.length, 1);

      // The old 30 minute timer (armed at t=0) must be gone; otherwise this adds one.
      await tick(5 * MINUTE); // t=30
      assert.equal(globalThis.__vaultSyncCalls.length, 1);

      await tick(10 * MINUTE); // t=40 -> second fire of the 15 minute cadence
      assert.equal(globalThis.__vaultSyncCalls.length, 2);
    } finally {
      await mounted.unmount();
    }
  });
});

test('an unrelated settings change does not reset the countdown', async () => {
  await withFakeTimers(async () => {
    resetCounters();
    settingsStore.set(settings({ enabled: true, interval: 30 }));
    const mounted = await mount();
    try {
      await tick(10 * MINUTE);

      // Same auto-sync values, new revision + language (unrelated setting).
      await act(async () => {
        settingsStore.set(settings({
          enabled: true,
          interval: 30,
          revision: 2,
          uiLanguage: 'en-US',
        }));
      });

      await tick(19 * MINUTE); // t=29
      assert.equal(globalThis.__vaultSyncCalls.length, 0);
      await tick(MINUTE); // t=30 -> original timer fires exactly once
      assert.equal(globalThis.__vaultSyncCalls.length, 1);
      assert.equal(globalThis.__loadNotesCalls, 1);
      assert.equal(globalThis.__refreshFoldersCalls, 1);
    } finally {
      await mounted.unmount();
    }
  });
});
