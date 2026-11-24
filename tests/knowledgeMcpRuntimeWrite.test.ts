import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { readExternalWriteMarker } = require('../electron/backend/externalWriteMarker.cjs');

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

function setupFixture({ running = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-runtime-'));
  const storageDir = path.join(dir, 'storage');
  const store = createLibraryStore({ dataDir: dir, libraryDatabasePath: path.join(dir, 'paperquay-library.sqlite') });
  const library = store.load();
  library.settings.storageDir = storageDir;
  store.save(library);
  store.close();

  const service = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => running });
  return { dir, storageDir, service, storeFactory: () => createLibraryStore({ dataDir: dir, libraryDatabasePath: path.join(dir, 'paperquay-library.sqlite') }) };
}

function writeFakePdf(dir: string, name: string, marker = name): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, `%PDF-1.4 fake test bytes ${marker}`);
  return filePath;
}

test('runtime write: update_paper requires a version and rejects stale versions with PAPER_CONFLICT', () => {
  const { dir, service } = setupFixture();
  const pdfPath = writeFakePdf(dir, 'a.pdf');
  try {
    const paperId = service.importPdfs({ paths: [pdfPath], allowWhileAppRunning: true }).imported[0].id;
    const before = service.getPaperDetails({ paperId });
    assert.ok(before.updatedAt > 0);

    assert.throws(
      () => service.updatePaper({ paperId, title: 'No version', allowWhileAppRunning: true }),
      (error: any) => error.code === 'PAPER_CONFLICT' && /requires expectedUpdatedAt/.test(error.message),
    );

    const updated = service.updatePaper({
      paperId,
      title: 'Versioned',
      expectedUpdatedAt: before.updatedAt,
      allowWhileAppRunning: true,
    });
    assert.equal(updated.paper.title, 'Versioned');
    assert.ok(updated.paper.updatedAt > before.updatedAt);

    assert.throws(
      () => service.updatePaper({
        paperId,
        title: 'Stale write',
        expectedUpdatedAt: before.updatedAt,
        allowWhileAppRunning: true,
      }),
      (error: any) => {
        assert.equal(error.code, 'PAPER_CONFLICT');
        assert.equal(error.details.currentUpdatedAt, updated.paper.updatedAt);
        return true;
      },
    );
  } finally {
    cleanupDir(dir);
  }
});

test('runtime write: set_paper_categories is all-or-nothing across per-paper versions', () => {
  const { dir, service } = setupFixture();
  try {
    const paperA = service.importPdfs({ paths: [writeFakePdf(dir, 'a.pdf')], allowWhileAppRunning: true }).imported[0];
    const paperB = service.importPdfs({ paths: [writeFakePdf(dir, 'b.pdf')], allowWhileAppRunning: true }).imported[0];
    const categoryId = service.manageCategory({ action: 'create', name: 'Group', allowWhileAppRunning: true }).category.id;

    // Externally bump paper B so its version no longer matches.
    service.updatePaper({ paperId: paperB.id, title: 'B2', expectedUpdatedAt: paperB.updatedAt, allowWhileAppRunning: true });

    const currentA = service.getPaperDetails({ paperId: paperA.id }).updatedAt;
    const currentB = service.getPaperDetails({ paperId: paperB.id }).updatedAt;

    assert.throws(
      () => service.setPaperCategories({
        paperIds: [paperA.id, paperB.id],
        add: [categoryId],
        expectedUpdatedAt: { [paperA.id]: currentA, [paperB.id]: currentB - 1 },
        allowWhileAppRunning: true,
      }),
      (error: any) => error.code === 'PAPER_CONFLICT',
    );
    assert.deepEqual(service.getPaperDetails({ paperId: paperA.id }).categoryIds, []);
    assert.deepEqual(service.getPaperDetails({ paperId: paperB.id }).categoryIds, []);

    const applied = service.setPaperCategories({
      paperIds: [paperA.id, paperB.id],
      add: [categoryId],
      expectedUpdatedAt: { [paperA.id]: currentA, [paperB.id]: currentB },
      allowWhileAppRunning: true,
    });
    assert.deepEqual(applied.updated.map((paper: any) => paper.categoryIds), [[categoryId], [categoryId]]);

    assert.throws(
      () => service.setPaperCategories({ paperIds: [paperA.id], add: [categoryId], allowWhileAppRunning: true }),
      (error: any) => error.code === 'PAPER_CONFLICT' && /requires expectedUpdatedAt/.test(error.message),
    );
  } finally {
    cleanupDir(dir);
  }
});

