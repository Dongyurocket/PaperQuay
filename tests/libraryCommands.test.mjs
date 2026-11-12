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

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-library-commands-test-'));

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

test('library_update_settings migrates stored PDFs into the new storage directory', async () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    const oldStorageDir = path.join(appPaths.dataDir, 'old-papers');
    const newStorageDir = path.join(appPaths.dataDir, 'new-papers');
    const relativePath = path.join('category-a', 'paper-1.pdf');
    const oldPdfPath = path.join(oldStorageDir, relativePath);
    const newPdfPath = path.join(newStorageDir, relativePath);

    await mkdir(path.dirname(oldPdfPath), { recursive: true });
    writeFileSync(oldPdfPath, '%PDF-1.7\npaper body\n');

    store = createLibraryStore(appPaths);
    const library = store.load();
    library.settings.storageDir = oldStorageDir;
    library.papers.push({
      id: 'paper-1',
      title: 'Migrated Paper',
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
        id: 'att-1',
        paperId: 'paper-1',
        kind: 'pdf',
        originalPath: oldPdfPath,
        storedPath: oldPdfPath,
        relativePath,
        fileName: 'paper-1.pdf',
        mimeType: 'application/pdf',
        fileSize: 20,
        contentHash: 'hash-1',
        createdAt: 1,
        missing: false,
      }],
    });
    await store.save(library);

    const commands = createLibraryCommands({ appPaths, store });
    const updatedSettings = await commands.library_update_settings({
      settings: {
        ...library.settings,
        storageDir: newStorageDir,
      },
    });

    assert.equal(updatedSettings.storageDir, newStorageDir);
    assert.equal(existsSync(newPdfPath), true);
    assert.equal(readFileSync(newPdfPath, 'utf8'), '%PDF-1.7\npaper body\n');

    const migrated = store.load().papers[0];
    assert.equal(migrated.attachments[0].storedPath, newPdfPath);
    assert.equal(migrated.attachments[0].relativePath, relativePath);
    assert.equal(migrated.attachments[0].missing, false);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('metadata candidate lookup preserves provider candidates and reports partial service failure', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.hostname === 'api.openalex.org') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ results: [
          {
            doi: 'https://doi.org/10.5555/engineering-a',
            title: 'Engineering System A',
            authorships: [{ author: { display_name: 'A. Author' } }],
            publication_year: 2024,
          },
          {
            doi: 'https://doi.org/10.5555/engineering-b',
            title: 'Engineering System A Design Notes',
            authorships: [{ author: { display_name: 'B. Author' } }],
            publication_year: 2023,
          },
        ] }),
      };
    }
    return { ok: false, status: 503, text: async () => 'temporarily unavailable' };
  };

  try {
    const commands = createLibraryCommands({
      store: { load: () => ({ settings: { openAlexEnabled: true } }) },
    });
    const result = await commands.lookup_literature_metadata_candidates({
      request: { title: 'Engineering System A' },
    });

    assert.deepEqual(result.query, { kind: 'title', value: 'Engineering System A' });
    assert.equal(result.providers.openalex.status, 'success');
    assert.equal(result.providers.crossref.status, 'failed');
    assert.match(result.providers.crossref.error, /Crossref metadata HTTP 503/);
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(result.candidates.map((candidate) => candidate.provider), ['openalex', 'openalex']);
    assert.equal(result.candidates[0].metadata.title, 'Engineering System A');
    assert.equal(result.candidates[1].metadata.doi, '10.5555/engineering-b');
    assert.equal(result.candidates[0].fieldSources.title, 'openalex');
    assert.equal(requests.length, 2);
    assert.equal(requests.find((url) => url.hostname === 'api.crossref.org').searchParams.get('rows'), '10');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('metadata candidate lookup distinguishes no matches and disabled providers without writing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => ({
    ok: true,
    status: 200,
    text: async () => new URL(String(input)).hostname === 'api.openalex.org'
      ? JSON.stringify({ results: [] })
      : JSON.stringify({ message: { items: [] } }),
  });
  let saveCalled = false;

  try {
    const commands = createLibraryCommands({
      store: { load: () => ({ settings: { openAlexEnabled: false } }), save: () => { saveCalled = true; } },
    });
    const result = await commands.lookup_literature_metadata_candidates({ request: { title: 'No matching title' } });
    assert.equal(result.providers.openalex.status, 'disabled');
    assert.equal(result.providers.crossref.status, 'no-match');
    assert.deepEqual(result.candidates, []);
    assert.equal(saveCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('library_update_paper rejects a stale editor baseline without overwriting the newer metadata', async () => {
  const paper = {
    id: 'paper-conflict',
    updatedAt: 10,
    title: 'Original title',
    authors: [],
    keywords: [],
    tags: [],
  };
  let savedSnapshot = null;
  const commands = createLibraryCommands({
    appPaths: {},
    store: {
      getPaper: (paperId) => paperId === paper.id ? paper : null,
      savePaper: (value) => { savedSnapshot = { ...value }; },
    },
  });

  const firstWrite = await commands.library_update_paper({
    request: { paperId: paper.id, expectedUpdatedAt: 10, title: 'Updated elsewhere' },
  });
  assert.equal(firstWrite.title, 'Updated elsewhere');
  assert.ok(firstWrite.updatedAt > 10);
  assert.equal((await commands.library_get_paper({ paperId: paper.id })).title, 'Updated elsewhere');
  await assert.rejects(commands.library_get_paper({ paperId: 'missing' }), /Paper does not exist/);

  await assert.rejects(
    commands.library_update_paper({
      request: { paperId: paper.id, expectedUpdatedAt: 10, title: 'Stale draft' },
    }),
    /Paper changed after editing began/,
  );
  assert.equal(savedSnapshot.title, 'Updated elsewhere');
  assert.equal(paper.title, 'Updated elsewhere');
});

test('library_get_papers_by_ids preserves the frozen ID order, reports deleted IDs, and bounds requests', async () => {
  const records = new Map([
    ['p-b', { id: 'p-b', title: 'B' }],
    ['p-a', { id: 'p-a', title: 'A' }],
  ]);
  const commands = createLibraryCommands({
    store: { getPaper: (paperId) => records.get(paperId) ?? null },
  });

  const result = await commands.library_get_papers_by_ids({ paperIds: ['p-a', 'p-deleted', 'p-b', 'p-a'] });
  assert.deepEqual(result.papers.map((paper) => paper.id), ['p-a', 'p-b']);
  assert.deepEqual(result.missingIds, ['p-deleted']);
  await assert.rejects(
    commands.library_get_papers_by_ids({ paperIds: Array.from({ length: 501 }, (_, index) => `p-${index}`) }),
    /At most 500 paperIds/,
  );
  await assert.rejects(commands.library_get_papers_by_ids({ paperIds: 'p-a' }), /paperIds must be an array/);
});

test('library_list_all_paper_ids enumerates every filtered ID synchronously across internal pages', async () => {
  const ids = Array.from({ length: 10_003 }, (_, index) => `p${index}`);
  const pageRequests = [];
  const commands = createLibraryCommands({
    store: {
      countPapers: (request) => {
        assert.deepEqual(request, { categoryId: 'engineering', ragEnabled: false });
        return ids.length;
      },
      listPaperIds: (request) => {
        pageRequests.push(request);
        return ids.slice(request.offset, request.offset + request.limit);
      },
    },
  });

  const result = await commands.library_list_all_paper_ids({ request: { categoryId: 'engineering', ragEnabled: false } });
  assert.deepEqual(result, ids);
  assert.deepEqual(pageRequests.map(({ offset, limit }) => ({ offset, limit })), [
    { offset: 0, limit: 5000 },
    { offset: 5000, limit: 5000 },
    { offset: 10000, limit: 5000 },
  ]);
});

test('library_update_paper merges unrelated fields and reports conflicts on the same field', async () => {
  const paper = {
    id: 'paper-field-merge',
    updatedAt: 20,
    title: 'Base title',
    abstractText: 'Base abstract',
    authors: [],
    keywords: [],
    tags: [],
  };
  const commands = createLibraryCommands({
    appPaths: {},
    store: {
      getPaper: (paperId) => paperId === paper.id ? paper : null,
      savePaper: () => undefined,
    },
  });

  await commands.library_update_paper({ request: { paperId: paper.id, title: 'External title' } });
  const unrelatedEdit = await commands.library_update_paper({
    request: {
      paperId: paper.id,
      expectedUpdatedAt: 20,
      expectedValues: { title: 'Base title', abstractText: 'Base abstract', itemType: 'journalArticle' },
      title: 'Base title',
      abstractText: 'My abstract edit',
      itemType: 'journalArticle',
    },
  });
  assert.equal(unrelatedEdit.title, 'External title');
  assert.equal(unrelatedEdit.abstractText, 'My abstract edit');

  const currentUpdatedAt = paper.updatedAt;
  await commands.library_update_paper({ request: { paperId: paper.id, abstractText: 'Newer abstract' } });
  await assert.rejects(
    commands.library_update_paper({
      request: {
        paperId: paper.id,
        expectedUpdatedAt: currentUpdatedAt,
        expectedValues: { abstractText: 'My abstract edit' },
        abstractText: 'My competing edit',
      },
    }),
    /Paper changed after editing began in fields: abstractText/,
  );
  assert.equal(paper.abstractText, 'Newer abstract');
});

test('library_delete_paper keeps managed files still referenced by another paper', async () => {
  const appPaths = createAppPaths();
  let store = null;

  try {
    const storageDir = path.join(appPaths.dataDir, 'papers');
    const sharedPath = path.join(storageDir, 'shared.pdf');
    await mkdir(storageDir, { recursive: true });
    writeFileSync(sharedPath, '%PDF-1.7\nshared body\n');
    store = createLibraryStore(appPaths);
    const library = store.load();
    library.settings.storageDir = storageDir;
    const makePaper = (paperId, attachmentId) => ({
      id: paperId, title: paperId, year: null, publication: null, doi: null, url: null,
      abstractText: null, keywords: [], importedAt: 1, updatedAt: 1, lastReadAt: null,
      readingProgress: 0, isFavorite: false, userNote: null, aiSummary: null, citation: null,
      source: 'local', sortOrder: 0, authors: [], tags: [], categoryIds: [],
      attachments: [{
        id: attachmentId, paperId, kind: 'pdf', originalPath: sharedPath, storedPath: sharedPath,
        relativePath: 'shared.pdf', fileName: 'shared.pdf', mimeType: 'application/pdf',
        fileSize: 20, contentHash: null, createdAt: 1, missing: false,
      }],
    });
    library.papers.push(makePaper('paper-a', 'att-a'), makePaper('paper-b', 'att-b'));
    await store.save(library);

    const commands = createLibraryCommands({ appPaths, store });
    await commands.library_delete_paper({ request: { paperId: 'paper-a', deleteFiles: true } });
    assert.equal(existsSync(sharedPath), true);
    assert.equal(store.load().papers.length, 1);

    await commands.library_delete_paper({ request: { paperId: 'paper-b', deleteFiles: true } });
    assert.equal(existsSync(sharedPath), false);
  } finally {
    store?.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});
