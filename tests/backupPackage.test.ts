import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
const { writeBackupPackage } = require('../electron/backend/backupContainer.cjs');
const {
  applyPendingBackupRestore,
  getBackupStatus,
  getRendererRestorePayload,
  handleRendererRestoreAck,
  isWindowsAbsolutePath,
  mapByRoot,
  pendingChecksum,
  prepareRollback,
} = require('../electron/backend/backupImport.cjs');

async function fixture() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'paperquay-backup-import-'));
  const dataDir = path.join(userDataDir, 'PaperQuay');
  const appPaths = {
    userDataDir,
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
  };
  return { userDataDir, dataDir, appPaths, dispose: () => rm(userDataDir, { recursive: true, force: true }) };
}

function seal(fields) {
  return { ...fields, checksum: pendingChecksum(fields) };
}

function pendingPaths(userDataDir, dataDir, id) {
  const restoreRoot = path.join(userDataDir, 'PaperQuay-restore');
  const stagingDir = path.join(restoreRoot, id);
  const stagingDataDir = path.join(stagingDir, 'data');
  const stagingAssetsDir = path.join(userDataDir, `.pq-import-${id}`);
  return {
    restoreRoot,
    pendingPath: path.join(restoreRoot, 'pending.json'),
    stagingDir,
    stagingDataDir,
    stagingAssetsDir,
    rendererSnapshotPath: path.join(stagingDir, 'renderer-local-storage.pre-import.json'),
    oldDataDir: path.join(userDataDir, `PaperQuay.pre-import-${id}`),
    targets: {
      dataDir,
      libraryStorageDir: path.join(userDataDir, 'Library'),
      translatedPdfDir: path.join(userDataDir, 'Library', 'translated-pdfs'),
      mineruCacheDir: path.join(dataDir, '.mineru-cache'),
      remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
      notesVaultDir: '',
    },
  };
}

test('maps foreign Windows and POSIX roots onto native destination paths', () => {
  assert.equal(isWindowsAbsolutePath('C:\\Archive\\Papers'), true);
  assert.equal(isWindowsAbsolutePath('\\\\server\\share\\Papers'), true);
  assert.equal(isWindowsAbsolutePath('/mnt/archive/papers'), false);
  assert.equal(
    mapByRoot('c:/ARCHIVE/Papers/one.pdf', { 'C:\\Archive\\Papers': '/tmp/restored', 'C:\\Archive': '/tmp/general' }),
    path.join('/tmp/restored', 'one.pdf'),
  );
  assert.equal(
    mapByRoot('\\\\server\\share\\Papers\\one.pdf', { '\\\\server\\share\\Papers': '/mnt/restored' }),
    path.join('/mnt/restored', 'one.pdf'),
  );
  assert.equal(
    mapByRoot('/mnt/old/Papers/one.pdf', { '/mnt/old/Papers': 'C:\\Restored\\Library' }),
    path.join('C:\\Restored\\Library', 'one.pdf'),
  );
  assert.equal(mapByRoot('/mnt/old/Papers-old/one.pdf', { '/mnt/old/Papers': '/tmp/new' }), null);
});

