import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

function setupFixture(isAppRunning: () => boolean = () => false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-translated-pdf-mcp-'));
  const storageDir = path.join(dir, 'storage');
  mkdirSync(storageDir, { recursive: true });
  const store = createLibraryStore({
    dataDir: dir,
    libraryDatabasePath: path.join(dir, 'paperquay-library.sqlite'),
  });
  const library = store.load();
  library.settings.storageDir = storageDir;
  store.save(library);
  store.close();
  return {
    dir,
    storageDir,
    service: new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning }),
  };
}

function writeFakePdf(dir: string, name: string, marker = name) {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, `%PDF-1.4 fake test bytes ${marker}`);
  return filePath;
}

async function writePdf(dir: string, name: string, pageCount: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage();
  }
  const filePath = path.join(dir, name);
  writeFileSync(filePath, await document.save());
  return filePath;
}

test('attach_translated_pdf copies, replaces, and removes the stored translation', async () => {
  const { dir, storageDir, service } = setupFixture();
  const sourceDir = path.join(dir, 'sources');
  mkdirSync(sourceDir, { recursive: true });
  try {
    const original = writeFakePdf(storageDir, 'original.pdf', 'original');
    const imported = service.importPdfs({ paths: [original] });
    const paperId = imported.imported[0].id as string;
    const firstSource = writeFakePdf(sourceDir, 'translated-v1.pdf', 'v1');
    const secondSource = writeFakePdf(sourceDir, 'translated-v2.pdf', 'v2');

    const first = await service.attachTranslatedPdf({ paperId, sourcePath: firstSource });
    assert.equal(first.replaced, false);
    assert.equal(first.pageCountMismatch, null);
    assert.equal(existsSync(first.storedPath), true);
    assert.match(first.storedPath, /translated-pdfs/);
    assert.equal(existsSync(firstSource), true);

    const details = service.getPaperDetails({ paperId });
    const translated = details.attachments.filter((item: { kind: string }) => item.kind === 'translated-pdf');
    assert.equal(translated.length, 1);
    assert.equal(translated[0].id, first.attachmentId);
    assert.equal(typeof translated[0].relativePath, 'string');

    const second = await service.attachTranslatedPdf({ paperId, sourcePath: secondSource });
    assert.equal(second.replaced, true);
    assert.notEqual(second.attachmentId, first.attachmentId);
    assert.equal(existsSync(first.storedPath), false);
    assert.equal(existsSync(second.storedPath), true);

    const replacedDetails = service.getPaperDetails({ paperId });
    assert.equal(
      replacedDetails.attachments.filter((item: { kind: string }) => item.kind === 'translated-pdf').length,
      1,
    );

    const removed = await service.removeTranslatedPdf({ paperId, deleteFile: true });
    assert.equal(removed.attachmentId, second.attachmentId);
    assert.equal(existsSync(second.storedPath), false);
    assert.equal(existsSync(secondSource), true);
    const afterRemove = service.getPaperDetails({ paperId });
    assert.equal(
      afterRemove.attachments.some((item: { kind: string }) => item.kind === 'translated-pdf'),
      false,
    );
  } finally {
    cleanupDir(dir);
  }
});

test('attach_translated_pdf reports a page-count mismatch without rejecting', async () => {
  const { dir, storageDir, service } = setupFixture();
  try {
    const original = await writePdf(storageDir, 'original.pdf', 2);
    const translated = await writePdf(storageDir, 'translated.pdf', 1);
    const imported = service.importPdfs({ paths: [original] });
    const paperId = imported.imported[0].id as string;

    const attached = await service.attachTranslatedPdf({ paperId, sourcePath: translated });
    assert.deepEqual(attached.pageCountMismatch, { original: 2, translated: 1 });
    assert.equal(existsSync(attached.storedPath), true);
  } finally {
    cleanupDir(dir);
  }
});

test('translated PDF MCP writes reject a missing paper and a running desktop app', async () => {
  const { dir, service } = setupFixture();
  const guarded = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => true });
  try {
    await assert.rejects(
      () => service.attachTranslatedPdf({ paperId: 'missing-paper', sourcePath: path.join(dir, 'missing.pdf') }),
      /Paper does not exist: missing-paper/,
    );
    await assert.rejects(
      () => guarded.attachTranslatedPdf({ paperId: 'paper-1', sourcePath: path.join(dir, 'translated.pdf') }),
      /正在运行，已拒绝写入/,
    );
    await assert.rejects(
      () => guarded.removeTranslatedPdf({ paperId: 'paper-1' }),
      /正在运行，已拒绝写入/,
    );

    const source = writeFakePdf(dir, 'override.pdf', 'override');
    const imported = guarded.importPdfs({
      paths: [source],
      allowWhileAppRunning: true,
    });
    const paperId = imported.imported[0].id as string;
    const attached = await guarded.attachTranslatedPdf({
      paperId,
      sourcePath: source,
      allowWhileAppRunning: true,
    });
    assert.equal(attached.replaced, false);
    assert.match(String(attached.warning), /运行期间写入/);

    process.env.PAPERQUAY_MCP_WRITE = 'off';
    await assert.rejects(
      () => service.removeTranslatedPdf({ paperId, allowWhileAppRunning: true }),
      /PAPERQUAY_MCP_WRITE=off/,
    );
  } finally {
    delete process.env.PAPERQUAY_MCP_WRITE;
    cleanupDir(dir);
  }
});
