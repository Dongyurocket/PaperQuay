import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runComparativeSurveyCapability,
  type ComparativeSurveyEvent,
} from '../src/services/agentCapability.ts';

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
