import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveAttachmentFilterRequest } = require('../electron/backend/libraryAttachmentAvailability.cjs');

test('attachment filters use current disk state and intersect existing paper ids', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-attachment-filter-'));
  const pdf = path.join(root, 'paper.pdf');
  const translated = path.join(root, 'translated.pdf');
  try {
    await fs.writeFile(pdf, 'pdf');
    await fs.writeFile(translated, 'pdf');
    const library = { settings: { storageDir: root }, papers: [
      { id: 'a', attachments: [{ kind: 'pdf', relativePath: 'paper.pdf', storedPath: 'old.pdf', missing: true }] },
      { id: 'b', attachments: [{ kind: 'translated-pdf', storedPath: translated, missing: false }] },
      { id: 'c', attachments: [{ kind: 'pdf', storedPath: path.join(root, 'missing.pdf'), missing: false }] },
      { id: 'd', attachments: [] },
    ] };
    const request = { search: 'x', hasPdf: true, paperIds: ['a', 'c'] };
    assert.deepEqual(await resolveAttachmentFilterRequest(request, library), { search: 'x', paperIds: ['a'] });
    assert.deepEqual((await resolveAttachmentFilterRequest({ missingFile: true }, library)).paperIds, ['c']);
    assert.deepEqual((await resolveAttachmentFilterRequest({ hasTranslatedPdf: true, missingFile: false }, library)).paperIds, ['b']);
    assert.deepEqual((await resolveAttachmentFilterRequest({ hasPdf: false }, library)).paperIds, ['b', 'c', 'd']);
    assert.deepEqual((await resolveAttachmentFilterRequest({ hasPdf: true, paperIds: [] }, library)).paperIds, []);
    await fs.unlink(pdf);
    assert.deepEqual((await resolveAttachmentFilterRequest({ missingFile: true }, library)).paperIds, ['a', 'c']);
    await fs.writeFile(pdf, 'pdf');
    assert.deepEqual((await resolveAttachmentFilterRequest({ hasPdf: true }, library)).paperIds, ['a']);
    const noFilter = { search: 'untouched' };
    assert.strictEqual(await resolveAttachmentFilterRequest(noFilter, library), noFilter);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('attachment filter commands keep page totals and selected ids consistent after files change', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-attachment-command-'));
  const appPaths = { dataDir: root, configPath: path.join(root, 'config.json'), libraryPath: path.join(root, 'library.json'), libraryDatabasePath: path.join(root, 'library.sqlite'), ragDatabasePath: path.join(root, 'rag.sqlite') };
  const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
  const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
  const store = createLibraryStore(appPaths);
  const file = path.join(root, 'paper.pdf');
  try {
    await fs.writeFile(file, '%PDF-1.4');
    const library = store.load();
    library.papers.push({ id: 'p1', title: 'Paper', year: '2020', keywords: [], importedAt: 1, updatedAt: 1, lastReadAt: null, readingProgress: 0, isFavorite: false, source: 'local', sortOrder: 0, authors: [], tags: [], categoryIds: [], attachments: [{ id: 'a1', paperId: 'p1', kind: 'pdf', storedPath: file, fileName: 'paper.pdf', mimeType: 'application/pdf', createdAt: 1, missing: false }] });
    store.save(library);
    const commands = createLibraryCommands({ appPaths, store });
    const request = { missingFile: true, paperIds: ['p1'] };
    assert.equal((await commands.library_query_papers({ request })).total, 0);
    await fs.unlink(file);
    assert.equal((await commands.library_query_papers({ request })).total, 1);
    assert.equal(await commands.library_count_papers({ request }), 1);
    assert.deepEqual(await commands.library_list_paper_ids({ request }), ['p1']);
    assert.deepEqual((await commands.library_list_papers({ request })).map((paper) => paper.id), ['p1']);
    assert.equal((await commands.library_query_papers({ request: { hasPdf: true } })).total, 0);
    assert.equal(store.getPaper('p1').attachments[0].missing, false);
    const missingResult = await commands.library_query_papers({ request: { missingFile: true } });
    assert.equal(missingResult.papers[0].attachments[0].missing, true);
    const saved = store.getPaper('p1');
    saved.attachments[0].missing = true;
    store.savePaper(saved);
    await fs.writeFile(file, '%PDF-1.4');
    const restored = await commands.library_query_papers({ request: { hasPdf: true } });
    assert.equal(restored.total, 1);
    assert.equal(restored.papers[0].attachments[0].missing, false);
    assert.equal((await commands.library_list_papers({ request: { hasPdf: true } }))[0].attachments[0].missing, false);
    assert.equal(store.getPaper('p1').attachments[0].missing, true);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