test('applies a prepared restore atomically and acknowledges only the matching renderer restore id', async () => {
  const temp = await fixture();
  try {
    const id = 'restore-test-1';
    const paths = pendingPaths(temp.userDataDir, temp.dataDir, id);
    await mkdir(path.join(temp.dataDir, '.settings'), { recursive: true });
    await writeFile(path.join(temp.dataDir, 'old-marker.txt'), 'old');
    await mkdir(path.join(paths.stagingDataDir, '.settings'), { recursive: true });
    await writeFile(path.join(paths.stagingDataDir, '.settings', 'paperquay.config.json'), '{}');
    const payload = {
      restoreId: id,
      state: { 'paper-reader-paper-history-v1': '{}', 'paper-reader-settings-v3': '{}' },
      pathMap: { 'C:\\old\\paper.pdf': path.join(temp.userDataDir, 'Library', 'paper.pdf') },
      rootMap: { 'C:\\old': path.join(temp.userDataDir, 'Library') },
      warnings: [],
    };
    const pending = seal({
      version: 1,
      restoreId: id,
      createdAt: new Date().toISOString(),
      step: 'prepared',
      mode: 'import',
      ...paths,
      package: { createdAt: '2026-11-06T00:00:00.000Z', version: '0.4.18' },
      previous: {},
      sourceRoots: {},
      pathMap: payload.pathMap,
      rootMap: payload.rootMap,
      warnings: [],
      restorePayload: payload,
    });
    await mkdir(paths.restoreRoot, { recursive: true });
    await writeFile(paths.pendingPath, JSON.stringify(pending));

    const result = await applyPendingBackupRestore(temp.appPaths);
    assert.equal(result.restored, true);
    assert.equal(result.dataDir, temp.dataDir);
    assert.equal(result.rendererRestorePayload.restoreId, id);
    assert.equal(await readFile(path.join(paths.oldDataDir, 'old-marker.txt'), 'utf8'), 'old');
    // stage 阶段已完成路径映射；写给 preload 的载荷清空映射表，避免二次映射。
    assert.deepEqual(
      JSON.parse(await readFile(path.join(temp.dataDir, '.settings', 'renderer-restore.json'), 'utf8')),
      { ...payload, pathMap: {}, rootMap: {} },
    );
    assert.equal(getBackupStatus(temp.appPaths).pendingRestore, false);

    assert.deepEqual(await handleRendererRestoreAck(temp.appPaths, { restoreId: 'stale-id', failedKeys: [] }), { ok: true, ignored: true });
    assert.equal(await readFile(path.join(temp.dataDir, '.settings', 'renderer-restore.json'), 'utf8') !== '', true);
    assert.deepEqual(await handleRendererRestoreAck(temp.appPaths, { restoreId: id, failedKeys: ['paper-reader-paper-history-v1'] }), { ok: true, ignored: false });
    await assert.rejects(readFile(path.join(temp.dataDir, '.settings', 'renderer-restore.json')));
    const summary = JSON.parse(await readFile(path.join(temp.dataDir, '.settings', 'restore-summary.json'), 'utf8'));
    assert.equal(summary.warnings.at(-1).code, 'RENDERER_STORAGE_QUOTA');
  } finally {
    await temp.dispose();
  }
});

test('rejects a pending checksum mismatch without moving or modifying data', async () => {
  const temp = await fixture();
  try {
    await mkdir(temp.dataDir, { recursive: true });
    await writeFile(path.join(temp.dataDir, 'marker.txt'), 'untouched');
    const paths = pendingPaths(temp.userDataDir, temp.dataDir, 'bad-checksum');
    await mkdir(paths.restoreRoot, { recursive: true });
    await writeFile(paths.pendingPath, JSON.stringify({ version: 1, step: 'prepared', checksum: '00'.repeat(32) }));

    const result = await applyPendingBackupRestore(temp.appPaths);
    assert.equal(result.restored, false);
    assert.equal(result.error, 'PENDING_CHECKSUM_INVALID');
    assert.equal(await readFile(path.join(temp.dataDir, 'marker.txt'), 'utf8'), 'untouched');
    assert.deepEqual((await readdir(paths.restoreRoot)).sort(), ['pending.error.json']);
  } finally {
    await temp.dispose();
  }
});

test('prepares rollback through the same checksummed pending state machine', async () => {
  const temp = await fixture();
  try {
    const oldDataDir = path.join(temp.userDataDir, 'PaperQuay.pre-import-20261106120000');
    await mkdir(path.join(oldDataDir, '.settings'), { recursive: true });
    await writeFile(path.join(oldDataDir, '.settings', 'renderer-local-storage.pre-import.json'), JSON.stringify({ legacy: 'state' }));
    await mkdir(temp.dataDir, { recursive: true });
    await writeFile(path.join(temp.dataDir, 'new-marker.txt'), 'keep until restart');
    await writeFile(path.join(oldDataDir, '.settings', 'restore-summary.json'), JSON.stringify({
      targets: { dataDir: temp.dataDir, libraryStorageDir: path.join(temp.userDataDir, 'Library') },
      previous: { libraryStorageDir: path.join(temp.userDataDir, 'OldLibrary') },
    }));

    const result = await prepareRollback(temp.appPaths, { oldDataDir, currentRendererState: { live: 'state' } });
    assert.equal(result.ok, true);
    assert.equal(result.restartRequired, true);
    assert.equal(await readFile(path.join(temp.dataDir, 'new-marker.txt'), 'utf8'), 'keep until restart');
    const pendingPath = path.join(temp.userDataDir, 'PaperQuay-restore', 'pending.json');
    const pending = JSON.parse(await readFile(pendingPath, 'utf8'));
    assert.equal(pending.mode, 'rollback');
    assert.equal(pending.step, 'prepared');
    assert.equal(pending.restoreDir, oldDataDir);
    assert.equal(pending.checksum, pendingChecksum(pending));
  } finally {
    await temp.dispose();
  }
});

