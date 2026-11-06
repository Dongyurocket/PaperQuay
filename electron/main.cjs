const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { createBackend } = require('./backend.cjs');
const { createAppPaths } = require('./backend/libraryStore.cjs');
const { perfMark, perfMeasure } = require('./perfTrace.cjs');
const { removeDesktopRunMarker, writeDesktopRunMarker } = require('./backend/desktopRunMarker.cjs');
const {
  registerLocalPdfProtocol,
  registerLocalPdfProtocolScheme,
} = require('./localPdfProtocol.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const RESTORE_RESUME_ARGUMENT = '--paperquay-restore-resume';
const isRestoreResume = process.argv.includes(RESTORE_RESUME_ARGUMENT);
let backend = null;
let desktopMarkerDataDir = null;
let rendererRestorePayload = null;
let restoreResumeLockFile = null;
let singleInstanceLockAcquired = false;

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    return null;
  }
}

function acquireRestoreResumeLock() {
  const lockFile = path.join(app.getPath('userData'), 'PaperQuay-restore-resume.lock');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockFile, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8');
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      return lockFile;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner = null;
      let modifiedAt = 0;
      try {
        owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        modifiedAt = fs.statSync(lockFile).mtimeMs;
      } catch {}
      const alive = processIsAlive(Number(owner?.pid));
      if (alive === true || (alive === null && Date.now() - modifiedAt < 24 * 60 * 60 * 1000)) {
        throw new Error('Another restore-resume process is active');
      }
      fs.rmSync(lockFile, { force: true });
    }
  }
  throw new Error('Could not acquire restore-resume lock');
}

function releaseRestoreResumeLock() {
  if (!restoreResumeLockFile) return;
  try {
    const owner = JSON.parse(fs.readFileSync(restoreResumeLockFile, 'utf8'));
    if (Number(owner?.pid) === process.pid) fs.rmSync(restoreResumeLockFile, { force: true });
  } catch {}
  restoreResumeLockFile = null;
}

async function waitForSingleInstanceLock() {
  if (singleInstanceLockAcquired) return true;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (app.requestSingleInstanceLock()) {
      singleInstanceLockAcquired = true;
      return true;
    }
  }
  return false;
}

singleInstanceLockAcquired = app.requestSingleInstanceLock();
if (isRestoreResume) {
  try {
    restoreResumeLockFile = acquireRestoreResumeLock();
  } catch (error) {
    dialog.showErrorBox('PaperQuay restore failed', String(error?.message || 'Restore is already running.'));
    app.quit();
  }
} else if (!singleInstanceLockAcquired) {
  app.quit();
}

registerLocalPdfProtocolScheme();

function getBackend() {
  if (!backend) {
    backend = createBackend({ app });
  }

  return backend;
}

function getAppIconPath() {
  const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconRoot = app.isPackaged ? 'dist' : 'public';

  return path.join(__dirname, '..', iconRoot, iconFileName);
}

function shouldIgnoreRendererConsoleMessage(level, message) {
  return (
    level === 'info' &&
    /^Warning: (Bad value, for custom key|TT: undefined function)/.test(message)
  );
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    title: 'PaperQuay',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    icon: getAppIconPath(),
    backgroundColor: '#eef2f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    perfMark('window:ready-to-show');
    perfMeasure('startup:window-visible', 'app:ready');
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', (event) => {
      const message = String(event.message ?? '');

      if (shouldIgnoreRendererConsoleMessage(event.level, message)) {
        return;
      }

      const source = event.sourceId ? `${event.sourceId}:${event.lineNumber}` : `line ${event.lineNumber ?? '?'}`;
      console.log(`[renderer:${event.level ?? 'info'}] ${message} (${source})`);
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] process gone', details);
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[renderer] failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedDevUrl = isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL);
    const allowedFileUrl = !isDev && url.startsWith('file://');

    if (allowedDevUrl || allowedFileUrl) {
      return;
    }

    event.preventDefault();

    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('paperquay:invoke', async (event, command, args) => {
  return getBackend().invoke(command, args ?? {}, event);
});

ipcMain.handle('paperquay:window-control', (event, action) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);

  if (!targetWindow) {
    return;
  }

  if (action === 'minimize') {
    targetWindow.minimize();
    return;
  }

  if (action === 'toggleMaximize') {
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
    return;
  }

  if (action === 'close') {
    targetWindow.close();
  }
});

