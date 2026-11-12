import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createKnowledgeGraphCommands } = require('../electron/backend/knowledgeGraphCommands.cjs');

test('document structure command returns only the published current generation for the requested source', async () => {
  const calls = [];
  const knowledgeStore = {
    listGenerations(sourceId) {
      calls.push(['generations', sourceId]);
      return [
        { generationId: 'old', sourceVersion: 'v1', status: 'published', currentGeneration: 'new', activeSourceVersion: 'v2' },
        { generationId: 'building', sourceVersion: 'v2', status: 'building', currentGeneration: 'new', activeSourceVersion: 'v2' },
        { generationId: 'new', sourceVersion: 'v2', status: 'published', currentGeneration: 'new', activeSourceVersion: 'v2' },
      ];
    },
    listDocumentUnits(generationId) { calls.push(['units', generationId]); return [{ unitId: 'chapter-1' }]; },
    listDocumentPages(generationId) { calls.push(['pages', generationId]); return [{ physicalPage: 1 }]; },
  };
  const commands = createKnowledgeGraphCommands({ knowledgeStore });

  assert.deepEqual(await commands.knowledge_document_structure_get({ sourceId: ' workspace-1 ' }), {
    generationId: 'new', sourceVersion: 'v2', units: [{ unitId: 'chapter-1' }], pages: [{ physicalPage: 1 }],
  });
  assert.deepEqual(calls, [
    ['generations', 'workspace-1'], ['units', 'new'], ['pages', 'new'],
  ]);
});

test('document structure command fails closed for empty source identity or missing current generation', async () => {
  let generationReads = 0;
  const knowledgeStore = {
    listGenerations() { generationReads += 1; return [{ generationId: 'old', status: 'published', currentGeneration: 'new' }]; },
  };
  const commands = createKnowledgeGraphCommands({ knowledgeStore });

  assert.equal(await commands.knowledge_document_structure_get({ sourceId: ' ' }), null);
  assert.equal(await commands.knowledge_document_structure_get({ sourceId: 'missing' }), null);
  assert.equal(generationReads, 1);
});

test('document structure command hides a published generation after its source version changes', async () => {
  const commands = createKnowledgeGraphCommands({ knowledgeStore: {
    listGenerations() { return [{
      generationId: 'old', sourceVersion: 'sha256-old', activeSourceVersion: 'sha256-new',
      status: 'published', currentGeneration: 'old',
    }]; },
  } });

  assert.equal(await commands.knowledge_document_structure_get({ sourceId: 'workspace-1' }), null);
});

test('document structure command binds reader outlines to a registered PDF content hash', async (t) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-outline-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pdfPath = path.join(dir, 'paper.pdf');
  const bytes = Buffer.from('%PDF-1.7 controlled test bytes');
  await fs.writeFile(pdfPath, bytes);
  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const commands = createKnowledgeGraphCommands({
    store: { getPaper(id) { return id === 'paper-1' ? { attachments: [{
      kind: 'pdf', storedPath: pdfPath, contentHash, missing: false,
    }] } : null; } },
    knowledgeStore: {
      listGenerations() { return [{ generationId: 'g1', sourceVersion: contentHash,
        activeSourceVersion: contentHash, currentGeneration: 'g1', status: 'published' }]; },
      listDocumentUnits() { return []; },
      listDocumentPages() { return []; },
    },
  });

  assert.ok(await commands.knowledge_document_structure_get({ sourceId: 'paper-1', pdfPath }));
  assert.equal(await commands.knowledge_document_structure_get({ sourceId: 'paper-1', pdfPath: path.join(dir, 'other.pdf') }), null);
  await fs.writeFile(pdfPath, Buffer.from('%PDF-1.7 changed bytes'));
  assert.equal(await commands.knowledge_document_structure_get({ sourceId: 'paper-1', pdfPath }), null);
});
