import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-library-db-test-'));

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

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function legacyLibrary(appPaths: ReturnType<typeof createAppPaths>) {
  const storageDir = path.join(appPaths.dataDir, 'papers');
  const pdfPath = path.join(storageDir, 'paper-1.pdf');
  const secondPdfPath = path.join(storageDir, 'paper-2.pdf');
  mkdirSync(storageDir, { recursive: true });
  writeFileSync(pdfPath, '%PDF-1.7\n');
  writeFileSync(secondPdfPath, '%PDF-1.7\n');

  return {
    version: 1,
    settings: {
      storageDir,
      zoteroLocalDataDir: 'D:/Zotero',
      importMode: 'copy',
      autoRenameFiles: true,
      fileNamingRule: '{author}_{year}_{title}',
      createCategoryFolders: false,
      folderWatchEnabled: false,
      backupEnabled: true,
      preserveOriginalPath: true,
    },
    webdav: {
      endpointUrl: 'https://dav.example.test',
      remoteRoot: 'paperquay/backups',
      username: 'user',
      password: 'secret',
      includePdfs: false,
      includeDerived: false,
      updatedAtMs: 1234,
    },
    categories: [{
      id: 'cat-ml',
      name: 'Machine Learning',
      parentId: null,
      sortOrder: 10,
      isSystem: false,
      systemKey: null,
      createdAt: 100,
      updatedAt: 200,
      paperCount: 0,
    }],
    papers: [
      {
        id: 'paper-1',
        title: 'SQLite Library Paper',
        titleZh: 'SQLite 文献库论文',
        year: '2026',
        publication: 'PaperQuay Tests',
        doi: '10.0000/paperquay',
        url: 'https://example.test/paper',
        abstractText: 'A regression fixture.',
        keywords: ['sqlite', 'paperquay'],
        importedAt: 300,
        updatedAt: 400,
        lastReadAt: 500,
        readingProgress: 0.42,
        isFavorite: true,
        userNote: 'note',
        aiSummary: 'summary',
        citation: 'citation',
        source: 'zotero',
        sortOrder: -1,
        authors: [{
          id: 'author-1',
          name: 'Ada Lovelace',
          givenName: 'Ada',
          familyName: 'Lovelace',
          sortOrder: 0,
        }],
        tags: [{
          id: 'tag-1',
          name: 'important',
          color: '#0f766e',
        }],
        categoryIds: ['cat-ml'],
        attachments: [{
          id: 'att-1',
          paperId: 'paper-1',
          kind: 'pdf',
          originalPath: pdfPath,
          storedPath: pdfPath,
          relativePath: 'paper-1.pdf',
          fileName: 'paper-1.pdf',
          mimeType: 'application/pdf',
          fileSize: 9,
          contentHash: 'hash-1',
          createdAt: 600,
          missing: false,
        }],
      },
      {
        id: 'paper-2',
        title: 'Repeated Author Paper',
        year: '2026',
        publication: null,
        doi: null,
        url: null,
        abstractText: null,
        keywords: [],
        importedAt: 301,
        updatedAt: 401,
        lastReadAt: null,
        readingProgress: 0,
        isFavorite: false,
        userNote: null,
        aiSummary: null,
        citation: null,
        source: 'zotero',
        sortOrder: 0,
        authors: [{
          id: 'author-1',
          name: 'Ada Lovelace',
          givenName: 'Ada',
          familyName: 'Lovelace',
          sortOrder: 0,
        }],
        tags: [{
          id: 'tag-1',
          name: 'important',
          color: '#0f766e',
        }],
        categoryIds: ['cat-ml'],
        attachments: [{
          id: 'att-2',
          paperId: 'paper-2',
          kind: 'pdf',
          originalPath: secondPdfPath,
          storedPath: secondPdfPath,
          relativePath: 'paper-2.pdf',
          fileName: 'paper-2.pdf',
          mimeType: 'application/pdf',
          fileSize: 9,
          contentHash: 'hash-2',
          createdAt: 601,
          missing: false,
        }],
      },
    ],
    ragIndexes: {
      'paper-1::pdf-text': {
        status: {
          documentKey: 'paper-1',
          sourceType: 'pdf-text',
          sourceSignature: 'legacy',
          embeddingModelKey: 'model',
          totalChunkCount: 0,
          status: 'ready',
        },
        chunks: [],
      },
    },
  };
}

