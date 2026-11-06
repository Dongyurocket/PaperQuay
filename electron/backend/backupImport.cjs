'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('./nodeSqlite.cjs');
const defaultContainer = require('./backupContainer.cjs');
const { remapRendererStorage } = require('../../src/shared/rendererStorageRemap.cjs');
const { pathInside, safeRelativePath } = require('./backupSources.cjs');
const PACKAGE_VERSION = require('../../package.json').version;
const SUPPORTED_SCHEMA = { library: 1, notes: 1, rag: 1 };
const RESTORE_ROOT_NAME = 'PaperQuay-restore';
const PENDING_NAME = 'pending.json';
const VAULT_MANIFEST = '.paperquay-vault.json';

function codedError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareVersion(left, right) {
  const parse = (value) => String(value || '0').split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function assertCompatibleManifest(manifest, { appVersion = PACKAGE_VERSION, schemaVersions = SUPPORTED_SCHEMA } = {}) {
  if (!isRecord(manifest) || !Array.isArray(manifest.entries) || !isRecord(manifest.app)) {
    throw codedError('INVALID_PACKAGE', 'Backup manifest is incomplete');
  }
  if (compareVersion(manifest.app.version, appVersion) > 0 || compareVersion(manifest.app.minReaderVersion, appVersion) > 0) {
    throw codedError('UNSUPPORTED_VERSION', 'This backup requires a newer version of PaperQuay');
  }
  for (const [name, supported] of Object.entries(schemaVersions)) {
    const incoming = Number(manifest.schema?.[name] ?? 0);
    if (!Number.isFinite(incoming) || incoming > supported) {
      throw codedError('UNSUPPORTED_VERSION', `Backup ${name} schema is newer than this PaperQuay version`);
    }
  }
  return manifest;
}

function containerFor(context, dependencies) {
  return dependencies?.container || context?.container || defaultContainer;
}

function getAppPaths(context) {
  const appPaths = context?.appPaths || context;
  if (!appPaths || typeof appPaths.dataDir !== 'string' || !path.isAbsolute(appPaths.dataDir)) {
    throw codedError('INVALID_ARGUMENT', 'An absolute appPaths.dataDir is required');
  }
  return appPaths;
}

function rootPaths(appPaths) {
  const dataDir = path.resolve(appPaths.dataDir);
  const userDataDir = path.resolve(appPaths.userDataDir || path.dirname(dataDir));
  return {
    dataDir,
    userDataDir,
    restoreRoot: path.join(userDataDir, RESTORE_ROOT_NAME),
    pendingPath: path.join(userDataDir, RESTORE_ROOT_NAME, PENDING_NAME),
    configPath: appPaths.configPath || path.join(dataDir, '.settings', 'paperquay.config.json'),
    libraryDatabasePath: appPaths.libraryDatabasePath || path.join(dataDir, 'paperquay-library.sqlite'),
    notesDatabasePath: appPaths.notesDatabasePath || path.join(dataDir, 'paperquay-notes.sqlite'),
    ragDatabasePath: appPaths.ragDatabasePath || path.join(dataDir, 'paperquay-rag.sqlite'),
    mineruCacheDir: appPaths.mineruCacheDir || path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: appPaths.remotePdfDownloadDir || path.join(dataDir, '.downloads', 'pdfs'),
  };
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
}

function pendingChecksum(pending) {
  const { checksum: _checksum, ...fields } = pending;
  return crypto.createHash('sha256').update(JSON.stringify(sortedJson(fields))).digest('hex');
}

function sealPending(pending) {
  return { ...pending, checksum: pendingChecksum(pending) };
}

function validPending(pending) {
  if (!isRecord(pending) || typeof pending.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(pending.checksum)) return false;
  const actual = Buffer.from(pending.checksum, 'hex');
  const expected = Buffer.from(pendingChecksum(pending), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function writeJsonAtomicSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  const descriptor = fs.openSync(temporaryPath, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporaryPath, filePath);
}

async function syncHandle(handle) {
  try { await handle.sync(); }
  catch (error) {
    if (!(process.platform === 'win32' && error?.code === 'EPERM')) throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  const handle = await fsp.open(temporaryPath, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await syncHandle(handle);
  } finally {
    await handle.close();
  }
  await fsp.rename(temporaryPath, filePath);
  const directory = await fsp.open(path.dirname(filePath), 'r').catch(() => null);
  if (directory) {
    try { await syncHandle(directory); } finally { await directory.close(); }
  }
}

function readJsonSync(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

async function exists(target) {
  try { await fsp.lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function manifestSummary(manifest, packageSize) {
  return {
    createdAt: manifest.createdAt || '',
    app: {
      version: manifest.app?.version || '',
      platform: manifest.app?.platform,
      arch: manifest.app?.arch,
    },
    counts: isRecord(manifest.counts) ? manifest.counts : {},
    totalBytes: manifest.entries.reduce((total, entry) => total + (Number(entry.size) || 0), 0),
    packageBytes: packageSize,
    hasRag: manifest.entries.some((entry) => entry.kind === 'database' && entry.databaseKind === 'rag'),
    hasDerived: manifest.entries.some((entry) => entry.kind === 'mineru'),
    hasVault: manifest.entries.some((entry) => entry.kind === 'notes-vault'),
  };
}

async function inspectBackupPackage({ packagePath, password, ...options }, dependencies) {
  const container = containerFor(null, dependencies);
  const inspected = await container.inspectBackupPackage({ packagePath, password });
  const manifest = assertCompatibleManifest(inspected.manifest, options);
  const warnings = Array.isArray(manifest.warnings) ? manifest.warnings.slice() : [];
  return {
    ok: true,
    manifestSummary: manifestSummary(manifest, inspected.packageSize),
    warnings,
  };
}

function validateAbsoluteTarget(value, label) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
    throw codedError('TARGET_NOT_WRITABLE', `${label} must be an absolute path`);
  }
  return path.resolve(value);
}

async function assertNoLinkPath(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw codedError('UNSAFE_DESTINATION', 'Import destination contains a symbolic link');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function sourceRootValue(roots, key) {
  const value = roots?.[key];
  if (typeof value !== 'string' || !value.trim() || value.trim() === '.') return null;
  return value.trim();
}

function isWindowsAbsolutePath(value) {
  return typeof value === 'string' && (/^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value) || /^\/\/[^/]+\/[^/]+/.test(value));
}

function sourcePathFromRoot(root, relativePath) {
  if (!root || !safeRelativePath(relativePath)) return null;
  const segments = relativePath.split('/');
  return isWindowsAbsolutePath(root)
    ? path.win32.join(root, ...segments)
    : path.posix.join(root, ...segments);
}

function isUnder(candidate, root) {
  return Boolean(root && pathInside(root, candidate));
}

function pathsOverlap(left, right) {
  return Boolean(left && right && (pathInside(left, right) || pathInside(right, left)));
}

function entryOutput(entry, roots) {
  const pkg = String(entry.packagePath || '');
  if (entry.kind === 'database') return { root: roots.stagingDataDir, relativePath: pkg.replace(/^data\//, '') };
  if (entry.kind === 'config') return { root: roots.stagingDataDir, relativePath: '.settings/paperquay.config.json' };
  if (entry.kind === 'renderer-local-storage') return { root: roots.stagingDataDir, relativePath: '.settings/renderer-local-storage.json' };
  if (entry.kind === 'knowledge-graph') return { root: roots.stagingDataDir, relativePath: 'paperquay-knowledge-graph-relations.json' };
  if (entry.kind === 'agent-memory') return { root: roots.stagingDataDir, relativePath: pkg.replace(/^data\//, '') };
  if (entry.kind === 'library-pdf') return { root: roots.stagingAssetsDir, relativePath: pkg.replace(/^library\//, 'library/') };
  if (entry.kind === 'translated-pdf') return { root: roots.stagingAssetsDir, relativePath: pkg.replace(/^translated\//, 'translated/') };
  if (entry.kind === 'mineru') return { root: roots.stagingAssetsDir, relativePath: pkg.replace(/^derived\/mineru\//, 'derived/mineru/') };
  if (entry.kind === 'notes-vault') return { root: roots.stagingAssetsDir, relativePath: pkg.replace(/^notes-vault\//, 'notes-vault/') };
  throw codedError('INVALID_PACKAGE', `Unsupported backup entry kind: ${entry.kind}`);
}

function validateEntryRelative(relativePath) {
  if (!safeRelativePath(relativePath)) throw codedError('UNSAFE_ENTRY_PATH', 'Backup entry path is not a safe relative path');
  return relativePath;
}

function pathsFromRoots(sourceRoots, resolvedRoots, sourceName, relativePath) {
  if (!safeRelativePath(relativePath)) return [];
  return [sourceRootValue(sourceRoots, sourceName), sourceRootValue(resolvedRoots, sourceName)]
    .filter((root, index, roots) => root && roots.indexOf(root) === index)
    .map((root) => sourcePathFromRoot(root, relativePath))
    .filter(Boolean);
}

function makeRootMap(manifest, targets) {
  const map = {};
  const newRoots = {
    dataDir: targets.dataDir,
    libraryStorageDir: targets.libraryStorageDir,
    translatedPdfDir: targets.translatedPdfDir,
    mineruCacheDir: targets.mineruCacheDir,
    remotePdfDownloadDir: targets.remotePdfDownloadDir,
    notesVaultDir: targets.notesVaultDir,
  };
  for (const rootSet of [manifest.sourceRoots || {}, manifest.resolvedRoots || {}]) {
    for (const [key, value] of Object.entries(rootSet)) {
      const sourcePath = sourceRootValue({ [key]: value }, key);
      const destination = newRoots[key];
      if (sourcePath && typeof destination === 'string' && destination) map[sourcePath] = destination;
    }
  }
  return map;
}

function addMappedPath(pathMap, value, rootMap) {
  if (typeof value !== 'string' || !value) return;
  const mapped = mapByRoot(value, rootMap);
  if (mapped && mapped !== value) pathMap[value] = mapped;
}

function buildRendererExactPathMap(state, rootMap, existingPathMap = {}) {
  const pathMap = { ...existingPathMap };
  const history = readJsonValue(state?.['paper-reader-paper-history-v1']);
  if (isRecord(history)) {
    for (const record of Object.values(history)) {
      if (!isRecord(record)) continue;
      for (const [object, fields] of [[record.document, ['localPdfPath', 'translatedPdfPath']], [record, ['lastPdfPath', 'lastMineruPath']]]) {
        if (isRecord(object)) for (const field of fields) addMappedPath(pathMap, object[field], rootMap);
      }
      const sessions = Array.isArray(record.qaSessions) ? record.qaSessions : [];
      for (const session of sessions) collectAttachmentPaths(session?.messages, pathMap, rootMap);
      collectAttachmentPaths(record.qaMessages, pathMap, rootMap);
      addMappedLocalSource(pathMap, record.paperSummarySourceKey, rootMap, true);
      for (const field of ['pdfScrollPositions', 'pdfReadingHeatmaps']) {
        const sourceMap = record[field];
        if (!isRecord(sourceMap)) continue;
        for (const [key, value] of Object.entries(sourceMap)) {
          addMappedLocalSource(pathMap, key, rootMap);
          if (isRecord(value)) addMappedLocalSource(pathMap, value.sourceKey, rootMap);
        }
      }
    }
  }
  const settings = readJsonValue(state?.['paper-reader-settings-v3']);
  if (isRecord(settings)) {
    addMappedPath(pathMap, settings.mineruCacheDir, rootMap);
    addMappedPath(pathMap, settings.remotePdfDownloadDir, rootMap);
  }
  return pathMap;
}

function readJsonValue(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function collectAttachmentPaths(messages, pathMap, rootMap) {
  if (!Array.isArray(messages)) return;
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.attachments)) continue;
    for (const attachment of message.attachments) addMappedPath(pathMap, attachment?.filePath, rootMap);
  }
}

function addMappedLocalSource(pathMap, sourceKey, rootMap, composite = false) {
  if (typeof sourceKey !== 'string') return;
  let prefix = '';
  let sourcePath = sourceKey;
  if (composite) {
    const marker = '::pdf-text::local:';
    const index = sourceKey.indexOf(marker);
    if (index < 0) {
      addMappedLocalSource(pathMap, sourceKey, rootMap);
      return;
    }
    prefix = sourceKey.slice(0, index + marker.length);
    sourcePath = sourceKey.slice(index + marker.length);
  } else if (sourceKey.startsWith('local:')) {
    prefix = 'local:';
    sourcePath = sourceKey.slice(prefix.length);
  } else return;
  const mapped = mapByRoot(sourcePath, rootMap);
  if (mapped && mapped !== sourcePath) pathMap[sourcePath] = mapped;
}

function deriveEntryMaps(manifest, targets, warnings) {
  const pathMap = {};
  for (const entry of manifest.entries) {
    if (!['library-pdf', 'translated-pdf', 'mineru', 'notes-vault'].includes(entry.kind)) continue;
    const oldPaths = pathsFromRoots(manifest.sourceRoots, manifest.resolvedRoots, entry.sourceRoot, entry.relativePath);
    let newPath = null;
    if (entry.kind === 'library-pdf') newPath = path.join(targets.libraryStorageDir, path.basename(entry.packagePath));
    else if (entry.kind === 'translated-pdf') newPath = path.join(targets.translatedPdfDir, path.basename(entry.packagePath));
    else if (entry.kind === 'mineru') {
      const relative = String(entry.packagePath).replace(/^derived\/mineru\/(?:default|custom-[^/]+)\//, '');
      if (safeRelativePath(relative)) newPath = path.join(targets.mineruCacheDir, ...relative.split('/'));
    } else if (entry.kind === 'notes-vault' && targets.notesVaultDir) newPath = path.join(targets.notesVaultDir, ...String(entry.packagePath).replace(/^notes-vault\//, '').split('/'));
    if (newPath) {
      for (const oldPath of oldPaths) pathMap[oldPath] = newPath;
      if (typeof entry.sourceAbsolutePath === 'string' && (path.isAbsolute(entry.sourceAbsolutePath) || isWindowsAbsolutePath(entry.sourceAbsolutePath))) {
        pathMap[entry.sourceAbsolutePath] = newPath;
      }
      if (typeof entry.originalSourcePath === 'string' && (path.isAbsolute(entry.originalSourcePath) || isWindowsAbsolutePath(entry.originalSourcePath))) {
        pathMap[entry.originalSourcePath] = newPath;
      }
    }
  }
  if (!targets.notesVaultDir && manifest.entries.some((entry) => entry.kind === 'notes-vault')) {
    warnings.push('Vault entries were not restored because no notes vault target was selected.');
  }
  return pathMap;
}

function openDatabase(filePath, { rag = false, readOnly = false } = {}) {
  const db = new DatabaseSync(filePath, { readOnly, allowExtension: rag });
  if (rag) {
    const sqliteVec = require('sqlite-vec');
    db.enableLoadExtension(true);
    try {
      const extensionPath = typeof sqliteVec.getLoadablePath === 'function' ? sqliteVec.getLoadablePath() : '';
      if (extensionPath) db.loadExtension(extensionPath.replace(/\.asar([\\/])/, '.asar.unpacked$1'));
      else sqliteVec.load(db);
    } finally {
      db.enableLoadExtension(false);
    }
  }
  return db;
}

function checkIntegrity(filePath, { rag = false, deep = true } = {}) {
  const db = openDatabase(filePath, { rag, readOnly: true });
  try {
    const row = db.prepare(deep ? 'PRAGMA integrity_check' : 'PRAGMA quick_check').get();
    if (!row || Object.values(row)[0] !== 'ok') throw codedError('DB_INTEGRITY_FAILED', `Database integrity check failed: ${path.basename(filePath)}`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function countDatabase(db, kind) {
  const count = (sql) => Number(db.prepare(sql).get().n) || 0;
  if (kind === 'library') return { papers: count('SELECT COUNT(*) AS n FROM papers'), attachments: count('SELECT COUNT(*) AS n FROM attachments') };
  if (kind === 'notes') return { notes: count('SELECT COUNT(*) AS n FROM notes'), noteFolders: count('SELECT COUNT(*) AS n FROM note_folders') };
  return {
    ragIndexes: count('SELECT COUNT(*) AS n FROM rag_indexes'),
    ragDocuments: count('SELECT COUNT(DISTINCT document_key) AS n FROM rag_chunks'),
    ragChunks: count('SELECT COUNT(*) AS n FROM rag_chunks'),
  };
}

function compareCounts(actual, expected) {
  if (!isRecord(expected)) return;
  for (const [key, value] of Object.entries(actual)) {
    if (Number.isFinite(Number(expected[key])) && Number(expected[key]) !== value) {
      throw codedError('DB_INTEGRITY_FAILED', `Backup count mismatch for ${key}`);
    }
  }
}

function validateDatabases(manifest, roots, { deepRag = false } = {}) {
  const counts = {};
  const databaseEntries = manifest.entries.filter((item) => item.kind === 'database');
  const databaseKinds = databaseEntries.map((entry) => entry.databaseKind);
  for (const required of ['library', 'notes']) {
    if (databaseKinds.filter((kind) => kind === required).length !== 1) {
      throw codedError('DB_INTEGRITY_FAILED', `Backup must contain exactly one ${required} database`);
    }
  }
  if (databaseKinds.filter((kind) => kind === 'rag').length > 1) throw codedError('INVALID_PACKAGE', 'Backup contains duplicate RAG databases');
  for (const entry of databaseEntries) {
    const kind = entry.databaseKind;
    if (!['library', 'notes', 'rag'].includes(kind)) throw codedError('INVALID_PACKAGE', 'Database entry has an unknown databaseKind');
    const databasePath = path.join(roots.stagingDataDir, ...String(entry.packagePath).replace(/^data\//, '').split('/'));
    if (!fs.existsSync(databasePath)) throw codedError('DB_INTEGRITY_FAILED', `Missing ${kind} database`);
    const db = checkIntegrity(databasePath, { rag: kind === 'rag', deep: kind !== 'rag' || deepRag });
    try {
      const databaseCounts = countDatabase(db, kind);
      compareCounts(databaseCounts, manifest.counts);
      Object.assign(counts, databaseCounts);
    } finally {
      db.close();
    }
  }
  if (!counts.papers && manifest.counts?.papers) throw codedError('DB_INTEGRITY_FAILED', 'Library database is missing');
  if (!counts.notes && manifest.counts?.notes) throw codedError('DB_INTEGRITY_FAILED', 'Notes database is missing');
  return counts;
}

function dbTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try { callback(); db.exec('COMMIT'); } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

function updateLibraryPaths(databasePath, { targets, pathMap, warnings }) {
  const db = openDatabase(databasePath);
  try {
    dbTransaction(db, () => {
      const settings = Object.fromEntries(db.prepare('SELECT key, value_json FROM library_settings').all().map((row) => {
        try { return [row.key, JSON.parse(row.value_json)]; } catch { return [row.key, null]; }
      }));
      settings.storageDir = targets.libraryStorageDir;
      settings.translatedPdfDir = targets.translatedPdfDir;
      settings.notesVaultDir = targets.notesVaultDir || '';
      settings.zoteroLocalDataDir = '';
      settings.folderWatchEnabled = false;
      delete settings.backupEnabled;
      const writeSetting = db.prepare('INSERT INTO library_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json');
      for (const [key, value] of Object.entries(settings)) writeSetting.run(key, JSON.stringify(value));

      const attachments = db.prepare('SELECT id, stored_path, original_path, content_hash FROM attachments').all();
      const update = db.prepare('UPDATE attachments SET stored_path=?, relative_path=?, file_name=?, file_size=?, missing=?, original_path=?, content_hash=? WHERE id=?');
      for (const attachment of attachments) {
        const mappedPath = pathMap[attachment.stored_path] || mapByRoot(attachment.stored_path, targets.rootMap) || attachment.stored_path;
        const stat = fs.existsSync(mappedPath) ? fs.statSync(mappedPath) : null;
        const originalPath = attachment.original_path && (pathMap[attachment.original_path] || mapByRoot(attachment.original_path, targets.rootMap)) || attachment.original_path;
        const mappedHash = stat ? hashFile(mappedPath) : null;
        let contentHash = attachment.content_hash;
        if (!contentHash && mappedHash) contentHash = mappedHash;
        else if (contentHash && mappedHash && contentHash !== mappedHash) warnings.push({ code: 'CONTENT_HASH_MISMATCH', kind: 'attachment', detail: String(attachment.id) });
        const relative = stat && pathInside(targets.libraryStorageDir, mappedPath) ? path.relative(targets.libraryStorageDir, mappedPath).split(path.sep).join('/') : null;
        update.run(mappedPath, relative, stat ? path.basename(mappedPath) : path.basename(mappedPath), stat?.size || 0, stat ? 0 : 1, originalPath || null, contentHash || null, attachment.id);
      }
    });
  } finally { db.close(); }
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function mapByRoot(filePath, rootMap) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const entries = Object.entries(rootMap || {}).filter(([source, target]) => source && target).sort((a, b) => b[0].length - a[0].length);
  for (const [source, target] of entries) {
    const windows = isWindowsAbsolutePath(source);
    const normalize = (value) => windows ? value.replace(/[\\/]/g, '\\\\') : value;
    const comparablePath = normalize(filePath);
    const comparableRoot = normalize(source);
    const equalPath = windows ? comparablePath.toLowerCase() === comparableRoot.toLowerCase() : comparablePath === comparableRoot;
    if (equalPath) return target;
    const prefixRoot = comparableRoot.replace(/[\\/]+$/, '');
    const prefix = `${prefixRoot}\\`;
    const matches = windows
      ? comparablePath.toLowerCase().startsWith(prefix.toLowerCase())
      : comparablePath.startsWith(`${prefixRoot}/`);
    if (!matches) continue;
    const remainder = comparablePath.slice(prefix.length).split(/[\\/]+/).filter(Boolean);
    return path.join(target, ...remainder);
  }
  return null;
}

function isExistingDirectory(value) {
  try { return fs.statSync(value).isDirectory() && fs.readdirSync(value).length > 0; } catch { return false; }
}

async function nearestExistingDirectory(value) {
  let current = path.resolve(value);
  while (true) {
    try {
      if ((await fsp.stat(current)).isDirectory()) return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

async function availableBytes(directory) {
  try {
    const stats = await fsp.statfs(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch { return null; }
}

async function assertImportDiskSpace(base, libraryStorageDir, manifest) {
  const dataBytes = manifest.entries.reduce((sum, entry) => sum + (['database', 'config', 'renderer-local-storage', 'knowledge-graph', 'agent-memory'].includes(entry.kind) ? entry.size : 0), 0);
  const assetBytes = manifest.entries.reduce((sum, entry) => sum + (['library-pdf', 'translated-pdf', 'mineru', 'notes-vault', 'other'].includes(entry.kind) ? entry.size : 0), 0);
  const oldDataBytes = await directorySizeAsync(base.dataDir);
  const dataRoot = await nearestExistingDirectory(base.dataDir);
  const assetRoot = await nearestExistingDirectory(path.dirname(libraryStorageDir));
  const [dataFree, assetFree, dataStat, assetStat] = await Promise.all([
    availableBytes(dataRoot), availableBytes(assetRoot), fsp.stat(dataRoot), fsp.stat(assetRoot),
  ]);
  const sameVolume = dataStat.dev === assetStat.dev;
  const requiredData = dataBytes + oldDataBytes + 1024 ** 3;
  const requiredAssets = assetBytes + 1024 ** 3;
  const requiredTotal = sameVolume ? requiredData + assetBytes : requiredData;
  if (dataFree !== null && dataFree < requiredTotal) {
    throw codedError('DISK_FULL', `Insufficient free space for restore staging: need ${requiredTotal} bytes`);
  }
  if (!sameVolume && assetFree !== null && assetFree < requiredAssets) {
    throw codedError('DISK_FULL', `Insufficient free space for restore assets: need ${requiredAssets} bytes`);
  }
  return { dataBytes, assetBytes, oldDataBytes, requiredData, requiredAssets };
}

async function stageBackupImport(context, input, dependencies) {
  const appPaths = getAppPaths(context);
  const base = rootPaths(appPaths);
  const container = containerFor(context, dependencies);
  const {
    packagePath,
    password,
    targets: requestedTargets = {},
    currentRendererState = {},
    signal = dependencies?.signal || context?.signal,
    onProgress = dependencies?.onProgress,
  } = input || {};
  if (typeof packagePath !== 'string' || !path.isAbsolute(packagePath)) throw codedError('INVALID_PACKAGE', 'Package path must be absolute');
  const manifest = assertCompatibleManifest((await container.inspectBackupPackage({ packagePath, password })).manifest);
  const roots = { sourceRoots: manifest.sourceRoots || {}, resolvedRoots: manifest.resolvedRoots || {} };
  const libraryStorageDir = validateAbsoluteTarget(requestedTargets.libraryStorageDir, 'libraryStorageDir');
  const translatedPdfDir = validateAbsoluteTarget(requestedTargets.translatedPdfDir || path.join(libraryStorageDir, 'translated-pdfs'), 'translatedPdfDir');
  const hasVault = manifest.entries.some((entry) => entry.kind === 'notes-vault');
  const notesVaultDir = requestedTargets.notesVaultDir ? validateAbsoluteTarget(requestedTargets.notesVaultDir, 'notesVaultDir') : '';
  const restoreId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
  const stagingDir = path.join(base.restoreRoot, restoreId);
  const stagingDataDir = path.join(stagingDir, 'data');
  const stagingAssetsDir = path.join(path.dirname(libraryStorageDir), `.pq-import-${restoreId}`);
  const oldLibrarySettings = readLibrarySettings(base.libraryDatabasePath);
  const previousLibraryStorageDir = oldLibrarySettings.storageDir || '';
  const stamp = Date.now();
  const oldLibraryDir = isExistingDirectory(libraryStorageDir)
    ? `${libraryStorageDir}.pre-import-${stamp}`
    : null;
  const oldTranslatedPdfDir = !pathInside(libraryStorageDir, translatedPdfDir) && isExistingDirectory(translatedPdfDir)
    ? `${translatedPdfDir}.pre-import-${stamp}`
    : null;
  const previous = {
    libraryStorageDir: previousLibraryStorageDir,
    translatedPdfDir: oldLibrarySettings.translatedPdfDir || '',
    notesVaultDir: oldLibrarySettings.notesVaultDir || '',
  };
  const warnings = Array.isArray(manifest.warnings) ? manifest.warnings.slice() : [];
  const includesRendererState = manifest.entries.some((entry) => entry.kind === 'renderer-local-storage');
  if (!includesRendererState) warnings.push({ code: 'RENDERER_STATE_NOT_INCLUDED', kind: 'renderer-local-storage' });
  const targets = {
    dataDir: base.dataDir,
    libraryStorageDir,
    translatedPdfDir,
    mineruCacheDir: base.mineruCacheDir,
    remotePdfDownloadDir: base.remotePdfDownloadDir,
    notesVaultDir: hasVault ? notesVaultDir : '',
  };
  if (hasVault && !notesVaultDir) warnings.push('Backup contains a notes vault, but no destination was selected.');
  if (await exists(base.pendingPath)) throw codedError('RESTORE_LOCK_CONFLICT', 'Another backup restore is already pending');
  const sourceMineruRoots = [sourceRootValue(roots.sourceRoots, 'mineruCacheDir'), sourceRootValue(roots.resolvedRoots, 'mineruCacheDir')].filter(Boolean);
  const sourceVaultRoots = [sourceRootValue(roots.sourceRoots, 'notesVaultDir'), sourceRootValue(roots.resolvedRoots, 'notesVaultDir')].filter(Boolean);
  for (const candidate of [packagePath, libraryStorageDir, translatedPdfDir, notesVaultDir].filter(Boolean)) {
    const allowedOldLibraryTarget = candidate === libraryStorageDir || candidate === translatedPdfDir;
    const insidePreviousLibrary = isUnder(candidate, previousLibraryStorageDir) && !allowedOldLibraryTarget;
    if (isUnder(candidate, base.dataDir) || insidePreviousLibrary ||
        sourceMineruRoots.some((root) => isUnder(candidate, root)) || sourceVaultRoots.some((root) => isUnder(candidate, root))) {
      throw codedError('UNSAFE_DESTINATION', 'Package and restore destinations cannot be inside data, library, MinerU cache or vault roots');
    }
  }
  if (pathsOverlap(libraryStorageDir, notesVaultDir) || pathsOverlap(translatedPdfDir, notesVaultDir)) {
    throw codedError('UNSAFE_DESTINATION', 'The notes vault destination cannot overlap the library or translated PDF directory');
  }
  if (pathsOverlap(libraryStorageDir, translatedPdfDir) && !pathInside(libraryStorageDir, translatedPdfDir)) {
    throw codedError('UNSAFE_DESTINATION', 'Translated PDFs may be inside the library directory, not its parent');
  }
  for (const target of [libraryStorageDir, translatedPdfDir, notesVaultDir].filter(Boolean)) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await assertNoLinkPath(target);
  }
  const spaceEstimate = await assertImportDiskSpace(base, libraryStorageDir, manifest);
  const snapshotPath = path.join(stagingDir, 'renderer-local-storage.pre-import.json');
  const createdTargets = [];
  try {
    await fsp.mkdir(stagingDataDir, { recursive: true, mode: 0o700 });
    await fsp.mkdir(stagingAssetsDir, { recursive: true, mode: 0o700 });
    const owner = { pid: process.pid, startedAt: Date.now(), restoreId };
    await writeJsonAtomic(path.join(stagingDir, 'owner.json'), owner);
    await writeJsonAtomic(path.join(stagingAssetsDir, 'owner.json'), owner);
    await writeJsonAtomic(snapshotPath, isRecord(currentRendererState) ? currentRendererState : {});
    await container.extractBackupPackage({
      packagePath,
      password,
      resolveDestination: async (entry) => {
        const destination = entryOutput(entry, { stagingDataDir, stagingAssetsDir });
        validateEntryRelative(destination.relativePath);
        return destination;
      },
      onEntry: async ({ entry, outputPath }) => {
        if (outputPath) createdTargets.push(outputPath);
        if (dependencies?.onEntry) await dependencies.onEntry({ entry, outputPath });
      },
      onProgress,
      signal,
    });
    validateDatabases(manifest, { stagingDataDir }, { deepRag: dependencies?.deepRag });
    const packageRendererPath = path.join(stagingDataDir, '.settings', 'renderer-local-storage.json');
    const packageState = readJsonSync(packageRendererPath, {});
    const settingsPath = path.join(stagingDataDir, '.settings', 'paperquay.config.json');
    const config = readJsonSync(settingsPath, {});
    const legacySecrets = packageState['paper-reader-secrets-v1'];
    if (isRecord(legacySecrets)) {
      config.secrets = isRecord(config.secrets) ? config.secrets : {};
      for (const [key, value] of Object.entries(legacySecrets)) {
        if (config.secrets[key] === undefined || config.secrets[key] === null || config.secrets[key] === '') config.secrets[key] = value;
      }
      delete packageState['paper-reader-secrets-v1'];
    }
    const rootMap = makeRootMap(manifest, targets);
    const pathMap = buildRendererExactPathMap(packageState, rootMap, deriveEntryMaps(manifest, targets, warnings));
    const remapped = remapRendererStorage(isRecord(packageState) ? packageState : {}, {
      pathMap,
      rootMap,
      platform: manifest.app?.platform || process.platform,
      hasMineruCache: manifest.entries.some((entry) => entry.kind === 'mineru'),
    });
    warnings.push(...remapped.warnings);
    if (fs.existsSync(packageRendererPath)) await writeJsonAtomic(packageRendererPath, remapped.state);
    config.version = Number(config.version) || 1;
    config.zoteroLocalDataDir = '';
    config.settings = {
      ...(isRecord(config.settings) ? config.settings : {}),
      mineruCacheDir: targets.mineruCacheDir,
      remotePdfDownloadDir: targets.remotePdfDownloadDir,
      autoMineruParse: false,
      autoGenerateSummary: false,
      notesVaultAutoSyncEnabled: false,
    };
    if (fs.existsSync(settingsPath)) await writeJsonAtomic(settingsPath, config);
    const dataStat = await fsp.stat(stagingDataDir);
    const oldDataBytes = spaceEstimate.oldDataBytes;
    const oldLibraryBytes = oldLibraryDir ? await directorySizeAsync(libraryStorageDir) : 0;
    const oldTranslatedPdfBytes = oldTranslatedPdfDir ? await directorySizeAsync(translatedPdfDir) : 0;
    const restorePayload = includesRendererState ? {
      restoreId,
      state: remapped.state,
      pathMap,
      rootMap,
      warnings,
      hasMineruCache: manifest.entries.some((entry) => entry.kind === 'mineru'),
      mode: 'import',
      createdAt: new Date().toISOString(),
    } : null;
    const pending = sealPending({
      version: 1,
      restoreId,
      createdAt: new Date().toISOString(),
      step: 'prepared',
      stagingDir,
      stagingDataDir,
      stagingAssetsDir,
      rendererSnapshotPath: snapshotPath,
      oldDataDir: `${base.dataDir}.pre-import-${Date.now()}`,
      oldLibraryDir,
      oldTranslatedPdfDir,
      targets,
      previous,
      sourceRoots: manifest.sourceRoots || {},
      resolvedRoots: manifest.resolvedRoots || {},
      pathMap,
      rootMap,
      warnings,
      restorePayload,
      mode: 'import',
      package: { createdAt: manifest.createdAt, version: manifest.app.version, packagePath },
      sizeEstimate: { stagingDataBytes: dataStat.size, oldDataBytes, oldLibraryBytes, oldTranslatedPdfBytes },
    });
    await writeJsonAtomic(base.pendingPath, pending);
    return { ok: true, restoreId, restartRequired: true };
  } catch (error) {
    await Promise.all([
      fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {}),
      fsp.rm(stagingAssetsDir, { recursive: true, force: true }).catch(() => {}),
    ]);
    throw error;
  }
}

function readLibrarySettings(databasePath) {
  try {
    const db = openDatabase(databasePath, { readOnly: true });
    try {
      return Object.fromEntries(db.prepare('SELECT key, value_json FROM library_settings').all().map((row) => {
        try { return [row.key, JSON.parse(row.value_json)]; } catch { return [row.key, null]; }
      }));
    } finally { db.close(); }
  } catch { return {}; }
}

async function moveDirectory(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try { await fsp.rename(source, destination); }
  catch (error) {
    if (!['EXDEV', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    await fsp.cp(source, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: false });
    await fsp.rm(source, { recursive: true, force: true });
  }
}

async function copyTreeNoOverwrite(source, destination, warnings, prefix = '') {
  if (!(await exists(source))) return;
  await fsp.mkdir(destination, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = await fsp.lstat(sourcePath);
    if (stat.isSymbolicLink()) throw codedError('UNSAFE_DESTINATION', 'Staged assets cannot contain symbolic links');
    if (entry.isDirectory()) {
      await copyTreeNoOverwrite(sourcePath, destinationPath, warnings, relative);
      continue;
    }
    try {
      await fsp.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      warnings.push({ code: 'ASSET_CONFLICT', kind: 'asset', originalName: relative });
    }
  }
}

async function installAssets(pending) {
  const libraryStage = path.join(pending.stagingAssetsDir, 'library');
  const translatedStage = path.join(pending.stagingAssetsDir, 'translated');
  const mineruStage = path.join(pending.stagingAssetsDir, 'derived', 'mineru');
  const vaultStage = path.join(pending.stagingAssetsDir, 'notes-vault');
  if (pending.oldLibraryDir && await exists(pending.targets.libraryStorageDir) && !(await exists(pending.oldLibraryDir))) {
    await moveDirectory(pending.targets.libraryStorageDir, pending.oldLibraryDir);
  }
  if (pending.oldTranslatedPdfDir && await exists(pending.targets.translatedPdfDir) && !(await exists(pending.oldTranslatedPdfDir))) {
    await moveDirectory(pending.targets.translatedPdfDir, pending.oldTranslatedPdfDir);
  }
  await copyTreeNoOverwrite(libraryStage, pending.targets.libraryStorageDir, pending.warnings);
  await copyTreeNoOverwrite(translatedStage, pending.targets.translatedPdfDir, pending.warnings);
  if (await exists(mineruStage)) await copyTreeNoOverwrite(mineruStage, pending.targets.mineruCacheDir, pending.warnings);
  if (pending.targets.notesVaultDir && await exists(vaultStage)) await mergeVault(vaultStage, pending.targets.notesVaultDir, pending.warnings);
}

async function installRollbackAssets(pending) {
  const libraryDestination = pending.rollbackLibraryDestination || pending.targets.libraryStorageDir;
  const currentLibrary = pending.rollbackCurrentLibraryDir || libraryDestination;
  const displacedLibrary = currentLibrary ? `${currentLibrary}.rolledback-${pending.restoreId}` : '';
  if (currentLibrary && await exists(currentLibrary) && !(await exists(displacedLibrary))) {
    await moveDirectory(currentLibrary, displacedLibrary);
  }
  if (pending.rollbackLibraryDir && await exists(pending.rollbackLibraryDir) && !(await exists(libraryDestination))) {
    await moveDirectory(pending.rollbackLibraryDir, libraryDestination);
  }

  const translatedDestination = pending.rollbackTranslatedDestination || pending.targets.translatedPdfDir;
  const currentTranslated = pending.rollbackCurrentTranslatedPdfDir || translatedDestination;
  const displacedTranslated = currentTranslated ? `${currentTranslated}.rolledback-${pending.restoreId}` : '';
  if (currentTranslated && await exists(currentTranslated) && !(await exists(displacedTranslated))) {
    await moveDirectory(currentTranslated, displacedTranslated);
  }
  if (pending.rollbackTranslatedPdfDir && await exists(pending.rollbackTranslatedPdfDir) && !(await exists(translatedDestination))) {
    await moveDirectory(pending.rollbackTranslatedPdfDir, translatedDestination);
  }
}

async function mergeVault(stagingVault, destinationVault, warnings) {
  await fsp.mkdir(destinationVault, { recursive: true });
  const packageManifestPath = path.join(stagingVault, VAULT_MANIFEST);
  const currentManifestPath = path.join(destinationVault, VAULT_MANIFEST);
  const packageManifest = readJsonSync(packageManifestPath, { files: {} });
  const currentManifest = readJsonSync(currentManifestPath, null);
  if (!currentManifest) {
    await copyTreeNoOverwrite(stagingVault, destinationVault, warnings);
    return;
  }
  const stamp = Date.now();
  await fsp.copyFile(currentManifestPath, `${currentManifestPath}.pre-import-${stamp}`);
  const files = { ...(isRecord(currentManifest.files) ? currentManifest.files : {}) };
  for (const [noteId, value] of Object.entries(packageManifest.files || {})) {
    if (Object.prototype.hasOwnProperty.call(files, noteId)) {
      warnings.push({ code: 'VAULT_CONFLICT', kind: 'notes-vault', originalName: String(noteId) });
      continue;
    }
    const relative = typeof value === 'string' ? value : value?.path;
    if (!safeRelativePath(relative)) continue;
    const source = path.join(stagingVault, ...relative.split('/'));
    const target = path.join(destinationVault, ...relative.split('/'));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (!(await exists(target)) && await exists(source)) {
      await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      files[noteId] = value;
    } else warnings.push({ code: 'VAULT_CONFLICT', kind: 'notes-vault', originalName: path.basename(relative) });
  }
  const merged = { ...currentManifest, files };
  await writeJsonAtomic(currentManifestPath, merged);
}

async function persistStep(base, pending, step) {
  pending.step = step;
  await writeJsonAtomic(base.pendingPath, sealPending(pending));
}

function pidState(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    return null;
  }
}

async function cleanupOrphanBackupImports(appPaths, { maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const base = rootPaths(getAppPaths(appPaths));
  const pending = readJsonSync(base.pendingPath, null);
  const retained = new Set([pending?.stagingDir, pending?.stagingAssetsDir].filter(Boolean).map((value) => path.resolve(value)));
  const removed = [];
  for (const root of [base.restoreRoot, path.dirname(base.dataDir)]) {
    let entries = [];
    try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(root, entry.name);
      const isImportStage = root === base.restoreRoot && entry.isDirectory();
      const isAssetStage = root === path.dirname(base.dataDir) && entry.isDirectory() && entry.name.startsWith('.pq-import-');
      if ((!isImportStage && !isAssetStage) || retained.has(path.resolve(candidate))) continue;
      const owner = readJsonSync(path.join(candidate, 'owner.json'), null);
      const alive = pidState(Number(owner?.pid));
      const stat = await fsp.stat(candidate).catch(() => null);
      const age = stat ? Date.now() - stat.mtimeMs : 0;
      if (alive === true || (alive === null && age < maxAgeMs)) continue;
      await fsp.rm(candidate, { recursive: true, force: true });
      removed.push(candidate);
    }
  }
  return removed;
}

async function applyPendingBackupRestore(appPaths, { app, dialog, marker, onError } = {}) {
  const base = rootPaths(getAppPaths(appPaths));
  let pending = readJsonSync(base.pendingPath, null);
  if (!pending) return { rendererRestorePayload: null, restored: false, dataDir: base.dataDir };
  if (!validPending(pending)) {
    await fsp.rename(base.pendingPath, `${base.pendingPath.slice(0, -5)}.error.json`).catch(() => {});
    return { rendererRestorePayload: null, restored: false, dataDir: base.dataDir, error: 'PENDING_CHECKSUM_INVALID' };
  }
  const rendererPath = pending.mode === 'rollback'
    ? pending.rendererSnapshotPath
    : path.join(pending.stagingDataDir, '.settings', 'renderer-restore.json');
  try {
    if (marker) await marker(base.dataDir);
    if (pending.step === 'prepared') {
      if (!(await exists(pending.stagingDataDir))) throw codedError('STAGING_MISSING', 'Restore staging data is missing');
      if (await exists(pending.oldDataDir)) pending.oldDataDir = `${pending.oldDataDir}-${Date.now()}`;
      await persistStep(base, pending, 'swapping');
    }
    if (pending.step === 'swapping') {
      if (await exists(base.dataDir) && !(await exists(pending.oldDataDir))) await moveDirectory(base.dataDir, pending.oldDataDir);
      if (!(await exists(base.dataDir)) && await exists(pending.stagingDataDir)) await moveDirectory(pending.stagingDataDir, base.dataDir);
      if (!(await exists(base.dataDir))) throw codedError('RESTORE_APPLY_FAILED', 'Neither the new nor old data directory is available');
      if (pending.mode === 'rollback') await installRollbackAssets(pending);
      else {
        await installAssets(pending);
        const libraryDbPath = path.join(base.dataDir, 'paperquay-library.sqlite');
        if (await exists(libraryDbPath)) {
          updateLibraryPaths(libraryDbPath, {
            targets: { ...pending.targets, rootMap: pending.rootMap || {} },
            pathMap: pending.pathMap || {},
            warnings: pending.warnings || [],
          });
        }
      }
      await persistStep(base, pending, 'rebinding');
    }
    if (pending.step === 'rebinding') {
      const restoreFile = path.join(base.dataDir, '.settings', 'renderer-restore.json');
      const payload = pending.restorePayload;
      if (payload) await writeJsonAtomic(restoreFile, payload);
      const summary = {
        restoreId: pending.restoreId,
        createdAt: pending.createdAt,
        package: pending.package || null,
        sourceVersion: pending.package?.version || null,
        packagePath: pending.package?.packagePath || null,
        targets: pending.targets,
        oldDataDir: pending.oldDataDir,
        oldLibraryDir: pending.oldLibraryDir || null,
        oldTranslatedPdfDir: pending.oldTranslatedPdfDir || null,
        sizeEstimate: pending.sizeEstimate || null,
        previous: pending.previous || {},
        warnings: pending.warnings || [],
      };
      await writeJsonAtomic(path.join(base.dataDir, '.settings', 'restore-summary.json'), summary);
      pending.rendererRestorePath = restoreFile;
      await persistStep(base, pending, 'done');
    }
    if (pending.step === 'done') {
      const payloadPath = path.join(base.dataDir, '.settings', 'renderer-restore.json');
      const rendererRestorePayload = readJsonSync(payloadPath, null);
      if (pending.mode !== 'rollback' && pending.rendererSnapshotPath && await exists(pending.rendererSnapshotPath) && await exists(pending.oldDataDir)) {
        const previousSettings = path.join(pending.oldDataDir, '.settings');
        await fsp.mkdir(previousSettings, { recursive: true });
        await fsp.rename(pending.rendererSnapshotPath, path.join(previousSettings, 'renderer-local-storage.pre-import.json')).catch(() => {});
      }
      const historyPath = path.join(base.dataDir, '.settings', 'backup-history.json');
      const history = readJsonSync(historyPath, []);
      const records = Array.isArray(history) ? history : [];
      if (!records.some((record) => record.restoreId === pending.restoreId)) {
        records.unshift({
          direction: pending.mode === 'rollback' ? 'rollback' : 'import',
          createdAt: pending.createdAt,
          completedAt: new Date().toISOString(),
          packagePath: pending.package?.packagePath,
          sourceVersion: pending.package?.version || null,
          result: 'success',
          warnings: pending.warnings || [],
          restoreId: pending.restoreId,
        });
        await writeJsonAtomic(historyPath, records.slice(0, 5));
      }
      await fsp.rm(pending.stagingDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(pending.stagingAssetsDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(base.pendingPath, { force: true });
      if (marker) await marker(base.dataDir);
      return { rendererRestorePayload, restored: true, dataDir: base.dataDir, restoreId: pending.restoreId };
    }
    return { rendererRestorePayload: readJsonSync(rendererPath, null), restored: true, dataDir: base.dataDir, restoreId: pending.restoreId };
  } catch (error) {
    await rollbackFailedRestore(base, pending, error, { dialog, onError });
    throw error;
  }
}

async function rollbackFailedRestore(base, pending, error, { dialog, onError } = {}) {
  const failedDir = `${base.dataDir}.failed-${pending.restoreId}`;
  const swapped = await exists(pending.oldDataDir);
  try {
    if (swapped) {
      if (await exists(base.dataDir) && !(await exists(failedDir))) await moveDirectory(base.dataDir, failedDir);
      if (!(await exists(base.dataDir))) await moveDirectory(pending.oldDataDir, base.dataDir);
      if (pending.mode !== 'rollback') {
        if (pending.oldLibraryDir && await exists(pending.oldLibraryDir)) {
          if (await exists(pending.targets.libraryStorageDir)) {
            await moveDirectory(pending.targets.libraryStorageDir, `${pending.targets.libraryStorageDir}.failed-${pending.restoreId}`);
          }
          await moveDirectory(pending.oldLibraryDir, pending.targets.libraryStorageDir);
        }
        if (pending.oldTranslatedPdfDir && await exists(pending.oldTranslatedPdfDir)) {
          if (await exists(pending.targets.translatedPdfDir)) await moveDirectory(pending.targets.translatedPdfDir, `${pending.targets.translatedPdfDir}.failed-${pending.restoreId}`);
          await moveDirectory(pending.oldTranslatedPdfDir, pending.targets.translatedPdfDir);
        }
      }
    }
    const restoreError = { code: error.code || 'RESTORE_APPLY_FAILED', message: error.message, restoreId: pending.restoreId, dataWasSwapped: swapped };
    await writeJsonAtomic(path.join(base.dataDir, '.settings', 'restore-error.json'), restoreError).catch(() => {});
    await fsp.rm(path.join(base.dataDir, '.settings', 'renderer-restore.json'), { force: true }).catch(() => {});
    if (swapped && pending.rendererSnapshotPath && await exists(pending.rendererSnapshotPath)) {
      const snapshot = readJsonSync(pending.rendererSnapshotPath, {});
      const rollbackPayload = {
        restoreId: crypto.randomUUID(), mode: 'rollback', state: isRecord(snapshot) ? snapshot : {},
        pathMap: {}, rootMap: {}, warnings: [{ code: 'RESTORE_ROLLED_BACK' }],
      };
      await writeJsonAtomic(path.join(base.dataDir, '.settings', 'renderer-restore.json'), rollbackPayload);
    }
  } catch (rollbackError) {
    if (onError) await onError(rollbackError);
  } finally {
    await fsp.rm(pending.stagingDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(pending.stagingAssetsDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(base.pendingPath, { force: true }).catch(() => {});
  }
  if (dialog?.showErrorBox) dialog.showErrorBox('PaperQuay restore failed', `The previous data was restored when possible. Details: ${error.message}`);
}

async function prepareRollback(context, { oldDataDir, currentRendererState = {} } = {}) {
  const base = rootPaths(getAppPaths(context));
  if (await exists(base.pendingPath)) throw codedError('RESTORE_LOCK_CONFLICT', 'Another backup restore is already pending');
  const selected = validateAbsoluteTarget(oldDataDir, 'oldDataDir');
  if (!/^PaperQuay\.pre-import-/.test(path.basename(selected)) || path.dirname(selected) !== path.dirname(base.dataDir)) {
    throw codedError('UNSAFE_DESTINATION', 'Rollback source must be a PaperQuay.pre-import-* directory under userData');
  }
  if (!(await exists(selected))) throw codedError('OLD_DATA_NOT_FOUND', 'Rollback directory does not exist');
  const priorSummary = readJsonSync(path.join(base.dataDir, '.settings', 'restore-summary.json'), {});
  const selectedLibrarySettings = readLibrarySettings(path.join(selected, 'paperquay-library.sqlite'));
  const previous = priorSummary.previous || {};
  const restoreLibraryDir = previous.libraryStorageDir || selectedLibrarySettings.storageDir || '';
  const restoreTranslatedDir = previous.translatedPdfDir || (restoreLibraryDir ? path.join(restoreLibraryDir, 'translated-pdfs') : '');
  const restoreVaultDir = previous.notesVaultDir || '';
  const restoreId = `rollback-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const currentDataDir = `${base.dataDir}.rolledback-${Date.now()}`;
  const rendererSnapshotPath = path.join(selected, '.settings', 'renderer-local-storage.pre-import.json');
  const stagingDir = path.join(base.restoreRoot, restoreId);
  await fsp.mkdir(stagingDir, { recursive: true, mode: 0o700 });
  if (!(await exists(rendererSnapshotPath))) await writeJsonAtomic(rendererSnapshotPath, currentRendererState);
  const pending = sealPending({
    version: 1,
    restoreId,
    createdAt: new Date().toISOString(),
    mode: 'rollback',
    step: 'prepared',
    stagingDir,
    stagingDataDir: selected,
    stagingAssetsDir: path.join(path.dirname(selected), `.pq-rollback-${restoreId}`),
    rendererSnapshotPath,
    oldDataDir: currentDataDir,
    restoreDir: selected,
    targets: {
      dataDir: base.dataDir,
      libraryStorageDir: restoreLibraryDir,
      translatedPdfDir: restoreTranslatedDir,
      mineruCacheDir: base.mineruCacheDir,
      remotePdfDownloadDir: base.remotePdfDownloadDir,
      notesVaultDir: restoreVaultDir,
    },
    rollbackCurrentLibraryDir: priorSummary.targets?.libraryStorageDir || readLibrarySettings(base.libraryDatabasePath).storageDir,
    rollbackLibraryDir: priorSummary.oldLibraryDir || null,
    rollbackLibraryDestination: priorSummary.targets?.libraryStorageDir || restoreLibraryDir,
    rollbackCurrentTranslatedPdfDir: priorSummary.targets?.translatedPdfDir || '',
    rollbackTranslatedPdfDir: priorSummary.oldTranslatedPdfDir || null,
    rollbackTranslatedDestination: priorSummary.targets?.translatedPdfDir || restoreTranslatedDir,
    previous,
    warnings: [],
    restorePayload: { restoreId, mode: 'rollback', state: readJsonSync(rendererSnapshotPath, {}), pathMap: {}, rootMap: {}, warnings: [] },
  });
  await writeJsonAtomic(base.pendingPath, pending);
  return { ok: true, restoreId, restartRequired: true };
}

function getRendererRestorePayload(appPaths, { maxAgeMs = 7 * 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  const base = rootPaths(getAppPaths(appPaths));
  const restorePath = path.join(base.dataDir, '.settings', 'renderer-restore.json');
  const payload = readJsonSync(restorePath, null);
  if (!payload) return null;
  try {
    const stat = fs.statSync(restorePath);
    if (now - stat.mtimeMs > maxAgeMs) {
      fs.rmSync(restorePath, { force: true });
      return null;
    }
  } catch { return null; }
  return payload;
}

function getBackupStatus(context) {
  const base = rootPaths(getAppPaths(context));
  const pending = readJsonSync(base.pendingPath, null);
  const history = readJsonSync(path.join(base.dataDir, '.settings', 'backup-history.json'), []);
  const currentSummary = readJsonSync(path.join(base.dataDir, '.settings', 'restore-summary.json'), {});
  const oldDataDirs = [];
  try {
    for (const name of fs.readdirSync(path.dirname(base.dataDir))) {
      if (name.startsWith('PaperQuay.pre-import-')) oldDataDirs.push(path.join(path.dirname(base.dataDir), name));
    }
  } catch {}
  const oldDataDirDetails = oldDataDirs.flatMap((target) => {
    let createdAt;
    try { createdAt = fs.statSync(target).birthtime.toISOString(); } catch {}
    const bytes = path.resolve(currentSummary.oldDataDir || '') === path.resolve(target)
      ? Number(currentSummary.sizeEstimate?.oldDataBytes) || undefined
      : undefined;
    const targetSummary = readJsonSync(path.join(target, '.settings', 'restore-summary.json'), null);
    const assetDetails = [];
    for (const [kind, directory, size] of [
      ['library', targetSummary?.oldLibraryDir, targetSummary?.sizeEstimate?.oldLibraryBytes],
      ['translated', targetSummary?.oldTranslatedPdfDir, targetSummary?.sizeEstimate?.oldTranslatedPdfBytes],
    ]) {
      if (!directory || !fs.existsSync(directory)) continue;
      let assetCreatedAt;
      try { assetCreatedAt = fs.statSync(directory).birthtime.toISOString(); } catch {}
      assetDetails.push({ path: directory, kind, ...(Number.isFinite(Number(size)) ? { bytes: Number(size), sizeBytes: Number(size) } : {}), createdAt: assetCreatedAt });
    }
    return [{ path: target, kind: 'data', ...(bytes === undefined ? {} : { bytes, sizeBytes: bytes }), createdAt }, ...assetDetails];
  });
  const knownDetails = new Set(oldDataDirDetails.map((item) => path.resolve(item.path)));
  for (const [kind, target, bytes] of [
    ['library', currentSummary.oldLibraryDir, currentSummary.sizeEstimate?.oldLibraryBytes],
    ['translated', currentSummary.oldTranslatedPdfDir, currentSummary.sizeEstimate?.oldTranslatedPdfBytes],
  ]) {
    if (!target || !fs.existsSync(target) || knownDetails.has(path.resolve(target))) continue;
    let createdAt;
    try { createdAt = fs.statSync(target).birthtime.toISOString(); } catch {}
    oldDataDirDetails.push({ path: target, kind, ...(Number.isFinite(Number(bytes)) ? { bytes: Number(bytes), sizeBytes: Number(bytes) } : {}), createdAt });
  }
  return {
    pendingRestore: Boolean(pending),
    lastExport: Array.isArray(history) ? history.find((item) => item.direction === 'export') || null : null,
    lastRestore: Array.isArray(history) ? history.find((item) => item.direction === 'import' || item.direction === 'rollback') || null : null,
    history: Array.isArray(history) ? history.slice(0, 5) : [],
    oldDataDirs,
    oldDataDirDetails,
  };
}

async function directorySizeAsync(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = await fsp.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      try {
        const stat = await fsp.lstat(next);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) stack.push(next);
        else if (stat.isFile()) total += stat.size;
      } catch {}
    }
  }
  return total;
}

function directorySize(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      try {
        const stat = fs.lstatSync(next);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) stack.push(next);
        else if (stat.isFile()) total += stat.size;
      } catch {}
    }
  }
  return total;
}

function deleteOldData(context, { path: requestedPath } = {}) {
  const base = rootPaths(getAppPaths(context));
  const target = validateAbsoluteTarget(requestedPath, 'path');
  const status = getBackupStatus(context);
  const allowedData = status.oldDataDirs.some((candidate) => path.resolve(candidate) === target);
  let allowedAsset = false;
  const summaries = [readJsonSync(path.join(base.dataDir, '.settings', 'restore-summary.json'), null)];
  for (const oldDir of status.oldDataDirs) summaries.push(readJsonSync(path.join(oldDir, '.settings', 'restore-summary.json'), null));
  for (const summary of summaries) {
    const candidates = [summary?.oldLibraryDir, summary?.oldTranslatedPdfDir].filter(Boolean);
    if (candidates.some((candidate) => path.resolve(candidate) === target)) allowedAsset = true;
  }
  if (!allowedData && !allowedAsset) {
    throw codedError('UNSAFE_DESTINATION', 'Refusing to delete a path that is not a recorded pre-import directory');
  }
  if (fs.existsSync(target)) {
    const realParent = fs.realpathSync(path.dirname(target));
    const realTarget = fs.realpathSync(target);
    if (!pathInside(realParent, realTarget) || realTarget === realParent) throw codedError('UNSAFE_DESTINATION', 'Delete path escaped its allowed parent');
  }
  const freedBytes = fs.existsSync(target) ? directorySize(target) : 0;
  fs.rmSync(target, { recursive: true, force: true });
  return { ok: true, freedBytes };
}

async function handleRendererRestoreAck(appPaths, { restoreId, failedKeys = [] } = {}) {
  const base = rootPaths(getAppPaths(appPaths));
  const restorePath = path.join(base.dataDir, '.settings', 'renderer-restore.json');
  const payload = readJsonSync(restorePath, null);
  if (!payload || payload.restoreId !== restoreId) return { ok: true, ignored: true };
  const summaryPath = path.join(base.dataDir, '.settings', 'restore-summary.json');
  const summary = readJsonSync(summaryPath, {});
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  if (Array.isArray(failedKeys) && failedKeys.length) warnings.push({ code: 'RENDERER_STORAGE_QUOTA', failedKeys: failedKeys.slice(0, 200) });
  summary.warnings = warnings;
  await writeJsonAtomic(summaryPath, summary);
  const historyPath = path.join(base.dataDir, '.settings', 'backup-history.json');
  const history = readJsonSync(historyPath, []);
  const records = Array.isArray(history) ? history : [];
  if (!records.some((record) => record.restoreId === restoreId)) {
    records.unshift({
      direction: payload.mode === 'rollback' ? 'rollback' : 'import',
      createdAt: summary.createdAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      packagePath: summary.package?.packagePath,
      sourceVersion: summary.package?.version,
      result: 'success',
      warnings,
      restoreId,
    });
    await writeJsonAtomic(historyPath, records.slice(0, 5));
  }
  await fsp.rm(restorePath, { force: true });
  return { ok: true, ignored: false };
}

module.exports = {
  applyPendingBackupRestore,
  cleanupOrphanBackupImports,
  deleteOldData,
  getBackupStatus,
  getRendererRestorePayload,
  handleRendererRestoreAck,
  inspectBackupPackage,
  isWindowsAbsolutePath,
  mapByRoot,
  pendingChecksum,
  prepareRollback,
  stageBackupImport,
  validPending,
};
