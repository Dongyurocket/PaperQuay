import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const {
  normalizeDoi,
  normalizeTitleForDuplicate,
  findDuplicatePaper,
  buildImportedAttachmentFileName,
  buildImportedPaperRecord,
  applyPaperMetadataPatch,
} = require('../electron/shared/libraryDomain.cjs');

function createFixture() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pq-shared-domain-'));
  const appPaths = {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    screenshotDir: path.join(dataDir, '.screenshots'),
  };
  const store = createLibraryStore(appPaths);
  const service = new PaperQuayKnowledgeService({
    dataDir,
    isAppRunning: () => false,
  });
  return {
    dataDir,
    appPaths,
    store,
    service,
    close() {
      service.close();
      store.close();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

function writePdf(dir: string, name: string, body = name) {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, `%PDF-1.7\n${body}\n`);
  return filePath;
}

function metadataFor(title: string, extra: Record<string, unknown> = {}) {
  return {
    title,
    titleZh: `${title}（中文）`,
    authors: ['Ada Lovelace', 'Alan Turing'],
    year: '2024',
    publication: 'Journal of Shared Code',
    doi: `10.1000/${title.toLowerCase().replace(/\s+/g, '-')}`,
    url: `https://example.test/${encodeURIComponent(title)}`,
    abstractText: 'The same metadata must land in desktop and MCP imports.',
    itemType: 'conferencePaper',
    publisher: 'Shared Press',
    institution: 'Shared Institute',
    reportNumber: 'R-1',
    volume: '12',
    issue: '3',
    pages: '1-10',
    isbn: '978-1-0000-0000-0',
    issn: '1234-5678',
    language: 'zh-cn',
    citationKey: 'shared2024',
    keywords: [' one ', '', 'two'],
    tags: [' alpha ', 'beta'],
    ...extra,
  };
}

function paperMetadataView(paper: any) {
  return {
    title: paper.title,
    titleZh: paper.titleZh ?? null,
    year: paper.year ?? null,
    publication: paper.publication ?? null,
    doi: paper.doi ?? null,
    url: paper.url ?? null,
    abstractText: paper.abstractText ?? null,
    itemType: paper.itemType ?? null,
    publisher: paper.publisher ?? null,
    institution: paper.institution ?? null,
    reportNumber: paper.reportNumber ?? null,
    volume: paper.volume ?? null,
    issue: paper.issue ?? null,
    pages: paper.pages ?? null,
    isbn: paper.isbn ?? null,
    issn: paper.issn ?? null,
    language: paper.language ?? null,
    citationKey: paper.citationKey ?? null,
    keywords: paper.keywords ?? [],
    authors: (paper.authors ?? []).map((author: any) => (typeof author === 'string' ? author : author.name)),
    tags: (paper.tags ?? []).map((tag: any) => (typeof tag === 'string' ? tag : tag.name)),
  };
}

test('duplicate detection uses the same content hash / DOI / title rules in desktop and MCP', async () => {
  const fixture = createFixture();
  try {
    const existing = {
      ...buildImportedPaperRecord({
        paperId: 'paper-existing',
        attachmentId: 'att-existing',
        metadata: {
          title: 'Shared Duplicate Paper',
          doi: 'https://doi.org/10.1000/SHARED-DUP',
          authors: ['Existing Author'],
        },
        source: 'local',
        sortOrder: 0,
        categoryIds: [],
        attachment: {
          originalPath: '/tmp/existing.pdf',
          storedPath: '/tmp/existing.pdf',
          relativePath: null,
          fileName: 'existing.pdf',
          fileSize: 10,
          contentHash: 'hash-existing',
        },
      }),
    };
    fixture.store.savePaper(existing);

    const commands = createLibraryCommands({ appPaths: fixture.appPaths, store: fixture.store });

    // Desktop matches by DOI, including https://doi.org/ prefixes and case.
    const doiPdf = writePdf(fixture.dataDir, 'desktop-doi.pdf', 'desktop-doi');
    const desktop = await commands.library_import_pdfs({
      request: {
        paths: [doiPdf],
        metadata: { [doiPdf]: { title: 'Different Title', doi: 'https://doi.org/10.1000/shared-dup' } },
      },
    });
    assert.equal(desktop[0].status, 'duplicate');
    assert.equal(desktop[0].existingPaperId, 'paper-existing');

    // MCP matches by normalized title.
    const titlePdf = writePdf(fixture.dataDir, 'mcp-title.pdf', 'mcp-title');
    const mcp = fixture.service.importPdfs({
      paths: [titlePdf],
      metadata: { [titlePdf]: { title: '  shared duplicate   paper ' } },
    });
    assert.equal(mcp.summary.duplicateCount, 1);
    assert.equal(mcp.duplicates[0].existingPaperId, 'paper-existing');

    // The shared helper itself reports the same winner and reason for both inputs.
    const byDoi = findDuplicatePaper({
      papers: [existing],
      contentHash: 'other-hash',
      doi: 'doi:10.1000/shared-dup',
      title: null,
    });
    const byTitle = findDuplicatePaper({
      papers: [existing],
      contentHash: 'other-hash',
      doi: null,
      title: 'Shared   Duplicate Paper',
    });
    assert.equal(byDoi.paper.id, 'paper-existing');
    assert.equal(byDoi.reason, 'doi');
    assert.equal(byTitle.paper.id, 'paper-existing');
    assert.equal(byTitle.reason, 'title');

    assert.equal(normalizeDoi('https://dx.doi.org/10.1000/ABC'), '10.1000/abc');
    assert.equal(normalizeTitleForDuplicate('  A & B:  C '), 'a and b c');
  } finally {
    fixture.close();
  }
});

test('desktop and MCP imports produce identical metadata and attachment naming', async () => {
  const fixture = createFixture();
  try {
    const metadata = metadataFor('Shared Metadata Paper');
    const commands = createLibraryCommands({ appPaths: fixture.appPaths, store: fixture.store });

    const desktopPdf = writePdf(fixture.dataDir, 'desktop-meta.pdf', 'desktop-meta');
    const desktopResults = await commands.library_import_pdfs({
      request: { paths: [desktopPdf], metadata: { [desktopPdf]: metadata } },
    });
    assert.equal(desktopResults[0].status, 'imported');
    const desktopPaper = desktopResults[0].paper;

    // The MCP importer must create the same record from the same metadata; remove
    // the desktop record first so duplicate detection does not mask the comparison.
    fixture.store.deletePaper(desktopPaper.id);

    const mcpPdf = writePdf(fixture.dataDir, 'mcp-meta.pdf', 'mcp-meta');
    const mcpResult = fixture.service.importPdfs({
      paths: [mcpPdf],
      metadata: { [mcpPdf]: metadata },
    });
    assert.equal(mcpResult.summary.importedCount, 1);
    const mcpDetails = fixture.service.getPaperDetails({ paperId: mcpResult.imported[0].id });

    assert.deepEqual(paperMetadataView(desktopPaper), paperMetadataView(mcpDetails));

    const settings = fixture.store.load().settings;
    const desktopAttachment = desktopPaper.attachments[0];
    const mcpAttachment = mcpDetails.attachments[0];
    assert.equal(
      path.basename(desktopAttachment.storedPath),
      buildImportedAttachmentFileName({
        settings,
        paperId: desktopPaper.id,
        attachmentId: desktopAttachment.id,
        fileName: 'desktop-meta.pdf',
        metadata,
      }),
    );
    assert.equal(
      path.basename(mcpAttachment.storedPath),
      buildImportedAttachmentFileName({
        settings,
        paperId: mcpDetails.id,
        attachmentId: mcpAttachment.id,
        fileName: 'mcp-meta.pdf',
        metadata,
      }),
    );
    assert.match(path.basename(mcpAttachment.storedPath), /^Ada_Lovelace_2024_Shared_Metadata_Paper__original__[0-9a-f]{8}\.pdf$/);

    // autoRenameFiles=false keeps the legacy `${paperId}-${fileName}` scheme in both paths.
    fixture.store.saveSettings({ ...settings, autoRenameFiles: false });
    const desktopNoRename = writePdf(fixture.dataDir, 'desktop-norename.pdf', 'desktop-norename');
    const desktopNoRenameResult = await commands.library_import_pdfs({
      request: { paths: [desktopNoRename], metadata: { [desktopNoRename]: metadataFor('No Rename Desktop') } },
    });
    assert.equal(
      path.basename(desktopNoRenameResult[0].paper.attachments[0].storedPath),
      `${desktopNoRenameResult[0].paper.id}-desktop-norename.pdf`,
    );

    const mcpNoRename = writePdf(fixture.dataDir, 'mcp-norename.pdf', 'mcp-norename');
    const mcpNoRenameResult = fixture.service.importPdfs({
      paths: [mcpNoRename],
      metadata: { [mcpNoRename]: metadataFor('No Rename MCP') },
    });
    const mcpNoRenameDetails = fixture.service.getPaperDetails({ paperId: mcpNoRenameResult.imported[0].id });
    assert.equal(
      path.basename(mcpNoRenameDetails.attachments[0].storedPath),
      `${mcpNoRenameDetails.id}-mcp-norename.pdf`,
    );
  } finally {
    fixture.close();
  }
});

test('empty language clears to null through desktop, MCP and the shared patch', async () => {
  const fixture = createFixture();
  try {
    const shared = applyPaperMetadataPatch({ language: 'en' }, { language: '' });
    assert.equal(shared.language, null);

    const commands = createLibraryCommands({ appPaths: fixture.appPaths, store: fixture.store });
    const pdf = writePdf(fixture.dataDir, 'language.pdf', 'language');
    const imported = await commands.library_import_pdfs({
      request: { paths: [pdf], metadata: { [pdf]: { title: 'Language Paper', language: 'en-US' } } },
    });
    const paperId = imported[0].paper.id;
    assert.equal(imported[0].paper.language, 'en-US');

    const updated = await commands.library_update_paper({
      request: { paperId, language: '' },
    });
    assert.equal(updated.language, null);

    const mcpUpdated = fixture.service.updatePaper({ paperId, language: 'fr' });
    assert.equal(mcpUpdated.paper.id, paperId);
    const cleared = fixture.service.updatePaper({ paperId, language: '' });
    assert.equal(cleared.paper.id, paperId);
    assert.equal(fixture.service.getPaperDetails({ paperId }).language, null);
  } finally {
    fixture.close();
  }
});

test('search_papers free text also matches tag names', () => {
  const fixture = createFixture();
  try {
    const pdf = writePdf(fixture.dataDir, 'tagged.pdf', 'tagged');
    fixture.service.importPdfs({
      paths: [pdf],
      metadata: { [pdf]: { title: 'Tagged Paper', tags: ['rotorcraft', 'aeroacoustics'] } },
    });

    const result = fixture.service.searchPapers({ query: 'rotorcraft' });
    assert.equal(result.total, 1);
    assert.equal(result.papers[0].title, 'Tagged Paper');
  } finally {
    fixture.close();
  }
});
