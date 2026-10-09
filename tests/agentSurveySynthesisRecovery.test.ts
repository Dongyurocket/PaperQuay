import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

import {
  runComparativeSurveyCapability,
  type ComparativeSurveyArtifacts,
  type ComparativeSurveyHandlers,
} from '../src/services/agentCapability.ts';
import * as coverageHelpers from '../src/services/agentSurveyCoverage.ts';
import * as citationHelpers from '../src/services/agentCitationRegistry.ts';
import * as textHelpers from '../src/services/agentToolContent.ts';
import { bindAgentCitationSources } from '../src/services/agentAnswerEvidence.ts';
import type { LibraryAgentRagCitation } from '../src/services/libraryAgent.ts';

// Exercise the desktop service's real private handlers and model accounting.
// Importing the whole service would require renderer/Electron initialization.
const serviceSource = readFileSync(new URL('../src/services/libraryAgent.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const researchStart = serviceSource.indexOf('        async research({ subquestions, onProgress, coverage, researchNotes, researchContexts, onCheckpoint }) {');
const handlersEnd = serviceSource.indexOf('\n      },\n    });', researchStart);
const modelStart = serviceSource.lastIndexOf('    const mergeCoverageSnapshot = ', researchStart);
const modelEnd = serviceSource.indexOf('\n    const survey = ', modelStart);
assert.ok(researchStart >= 0 && handlersEnd > researchStart && modelStart >= 0 && modelEnd > modelStart);

const sourceCitation: LibraryAgentRagCitation = {
  id: 'source-a', label: '9', paperId: 'p1', paperTitle: 'Paper 1', pageIndex: 0,
  blockId: 'block-a', sourceType: 'pdf-text', previewText: 'Direct full-text evidence describes the comparison and its measured limitations.',
};
const savedNotes = 'Saved research notes from a previous completed subquestion.';
const completedSynthesis = 'Direct full-text evidence describes a conditional comparison [[cite:source-a]].';

type ModelResponse = { content: string; finishReason?: string; usage?: { promptTokens: number; completionTokens: number } };

function actualSurveyHandlers(responses: ModelResponse[], initial: Partial<ComparativeSurveyArtifacts> = {}) {
  const citations: LibraryAgentRagCitation[] = [];
  const registry = new citationHelpers.AgentCitationRegistry(citations);
  registry.register((initial.citations ?? []).map((citation) => ({ ...citation,
    id: citation.id!, label: citation.label!, sourceType: citation.sourceType ?? 'pdf-text', pageIndex: citation.pageIndex ?? null,
  })));
  const calls: Array<{ system: string; payload: Record<string, unknown> }> = [];
  let loads = 0;
  const dependencies = {
    ...coverageHelpers, ...citationHelpers, ...textHelpers, bindAgentCitationSources,
    papers: [{ id: 'p1', title: 'Paper 1' }], citationAccumulator: citations, surveyRegistry: registry,
    preset: { contextWindow: 128_000, apiKey: '', model: 'fixture', baseUrl: 'https://fixture.invalid' },
    signal: undefined, ragEnabled: false, ragErrors: [], normalizedInstruction: 'Compare evidence',
    deliveryRequirement: { kind: 'survey', completeness: 'full' }, streamHandlers: undefined,
    buildAgentDeliveryQualityPrompt: () => '',
    toErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
    loadPaperContext: async () => {
      loads += 1;
      return { source: 'pdf-text', text: `# Source [9]\n${sourceCitation.previewText}`, citations: [sourceCitation], retrievalOutcome: 'hit' };
    },
    runOpenAiCompatibleAgentChatTurn: async (input: { messages: Array<{ content: string }> }) => {
      calls.push({ system: input.messages[0].content, payload: JSON.parse(input.messages[1].content) });
      const response = responses[calls.length - 1];
      assert.ok(response, 'an unexpected model call must not fill missing research evidence');
      return response;
    },
  };
  const body = stripTypeScriptTypes(`
    function createActualSurvey() {
    let surveyCoverage = initialCoverage;
    let persistSurveyCoverage;
    ${serviceSource.slice(modelStart, modelEnd)}
    return { handlers: { ${serviceSource.slice(researchStart, handlersEnd)} }, getCoverage: () => surveyCoverage };
    }
  `);
  const initialCoverage = initial.coverage ?? coverageHelpers.createSurveyCoverageLedger({
    papers: [{ id: 'p1', title: 'Paper 1' }],
    subquestions: [{ id: 'subquestion-1', question: 'Q1', candidatePaperIds: ['p1'] }],
    budget: { maxTokens: 1000 },
  });
  const runtime = new Function('initialCoverage', ...Object.keys(dependencies), `${body}; return createActualSurvey();`)(initialCoverage, ...Object.values(dependencies)) as {
    handlers: Pick<ComparativeSurveyHandlers, 'research' | 'report'>;
    getCoverage: () => coverageHelpers.SurveyCoverageLedger;
  };
  const handlers: ComparativeSurveyHandlers = {
    async rephrase() { assert.fail('saved question must be reused'); },
    async decompose() { assert.fail('saved subquestions must be reused'); },
    ...runtime.handlers,
  };
  return { handlers, calls, get loads() { return loads; }, getCoverage: runtime.getCoverage, initialCoverage };
}

const interruptions = [
  { name: 'empty synthesis', content: '  ', finishReason: 'stop', reason: 'error', gap: 'returned no research notes' },
  { name: 'nonempty length synthesis', content: completedSynthesis, finishReason: 'length', reason: 'budget-tokens', gap: 'model output length' },
  { name: 'synthesis without citations', content: 'Evidence was compared.', finishReason: 'stop', reason: 'error', gap: 'no canonical evidence citation' },
  { name: 'unknown output citation', content: 'Evidence [[cite:invented]].', finishReason: 'stop', reason: 'error', gap: 'unresolved evidence citations' },
  { name: 'mixed valid and unknown citations', content: `${completedSynthesis}\nInvented evidence [[cite:invented]].`, finishReason: 'stop', reason: 'error', gap: 'unresolved evidence citations' },
  { name: 'legacy numeric output citation', content: 'Evidence was compared [1].', finishReason: 'stop', reason: 'error', gap: 'unresolved evidence citations' },
  { name: 'duplicate output token', content: 'Evidence [[cite:source-a]] [[cite:source-a]].', finishReason: 'stop', reason: 'error', gap: 'unresolved evidence citations' },
  { name: 'citation only inside code', content: 'Example: `[[cite:source-a]]`', finishReason: 'stop', reason: 'error', gap: 'no canonical evidence citation' },
];

for (const interruption of interruptions) {
  test(`actual survey ${interruption.name} preserves pending evidence and resumes without reloading it`, async () => {
    const first = actualSurveyHandlers([{ ...interruption, usage: { promptTokens: 10, completionTokens: 5 } }]);
    const checkpoints: ComparativeSurveyArtifacts[] = [];
    const interrupted = await runComparativeSurveyCapability({
      question: 'Compare evidence', handlers: first.handlers,
      resume: { rephrasedQuestion: 'Saved question', subquestions: ['Q1'], researchNotes: savedNotes,
        coverage: first.initialCoverage, completedStages: ['rephrase', 'decompose'] },
      onCheckpoint: (artifacts) => checkpoints.push(artifacts),
    });
    const pending = interrupted.artifacts.researchContexts!;
    assert.equal(first.calls.length, 1, 'report must use the local partial response after interrupted synthesis');
    assert.equal(first.loads, 1);
    assert.equal(interrupted.artifacts.researchNotes, savedNotes, 'incomplete synthesis must not replace completed notes');
    assert.equal(interrupted.artifacts.coverage?.runState, 'partial');
    assert.equal(interrupted.artifacts.coverage?.stopReason, interruption.reason);
    assert.equal(interrupted.artifacts.coverage?.subquestions[0].state, 'partial');
    assert.ok(interrupted.artifacts.coverage?.subquestions[0].evidenceGaps.some((gap) => gap.includes(interruption.gap)));
    assert.deepEqual(interrupted.artifacts.coverage?.subquestions[0].evidenceCitationIds, ['source-a']);
    assert.equal(interrupted.artifacts.coverage?.papers[0].focusedRead, false);
    assert.equal(interrupted.coverageSummary?.canResume, true);
    assert.equal(interrupted.deliveryQuality?.state, 'partial');
    assert.equal(pending.length, 1);
    assert.ok(pending[0].text.includes('[[cite:source-a]]'));
    assert.deepEqual(pending[0].citationIds, ['source-a']);
    assert.deepEqual(interrupted.tokenUsage, { promptTokens: 10, completionTokens: 5 });
    assert.equal(interrupted.artifacts.coverage?.budget.promptTokens, 10);
    assert.equal(interrupted.artifacts.coverage?.budget.completionTokens, 5);
    assert.deepEqual(checkpoints.at(-1)?.researchContexts, pending);

    const resumed = actualSurveyHandlers([
      { content: completedSynthesis, finishReason: 'stop', usage: { promptTokens: 12, completionTokens: 8 } },
      { content: `# Comparison\n\n${completedSynthesis}`, finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 4 } },
    ], interrupted.artifacts);
    const result = await runComparativeSurveyCapability({
      question: 'Compare evidence', handlers: resumed.handlers, resume: interrupted.artifacts,
    });
    assert.equal(resumed.loads, 0, 'saved body excerpts must be reused without duplicate retrieval');
    assert.equal(resumed.calls.length, 2);
    const payload = resumed.calls[0].payload.papers as Array<{ context: string }>;
    assert.equal(payload[0].context, pending[0].text);
    assert.deepEqual(result.artifacts.researchContexts, []);
    assert.equal(result.artifacts.researchNotes, `${savedNotes}\n\n## Q1\n${completedSynthesis}`);
    assert.equal(result.artifacts.coverage?.subquestions[0].state, 'completed');
    assert.deepEqual(result.artifacts.coverage?.subquestions[0].evidenceGaps, []);
    assert.deepEqual(result.artifacts.coverage?.subquestions[0].evidenceCitationIds, ['source-a']);
    assert.equal(result.artifacts.coverage?.papers[0].attempts, 1);
    assert.equal(result.artifacts.coverage?.papers[0].focusedRead, true);
    assert.equal(result.artifacts.coverage?.runState, 'completed');
    assert.equal(result.coverageSummary?.canResume, false);
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].id, 'source-a');
    assert.equal(result.citations[0].label, '1');
    assert.deepEqual(result.tokenUsage, { promptTokens: 15, completionTokens: 12 });
    assert.equal(result.artifacts.coverage?.budget.promptTokens, 25);
    assert.equal(result.artifacts.coverage?.budget.completionTokens, 17);
    assert.equal(result.artifacts.coverage?.budget.execution?.promptTokenBaseline, 10);
    assert.equal(result.artifacts.coverage?.budget.execution?.completionTokenBaseline, 5);
  });
}

