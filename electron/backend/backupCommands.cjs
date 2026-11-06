const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runBackupExport, estimateBackupSources, readBackupHistory } = require('./backupExport.cjs');

const PROGRESS_EVENT = 'paperquay://backup-progress';
const ERROR_MESSAGES = {
  BACKUP_BUSY: '另一个备份或恢复任务正在进行，请稍候。',
  APP_RUNNING: '请关闭其他 PaperQuay 实例和使用文库的外部 Agent 后重试。',
  INVALID_PACKAGE: '不是有效的 PaperQuay 备份包。',
  WRONG_PASSWORD_OR_CORRUPT: '密码错误或备份包已损坏。',
  UNSUPPORTED_VERSION: '备份包需要更新版本的 PaperQuay，请先升级。',
  UNSAFE_ENTRY_PATH: '备份包包含不安全路径，已拒绝导入。',
  CHECKSUM_MISMATCH: '备份包校验失败，未修改本机数据。',
  DB_INTEGRITY_FAILED: '备份包内数据库损坏。',
  DISK_FULL: '可用磁盘空间不足，请更换目标位置或释放空间。',
  TARGET_NOT_WRITABLE: '目标目录不可写，请重新选择。',
  CANCELLED: '操作已取消，未修改本机数据。',
  STAGING_MISSING: '恢复暂存数据缺失，请重新导入备份包。',
  RESTORE_APPLY_FAILED: '恢复失败，已尝试回滚到导入前数据。',
  RESTORE_LOCK_CONFLICT: '恢复已暂存，但应用未能自动重启；请手动启动 PaperQuay。',
  BACKUP_DESTINATION_EXISTS: '目标文件已存在，请选择新的文件名。',
  INVALID_DESTINATION: '备份文件不能保存在 PaperQuay 数据或源目录中。',
  UNSAFE_DESTINATION: '恢复目录不安全：不能位于 PaperQuay 数据目录、旧文献库、MinerU 缓存或笔记 Vault 内，目标目录本身也不能是链接。请改选一个新的空目录。',
  INVALID_PASSWORD: '请输入有效的备份密码。',
};

function publicError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'BACKUP_OPERATION_FAILED';
  const message = ERROR_MESSAGES[code] || '备份操作失败，请检查磁盘空间和目标目录后重试。';
  return Object.assign(new Error(message), { code });
}

function normalizePath(value) {
  return typeof value === 'string' && value.trim() ? path.resolve(value) : '';
}

function emitProgress(sender, payload) {
  try {
    sender?.send('paperquay:event', PROGRESS_EVENT, payload);
  } catch {}
}

function safeName(value) {
  return path.basename(String(value || '')).slice(0, 180);
}

