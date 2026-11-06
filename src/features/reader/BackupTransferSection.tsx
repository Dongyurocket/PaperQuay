import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { ConfirmDialog } from '../../ui/dialog';
import type {
  BackupExportEstimate,
  BackupExportOptions,
  BackupExportPreset,
  BackupExportResult,
  BackupHistoryRecord,
  BackupImportInspectResult,
  BackupOldDataDirectory,
  BackupProgress,
  BackupStatus,
  BackupWarning,
} from '../../types/backupPackage';
import {
  assertRendererStateWithinLimit,
  cancelBackupTask,
  captureRendererState,
  deleteBackupOldData,
  estimateBackup,
  getBackupStatus,
  listenBackupProgress,
  inspectBackupPackage,
  openBackupDestinationFolder,
  prepareBackupRollback,
  rendererStateCodeUnits,
  MAX_RENDERER_STATE_CODE_UNITS,
  selectBackupDestination,
  selectBackupLibraryDirectory,
  selectBackupPackage,
  selectBackupVaultDirectory,
  stageBackupImport,
  startBackupExport,
} from '../../services/backupPackage';
import { BackupPasswordDialog } from './BackupPasswordDialog';
import { BackupProgressPanel } from './BackupProgressPanel';
import {
  SettingsField,
  SettingsInput,
  SettingsSelect,
  ToggleRow,
} from './readerPreferencesPrimitives';
import type { ReaderPreferencesLocalizer } from './readerPreferencesTypes';

interface BackupTransferSectionProps {
  active: boolean;
  l: ReaderPreferencesLocalizer;
}

type Operation = 'export' | 'inspect' | 'stage' | 'delete' | 'rollback' | null;
type PasswordPurpose = 'export' | 'inspect' | 'stage' | null;
type Confirmation =
  | { kind: 'stage' }
  | { kind: 'rollback'; path: string }
  | { kind: 'delete'; path: string }
  | null;

const INITIAL_OPTIONS: BackupExportOptions = {
  preset: 'migration',
  includeRag: true,
  includeDerived: true,
  includeVault: true,
  includePdfs: true,
  includeRendererState: true,
  compressionLevel: 'standard',
  selfVerify: true,
};

const PRESET_OPTIONS: Record<Exclude<BackupExportPreset, 'custom'>, BackupExportOptions> = {
  migration: INITIAL_OPTIONS,
  daily: {
    preset: 'daily',
    includeRag: false,
    includeDerived: false,
    includeVault: true,
    includePdfs: true,
    includeRendererState: true,
    compressionLevel: 'fast',
    selfVerify: true,
  },
};

const COMPONENT_LABELS: Record<string, [string, string]> = {
  databases: ['数据库与配置', 'Databases and configuration'],
  pdfs: ['PDF 文件', 'PDF files'],
  rag: ['RAG 数据库', 'RAG database'],
  derived: ['解析与翻译缓存', 'Parse and translation caches'],
  vault: ['笔记 Vault', 'Notes vault'],
  rendererState: ['阅读器状态', 'Reader state'],
};

const COUNT_LABELS: Record<string, [string, string]> = {
  papers: ['文献', 'Papers'],
  attachments: ['附件', 'Attachments'],
  notes: ['笔记', 'Notes'],
  noteFolders: ['笔记文件夹', 'Note folders'],
  ragIndexes: ['RAG 索引', 'RAG indexes'],
  ragDocuments: ['RAG 文档', 'RAG documents'],
  ragChunks: ['RAG 分块', 'RAG chunks'],
  agentMemoryFiles: ['Agent 记忆文件', 'Agent memory files'],
  localStorageKeys: ['浏览器状态键', 'Browser state keys'],
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}

const WARNING_LABELS: Record<string, [string, string]> = {
  FILE_MISSING_AT_EXPORT: ['导出时文件缺失，未打包', 'File was missing at export and was not packed'],
  NOT_IN_PACKAGE: ['附件不在备份包内', 'Attachment is not in the backup package'],
  ATTACHMENT_UNRESOLVED: ['附件已打包但未能找回文件', 'Attachment was packed but its file could not be located'],
  MINERU_CACHE_CONFLICT: ['解析缓存目录重名，已保留先恢复的一份', 'Duplicate parse cache directory; the first restored copy was kept'],
};

// 附件类警告排在前面：解析缓存可能产生大量警告，不应把附件问题挤出可见范围。
const WARNING_PRIORITY = ['NOT_IN_PACKAGE', 'ATTACHMENT_UNRESOLVED', 'FILE_MISSING_AT_EXPORT'];

function sortWarningsForDisplay(warnings: Array<string | BackupWarning>): Array<string | BackupWarning> {
  const rank = (warning: string | BackupWarning) => {
    if (typeof warning === 'string') return WARNING_PRIORITY.length + 1;
    const index = WARNING_PRIORITY.indexOf(warning.code);
    if (index >= 0 && (warning.code !== 'FILE_MISSING_AT_EXPORT' || warning.kind === 'library-pdf' || warning.kind === 'translated-pdf')) return index;
    return WARNING_PRIORITY.length;
  };
  return warnings.map((warning, index) => ({ warning, index }))
    .sort((left, right) => rank(left.warning) - rank(right.warning) || left.index - right.index)
    .map((item) => item.warning);
}

