import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runComparativeSurveyCapability,
  type ComparativeSurveyArtifacts,
  type ComparativeSurveyEvent,
} from '../src/services/agentCapability.ts';
import {
  createSurveyCoverageLedger,
  finishSurveyCoverage,
  updateSurveyCoverageBudget,
  updateSurveyCoveragePaper,
  updateSurveyCoverageSubquestion,
} from '../src/services/agentSurveyCoverage.ts';

test('partial notes resume into research with saved sources and a renewed measured allowance', async () => {
  let coverage = createSurveyCoverageLedger({ papers: [{ id: 'p1' }, { id: 'p2' }],
    subquestions: [{ id: 'q1', question: 'Saved Q' }], budget: { maxPapers: 1, maxTokens: 10 } });
  coverage = updateSurveyCoveragePaper(coverage, 'p1', { stage: 'focused-read', attempts: 1, citationIds: ['c1'] });
  coverage = updateSurveyCoverageSubquestion(coverage, 'q1', { state: 'partial', completedPaperIds: ['p1'], evidenceCitationIds: ['c1'] });
  coverage = finishSurveyCoverage(updateSurveyCoverageBudget(coverage, { promptTokens: 8, completionTokens: 2 }));
  let researchCalls = 0;
  const result = await runComparativeSurveyCapability({
    question: 'Original question',
    resume: { rephrasedQuestion: 'Saved question', subquestions: ['Saved Q'], researchNotes: 'Saved notes [[cite:c1]]',
      citations: [{ id: 'c1', label: '1', paperId: 'p1', paperTitle: 'P1', pageIndex: null }], coverage,
      completedStages: ['rephrase', 'decompose', 'research'] },
    handlers: handlers({
      async research(input: { coverage: typeof coverage; researchNotes: string; citations: Array<{ id: string }> }) {
        researchCalls += 1;
        assert.equal(input.researchNotes, 'Saved notes [[cite:c1]]');
        assert.equal(input.citations[0]?.id, 'c1');
        assert.equal(input.coverage.budget.promptTokens, 8);
        assert.deepEqual(input.coverage.budget.execution?.processedPaperIds, []);
        assert.equal(input.coverage.budget.execution?.promptTokenBaseline, 8);
        return { notes: `${input.researchNotes}\nNew notes`, citations: input.citations, coverage: input.coverage };
      },
    }),
  });
  assert.equal(researchCalls, 1, 'a saved partial research stage is not silently skipped');
  assert.equal(result.citations[0]?.id, 'c1');
  assert.equal(result.artifacts.completedStages.filter((stage) => stage === 'research').length, 1);
});

