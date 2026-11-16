import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalizeBcp47Language,
  isValidBcp47Language,
  isValidCitationKey,
  isValidOrcid,
  normalizeOrcid,
} from '../src/features/literature/metadataValidation.ts';
import {
  metadataFromZoteroItem,
  metadataUpdateForPaper,
} from '../src/features/literature/literatureLibraryUtils.ts';
import { paperToBibtexEntry } from '../src/utils/bibtex.ts';
import type { LiteraturePaper } from '../src/types/library.ts';
import type { MetadataLookupResult } from '../src/types/metadata.ts';
import type { ZoteroLibraryItem } from '../src/types/reader.ts';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const { UPDATABLE_PAPER_FIELDS } = require('../electron/backend/paperMetadataFields.cjs');
const { writeBackupPackage } = require('../electron/backend/backupContainer.cjs');
const { stageBackupImport, applyPendingBackupRestore } = require('../electron/backend/backupImport.cjs');

const PASSWORD = 'correct horse battery staple';
const VALID_ORCID = '0000-0002-1825-0097';

function makeAppPaths(dataDir: string) {
  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    screenshotDir: path.join(dataDir, '.screenshots'),
  };
}

function makePaper(overrides: Partial<LiteraturePaper> = {}): LiteraturePaper {
  return {
    id: 'paper-metadata',
    title: 'Metadata round trip',
    titleZh: null,
    year: '2026',
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
    itemType: 'journalArticle',
    publisher: null,
    institution: null,
    reportNumber: null,
    volume: null,
    issue: null,
    pages: null,
    isbn: null,
    issn: null,
    language: null,
    citationKey: null,
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

function removeDirectory(directory: string) {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function databaseColumns(databasePath: string, tableName: string): string[] {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row: { name: string }) => row.name);
  } finally {
    db.close();
  }
}

