import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const { MAX_CLIPBOARD_TEXT_LENGTH } = require('../electron/ipcAllowlist.cjs');
const DEV_SERVER_URL = 'http://127.0.0.1:1420';
const TRUSTED_FRAME = { url: `${DEV_SERVER_URL}/`, parent: null };

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Objects created inside the vm context have a different Object prototype, so
// deepStrictEqual would fail on identical structure. Round-trip before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));

function createMainHarness() {
  process.env.VITE_DEV_SERVER_URL = DEV_SERVER_URL;

  const ipcHandlers = new Map();
  const ipcListeners = new Map();
  const appListeners = new Map();
  const windows = [];
  const openExternalCalls = [];
  const errorBoxes = [];
  const ackCalls = [];
  const backendInvokeCalls = [];
  const approvedReadPaths = [];
  const loadCalls = [];
  const exitCalls = [];
  const clipboardState = { text: '' };
  let nextContentsId = 1;

  const restorePayload = {
    restoreId: 'restore-42',
    state: { 'paper-reader-settings-v3': '{"uiLanguage":"en"}' },
  };

  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.events = new Map();
      this.webContents = {
        id: nextContentsId++,
        handlers: new Map(),
        sent: [],
        on(event, handler) {
          this.handlers.set(event, handler);
        },
        setWindowOpenHandler(handler) {
          this.windowOpenHandler = handler;
        },
        send(channel, eventName, payload) {
          this.sent.push([channel, eventName, payload]);
        },
        loadURL: async () => {},
        loadFile: async () => {},
      };
      windows.push(this);
    }

    static getAllWindows() {
      return windows;
    }

    static fromWebContents(contents) {
      return windows.find((window) => window.webContents === contents) || null;
    }

    once(event, handler) {
      this.events.set(event, handler);
    }

    show() {
      this.shown = true;
    }

    isDestroyed() {
      return false;
    }

    isMinimized() {
      return false;
    }

    restore() {}
    focus() {}
    reload() {
      this.reloadCount = (this.reloadCount || 0) + 1;
    }
    minimize() {}
    maximize() {}
    unmaximize() {}
    isMaximized() {
      return false;
    }
    close() {
      this.closed = true;
    }
  }

  const app = {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: () => readyPromise,
    on(event, handler) {
      appListeners.set(event, handler);
    },
    getPath: () => 'C:\\Users\\me\\AppData\\Roaming\\PaperQuay',
    setAppUserModelId() {},
    quit() {},
    exit(code) {
      exitCalls.push(code);
    },
  };

  const ipcMain = {
    handle(channel, handler) {
      ipcHandlers.set(channel, handler);
    },
    on(channel, handler) {
      ipcListeners.set(channel, handler);
    },
  };

  const backend = {
    invoke: async (command, args, event) => {
      backendInvokeCalls.push({ command, args, event });
      return { command, ok: true };
    },
    approveReadPath(filePath) {
      approvedReadPaths.push(filePath);
    },
    pathPolicy: { isPdfPathAllowed: () => false },
    close() {},
    shutdown: async () => ({ drained: true }),
  };

  const backupImport = {
    applyPendingBackupRestore: async () => ({}),
    repairRestoredBackupPaths: async () => {},
    cleanupOrphanBackupImports: async () => {},
    getRendererRestorePayload: () => restorePayload,
    handleRendererRestoreAck: async (appPaths, payload) => {
      ackCalls.push({ appPaths, payload });
      return { ok: true };
    },
  };

  const modules = {
    electron: {
      app,
      BrowserWindow: FakeBrowserWindow,
      ipcMain,
      clipboard: {
        readText: () => clipboardState.text,
        writeText: (value) => {
          clipboardState.text = value;
        },
      },
      shell: {
        openExternal: (url) => openExternalCalls.push(url),
      },
      dialog: {
        showErrorBox: (title, content) => errorBoxes.push({ title, content }),
        showMessageBox: async () => ({ response: 1 }),
      },
      session: { defaultSession: {} },
    },
    'node:fs': fs,
    'node:path': path,
    './backend.cjs': { createBackend: () => backend },
    './backend/libraryStore.cjs': {
      createAppPaths: () => ({
        dataDir: 'C:\\data',
        configPath: 'C:\\data\\.settings\\paperquay.config.json',
        mineruCacheDir: 'C:\\data\\.mineru-cache',
        remotePdfDownloadDir: 'C:\\data\\.downloads\\pdfs',
      }),
    },
    './ipcAllowlist.cjs': require('../electron/ipcAllowlist.cjs'),
    './ipcSecurity.cjs': require('../electron/ipcSecurity.cjs'),
    './appSecurity.cjs': {
      installContentSecurityPolicy() {},
      installPermissionHandlers() {},
    },
    './appLifecycle.cjs': {
      createRendererFailureController: () => ({
        handleRenderProcessGone() {},
        handleDidFailLoad() {},
        handleLoadRejection() {},
      }),
      createStartupFailureHandler: () => () => true,
      loadRendererEntry: async (webContents, options) => {
        loadCalls.push(options);
      },
      showPendingRestoreError: () => true,
    },
    './perfTrace.cjs': {
      perfMark() {},
      perfMeasure() {},
    },
    './backend/desktopRunMarker.cjs': {
      writeDesktopRunMarker() {},
      removeDesktopRunMarker() {},
    },
    './backend/externalWriteWatch.cjs': {
      createExternalWriteWatcher: () => ({ close() {} }),
    },
    './backend/backupImport.cjs': backupImport,
    './backend/backupExport.cjs': {
      cleanupOrphanBackupStages: async () => {},
    },
    './localPdfProtocol.cjs': {
      registerLocalPdfProtocol() {},
      registerLocalPdfProtocolScheme() {},
    },
    './backend/pathPolicy.cjs': {
      createPathPolicy: () => ({}),
    },
  };

  const sandbox = {
    require(moduleName) {
      if (!Object.prototype.hasOwnProperty.call(modules, moduleName)) {
        throw new Error(`Unexpected main require: ${moduleName}`);
      }
      return modules[moduleName];
    },
    module: { exports: {} },
    exports: {},
    __dirname: path.resolve('electron'),
    __filename: path.resolve('electron', 'main.cjs'),
    process,
    console,
    setTimeout,
    clearTimeout,
    Buffer,
    URL,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  new vm.Script(mainSource, { filename: 'electron/main.cjs' }).runInContext(sandbox);

  return {
    async ready() {
      resolveReady();
      await flushAsync();
      await flushAsync();
    },
    ipcHandlers,
    ipcListeners,
    appListeners,
    windows,
    openExternalCalls,
    errorBoxes,
    ackCalls,
    backendInvokeCalls,
    approvedReadPaths,
    loadCalls,
    restorePayload,
    exitCalls,
    clipboardState,
    mainWindow() {
      return windows[0];
    },
    mainContentsId() {
      return windows[0]?.webContents.id;
    },
  };
}

