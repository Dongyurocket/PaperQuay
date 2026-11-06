import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMineruCachePaths } from '../src/utils/mineruCache.ts';

const require = createRequire(import.meta.url);
const crypto = require('node:crypto');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
const { writeBackupPackage } = require('../electron/backend/backupContainer.cjs');
const {
  applyPendingBackupRestore,
  pendingChecksum,
  repairRestoredBackupPaths,
  stageBackupImport,
} = require('../electron/backend/backupImport.cjs');

const PASSWORD = 'correct horse battery staple';

async function fixture() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'paperquay-restore-paths-'));
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
  await mkdir(path.join(dataDir, '.settings'), { recursive: true });
  return { userDataDir, dataDir, appPaths, dispose: () => rm(userDataDir, { recursive: true, force: true }) };
}

const ATTACHMENTS_SQL = `
  CREATE TABLE library_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  CREATE TABLE papers (id TEXT PRIMARY KEY);
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, kind TEXT NOT NULL, original_path TEXT,
    stored_path TEXT NOT NULL, relative_path TEXT, file_name TEXT NOT NULL, mime_type TEXT,
    file_size INTEGER NOT NULL, content_hash TEXT, missing INTEGER NOT NULL DEFAULT 0
  );
`;

function createLibraryDb(filePath, { storageDir, attachments }) {
  const db = new DatabaseSync(filePath);
  db.exec(ATTACHMENTS_SQL);
  const setting = db.prepare('INSERT INTO library_settings (key, value_json) VALUES (?, ?)');
  setting.run('storageDir', JSON.stringify(storageDir));
  setting.run('translatedPdfDir', JSON.stringify(''));
  setting.run('notesVaultDir', JSON.stringify(''));
  const papers = new Set(attachments.map((item) => item.paperId));
  for (const paperId of papers) db.prepare('INSERT INTO papers (id) VALUES (?)').run(paperId);
  const insert = db.prepare('INSERT INTO attachments (id, paper_id, kind, stored_path, relative_path, file_name, file_size, missing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const item of attachments) {
    insert.run(item.id, item.paperId, item.kind || 'pdf', item.storedPath, item.relativePath ?? null, item.fileName, item.size ?? 1, item.missing ?? 0);
  }
  db.close();
  return { papers: papers.size, attachments: attachments.length };
}

function createNotesDb(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY); CREATE TABLE note_folders (id TEXT PRIMARY KEY);');
  db.close();
}

function readAttachments(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return Object.fromEntries(db.prepare('SELECT id, stored_path, relative_path, file_name, missing FROM attachments').all()
      .map((row) => [row.id, { ...row }]));
  } finally { db.close(); }
}

function customRootKey(root) {
  return `custom-${crypto.createHash('sha256').update(String(root)).digest('hex').slice(0, 8)}`;
}

/**
 * 构造一个跨机器恢复场景的 .pqbackup：源机库目录、缓存目录都不在目标机上，
 * 包内 PDF 按导出端规则改名为 library/<paperId>-<attachmentId>.pdf。
 */