test('runtime write: duplicate import reports existingPaperId only and never appends categories', () => {
  const { dir, service } = setupFixture();
  const first = writeFakePdf(dir, 'a.pdf', 'same-bytes');
  const second = writeFakePdf(dir, 'b.pdf', 'same-bytes');
  try {
    const paperId = service.importPdfs({ paths: [first], allowWhileAppRunning: true }).imported[0].id;
    const categoryId = service.manageCategory({ action: 'create', name: 'Later', allowWhileAppRunning: true }).category.id;

    const duplicate = service.importPdfs({ paths: [second], targetCategoryId: categoryId, allowWhileAppRunning: true });
    assert.equal(duplicate.summary.duplicateCount, 1);
    assert.equal(duplicate.duplicates[0].existingPaperId, paperId);
    assert.deepEqual(service.getPaperDetails({ paperId }).categoryIds, []);
  } finally {
    cleanupDir(dir);
  }
});

test('runtime write: delete preview version is enforced and partial file selection is honored', () => {
  const { dir, service } = setupFixture();
  try {
    const paperA = service.importPdfs({ paths: [writeFakePdf(dir, 'a.pdf')], allowWhileAppRunning: true }).imported[0];
    const paperB = service.importPdfs({ paths: [writeFakePdf(dir, 'b.pdf')], allowWhileAppRunning: true }).imported[0];

    const preview = service.previewDeletePapers({ paperIds: [paperA.id, paperB.id], deleteFilePaperIds: [paperA.id] });
    assert.equal(preview.summary.paperCount, 2);
    assert.equal(preview.summary.fileCount, 1);
    assert.equal(preview.files[0].paperId, paperA.id);

    assert.throws(
      () => service.deletePapers({ paperIds: [paperA.id, paperB.id], deleteFilePaperIds: [paperA.id], allowWhileAppRunning: true }),
      (error: any) => error.code === 'PAPER_CONFLICT' && /previewVersion/.test(error.message),
    );

    // A write invalidates the preview.
    service.updatePaper({ paperId: paperB.id, title: 'Changed', expectedUpdatedAt: paperB.updatedAt, allowWhileAppRunning: true });
    assert.throws(
      () => service.deletePapers({
        paperIds: [paperA.id, paperB.id],
        deleteFilePaperIds: [paperA.id],
        previewVersion: preview.previewVersion,
        allowWhileAppRunning: true,
      }),
      (error: any) => error.code === 'PAPER_CONFLICT' && /stale/.test(error.message),
    );

    const fresh = service.previewDeletePapers({ paperIds: [paperA.id, paperB.id], deleteFilePaperIds: [paperA.id] });
    const removed = service.deletePapers({
      paperIds: [paperA.id, paperB.id],
      deleteFilePaperIds: [paperA.id],
      previewVersion: fresh.previewVersion,
      allowWhileAppRunning: true,
    });
    assert.equal(removed.total, 2);
    assert.equal(removed.deletedFileCount, 1);
    assert.equal(existsSync(paperA.storedPath), false);
    assert.equal(existsSync(paperB.storedPath), true);

    assert.throws(
      () => service.previewDeletePapers({ paperIds: [paperA.id], deleteFilePaperIds: [] }),
      /Paper does not exist/,
    );
  } finally {
    cleanupDir(dir);
  }
});

