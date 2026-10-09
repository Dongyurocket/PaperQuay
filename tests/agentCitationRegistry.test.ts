import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentCitationRegistry,
  findUniqueAgentCitationByLabel,
  rewriteAgentCitationSourceLabels,
} from '../src/services/agentCitationRegistry.ts';
import type { LibraryAgentRagCitation } from '../src/services/libraryAgent.ts';

function citation(id: string, label: string, paperId = 'paper-a'): LibraryAgentRagCitation {
  return { id, label, paperId, paperTitle: paperId, sourceType: 'pdf-text', pageIndex: 0 };
}

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