async function buildPackage(temp, { attachments, pdfEntries, mineruEntries = [], rendererHistory = {}, mineruCacheDir = '' }) {
  const srcRoot = path.join(temp.userDataDir, 'src-machine');
  const srcLib = path.join(srcRoot, 'paperq');
  const srcData = path.join(srcRoot, 'PaperQuay');
  const libraryDbPath = path.join(temp.userDataDir, 'package-library.sqlite');
  const notesDbPath = path.join(temp.userDataDir, 'package-notes.sqlite');
  const counts = createLibraryDb(libraryDbPath, { storageDir: srcLib, attachments: attachments(srcLib) });
  createNotesDb(notesDbPath);
  const packagePath = path.join(temp.userDataDir, 'restore.pqbackup');
  const config = { version: 1, settings: { mineruCacheDir: mineruCacheDir || path.join(srcData, '.mineru-cache') }, secrets: {} };
  const rendererState = {
    'paper-reader-paper-history-v1': JSON.stringify(typeof rendererHistory === 'function' ? rendererHistory(srcLib) : rendererHistory),
    'paper-reader-settings-v3': JSON.stringify({ mineruCacheDir: config.settings.mineruCacheDir }),
  };
  const manifest = {
    manifestVersion: 1,
    createdAt: '2026-11-07T00:00:00.000Z',
    app: { name: 'PaperQuay', version: '0.4.19', minReaderVersion: '0.4.19', platform: process.platform, arch: process.arch },
    schema: { library: 1, notes: 1, rag: 0 },
    sourceRoots: {
      dataDir: srcData,
      libraryStorageDir: srcLib,
      translatedPdfDir: null,
      mineruCacheDir: config.settings.mineruCacheDir,
      notesVaultDir: null,
    },
    resolvedRoots: {},
    counts: { ...counts, notes: 0, noteFolders: 0 },
    warnings: [],
  };
  const entries = [
    { kind: 'database', databaseKind: 'library', schemaVersion: 1, sourceRoot: 'dataDir', relativePath: 'paperquay-library.sqlite', packagePath: 'data/paperquay-library.sqlite', data: readFileSync(libraryDbPath) },
    { kind: 'database', databaseKind: 'notes', schemaVersion: 1, sourceRoot: 'dataDir', relativePath: 'paperquay-notes.sqlite', packagePath: 'data/paperquay-notes.sqlite', data: readFileSync(notesDbPath) },
    { kind: 'config', encoding: 'utf8', sourceRoot: 'dataDir', relativePath: '.settings/paperquay.config.json', packagePath: 'config/paperquay.config.json', data: Buffer.from(JSON.stringify(config)) },
    { kind: 'renderer-local-storage', encoding: 'utf8', sourceRoot: 'dataDir', relativePath: 'renderer-local-storage.json', packagePath: 'renderer/local-storage.json', data: Buffer.from(JSON.stringify(rendererState)) },
    ...pdfEntries(srcLib),
    ...mineruEntries,
  ];
  await writeBackupPackage({ outputPath: packagePath, password: PASSWORD, manifest, entries, compressionLevel: 'standard' });
  return { packagePath, srcLib, srcData, manifest };
}

function pdfEntry(srcLib, { kind = 'library-pdf', paperId, attachmentId, relativePath, data }) {
  const folder = kind === 'translated-pdf' ? 'translated' : 'library';
  return {
    kind,
    paperId,
    attachmentId,
    fileName: path.basename(relativePath),
    expectedContentHash: '',
    sourceRoot: 'libraryStorageDir',
    relativePath,
    sourceAbsolutePath: path.resolve(srcLib, ...relativePath.split('/')),
    originalSourcePath: null,
    packagePath: `${folder}/${paperId}-${attachmentId}.pdf`,
    data: Buffer.from(data),
  };
}

// 与真实导出一致：默认缓存位于 dataDir 内，identifySourceRoot 记为 dataDir/.mineru-cache/...；
// 自定义缓存记为 mineruCacheDir 根下的相对路径。
function mineruEntry(rootKey, directoryName, fileName, data) {
  const isDefault = rootKey === 'default';
  return {
    kind: 'mineru',
    sourceRoot: isDefault ? 'dataDir' : 'mineruCacheDir',
    relativePath: isDefault ? `.mineru-cache/${directoryName}/${fileName}` : `${directoryName}/${fileName}`,
    packagePath: `derived/mineru/${rootKey}/${directoryName}/${fileName}`,
    data: Buffer.from(data),
  };
}

function cacheDirectoryName(paperId) {
  return path.basename(buildMineruCachePaths('/cache', { workspaceId: `native-library:${paperId}` } as never).directory);
}