function createLegacyLibraryDatabase(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE papers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      year TEXT,
      publication TEXT,
      doi TEXT,
      url TEXT,
      abstract_text TEXT,
      item_type TEXT,
      publisher TEXT,
      institution TEXT,
      report_number TEXT,
      volume TEXT,
      issue TEXT,
      pages TEXT,
      isbn TEXT,
      issn TEXT,
      imported_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_read_at INTEGER,
      reading_progress REAL NOT NULL,
      is_favorite INTEGER NOT NULL,
      user_note TEXT,
      ai_summary TEXT,
      citation TEXT,
      source TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE authors (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      name TEXT NOT NULL,
      given_name TEXT,
      family_name TEXT,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE library_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      original_path TEXT,
      stored_path TEXT NOT NULL,
      relative_path TEXT,
      language TEXT,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      content_hash TEXT,
      created_at INTEGER NOT NULL,
      missing INTEGER NOT NULL
    );
    INSERT INTO papers (
      id, title, year, publication, doi, url, abstract_text, item_type,
      publisher, institution, report_number, volume, issue, pages, isbn, issn,
      imported_at, updated_at, last_read_at, reading_progress, is_favorite,
      user_note, ai_summary, citation, source, sort_order
    ) VALUES (
      'legacy-paper', 'Legacy paper', '2024', 'Legacy Journal', NULL, NULL, NULL, 'journalArticle',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      10, 11, NULL, 0, 0, NULL, NULL, NULL, 'local', 0
    );
    INSERT INTO authors (id, paper_id, name, given_name, family_name, sort_order)
      VALUES ('legacy-author', 'legacy-paper', 'Legacy Author', 'Legacy', 'Author', 0);
    INSERT INTO library_settings (key, value_json) VALUES
      ('storageDir', '"legacy-storage"'),
      ('translatedPdfDir', '""'),
      ('notesVaultDir', '""');
  `);
  db.close();
}

function makeBackupManifest(sourceDir: string, counts: Record<string, number>) {
  return {
    manifestVersion: 1,
    packageId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    app: {
      name: 'PaperQuay',
      version: '0.4.27',
      minReaderVersion: '0.4.27',
      platform: process.platform,
      arch: process.arch,
    },
    schema: { library: 1, notes: 1, rag: 0 },
    sourceRoots: { dataDir: sourceDir },
    resolvedRoots: { dataDir: sourceDir },
    counts,
    entries: [],
  };
}

async function writeLibraryBackup(sourceDir: string, packagePath: string, counts: Record<string, number>) {
  const notesStore = createNoteStore({ notesDatabasePath: path.join(sourceDir, 'paperquay-notes.sqlite') });
  notesStore.close();
  await writeBackupPackage({
    outputPath: packagePath,
    password: PASSWORD,
    manifest: makeBackupManifest(sourceDir, counts),
    entries: [
      {
        kind: 'database',
        databaseKind: 'library',
        sourceRoot: 'dataDir',
        relativePath: 'paperquay-library.sqlite',
        packagePath: 'data/paperquay-library.sqlite',
        sourcePath: path.join(sourceDir, 'paperquay-library.sqlite'),
      },
      {
        kind: 'database',
        databaseKind: 'notes',
        sourceRoot: 'dataDir',
        relativePath: 'paperquay-notes.sqlite',
        packagePath: 'data/paperquay-notes.sqlite',
        sourcePath: path.join(sourceDir, 'paperquay-notes.sqlite'),
      },
    ],
  });
}

async function restoreLibraryBackup(sourceDir: string, packagePath: string, targetDir: string) {
  const targetPaths = makeAppPaths(targetDir);
  const currentStore = createLibraryStore(targetPaths);
  const currentLibrary = currentStore.load();
  currentLibrary.settings.storageDir = path.join(path.dirname(targetDir), 'CurrentLibrary');
  currentStore.save(currentLibrary);
  currentStore.close();

  mkdirSync(path.dirname(packagePath), { recursive: true });
  await writeLibraryBackup(sourceDir, packagePath, {
    papers: 1,
    attachments: 0,
    notes: 0,
    noteFolders: 0,
  });

  const staged = await stageBackupImport(targetPaths, {
    packagePath,
    password: PASSWORD,
    targets: {
      libraryStorageDir: path.join(path.dirname(targetDir), 'RestoredLibrary'),
    },
    currentRendererState: {},
  });
  assert.equal(staged.ok, true);
  const applied = await applyPendingBackupRestore(targetPaths);
  assert.equal(applied.restored, true);
  return targetPaths;
}

test('metadata validation canonicalizes BCP 47 and ORCID and accepts only valid citation keys', () => {
  assert.equal(canonicalizeBcp47Language(' zh-cn '), 'zh-CN');
  assert.equal(isValidBcp47Language('en'), true);
  assert.equal(canonicalizeBcp47Language('not a language'), null);
  assert.equal(isValidCitationKey('Doe:2024-ml_key'), true);
  assert.equal(isValidCitationKey('Doe 2024'), false);
  assert.equal(isValidCitationKey(''), true);
  assert.equal(normalizeOrcid(`https://orcid.org/${VALID_ORCID}`), VALID_ORCID);
  assert.equal(isValidOrcid(VALID_ORCID), true);
  assert.equal(isValidOrcid('0000-0002-1825-0098'), false);
});

test('library SQLite round-trips paper language, citation key, affiliation, and ORCID', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-p3a-roundtrip-'));
  const appPaths = makeAppPaths(directory);
  let store: any = null;
  try {
    store = createLibraryStore(appPaths);
    const library = store.load();
    library.papers.push(makePaper({
      language: 'zh-Hans',
      citationKey: 'paperquay_2026',
      authors: [{
        id: 'author-1',
        name: 'Ada Lovelace',
        givenName: 'Ada',
        familyName: 'Lovelace',
        affiliation: 'Analytical Engines Lab',
        orcid: VALID_ORCID,
        sortOrder: 0,
      }],
    }));
    store.save(library);
    store.close();
    store = createLibraryStore(appPaths);
    const paper = store.load().papers.find((item: LiteraturePaper) => item.id === 'paper-metadata');
    assert.equal(paper?.language, 'zh-Hans');
    assert.equal(paper?.citationKey, 'paperquay_2026');
    assert.deepEqual(paper?.authors[0], {
      id: 'author-1',
      name: 'Ada Lovelace',
      givenName: 'Ada',
      familyName: 'Lovelace',
      affiliation: 'Analytical Engines Lab',
      orcid: VALID_ORCID,
      sortOrder: 0,
    });
  } finally {
    store?.close();
    removeDirectory(directory);
  }
});

