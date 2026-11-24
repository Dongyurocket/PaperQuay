/**
 * 启动与渲染进程失败处理。
 *
 * 主进程的启动链（whenReady → 初始化 → 创建窗口 → loadURL/loadFile）过去是
 * fire-and-forget：入口文件缺失、Vite dev server 未启动或渲染器崩溃时，窗口
 * 会一直隐藏或留下无窗口的驻留进程，用户只看到白屏。这里把「可读错误 +
 * 清理后端 + 退出」和「崩溃后重载/退出」收敛成可测试的控制器，由 main.cjs
 * 只负责接线。
 */

const FATAL_EXIT_CODE = 1;
const PENDING_RESTORE_ERROR_TITLE = 'PaperQuay restore could not be completed';
const PENDING_RESTORE_ERROR_MESSAGE = [
  'A pending backup restore record is invalid or damaged. PaperQuay did not open your library.',
  'The invalid record was moved to PaperQuay-restore/pending.error.json; inspect or remove it, then start PaperQuay again.',
].join(' ');

function showPendingRestoreError(dialog) {
  try {
    dialog?.showErrorBox?.(PENDING_RESTORE_ERROR_TITLE, PENDING_RESTORE_ERROR_MESSAGE);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error) {
  const raw = typeof error === 'string' ? error : error?.message;
  const message = typeof raw === 'string' ? raw.trim() : '';
  return message || 'Unknown error.';
}

function describeStartupFailure(error) {
  return [
    'PaperQuay could not start.',
    '',
    errorMessage(error),
    '',
    'Your local data was not opened. If the problem persists, inspect the PaperQuay data directory and application log.',
  ].join('\n');
}

function createStartupFailureHandler({
  dialog,
  app,
  cleanup = () => {},
  log = console.error,
} = {}) {
  let handled = false;

  return function handleStartupFailure(error) {
    if (handled) return false;
    handled = true;

    try {
      log('[paperquay] Fatal startup failure', error);
    } catch {}

    try {
      dialog?.showErrorBox?.('PaperQuay startup failed', describeStartupFailure(error));
    } catch (dialogError) {
      try {
        log('[paperquay] Could not show the startup error dialog.', dialogError);
      } catch {}
    }

    try {
      cleanup();
    } catch (cleanupError) {
      try {
        log('[paperquay] Startup cleanup failed.', cleanupError);
      } catch {}
    }

    try {
      app?.exit?.(FATAL_EXIT_CODE);
    } catch {}

    return true;
  };
}

function loadRendererEntry(webContents, { isDev, devServerUrl, entryFile }) {
  return Promise.resolve().then(() =>
    isDev ? webContents.loadURL(devServerUrl) : webContents.loadFile(entryFile),
  );
}

function describeRendererFailure(kind, details = {}) {
  switch (kind) {
    case 'did-fail-load':
      return [
        'PaperQuay could not load its application window.',
        '',
        `${details.errorDescription || 'Unknown load error'} (${details.errorCode ?? 'unknown'})`,
        details.validatedUrl ? String(details.validatedUrl) : '',
        '',
        'The application will close. Start PaperQuay again.',
      ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n');
    case 'load-rejected':
      return [
        'PaperQuay could not load its application window.',
        '',
        errorMessage(details.error),
        '',
        'The application will close. Start PaperQuay again.',
      ].join('\n');
    case 'render-process-gone':
      return [
        'The PaperQuay window stopped unexpectedly.',
        '',
        `Reason: ${details.reason || 'unknown'}${details.exitCode != null ? ` (exit code ${details.exitCode})` : ''}`,
        '',
        'The application will close. Any unsaved changes in the window may be lost.',
      ].join('\n');
    default:
      return `PaperQuay window failure: ${errorMessage(details.error ?? details)}`;
  }
}

function createRendererFailureController({
  log = console.error,
  showErrorBox,
  showRecoveryDialog,
  cleanup = () => {},
  exit = () => {},
  reload = () => {},
} = {}) {
  let fatalReported = false;
  let recoveryPending = false;

  function reportFatal(kind, details) {
    if (fatalReported) return false;
    fatalReported = true;

    try {
      log(`[renderer] ${kind}`, details);
    } catch {}

    try {
      showErrorBox?.('PaperQuay window failed', describeRendererFailure(kind, details));
    } catch (dialogError) {
      try {
        log('[paperquay] Could not show the window error dialog.', dialogError);
      } catch {}
    }

    try {
      cleanup();
    } catch (cleanupError) {
      try {
        log('[paperquay] Window failure cleanup failed.', cleanupError);
      } catch {}
    }

    try {
      exit(FATAL_EXIT_CODE);
    } catch {}

    return true;
  }

  return {
    handleLoadRejection(error) {
      return reportFatal('load-rejected', { error });
    },

    handleDidFailLoad(_event, errorCode, errorDescription, validatedUrl, isMainFrame) {
      if (isMainFrame === false) return false;
      // ERR_ABORTED：导航被新的导航/关闭动作取消，不是可报告的加载失败。
      if (errorCode === -3) return false;
      return reportFatal('did-fail-load', { errorCode, errorDescription, validatedUrl });
    },

    async handleRenderProcessGone(_event, details = {}) {
      try {
        log('[renderer] process gone', details);
      } catch {}

      if (details?.reason === 'clean-exit') return;
      if (fatalReported || recoveryPending) return;

      recoveryPending = true;
      let action = 'quit';

      try {
        if (typeof showRecoveryDialog === 'function') {
          action = await showRecoveryDialog(details);
        }
      } catch (dialogError) {
        try {
          log('[paperquay] Could not show the renderer recovery dialog.', dialogError);
        } catch {}
      } finally {
        recoveryPending = false;
      }

      if (action === 'reload') {
        try {
          reload();
        } catch (reloadError) {
          reportFatal('reload-failed', { error: reloadError });
        }
        return;
      }

      reportFatal('render-process-gone', details);
    },
  };
}

module.exports = {
  FATAL_EXIT_CODE,
  PENDING_RESTORE_ERROR_MESSAGE,
  PENDING_RESTORE_ERROR_TITLE,
  createRendererFailureController,
  createStartupFailureHandler,
  describeRendererFailure,
  describeStartupFailure,
  loadRendererEntry,
  showPendingRestoreError,
};