async function stageAndApply(temp, packagePath, libraryStorageDir) {
  const staged = await stageBackupImport(temp.appPaths, {
    packagePath,
    password: PASSWORD,
    targets: { libraryStorageDir },
    currentRendererState: {},
  });
  assert.equal(staged.ok, true);
  const applied = await applyPendingBackupRestore(temp.appPaths);
  assert.equal(applied.restored, true);
  const summary = JSON.parse(await readFile(path.join(temp.dataDir, '.settings', 'restore-summary.json'), 'utf8'));
  return { applied, summary };
}

test('T1 installs MinerU caches directly under the cache root where the reader looks them up', async () => {
  const temp = await fixture();
  try {
    const directory = cacheDirectoryName('p1');
    const { packagePath } = await buildPackage(temp, {
      attachments: (srcLib) => [{ id: 'a1', paperId: 'p1', storedPath: path.join(srcLib, 'p1-One.pdf'), fileName: 'p1-One.pdf' }],
      pdfEntries: (srcLib) => [pdfEntry(srcLib, { paperId: 'p1', attachmentId: 'a1', relativePath: 'p1-One.pdf', data: 'pdf-1' })],
      mineruEntries: [
        mineruEntry('default', directory, 'content_list_v2.json', '[]'),
        mineruEntry('default', directory, 'images/fig-1.png', 'png'),
      ],
    });
    await stageAndApply(temp, packagePath, path.join(temp.userDataDir, 'NewLib'));

    const cacheDir = temp.appPaths.mineruCacheDir;
    const expected = buildMineruCachePaths(cacheDir, { workspaceId: 'native-library:p1' } as never);
    assert.equal(existsSync(expected.contentJsonPath), true, 'reader lookup path must exist');
    assert.equal(existsSync(path.join(cacheDir, directory, 'images', 'fig-1.png')), true);
    assert.equal(existsSync(path.join(cacheDir, 'default')), false, 'root key level must be stripped');
  } finally {
    await temp.dispose();
  }
});

test('T2 prefers the source machine active custom cache root and skips duplicate directories as a whole', async () => {
  const temp = await fixture();
  try {
    const directory = cacheDirectoryName('p1');
    const customRoot = path.resolve(temp.userDataDir, 'src-machine', 'custom-cache');
    const activeKey = customRootKey(customRoot);
    const { packagePath } = await buildPackage(temp, {
      mineruCacheDir: customRoot,
      attachments: (srcLib) => [{ id: 'a1', paperId: 'p1', storedPath: path.join(srcLib, 'p1-One.pdf'), fileName: 'p1-One.pdf' }],
      pdfEntries: (srcLib) => [pdfEntry(srcLib, { paperId: 'p1', attachmentId: 'a1', relativePath: 'p1-One.pdf', data: 'pdf-1' })],
      mineruEntries: [
        mineruEntry('default', directory, 'content_list_v2.json', 'old'),
        mineruEntry('default', directory, 'images/stale-only.png', 'stale'),
        mineruEntry(activeKey, directory, 'content_list_v2.json', 'new'),
        mineruEntry(activeKey, '.split-tmp', 'part.pdf', 'tmp'),
        mineruEntry('default', 'document-onlydefault', 'content_list_v2.json', 'default-only'),
      ],
    });
    const { summary } = await stageAndApply(temp, packagePath, path.join(temp.userDataDir, 'NewLib'));

    const cacheDir = temp.appPaths.mineruCacheDir;
    assert.equal(await readFile(path.join(cacheDir, directory, 'content_list_v2.json'), 'utf8'), 'new');
    assert.equal(existsSync(path.join(cacheDir, directory, 'images', 'stale-only.png')), false, 'no file-level mixing across roots');
    assert.equal(await readFile(path.join(cacheDir, 'document-onlydefault', 'content_list_v2.json'), 'utf8'), 'default-only');
    assert.equal(existsSync(path.join(cacheDir, '.split-tmp')), false);
    assert.deepEqual((await readdir(cacheDir)).filter((name) => /^(default|custom-)/.test(name)), []);
    assert.ok(summary.warnings.some((warning) => warning?.code === 'MINERU_CACHE_CONFLICT'));
  } finally {
    await temp.dispose();
  }
});