test('runtime write: shared and unmanaged attachment files are never deleted', () => {
  const { dir, service, storeFactory } = setupFixture();
  try {
    const paperA = service.importPdfs({ paths: [writeFakePdf(dir, 'a.pdf')], allowWhileAppRunning: true }).imported[0];
    const paperB = service.importPdfs({ paths: [writeFakePdf(dir, 'b.pdf')], allowWhileAppRunning: true }).imported[0];

    const store = storeFactory();
    const savedB = store.getPaper(paperB.id);
    savedB.attachments[0].storedPath = paperA.storedPath;
    store.savePaper(savedB);
    store.close();

    const preview = service.previewDeletePapers({ paperIds: [paperA.id], deleteFiles: true });
    assert.equal(preview.summary.sharedFileCount, 1);
    assert.equal(preview.files.length, 0);

    const removed = service.deletePapers({
      paperIds: [paperA.id],
      deleteFiles: true,
      previewVersion: preview.previewVersion,
      allowWhileAppRunning: true,
    });
    assert.equal(removed.deletedFileCount, 0);
    assert.equal(existsSync(paperA.storedPath), true);
  } finally {
    cleanupDir(dir);
  }
});

test('runtime write: category cascade validates every affected version', () => {
  const { dir, service } = setupFixture();
  try {
    const parent = service.manageCategory({ action: 'create', name: 'Parent', allowWhileAppRunning: true }).category.id;
    const child = service.manageCategory({ action: 'create', name: 'Child', parentId: parent, allowWhileAppRunning: true }).category.id;
    const paperId = service.importPdfs({ paths: [writeFakePdf(dir, 'a.pdf')], targetCategoryId: child, allowWhileAppRunning: true }).imported[0].id;

    const listed = service.listCategories().categories;
    const parentVersion = listed.find((item: any) => item.id === parent).updatedAt;
    const staleChildVersion = listed.find((item: any) => item.id === child).updatedAt;

    service.manageCategory({
      action: 'rename',
      categoryId: child,
      name: 'Renamed child',
      expectedUpdatedAt: staleChildVersion,
      allowWhileAppRunning: true,
    });

    assert.throws(
      () => service.manageCategory({
        action: 'delete',
        categoryId: parent,
        expectedUpdatedAt: parentVersion,
        expectedCategoryVersions: { [parent]: parentVersion, [child]: staleChildVersion },
        allowWhileAppRunning: true,
      }),
      (error: any) => error.code === 'CATEGORY_CONFLICT',
    );
    assert.ok(service.listCategories().categories.some((item: any) => item.id === child));

    const fresh = service.listCategories().categories;
    const versions = Object.fromEntries(fresh.map((item: any) => [item.id, item.updatedAt]));
    const removed = service.manageCategory({
      action: 'delete',
      categoryId: parent,
      expectedUpdatedAt: versions[parent],
      expectedCategoryVersions: { [parent]: versions[parent], [child]: versions[child] },
      allowWhileAppRunning: true,
    });
    assert.equal(removed.affectedCategoryCount, 2);
    assert.equal(removed.affectedPaperCount, 1);
    assert.deepEqual(removed.affectedPaperIds, [paperId]);
    assert.deepEqual(service.getPaperDetails({ paperId }).categoryIds, []);
  } finally {
    cleanupDir(dir);
  }
});

test('runtime write: external write marker records library revisions', () => {
  const { dir, service } = setupFixture();
  try {
    const before = readExternalWriteMarker(dir).state.library.revision;
    const paperId = service.importPdfs({ paths: [writeFakePdf(dir, 'a.pdf')], allowWhileAppRunning: true }).imported[0].id;
    const afterImport = readExternalWriteMarker(dir).state.library.revision;
    assert.equal(afterImport, before + 1);
    const details = service.getPaperDetails({ paperId });
    service.updatePaper({ paperId, title: 'Next', expectedUpdatedAt: details.updatedAt, allowWhileAppRunning: true });
    assert.equal(readExternalWriteMarker(dir).state.library.revision, afterImport + 1);
  } finally {
    cleanupDir(dir);
  }
});