function safeWarningLabel(warning: string | BackupWarning, l: ReaderPreferencesLocalizer): string {
  if (typeof warning === 'string') return l('备份包含警告项', 'The backup contains a warning item');
  const name = warning.originalName?.split(/[\\/]/).filter(Boolean).pop();
  const label = WARNING_LABELS[warning.code];
  return [label ? l(label[0], label[1]) : warning.code, warning.kind, name].filter(Boolean).join(' · ');
}

function getErrorMessage(error: unknown, fallback: string, l: ReaderPreferencesLocalizer): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : fallback;
  if (/WRONG_PASSWORD_OR_CORRUPT|wrong password|incorrect password/i.test(message)) {
    return l('密码错误或备份包已损坏。', 'Password is incorrect or the backup package is damaged.');
  }
  if (/BACKUP_BUSY/i.test(message)) {
    return l('另一个备份任务正在进行，请稍候。', 'Another backup task is running. Please wait.');
  }
  if (/APP_RUNNING/i.test(message)) {
    return l('请关闭其他 PaperQuay 窗口和正在使用文库的外部 Agent 后重试。', 'Close other PaperQuay windows and external agents using the library, then retry.');
  }
  if (/CANCELLED/i.test(message)) {
    return l('任务已取消，未修改本机数据。', 'Task cancelled. No local data was changed.');
  }
  return message || fallback;
}