test('actual survey citation coverage counts only resolved source identities', () => {
  const start = serviceSource.indexOf('    const citedCitationIds = new Set(');
  const end = serviceSource.indexOf('\n    survey.artifacts.coverage = ', start);
  assert.ok(start >= 0 && end > start);
  const countCoverage = new Function('bindingResult', 'citationAccumulator', 'surveyCoverage', 'recordSurveyPaperCoverage',
    `${stripTypeScriptTypes(serviceSource.slice(start, end))}; return surveyCoverage;`);
  const citations = [{ ...sourceCitation, label: '1' }];
  const initial = coverageHelpers.createSurveyCoverageLedger({ papers: [{ id: 'p1' }] });
  for (const answer of ['Evidence [[cite:source-a]] [[cite:source-a]].', 'Evidence [[cite:unknown]].']) {
    const coverage = countCoverage({ citationBindings: bindAgentCitationSources(answer, citations) }, citations, initial, coverageHelpers.recordSurveyPaperCoverage);
    assert.equal(coverage.papers[0].cited, false);
  }
  const coverage = countCoverage({ citationBindings: bindAgentCitationSources(completedSynthesis, citations) }, citations, initial, coverageHelpers.recordSurveyPaperCoverage);
  assert.equal(coverage.papers[0].cited, true);
});
