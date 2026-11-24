const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog, session, clipboard } = require('electron');
const { createBackend } = require('./backend.cjs');
const { createAppPaths } = require('./backend/libraryStore.cjs');
const {
  MAX_CLIPBOARD_TEXT_LENGTH,
  SYNCHRONOUS_RENDERER_COMMANDS,
  isRendererCommandAllowed,
} = require('./ipcAllowlist.cjs');
const { createIpcSenderGuard, isTrustedRendererNavigation } = require('./ipcSecurity.cjs');
const {
  installContentSecurityPolicy,
  installPermissionHandlers,
} = require('./appSecurity.cjs');
const {
  createRendererFailureController,
  createStartupFailureHandler,
  loadRendererEntry,
  showPendingRestoreError,
} = require('./appLifecycle.cjs');
const { perfMark, perfMeasure } = require('./perfTrace.cjs');
const { removeDesktopRunMarker, writeDesktopRunMarker } = require('./backend/desktopRunMarker.cjs');
const { createExternalWriteWatcher } = require('./backend/externalWriteWatch.cjs');
const {
  registerLocalPdfProtocol,
  registerLocalPdfProtocolScheme,
} = require('./localPdfProtocol.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const RESTORE_RESUME_ARGUMENT = '--paperquay-restore-resume';
const isRestoreResume = process.argv.includes(RESTORE_RESUME_ARGUMENT);
let backend = null;
let desktopMarkerDataDir = null;
let externalWriteWatcher = null;
let rendererRestorePayload = null;
let restoreResumeLockFile = null;
let singleInstanceLockAcquired = false;
let mainWindowContentsId = null;

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

/** 启动/渲染失败时的统一清理：关闭后端、移除运行标记、释放恢复锁。 */
function cleanupApplicationResources() {
  try {
    backend?.close();
  } catch (error) {
    console.warn('[paperquay] Backend close failed during failure cleanup.', error);
  }
  backend = null;

  if (desktopMarkerDataDir) {
    try {
      removeDesktopRunMarker(desktopMarkerDataDir);
    } catch (error) {
      console.warn('[paperquay] Failed to remove the desktop run marker.', error);
    }
    desktopMarkerDataDir = null;
  }

  releaseRestoreResumeLock();
}

const handleFatalStartupError = createStartupFailureHandler({
  dialog,
  app,
  cleanup: cleanupApplicationResources,
});

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

const assertTrustedIpcSender = createIpcSenderGuard({
  isDev,
  devServerUrl: process.env.VITE_DEV_SERVER_URL,
  appDir: __dirname,
});

/**
 * preload 在文档提交前执行 restore-sync，此时 senderFrame.url 可能还是空；
 * 对这类启动期同步 IPC 只校验 WebContents 确实属于应用主窗口。
 */
function assertTrustedIpcWebContents(event) {
  if (!mainWindowContentsId || event?.sender?.id !== mainWindowContentsId) {
    throw new Error('Blocked IPC from an untrusted window.');
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 720,
    title: 'PaperQuay',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    icon: getAppIconPath(),
    backgroundColor: '#eef2f8',
    show: false,
    webPreferences: {
      // sandbox preload 不能 require 本地模块；dev/build 先把 preload 及其
      // 依赖打成 preload.bundle.cjs（scripts/bundle-preload.cjs）。
      preload: path.join(__dirname, 'preload.bundle.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    perfMark('window:ready-to-show');
    perfMeasure('startup:window-visible', 'app:ready');
    mainWindow.show();
  });

  mainWindowContentsId = mainWindow.webContents.id;

  if (isDev) {
    mainWindow.webContents.on('console-message', (event) => {
      const message = String(event.message ?? '');

      if (shouldIgnoreRendererConsoleMessage(event.level, message)) {
        return;
      }

      const source = event.sourceId ? `${event.sourceId}:${event.lineNumber}` : `line ${event.lineNumber ?? '?'}`;
      console.log(`[renderer:${event.level ?? 'info'}] ${message} (${source})`);
    });
  }

  const failureController = createRendererFailureController({
    log: console.error,
    showErrorBox: (title, content) => dialog.showErrorBox(title, content),
    showRecoveryDialog: async (details) => {
      const detail = `Reason: ${details?.reason || 'unknown'}${details?.exitCode != null ? ` (exit code ${details.exitCode})` : ''}`;
      const options = {
        type: 'error',
        title: 'PaperQuay window stopped',
        message: 'The PaperQuay window stopped unexpectedly.',
        detail,
        buttons: ['Reload window', 'Quit PaperQuay'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      const result = mainWindow.isDestroyed()
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(mainWindow, options);

      return result.response === 0 ? 'reload' : 'quit';
    },
    cleanup: cleanupApplicationResources,
    exit: (code) => app.exit(code),
    reload: () => {
      if (!mainWindow.isDestroyed()) mainWindow.reload();
    },
  });

  // 生产版同样要可见：渲染器崩溃或入口加载失败时不能只留一个隐藏窗口。
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    if (quitInProgress || quitFinished) return;
    void failureController.handleRenderProcessGone(event, details);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (quitInProgress || quitFinished) return;
    failureController.handleDidFailLoad(event, errorCode, errorDescription, validatedUrl, isMainFrame);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 生产版只允许 dist/index.html 自身文档；任意 file:// 页面会带着 preload
    // 暴露的 clipboard/listen 等能力在主窗口运行，等同 UI 劫持。
    const trustedOptions = {
      isDev,
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
      appDir: __dirname,
    };

    if (isTrustedRendererNavigation(url, trustedOptions)) {
      return;
    }

    event.preventDefault();

    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  loadRendererEntry(mainWindow.webContents, {
    isDev,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    entryFile: path.join(__dirname, '..', 'dist', 'index.html'),
  }).catch((error) => {
    if (quitInProgress || quitFinished) return;
    failureController.handleLoadRejection(error);
  });
}

/**
 * sandbox:true 的 preload 无法 require clipboard；剪贴板读写统一由主进程执行。
 * 文本只接受字符串并限制长度，避免渲染层把超大字符串塞进主进程或系统剪贴板。
 */
const MAIN_PROCESS_RENDERER_COMMANDS = new Set([
  'clipboard_read_text',
  'clipboard_write_text',
]);

function readClipboardText() {
  try {
    const text = clipboard.readText();
    return typeof text === 'string' ? text.slice(0, MAX_CLIPBOARD_TEXT_LENGTH) : '';
  } catch {
    return '';
  }
}

function writeClipboardText(args) {
  const text = args?.text;
  if (typeof text !== 'string') {
    throw new Error('IPC_INVALID_ARGS: clipboard_write_text: args.text: expected string');
  }
  clipboard.writeText(text.slice(0, MAX_CLIPBOARD_TEXT_LENGTH));
  return { ok: true };
}

function runMainProcessRendererCommand(command, args) {
  if (command === 'clipboard_read_text') return readClipboardText();
  if (command === 'clipboard_write_text') return writeClipboardText(args);
  throw new Error(`Unsupported main-process command: ${String(command)}`);
}

ipcMain.handle('paperquay:invoke', async (event, command, args) => {
  assertTrustedIpcWebContents(event);
  assertTrustedIpcSender(event);

  if (!isRendererCommandAllowed(command)) {
    throw new Error(`Unsupported Electron command: ${String(command)}`);
  }

  if (MAIN_PROCESS_RENDERER_COMMANDS.has(command)) {
    return runMainProcessRendererCommand(command, args ?? {});
  }

  return getBackend().invoke(command, args ?? {}, event);
});

// preload 需要同步取值时使用（当前只有剪贴板读取）。通道只放行白名单里的
// 同步子集，其余命令即使已登记也返回 null，避免把异步后端命令搬到阻塞通道上。
ipcMain.on('paperquay:invoke-sync', (event, command, args) => {
  try {
    assertTrustedIpcWebContents(event);
    assertTrustedIpcSender(event);
    if (!isRendererCommandAllowed(command) || !SYNCHRONOUS_RENDERER_COMMANDS.has(command)) {
      event.returnValue = null;
      return;
    }
    event.returnValue = runMainProcessRendererCommand(command, args ?? {});
  } catch {
    event.returnValue = null;
  }
});

ipcMain.handle('paperquay:window-control', (event, action) => {
  assertTrustedIpcWebContents(event);
  assertTrustedIpcSender(event);
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
  try {
    assertTrustedIpcWebContents(event);
    event.returnValue = rendererRestorePayload;
  } catch {
    event.returnValue = null;
  }
});

ipcMain.on('paperquay:renderer-restore-ack', (event, payload) => {
  try {
    assertTrustedIpcWebContents(event);
  } catch {
    return;
  }
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

// 仅供 preload 在真实文件拖放后登记读权限；不通过 contextBridge 暴露。
ipcMain.on('paperquay:approve-read-paths', (event, paths) => {
  try {
    assertTrustedIpcWebContents(event);
  } catch {
    return;
  }
  if (!Array.isArray(paths)) return;
  const backendInstance = getBackend();
  for (const candidate of paths.slice(0, 100)) {
    if (typeof candidate === 'string' && candidate) {
      try {
        backendInstance.approveReadPath(candidate);
      } catch {}
    }
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

  // CSP 同时以 index.html meta 与主文档响应头下发：file:// 文档不会被
  // webRequest 拦截，meta 是生产版的实际执行路径。权限请求默认拒绝，
  // 只放行主窗口的剪贴板读写。
  installContentSecurityPolicy(session.defaultSession, {
    isDev,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
  });
  installPermissionHandlers(session.defaultSession, {
    isTrustedWebContents: (webContents) =>
      Boolean(mainWindowContentsId) && webContents?.id === mainWindowContentsId,
  });

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

  registerLocalPdfProtocol({
    isPdfPathAllowed(filePath) {
      try {
        return getBackend().pathPolicy.isPdfPathAllowed(filePath);
      } catch {
        return false;
      }
    },
  });
  try {
    const appPaths = createAppPaths(app);
    writeDesktopRunMarker(appPaths.dataDir);
    desktopMarkerDataDir = appPaths.dataDir;

    const backupImport = require('./backend/backupImport.cjs');
    const restoreResult = await backupImport.applyPendingBackupRestore(appPaths, { app, dialog });
    if (restoreResult?.error) {
      throw Object.assign(new Error('A pending backup restore record is invalid. Local data was not opened; inspect PaperQuay-restore/pending.error.json.'), { code: 'PENDING_CHECKSUM_INVALID' });
    }
    try {
      await backupImport.repairRestoredBackupPaths(appPaths);
    } catch (error) {
      console.error('[paperquay] Failed to repair paths left by an earlier backup restore.', error);
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

    getBackend();
  } catch (error) {
    console.error('[paperquay] Failed to apply pending backup restore or initialize stores.', error);
    if (error?.code === 'PENDING_CHECKSUM_INVALID') {
      showPendingRestoreError(dialog);
    } else if (!['RESTORE_APPLY_FAILED', 'STAGING_MISSING'].includes(error?.code)) {
      dialog.showErrorBox('PaperQuay startup failed', error.message || 'PaperQuay could not initialize its local data stores.');
    }
    cleanupApplicationResources();
    app.exit(1);
    return;
  }
  perfMark('backend:ready');
  perfMeasure('startup:backend-init', 'app:ready');

  if (desktopMarkerDataDir) {
    externalWriteWatcher = createExternalWriteWatcher({
      dataDir: desktopMarkerDataDir,
      onChange: (payload) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed()) continue;
          window.webContents.send('paperquay:event', 'paperquay://external-write', payload);
        }
      },
    });
  }

  createWindow();
  perfMark('window:created');
  perfMeasure('startup:window-created', 'app:ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  // whenReady 链上的未预期异常（协议注册、窗口创建、入口加载等）必须可见地退出，
  // 否则会留下无窗口的后台进程或永不显示的隐藏窗口。
  handleFatalStartupError(error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let quitInProgress = false;
let quitFinished = false;

app.on('before-quit', (event) => {
  if (quitFinished) return;
  // Delay the quit until the queued note index work drains (bounded below).
  event.preventDefault();
  if (quitInProgress) return;
  quitInProgress = true;

  // Keep the advisory run state through store shutdown so MCP writes cannot
  // enter while the note index queue is still draining or stores are closing.
  externalWriteWatcher?.close();
  externalWriteWatcher = null;

  const finish = () => {
    if (quitFinished) return;
    quitFinished = true;
    clearTimeout(forceExitTimer);
    try {
      backend?.close();
    } catch (error) {
      console.warn('[paperquay] Backend close failed during quit.', error);
    }
    if (desktopMarkerDataDir) {
      removeDesktopRunMarker(desktopMarkerDataDir);
      desktopMarkerDataDir = null;
    }
    releaseRestoreResumeLock();
    app.exit(0);
  };

  // 兜底：后端资源（如 RAG worker 线程卡在同步 SQLite 调用里）关闭耗时过长、
  // 或笔记索引队列迟迟不排空时，3 秒后强制退出，避免留下无窗口的驻留进程，
  // 导致覆盖安装被误判为"正在运行"。
  const forceExitTimer = setTimeout(finish, 3000);
  forceExitTimer.unref?.();

  if (backend && typeof backend.shutdown === 'function') {
    Promise.resolve(backend.shutdown({ timeoutMs: 2500 }))
      .then((result) => {
        if (result?.timedOut) {
          console.warn('[paperquay] Note index queue did not drain before quit.', result);
        }
        if (result?.ragStoreCloseTimedOut) {
          console.warn('[paperquay] RAG store/worker did not close before quit.', result);
        }
      })
      .catch((error) => {
        console.warn('[paperquay] Graceful backend shutdown failed.', error);
      })
      .finally(finish);
  } else {
    finish();
  }
});