ipcMain.on('paperquay:renderer-restore-sync', (event) => {
  event.returnValue = rendererRestorePayload;
});

ipcMain.on('paperquay:renderer-restore-ack', (_event, payload) => {
  if (!rendererRestorePayload || payload?.restoreId !== rendererRestorePayload.restoreId) return;
  try {
    Promise.resolve(require('./backend/backupImport.cjs').handleRendererRestoreAck(
      createAppPaths(app),
      payload,
    )).then((result) => {
      if (result?.ok !== false) rendererRestorePayload = null;
    }).catch((error) => {
      console.error('[paperquay] Failed to persist renderer restore acknowledgement.', error);
    });
  } catch (error) {
    console.error('[paperquay] Failed to persist renderer restore acknowledgement.', error);
  }
});

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

app.whenReady().then(async () => {
  perfMark('app:ready');

  if (process.platform === 'win32') {
    app.setAppUserModelId('dev.paperquay.app');
  }

  if (isRestoreResume && !await waitForSingleInstanceLock()) {
    dialog.showErrorBox('PaperQuay restore could not start', 'The previous instance is still closing. pending.json was kept; launch PaperQuay again to resume recovery.');
    releaseRestoreResumeLock();
    app.exit(1);
    return;
  }
  if (!singleInstanceLockAcquired) {
    app.quit();
    return;
  }

  registerLocalPdfProtocol();
  let initializedBackend;
  try {
    const appPaths = createAppPaths(app);
    writeDesktopRunMarker(appPaths.dataDir);
    desktopMarkerDataDir = appPaths.dataDir;

    const backupImport = require('./backend/backupImport.cjs');
    const restoreResult = await backupImport.applyPendingBackupRestore(appPaths, { app, dialog });
    if (restoreResult?.error) {
      throw Object.assign(new Error('A pending backup restore record is invalid. Local data was not opened; inspect PaperQuay-restore/pending.error.json.'), { code: 'PENDING_CHECKSUM_INVALID' });
    }
    await backupImport.cleanupOrphanBackupImports(appPaths);
    await require('./backend/backupExport.cjs').cleanupOrphanBackupStages(appPaths);
    if (restoreResult?.rendererRestorePayload) {
      rendererRestorePayload = restoreResult.rendererRestorePayload;
    } else if (typeof backupImport.getRendererRestorePayload === 'function') {
      rendererRestorePayload = backupImport.getRendererRestorePayload(appPaths);
    }
    if (restoreResult?.dataDir) {
      desktopMarkerDataDir = restoreResult.dataDir;
      writeDesktopRunMarker(desktopMarkerDataDir);
    } else {
      writeDesktopRunMarker(appPaths.dataDir);
    }

    initializedBackend = getBackend();
  } catch (error) {
    console.error('[paperquay] Failed to apply pending backup restore or initialize stores.', error);
    if (!['RESTORE_APPLY_FAILED', 'STAGING_MISSING', 'PENDING_CHECKSUM_INVALID'].includes(error?.code)) {
      dialog.showErrorBox('PaperQuay startup failed', error.message || 'PaperQuay could not initialize its local data stores.');
    }
    backend?.close();
    if (desktopMarkerDataDir) {
      removeDesktopRunMarker(desktopMarkerDataDir);
      desktopMarkerDataDir = null;
    }
    releaseRestoreResumeLock();
    app.exit(1);
    return;
  }
  perfMark('backend:ready');
  perfMeasure('startup:backend-init', 'app:ready');
  createWindow();
  perfMark('window:created');
  perfMeasure('startup:window-created', 'app:ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Keep the advisory run state through synchronous store shutdown so MCP writes
  // cannot enter between the window closing and backend resource teardown.
  backend?.close();
  if (desktopMarkerDataDir) {
    removeDesktopRunMarker(desktopMarkerDataDir);
    desktopMarkerDataDir = null;
  }
  releaseRestoreResumeLock();
  // 兜底：后端资源（如 RAG worker 线程卡在同步 SQLite 调用里）关闭耗时过长时，
  // 3 秒后强制退出，避免留下无窗口的驻留进程，导致覆盖安装被误判为"正在运行"。
  setTimeout(() => app.exit(0), 3000).unref();
});