test('desktop metadata save detects a stale form snapshot after an MCP write', async () => {
  const { dir, service } = setupFixture({ running: false });
  try {
    const paperId = service.importPdfs({ paths: [writeFakePdf(dir, 'a.pdf')] }).imported[0].id;
    const formSnapshot = service.getPaperDetails({ paperId });

    service.updatePaper({ paperId, abstractText: 'MCP wrote this abstract' });

    const appPaths = {
      dataDir: dir,
      libraryDatabasePath: path.join(dir, 'paperquay-library.sqlite'),
      libraryPath: path.join(dir, 'paperquay-library.json'),
      configPath: path.join(dir, '.settings', 'paperquay.config.json'),
      mineruCacheDir: path.join(dir, '.mineru-cache'),
      remotePdfDownloadDir: path.join(dir, '.downloads', 'pdfs'),
      notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
      ragDatabasePath: path.join(dir, 'paperquay-rag.sqlite'),
      agentMemoryDir: path.join(dir, 'agent-memory'),
      screenshotDir: path.join(dir, '.screenshots'),
    };
    const libraryCommands = require('../electron/backend/libraryCommands.cjs');
    const desktopStore = createLibraryStore(appPaths);
    const commands = libraryCommands.createLibraryCommands({ appPaths, store: desktopStore });

    await assert.rejects(
      () => commands.library_update_paper({
        request: {
          paperId,
          title: 'Desktop stale save',
          abstractText: null,
          expectedUpdatedAt: formSnapshot.updatedAt,
        },
      }),
      (error: any) => /PAPER_CONFLICT/.test(String(error?.message || error)),
    );

    const fresh = service.getPaperDetails({ paperId });
    assert.equal(fresh.abstractText, 'MCP wrote this abstract');
    const saved = await commands.library_update_paper({
      request: { paperId, title: 'Desktop save', expectedUpdatedAt: fresh.updatedAt },
    });
    assert.equal(saved.title, 'Desktop save');
    assert.equal(service.getPaperDetails({ paperId }).abstractText, 'MCP wrote this abstract');
    desktopStore.close();
  } finally {
    cleanupDir(dir);
  }
});

test('preview delete: missing library database returns an empty preview without creating it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-preview-missing-'));
  const service = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => false });
  const dbPath = path.join(dir, 'paperquay-library.sqlite');
  try {
    assert.equal(existsSync(dbPath), false);
    const preview = service.previewDeletePapers({ paperIds: ['paper-x'] });
    assert.equal(preview.papers.length, 0);
    assert.equal(preview.files.length, 0);
    assert.equal(preview.summary.paperCount, 0);
    assert.equal(existsSync(dbPath), false);
  } finally {
    cleanupDir(dir);
  }
});

test('preview delete: opens the library read-only and never migrates or writes it', () => {
  const { dir, service } = setupFixture();
  try {
    const imported = service.importPdfs({
      paths: [writeFakePdf(dir, 'preview.pdf')],
      allowWhileAppRunning: true,
    }).imported[0];
    const dbPath = path.join(dir, 'paperquay-library.sqlite');
    const { DatabaseSync } = require('node:sqlite');

    // 可写连接会补建 schema；删掉 initialized 标记后，只有只读路径才能保持这张表缺失。
    const raw = new DatabaseSync(dbPath);
    raw.exec('DROP TABLE library_meta');
    raw.close();

    const before = readFileSync(dbPath);
    const preview = service.previewDeletePapers({ paperIds: [imported.id] });
    assert.equal(preview.summary.paperCount, 1);
    assert.ok(readFileSync(dbPath).equals(before));
    assert.equal(existsSync(`${dbPath}-journal`), false);

    const check = new DatabaseSync(dbPath, { readOnly: true });
    const meta = check.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'library_meta'",
    ).get();
    check.close();
    assert.equal(meta, undefined);
  } finally {
    cleanupDir(dir);
  }
});