test('library SQLite store migrates legacy JSON and preserves full paper metadata in snapshots', () => {
  const appPaths = createAppPaths();
  const snapshotPath = path.join(appPaths.dataDir, 'snapshot', 'paperquay-library.sqlite');
  let store: ReturnType<typeof createLibraryStore> | null = null;

  try {
    writeJson(appPaths.libraryPath, legacyLibrary(appPaths));
    store = createLibraryStore(appPaths);

    const migrated = store.load();
    const paper = migrated.papers.find((item: { id: string }) => item.id === 'paper-1');
    assert.ok(paper);
    assert.equal(paper.title, 'SQLite Library Paper');
    assert.equal(paper.titleZh, 'SQLite 文献库论文');
    assert.equal(paper.source, 'zotero');
    assert.equal(paper.authors[0].name, 'Ada Lovelace');
    assert.deepEqual(paper.keywords, ['sqlite', 'paperquay']);
    assert.equal(paper.tags[0].name, 'important');
    assert.deepEqual(paper.categoryIds, ['cat-ml']);
    assert.equal(paper.attachments[0].paperId, 'paper-1');
    assert.equal(paper.attachments[0].storedPath.endsWith('paper-1.pdf'), true);
    assert.equal(migrated.papers.find((item: { id: string }) => item.id === 'paper-2')?.authors[0].id, 'author-1');
    assert.equal(migrated.papers.find((item: { id: string }) => item.id === 'paper-2')?.tags[0].id, 'tag-1');
    assert.equal(migrated.webdav.endpointUrl, 'https://dav.example.test');
    assert.equal(existsSync(appPaths.libraryDatabasePath), true);

    store.snapshotTo(snapshotPath);
    const snapshotted = store.loadFromSnapshot(snapshotPath);
    const snapshottedPaper = snapshotted.papers.find((item: { id: string }) => item.id === 'paper-1');
    assert.ok(snapshottedPaper);
    assert.equal(snapshottedPaper.titleZh, 'SQLite 文献库论文');
    assert.equal(snapshottedPaper.attachments[0].paperId, 'paper-1');
    assert.equal(snapshottedPaper.readingProgress, 0.42);

    assert.equal(Object.keys(store.loadLegacyRagIndexes()).length, 1);
    store.clearLegacyRagIndexesSync();
    assert.equal(readJson(appPaths.libraryPath).ragIndexes, undefined);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('empty library SQLite store materializes defaults on save', () => {
  const appPaths = createAppPaths();
  let store: ReturnType<typeof createLibraryStore> | null = null;

  try {
    store = createLibraryStore(appPaths);
    const library = store.load();
    assert.equal(library.papers.length, 0);
    assert.ok(library.categories.some((category: { systemKey: string }) => category.systemKey === 'all'));

    store.save(library);
    store.close();
    store = createLibraryStore(appPaths);

    const reloaded = store.load();
    assert.equal(reloaded.papers.length, 0);
    assert.ok(reloaded.categories.some((category: { systemKey: string }) => category.systemKey === 'favorites'));
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('library SQLite store upgrades early author and tag tables with global ids', () => {
  const appPaths = createAppPaths();
  let store: ReturnType<typeof createLibraryStore> | null = null;

  try {
    const db = new DatabaseSync(appPaths.libraryDatabasePath);
    db.exec(`
      CREATE TABLE library_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE library_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE webdav_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT,
        sort_order INTEGER NOT NULL,
        is_system INTEGER NOT NULL,
        system_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE papers (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        year TEXT,
        publication TEXT,
        doi TEXT,
        url TEXT,
        abstract_text TEXT,
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
      CREATE TABLE paper_keywords (
        paper_id TEXT NOT NULL,
        keyword TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (paper_id, sort_order)
      );
      CREATE TABLE authors (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL,
        name TEXT NOT NULL,
        given_name TEXT,
        family_name TEXT,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE paper_categories (
        paper_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (paper_id, category_id)
      );
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        original_path TEXT,
        stored_path TEXT NOT NULL,
        relative_path TEXT,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        content_hash TEXT,
        created_at INTEGER NOT NULL,
        missing INTEGER NOT NULL
      );
      INSERT INTO library_meta (key, value) VALUES ('initialized', '1'), ('version', '1');
      INSERT INTO library_settings (key, value_json) VALUES ('storageDir', '"D:/papers"');
      INSERT INTO papers (
        id, title, imported_at, updated_at, reading_progress, is_favorite, source, sort_order
      ) VALUES ('paper-old', 'Old Schema Paper', 1, 1, 0, 0, 'local', 0);
      INSERT INTO authors (id, paper_id, name, sort_order)
      VALUES ('author-shared', 'paper-old', 'Shared Author', 0);
      INSERT INTO tags (id, paper_id, name, sort_order)
      VALUES ('tag-shared', 'paper-old', 'Shared Tag', 0);
    `);
    db.close();

    store = createLibraryStore(appPaths);
    const library = store.load();
    const paper = library.papers.find((item: { id: string }) => item.id === 'paper-old');
    assert.ok(paper);
    assert.equal(paper.titleZh, null);
    assert.equal(paper.authors[0].id, 'author-shared');
    assert.equal(paper.tags[0].id, 'tag-shared');

    paper.titleZh = '旧结构论文';

    library.papers.push({
      id: 'paper-new',
      title: 'New Shared Author Paper',
      titleZh: '新共享作者论文',
      year: null,
      publication: null,
      doi: null,
      url: null,
      abstractText: null,
      keywords: [],
      importedAt: 2,
      updatedAt: 2,
      lastReadAt: null,
      readingProgress: 0,
      isFavorite: false,
      userNote: null,
      aiSummary: null,
      citation: null,
      source: 'local',
      sortOrder: 1,
      authors: [{
        id: 'author-shared',
        name: 'Shared Author',
        givenName: null,
        familyName: null,
        sortOrder: 0,
      }],
      tags: [{
        id: 'tag-shared',
        name: 'Shared Tag',
        color: null,
      }],
      categoryIds: [],
      attachments: [],
    });
    store.save(library);

    const reloaded = store.load();
    assert.equal(reloaded.papers.length, 2);
    assert.equal(reloaded.papers.find((item: { id: string }) => item.id === 'paper-old')?.titleZh, '旧结构论文');
    assert.equal(reloaded.papers.find((item: { id: string }) => item.id === 'paper-new')?.titleZh, '新共享作者论文');
    assert.deepEqual(
      reloaded.papers.map((paper: { authors: Array<{ id: string }> }) => paper.authors[0]?.id).sort(),
      ['author-shared', 'author-shared'],
    );
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
