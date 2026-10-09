import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentCitationRegistry,
  createAgentDocumentExcerptCitation,
  findUniqueAgentCitationByLabel,
  recoverAgentToolCitations,
  rewriteAgentCitationSourceLabels,
} from '../src/services/agentCitationRegistry.ts';
import type { LibraryAgentRagCitation } from '../src/services/libraryAgent.ts';

function citation(id: string, label: string, paperId = 'paper-a'): LibraryAgentRagCitation {
  return { id, label, paperId, paperTitle: paperId, sourceType: 'pdf-text', pageIndex: 0 };
}

test('real no-RAG document excerpts have versioned canonical sources without invented page/block locations', () => {
  const excerpt = { paperId: 'paper-a', paperTitle: 'Actual title', source: 'pdf-text', contextVersion: 'hash-a',
    textStart: 0, textEnd: 14, text: 'Actual evidence' };
  const source = createAgentDocumentExcerptCitation(excerpt)!;
  assert.equal(source.paperId, 'paper-a');
  assert.equal(source.paperTitle, 'Actual title');
  assert.equal(source.previewText, 'Actual evidence');
  assert.equal(source.pageIndex, null);
  assert.equal(source.blockId, null);
  assert.equal(source.sourceType, 'pdf-text');
  assert.notEqual(createAgentDocumentExcerptCitation({ ...excerpt, contextVersion: 'hash-b' })?.id, source.id);
  assert.notEqual(createAgentDocumentExcerptCitation({ ...excerpt, textEnd: 12 })?.id, source.id);
  for (const sourceName of ['summary', 'metadata', 'summary-fallback-no-pdf', 'pdf-text-fallback-pdf-error']) {
    assert.equal(createAgentDocumentExcerptCitation({ ...excerpt, source: sourceName }), null);
  }
  assert.equal(createAgentDocumentExcerptCitation({ ...excerpt, text: '' }), null);
});

test('registry assigns unique run labels and preserves registered object identity', () => {
  const citations: LibraryAgentRagCitation[] = [];
  const registry = new AgentCitationRegistry(citations);
  const [first] = registry.register([citation('a', '1')]);
  const [second] = registry.register([citation('b', '1', 'paper-b')]);
  const [reused] = registry.register([citation('a', '9')]);
  assert.deepEqual(citations.map((item) => item.label), ['1', '2']);
  assert.equal(reused, first);
  assert.equal(second.label, '2');
});

test('source headers are rewritten in one pass without cascading replacements', () => {
  const source = [citation('a', '1'), citation('b', '2')];
  const canonical = [citation('a', '2'), citation('b', '3')];
  assert.equal(
    rewriteAgentCitationSourceLabels('# Source [1]\nA\n# Source [2]\nB', source, canonical),
    '# Source [[cite:a]]\nA\n# Source [[cite:b]]\nB',
  );
});

test('source rewriting is idempotent and unavailable headers never retain numeric identities', () => {
  const source = [citation('a', '1')];
  const text = '# Source [[cite:a]]\nA';
  assert.equal(rewriteAgentCitationSourceLabels(text, source, source), text);
  assert.equal(rewriteAgentCitationSourceLabels('# Source [1]', [], []), '# Source (unavailable evidence)');
  assert.equal(rewriteAgentCitationSourceLabels('# Source [3]', source, source), '# Source (unavailable evidence)');
  assert.equal(rewriteAgentCitationSourceLabels('# Source [1]', [citation('a', '1'), citation('b', '1')], source.concat(citation('b', '2'))), '# Source (unavailable evidence)');
});

test('ambiguous labels are rejected rather than resolving to the first paper', () => {
  const citations = [citation('a', '3'), citation('b', '3', 'paper-b')];
  assert.equal(findUniqueAgentCitationByLabel(citations, '3'), null);
  assert.equal(findUniqueAgentCitationByLabel([citations[0]], '[3]'), citations[0]);
});

test('wrapped checkpoint tool results recover scoped canonical sources after JSON persistence', () => {
  const papers = new Map([['paper-a', { title: 'Local title' }], ['paper-b', { title: 'Other title' }]]);
  const payload = {
    chunks: [
      { citationId: 'a', paperId: 'paper-a', paperTitle: 'stale title', sourceType: 'mineru-markdown', page: 4, blockId: 'block-a', snippet: 'Original evidence.' },
      { citationId: 'b', paperId: 'paper-b', sourceType: 'pdf-text', page: 2, snippet: 'Out of scope.' },
    ],
  };
  const message = JSON.parse(JSON.stringify({ role: 'tool', content: JSON.stringify({ name: 'rag_search', isError: false, result: JSON.stringify(payload) }) }));
  const recovered = recoverAgentToolCitations(message.content, papers, ['paper-a']);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].paperTitle, 'Local title');
  assert.equal(recovered[0].pageIndex, 3);
  assert.equal(recovered[0].blockId, 'block-a');
  const list: LibraryAgentRagCitation[] = [];
  const registry = new AgentCitationRegistry(list);
  registry.register(recovered);
  registry.register(recovered);
  assert.equal(list.length, 1);
  assert.equal(list[0].previewText, 'Original evidence.');
});

test('legacy unwrapped context results recover evidence and reject deleted or malformed sources', () => {
  const papers = new Map([['paper-a', { title: 'A' }]]);
  const valid = { ...citation('a', '1'), previewText: 'Actual text.', blockId: null };
  const payload = { papers: [{ paperId: 'paper-a', citations: [
    valid,
    { ...valid, id: 'deleted', paperId: 'gone' },
    { ...valid, id: 'invalid-page', pageIndex: -1 },
    { ...valid, id: 'metadata', sourceType: 'summary' },
  ] }] };
  assert.deepEqual(recoverAgentToolCitations(JSON.stringify(payload), papers, ['paper-a']).map(item => item.id), ['a']);
  assert.deepEqual(recoverAgentToolCitations(JSON.stringify({ isError: true, result: JSON.stringify(payload) }), papers, ['paper-a']), []);
  assert.deepEqual(recoverAgentToolCitations('{broken', papers, ['paper-a']), []);
  assert.deepEqual(recoverAgentToolCitations(JSON.stringify(payload), papers, []), []);
});