function createBackupCommands(context) {
  const electron = context.electron || require('electron');
  const dialog = context.dialog || electron.dialog;
  const shell = context.shell || electron.shell;
  const BrowserWindow = context.BrowserWindow || electron.BrowserWindow;
  const importer = context.backupImport || require('./backupImport.cjs');
  const exportRunner = context.backupExport || runBackupExport;
  const sourceEstimator = context.backupEstimate || estimateBackupSources;
  let activeTask = null;
  let estimateCache = null;

  function ownerWindow(event) {
    try {
      return BrowserWindow?.fromWebContents?.(event?.sender) || undefined;
    } catch {
      return undefined;
    }
  }

  async function withTask(type, action) {
    if (activeTask) throw Object.assign(new Error(ERROR_MESSAGES.BACKUP_BUSY), { code: 'BACKUP_BUSY' });
    const controller = new AbortController();
    activeTask = { type, controller };
    try {
      return await action(controller.signal);
    } finally {
      activeTask = null;
    }
  }

  function restartAfterRestore() {
    if (!context.app || typeof context.app.relaunch !== 'function') return;
    setTimeout(() => {
      try {
        context.app.releaseSingleInstanceLock?.();
        context.app.relaunch({ args: [...process.argv.slice(1), '--paperquay-restore-resume'] });
        context.app.exit(0);
      } catch {
        // pending.json remains for the next manual launch to resume.
      }
    }, 500);
  }

  async function choosePath(kind, event) {
    const window = ownerWindow(event);
    if (kind === 'destination') {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
      const result = await dialog.showSaveDialog(window, {
        title: 'Save PaperQuay backup',
        defaultPath: path.join(context.app?.getPath?.('documents') || context.appPaths.dataDir, `PaperQuay-Backup-${stamp}.pqbackup`),
        filters: [{ name: 'PaperQuay backup', extensions: ['pqbackup'] }],
      });
      return result.canceled ? null : result.filePath || null;
    }
    if (kind === 'package') {
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        filters: [{ name: 'PaperQuay backup', extensions: ['pqbackup'] }],
      });
      return result.canceled ? null : result.filePaths?.[0] || null;
    }
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths?.[0] || null;
  }

  function statusSnapshot() {
    const history = readBackupHistory(context.appPaths);
    let restore = {};
    try {
      restore = importer.getBackupStatus(context) || {};
    } catch {}
    const mergedHistory = Array.isArray(restore.history) && restore.history.length
      ? restore.history.slice(0, 5)
      : history.slice(0, 5);
    return {
      pendingRestore: Boolean(restore.pendingRestore),
      lastExport: restore.lastExport || history.find((entry) => entry.type === 'export') || null,
      lastRestore: restore.lastRestore || mergedHistory.find((entry) => entry.direction === 'import' || entry.direction === 'rollback' || entry.type === 'import' || entry.type === 'rollback') || null,
      history: mergedHistory,
      oldDataDirs: Array.isArray(restore.oldDataDirs) ? restore.oldDataDirs : [],
      oldDataDirDetails: Array.isArray(restore.oldDataDirDetails) ? restore.oldDataDirDetails : [],
    };
  }

  function canOpenPath(value) {
    const normalized = normalizePath(value);
    if (!normalized) return false;
    const status = statusSnapshot();
    const allowedFiles = status.history.map((item) => normalizePath(item.packagePath)).filter(Boolean);
    const allowedDirs = status.oldDataDirs.map(normalizePath).filter(Boolean);
    return allowedFiles.includes(normalized) || allowedDirs.includes(normalized);
  }

  function estimateFingerprint(options, rendererState) {
    const rootPaths = [context.appPaths.dataDir];
    try {
      const library = context.store.load();
      const config = JSON.parse(fs.readFileSync(context.appPaths.configPath, 'utf8'));
      rootPaths.push(library.settings?.storageDir, library.settings?.translatedPdfDir, library.settings?.notesVaultDir);
      rootPaths.push(config.settings?.mineruCacheDir, context.appPaths.mineruCacheDir);
    } catch {}
    const stats = rootPaths.filter(Boolean).map((root) => {
      try {
        const stat = fs.statSync(root);
        return [path.resolve(root), stat.mtimeMs, stat.size];
      } catch {
        return [path.resolve(root), 0, 0];
      }
    });
    const stateHash = crypto.createHash('sha256').update(JSON.stringify(rendererState || {})).digest('hex');
    return JSON.stringify([options, stats, stateHash]);
  }

  async function getEstimate(args = {}) {
    const options = args.options || {};
    const rendererState = args.rendererState || {};
    const key = estimateFingerprint(options, rendererState);
    if (estimateCache?.key === key && Date.now() - estimateCache.at < 60_000) {
      return { ...estimateCache.value, cached: true };
    }
    const result = await sourceEstimator(context, { options, rendererState });
    const value = {
      entries: result.entries,
      totalBytes: result.totalBytes,
      warnings: result.warnings,
      warningsTruncated: result.warningsTruncated,
      counts: result.counts,
      breakdown: result.breakdown,
      options: result.options,
      cached: false,
    };
    estimateCache = { key, at: Date.now(), value };
    return value;
  }

  return {
    async backup_select_destination(_args, event) {
      return choosePath('destination', event);
    },

    async backup_select_package(_args, event) {
      return choosePath('package', event);
    },

    async backup_select_library_dir(_args, event) {
      return choosePath('directory', event);
    },

    async backup_select_vault_dir(_args, event) {
      return choosePath('directory', event);
    },

    async backup_export_estimate(args) {
      try {
        return await getEstimate(args);
      } catch (error) {
        throw publicError(error);
      }
    },

    async backup_export_start(args, event) {
      return withTask('export', async (signal) => {
        try {
          return await exportRunner(context, {
            destinationPath: args?.destinationPath,
            password: args?.password,
            options: args?.options,
            rendererState: args?.rendererState || {},
            signal,
            onProgress: (payload) => emitProgress(event?.sender, payload),
          });
        } catch (error) {
          throw publicError(error);
        }
      });
    },

    async backup_export_cancel() {
      if (!activeTask || !['export', 'import'].includes(activeTask.type)) return { cancelled: false };
      activeTask.controller.abort();
      return { cancelled: true };
    },

    async backup_import_inspect(args) {
      return withTask('inspect', async (signal) => {
        try {
          return await importer.inspectBackupPackage({
            packagePath: args?.packagePath,
            password: args?.password,
            signal,
          });
        } catch (error) {
          throw publicError(error);
        }
      });
    },

    async backup_import_stage(args, event) {
      const result = await withTask('import', async (signal) => {
        try {
          return await importer.stageBackupImport(context, {
            packagePath: args?.packagePath,
            password: args?.password,
            targets: args?.targets || {},
            currentRendererState: args?.currentRendererState || {},
            signal,
            onProgress: (payload) => emitProgress(event?.sender, { direction: 'import', ...payload }),
          });
        } catch (error) {
          throw publicError(error);
        }
      });
      if (result?.restartRequired) restartAfterRestore();
      return result;
    },

    async backup_get_status() {
      return statusSnapshot();
    },

    async backup_delete_old_data(args) {
      return withTask('delete', async () => {
        try {
          return await importer.deleteOldData(context, { path: normalizePath(args?.path) });
        } catch (error) {
          throw publicError(error);
        }
      });
    },

    async backup_rollback_prepare(args) {
      const result = await withTask('rollback', async (signal) => {
        try {
          return await importer.prepareRollback(context, {
            oldDataDir: normalizePath(args?.oldDataDir),
            currentRendererState: args?.currentRendererState || {},
            signal,
          });
        } catch (error) {
          throw publicError(error);
        }
      });
      if (result?.restartRequired) restartAfterRestore();
      return result;
    },

    async backup_open_path(args) {
      const target = normalizePath(args?.path);
      if (!canOpenPath(target)) throw Object.assign(new Error('Path is not available in backup history'), { code: 'INVALID_DESTINATION' });
      if (fs.existsSync(target)) {
        shell.showItemInFolder(target);
        return { ok: true };
      }
      return { ok: false };
    },
  };
}

module.exports = { BACKUP_PROGRESS_EVENT: PROGRESS_EVENT, createBackupCommands, publicError };