test('synchronous status reports old pre-import data directories', async () => {
  const temp = await fixture();
  try {
    const oldDataDir = path.join(temp.userDataDir, 'PaperQuay.pre-import-20261106120000');
    await mkdir(oldDataDir, { recursive: true });
    const status = getBackupStatus(temp.appPaths);
    assert.equal(status.pendingRestore, false);
    assert.deepEqual(status.oldDataDirs, [oldDataDir]);
  } finally {
    await temp.dispose();
  }
});

test('real encrypted container and temporary SQLite round-trip stages, applies, acknowledges, and rolls back same-target PDF content', async () => {
  const temp = await fixture();
  try {
    const libraryDir = path.join(temp.userDataDir, 'Library');
    const pdfPath = path.join(libraryDir, 'paper.pdf');
    const notesDbPath = path.join(temp.userDataDir, 'package-notes.sqlite');
    const libraryDbPath = path.join(temp.userDataDir, 'package-library.sqlite');
    const packagePath = path.join(temp.userDataDir, 'roundtrip.pqbackup');
    const oldPdf = Buffer.from('old library PDF bytes');
    const newPdf = Buffer.from('restored package PDF bytes');
    await mkdir(path.join(temp.dataDir, '.settings'), { recursive: true });
    await mkdir(libraryDir, { recursive: true });
    await writeFile(pdfPath, oldPdf);
    await writeFile(path.join(libraryDir, 'unrelated.txt'), 'preserve on rollback');

    const libraryDb = new DatabaseSync(libraryDbPath);
    libraryDb.exec(`
      CREATE TABLE library_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE papers (id TEXT PRIMARY KEY);
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, kind TEXT NOT NULL, original_path TEXT,
        stored_path TEXT NOT NULL, relative_path TEXT, file_name TEXT NOT NULL, mime_type TEXT,
        file_size INTEGER NOT NULL, content_hash TEXT, missing INTEGER NOT NULL DEFAULT 0
      );
    `);
    libraryDb.prepare('INSERT INTO library_settings (key, value_json) VALUES (?, ?)').run('storageDir', JSON.stringify(libraryDir));
    libraryDb.prepare('INSERT INTO library_settings (key, value_json) VALUES (?, ?)').run('translatedPdfDir', JSON.stringify(''));
    libraryDb.prepare('INSERT INTO library_settings (key, value_json) VALUES (?, ?)').run('notesVaultDir', JSON.stringify(''));
    libraryDb.prepare('INSERT INTO papers (id) VALUES (?)').run('paper-1');
    libraryDb.prepare('INSERT INTO attachments (id, paper_id, kind, stored_path, file_name, file_size, missing) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('attachment-1', 'paper-1', 'pdf', pdfPath, 'paper.pdf', oldPdf.length, 0);
    libraryDb.close();

    const notesDb = new DatabaseSync(notesDbPath);
    notesDb.exec('CREATE TABLE notes (id TEXT PRIMARY KEY); CREATE TABLE note_folders (id TEXT PRIMARY KEY);');
    notesDb.prepare('INSERT INTO notes (id) VALUES (?)').run('note-1');
    notesDb.close();

    const config = Buffer.from(JSON.stringify({
      version: 1,
      settings: { mineruCacheDir: '', remotePdfDownloadDir: '' },
      secrets: { summaryApiKey: 'package-secret' },
      zoteroLocalDataDir: '',
    }));
    const rendererState = {
      'paper-reader-paper-history-v1': JSON.stringify({
        'workspace-1': {
          document: { localPdfPath: pdfPath },
          lastPdfPath: pdfPath,
          lastMineruPath: path.join(temp.userDataDir, 'old-cache', 'blocks.json'),
          workspaceNoteMarkdown: `keep prose ${pdfPath}`,
        },
      }),
      'paper-reader-settings-v3': JSON.stringify({ mineruCacheDir: path.join(temp.userDataDir, 'old-cache'), remotePdfDownloadDir: '' }),
    };
    const manifest = {
      manifestVersion: 1,
      createdAt: '2026-11-06T00:00:00.000Z',
      app: { name: 'PaperQuay', version: '0.4.18', minReaderVersion: '0.4.18', platform: process.platform, arch: process.arch },
      schema: { library: 1, notes: 1, rag: 0 },
      sourceRoots: { dataDir: temp.dataDir, libraryStorageDir: libraryDir },
      resolvedRoots: {},
      counts: { papers: 1, attachments: 1, notes: 1, noteFolders: 0 },
      warnings: [],
    };
    const entries = [
      { kind: 'database', databaseKind: 'library', schemaVersion: 1, sourceRoot: 'dataDir', relativePath: 'paperquay-library.sqlite', packagePath: 'data/paperquay-library.sqlite', data: readFileSync(libraryDbPath) },
      { kind: 'database', databaseKind: 'notes', schemaVersion: 1, sourceRoot: 'dataDir', relativePath: 'paperquay-notes.sqlite', packagePath: 'data/paperquay-notes.sqlite', data: readFileSync(notesDbPath) },
      { kind: 'config', encoding: 'utf8', sourceRoot: 'dataDir', relativePath: '.settings/paperquay.config.json', packagePath: 'config/paperquay.config.json', data: config },
      { kind: 'renderer-local-storage', encoding: 'utf8', sourceRoot: 'dataDir', relativePath: 'renderer-local-storage.json', packagePath: 'renderer/local-storage.json', data: Buffer.from(JSON.stringify(rendererState)) },
      { kind: 'library-pdf', paperId: 'paper-1', attachmentId: 'attachment-1', fileName: 'paper.pdf', expectedContentHash: '', sourceRoot: 'libraryStorageDir', relativePath: 'paper.pdf', packagePath: 'library/paper.pdf', data: newPdf },
    ];
    await writeBackupPackage({
      outputPath: packagePath,
      password: 'correct horse battery staple',
      manifest,
      entries,
      compressionLevel: 'standard',
    });

    const staged = await require('../electron/backend/backupImport.cjs').stageBackupImport(temp.appPaths, {
      packagePath,
      password: 'correct horse battery staple',
      targets: { libraryStorageDir: libraryDir },
      currentRendererState: { 'paperquay-agent-history-v1': 'local pre-import state' },
    });
    assert.equal(staged.ok, true);
    const applied = await applyPendingBackupRestore(temp.appPaths);
    assert.equal(applied.restored, true);
    assert.equal((await readFile(pdfPath)).toString(), newPdf.toString());
    const restoredHistory = JSON.parse(applied.rendererRestorePayload.state['paper-reader-paper-history-v1']);
    assert.equal(restoredHistory['workspace-1'].document.localPdfPath, pdfPath);
    assert.equal(restoredHistory['workspace-1'].workspaceNoteMarkdown, `keep prose ${pdfPath}`);
    assert.ok(getRendererRestorePayload(temp.appPaths));
    assert.deepEqual(await handleRendererRestoreAck(temp.appPaths, { restoreId: staged.restoreId, failedKeys: [] }), { ok: true, ignored: false });

    const status = getBackupStatus(temp.appPaths);
    const oldDataDir = status.oldDataDirs[0];
    const oldLibraryDir = JSON.parse(await readFile(path.join(temp.dataDir, '.settings', 'restore-summary.json'), 'utf8')).oldLibraryDir;
    assert.ok(oldLibraryDir);
    const rollback = await prepareRollback(temp.appPaths, { oldDataDir, currentRendererState: {} });
    assert.equal(rollback.restartRequired, true);
    const rollbackApplied = await applyPendingBackupRestore(temp.appPaths);
    assert.equal(rollbackApplied.restored, true);
    assert.deepEqual(await readFile(pdfPath), oldPdf);
    assert.equal(await readFile(path.join(libraryDir, 'unrelated.txt'), 'utf8'), 'preserve on rollback');
    const rollbackRestoreId = rollbackApplied.rendererRestorePayload.restoreId;
    await handleRendererRestoreAck(temp.appPaths, { restoreId: rollbackRestoreId, failedKeys: [] });
    assert.equal(getBackupStatus(temp.appPaths).lastRestore?.direction, 'rollback');
  } finally {
    await temp.dispose();
  }
});