test('T3 rebinds attachments of papers opened on the source machine to the renamed package files', async () => {
  const temp = await fixture();
  try {
    const newLib = path.join(temp.userDataDir, 'NewLib');
    const { packagePath } = await buildPackage(temp, {
      attachments: (srcLib) => [
        { id: 'a1', paperId: 'p1', storedPath: path.join(srcLib, 'p1-Original Title.pdf'), relativePath: 'p1-Original Title.pdf', fileName: 'p1-Original Title.pdf' },
        { id: 'a1t', paperId: 'p1', kind: 'translated-pdf', storedPath: path.join(srcLib, 'translated-pdfs', 'Original Title [zh].pdf'), fileName: 'Original Title [zh].pdf' },
        { id: 'a2', paperId: 'p2', storedPath: path.join(srcLib, 'p2-Unread.pdf'), fileName: 'p2-Unread.pdf' },
      ],
      pdfEntries: (srcLib) => [
        pdfEntry(srcLib, { paperId: 'p1', attachmentId: 'a1', relativePath: 'p1-Original Title.pdf', data: 'pdf-1' }),
        pdfEntry(srcLib, { kind: 'translated-pdf', paperId: 'p1', attachmentId: 'a1t', relativePath: 'translated-pdfs/Original Title [zh].pdf', data: 'pdf-1-zh' }),
        pdfEntry(srcLib, { paperId: 'p2', attachmentId: 'a2', relativePath: 'p2-Unread.pdf', data: 'pdf-2' }),
      ],
      rendererHistory: (srcLib) => {
        const original = path.join(srcLib, 'p1-Original Title.pdf');
        const translated = path.join(srcLib, 'translated-pdfs', 'Original Title [zh].pdf');
        return {
          'native-library:p1': {
            document: { localPdfPath: original, translatedPdfPath: translated },
            lastPdfPath: original,
            pdfScrollPositions: { [`local:${original}`]: { top: 10, updatedAt: 1 } },
            paperSummarySourceKey: `local:${original}`,
          },
        };
      },
    });
    const { applied, summary } = await stageAndApply(temp, packagePath, newLib);

    const rows = readAttachments(temp.appPaths.libraryDatabasePath);
    assert.equal(rows.a1.stored_path, path.join(newLib, 'p1-a1.pdf'));
    assert.equal(rows.a1.missing, 0);
    assert.equal(rows.a1.relative_path, 'p1-a1.pdf');
    assert.equal(rows.a1.file_name, 'p1-Original Title.pdf', 'display file name is preserved');
    assert.equal(rows.a1t.stored_path, path.join(newLib, 'translated-pdfs', 'p1-a1t.pdf'));
    assert.equal(rows.a1t.missing, 0);
    assert.equal(rows.a2.missing, 0);
    assert.deepEqual(summary.attachmentCounts, { attachmentsRestored: 3, attachmentsUnresolved: 0, attachmentsNotInPackage: 0 });

    const payload = applied.rendererRestorePayload;
    assert.deepEqual(payload.pathMap, {});
    assert.deepEqual(payload.rootMap, {});
    const history = JSON.parse(payload.state['paper-reader-paper-history-v1'])['native-library:p1'];
    assert.equal(history.lastPdfPath, path.join(newLib, 'p1-a1.pdf'));
    assert.equal(history.document.localPdfPath, path.join(newLib, 'p1-a1.pdf'));
    assert.equal(history.document.translatedPdfPath, path.join(newLib, 'translated-pdfs', 'p1-a1t.pdf'));
    assert.deepEqual(Object.keys(history.pdfScrollPositions), [`local:${path.join(newLib, 'p1-a1.pdf')}`]);
    for (const filePath of [history.lastPdfPath, history.document.localPdfPath, history.document.translatedPdfPath]) {
      assert.equal(existsSync(filePath), true, `${filePath} must exist`);
    }
  } finally {
    await temp.dispose();
  }
});