test('main.cjs creates the main window and registers the IPC surface after ready', async () => {
  const harness = createMainHarness();
  await harness.ready();

  assert.equal(harness.windows.length, 1);
  harness.mainWindow().events.get('ready-to-show')();
  assert.equal(harness.mainWindow().shown, true);
  assert.equal(harness.loadCalls.length, 1);
  assert.equal(harness.loadCalls[0].isDev, true);
  assert.equal(harness.loadCalls[0].devServerUrl, DEV_SERVER_URL);
  assert.match(harness.loadCalls[0].entryFile, /dist[\\/]index\.html$/);

  assert.deepEqual(
    [...harness.ipcHandlers.keys()].sort(),
    ['paperquay:invoke', 'paperquay:window-control'],
  );
  assert.deepEqual(
    [...harness.ipcListeners.keys()].sort(),
    [
      'paperquay:approve-read-paths',
      'paperquay:invoke-sync',
      'paperquay:renderer-restore-ack',
      'paperquay:renderer-restore-sync',
    ],
  );
  assert.equal(harness.errorBoxes.length, 0);
});

test('paperquay:invoke rejects untrusted windows, untrusted documents and non-allowlisted commands', async () => {
  const harness = createMainHarness();
  await harness.ready();
  const invoke = harness.ipcHandlers.get('paperquay:invoke');
  const mainContentsId = harness.mainContentsId();

  await assert.rejects(
    invoke({ sender: { id: 9999 }, senderFrame: TRUSTED_FRAME }, 'app_settings_get', {}),
    /untrusted window/,
  );
  await assert.rejects(
    invoke(
      { sender: { id: mainContentsId }, senderFrame: { url: 'file:///C:/Users/me/evil.html', parent: null } },
      'app_settings_get',
      {},
    ),
    /untrusted document/,
  );
  await assert.rejects(
    invoke(
      { sender: { id: mainContentsId }, senderFrame: { url: TRUSTED_FRAME.url, parent: TRUSTED_FRAME } },
      'app_settings_get',
      {},
    ),
    /untrusted frame/,
  );
  await assert.rejects(
    invoke({ sender: { id: mainContentsId }, senderFrame: TRUSTED_FRAME }, 'evil_command', {}),
    /Unsupported Electron command: evil_command/,
  );
  assert.deepEqual(harness.backendInvokeCalls, []);

  const event = { sender: { id: mainContentsId }, senderFrame: TRUSTED_FRAME };
  const result = await invoke(event, 'app_settings_get', { probe: 1 });
  assert.deepEqual(result, { command: 'app_settings_get', ok: true });
  assert.equal(harness.backendInvokeCalls.length, 1);
  assert.equal(harness.backendInvokeCalls[0].command, 'app_settings_get');
  assert.deepEqual(harness.backendInvokeCalls[0].args, { probe: 1 });
  assert.equal(harness.backendInvokeCalls[0].event, event);
});

