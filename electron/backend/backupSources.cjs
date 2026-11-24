const fs = require('node:fs');
const { resolveReaderConfigSecrets } = require('./secretStorage.cjs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('./nodeSqlite.cjs');
const {
  DEFAULT_SNAPSHOT_TIMEOUT_MS,
  snapshotDatabaseInWorker,
} = require('./backupDatabaseSnapshot.cjs');

const MAX_ENTRIES = 200_000;
const MAX_WARNINGS = 1_000;
const VAULT_MANIFEST = '.paperquay-vault.json';
const UNSTABLE_SUFFIXES = ['.tmp', '.part', '.crdownload'];

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pushWarning(warnings, warning) {
  if (warnings.length < MAX_WARNINGS) warnings.push(warning);
  else warnings.truncated = (warnings.truncated || 0) + 1;
}

function safeSegment(value, fallback = 'file') {
  let segment = String(value ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- 需要匹配并剔除不可见控制字符，保持原有字节级语义
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!segment || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)) segment = fallback;
  return segment.slice(0, 120);
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/')) return false;
  const parts = value.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..' && !part.includes(':') &&
    !/[. ]$/.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}

function pathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function realpathOrNull(value) {
  if (!value) return null;
  try {
    return fs.realpathSync.native(value);
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function parseJsonString(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeOptions(options = {}) {
  const preset = ['migration', 'daily', 'custom'].includes(options.preset) ? options.preset : 'migration';
  const compressionLevel = ['fast', 'standard', 'none'].includes(options.compressionLevel)
    ? options.compressionLevel
    : 'standard';
  return {
    preset,
    includeRag: options.includeRag ?? preset === 'migration',
    includeDerived: options.includeDerived ?? preset === 'migration',
    includeVault: options.includeVault !== false,
    includePdfs: options.includePdfs !== false,
    includeRendererState: options.includeRendererState !== false,
    compressionLevel,
    verifyAfterExport: options.selfVerify ?? options.verifyAfterExport ?? true,
  };
}

function createSourceRoots(context, library, config) {
  const settings = library?.settings ?? {};
  const readerSettings = config?.settings ?? {};
  const configured = {
    dataDir: context.appPaths.dataDir,
    libraryStorageDir: cleanString(settings.storageDir),
    translatedPdfDir: cleanString(settings.translatedPdfDir) || null,
    mineruCacheDir: cleanString(readerSettings.mineruCacheDir) || context.appPaths.mineruCacheDir,
    remotePdfDownloadDir: cleanString(readerSettings.remotePdfDownloadDir) || context.appPaths.remotePdfDownloadDir,
    notesVaultDir: cleanString(settings.notesVaultDir) || null,
  };
  const sourceRoots = {};
  const resolvedRoots = {};
  for (const [key, value] of Object.entries(configured)) {
    sourceRoots[key] = value ? path.resolve(value) : null;
    resolvedRoots[key] = realpathOrNull(value);
  }
  return { sourceRoots, resolvedRoots };
}

function identifySourceRoot(filePath, sourceRoots, resolvedRoots) {
  const absolute = path.resolve(filePath);
  const real = realpathOrNull(absolute) || absolute;
  const candidates = [];
  for (const key of Object.keys(sourceRoots)) {
    for (const root of [sourceRoots[key], resolvedRoots[key]]) {
      if (!root) continue;
      const resolved = path.resolve(root);
      if (pathInside(resolved, absolute) || pathInside(resolved, real)) {
        candidates.push({ key, root: resolved, length: resolved.length });
      }
    }
  }
  candidates.sort((left, right) => right.length - left.length);
  if (candidates.length) {
    const selected = candidates[0];
    const relativePath = path.relative(selected.root, pathInside(selected.root, real) ? real : absolute)
      .split(path.sep).join('/');
    if (safeRelativePath(relativePath)) return { sourceRoot: selected.key, relativePath };
  }
  const digest = crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
  return {
    sourceRoot: 'external',
    relativePath: `${digest}/${safeSegment(path.basename(absolute))}`,
  };
}

async function statRegularFile(filePath, warnings, kind, startedAt) {
  let stat;
  try {
    const entry = await fsp.lstat(filePath);
    if (entry.isSymbolicLink()) {
      pushWarning(warnings, { code: 'SYMLINK_IN_ROOT', kind, originalName: safeSegment(path.basename(filePath)) });
      return null;
    }
    if (!entry.isFile()) return null;
    stat = entry;
  } catch (error) {
    const code = error?.code === 'EACCES' || error?.code === 'EPERM' ? 'PERMISSION_DENIED' : 'FILE_MISSING_AT_EXPORT';
    pushWarning(warnings, { code, kind, originalName: safeSegment(path.basename(filePath)) });
    return null;
  }
  const suffix = path.extname(filePath).toLowerCase();
  if (UNSTABLE_SUFFIXES.includes(suffix) || startedAt - stat.mtimeMs < 10_000) {
    pushWarning(warnings, { code: 'FILE_UNSTABLE_AT_EXPORT', kind, originalName: safeSegment(path.basename(filePath)) });
    return null;
  }
  return stat;
}

async function walkFiles(rootDir, { warnings, kind, startedAt, signal, maxEntries = MAX_ENTRIES }) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    if (signal?.aborted) throw Object.assign(new Error('Backup source scan cancelled'), { code: 'CANCELLED' });
    const directory = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      const code = error?.code === 'EACCES' || error?.code === 'EPERM' ? 'PERMISSION_DENIED' : 'FILE_MISSING_AT_EXPORT';
      pushWarning(warnings, { code, kind, originalName: safeSegment(path.basename(directory)) });
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        pushWarning(warnings, { code: 'SYMLINK_IN_ROOT', kind, originalName: safeSegment(entry.name) });
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        const stat = await statRegularFile(absolute, warnings, kind, startedAt);
        if (stat) files.push({ path: absolute, stat });
      }
      if (files.length > maxEntries) throw new Error('Backup package exceeds the entry limit');
    }
  }
  return files;
}