test('T4 rebinds stored paths written with forward slashes or different letter case', async () => {
  const temp = await fixture();
  try {
    const newLib = path.join(temp.userDataDir, 'NewLib');
    const { packagePath } = await buildPackage(temp, {
      attachments: (srcLib) => [
        { id: 'a1', paperId: 'p1', storedPath: path.join(srcLib, 'Sub', 'p1.pdf').replace(/\\/g, '/'), fileName: 'p1.pdf' },
        { id: 'a2', paperId: 'p2', storedPath: path.join(srcLib, 'p2.pdf').toUpperCase(), fileName: 'p2.pdf' },
      ],
      pdfEntries: (srcLib) => [
        pdfEntry(srcLib, { paperId: 'p1', attachmentId: 'a1', relativePath: 'Sub/p1.pdf', data: 'pdf-1' }),
        pdfEntry(srcLib, { paperId: 'p2', attachmentId: 'a2', relativePath: 'p2.pdf', data: 'pdf-2' }),
      ],
    });
    await stageAndApply(temp, packagePath, newLib);
    const rows = readAttachments(temp.appPaths.libraryDatabasePath);
    assert.equal(rows.a1.missing, 0);
    assert.equal(rows.a1.stored_path, path.join(newLib, 'p1-a1.pdf'));
    assert.equal(rows.a2.missing, 0);
    assert.equal(rows.a2.stored_path, path.join(newLib, 'p2-a2.pdf'));
  } finally {
    await temp.dispose();
  }
});

test('T5 a pending record written by 0.4.19 with a polluted path map still resolves renamed files at apply time', async () => {
  const temp = await fixture();
  try {
    const id = 'legacy-0419';
    const restoreRoot = path.join(temp.userDataDir, 'PaperQuay-restore');
    const stagingDir = path.join(restoreRoot, id);
    const stagingDataDir = path.join(stagingDir, 'data');
    const stagingAssetsDir = path.join(temp.userDataDir, `.pq-import-${id}`);
    const newLib = path.join(temp.userDataDir, 'NewLib');
    const oldStored = 'C:\\Users\\src\\paperq\\p1-Original.pdf';
    await mkdir(path.join(stagingDataDir, '.settings'), { recursive: true });
    await writeFile(path.join(stagingDataDir, '.settings', 'paperquay.config.json'), '{}');
    createLibraryDb(path.join(stagingDataDir, 'paperquay-library.sqlite'), {
      storageDir: 'C:\\Users\\src\\paperq',
      attachments: [{ id: 'a1', paperId: 'p1', storedPath: oldStored, fileName: 'p1-Original.pdf' }],
    });
    await mkdir(path.join(stagingAssetsDir, 'library'), { recursive: true });
    await writeFile(path.join(stagingAssetsDir, 'library', 'p1-a1.pdf'), 'pdf-1');
    const directory = cacheDirectoryName('p1');
    await mkdir(path.join(stagingAssetsDir, 'derived', 'mineru', 'default', directory), { recursive: true });
    await writeFile(path.join(stagingAssetsDir, 'derived', 'mineru', 'default', directory, 'content_list_v2.json'), '[]');
    const fields = {
      version: 1,
      restoreId: id,
      createdAt: new Date().toISOString(),
      step: 'prepared',
      mode: 'import',
      stagingDir,
      stagingDataDir,
      stagingAssetsDir,
      rendererSnapshotPath: path.join(stagingDir, 'renderer-local-storage.pre-import.json'),
      oldDataDir: path.join(temp.userDataDir, `PaperQuay.pre-import-${id}`),
      oldLibraryDir: null,
      oldTranslatedPdfDir: null,
      targets: {
        dataDir: temp.dataDir,
        libraryStorageDir: newLib,
        translatedPdfDir: path.join(newLib, 'translated-pdfs'),
        mineruCacheDir: temp.appPaths.mineruCacheDir,
        remotePdfDownloadDir: temp.appPaths.remotePdfDownloadDir,
        notesVaultDir: '',
      },
      previous: {},
      sourceRoots: { libraryStorageDir: 'C:\\Users\\src\\paperq' },
      resolvedRoots: {},
      // 0.4.19 的缺陷：阅读历史推导值覆盖了包内精确映射，指向不存在的原文件名。
      pathMap: { [oldStored]: path.join(newLib, 'p1-Original.pdf') },
      rootMap: { 'C:\\Users\\src\\paperq': newLib },
      warnings: [],
      restorePayload: null,
      package: { version: '0.4.19' },
    };
    await mkdir(restoreRoot, { recursive: true });
    await writeFile(path.join(restoreRoot, 'pending.json'), JSON.stringify({ ...fields, checksum: pendingChecksum(fields) }));

    const applied = await applyPendingBackupRestore(temp.appPaths);
    assert.equal(applied.restored, true);
    const rows = readAttachments(temp.appPaths.libraryDatabasePath);
    assert.equal(rows.a1.missing, 0);
    assert.equal(rows.a1.stored_path, path.join(newLib, 'p1-a1.pdf'));
    assert.equal(existsSync(path.join(temp.appPaths.mineruCacheDir, directory, 'content_list_v2.json')), true);
  } finally {
    await temp.dispose();
  }
});