test('renderer restore sync returns the pending payload only for the main window', async () => {
  const harness = createMainHarness();
  await harness.ready();
  const sync = harness.ipcListeners.get('paperquay:renderer-restore-sync');
  const mainContentsId = harness.mainContentsId();

  const mainEvent = { sender: { id: mainContentsId }, returnValue: 'unset' };
  sync(mainEvent);
  assert.deepEqual(mainEvent.returnValue, harness.restorePayload);

  const otherEvent = { sender: { id: mainContentsId + 100 }, returnValue: 'unset' };
  sync(otherEvent);
  assert.equal(otherEvent.returnValue, null);
});

test('renderer restore ack forwards only matching payloads from the main window', async () => {
  const harness = createMainHarness();
  await harness.ready();
  const ack = harness.ipcListeners.get('paperquay:renderer-restore-ack');
  const mainContentsId = harness.mainContentsId();

  ack({ sender: { id: mainContentsId + 100 } }, { restoreId: 'restore-42', failedKeys: [] });
  ack({ sender: { id: mainContentsId } }, { restoreId: 'stale-restore', failedKeys: [] });
  await flushAsync();
  assert.deepEqual(harness.ackCalls, []);

  const payload = { restoreId: 'restore-42', failedKeys: ['paper-reader-settings-v3'], warnings: [] };
  ack({ sender: { id: mainContentsId } }, payload);
  await flushAsync();
  assert.equal(harness.ackCalls.length, 1);
  assert.deepEqual(harness.ackCalls[0].payload, payload);
  assert.equal(harness.ackCalls[0].appPaths.dataDir, 'C:\\data');
});

