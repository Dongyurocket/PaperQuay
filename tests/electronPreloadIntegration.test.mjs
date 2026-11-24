import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const preloadSource = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const { RENDERER_ALLOWED_COMMANDS } = require('../electron/ipcAllowlist.cjs');
const { RESTORE_MARKER_KEY } = require('../src/shared/rendererStorageRestore.cjs');
const { bundlePreload } = require('../scripts/bundle-preload.cjs');

// Objects created inside the vm context have a different Object prototype, so
// deepStrictEqual would fail on identical structure. Round-trip before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

function loadPreload({
  sendSync = () => null,
  platform = 'win32',
  storage = createStorage(),
  source = preloadSource,
  allowLocalRequires = true,
} = {}) {
  const calls = { sync: [], invoke: [], send: [] };
  const listeners = new Map();
  const exposed = {};

  const ipcRenderer = {
    sendSync(...args) {
      calls.sync.push(args.length > 1 ? args : args[0]);
      return sendSync(...args);
    },
    invoke(...args) {
      calls.invoke.push(args);
      return Promise.resolve('ipc-result');
    },
    send(channel, payload) {
      calls.send.push([channel, payload]);
    },
    on() {},
    removeListener() {},
  };

  // sandbox:true 的 preload 拿不到 clipboard 等受限导出，这里同样只提供沙箱可见的 API。
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposed[name] = api;
      },
    },
    ipcRenderer,
    webUtils: {
      getPathForFile: (file) => file.path || '',
    },
  };

  const sandboxGlobal = {
    localStorage: storage,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };

  const sandbox = {
    require(moduleName) {
      if (moduleName === 'electron') return electron;
      if (!allowLocalRequires) {
        throw new Error(`Sandboxed preload cannot require: ${moduleName}`);
      }
      if (moduleName === './ipcAllowlist.cjs') {
        return require('../electron/ipcAllowlist.cjs');
      }
      if (moduleName === '../src/shared/rendererStorageRestore.cjs') {
        return require('../src/shared/rendererStorageRestore.cjs');
      }
      throw new Error(`Unexpected preload require: ${moduleName}`);
    },
    module: { exports: {} },
    exports: {},
    window: sandboxGlobal,
    process: { platform },
    console,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  new vm.Script(source, { filename: 'electron/preload.bundle.cjs' }).runInContext(sandbox);

  return { api: exposed.paperquay, calls, listeners, storage, exposed };
}