test('T6 reports attachments missing from the package instead of guessing silently', async () => {
  const temp = await fixture();
  try {
    const newLib = path.join(temp.userDataDir, 'NewLib');
    const { packagePath } = await buildPackage(temp, {
      attachments: (srcLib) => [
        { id: 'a1', paperId: 'p1', storedPath: path.join(srcLib, 'p1.pdf'), fileName: 'p1.pdf' },
        { id: 'a2', paperId: 'p2', storedPath: path.join(srcLib, 'p2-cloud-only.pdf'), fileName: 'p2-cloud-only.pdf', missing: 1 },
      ],
      pdfEntries: (srcLib) => [pdfEntry(srcLib, { paperId: 'p1', attachmentId: 'a1', relativePath: 'p1.pdf', data: 'pdf-1' })],
    });
    const { summary } = await stageAndApply(temp, packagePath, newLib);
    const rows = readAttachments(temp.appPaths.libraryDatabasePath);
    assert.equal(rows.a1.missing, 0);
    assert.equal(rows.a2.missing, 1);
    assert.deepEqual(summary.attachmentCounts, { attachmentsRestored: 1, attachmentsUnresolved: 0, attachmentsNotInPackage: 1 });
    assert.ok(summary.warnings.some((warning) => warning?.code === 'NOT_IN_PACKAGE' && warning.detail === 'a2'));
  } finally {
    await temp.dispose();
  }
});