function openReadOnly(databasePath, { rag = false } = {}) {
  const db = new DatabaseSync(databasePath, { readOnly: true, allowExtension: rag });
  if (rag) {
    const sqliteVec = require('sqlite-vec');
    db.enableLoadExtension(true);
    try {
      const loadablePath = typeof sqliteVec.getLoadablePath === 'function' ? sqliteVec.getLoadablePath() : '';
      if (loadablePath) db.loadExtension(loadablePath.replace(/\.asar([\\/])/, '.asar.unpacked$1'));
      else sqliteVec.load(db);
    } finally {
      db.enableLoadExtension(false);
    }
  }
  return db;
}

function readCountsFast(databasePath, kind) {
  const db = openReadOnly(databasePath, { rag: kind === 'rag' });
  try {
    if (kind === 'library') return {
      papers: Number(db.prepare('SELECT COUNT(*) AS n FROM papers').get().n) || 0,
      attachments: Number(db.prepare('SELECT COUNT(*) AS n FROM attachments').get().n) || 0,
    };
    if (kind === 'notes') return {
      notes: Number(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n) || 0,
      noteFolders: Number(db.prepare('SELECT COUNT(*) AS n FROM note_folders').get().n) || 0,
    };
    return {
      ragIndexes: Number(db.prepare('SELECT COUNT(*) AS n FROM rag_indexes').get().n) || 0,
      ragDocuments: Number(db.prepare('SELECT COUNT(DISTINCT document_key) AS n FROM rag_chunks').get().n) || 0,
      ragChunks: Number(db.prepare('SELECT COUNT(*) AS n FROM rag_chunks').get().n) || 0,
    };
  } finally { db.close(); }
}

function makeEntry({ kind, sourcePath, data, sourceRoot, relativePath, packagePath, name, stat, metadata = {}, compression = 'none' }) {
  const size = stat ? stat.size : Buffer.byteLength(data ?? Buffer.alloc(0));
  return {
    kind,
    sourceRoot,
    relativePath,
    packagePath,
    originalName: name || path.basename(relativePath),
    size,
    mtimeMs: stat?.mtimeMs ?? Date.now(),
    compression,
    ...(sourcePath ? { sourcePath } : {}),
    ...(data !== undefined ? { data: Buffer.isBuffer(data) ? data : Buffer.from(data) } : {}),
    ...metadata,
  };
}

