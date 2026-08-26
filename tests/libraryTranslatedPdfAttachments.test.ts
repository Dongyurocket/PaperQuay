import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

type AttachmentResult = {
  id: string;
  kind: string;
  storedPath: string;
};

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-translated-pdf-test-'));

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

test('translated PDF attachments can be added, replaced, and removed', async () => {
  const appPaths = createAppPaths();
  let store: ReturnType<typeof createLibraryStore> | null = null;

  try {
    const storageDir = path.join(appPaths.dataDir, 'papers');
    const sourceDir = path.join(appPaths.dataDir, 'retainpdf-output');
    const primaryPdfPath = path.join(storageDir, 'primary.pdf');
    const firstSourcePath = path.join(sourceDir, 'v1', 'translated.pdf');
    const secondSourcePath = path.join(sourceDir, 'v2', 'translated.pdf');

    await mkdir(storageDir, { recursive: true });
    await mkdir(path.dirname(firstSourcePath), { recursive: true });
    await mkdir(path.dirname(secondSourcePath), { recursive: true });
    writeFileSync(primaryPdfPath, '%PDF-1.7\nprimary\n');
    writeFileSync(firstSourcePath, '%PDF-1.7\ntranslated-v1\n');
    writeFileSync(secondSourcePath, '%PDF-1.7\ntranslated-v2\n');

    store = createLibraryStore(appPaths);
    const library = store.load();
    library.settings.storageDir = storageDir;
    library.papers.push({
      id: 'paper-translated',
      title: 'Translated Attachment Paper',
      titleZh: '翻译附件论文',
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
      attachments: [{
        id: 'att-primary',
        paperId: 'paper-translated',
        kind: 'pdf',
        originalPath: primaryPdfPath,
        storedPath: primaryPdfPath,
        relativePath: 'primary.pdf',
        fileName: 'primary.pdf',
        mimeType: 'application/pdf',
        fileSize: readFileSync(primaryPdfPath).length,
        contentHash: null,
        createdAt: 1,
        missing: false,
      }],
    });
    await store.save(library);

    const commands = createLibraryCommands({ appPaths, store });
    const firstUpdate = await commands.library_add_attachment({
      request: {
        paperId: 'paper-translated',
        sourcePath: firstSourcePath,
        kind: 'translated-pdf',
      },
    });
    const firstAttachment = firstUpdate.attachments.find(
      (item: AttachmentResult) => item.kind === 'translated-pdf',
    ) as AttachmentResult | undefined;
    assert.ok(firstAttachment);
    assert.equal(existsSync(firstAttachment.storedPath), true);
    assert.equal(readFileSync(firstAttachment.storedPath, 'utf8'), '%PDF-1.7\ntranslated-v1\n');
    await assert.rejects(
      commands.library_remove_attachment({
        request: { attachmentId: 'att-primary', deleteFile: true },
      }),
      /Only translated-pdf attachments can be removed/,
    );
    assert.equal(existsSync(primaryPdfPath), true);

    const secondUpdate = await commands.library_add_attachment({
      request: {
        paperId: 'paper-translated',
        sourcePath: secondSourcePath,
        kind: 'translated-pdf',
      },
    });
    const translatedAttachments = secondUpdate.attachments.filter(
      (item: AttachmentResult) => item.kind === 'translated-pdf',
    ) as AttachmentResult[];
    assert.equal(translatedAttachments.length, 1);
    assert.notEqual(translatedAttachments[0].id, firstAttachment.id);
    assert.notEqual(translatedAttachments[0].storedPath, firstAttachment.storedPath);
    assert.equal(existsSync(firstAttachment.storedPath), false);
    assert.equal(existsSync(translatedAttachments[0].storedPath), true);
    assert.equal(readFileSync(translatedAttachments[0].storedPath, 'utf8'), '%PDF-1.7\ntranslated-v2\n');

    const removed = await commands.library_remove_attachment({
      request: { attachmentId: translatedAttachments[0].id, deleteFile: true },
    });
    assert.equal(
      removed.attachments.some((item: AttachmentResult) => item.kind === 'translated-pdf'),
      false,
    );
    assert.equal(existsSync(translatedAttachments[0].storedPath), false);
    assert.equal(existsSync(firstSourcePath), true);
    assert.equal(existsSync(secondSourcePath), true);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('translated PDF replacement preserves the previous attachment when persistence fails', async () => {
  const appPaths = createAppPaths();
  let store: ReturnType<typeof createLibraryStore> | null = null;

  try {
    const storageDir = path.join(appPaths.dataDir, 'papers');
    const sourceDir = path.join(appPaths.dataDir, 'retainpdf-output');
    const primaryPdfPath = path.join(storageDir, 'primary.pdf');
    const firstSourcePath = path.join(sourceDir, 'translated-v1.pdf');
    const secondSourcePath = path.join(sourceDir, 'translated-v2.pdf');

    await mkdir(storageDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    writeFileSync(primaryPdfPath, '%PDF-1.7\nprimary\n');
    writeFileSync(firstSourcePath, '%PDF-1.7\ntranslated-v1\n');
    writeFileSync(secondSourcePath, '%PDF-1.7\ntranslated-v2\n');

    store = createLibraryStore(appPaths);
    const library = store.load();
    library.settings.storageDir = storageDir;
    library.papers.push({
      id: 'paper-save-failure',
      title: 'Persistence Failure Paper',
      titleZh: null,
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
      attachments: [{
        id: 'att-primary',
        paperId: 'paper-save-failure',
        kind: 'pdf',
        originalPath: primaryPdfPath,
        storedPath: primaryPdfPath,
        relativePath: 'primary.pdf',
        fileName: 'primary.pdf',
        mimeType: 'application/pdf',
        fileSize: readFileSync(primaryPdfPath).length,
        contentHash: null,
        createdAt: 1,
        missing: false,
      }],
    });
    await store.save(library);

    const commands = createLibraryCommands({ appPaths, store });
    const firstUpdate = await commands.library_add_attachment({
      request: {
        paperId: 'paper-save-failure',
        sourcePath: firstSourcePath,
        kind: 'translated-pdf',
      },
    });
    const firstAttachment = firstUpdate.attachments.find(
      (item: AttachmentResult) => item.kind === 'translated-pdf',
    ) as AttachmentResult;
    const originalSave = store.save.bind(store);
    store.save = async () => {
      throw new Error('simulated persistence failure');
    };

    await assert.rejects(
      commands.library_add_attachment({
        request: {
          paperId: 'paper-save-failure',
          sourcePath: secondSourcePath,
          kind: 'translated-pdf',
        },
      }),
      /simulated persistence failure/,
    );

    store.save = originalSave;
    const persistedPaper = store.load().papers.find((paper) => paper.id === 'paper-save-failure');
    const persistedTranslated = persistedPaper?.attachments.find(
      (item) => item.kind === 'translated-pdf',
    );
    assert.equal(persistedTranslated?.id, firstAttachment.id);
    assert.equal(existsSync(firstAttachment.storedPath), true);
    assert.equal(readFileSync(firstAttachment.storedPath, 'utf8'), '%PDF-1.7\ntranslated-v1\n');
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('translated PDF removal never deletes shared or library-external files', async () => {
  const appPaths = createAppPaths();
  let store: ReturnType<typeof createLibraryStore> | null = null;

  try {
    const storageDir = path.join(appPaths.dataDir, 'papers');
    const externalDir = path.join(appPaths.dataDir, 'external');
    const primaryPdfPath = path.join(storageDir, 'primary.pdf');
    const sharedPdfPath = path.join(externalDir, 'shared.pdf');

    await mkdir(storageDir, { recursive: true });
    await mkdir(externalDir, { recursive: true });
    writeFileSync(primaryPdfPath, '%PDF-1.7\nprimary\n');
    writeFileSync(sharedPdfPath, '%PDF-1.7\nshared\n');

    store = createLibraryStore(appPaths);
    const library = store.load();
    library.settings.storageDir = storageDir;
    library.papers.push({
      id: 'paper-shared',
      title: 'Shared Path Paper',
      titleZh: null,
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
      attachments: [
        {
          id: 'att-primary',
          paperId: 'paper-shared',
          kind: 'pdf',
          originalPath: primaryPdfPath,
          storedPath: primaryPdfPath,
          relativePath: 'primary.pdf',
          fileName: 'primary.pdf',
          mimeType: 'application/pdf',
          fileSize: readFileSync(primaryPdfPath).length,
          contentHash: null,
          createdAt: 1,
          missing: false,
        },
        {
          id: 'att-shared',
          paperId: 'paper-shared',
          kind: 'pdf',
          originalPath: sharedPdfPath,
          storedPath: sharedPdfPath,
          relativePath: null,
          fileName: 'shared.pdf',
          mimeType: 'application/pdf',
          fileSize: readFileSync(sharedPdfPath).length,
          contentHash: null,
          createdAt: 1,
          missing: false,
        },
        {
          id: 'att-translated-shared',
          paperId: 'paper-shared',
          kind: 'translated-pdf',
          originalPath: sharedPdfPath,
          storedPath: sharedPdfPath,
          relativePath: null,
          fileName: 'shared.pdf',
          mimeType: 'application/pdf',
          fileSize: readFileSync(sharedPdfPath).length,
          contentHash: null,
          createdAt: 2,
          missing: false,
        },
      ],
    });
    await store.save(library);

    const commands = createLibraryCommands({ appPaths, store });
    const updated = await commands.library_remove_attachment({
      request: { attachmentId: 'att-translated-shared', deleteFile: true },
    });

    assert.equal(updated.attachments.some((item) => item.id === 'att-translated-shared'), false);
    assert.equal(existsSync(sharedPdfPath), true);
    assert.equal(readFileSync(sharedPdfPath, 'utf8'), '%PDF-1.7\nshared\n');
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
