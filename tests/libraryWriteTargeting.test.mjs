import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { createPathPolicy } = require('../electron/backend/pathPolicy.cjs');

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-write-targeting-'));
  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    screenshotDir: path.join(dataDir, '.screenshots'),
  };
}

function makePaper(id, overrides = {}) {
  return {
    id,
    title: `Paper ${id}`,
    year: null,
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
    keywords: [],
    importedAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: false,
    userNote: null,
    aiSummary: null,
    citation: null,
    source: 'local',
    sortOrder: 0,
    authors: [],
    tags: [],
    categoryIds: [],
    attachments: [],
    ...overrides,
  };
}

test('deleting a paper removes its RAG index', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const removed = [];
  const commands = createLibraryCommands({
    appPaths,
    store,
    ragStore: {
      removeDocumentIndex: async ({ documentKey }) => {
        removed.push(documentKey);
        return { removed: true };
      },
    },
  });

  try {
    store.savePaper(makePaper('paper-1'));
    await commands.library_delete_paper({ request: { paperId: 'paper-1' } });
    assert.deepEqual(removed, ['paper-1']);
    assert.equal(store.getPaper('paper-1'), null);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('settings writes do not touch papers, and sort-order writes only change sort_order', () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);

  try {
    store.savePaper(makePaper('paper-1', { title: 'Keep me', sortOrder: 1 }));

    store.saveSettings({ ...store.loadSettings(), notesVaultDir: 'C:/vault' });
    const afterSettings = store.getPaper('paper-1');
    assert.equal(afterSettings?.title, 'Keep me');
    assert.equal(afterSettings?.sortOrder, 1);
    assert.equal(store.loadSettings().notesVaultDir, 'C:/vault');

    store.savePaperSortOrders([{ paperId: 'paper-1', sortOrder: 42 }]);
    const afterSort = store.getPaper('paper-1');
    assert.equal(afterSort?.sortOrder, 42);
    assert.equal(afterSort?.title, 'Keep me', 'unrelated columns must not be rewritten');
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library_update_settings keeps papers written before it and still migrates settings', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const commands = createLibraryCommands({ appPaths, store });

  try {
    store.savePaper(makePaper('paper-1'));
    const settings = await commands.library_update_settings({
      settings: { ...store.loadSettings(), autoRenameFiles: false },
    });
    assert.equal(settings.autoRenameFiles, false);
    assert.equal(store.getPaper('paper-1')?.title, 'Paper paper-1');
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('a fresh library database contains the system categories used by targeted writes', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const commands = createLibraryCommands({ appPaths, store });

  try {
    const systemCategories = store.listCategoriesWithCounts().filter((category) => category.isSystem);
    assert.ok(systemCategories.length >= 3, 'system categories must be seeded at database creation');

    const created = await commands.library_create_category({ request: { name: 'New category' } });
    assert.ok(created?.id);
    assert.equal(created?.name, 'New category');
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library mutations never fall back to the whole-library save path', async () => {
  const appPaths = createAppPaths();
  const baseStore = createLibraryStore(appPaths);
  const store = {
    ...baseStore,
    save() {
      throw new Error('whole-library save() must not be used');
    },
    saveSync() {
      throw new Error('whole-library saveSync() must not be used');
    },
  };
  const commands = createLibraryCommands({
    appPaths,
    store,
    ragStore: { removeDocumentIndex: async () => ({ removed: true }) },
  });

  try {
    baseStore.savePaper(makePaper('paper-spy'));
    const category = await commands.library_create_category({ request: { name: 'Spy category' } });
    await commands.library_update_category({ request: { id: category.id, name: 'Renamed' } });
    await commands.library_reorder_papers({ request: { paperIds: ['paper-spy'] } });
    await commands.library_update_settings({
      settings: { ...baseStore.loadSettings(), autoRenameFiles: true },
    });
    await commands.library_delete_paper({ request: { paperId: 'paper-spy' } });
    await commands.library_delete_category({ categoryId: category.id });
  } finally {
    baseStore.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('attachment containment only allows the attachment directory and its descendants', () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const attachmentDir = path.join(appPaths.dataDir, 'pap_ers');
  const attachmentPath = path.join(attachmentDir, 'paper.pdf');

  try {
    store.savePaper(makePaper('paper-attachment', {
      attachments: [{
        id: 'att-1',
        paperId: 'paper-attachment',
        kind: 'pdf',
        originalPath: attachmentPath,
        storedPath: attachmentPath,
        relativePath: null,
        fileName: 'paper.pdf',
        mimeType: 'application/pdf',
        fileSize: 10,
        contentHash: 'hash',
        createdAt: 1,
        missing: false,
      }],
    }));

    assert.equal(store.isKnownAttachmentLocation(attachmentPath), true);
    assert.equal(
      store.isKnownAttachmentLocation(path.join(attachmentDir, 'content_list_v2.json')),
      true,
      'sibling MinerU output is allowed',
    );
    assert.equal(
      store.isKnownAttachmentLocation(path.join(attachmentDir, 'images', 'figure.png')),
      true,
      'descendant directories are allowed',
    );
    assert.equal(store.isKnownAttachmentDirectory(attachmentDir), true);
    assert.equal(store.isKnownAttachmentDirectory(path.join(attachmentDir, 'images')), true);
    assert.equal(store.isKnownAttachmentDirectory(appPaths.dataDir), false);
    assert.equal(
      store.isKnownAttachmentLocation(path.join(appPaths.dataDir, 'other.pdf')),
      false,
      'the attachment directory ancestor must not be treated as the attachment directory',
    );
    assert.equal(
      store.isKnownAttachmentLocation(path.join(appPaths.dataDir, 'papers', 'x.pdf')),
      false,
      'underscores in directory names must not act as LIKE wildcards',
    );
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library_import_pdfs rejects sources outside the allowed read roots', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const pathPolicy = createPathPolicy({ appPaths, store });
  const commands = createLibraryCommands({ appPaths, store, pathPolicy });
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-import-outside-'));
  const outsidePdf = path.join(outsideDir, 'outside.pdf');
  const insidePdf = path.join(appPaths.dataDir, 'inside.pdf');
  writeFileSync(outsidePdf, '%PDF-1.7' + String.fromCharCode(10));
  writeFileSync(insidePdf, '%PDF-1.7' + String.fromCharCode(10));

  try {
    const rejected = await commands.library_import_pdfs({
      request: { paths: [outsidePdf], importMode: 'copy', source: 'local' },
    });
    assert.equal(rejected[0]?.status, 'failed');
    assert.match(rejected[0]?.message ?? '', /outside the allowed paths/);

    const accepted = await commands.library_import_pdfs({
      request: { paths: [insidePdf], importMode: 'copy', source: 'local' },
    });
    assert.equal(accepted[0]?.status, 'imported');
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('library_update_settings only accepts storage directories approved by a picker', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const pathPolicy = createPathPolicy({ appPaths, store });
  const commands = createLibraryCommands({ appPaths, store, pathPolicy });
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-storage-outside-'));

  try {
    await assert.rejects(
      commands.library_update_settings({
        settings: { ...store.loadSettings(), storageDir: outsideDir },
      }),
      /not allowed without a directory picker/,
    );

    // 目录对话框授权后（pathPolicy.approveWritePath 由 select_directory 调用）即可保存。
    pathPolicy.approveWritePath(outsideDir);
    const updated = await commands.library_update_settings({
      settings: { ...store.loadSettings(), storageDir: outsideDir },
    });
    assert.equal(updated.storageDir, outsideDir);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('library_relocate_attachment cannot mint read access for arbitrary files', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const pathPolicy = createPathPolicy({ appPaths, store });
  const commands = createLibraryCommands({ appPaths, store, pathPolicy });
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-relocate-outside-'));
  const insidePdf = path.join(appPaths.dataDir, 'inside.pdf');
  const outsidePdf = path.join(outsideDir, 'outside.pdf');
  writeFileSync(insidePdf, '%PDF-1.7' + String.fromCharCode(10));
  writeFileSync(outsidePdf, '%PDF-1.7' + String.fromCharCode(10));

  try {
    store.savePaper(makePaper('paper-relocate', {
      attachments: [{
        id: 'att-relocate',
        paperId: 'paper-relocate',
        kind: 'pdf',
        originalPath: insidePdf,
        storedPath: insidePdf,
        relativePath: null,
        fileName: 'inside.pdf',
        mimeType: 'application/pdf',
        fileSize: 8,
        contentHash: 'hash',
        createdAt: 1,
        missing: false,
      }],
    }));

    await assert.rejects(
      commands.library_relocate_attachment({
        request: { attachmentId: 'att-relocate', newPath: path.join(outsideDir, 'secret.ini') },
      }),
      /Only PDF attachments/,
    );
    await assert.rejects(
      commands.library_relocate_attachment({
        request: { attachmentId: 'att-relocate', newPath: outsidePdf },
      }),
      /not allowed/,
    );

    // 用户通过文件对话框选中的 PDF 可以正常重新定位。
    pathPolicy.approveReadPath(outsidePdf);
    const relocated = await commands.library_relocate_attachment({
      request: { attachmentId: 'att-relocate', newPath: outsidePdf },
    });
    assert.equal(path.resolve(relocated.storedPath), path.resolve(outsidePdf));
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('forward-slash attachment paths cannot match unrelated directories', { skip: process.platform !== 'win32' }, () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const forwardPath = 'C:/paperquay-forward-not-real/paper.pdf';

  try {
    store.savePaper(makePaper('paper-forward', {
      attachments: [{
        id: 'att-forward',
        paperId: 'paper-forward',
        kind: 'pdf',
        originalPath: forwardPath,
        storedPath: forwardPath,
        relativePath: null,
        fileName: 'paper.pdf',
        mimeType: 'application/pdf',
        fileSize: 8,
        contentHash: 'hash',
        createdAt: 1,
        missing: false,
      }],
    }));

    assert.equal(store.isKnownAttachmentLocation('C:/paperquay-forward-not-real/content.json'), true);
    assert.equal(store.isKnownAttachmentLocation('C:\Windows\win.ini'), false);
    assert.equal(store.isKnownAttachmentDirectory('C:\Windows'), false);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
