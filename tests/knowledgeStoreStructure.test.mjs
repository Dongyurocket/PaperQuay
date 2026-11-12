import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createKnowledgeStore } = require('../electron/backend/knowledgeStore.cjs');

test('chapter units and physical-to-printed page mappings persist and single-unit edits preserve siblings', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-knowledge-structure-'));
  const databasePath = path.join(dataDir, 'paperquay-knowledge.sqlite');
  let store = createKnowledgeStore({ dataDir, knowledgeDatabasePath: databasePath });
  try {
    const generation = store.beginGeneration({ sourceId: 'manual-7', sourceKind: 'pdf', sourceVersion: 'sha256-v1',
      generationId: 'manual-generation-v1', partitions: [{ index: 0, startPage: 1, endPage: 4, inputHash: 'input-v1' }] });
    assert.equal(store.setPartitionStatus(generation.generationId, 0, 'running'), true);
    assert.equal(store.setPartitionStatus(generation.generationId, 0, 'complete'), true);
    assert.equal(store.setGenerationArtifacts(generation.generationId, {
      artifactPath: path.join(dataDir, 'artifacts'), manifest: [{ path: 'full.md', size: 0, sha256: '0'.repeat(64) }],
    }), true);
    assert.equal(store.publishGeneration(generation.generationId, { sourceVersion: 'sha256-v1', expectedPageCount: 4 }), true);

    assert.equal(store.upsertDocumentUnits(generation.generationId, [
      { unitId: 'chapter-1', unitKind: 'chapter', ordinal: 0, title: 'Overview', physicalStart: 1, physicalEnd: 2,
        printedStart: 'i', printedEnd: 'ii', unitRevision: 'outline-a' },
      { unitId: 'chapter-2', unitKind: 'chapter', ordinal: 1, title: 'Methods', physicalStart: 3, physicalEnd: 4,
        printedStart: '1', printedEnd: '2', unitRevision: 'outline-a' },
      { unitId: 'section-2-1', parentUnitId: 'chapter-2', unitKind: 'section', ordinal: 0, title: 'Test setup',
        physicalStart: 3, physicalEnd: 3, printedStart: '1', printedEnd: '1', unitRevision: 'outline-a' },
    ]), true);
    assert.equal(store.assignDocumentPages(generation.generationId, [
      { physicalPage: 1, printedPage: 'i', unitId: 'chapter-1', mappingRevision: 'pages-v1' },
      { physicalPage: 2, printedPage: 'ii', unitId: 'chapter-1', mappingRevision: 'pages-v1' },
      { physicalPage: 3, printedPage: '1', unitId: 'section-2-1', mappingRevision: 'pages-v1' },
      { physicalPage: 4, printedPage: '2', unitId: 'chapter-2', mappingRevision: 'pages-v1' },
    ]), true);

    assert.equal(store.upsertDocumentUnits(generation.generationId, [
      { unitId: 'chapter-1', unitKind: 'chapter', ordinal: 0, title: 'Overview revised', physicalStart: 1, physicalEnd: 2,
        printedStart: 'i', printedEnd: 'ii', unitRevision: 'outline-b' },
    ]), true);
    const edited = store.listDocumentUnits(generation.generationId);
    assert.deepEqual(edited.map((unit) => unit.unitId), ['chapter-1', 'section-2-1', 'chapter-2']);
    assert.equal(edited.find((unit) => unit.unitId === 'chapter-1').unitRevision, 'outline-b');
    assert.equal(edited.find((unit) => unit.unitId === 'chapter-2').unitRevision, 'outline-a',
      'updating one chapter must leave sibling chapter indexing intact');
    assert.deepEqual(store.listDocumentUnitRevisions(generation.generationId, 'chapter-1').map((unit) => unit.unitRevision),
      ['outline-a', 'outline-b'], 'manual revisions remain available for existing evidence and audit');
    assert.deepEqual(store.listDocumentPages(generation.generationId).map((page) => [page.physicalPage, page.printedPage]), [
      [1, 'i'], [2, 'ii'], [3, '1'], [4, '2'],
    ], 'physical page keys remain distinct from printed labels');
    assert.equal(store.assignDocumentPages(generation.generationId, [
      { physicalPage: 2, printedPage: 'ii*', unitId: 'chapter-1', mappingRevision: 'pages-v2' },
    ]), true);
    assert.deepEqual(store.listDocumentPageRevisions(generation.generationId, 2).map((page) => page.mappingRevision),
      ['pages-v1', 'pages-v2'], 'manual page label corrections preserve prior mapping revisions');

    assert.throws(() => store.assignDocumentPages(generation.generationId, [
      { physicalPage: 5, printedPage: '3', unitId: 'chapter-2', mappingRevision: 'pages-v3' },
    ]), /not present in this generation/);
    assert.throws(() => store.assignDocumentPages(generation.generationId, [
      { physicalPage: 2, printedPage: 'wrong', unitId: 'chapter-1', mappingRevision: 'pages-v1' },
    ]), /immutable/);
    assert.throws(() => store.upsertDocumentUnits(generation.generationId, [
      { unitId: 'chapter-1', parentUnitId: 'chapter-2', unitKind: 'chapter', ordinal: 0, physicalStart: 1, physicalEnd: 2, unitRevision: 'outline-cycle' },
      { unitId: 'chapter-2', parentUnitId: 'chapter-1', unitKind: 'chapter', ordinal: 1, physicalStart: 3, physicalEnd: 4, unitRevision: 'outline-cycle' },
    ]), /cycle/);
    assert.throws(() => store.upsertDocumentUnits(generation.generationId, [
      { unitId: 'chapter-1', unitKind: 'chapter', ordinal: 0, title: 'Changed without a revision bump', physicalStart: 1,
        physicalEnd: 2, unitRevision: 'outline-a' },
    ]), /immutable/);

    store.close();
    store = createKnowledgeStore({ dataDir, knowledgeDatabasePath: databasePath });
    const recoveredUnits = store.listDocumentUnits(generation.generationId);
    assert.equal(recoveredUnits.find((unit) => unit.unitId === 'chapter-1').title, 'Overview revised');
    assert.equal(recoveredUnits.find((unit) => unit.unitId === 'chapter-2').title, 'Methods');
    assert.equal(store.listDocumentUnitRevisions(generation.generationId, 'chapter-1').length, 2);
    assert.equal(store.listDocumentPages(generation.generationId)[1].printedPage, 'ii*');
    assert.equal(store.listDocumentPages(generation.generationId)[2].unitId, 'section-2-1');
    assert.equal(store.listDocumentPageRevisions(generation.generationId, 2).length, 2);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