test('legacy library schema gains nullable metadata columns without losing paper or author data', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-p3a-legacy-'));
  const appPaths = makeAppPaths(directory);
  createLegacyLibraryDatabase(appPaths.libraryDatabasePath);
  let store: any = null;
  try {
    store = createLibraryStore(appPaths);
    const paper = store.load().papers.find((item: LiteraturePaper) => item.id === 'legacy-paper');
    assert.equal(paper?.title, 'Legacy paper');
    assert.deepEqual(paper?.authors[0], {
      id: 'legacy-author',
      name: 'Legacy Author',
      givenName: 'Legacy',
      familyName: 'Author',
      affiliation: null,
      orcid: null,
      sortOrder: 0,
    });
    assert.ok(databaseColumns(appPaths.libraryDatabasePath, 'papers').includes('language'));
    assert.ok(databaseColumns(appPaths.libraryDatabasePath, 'papers').includes('citation_key'));
    assert.ok(databaseColumns(appPaths.libraryDatabasePath, 'authors').includes('affiliation'));
    assert.ok(databaseColumns(appPaths.libraryDatabasePath, 'authors').includes('orcid'));
  } finally {
    store?.close();
    removeDirectory(directory);
  }
});

test('desktop and MCP metadata update allowlists share one field definition', () => {
  const desktopSource = readFileSync(path.resolve('electron/backend/libraryCommands.cjs'), 'utf8');
  const mcpSource = readFileSync(path.resolve('electron/mcp/knowledgeMcpService.cjs'), 'utf8');
  assert.match(desktopSource, /UPDATABLE_PAPER_FIELDS/);
  assert.match(mcpSource, /UPDATABLE_PAPER_FIELDS/);
  assert.deepEqual(UPDATABLE_PAPER_FIELDS, [
    'title', 'titleZh', 'year', 'publication', 'doi', 'url', 'abstractText', 'itemType',
    'publisher', 'institution', 'reportNumber', 'volume', 'issue', 'pages', 'isbn', 'issn',
    'language', 'citationKey', 'authorDetails', 'userNote', 'aiSummary', 'citation',
  ]);
});

test('Zotero mapping carries language, citation key, and author details while metadata lookup preserves user values', () => {
  const item: ZoteroLibraryItem = {
    itemKey: 'ITEM-1',
    title: 'Zotero paper',
    creators: 'Fallback Author',
    year: '2024',
    itemType: 'journalArticle',
    language: 'zh-cn',
    extra: 'Some field: value\nCitation Key: zotero_2024',
    authors: [{
      name: 'Ada Lovelace',
      givenName: 'Ada',
      familyName: 'Lovelace',
      affiliation: 'Analytical Engines Lab',
      orcid: `https://orcid.org/${VALID_ORCID}`,
    }],
  };
  assert.deepEqual(metadataFromZoteroItem(item), {
    title: 'Zotero paper',
    authors: ['Ada Lovelace'],
    authorDetails: [{
      name: 'Ada Lovelace',
      givenName: 'Ada',
      familyName: 'Lovelace',
      affiliation: 'Analytical Engines Lab',
      orcid: VALID_ORCID,
    }],
    year: '2024',
    publication: null,
    doi: null,
    language: 'zh-CN',
    citationKey: 'zotero_2024',
  });

  const paper = makePaper({
    language: 'en',
    authors: [{
      id: 'author-1', name: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace',
      affiliation: 'User affiliation', orcid: VALID_ORCID, sortOrder: 0,
    }],
  });
  const metadata: MetadataLookupResult = {
    source: 'crossref',
    doi: null,
    title: null,
    authors: ['Ada Lovelace'],
    authorDetails: [{
      name: 'Ada Lovelace',
      affiliation: 'Remote affiliation',
      orcid: '0000-0002-1694-233X',
    }],
    language: 'zh-CN',
    year: null,
    publication: null,
    url: null,
    abstractText: null,
  };
  assert.equal(metadataUpdateForPaper(paper, metadata), null);
});