let bundleSourcePromise = null;
async function loadBundledPreload(options = {}) {
  bundleSourcePromise ??= (async () => {
    // esbuild 子进程在部分环境不能写系统临时目录，产物放到仓库内 node_modules/.cache。
    const cacheRoot = path.join(process.cwd(), 'node_modules', '.cache');
    mkdirSync(cacheRoot, { recursive: true });
    const dir = mkdtempSync(path.join(cacheRoot, 'pq-preload-bundle-'));
    try {
      const outfile = path.join(dir, 'preload.bundle.cjs');
      await bundlePreload({ outfile });
      return readFileSync(outfile, 'utf8');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();

  return loadPreload({
    ...options,
    source: await bundleSourcePromise,
    // bundle 只能依赖 electron；任何本地相对 require 都会在沙箱里失败。
    allowLocalRequires: false,
  });
}

test('exposed invoke rejects non-allowlisted commands without reaching ipcRenderer', async () => {
  const { api, calls } = loadPreload();

  await assert.rejects(api.invoke('evil_command', { payload: true }), /Unsupported Electron command: evil_command/);
  await assert.rejects(api.invoke(42, {}), /Unsupported Electron command: 42/);
  assert.deepEqual(calls.invoke, []);

  const allowed = [...RENDERER_ALLOWED_COMMANDS][0];
  assert.equal(await api.invoke(allowed, { probe: 1 }), 'ipc-result');
  assert.deepEqual(plain(calls.invoke), [['paperquay:invoke', allowed, { probe: 1 }]]);

  assert.equal(await api.invoke(allowed), 'ipc-result');
  assert.deepEqual(plain(calls.invoke[1]), ['paperquay:invoke', allowed, {}]);
});

test('bundled preload enforces the same allowlist without local requires', async () => {
  const { api, calls } = await loadBundledPreload();

  await assert.rejects(api.invoke('evil_command', {}), /Unsupported Electron command: evil_command/);
  assert.deepEqual(calls.invoke, []);

  const allowed = [...RENDERER_ALLOWED_COMMANDS][0];
  assert.equal(await api.invoke(allowed, { probe: 1 }), 'ipc-result');
  assert.deepEqual(plain(calls.invoke), [['paperquay:invoke', allowed, { probe: 1 }]]);
});

test('restore sync applies state, writes the restore marker and acknowledges with restoreId/failedKeys', () => {
  const payload = {
    restoreId: 'restore-42',
    state: {
      'paper-reader-settings-v3': '{"uiLanguage":"en"}',
      'pq.perf': '1',
    },
  };
  const { calls, storage: restored } = loadPreload({ sendSync: () => payload });

  assert.deepEqual(calls.sync, ['paperquay:renderer-restore-sync']);
  assert.equal(restored.getItem('paper-reader-settings-v3'), '{"uiLanguage":"en"}');
  assert.equal(restored.getItem('pq.perf'), '1');

  const marker = JSON.parse(restored.getItem(RESTORE_MARKER_KEY));
  assert.equal(marker.restoreId, 'restore-42');
  assert.deepEqual(marker.failedKeys, []);

  const ack = calls.send.find(([channel]) => channel === 'paperquay:renderer-restore-ack');
  assert.ok(ack, 'expected a restore ack');
  assert.deepEqual(plain(ack[1]), { restoreId: 'restore-42', failedKeys: [], warnings: [] });
});

test('bundled preload keeps the same restore sync and ack behaviour', async () => {
  const payload = {
    restoreId: 'restore-bundle',
    state: { 'paper-reader-settings-v3': '{"uiLanguage":"zh"}' },
  };
  const { calls, storage: restored } = await loadBundledPreload({
    sendSync: (channel) => (channel === 'paperquay:renderer-restore-sync' ? payload : null),
  });

  assert.equal(calls.sync[0], 'paperquay:renderer-restore-sync');
  assert.equal(restored.getItem('paper-reader-settings-v3'), '{"uiLanguage":"zh"}');
  const ack = calls.send.find(([channel]) => channel === 'paperquay:renderer-restore-ack');
  assert.deepEqual(plain(ack[1]), { restoreId: 'restore-bundle', failedKeys: [], warnings: [] });
});

test('missing or invalid restore payload sends no ack', () => {
  for (const sendSync of [() => null, () => ({}), () => ({ restoreId: 'x' }), () => {
    throw new Error('sync channel unavailable');
  }]) {
    const { calls, storage } = loadPreload({ sendSync });
    assert.equal(calls.sync.length, 1);
    assert.deepEqual(calls.send, [], 'no ack without a valid restore payload');
    assert.equal(storage.getItem(RESTORE_MARKER_KEY), null);
  }
});

test('a repeated restoreId is skipped without clearing the storage again', () => {
  const storage = createStorage();
  const payload = { restoreId: 'restore-1', state: { 'pq.perf': '1' } };
  const first = loadPreload({ sendSync: () => payload, storage });
  assert.equal(storage.getItem('pq.perf'), '1');
  first.calls.send.length = 0;

  // Simulate user changes after the first restore, then a page reload.
  storage.setItem('pq.user-change', 'kept');
  const second = loadPreload({ sendSync: () => payload, storage });
  assert.equal(storage.getItem('pq.user-change'), 'kept');
  assert.equal(storage.getItem('pq.perf'), '1');
  const ack = second.calls.send.find(([channel]) => channel === 'paperquay:renderer-restore-ack');
  assert.equal(ack[1].restoreId, 'restore-1');
});

test('file drop approves only real local paths and emits them to the renderer', () => {
  const { api, calls, listeners } = loadPreload();
  const emitted = [];
  api.onFileDrop((payload) => emitted.push(payload));

  const realFile = { path: 'C:\\papers\\a.pdf' };
  const syntheticFile = {}; // synthetic DataTransfer files have no local path
  let prevented = 0;
  listeners.get('drop')({
    preventDefault() {
      prevented += 1;
    },
    dataTransfer: { types: ['Files'], files: [realFile, syntheticFile] },
  });

  assert.equal(prevented, 1);
  assert.deepEqual(plain(emitted), [{ type: 'drop', paths: ['C:\\papers\\a.pdf'] }]);
  assert.deepEqual(plain(calls.send), [['paperquay:approve-read-paths', ['C:\\papers\\a.pdf']]]);

  // Synthetic-only drops must not approve any read path.
  calls.send.length = 0;
  emitted.length = 0;
  listeners.get('drop')({
    preventDefault() {},
    dataTransfer: { types: ['Files'], files: [syntheticFile] },
  });
  assert.deepEqual(plain(emitted), [{ type: 'drop', paths: [] }]);
  assert.deepEqual(calls.send, []);
});

test('bundled preload keeps drag/drop path approval behaviour', async () => {
  const { api, calls, listeners } = await loadBundledPreload();
  const emitted = [];
  api.onFileDrop((payload) => emitted.push(payload));

  listeners.get('drop')({
    preventDefault() {},
    dataTransfer: { types: ['Files'], files: [{ path: 'D:\\papers\\b.pdf' }, {}] },
  });

  assert.deepEqual(plain(emitted), [{ type: 'drop', paths: ['D:\\papers\\b.pdf'] }]);
  assert.deepEqual(plain(calls.send), [['paperquay:approve-read-paths', ['D:\\papers\\b.pdf']]]);
});

test('non-file drags are ignored and unsubscribe removes every listener', () => {
  const { api, listeners } = loadPreload();
  const emitted = [];
  const unsubscribe = api.onFileDrop((payload) => emitted.push(payload));

  let prevented = 0;
  listeners.get('dragover')({
    preventDefault() {
      prevented += 1;
    },
    dataTransfer: { types: ['text/plain'] },
  });
  assert.equal(prevented, 0);
  assert.deepEqual(emitted, []);

  unsubscribe();
  assert.deepEqual([...listeners.keys()], []);
});

test('sandboxed clipboard bridge uses main-process IPC instead of the clipboard module', async () => {
  const { api, calls } = await loadBundledPreload({
    sendSync: (channel, command) =>
      channel === 'paperquay:invoke-sync' && command === 'clipboard_read_text' ? 'clipboard-text' : null,
  });

  assert.equal(api.clipboard.readText(), 'clipboard-text');
  assert.deepEqual(plain(calls.sync.at(-1)), [
    'paperquay:invoke-sync',
    'clipboard_read_text',
    {},
  ]);

  api.clipboard.writeText('hello');
  assert.deepEqual(plain(calls.invoke.at(-1)), [
    'paperquay:invoke',
    'clipboard_write_text',
    { text: 'hello' },
  ]);

  api.clipboard.writeText(42);
  assert.deepEqual(plain(calls.invoke.at(-1)), [
    'paperquay:invoke',
    'clipboard_write_text',
    { text: '42' },
  ]);
});

test('exposes the platform and webUtils-based file path resolution under sandbox', async () => {
  const { api, listeners, calls } = await loadBundledPreload({ platform: 'darwin' });

  assert.equal(api.platform, 'darwin');

  const emitted = [];
  api.onFileDrop((payload) => emitted.push(payload));
  // webUtils.getPathForFile 是沙箱 preload 可用的文件路径来源。
  listeners.get('drop')({
    preventDefault() {},
    dataTransfer: { types: ['Files'], files: [{ path: '/Users/me/paper.pdf' }, {}] },
  });

  assert.deepEqual(plain(emitted), [{ type: 'drop', paths: ['/Users/me/paper.pdf'] }]);
  assert.deepEqual(plain(calls.send), [
    ['paperquay:approve-read-paths', ['/Users/me/paper.pdf']],
  ]);
});
