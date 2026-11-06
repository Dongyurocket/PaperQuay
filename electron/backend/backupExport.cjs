const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { collectBackupSources, estimateBackupSources, normalizeOptions, pathInside } = require('./backupSources.cjs');

const SAFETY_MARGIN = 1024 * 1024 * 1024;
const BACKUP_HISTORY_LIMIT = 5;
const PACKAGE_VERSION = require('../../package.json').version;

function isProcessAlive(pid) {
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

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const handle = await fsp.open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(temporaryPath, filePath);
}

function backupHistoryPath(appPaths) {
  return path.join(appPaths.dataDir, '.settings', 'backup-history.json');
}

function readBackupHistory(appPaths) {
  const raw = readJson(backupHistoryPath(appPaths), []);
  return Array.isArray(raw) ? raw.slice(0, BACKUP_HISTORY_LIMIT) : [];
}

async function appendBackupHistory(appPaths, entry) {
  const history = [entry, ...readBackupHistory(appPaths)].slice(0, BACKUP_HISTORY_LIMIT);
  await writeJsonAtomic(backupHistoryPath(appPaths), history);
  return history;
}

function emitProgress(onProgress, payload) {
  try {
    onProgress?.({
      direction: 'export',
      phase: payload.phase || 'writing',
      completedBytes: Math.max(0, Number(payload.completedBytes) || 0),
      totalBytes: Math.max(0, Number(payload.totalBytes) || 0),
      completedEntries: Math.max(0, Number(payload.completedEntries) || 0),
      totalEntries: Math.max(0, Number(payload.totalEntries) || 0),
      currentLabel: String(payload.currentLabel || ''),
    });
  } catch {}
}

function collectForbiddenRoots(context) {
  const library = context.store.load();
  const config = readJson(context.appPaths.configPath, {});
  const roots = [
    context.appPaths.dataDir,
    library.settings?.storageDir,
    library.settings?.translatedPdfDir,
    library.settings?.notesVaultDir,
    config.settings?.mineruCacheDir,
    config.settings?.remotePdfDownloadDir,
    context.appPaths.mineruCacheDir,
  ].filter((value) => typeof value === 'string' && value.trim());
  const normalized = [];
  for (const value of roots) {
    const absolute = path.resolve(value);
    normalized.push(absolute);
    try { normalized.push(fs.realpathSync.native(absolute)); } catch {}
  }
  return Array.from(new Set(normalized));
}

function assertOutputPath(context, outputPath) {
  if (typeof outputPath !== 'string' || !outputPath.trim()) {
    throw Object.assign(new Error('A backup destination is required'), { code: 'TARGET_NOT_WRITABLE' });
  }
  const resolved = path.resolve(outputPath);
  if (path.extname(resolved).toLowerCase() !== '.pqbackup') {
    throw Object.assign(new Error('Backup file must use the .pqbackup extension'), { code: 'INVALID_DESTINATION' });
  }
  if (fs.existsSync(resolved)) {
    throw Object.assign(new Error('A file already exists at the selected destination'), { code: 'BACKUP_DESTINATION_EXISTS' });
  }
  const parent = path.dirname(resolved);
  const normalizedParent = path.resolve(parent);
  let realParent = normalizedParent;
  try { realParent = fs.realpathSync.native(normalizedParent); } catch {}
  const outputViaRealParent = path.join(realParent, path.basename(resolved));
  for (const root of collectForbiddenRoots(context)) {
    if (pathInside(root, resolved) || pathInside(root, normalizedParent) || pathInside(root, outputViaRealParent) || pathInside(outputViaRealParent, root)) {
      throw Object.assign(new Error('Backup output cannot be placed inside PaperQuay data or source directories'), { code: 'INVALID_DESTINATION' });
    }
  }
  return resolved;
}