function workerSnapshotOptions(context, signal) {
  const configured = Number(context.backupSnapshotTimeoutMs);
  return {
    signal,
    timeoutMs: Number.isFinite(configured) && configured > 0
      ? Math.trunc(configured)
      : DEFAULT_SNAPSHOT_TIMEOUT_MS,
    createWorker: typeof context.createBackupSnapshotWorker === 'function'
      ? context.createBackupSnapshotWorker
      : undefined,
  };
}

async function collectBackupSources(context, {
  stagingDir,
  rendererState = {},
  options: rawOptions,
  signal,
  startedAt = Date.now(),
  snapshots = true,
} = {}) {
  const options = normalizeOptions(rawOptions);
  const warnings = [];
  const library = context.store.load();
  const config = readJsonFile(context.appPaths.configPath) || {};
  const { sourceRoots, resolvedRoots } = createSourceRoots(context, library, config);
  const entries = [];
  let counts = {
    papers: Array.isArray(library?.papers) ? library.papers.length : 0,
    attachments: Array.isArray(library?.papers) ? library.papers.reduce((total, paper) => total + (Array.isArray(paper.attachments) ? paper.attachments.length : 0), 0) : 0,
    notes: 0,
    noteFolders: 0,
    ragIndexes: 0,
    ragDocuments: 0,
    ragChunks: 0,
    agentMemoryFiles: 0,
    localStorageKeys: options.includeRendererState ? Object.keys(rendererState || {}).length : 0,
  };

  function addPathEntry(kind, filePath, packagePath, metadata = {}, compression = 'none') {
    return statRegularFile(filePath, warnings, kind, startedAt).then((stat) => {
      if (!stat) return null;
      const source = identifySourceRoot(filePath, sourceRoots, resolvedRoots);
      if (entries.length >= MAX_ENTRIES) throw new Error('Backup package exceeds the entry limit');
      const entry = makeEntry({ kind, sourcePath: filePath, sourceRoot: source.sourceRoot, relativePath: source.relativePath, packagePath, name: path.basename(filePath), stat, metadata, compression });
      entries.push(entry);
      return entry;
    });
  }

  async function addMemoryEntry(kind, sourceRoot, relativePath, packagePath, data, metadata = {}, compression = 'deflate-raw') {
    if (!safeRelativePath(relativePath)) throw Object.assign(new Error('Unsafe generated backup source path'), { code: 'UNSAFE_ENTRY_PATH' });
    if (entries.length >= MAX_ENTRIES) throw new Error('Backup package exceeds the entry limit');
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let entry;
    if (snapshots && bytes.length > 8 * 1024 * 1024) {
      const sourcePath = path.join(stagingDir, `.source-${entries.length}.json`);
      const handle = await fsp.open(sourcePath, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const stat = await fsp.stat(sourcePath);
      entry = makeEntry({ kind, sourcePath, sourceRoot, relativePath, packagePath, name: path.posix.basename(relativePath), stat, metadata, compression });
    } else {
      entry = makeEntry({ kind, data: bytes, sourceRoot, relativePath, packagePath, name: path.posix.basename(relativePath), metadata, compression });
    }
    entries.push(entry);
    return entry;
  }

  if (snapshots) {
    await fsp.mkdir(stagingDir, { recursive: true });
    const snapshotsToCreate = [
      ['library', context.appPaths.libraryDatabasePath, 'paperquay-library.sqlite'],
      ['notes', context.appPaths.notesDatabasePath, 'paperquay-notes.sqlite'],
    ];
    for (const [kind, sourcePath, fileName] of snapshotsToCreate) {
      if (signal?.aborted) throw Object.assign(new Error('Backup source scan cancelled'), { code: 'CANCELLED' });
      const targetPath = path.join(stagingDir, fileName);
      // VACUUM + integrity_check 在 worker 线程执行；只读连接产出的快照
      // 同时包含 WAL 中尚未 checkpoint 的最新数据。
      const snapshot = await snapshotDatabaseInWorker({
        sourcePath,
        targetPath,
        kind,
        deep: true,
        ...workerSnapshotOptions(context, signal),
      });
      counts = { ...counts, ...snapshot.counts };
      const stat = await fsp.stat(targetPath);
      const entry = makeEntry({
        kind: 'database', sourcePath: targetPath, sourceRoot: 'dataDir', relativePath: fileName,
        packagePath: `data/${fileName}`, name: fileName, stat,
        metadata: { databaseKind: kind, schemaVersion: 1 }, compression: 'none',
      });
      entries.push(entry);
    }
    if (options.includeRag && context.ragStore?.available && typeof context.ragStore.snapshotTo === 'function') {
      const targetPath = path.join(stagingDir, 'paperquay-rag.sqlite');
      const snapshot = await snapshotDatabaseInWorker({
        sourcePath: context.appPaths.ragDatabasePath,
        targetPath,
        kind: 'rag',
        deep: false,
        ...workerSnapshotOptions(context, signal),
      });
      counts = { ...counts, ...snapshot.counts };
      const stat = await fsp.stat(targetPath);
      entries.push(makeEntry({
        kind: 'database', sourcePath: targetPath, sourceRoot: 'dataDir', relativePath: 'paperquay-rag.sqlite',
        packagePath: 'data/paperquay-rag.sqlite', name: 'paperquay-rag.sqlite', stat,
        metadata: { databaseKind: 'rag', schemaVersion: 1 }, compression: 'none',
      }));
    } else if (options.includeRag) {
      pushWarning(warnings, { code: 'RAG_SNAPSHOT_UNAVAILABLE', kind: 'database' });
    }
  } else {
    const databaseSources = [
      ['library', context.appPaths.libraryDatabasePath, 'paperquay-library.sqlite'],
      ['notes', context.appPaths.notesDatabasePath, 'paperquay-notes.sqlite'],
      ...(options.includeRag && context.ragStore?.available && context.ragStore.execution === 'worker'
        ? [['rag', context.appPaths.ragDatabasePath, 'paperquay-rag.sqlite']]
        : []),
    ];
    for (const [databaseKind, sourcePath, fileName] of databaseSources) {
      let size = 0;
      let mtimeMs = 0;
      for (const suffix of ['', '-wal']) {
        try {
          const stat = await fsp.stat(`${sourcePath}${suffix}`);
          if (stat.isFile()) {
            size += stat.size;
            mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
          }
        } catch {}
      }
      if (size === 0) {
        pushWarning(warnings, { code: 'FILE_MISSING_AT_EXPORT', kind: 'database', originalName: fileName });
      } else {
        try { counts = { ...counts, ...readCountsFast(sourcePath, databaseKind) }; }
        catch { pushWarning(warnings, { code: 'DB_COUNT_UNAVAILABLE', kind: 'database', originalName: fileName }); }
      }
      entries.push(makeEntry({
        kind: 'database', sourceRoot: 'dataDir', relativePath: fileName, packagePath: `data/${fileName}`,
        name: fileName, stat: { size, mtimeMs }, metadata: { databaseKind }, compression: 'none',
      }));
    }
    if (options.includeRag && (!context.ragStore?.available || context.ragStore.execution !== 'worker')) {
      pushWarning(warnings, { code: 'RAG_SNAPSHOT_UNAVAILABLE', kind: 'database' });
    }
  }

  const normalizedConfig = { ...config };
  const localSettings = parseJsonString(rendererState?.['paper-reader-settings-v3']);
  const legacySecrets = parseJsonString(rendererState?.['paper-reader-secrets-v1']);
  normalizedConfig.version = Number(normalizedConfig.version) || 1;
  normalizedConfig.settings = {
    ...(normalizedConfig.settings && typeof normalizedConfig.settings === 'object' ? normalizedConfig.settings : {}),
    ...(localSettings && typeof localSettings === 'object' ? localSettings : {}),
  };
  const configSecrets = resolveReaderConfigSecrets(config, context.appPaths) ?? {};
  normalizedConfig.secrets = {
    ...(legacySecrets && typeof legacySecrets === 'object' ? legacySecrets : {}),
    ...(normalizedConfig.secrets && typeof normalizedConfig.secrets === 'object' ? normalizedConfig.secrets : {}),
    ...configSecrets,
  };
  // 备份容器本身有密码加密；把 secrets 以明文写入备份，才能跨机器恢复。
  delete normalizedConfig.secretsEncrypted;
  normalizedConfig.zoteroLocalDataDir = cleanString(normalizedConfig.zoteroLocalDataDir);
  normalizedConfig.settings.mineruCacheDir = sourceRoots.mineruCacheDir;
  normalizedConfig.settings.remotePdfDownloadDir = sourceRoots.remotePdfDownloadDir;
  await addMemoryEntry('config', 'dataDir', '.settings/paperquay.config.json', 'config/paperquay.config.json', Buffer.from(JSON.stringify(normalizedConfig, null, 2)), { encoding: 'utf8' });
  if (options.includeRendererState) {
    await addMemoryEntry('renderer-local-storage', 'dataDir', 'renderer-local-storage.json', 'renderer/local-storage.json', Buffer.from(JSON.stringify(rendererState || {})), { encoding: 'utf8' });
  }

  const graphPath = path.join(context.appPaths.dataDir, 'paperquay-knowledge-graph-relations.json');
  await addPathEntry('knowledge-graph', graphPath, 'data/knowledge-graph-relations.json', {}, 'deflate-raw');

  const attachmentSeen = new Set();
  if (options.includePdfs) {
    for (const paper of Array.isArray(library?.papers) ? library.papers : []) {
      for (const attachment of Array.isArray(paper?.attachments) ? paper.attachments : []) {
        const sourcePath = cleanString(attachment?.storedPath);
        if (!sourcePath || attachment?.missing === true) {
          pushWarning(warnings, { code: 'FILE_MISSING_AT_EXPORT', kind: attachment?.kind === 'translated-pdf' ? 'translated-pdf' : 'library-pdf', originalName: safeSegment(attachment?.fileName || attachment?.name || 'attachment.pdf') });
          continue;
        }
        const kind = attachment?.kind === 'translated-pdf' ? 'translated-pdf' : 'library-pdf';
        const targetRoot = kind === 'translated-pdf' ? 'translated' : 'library';
        const extension = path.extname(sourcePath).slice(0, 12) || '.pdf';
        const entryName = `${safeSegment(paper.id, 'paper')}-${safeSegment(attachment.id, 'attachment')}${extension}`;
        const dedupeKey = `${kind}:${path.resolve(sourcePath).toLowerCase()}`;
        if (attachmentSeen.has(dedupeKey)) continue;
        attachmentSeen.add(dedupeKey);
        await addPathEntry(kind, sourcePath, `${targetRoot}/${entryName}`, {
          paperId: String(paper.id), attachmentId: String(attachment.id), fileName: safeSegment(attachment.fileName || path.basename(sourcePath)),
          sourceAbsolutePath: path.resolve(sourcePath),
          originalSourcePath: cleanString(attachment.originalPath) ? path.resolve(attachment.originalPath) : null,
          expectedContentHash: cleanString(attachment.contentHash),
        });
      }
    }
  }

  if (options.includeDerived) {
    const roots = [
      { key: 'default', value: context.appPaths.mineruCacheDir },
      { key: `custom-${crypto.createHash('sha256').update(String(sourceRoots.mineruCacheDir || '')).digest('hex').slice(0, 8)}`, value: sourceRoots.mineruCacheDir },
    ];
    const scanned = new Set();
    for (const root of roots) {
      if (!root.value || scanned.has(path.resolve(root.value).toLowerCase())) continue;
      scanned.add(path.resolve(root.value).toLowerCase());
      const files = await walkFiles(root.value, { warnings, kind: 'mineru', startedAt, signal });
      for (const file of files) {
        const relative = path.relative(root.value, file.path).split(path.sep).join('/');
        if (!safeRelativePath(relative)) {
          pushWarning(warnings, { code: 'UNSAFE_SOURCE_PATH', kind: 'mineru', originalName: safeSegment(path.basename(file.path)) });
          continue;
        }
        await addPathEntry('mineru', file.path, `derived/mineru/${root.key}/${relative}`);
      }
    }
  }

  if (options.includeVault && sourceRoots.notesVaultDir) {
    const vaultDir = sourceRoots.notesVaultDir;
    const manifestPath = path.join(vaultDir, VAULT_MANIFEST);
    const manifest = readJsonFile(manifestPath);
    const files = manifest?.files && typeof manifest.files === 'object' ? manifest.files : {};
    const vaultEntries = [{ relative: VAULT_MANIFEST, kind: 'manifest' }];
    for (const [noteId, value] of Object.entries(files)) {
      const relative = typeof value === 'string' ? value : cleanString(value?.path);
      if (!safeRelativePath(relative)) {
        pushWarning(warnings, { code: 'VAULT_ORPHAN', kind: 'notes-vault', originalName: safeSegment(noteId) });
        continue;
      }
      vaultEntries.push({ relative, kind: 'note', noteId });
    }
    for (const item of vaultEntries) {
      const sourcePath = path.resolve(vaultDir, ...item.relative.split('/'));
      if (!pathInside(vaultDir, sourcePath)) {
        pushWarning(warnings, { code: 'VAULT_ORPHAN', kind: 'notes-vault', originalName: safeSegment(path.basename(item.relative)) });
        continue;
      }
      const entry = await addPathEntry('notes-vault', sourcePath, `notes-vault/${item.relative}`, item.noteId ? { noteId: item.noteId } : {});
      if (!entry && item.kind === 'note') pushWarning(warnings, { code: 'VAULT_ORPHAN', kind: 'notes-vault', originalName: safeSegment(path.basename(item.relative)) });
    }
  }

  if (entries.length > MAX_ENTRIES) throw new Error('Backup package exceeds the entry limit');
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const flags = {
    includesRag: entries.some((entry) => entry.databaseKind === 'rag'),
    includesDerived: entries.some((entry) => entry.kind === 'mineru'),
    includesVault: entries.some((entry) => entry.kind === 'notes-vault'),
  };
  return {
    entries,
    counts,
    sourceRoots,
    resolvedRoots,
    warnings,
    warningsTruncated: warnings.truncated || 0,
    totalBytes,
    flags,
    options,
  };
}

async function estimateBackupSources(context, { rendererState = {}, options, signal, startedAt = Date.now() } = {}) {
  const result = await collectBackupSources(context, { rendererState, options, signal, startedAt, snapshots: false, stagingDir: '' });
  const breakdown = {
    databases: { entries: 0, totalBytes: 0 },
    pdfs: { entries: 0, totalBytes: 0 },
    rag: { entries: 0, totalBytes: 0 },
    derived: { entries: 0, totalBytes: 0 },
    vault: { entries: 0, totalBytes: 0 },
    rendererState: { entries: 0, totalBytes: 0 },
  };
  for (const entry of result.entries) {
    const group = entry.kind === 'database'
      ? entry.databaseKind === 'rag' ? 'rag' : 'databases'
      : ['library-pdf', 'translated-pdf'].includes(entry.kind) ? 'pdfs'
        : entry.kind === 'mineru' ? 'derived'
          : entry.kind === 'notes-vault' ? 'vault' : 'rendererState';
    breakdown[group].entries += 1;
    breakdown[group].totalBytes += entry.size;
  }
  return {
    entries: result.entries.length,
    totalBytes: result.totalBytes,
    breakdown,
    counts: result.counts,
    warnings: result.warnings,
    warningsTruncated: result.warningsTruncated,
    options: result.options,
  };
}

module.exports = {
  MAX_ENTRIES,
  MAX_WARNINGS,
  collectBackupSources,
  estimateBackupSources,
  identifySourceRoot,
  normalizeOptions,
  pathInside,
  safeRelativePath,
  safeSegment,
};
