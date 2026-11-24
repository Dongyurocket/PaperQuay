import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const require = createRequire(import.meta.url);
const { createPdfMetadataCommands } = require('../electron/backend/pdfMetadataCommands.cjs');
const { createPathPolicy } = require('../electron/backend/pathPolicy.cjs');

const TITLE = 'A Study of Deterministic Metadata Extraction';
const AUTHOR = 'Ada Lovelace; Alan Turing';
const SUBJECT = 'Journal of Reproducible Tests';
const DOI = '10.1234/example.5678';

interface CommandContext {
  dataDir: string;
  commands: ReturnType<typeof createPdfMetadataCommands>;
  approvedReadPaths: Set<string>;
}

function createContext(options: { maxBytes?: number } = {}): CommandContext {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-pdf-metadata-'));
  const appPaths = {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
  };
  const approvedReadPaths = new Set<string>();
  const approvedWritePaths = new Set<string>();
  const store = {
    load: () => ({
      settings: { storageDir: path.join(dataDir, 'paperquay-data') },
      papers: [],
    }),
  };
  const pathPolicy = createPathPolicy({ appPaths, store, approvedReadPaths, approvedWritePaths });
  const commands = createPdfMetadataCommands({
    appPaths,
    store,
    approvedReadPaths,
    approvedWritePaths,
    pathPolicy,
    pdfMetadataPreviewMaxBytes: options.maxBytes,
  });
  return { dataDir, commands, approvedReadPaths };
}

async function writePdf(filePath: string, options: { padBytes?: number } = {}): Promise<void> {
  const document = await PDFDocument.create();
  document.setTitle(TITLE);
  document.setAuthor(AUTHOR);
  document.setSubject(SUBJECT);
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(TITLE, { x: 60, y: 760, size: 20, font });
  page.drawText('Ada Lovelace and Alan Turing', { x: 60, y: 730, size: 12, font });
  page.drawText(`Article DOI ${DOI}`, { x: 60, y: 700, size: 10, font });
  const bytes = await document.save();
  const payload = options.padBytes
    ? Buffer.concat([Buffer.from(bytes), Buffer.from(`\n%${'A'.repeat(options.padBytes)}\n`)])
    : Buffer.from(bytes);
  writeFileSync(filePath, payload);
}