test('T7 one-time repair fixes data already restored by 0.4.19 and is idempotent', async () => {
  const temp = await fixture();
  try {
    const newLib = path.join(temp.userDataDir, 'NewLib');
    const cacheDir = temp.appPaths.mineruCacheDir;
    const directory = cacheDirectoryName('p1');
    const customKey = customRootKey('C:\\Users\\src\\custom-cache');
    await mkdir(path.join(cacheDir, 'default', directory), { recursive: true });
    await writeFile(path.join(cacheDir, 'default', directory, 'content_list_v2.json'), 'old');
    await mkdir(path.join(cacheDir, customKey, directory), { recursive: true });
    await writeFile(path.join(cacheDir, customKey, directory, 'content_list_v2.json'), 'new');
    await mkdir(path.join(cacheDir, 'default', 'document-reparsed'), { recursive: true });
    await writeFile(path.join(cacheDir, 'default', 'document-reparsed', 'content_list_v2.json'), 'stale');
    await mkdir(path.join(cacheDir, 'document-reparsed'), { recursive: true });
    await writeFile(path.join(cacheDir, 'document-reparsed', 'content_list_v2.json'), 'fresh');

    await mkdir(path.join(newLib, 'translated-pdfs'), { recursive: true });
    await writeFile(path.join(newLib, 'p1-a1.pdf'), 'pdf-1');
    await writeFile(path.join(newLib, 'translated-pdfs', 'p1-a1t.pdf'), 'pdf-1-zh');
    createLibraryDb(temp.appPaths.libraryDatabasePath, {
      storageDir: newLib,
      attachments: [
        { id: 'a1', paperId: 'p1', storedPath: path.join(newLib, 'p1-Original.pdf'), fileName: 'p1-Original.pdf', missing: 1 },
        { id: 'a1t', paperId: 'p1', kind: 'translated-pdf', storedPath: path.join(newLib, 'Original [zh].pdf'), fileName: 'Original [zh].pdf', missing: 1 },
        { id: 'a3', paperId: 'p3', storedPath: path.join(newLib, 'gone.pdf'), fileName: 'gone.pdf', missing: 1 },
      ],
    });
    const summaryPath = path.join(temp.dataDir, '.settings', 'restore-summary.json');
    writeFileSync(summaryPath, JSON.stringify({ restoreId: 'r1', package: { version: '0.4.19' }, warnings: [] }));

    const first = await repairRestoredBackupPaths(temp.appPaths);
    assert.equal(first.repaired, true);
    assert.equal(first.attachmentsRepaired, 2);
    assert.equal(first.attachmentsStillMissing, 1);
    assert.equal(await readFile(path.join(cacheDir, directory, 'content_list_v2.json'), 'utf8'), 'new');
    assert.equal(await readFile(path.join(cacheDir, 'document-reparsed', 'content_list_v2.json'), 'utf8'), 'fresh');
    assert.equal(existsSync(path.join(cacheDir, customKey)), false);
    assert.equal(existsSync(path.join(cacheDir, 'default', 'document-reparsed')), true, 'skipped directory stays in place');
    const rows = readAttachments(temp.appPaths.libraryDatabasePath);
    assert.equal(rows.a1.stored_path, path.join(newLib, 'p1-a1.pdf'));
    assert.equal(rows.a1.missing, 0);
    assert.equal(rows.a1.relative_path, 'p1-a1.pdf');
    assert.equal(rows.a1t.stored_path, path.join(newLib, 'translated-pdfs', 'p1-a1t.pdf'));
    assert.equal(rows.a1t.missing, 0);
    assert.equal(rows.a3.missing, 1);

    const second = await repairRestoredBackupPaths(temp.appPaths);
    assert.equal(second.repaired, false);
    const marker = JSON.parse(await readFile(summaryPath, 'utf8')).pathRepair;
    assert.equal(marker.version, 1);
    assert.equal(marker.attachmentsRepaired, 2);
  } finally {
    await temp.dispose();
  }
});

test('repair is skipped for profiles that never imported a backup or were imported by the fixed version', async () => {
  const temp = await fixture();
  try {
    assert.equal((await repairRestoredBackupPaths(temp.appPaths)).repaired, false);
    const summaryPath = path.join(temp.dataDir, '.settings', 'restore-summary.json');
    writeFileSync(summaryPath, JSON.stringify({ package: { version: '0.4.20' }, attachmentCounts: { attachmentsRestored: 1 } }));
    await mkdir(path.join(temp.appPaths.mineruCacheDir, 'default', 'document-user'), { recursive: true });
    assert.equal((await repairRestoredBackupPaths(temp.appPaths)).repaired, false);
    assert.equal(existsSync(path.join(temp.appPaths.mineruCacheDir, 'default', 'document-user')), true);
  } finally {
    await temp.dispose();
  }
});