test('BibTeX prefers the stored citation key and exports paper language', () => {
  const paper = makePaper({
    title: 'A Paper',
    language: 'en',
    citationKey: 'stored-key',
    authors: [{ id: 'author-1', name: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace', sortOrder: 0 }],
  });
  const stored = paperToBibtexEntry(paper);
  assert.match(stored, /^@article\{stored-key,/);
  assert.match(stored, /language = \{en\}/);
  assert.match(paperToBibtexEntry(paper, { citationKey: 'forced-key' }), /^@article\{forced-key,/);
});

test('desktop and MCP updates validate new fields and prefer authorDetails over authors', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-p3a-updates-'));
  const appPaths = makeAppPaths(directory);
  let store: any = null;
  try {
    store = createLibraryStore(appPaths);
    const library = store.load();
    library.papers.push(makePaper());
    store.save(library);
    const commands = createLibraryCommands({ appPaths, store });
    const updated = await commands.library_update_paper({ request: {
      paperId: 'paper-metadata',
      authors: ['Compatibility Author'],
      authorDetails: [{ name: 'Detailed Author', affiliation: 'Detailed Lab', orcid: VALID_ORCID }],
      language: 'en-us',
      citationKey: 'duplicate.allowed',
    } });
    assert.equal(Object.hasOwn(updated, 'authorDetails'), false);
    let saved = store.getPaper('paper-metadata');
    assert.equal(saved.language, 'en-US');
    assert.equal(saved.citationKey, 'duplicate.allowed');
    assert.equal(saved.authors[0].name, 'Detailed Author');
    assert.equal(saved.authors[0].affiliation, 'Detailed Lab');
    await assert.rejects(
      commands.library_update_paper({ request: { paperId: 'paper-metadata', language: 'en_US' } }),
      /BCP 47/,
    );
    await assert.rejects(
      commands.library_update_paper({ request: { paperId: 'paper-metadata', citationKey: 'bad key' } }),
      /citation key/i,
    );
    store.close();
    store = null;

    const service = new PaperQuayKnowledgeService({ dataDir: directory, isAppRunning: () => false });
    service.updatePaper({
      paperId: 'paper-metadata',
      authors: ['MCP compatibility author'],
      authorDetails: [{ name: 'MCP detailed author', orcid: VALID_ORCID }],
      language: 'fr',
      citationKey: 'mcp-key',
    });
    store = createLibraryStore(appPaths);
    saved = store.getPaper('paper-metadata');
    assert.equal(saved.language, 'fr');
    assert.equal(saved.citationKey, 'mcp-key');
    assert.equal(saved.authors[0].name, 'MCP detailed author');
  } finally {
    store?.close();
    removeDirectory(directory);
  }
});

test('new and legacy library backups restore into the current schema and keep metadata/data', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-p3a-backup-'));
  try {
    const newSource = path.join(root, 'new-source');
    const newTarget = path.join(root, 'new-target', 'PaperQuay');
    mkdirSync(newSource, { recursive: true });
    const newSourcePaths = makeAppPaths(newSource);
    const newStore = createLibraryStore(newSourcePaths);
    const newLibrary = newStore.load();
    newLibrary.papers.push(makePaper({
      language: 'en',
      citationKey: 'backup-new',
      authors: [{ id: 'new-author', name: 'New Author', givenName: null, familyName: null, affiliation: 'New Lab', orcid: VALID_ORCID, sortOrder: 0 }],
    }));
    newStore.save(newLibrary);
    newStore.close();
    const newTargetPaths = await restoreLibraryBackup(
      newSource,
      path.join(root, 'new.pqbackup'),
      newTarget,
    );
    const restoredNew = createLibraryStore(newTargetPaths);
    const newPaper = restoredNew.getPaper('paper-metadata');
    assert.equal(newPaper.language, 'en');
    assert.equal(newPaper.citationKey, 'backup-new');
    assert.equal(newPaper.authors[0].affiliation, 'New Lab');
    restoredNew.close();

    const legacySource = path.join(root, 'legacy-source');
    const legacyTarget = path.join(root, 'legacy-target', 'PaperQuay');
    mkdirSync(legacySource, { recursive: true });
    createLegacyLibraryDatabase(path.join(legacySource, 'paperquay-library.sqlite'));
    const legacyTargetPaths = await restoreLibraryBackup(
      legacySource,
      path.join(root, 'legacy.pqbackup'),
      legacyTarget,
    );
    const restoredLegacy = createLibraryStore(legacyTargetPaths);
    const legacyPaper = restoredLegacy.getPaper('legacy-paper');
    assert.equal(legacyPaper.title, 'Legacy paper');
    assert.equal(legacyPaper.language, null);
    assert.equal(legacyPaper.citationKey, null);
    assert.equal(legacyPaper.authors[0].affiliation, null);
    assert.ok(databaseColumns(legacyTargetPaths.libraryDatabasePath, 'authors').includes('orcid'));
    restoredLegacy.close();
  } finally {
    removeDirectory(root);
  }
});