function recordDate(record: BackupHistoryRecord): string {
  const value = record.completedAt ?? record.createdAt;
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function recordPath(record: BackupHistoryRecord): string {
  return record.packagePath ?? record.path ?? '';
}

function isFailedRecord(record: BackupHistoryRecord): boolean {
  return record.result === 'failed' || record.result === 'cancelled';
}

function initialCustomOptions(current: BackupExportOptions): BackupExportOptions {
  return { ...current, preset: 'custom' };
}

function oldDataList(status: BackupStatus | null): BackupOldDataDirectory[] {
  if (!status) return [];
  const details = new Map((status.oldDataDirDetails ?? []).map((item) => [item.path, item]));
  const dataDirectories = (status.oldDataDirs ?? []).map((path) => details.get(path) ?? { path, kind: 'data' });
  const known = new Set(dataDirectories.map((item) => item.path));
  return [...dataDirectories, ...(status.oldDataDirDetails ?? []).filter((item) => !known.has(item.path))];
}

function inspectionHasVault(inspection: BackupImportInspectResult): boolean {
  return Boolean(inspection.manifestSummary.hasVault);
}

export function BackupTransferSection({ active, l }: BackupTransferSectionProps) {
  const [options, setOptions] = useState<BackupExportOptions>(INITIAL_OPTIONS);
  const [estimate, setEstimate] = useState<BackupExportEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState('');
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [operation, setOperation] = useState<Operation>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [exportResult, setExportResult] = useState<BackupExportResult | null>(null);
  const [passwordPurpose, setPasswordPurpose] = useState<PasswordPurpose>(null);
  const [passwordDialogError, setPasswordDialogError] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState<Confirmation>(null);
  const [destinationPath, setDestinationPath] = useState('');
  const [selectedPackagePath, setSelectedPackagePath] = useState('');
  const [inspection, setInspection] = useState<BackupImportInspectResult | null>(null);
  const [libraryDirectory, setLibraryDirectory] = useState('');
  const [vaultDirectory, setVaultDirectory] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await getBackupStatus());
    } catch (error) {
      setStatusMessage(getErrorMessage(error, l('读取备份状态失败。', 'Failed to read backup status.'), l));
    } finally {
      setStatusLoading(false);
    }
  }, [l]);

  useEffect(() => {
    if (!active) return undefined;
    void loadStatus();
    return undefined;
  }, [active, loadStatus]);

  useEffect(() => {
    if (!active) return undefined;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listenBackupProgress((nextProgress) => {
      if (!disposed) setProgress(nextProgress);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch(() => {
      if (!disposed) {
        setStatusMessage(l('无法接收备份任务进度。', 'Unable to receive backup task progress.'));
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, l]);

  useEffect(() => {
    if (!active) return undefined;
    let disposed = false;
    const timer = window.setTimeout(() => {
      setEstimating(true);
      setEstimateError('');
      try {
        const rendererState = options.includeRendererState ? captureRendererState() : {};
        void estimateBackup(options, rendererState).then((result) => {
          if (!disposed) setEstimate(result);
        }).catch((error) => {
          if (!disposed) setEstimateError(getErrorMessage(error, l('无法估算备份体积。', 'Unable to estimate backup size.'), l));
        }).finally(() => {
          if (!disposed) setEstimating(false);
        });
      } catch (error) {
        setEstimateError(getErrorMessage(error, l('无法读取浏览器状态。', 'Unable to read browser state.'), l));
        setEstimating(false);
      }
    }, 250);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [active, l, options]);

  const recentRecords = useMemo(() => {
    if (status?.history?.length) return status.history.slice(0, 5);
    return [
      status?.lastExport ? { ...status.lastExport, direction: 'export' as const } : null,
      status?.lastRestore ? { ...status.lastRestore, direction: status.lastRestore.direction ?? 'import' as const } : null,
    ].filter((record): record is BackupHistoryRecord => Boolean(record));
  }, [status]);
  const oldDataDirectories = useMemo(() => oldDataList(status), [status]);
  const operationBusy = operation !== null;
  const canCancel = (operation === 'export' || operation === 'stage')
    && progress?.cancellable !== false
    && progress?.phase !== 'committing'
    && progress?.phase !== 'restarting'
    && progress?.phase !== 'done'
    && progress?.phase !== 'failed';

  if (!active) return null;

  const updateOption = <Key extends keyof BackupExportOptions>(key: Key, value: BackupExportOptions[Key]) => {
    setOptions((current) => ({ ...current, preset: 'custom', [key]: value }));
  };

  const handlePreset = (preset: BackupExportPreset) => {
    setOptions((current) => preset === 'custom'
      ? initialCustomOptions(current)
      : { ...PRESET_OPTIONS[preset] });
  };

  const handleExportClick = async () => {
    setStatusMessage('');
    try {
      const path = await selectBackupDestination();
      if (!path) return;
      setDestinationPath(path);
      setExportResult(null);
      setProgress({
        direction: 'export',
        phase: 'preflight',
        completedBytes: 0,
        totalBytes: estimate?.totalBytes ?? 0,
        completedEntries: 0,
        totalEntries: estimate?.entries ?? 0,
        currentLabel: l('等待输入加密密码', 'Waiting for the encryption password'),
      });
      setPasswordDialogError('');
      setPasswordPurpose('export');
    } catch (error) {
      setStatusMessage(getErrorMessage(error, l('选择备份保存位置失败。', 'Failed to select a backup destination.'), l));
    }
  };

  const handleImportClick = async () => {
    setStatusMessage('');
    setInspection(null);
    try {
      const path = await selectBackupPackage();
      if (!path) return;
      setSelectedPackagePath(path);
      setLibraryDirectory('');
      setVaultDirectory('');
      setPasswordDialogError('');
      setPasswordPurpose('inspect');
    } catch (error) {
      setStatusMessage(getErrorMessage(error, l('选择备份包失败。', 'Failed to select a backup package.'), l));
    }
  };

  const handlePasswordSubmit = async (password: string): Promise<boolean> => {
    const purpose = passwordPurpose;
    setPasswordDialogError('');

    if (purpose === 'export') {
      setOperation('export');
      setStatusMessage('');
      setProgress({
        direction: 'export',
        phase: 'preflight',
        completedBytes: 0,
        totalBytes: estimate?.totalBytes ?? 0,
        completedEntries: 0,
        totalEntries: estimate?.entries ?? 0,
        currentLabel: l('正在准备导出', 'Preparing export'),
      });
      try {
        const rendererState = options.includeRendererState ? captureRendererState() : {};
        if (options.includeRendererState) {
          const codeUnits = rendererStateCodeUnits(rendererState);
          if (codeUnits > MAX_RENDERER_STATE_CODE_UNITS) {
            setStatusMessage(l(
              `浏览器状态共 ${codeUnits.toLocaleString()} 个 UTF-16 code unit，超过 4,000,000 限值；请清理历史记录或关闭“包含阅读器状态”。`,
              `Browser state contains ${codeUnits.toLocaleString()} UTF-16 code units, above the 4,000,000 limit. Clear history or turn off “Include reader state”.`,
            ));
            return true;
          }
          assertRendererStateWithinLimit(rendererState);
        }
        const result = await startBackupExport({
          destinationPath,
          password,
          options,
          rendererState,
        });
        if (!result.ok) {
          setStatusMessage(l('备份导出未完成。', 'Backup export did not complete.'));
          setProgress((current) => current ? { ...current, phase: 'failed' } : current);
          return true;
        }
        setExportResult(result);
        setProgress((current) => current?.phase === 'done' ? current : {
          direction: 'export',
          phase: 'done',
          completedBytes: result.bytes,
          totalBytes: result.bytes,
          completedEntries: result.entries,
          totalEntries: result.entries,
          currentLabel: l('导出与整包校验完成', 'Export and package verification complete'),
        });
        setStatusMessage(l('加密备份包已导出。', 'Encrypted backup package exported.'));
        await loadStatus();
        return true;
      } catch (error) {
        setStatusMessage(getErrorMessage(error, l('备份导出失败。', 'Backup export failed.'), l));
        setProgress((current) => current ? { ...current, phase: 'failed' } : current);
        return true;
      } finally {
        setOperation(null);
      }
    }

    if (purpose === 'inspect') {
      setOperation('inspect');
      try {
        const result = await inspectBackupPackage(selectedPackagePath, password);
        if (!result.ok) {
          setPasswordDialogError(l('密码错误或备份包已损坏。', 'Password is incorrect or the backup package is damaged.'));
          return false;
        }
        setInspection(result);
        setStatusMessage('');
        return true;
      } catch (error) {
        setPasswordDialogError(getErrorMessage(error, l('密码错误或备份包已损坏。', 'Password is incorrect or the backup package is damaged.'), l));
        return false;
      } finally {
        setOperation(null);
      }
    }

    if (purpose === 'stage') {
      if (!inspection || !libraryDirectory) {
        setPasswordDialogError(l('请先检查备份包并选择新的文献库目录。', 'Inspect the package and select a new library directory first.'));
        return false;
      }
      setOperation('stage');
      setProgress({
        direction: 'import',
        phase: 'preflight',
        completedBytes: 0,
        totalBytes: inspection.manifestSummary.totalBytes,
        completedEntries: 0,
        totalEntries: Object.values(inspection.manifestSummary.counts).reduce((sum, count) => sum + count, 0),
        currentLabel: l('正在准备导入暂存', 'Preparing import staging'),
      });
      try {
        const currentRendererState = captureRendererState();
        const result = await stageBackupImport({
          packagePath: selectedPackagePath,
          password,
          targets: {
            libraryStorageDir: libraryDirectory,
            notesVaultDir: inspectionHasVault(inspection) ? (vaultDirectory || null) : null,
          },
          currentRendererState,
        });
        if (!result.ok) {
          setPasswordDialogError(l('无法暂存此备份包。', 'The backup package could not be staged.'));
          return false;
        }
        setProgress((current) => current?.phase === 'done' ? current : {
          direction: 'import',
          phase: 'done',
          completedBytes: inspection.manifestSummary.totalBytes,
          totalBytes: inspection.manifestSummary.totalBytes,
          completedEntries: current?.totalEntries ?? 0,
          totalEntries: current?.totalEntries ?? 0,
          currentLabel: l('暂存与校验完成，应用将重启完成恢复', 'Staging and verification complete; the app will restart to finish restore'),
        });
        setInspection(null);
        setStatusMessage(result.restartRequired
          ? l('备份已暂存，应用将重启以完成恢复；旧数据将保留为回滚点。', 'Backup staged. The app will restart to finish restore; old data will be kept as a rollback point.')
          : l('备份已暂存，旧数据将保留为回滚点。', 'Backup staged. Old data will be kept as a rollback point.'));
        await loadStatus();
        return true;
      } catch (error) {
        setPasswordDialogError(getErrorMessage(error, l('导入暂存失败，本机数据未修改。', 'Import staging failed. Local data was not changed.'), l));
        setProgress((current) => current ? { ...current, phase: 'failed' } : current);
        return false;
      } finally {
        setOperation(null);
      }
    }

    return true;
  };

  const handleChooseLibraryDirectory = async () => {
    try {
      const path = await selectBackupLibraryDirectory();
      if (path) setLibraryDirectory(path);
    } catch (error) {
      setStatusMessage(getErrorMessage(error, l('选择文献库目录失败。', 'Failed to select a library directory.'), l));
    }
  };

  const handleChooseVaultDirectory = async () => {
    try {
      const path = await selectBackupVaultDirectory();
      if (path) setVaultDirectory(path);
    } catch (error) {
      setStatusMessage(getErrorMessage(error, l('选择 Vault 目录失败。', 'Failed to select the vault directory.'), l));
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const result = await cancelBackupTask();
      setStatusMessage(result.cancelled
        ? l('已请求取消任务，正在清理暂存内容。', 'Cancellation requested; temporary data is being cleaned up.')
        : l('当前任务无法取消。', 'The current task cannot be cancelled.'));
    } catch (error) {
      setStatusMessage(getErrorMessage(error, l('取消任务失败。', 'Failed to cancel the task.'), l));
    } finally {
      setCancelling(false);
    }
  };

  const handleConfirmAction = async () => {
    const action = pendingConfirmation;
    if (!action) return;

    if (action.kind === 'stage') {
      setPendingConfirmation(null);
      setPasswordDialogError('');
      setPasswordPurpose('stage');
      return;
    }

    setOperation(action.kind);
    setStatusMessage('');
    try {
      if (action.kind === 'rollback') {
        const result = await prepareBackupRollback(action.path);
        setStatusMessage(result.restartRequired
          ? l('已准备回滚，应用将重启；当前数据将另存为 .rolledback-*。', 'Rollback prepared. The app will restart; current data will be kept as .rolledback-*.')
          : l('回滚已准备。', 'Rollback prepared.'));
      } else {
        const result = await deleteBackupOldData(action.path);
        setStatusMessage(l(
          `旧数据已删除，释放 ${formatBytes(result.freedBytes)}。`,
          `Old data deleted; ${formatBytes(result.freedBytes)} freed.`,
        ));
      }
      setPendingConfirmation(null);
      await loadStatus();
    } catch (error) {
      setStatusMessage(getErrorMessage(error, action.kind === 'delete'
        ? l('删除旧数据失败。', 'Failed to delete old data.')
        : l('准备回滚失败。', 'Failed to prepare rollback.'), l));
    } finally {
      setOperation(null);
    }
  };

  const renderEstimate = () => (
    <div className="space-y-2 rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-3 py-2.5 text-xs text-[var(--pq-text-muted)]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-[var(--pq-text)]">{l('预计备份大小', 'Estimated backup size')}</span>
        {estimating ? (
          <span className="inline-flex items-center gap-1.5"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{l('正在统计', 'Estimating')}</span>
        ) : estimate ? (
          <span className="font-semibold text-[var(--pq-text)]">{formatBytes(estimate.totalBytes)} · {l(`${estimate.entries} 个条目`, `${estimate.entries} entries`)}</span>
        ) : null}
      </div>
      {estimateError ? <div role="status" className="text-[var(--pq-warning)]">{estimateError}</div> : null}
      {estimate?.breakdown ? (
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {Object.entries(estimate.breakdown).map(([key, item]) => item && COMPONENT_LABELS[key] ? (
            <div key={key} className="flex justify-between gap-3">
              <span>{l(...COMPONENT_LABELS[key])}</span>
              <span>{formatBytes(item.totalBytes)} · {item.entries}</span>
            </div>
          ) : null)}
        </div>
      ) : null}
      {estimate?.warnings?.length ? (
        <div className="border-t border-[var(--pq-border)] pt-2 text-[var(--pq-warning)]">
          {l(`预估提示 ${estimate.warnings.length} 条`, `${estimate.warnings.length} estimate warning(s)`)}
        </div>
      ) : null}
      {options.includeRendererState ? (
        <div>
          {l('浏览器状态按 UTF-16 code unit 检查上限 4,000,000。', 'Browser state is limited to 4,000,000 UTF-16 code units.')}
        </div>
      ) : null}
    </div>
  );

  const openImportConfirmation = () => {
    if (!inspection) return;
    if (!libraryDirectory.trim()) {
      setStatusMessage(l('请选择新文献库存储目录后再继续。', 'Select a new library storage directory before continuing.'));
      return;
    }
    setStatusMessage('');
    setPendingConfirmation({ kind: 'stage' });
  };

  const confirmationTitle = pendingConfirmation?.kind === 'delete'
    ? l('删除旧数据？', 'Delete Old Data?')
    : pendingConfirmation?.kind === 'rollback'
      ? l('回滚到此版本？', 'Roll Back to This Version?')
      : l('确认替换本机数据？', 'Replace Local Data?');
  const confirmationDescription = pendingConfirmation?.kind === 'delete'
    ? l('此操作会永久删除所选旧目录中的明文配置、API Key、数据库和文件，无法撤销。', 'This permanently deletes plaintext settings, API keys, databases, and files in the selected old directory. It cannot be undone.')
    : pendingConfirmation?.kind === 'rollback'
      ? l('应用将重启，当前数据会另存为 .rolledback-*；所选旧数据与对应浏览器状态将恢复。', 'The app will restart and current data will be kept as .rolledback-*; the selected old data and its matching browser state will be restored.')
      : l('导入会替换本机数据。旧数据会保留为回滚目录；应用暂存并校验成功后将重启完成恢复。', 'Import replaces local data. Old data will remain as a rollback directory; after staging and verification, the app will restart to finish restore.');
  const confirmationLabel = pendingConfirmation?.kind === 'delete'
    ? l('永久删除', 'Delete Permanently')
    : pendingConfirmation?.kind === 'rollback'
      ? l('准备回滚并重启', 'Prepare Rollback and Restart')
      : l('继续并输入密码', 'Continue and Enter Password');

  return (
    <div className="space-y-4">
      <SettingsField
        label={l('加密备份包', 'Encrypted Backup Package')}
        description={l(
          '单个 .pqbackup 文件，使用密码加密；可包含配置与密钥、文献与笔记、阅读状态和 Agent 记忆。密码无法找回。',
          'A single .pqbackup file encrypted with your password. It can include settings and secrets, papers and notes, reader state, and Agent memory. The password cannot be recovered.',
        )}
      >
        <div className="flex items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--pq-warning)_28%,transparent)] bg-[var(--pq-warning-bg)] px-3 py-2.5 text-xs leading-5 text-[var(--pq-warning)]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <p>{l('备份包可能包含 API Key、个人文献和笔记。请妥善保管文件与密码；忘记密码后无法恢复。', 'The package may contain API keys, personal papers, and notes. Keep the file and password safe; a forgotten password cannot be recovered.')}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => void handleExportClick()}
            disabled={operationBusy}
            className="pq-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pq-accent)]"
          >
            <ArrowDownToLine className="h-4 w-4" strokeWidth={1.8} />
            {l('一键导出备份包', 'Export Backup Package')}
          </button>
          <button
            type="button"
            onClick={() => void handleImportClick()}
            disabled={operationBusy}
            className="pq-button inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pq-accent)]"
          >
            <ArrowUpFromLine className="h-4 w-4" strokeWidth={1.8} />
            {l('从备份包导入', 'Import from Backup Package')}
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--pq-text)]">{l('备份范围', 'Backup Scope')}</div>
          <div className="grid grid-cols-3 rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface-2)] p-1" role="group" aria-label={l('备份预设', 'Backup presets')}>
            {(['migration', 'daily', 'custom'] as const).map((preset) => {
              const selected = options.preset === preset;
              const label = preset === 'migration'
                ? l('完整迁移', 'Full Migration')
                : preset === 'daily'
                  ? l('日常备份', 'Daily Backup')
                  : l('自定义', 'Custom');
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handlePreset(preset)}
                  className={`min-h-9 rounded-md px-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pq-accent)] ${selected ? 'bg-[var(--pq-surface-1)] text-[var(--pq-accent)] shadow-sm' : 'text-[var(--pq-text-muted)] hover:text-[var(--pq-text)]'}`}
                >
                  {selected ? <Check className="mr-1 inline h-3.5 w-3.5" strokeWidth={2} /> : null}
                  {label}
                </button>
              );
            })}
          </div>
          <div className="text-xs leading-5 text-[var(--pq-text-muted)]">
            {options.preset === 'migration'
              ? l('完整迁移包含 RAG 数据库、解析缓存与 Vault，适合换机或重装系统。', 'Includes the RAG database, parse caches, and vault for moving to a new computer or reinstalling.')
              : options.preset === 'daily'
                ? l('日常备份保留数据库、PDF、阅读状态与 Vault；不含 RAG 运行记录和解析缓存。', 'Keeps databases, PDFs, reader state, and vault; excludes RAG run history and parse caches.')
                : l('自定义范围可单独选择大型数据项、浏览器状态和压缩方式。', 'Choose large data components, browser state, and compression individually.')}
          </div>
        </div>

        <details className="group rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface-1)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-[var(--pq-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pq-accent)]">
            <span className="inline-flex items-center gap-2"><Archive className="h-4 w-4 text-[var(--pq-text-muted)]" strokeWidth={1.8} />{l('高级选项', 'Advanced Options')}</span>
            <ChevronDown className="h-4 w-4 text-[var(--pq-text-muted)] transition group-open:rotate-180" strokeWidth={1.8} />
          </summary>
          <div className="space-y-3 border-t border-[var(--pq-border)] p-3">
            <div className="grid gap-2 md:grid-cols-2">
              <ToggleRow
                title={l('包含 RAG 数据库', 'Include RAG Database')}
                description={l('包含向量索引与 Agent 运行记录，可能显著增加包体积。', 'Includes vector indexes and Agent run history; may substantially increase package size.')}
                checked={options.includeRag}
                onChange={(checked) => updateOption('includeRag', checked)}
              />
              <ToggleRow
                title={l('包含解析 / 翻译缓存', 'Include Parse / Translation Caches')}
                description={l('包含 MinerU、翻译和摘要缓存。', 'Includes MinerU, translation, and summary caches.')}
                checked={options.includeDerived}
                onChange={(checked) => updateOption('includeDerived', checked)}
              />
              <ToggleRow
                title={l('包含笔记 Vault', 'Include Notes Vault')}
                description={l('只包含 PaperQuay manifest 管理的笔记文件。', 'Includes only note files managed by the PaperQuay manifest.')}
                checked={options.includeVault}
                onChange={(checked) => updateOption('includeVault', checked)}
              />
              <ToggleRow
                title={l('包含 PDF 文件', 'Include PDF Files')}
                description={l('文献原文与已附加的翻译版 PDF。', 'Original papers and attached translated PDFs.')}
                checked={options.includePdfs}
                onChange={(checked) => updateOption('includePdfs', checked)}
              />
              <ToggleRow
                title={l('包含阅读器状态', 'Include Reader State')}
                description={l('导出全部 localStorage 键，包括批注、阅读位置和 Agent 历史。', 'Exports every localStorage key, including annotations, reading positions, and Agent history.')}
                checked={options.includeRendererState}
                onChange={(checked) => updateOption('includeRendererState', checked)}
              />
              <ToggleRow
                title={l('导出后整包校验', 'Verify Package After Export')}
                description={l('默认回读并校验每个条目；大型备份可能需要较长时间。', 'Reads back and verifies every entry by default; large backups may take time.')}
                checked={options.selfVerify}
                onChange={(checked) => updateOption('selfVerify', checked)}
              />
            </div>
            <label className="grid gap-2 text-xs font-medium text-[var(--pq-text-muted)] sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
              <span>{l('压缩级别', 'Compression Level')}</span>
              <SettingsSelect
                value={options.compressionLevel}
                onChange={(event) => updateOption('compressionLevel', event.target.value as BackupExportOptions['compressionLevel'])}
              >
                <option value="fast">{l('快速（级别 1）', 'Fast (level 1)')}</option>
                <option value="standard">{l('标准（级别 6）', 'Standard (level 6)')}</option>
                <option value="none">{l('不压缩', 'No compression')}</option>
              </SettingsSelect>
            </label>
          </div>
        </details>

        {renderEstimate()}
        {destinationPath ? (
          <div className="break-all text-xs text-[var(--pq-text-muted)]">
            {l('最近导出目标', 'Last export destination')}: {destinationPath}
          </div>
        ) : null}
      </SettingsField>

      {statusMessage ? (
        <div role="status" className="rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-3 py-2.5 text-xs leading-5 text-[var(--pq-text-muted)]">
          {statusMessage}
        </div>
      ) : null}

      <BackupProgressPanel
        progress={progress}
        result={exportResult}
        busy={operation === 'export' || operation === 'stage'}
        cancelling={cancelling}
        canCancel={canCancel}
        l={l}
        onCancel={() => void handleCancel()}
        onOpenFolder={(path) => void openBackupDestinationFolder(path).catch((error) => setStatusMessage(getErrorMessage(error, l('打开备份所在文件夹失败。', 'Failed to open the backup folder.'), l)))}
      />

      <SettingsField
        label={l('导入备份包', 'Import Backup Package')}
        description={l('检查密码后预览包内容，再选择新的文献库目录。导入会替换本机数据，并通过重启完成恢复。', 'Inspect the package and preview its contents, then choose a new library directory. Import replaces local data and completes after restart.')}
      >
        {inspection ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--pq-text)]">{l('备份包摘要', 'Backup Summary')}</div>
                <div className="mt-1 break-all text-xs text-[var(--pq-text-muted)]">{selectedPackagePath}</div>
              </div>
              <button type="button" onClick={() => setInspection(null)} className="pq-button px-3 py-1.5 text-xs">
                {l('取消导入', 'Cancel Import')}
              </button>
            </div>
            <dl className="grid gap-x-4 gap-y-2 rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface-2)] p-3 text-xs sm:grid-cols-2">
              <div><dt className="inline text-[var(--pq-text-muted)]">{l('创建时间', 'Created')}: </dt><dd className="inline text-[var(--pq-text)]">{recordDate({ direction: 'import', createdAt: inspection.manifestSummary.createdAt })}</dd></div>
              <div><dt className="inline text-[var(--pq-text-muted)]">{l('来源版本', 'Source version')}: </dt><dd className="inline text-[var(--pq-text)]">{inspection.manifestSummary.app.version}</dd></div>
              <div><dt className="inline text-[var(--pq-text-muted)]">{l('平台', 'Platform')}: </dt><dd className="inline text-[var(--pq-text)]">{[inspection.manifestSummary.app.platform, inspection.manifestSummary.app.arch].filter(Boolean).join(' / ') || l('未知', 'Unknown')}</dd></div>
              <div><dt className="inline text-[var(--pq-text-muted)]">{l('包体积', 'Package size')}: </dt><dd className="inline text-[var(--pq-text)]">{formatBytes(inspection.manifestSummary.packageBytes ?? inspection.manifestSummary.totalBytes)}</dd></div>
              <div className="sm:col-span-2">
                <dt className="mb-1 block text-[var(--pq-text-muted)]">{l('组件统计', 'Component counts')}</dt>
                <dd className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--pq-text)]">
                  {Object.entries(inspection.manifestSummary.counts).map(([key, count]) => {
                    const countLabel = COUNT_LABELS[key] ?? [key, key];
                    return <span key={key}>{l(countLabel[0], countLabel[1])}: {count}</span>;
                  })}
                </dd>
              </div>
              <div className="sm:col-span-2 flex flex-wrap gap-2">
                {[
                  [inspection.manifestSummary.hasRag, l('含 RAG', 'Includes RAG')],
                  [inspection.manifestSummary.hasDerived, l('含解析缓存', 'Includes parse caches')],
                  [inspection.manifestSummary.hasVault, l('含 Vault', 'Includes vault')],
                ].map(([included, label]) => (
                  <span key={String(label)} className={`rounded-md px-2 py-1 ${included ? 'bg-[var(--pq-success-bg)] text-[var(--pq-success)]' : 'bg-[var(--pq-surface-3)] text-[var(--pq-text-faint)]'}`}>
                    {included ? <Check className="mr-1 inline h-3 w-3" /> : null}{label}
                  </span>
                ))}
              </div>
            </dl>
            {inspection.warnings.length > 0 ? (
              <ul className="space-y-1 rounded-lg border border-[color-mix(in_srgb,var(--pq-warning)_28%,transparent)] bg-[var(--pq-warning-bg)] p-3 text-xs text-[var(--pq-warning)]">
                {sortWarningsForDisplay(inspection.warnings).slice(0, 8).map((warning, index) => <li key={index} className="break-words">{safeWarningLabel(warning, l)}</li>)}
                {inspection.warnings.length > 8 ? <li className="text-[var(--pq-text-muted)]">{l(`另有 ${inspection.warnings.length - 8} 条警告未显示`, `${inspection.warnings.length - 8} more warning(s) not shown`)}</li> : null}
              </ul>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--pq-text-muted)]">{l('新文献库存储目录（必选）', 'New library storage directory (required)')}</span>
              <div className="flex gap-2">
                <SettingsInput value={libraryDirectory} readOnly placeholder={l('请选择新目录，不要选择旧 dataDir 内部路径', 'Choose a new directory outside the old dataDir')} />
                <button type="button" onClick={() => void handleChooseLibraryDirectory()} className="pq-button inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs">
                  <FolderOpen className="h-4 w-4" strokeWidth={1.8} />{l('选择目录', 'Select Directory')}
                </button>
              </div>
            </label>
            {inspectionHasVault(inspection) ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-[var(--pq-text-muted)]">{l('笔记 Vault 目录（可选）', 'Notes vault directory (optional)')}</span>
                <div className="flex gap-2">
                  <SettingsInput value={vaultDirectory} readOnly placeholder={l('留空可跳过 Vault 恢复', 'Leave empty to skip restoring the vault')} />
                  <button type="button" onClick={() => void handleChooseVaultDirectory()} className="pq-button inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs">
                    <FolderOpen className="h-4 w-4" strokeWidth={1.8} />{l('选择目录', 'Select Directory')}
                  </button>
                  {vaultDirectory ? <button type="button" onClick={() => setVaultDirectory('')} className="pq-button px-3 py-2 text-xs">{l('跳过', 'Skip')}</button> : null}
                </div>
              </label>
            ) : null}
            <button
              type="button"
              onClick={openImportConfirmation}
              disabled={operationBusy || !libraryDirectory}
              className="pq-button-danger inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pq-danger)]"
            >
              <ArrowUpFromLine className="h-4 w-4" strokeWidth={1.8} />
              {l('暂存并替换本机数据', 'Stage and Replace Local Data')}
            </button>
          </div>
        ) : (
          <div className="text-xs text-[var(--pq-text-muted)]">
            {l('选择并检查备份包后，摘要和恢复目录选项会显示在这里。', 'The package summary and restore targets will appear here after you choose and inspect a backup.')}
          </div>
        )}
      </SettingsField>

      <SettingsField
        label={l('最近备份记录', 'Recent Backup History')}
        description={l('最多显示最近 5 条记录；不包含备份密码。', 'Shows up to the 5 latest records. Backup passwords are never stored here.')}
      >
        {statusLoading ? (
          <div className="inline-flex items-center gap-2 text-xs text-[var(--pq-text-muted)]"><LoaderCircle className="h-4 w-4 animate-spin" />{l('正在读取记录', 'Loading history')}</div>
        ) : recentRecords.length ? (
          <ul className="divide-y divide-[var(--pq-border)]">
            {recentRecords.map((record, index) => {
              const isExport = record.direction === 'export';
              const isRollback = record.direction === 'rollback';
              const failed = isFailedRecord(record);
              const path = recordPath(record);
              return (
                <li key={`${record.direction ?? 'backup'}:${record.completedAt ?? record.createdAt ?? index}:${index}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs font-semibold ${failed ? 'text-[var(--pq-danger)]' : 'text-[var(--pq-text)]'}`}>
                      {isExport ? l('导出', 'Export') : isRollback ? l('回滚', 'Rollback') : l('导入', 'Import')} · {failed ? l('未完成', 'Not completed') : l('完成', 'Completed')}
                      {record.sourceVersion ? ` · ${l('来源', 'from')} ${record.sourceVersion}` : ''}
                    </div>
                    <div className="mt-1 text-xs text-[var(--pq-text-muted)]">
                      {recordDate(record)}{record.bytes !== undefined ? ` · ${formatBytes(record.bytes)}` : ''}{record.entries !== undefined ? ` · ${l(`${record.entries} 个条目`, `${record.entries} entries`)}` : ''}
                    </div>
                    {path ? <div className="mt-1 break-all font-mono text-[11px] text-[var(--pq-text-muted)]">{path}</div> : null}
                    {record.message ? <div className="mt-1 text-xs text-[var(--pq-danger)]">{record.message}</div> : null}
                  </div>
                  {path && isExport ? (
                    <button type="button" onClick={() => void openBackupDestinationFolder(path).catch((error) => setStatusMessage(getErrorMessage(error, l('打开备份所在文件夹失败。', 'Failed to open the backup folder.'), l)))} className="pq-icon-button h-8 w-8 shrink-0" aria-label={l('打开备份所在文件夹', 'Open backup folder')} title={l('打开所在文件夹', 'Open Containing Folder')}>
                      <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-xs text-[var(--pq-text-muted)]">{l('暂无备份记录。', 'No backup history yet.')}</div>
        )}
      </SettingsField>

      {oldDataDirectories.length ? (
        <SettingsField
          label={l('导入前数据', 'Pre-import Data')}
          description={l('旧目录包含明文配置、密钥和文件。确认新数据可用后，可回滚或删除；删除前请再次确认。', 'Old directories contain plaintext settings, secrets, and files. Roll back or delete them after verifying the new data; deletion requires confirmation.')}
        >
          <div className="divide-y divide-[var(--pq-border)]">
            {oldDataDirectories.map((oldData) => (
              <div key={oldData.path} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="break-all font-mono text-xs text-[var(--pq-text)]">{oldData.path}</div>
                  <div className="mt-1 text-xs text-[var(--pq-text-muted)]">
                    {oldData.sizeBytes !== undefined ? formatBytes(oldData.sizeBytes) : oldData.bytes !== undefined ? formatBytes(oldData.bytes) : ''}
                    {oldData.createdAt ? ` · ${recordDate({ direction: 'import', createdAt: oldData.createdAt })}` : ''}
                    {oldData.kind ? ` · ${oldData.kind}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {oldData.kind === 'data' || !oldData.kind ? (
                    <button type="button" onClick={() => setPendingConfirmation({ kind: 'rollback', path: oldData.path })} disabled={operationBusy} className="pq-button inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-60">
                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />{l('回滚', 'Rollback')}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setPendingConfirmation({ kind: 'delete', path: oldData.path })} disabled={operationBusy} className="pq-button-danger inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-60">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />{l('删除', 'Delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SettingsField>
      ) : null}

      {status?.pendingRestore ? (
        <div role="status" className="rounded-lg border border-[var(--pq-info)] bg-[var(--pq-info-bg)] px-3 py-2.5 text-xs leading-5 text-[var(--pq-info)]">
          {l('有待完成的恢复任务。重启 PaperQuay 后将继续处理。', 'A restore is pending. Restart PaperQuay to continue.')}
        </div>
      ) : null}

      <BackupPasswordDialog
        open={passwordPurpose !== null}
        mode={passwordPurpose === 'export' ? 'export' : 'import'}
        l={l}
        busy={operation === 'export' || operation === 'inspect' || operation === 'stage'}
        error={passwordDialogError}
        description={passwordPurpose === 'export'
          ? l('请设置至少 8 个字符的读取密码。关闭对话框会清空密码。', 'Set a password of at least 8 characters. Closing this dialog clears the password.')
          : passwordPurpose === 'inspect'
            ? l('输入读取密码以解密清单并预览包内容。密码不会写入历史记录。', 'Enter the password to decrypt the manifest and preview the package. It is never written to history.')
            : l('再次输入读取密码以校验并暂存恢复数据。密码不会写入日志。', 'Re-enter the password to validate and stage the restore. It is never written to logs.')}
        confirmLabel={passwordPurpose === 'stage' ? l('校验并暂存', 'Validate and Stage') : undefined}
        onClose={() => {
          if (!operationBusy) {
            setPasswordPurpose(null);
            setPasswordDialogError('');
          }
        }}
        onSubmit={handlePasswordSubmit}
      />

      <ConfirmDialog
        open={pendingConfirmation !== null}
        title={confirmationTitle}
        description={confirmationDescription}
        confirmLabel={confirmationLabel}
        cancelLabel={l('取消', 'Cancel')}
        danger={pendingConfirmation?.kind !== 'stage'}
        busy={operationBusy}
        onClose={() => {
          if (!operationBusy) setPendingConfirmation(null);
        }}
        onConfirm={() => void handleConfirmAction()}
      />
    </div>
  );
}