test('will-navigate allows the trusted dev URL and blocks https/file escapes', async () => {
  const harness = createMainHarness();
  await harness.ready();
  const willNavigate = harness.mainWindow().webContents.handlers.get('will-navigate');
  assert.equal(typeof willNavigate, 'function');

  const navigate = (url) => {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    willNavigate(event, url);
    return event.prevented;
  };

  assert.equal(navigate(`${DEV_SERVER_URL}/#/reader`), false);
  assert.deepEqual(harness.openExternalCalls, []);

  assert.equal(navigate('https://evil.example/phish'), true);
  assert.deepEqual(harness.openExternalCalls, ['https://evil.example/phish']);

  assert.equal(navigate('file:///C:/Users/me/evil.html'), true);
  assert.deepEqual(harness.openExternalCalls, ['https://evil.example/phish']);

  const openHandler = harness.mainWindow().webContents.windowOpenHandler;
  assert.deepEqual(plain(openHandler({ url: 'https://example.com/paper' })), { action: 'deny' });
  assert.deepEqual(harness.openExternalCalls, [
    'https://evil.example/phish',
    'https://example.com/paper',
  ]);
});

test('preload read-path approval is limited to the main window and string paths', async () => {
  const harness = createMainHarness();
  await harness.ready();
  const approve = harness.ipcListeners.get('paperquay:approve-read-paths');
  const mainContentsId = harness.mainContentsId();

  approve({ sender: { id: mainContentsId + 1 } }, ['C:\\papers\\a.pdf']);
  assert.deepEqual(harness.approvedReadPaths, []);

  approve({ sender: { id: mainContentsId } }, ['C:\\papers\\a.pdf', 42, '', null]);
  assert.deepEqual(harness.approvedReadPaths, ['C:\\papers\\a.pdf']);
});

test('clipboard commands run in the main process and accept only bounded strings', async () => {
  const harness = createMainHarness();
  await harness.ready();
  const invoke = harness.ipcHandlers.get('paperquay:invoke');
  const sync = harness.ipcListeners.get('paperquay:invoke-sync');
  const mainContentsId = harness.mainContentsId();
  const event = { sender: { id: mainContentsId }, senderFrame: TRUSTED_FRAME };

  await invoke(event, 'clipboard_write_text', { text: 'hello' });
  assert.equal(harness.clipboardState.text, 'hello');
  assert.equal(await invoke(event, 'clipboard_read_text', {}), 'hello');

  await assert.rejects(
    invoke(event, 'clipboard_write_text', { text: 42 }),
    /clipboard_write_text: args\.text: expected string/,
  );
  await assert.rejects(invoke(event, 'clipboard_write_text', {}), /expected string/);

  const oversized = 'x'.repeat(MAX_CLIPBOARD_TEXT_LENGTH + 5);
  await invoke(event, 'clipboard_write_text', { text: oversized });
  assert.equal(harness.clipboardState.text.length, MAX_CLIPBOARD_TEXT_LENGTH);

  const syncEvent = { sender: { id: mainContentsId }, senderFrame: TRUSTED_FRAME, returnValue: 'unset' };
  sync(syncEvent, 'clipboard_read_text', {});
  assert.equal(syncEvent.returnValue, harness.clipboardState.text);

  // 同步通道只放行最小命令集，其余命令即使已白名单也必须返回 null。
  const untrustedSync = { sender: { id: mainContentsId + 1 }, senderFrame: TRUSTED_FRAME, returnValue: 'unset' };
  sync(untrustedSync, 'clipboard_read_text', {});
  assert.equal(untrustedSync.returnValue, null);

  const nonSyncCommand = { sender: { id: mainContentsId }, senderFrame: TRUSTED_FRAME, returnValue: 'unset' };
  sync(nonSyncCommand, 'app_settings_get', {});
  assert.equal(nonSyncCommand.returnValue, null);

  const unsupported = { sender: { id: mainContentsId }, senderFrame: TRUSTED_FRAME, returnValue: 'unset' };
  sync(unsupported, 'evil_command', {});
  assert.equal(unsupported.returnValue, null);

  assert.deepEqual(harness.backendInvokeCalls, [], 'clipboard commands must not reach the backend');
});