test('cancellation preserves checkpoint excerpts and sources before subquestion synthesis', async () => {
  const controller = new AbortController();
  const coverage = createSurveyCoverageLedger({ papers: [{ id: 'p1' }], subquestions: [{ id: 'q1', question: 'Q1' }] });
  const checkpoints: ComparativeSurveyArtifacts[] = [];
  await assert.rejects(runComparativeSurveyCapability({
    question: 'Compare', signal: controller.signal,
    resume: { rephrasedQuestion: 'Saved', subquestions: ['Q1'], coverage, completedStages: ['rephrase', 'decompose'] },
    handlers: handlers({
      async research(input: { onCheckpoint: NonNullable<Parameters<Parameters<typeof runComparativeSurveyCapability>[0]['handlers']['research']>[0]['onCheckpoint']> }) {
        input.onCheckpoint(updateSurveyCoveragePaper(coverage, 'p1', { attempts: 1, stage: 'body-searched', citationIds: ['c1'] }), {
          notes: 'Already synthesized notes',
          citations: [{ id: 'c1', label: '1', paperId: 'p1', paperTitle: 'P1', sourceType: 'pdf-text', pageIndex: null }],
          contexts: [{ paperId: 'p1', subquestionId: 'q1', source: 'pdf-text', text: 'Actual body [[cite:c1]]', citationIds: ['c1'] }],
        });
        controller.abort();
        const error = new Error('cancelled'); error.name = 'AbortError'; throw error;
      },
    }),
    onCheckpoint: (artifacts) => checkpoints.push(artifacts),
  }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  const checkpoint = checkpoints.at(-1)!;
  assert.equal(checkpoint.coverage?.runState, 'cancelled');
  assert.equal(checkpoint.coverage?.papers[0]?.focusedRead, false, 'retrieved text is not yet a model read');
  assert.equal(checkpoint.researchNotes, 'Already synthesized notes');
  assert.equal(checkpoint.researchContexts?.[0]?.text, 'Actual body [[cite:c1]]');
  assert.equal(checkpoint.citations?.[0]?.id, 'c1');
});

test('a research retry receives intermediate checkpoint material and clears excerpts after synthesis', async () => {
  const coverage = createSurveyCoverageLedger({ papers: [{ id: 'p1' }], subquestions: [{ id: 'q1', question: 'Q1' }] });
  let attempts = 0;
  const result = await runComparativeSurveyCapability({
    question: 'Compare', maxRetries: 1,
    resume: { rephrasedQuestion: 'Saved', subquestions: ['Q1'], coverage, completedStages: ['rephrase', 'decompose'] },
    handlers: handlers({
      async research(input: Parameters<Parameters<typeof runComparativeSurveyCapability>[0]['handlers']['research']>[0]) {
        attempts += 1;
        if (attempts === 1) {
          input.onCheckpoint?.(coverage, { notes: 'Saved notes',
            citations: [{ id: 'c1', label: '1', paperId: 'p1', paperTitle: 'P1' }],
            contexts: [{ paperId: 'p1', subquestionId: 'q1', source: 'pdf-text', text: 'Actual [[cite:c1]]', citationIds: ['c1'] }] });
          throw new Error('temporary failure');
        }
        assert.equal(input.researchNotes, 'Saved notes');
        assert.equal(input.researchContexts?.[0]?.text, 'Actual [[cite:c1]]');
        assert.equal(input.citations?.[0]?.id, 'c1');
        return { notes: 'Synthesized [[cite:c1]]', citations: input.citations ?? [], coverage: input.coverage, researchContexts: [] };
      },
    }),
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result.artifacts.researchContexts, []);
  assert.equal(result.artifacts.researchNotes, 'Synthesized [[cite:c1]]');
  assert.equal(result.citations[0]?.id, 'c1');
});

function handlers(overrides: Record<string, unknown> = {}) {
  return {
    async rephrase() {
      return { text: 'Refined question', usage: { promptTokens: 1, completionTokens: 2 } };
    },
    async decompose() {
      return { questions: ['Q1', 'Q2'] };
    },
    async research(input: { onProgress: (completed: number, total: number) => void }) {
      input.onProgress(1, 2);
      input.onProgress(2, 2);
      return {
        notes: 'Evidence for Q1 and Q2',
        citations: [{ paperId: 'p1', paperTitle: 'Paper 1', pageIndex: 0 }],
      };
    },
    async report() {
      return { markdown: '# Comparative report', usage: { completionTokens: 4 } };
    },
    ...overrides,
  };
}

test('comparative survey runs stages in order and returns a unified envelope', async () => {
  const events: ComparativeSurveyEvent[] = [];
  const result = await runComparativeSurveyCapability({
    question: 'Compare methods',
    handlers: handlers(),
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(
    events.filter((event) => event.kind === 'stage_start').map((event) => event.stage),
    ['rephrase', 'decompose', 'research', 'report'],
  );
  assert.equal(events.filter((event) => event.kind === 'stage_progress').length, 2);
  assert.equal(result.markdown, '# Comparative report');
  assert.equal(result.citations.length, 1);
  assert.deepEqual(result.artifacts.completedStages, ['rephrase', 'decompose', 'research', 'report']);
  assert.deepEqual(result.tokenUsage, { promptTokens: 1, completionTokens: 6 });
  assert.equal(result.deliveryQuality?.state, 'partial', 'a report heading alone does not satisfy a full survey');
});

test('comparative survey retries a failed stage and preserves completed stages on resume', async () => {
  let reportAttempts = 0;
  let rephraseCalls = 0;
  const events: ComparativeSurveyEvent[] = [];
  const result = await runComparativeSurveyCapability({
    question: 'Compare methods',
    resume: {
      rephrasedQuestion: 'Saved question',
      subquestions: ['Saved Q'],
      researchNotes: 'Saved evidence',
      completedStages: ['rephrase', 'decompose', 'research'],
    },
    handlers: handlers({
      async rephrase() {
        rephraseCalls += 1;
        return { text: 'unreachable' };
      },
      async report() {
        reportAttempts += 1;
        if (reportAttempts === 1) throw new Error('transient');
        return { markdown: 'Recovered report' };
      },
    }),
    maxRetries: 1,
    onEvent: (event) => events.push(event),
  });

  assert.equal(rephraseCalls, 0);
  assert.equal(reportAttempts, 2);
  assert.equal(events.filter((event) => event.kind === 'stage_retry').length, 1);
  assert.equal(result.markdown, 'Recovered report');
});

test('comparative survey propagates cancellation without starting later stages', async () => {
  const controller = new AbortController();
  const calls: string[] = [];

  await assert.rejects(
    runComparativeSurveyCapability({
      question: 'Compare methods',
      signal: controller.signal,
      handlers: handlers({
        async rephrase() {
          calls.push('rephrase');
          controller.abort();
          return { text: 'Refined' };
        },
        async decompose() {
          calls.push('decompose');
          return { questions: ['Q'] };
        },
      }),
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );

  assert.deepEqual(calls, ['rephrase']);
});

test('comparative survey checkpoints and returns resumable coverage', async () => {
  const coverage = createSurveyCoverageLedger({
    papers: [{ id: 'p1', title: 'Paper 1' }, { id: 'p2', title: 'Paper 2' }],
    subquestions: [{ id: 'q1', question: 'Compare evidence' }],
  });
  const partialCoverage = updateSurveyCoverageSubquestion(
    updateSurveyCoveragePaper(coverage, 'p1', { stage: 'focused-read', attempts: 1 }),
    'q1',
    { state: 'partial', completedPaperIds: ['p1'], evidenceGaps: ['p2 remains unread'] },
  );
  const checkpoints: Array<{ coverage?: typeof partialCoverage }> = [];
  const result = await runComparativeSurveyCapability({
    question: 'Compare methods',
    resume: {
      rephrasedQuestion: 'Saved question',
      subquestions: ['Compare evidence'],
      researchNotes: 'Saved evidence',
      coverage: partialCoverage,
      completedStages: ['rephrase', 'decompose', 'research'],
    },
    handlers: handlers({
      async research(input: { coverage?: typeof partialCoverage }) {
        assert.equal(input.coverage?.papers[0]?.focusedRead, true);
        return { notes: 'new evidence', citations: [], coverage: input.coverage };
      },
      async report() {
        return { markdown: 'Recovered report' };
      },
    }),
    onCheckpoint: (artifacts) => checkpoints.push({ coverage: artifacts.coverage }),
  });

  assert.equal(result.coverageSummary?.candidateCount, 2);
  assert.equal(result.coverageSummary?.partialSubquestionCount, 1);
  assert.equal(result.coverageSummary?.canResume, true);
  assert.equal(result.deliveryQuality?.state, 'partial');
  assert.ok(result.deliveryQuality?.issues.some((item) => item.code === 'coverage-gap'));
  assert.equal(result.artifacts.coverage?.papers[0]?.focusedRead, true);
  assert.ok(checkpoints.length >= 1);
  assert.notEqual(checkpoints[0]?.coverage, partialCoverage, 'checkpoint is cloned');
});

test('comparative survey marks a resumable coverage checkpoint cancelled on abort', async () => {
  const coverage = createSurveyCoverageLedger({
    papers: [{ id: 'p1', title: 'Paper 1' }],
    subquestions: [{ id: 'q1', question: 'Compare evidence' }],
  });
  const controller = new AbortController();
  const checkpoints: Array<{ coverage?: typeof coverage }> = [];

  await assert.rejects(
    runComparativeSurveyCapability({
      question: 'Compare methods',
      signal: controller.signal,
      resume: {
        rephrasedQuestion: 'Saved question',
        subquestions: ['Compare evidence'],
        coverage,
        completedStages: ['rephrase', 'decompose'],
      },
      handlers: handlers({
        async research(input: { onCheckpoint?: (next: typeof coverage) => void }) {
          input.onCheckpoint?.(coverage);
          controller.abort();
          const error = new Error('cancelled');
          error.name = 'AbortError';
          throw error;
        },
      }),
      onCheckpoint: (artifacts) => checkpoints.push({ coverage: artifacts.coverage }),
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );

  const finalCoverage = checkpoints.at(-1)?.coverage;
  assert.equal(finalCoverage?.runState, 'cancelled');
  assert.equal(finalCoverage?.stopReason, 'cancelled');
});

test('comparative survey marks a resumable coverage checkpoint failed on research error', async () => {
  const coverage = createSurveyCoverageLedger({
    papers: [{ id: 'p1', title: 'Paper 1' }],
    subquestions: [{ id: 'q1', question: 'Compare evidence' }],
  });
  const checkpoints: Array<{ coverage?: typeof coverage }> = [];

  await assert.rejects(
    runComparativeSurveyCapability({
      question: 'Compare methods',
      resume: {
        rephrasedQuestion: 'Saved question',
        subquestions: ['Compare evidence'],
        coverage,
        completedStages: ['rephrase', 'decompose'],
      },
      handlers: handlers({
        async research(input: { onCheckpoint?: (next: typeof coverage) => void }) {
          input.onCheckpoint?.(coverage);
          throw new Error('research failed');
        },
      }),
      onCheckpoint: (artifacts) => checkpoints.push({ coverage: artifacts.coverage }),
    }),
    /research failed/,
  );

  const finalCoverage = checkpoints.at(-1)?.coverage;
  assert.equal(finalCoverage?.runState, 'failed');
  assert.equal(finalCoverage?.stopReason, 'error');
});

test('a nonempty report cut off by model length is partial while preserving text and citations', async () => {
  const markdown = '# Evidence\n\nDirect evidence [[cite:e1]] gives background for a conditional comparison.';
  const result = await runComparativeSurveyCapability({
    question: 'Write a full survey',
    handlers: handlers({
      async research() { return { notes: 'Direct evidence', citations: [{ id: 'e1', paperId: 'p1', paperTitle: 'Paper 1', pageIndex: 0 }] }; },
      async report() { return { markdown, finishReason: 'length' }; },
    }),
  });
  assert.equal(result.markdown, markdown);
  assert.equal(result.citations[0]?.id, 'e1');
  assert.equal(result.deliveryQuality?.state, 'partial');
  assert.equal(result.deliveryQuality?.hasInternalProtocolLeak, false);
  assert.ok(result.deliveryQuality?.issues.some((item) => item.code === 'incomplete-run'));
});

test('empty model reports are failed deliveries even though the report call returned', async () => {
  const result = await runComparativeSurveyCapability({ question: 'Compare methods', handlers: handlers({ async report() { return { markdown: '  ' }; } }) });
  assert.equal(result.deliveryQuality?.state, 'failed');
  assert.ok(result.deliveryQuality?.issues.some((item) => item.code === 'incomplete-run'));
});

test('report checks preserve original engineering requirements through capability question rephrasing', async () => {
  const result = await runComparativeSurveyCapability({
    question: 'Research the selected papers',
    deliveryRequirement: { kind: 'engineering', engineeringTopic: 'hot-jet', requiredSections: ['入口', '声学'], completeness: 'full' },
    handlers: handlers({ async report() { return { markdown: '# 入口\n\n背景证据：若已知速度入口则使用 m/s；未知值待补，需做收敛验证。' }; } }),
  });
  assert.deepEqual(result.deliveryQuality?.missingSections, ['声学']);
  assert.ok(result.deliveryQuality?.issues.some((item) => item.code === 'engineering-structure-gap'));
});