test('pdf_read_metadata_preview returns metadata and first-page lines without PDF bytes', async () => {
  const { dataDir, commands } = createContext();
  const pdfPath = path.join(dataDir, 'paper.pdf');

  try {
    await writePdf(pdfPath);
    const result = await commands.pdf_read_metadata_preview({ path: pdfPath });

    assert.equal(result.numPages, 1);
    assert.equal(result.info.title, TITLE);
    assert.equal(result.info.author, AUTHOR);
    assert.equal(result.info.subject, SUBJECT);
    assert.match(result.firstPageText, /A Study of Deterministic Metadata Extraction/);
    assert.ok(Array.isArray(result.lines) && result.lines.length >= 2);
    for (const line of result.lines) {
      assert.equal(typeof line.text, 'string');
      assert.equal(typeof line.x, 'number');
      assert.equal(typeof line.y, 'number');
      assert.equal(typeof line.avgHeight, 'number');
      assert.equal(typeof line.orderIndex, 'number');
    }

    // The command must never return the PDF itself (or base64 of it).
    assert.equal('data' in result, false);
    assert.equal('base64' in result, false);
    assert.ok(!JSON.stringify(result).includes('%PDF-'));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('renderer heuristics still pick title, authors, DOI and year from the preview payload', async () => {
  const { dataDir, commands } = createContext();
  const pdfPath = path.join(dataDir, 'paper.pdf');
  const previousWindow = (globalThis as any).window;

  try {
    await writePdf(pdfPath);
    const payload = await commands.pdf_read_metadata_preview({ path: pdfPath });
    const calls: Array<{ command: string; args: unknown }> = [];
    (globalThis as any).window = {
      paperquay: {
        invoke: async (command: string, args: unknown) => {
          calls.push({ command, args });
          return payload;
        },
      },
    };

    const { extractLocalPdfMetadataPreview } = await import('../src/services/pdfMetadata.ts');
    const preview = await extractLocalPdfMetadataPreview(pdfPath);

    assert.deepEqual(calls, [{ command: 'pdf_read_metadata_preview', args: { path: pdfPath } }]);
    assert.equal(preview.title, TITLE);
    assert.deepEqual(preview.authors, ['Ada Lovelace', 'Alan Turing']);
    assert.equal(preview.doi, DOI);
    assert.equal(preview.publication, SUBJECT);
    assert.match(preview.year ?? '', /^(?:19|20)\d{2}$/);
    assert.match(preview.firstPageText ?? '', /A Study of Deterministic Metadata Extraction/);
  } finally {
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('preview payload is far smaller than the padded PDF on disk', async () => {
  const { dataDir, commands } = createContext();
  const pdfPath = path.join(dataDir, 'padded.pdf');

  try {
    await writePdf(pdfPath, { padBytes: 2_000_000 });
    const fileSize = readFileSync(pdfPath).byteLength;
    const result = await commands.pdf_read_metadata_preview({ path: pdfPath });
    const payloadBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');

    assert.ok(fileSize > 2_000_000);
    assert.ok(payloadBytes < fileSize / 10, `payload ${payloadBytes}B should be far smaller than ${fileSize}B`);
    assert.ok(payloadBytes < 64 * 1024, `payload ${payloadBytes}B should stay a small JSON document`);
    assert.equal(result.numPages, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('pdf_read_metadata_preview rejects unauthorized, non-PDF and missing paths', async () => {
  const { dataDir, commands } = createContext();
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-pdf-metadata-outside-'));
  const outsidePdf = path.join(outsideDir, 'outside.pdf');
  const textPath = path.join(dataDir, 'notes.txt');
  const missingPdf = path.join(dataDir, 'missing.pdf');

  try {
    await writePdf(outsidePdf);
    writeFileSync(textPath, 'not a pdf');
    // The data dir is readable, but the outside temp dir was never approved.
    await assert.rejects(
      () => commands.pdf_read_metadata_preview({ path: outsidePdf }),
      /not allowed|Reading this path/i,
    );
    await assert.rejects(
      () => commands.pdf_read_metadata_preview({ path: textPath }),
      /\.pdf/i,
    );
    await assert.rejects(
      () => commands.pdf_read_metadata_preview({ path: missingPdf }),
      /not found/i,
    );
    await assert.rejects(
      () => commands.pdf_read_metadata_preview({ path: '' }),
      /empty/i,
    );
    await assert.rejects(
      () => commands.pdf_read_metadata_preview({ path: '\\\\?\\C:\\secret.pdf' }),
      /not allowed/i,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('pdf_read_metadata_preview rejects oversized files with a clear error', async () => {
  const { dataDir, commands } = createContext({ maxBytes: 512 });
  const pdfPath = path.join(dataDir, 'large.pdf');

  try {
    await writePdf(pdfPath);
    await assert.rejects(
      () => commands.pdf_read_metadata_preview({ path: pdfPath }),
      /too large/i,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('renderer metadata service no longer sends the whole PDF through IPC', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/services/pdfMetadata.ts'), 'utf8');
  const backend = readFileSync(path.join(process.cwd(), 'electron/backend.cjs'), 'utf8');
  const { isRendererCommandAllowed } = require('../electron/ipcAllowlist.cjs');

  assert.equal(source.includes('readLocalBinaryFile'), false);
  assert.equal(source.includes('read_binary_file_base64'), false);
  assert.equal(source.includes('react-pdf'), false);
  assert.match(source, /pdf_read_metadata_preview/);
  assert.equal(existsSync(path.join(process.cwd(), 'electron/backend/pdfMetadataCommands.cjs')), true);

  // The command must be reachable from the renderer and wired into the backend.
  assert.equal(isRendererCommandAllowed('pdf_read_metadata_preview'), true);
  assert.match(backend, /createPdfMetadataCommands/);
});

test('pdf_read_metadata_preview parse timing benchmark', { skip: process.env.PAPERQUAY_PERF !== '1' }, async () => {
  const { dataDir, commands } = createContext();
  const pdfPath = path.join(dataDir, 'timed.pdf');

  try {
    await writePdf(pdfPath, { padBytes: 5_000_000 });
    const startedAt = process.hrtime.bigint();
    const result = await commands.pdf_read_metadata_preview({ path: pdfPath });
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const payloadBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    console.log(`[perf] pdf_read_metadata_preview: ${elapsedMs.toFixed(1)}ms, payload=${payloadBytes}B, file=${readFileSync(pdfPath).byteLength}B`);
    assert.equal(result.numPages, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