async function availableBytes(directory) {
  try {
    const stat = await fsp.statfs(directory);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

function detectFat32(directory) {
  if (process.platform !== 'win32') return false;
  const root = path.parse(path.resolve(directory)).root;
  try {
    const output = execFileSync('fsutil.exe', ['fsinfo', 'volumeinfo', root], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /File System Name\s*:\s*FAT32/i.test(output);
  } catch {
    return false;
  }
}

async function databaseSnapshotEstimate(context) {
  const paths = [context.appPaths.libraryDatabasePath, context.appPaths.notesDatabasePath];
  if (context.ragStore?.available && typeof context.ragStore.snapshotTo === 'function') paths.push(context.appPaths.ragDatabasePath);
  let maximum = 0;
  for (const databasePath of paths) {
    let total = 0;
    for (const suffix of ['', '-wal']) {
      try {
        total += (await fsp.stat(`${databasePath}${suffix}`)).size;
      } catch {}
    }
    maximum = Math.max(maximum, total);
  }
  return maximum;
}

async function preflightExport(context, outputPath, estimate) {
  const destination = assertOutputPath(context, outputPath);
  const outputDir = path.dirname(destination);
  await fsp.access(outputDir, fs.constants.W_OK).catch((error) => {
    throw Object.assign(new Error('Backup destination is not writable'), { code: 'TARGET_NOT_WRITABLE', cause: error });
  });
  if (detectFat32(outputDir) && estimate.totalBytes > 4 * 1024 * 1024 * 1024) {
    throw Object.assign(new Error('FAT32 cannot store this backup file; choose NTFS or exFAT'), { code: 'FAT32_LIMIT' });
  }
  const snapshotBytes = await databaseSnapshotEstimate(context);
  const outputFree = await availableBytes(outputDir);
  const dataFree = await availableBytes(context.appPaths.dataDir);
  const outputStat = await fsp.stat(outputDir);
  const dataStat = await fsp.stat(context.appPaths.dataDir).catch(() => null);
  const sameDevice = dataStat && outputStat.dev === dataStat.dev;
  const outputRequired = estimate.totalBytes + SAFETY_MARGIN + (sameDevice ? snapshotBytes + SAFETY_MARGIN : 0);
  if (outputFree !== null && outputFree < outputRequired) {
    throw Object.assign(new Error(`Insufficient destination disk space: need ${outputRequired}, have ${outputFree}`), { code: 'DISK_FULL' });
  }
  const dataRequired = snapshotBytes + SAFETY_MARGIN;
  if (dataFree !== null && dataFree < dataRequired) {
    throw Object.assign(new Error(`Insufficient application disk space for snapshots: need ${dataRequired}, have ${dataFree}`), { code: 'DISK_FULL' });
  }
  return { destination, outputRequired, dataRequired, snapshotBytes };
}

function safeLabel(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const kind = String(entry.kind || 'file');
  if (kind === 'database') return entry.databaseKind === 'rag' ? 'RAG database' : `${entry.databaseKind || 'application'} database`;
  if (kind === 'library-pdf' || kind === 'translated-pdf') return `${kind} ${entry.attachmentId || ''}`.trim();
  if (kind === 'mineru') return 'MinerU cache';
  return kind;
}

function createManifest(context, sources) {
  const packageId = crypto.randomUUID();
  let version = PACKAGE_VERSION;
  try {
    if (typeof context.app?.getVersion === 'function') version = context.app.getVersion();
  } catch {}
  return {
    manifestVersion: 1,
    packageId,
    createdAt: new Date().toISOString(),
    app: {
      name: 'PaperQuay',
      version,
      minReaderVersion: version,
      platform: process.platform,
      arch: process.arch,
    },
    schema: { library: 1, notes: 1, rag: sources.flags.includesRag ? 1 : 0 },
    sourceRoots: sources.sourceRoots,
    resolvedRoots: sources.resolvedRoots,
    counts: sources.counts,
    warnings: sources.warnings,
    warningsTruncated: sources.warningsTruncated,
    entries: [],
  };
}

function toProgressAdapter(onProgress, totalBytes, entries) {
  let lastEmit = 0;
  return (payload = {}) => {
    const now = Date.now();
    if (payload.phase !== 'verifying' && payload.phase !== 'done' && now - lastEmit < 200) return;
    lastEmit = now;
    emitProgress(onProgress, {
      phase: payload.phase || 'writing',
      completedBytes: payload.completedBytes,
      totalBytes: payload.totalBytes || totalBytes,
      completedEntries: payload.completedEntries,
      totalEntries: payload.totalEntries || entries,
      currentLabel: safeLabel(payload.entry) || payload.currentLabel,
    });
  };
}

async function runBackupExport(context, {
  destinationPath,
  password,
  options: rawOptions,
  rendererState = {},
  signal,
  onProgress,
  container,
} = {}) {
  if (typeof password !== 'string') throw Object.assign(new Error('Backup password is required'), { code: 'INVALID_PASSWORD' });
  const options = normalizeOptions(rawOptions);
  const outputPath = assertOutputPath(context, destinationPath);
  const estimate = await estimateBackupSources(context, { rendererState, options, signal });
  const preflight = await preflightExport(context, outputPath, estimate);
  const taskId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const stagingDir = path.join(context.appPaths.dataDir, '.backup-staging', taskId);
  const owner = {
    pid: process.pid,
    startedAt: Date.now(),
    partialPath: `${outputPath}.partial`,
  };
  const ownerPath = path.join(stagingDir, 'owner.json');
  const partialOwnerPath = `${outputPath}.partial.owner.json`;
  const partialPath = `${outputPath}.partial`;
  const writer = container || require('./backupContainer.cjs');
  let succeeded = false;
  let packageCreated = false;
  let partialOwnerCreated = false;
  const startedAt = Date.now();
  try {
    if (fs.existsSync(partialPath) || fs.existsSync(partialOwnerPath)) {
      throw Object.assign(new Error('A previous interrupted backup is using this destination'), { code: 'BACKUP_BUSY' });
    }
    await fsp.mkdir(stagingDir, { recursive: true, mode: 0o700 });
    await writeJsonAtomic(ownerPath, owner);
    const partialOwner = await fsp.open(partialOwnerPath, 'wx', 0o600);
    partialOwnerCreated = true;
    try {
      await partialOwner.writeFile(JSON.stringify(owner), 'utf8');
      await partialOwner.sync();
    } finally {
      await partialOwner.close();
    }
    emitProgress(onProgress, { phase: 'collecting', totalBytes: estimate.totalBytes, totalEntries: estimate.entries, currentLabel: 'Scanning backup sources' });
    const sources = await collectBackupSources(context, { stagingDir, rendererState, options, signal, startedAt });
    const manifest = createManifest(context, sources);
    const progress = toProgressAdapter(onProgress, sources.totalBytes, sources.entries.length);
    const result = await writer.writeBackupPackage({
      outputPath: preflight.destination,
      password,
      manifest,
      entries: sources.entries,
      flags: (sources.flags.includesRag ? 1 : 0) | (sources.flags.includesDerived ? 2 : 0) | (sources.flags.includesVault ? 4 : 0),
      compressionLevel: options.compressionLevel,
      overwrite: false,
      signal,
      onProgress: progress,
    });
    packageCreated = true;
    const packageBytes = Number(result?.bytes) || (await fsp.stat(outputPath)).size;
    if (options.verifyAfterExport) {
      emitProgress(onProgress, { phase: 'verifying', completedBytes: 0, totalBytes: packageBytes, completedEntries: 0, totalEntries: sources.entries.length, currentLabel: 'Verifying backup package' });
      const verifyResult = await writer.verifyBackupPackage({
        packagePath: outputPath,
        password,
        signal,
        onProgress: (payload) => progress({ ...payload, phase: 'verifying' }),
      });
      if (verifyResult?.ok === false) throw Object.assign(new Error('Backup package self-verification failed'), { code: 'SELF_VERIFY_FAILED' });
    }
    const completedAt = Date.now();
    const record = {
      id: taskId,
      type: 'export',
      direction: 'export',
      createdAt: new Date(completedAt).toISOString(),
      packagePath: outputPath,
      bytes: packageBytes,
      entries: sources.entries.length,
      durationMs: completedAt - startedAt,
      verified: options.verifyAfterExport,
      warnings: sources.warnings,
      warningsTruncated: sources.warningsTruncated,
      counts: sources.counts,
    };
    try {
      await appendBackupHistory(context.appPaths, record);
    } catch {
      record.historyWarning = 'BACKUP_HISTORY_WRITE_FAILED';
      if (sources.warnings.length < 1_000) sources.warnings.push({ code: 'BACKUP_HISTORY_WRITE_FAILED' });
      else sources.warningsTruncated += 1;
    }
    succeeded = true;
    emitProgress(onProgress, { phase: 'done', completedBytes: packageBytes, totalBytes: packageBytes, completedEntries: sources.entries.length, totalEntries: sources.entries.length, currentLabel: 'Backup complete' });
    return {
      ok: true,
      packagePath: outputPath,
      bytes: packageBytes,
      entries: sources.entries.length,
      durationMs: record.durationMs,
      warnings: sources.warnings,
      verified: options.verifyAfterExport,
      counts: sources.counts,
    };
  } catch (error) {
    if (packageCreated) await fsp.rm(outputPath, { force: true }).catch(() => undefined);
    const code = signal?.aborted ? 'CANCELLED' : error?.code || 'BACKUP_EXPORT_FAILED';
    emitProgress(onProgress, { phase: 'failed', totalBytes: estimate.totalBytes, totalEntries: estimate.entries, currentLabel: code });
    throw Object.assign(new Error(code === 'CANCELLED' ? 'Backup export cancelled' : error?.message || 'Backup export failed'), { code, cause: error });
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    if (partialOwnerCreated) {
      await fsp.rm(partialOwnerPath, { force: true }).catch(() => undefined);
      if (!succeeded) await fsp.rm(partialPath, { force: true }).catch(() => undefined);
    }
  }
}

async function cleanupOrphanBackupStages(appPaths, { maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const stagingRoot = path.join(appPaths.dataDir, '.backup-staging');
  let entries = [];
  try {
    entries = await fsp.readdir(stagingRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const stagePath = path.join(stagingRoot, entry.name);
    const owner = readJson(path.join(stagePath, 'owner.json'));
    const alive = isProcessAlive(Number(owner?.pid));
    const ageMs = Date.now() - (Number(owner?.startedAt) || 0);
    if (alive === true || (alive === null && ageMs < maxAgeMs)) continue;
    if (typeof owner?.partialPath === 'string' && owner.partialPath.endsWith('.pqbackup.partial')) {
      await fsp.rm(owner.partialPath, { force: true }).catch(() => undefined);
      await fsp.rm(`${owner.partialPath}.owner.json`, { force: true }).catch(() => undefined);
    }
    await fsp.rm(stagePath, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

module.exports = {
  BACKUP_HISTORY_LIMIT,
  SAFETY_MARGIN,
  appendBackupHistory,
  backupHistoryPath,
  cleanupOrphanBackupStages,
  createManifest,
  estimateBackupSources,
  preflightExport,
  readBackupHistory,
  runBackupExport,
  writeJsonAtomic,
};
