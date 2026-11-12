import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createKnowledgeStore } = require('../electron/backend/knowledgeStore.cjs');

test('source versions, exact evidence snapshots and review events persist and stale evidence fails closed', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-knowledge-evidence-'));
  const databasePath = path.join(dataDir, 'paperquay-knowledge.sqlite');
  let store = createKnowledgeStore({ dataDir, knowledgeDatabasePath: databasePath });
  try {
    store.beginGeneration({ sourceId: 'engineering-report-7', sourceKind: 'pdf', sourceVersion: 'sha256-v1',
      generationId: 'generation-v1', partitions: [{ index: 0, startPage: 1, endPage: 2, inputHash: 'partition-v1' }] });
    const source = store.registerSourceVersion({ sourceId: 'engineering-report-7', sourceVersion: 'sha256-v1',
      sourceType: 'mineru-markdown', contentSignature: 'content-v1', parseGeneration: 'generation-v1',
      roleSnapshot: { role: 'technical-report', origin: 'primary-source' } });
    assert.ok(source?.sourceVersionId);
    const quote = 'The measured pressure drop remained below the specified limit.';
    const evidence = store.createEvidenceSpan({ sourceVersionId: source.sourceVersionId, pageIndex: 17,
      printedPage: '12', blockId: 'block-17-4', unitId: 'section-3-2', unitRevision: 'outline-v4',
      sectionPath: ['3 Results', '3.2 Pressure loss'], startOffset: 0, endOffset: quote.length,
      quote, evidenceText: quote, locatorStatus: 'exact' });
    assert.equal(evidence.isCurrent, true);
    assert.equal(evidence.quoteIntegrity, true);
    assert.equal(evidence.pageIndex, 17, 'physical page indices are stored zero-based');
    assert.equal(evidence.quoteHash, createHash('sha256').update(quote, 'utf8').digest('hex'));
    store.recordReviewEvent({ objectType: 'evidence', objectId: evidence.evidenceId, objectRevision: '1',
      decision: 'accepted', reviewer: 'user', reason: 'Verified against the source page.' });

    store.close();
    store = createKnowledgeStore({ dataDir, knowledgeDatabasePath: databasePath });
    const recovered = store.getEvidenceSpan(evidence.evidenceId);
    assert.equal(recovered.isCurrent, true);
    assert.deepEqual(recovered.sectionPath, ['3 Results', '3.2 Pressure loss']);
    assert.deepEqual(store.listReviewEvents('evidence', evidence.evidenceId).map((event) => event.decision), ['accepted']);

    store.beginGeneration({ sourceId: 'engineering-report-7', sourceKind: 'pdf', sourceVersion: 'sha256-v2',
      generationId: 'generation-v2', partitions: [{ index: 0, startPage: 1, endPage: 2, inputHash: 'partition-v2' }] });
    assert.equal(store.getEvidenceSpan(evidence.evidenceId).isCurrent, false,
      'the historical quote stays available while no longer projecting as current evidence');
    assert.equal(store.createEvidenceSpan({ sourceVersionId: source.sourceVersionId, pageIndex: 17, quote, evidenceText: quote,
      locatorStatus: 'exact' }), null, 'late evidence from the replaced source version is rejected');
    assert.equal(store.listReviewEvents('evidence', evidence.evidenceId).length, 1,
      'source invalidation does not erase the durable human review decision');
    assert.throws(() => store.createEvidenceSpan({ sourceVersionId: source.sourceVersionId, pageIndex: 17,
      quote: 'A fabricated claim.', evidenceText: quote, locatorStatus: 'exact' }), /match the supplied source text/);
    const db = new (require('../electron/backend/nodeSqlite.cjs').DatabaseSync)(databasePath);
    try { db.prepare("DELETE FROM source_documents WHERE source_id='engineering-report-7'").run(); } finally { db.close(); }
    assert.equal(store.getEvidenceSpan(evidence.evidenceId).sourceState, 'missing',
      'deleting a source preserves the historical quote and review with an explicit missing state');
    assert.equal(store.getEvidenceSpan(evidence.evidenceId).quote, quote);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
