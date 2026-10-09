import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSurveyCoverageLedger,
  finishSurveyCoverage,
  getSurveyCoverageBudgetStopReason,
  isSurveyCoverageBudgetExhausted,
  normalizeSurveyCoverageLedger,
  normalizeSurveyResearchContexts,
  processSurveyCoverageBatch,
  resumeSurveyCoverageLedger,
  selectSurveyCoverageBatch,
  summarizeSurveyCoverage,
  updateSurveyCoverageBudget,
  updateSurveyCoveragePaper,
  updateSurveyCoverageSubquestion,
} from '../src/services/agentSurveyCoverage.ts';

test('coverage keeps discovery, body search, focused reading, and citation separate', () => {
  let ledger = createSurveyCoverageLedger({
    papers: [
      { id: 'p1', title: 'Paper 1' },
      { id: 'p2', title: 'Paper 2' },
      { id: 'p1', title: 'duplicate is ignored' },
    ],
    subquestions: [{ id: 'q1', question: 'Which method is more stable?' }],
    now: 10,
  });

  ledger = updateSurveyCoveragePaper(ledger, 'p1', {
    stage: 'body-searched',
    attempts: 1,
    subquestionIds: ['q1'],
    timestamp: 11,
  });
  ledger = updateSurveyCoveragePaper(ledger, 'p2', {
    stage: 'cited',
    attempts: 1,
    citationIds: ['cite-2'],
    timestamp: 12,
  });

  const summary = summarizeSurveyCoverage(ledger);
  assert.equal(summary.candidateCount, 2);
  assert.equal(summary.abstractReviewedCount, 2);
  assert.equal(summary.bodySearchedCount, 2);
  assert.equal(summary.focusedReadCount, 0, 'citation does not silently become focused reading');
  assert.equal(summary.citedCount, 1);
  assert.equal(summary.pendingCount, 1, 'a searched paper remains in-progress until a terminal outcome is recorded');
  assert.equal(summary.bodySearchCoverage, 1);
  assert.equal(summary.citationCoverage, 0.5);
  assert.deepEqual(ledger.papers[0]?.subquestionIds, ['q1']);
  assert.deepEqual(ledger.papers[1]?.citationIds, ['cite-2']);
});

test('coverage records irrelevant, unresolved, and failed papers independently', () => {
  let ledger = createSurveyCoverageLedger({ papers: [{ id: 'irrelevant' }, { id: 'empty' }, { id: 'failed' }, { id: 'pending' }] });
  ledger = updateSurveyCoveragePaper(ledger, 'irrelevant', { irrelevant: true, attempts: 1 });
  ledger = updateSurveyCoveragePaper(ledger, 'empty', { unresolved: true, attempts: 1 });
  ledger = updateSurveyCoveragePaper(ledger, 'failed', { failed: true, attempts: 1, error: 'request failed' });

  const summary = summarizeSurveyCoverage(ledger);
  assert.equal(summary.irrelevantCount, 1);
  assert.equal(summary.unresolvedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.canResume, true);
  assert.equal(ledger.papers.find((paper) => paper.paperId === 'failed')?.error, 'request failed');
});

test('subquestion evidence gaps survive summary and make a partial run resumable', () => {
  let ledger = createSurveyCoverageLedger({
    papers: [{ id: 'p1' }],
    subquestions: [{ id: 'q1', question: 'What is missing?' }],
  });
  ledger = updateSurveyCoveragePaper(ledger, 'p1', { stage: 'focused-read', attempts: 1 });
  ledger = updateSurveyCoverageSubquestion(ledger, 'q1', {
    state: 'partial',
    completedPaperIds: ['p1'],
    evidenceGaps: ['No controlled comparison reported'],
  });

  const finished = finishSurveyCoverage(ledger, { timestamp: 20 });
  const summary = summarizeSurveyCoverage(finished);
  assert.equal(finished.runState, 'partial');
  assert.equal(summary.partialSubquestionCount, 1);
  assert.deepEqual(summary.evidenceGaps, ['No controlled comparison reported']);
  assert.equal(summary.canResume, true);
});

test('coverage reports a stable budget stop reason and finish infers partial state', () => {
  let ledger = createSurveyCoverageLedger({
    papers: [{ id: 'p1' }, { id: 'p2' }],
    subquestions: [{ id: 'q1', question: 'Question' }],
    budget: { maxPapers: 1, maxTokens: 10, maxMilliseconds: 1 },
  });
  ledger = updateSurveyCoveragePaper(ledger, 'p1', { attempts: 1, stage: 'abstract-reviewed' });
  ledger = updateSurveyCoverageBudget(ledger, { promptTokens: 10, elapsedMilliseconds: 1 }, 30);

  assert.equal(getSurveyCoverageBudgetStopReason(ledger), 'budget-papers');
  const finished = finishSurveyCoverage(ledger, { timestamp: 31 });
  assert.equal(finished.runState, 'partial');
  assert.equal(finished.stopReason, 'budget-papers');
});

test('coverage budget exhaustion is explicit and does not claim completion', () => {
  let ledger = createSurveyCoverageLedger({
    papers: [{ id: 'p1' }, { id: 'p2' }],
    subquestions: [{ id: 'q1', question: 'Question' }],
    budget: { maxPapers: 1, maxTokens: 10 },
  });
  ledger = updateSurveyCoveragePaper(ledger, 'p1', { attempts: 1, stage: 'abstract-reviewed' });
  ledger = updateSurveyCoverageBudget(ledger, { promptTokens: 7, completionTokens: 3 }, 30);

  assert.equal(isSurveyCoverageBudgetExhausted(ledger), true);
  const finished = finishSurveyCoverage(ledger, { stopReason: 'budget-papers', timestamp: 31 });
  const summary = summarizeSurveyCoverage(finished);
  assert.equal(finished.runState, 'partial');
  assert.equal(finished.stopReason, 'budget-papers');
  assert.equal(summary.budgetExhausted, true);
  assert.equal(summary.pendingCount, 2, 'the processed paper is in-progress and the second paper is pending');
  assert.equal(summary.canResume, true);
});

test('coverage normalization drops malformed records and never invents completion', () => {
  const normalized = normalizeSurveyCoverageLedger({
    version: 999,
    runState: 'not-a-state',
    papers: [
      { paperId: 'p1', cited: 'yes', attempts: 'bad', citationIds: ['c1', 'c1', 4] },
      { paperId: '', cited: true },
      null,
    ],
    subquestions: [
      { id: 'q1', question: 'Valid', state: 'not-a-state', evidenceGaps: ['gap', 'gap'] },
      { id: 'q2', question: '' },
    ],
    budget: { maxPapers: -3, promptTokens: '12.7', completionTokens: 'bad' },
  });

  assert.ok(normalized);
  assert.equal(normalized?.version, 1);
  assert.equal(normalized?.runState, 'pending');
  assert.equal(normalized?.papers.length, 1);
  assert.equal(normalized?.papers[0]?.cited, false);
  assert.equal(normalized?.papers[0]?.attempts, 0);
  assert.deepEqual(normalized?.papers[0]?.citationIds, ['c1']);
  assert.equal(normalized?.subquestions.length, 1);
  assert.equal(normalized?.subquestions[0]?.state, 'pending');
  assert.deepEqual(normalized?.subquestions[0]?.evidenceGaps, ['gap']);
  assert.equal(normalized?.budget.promptTokens, 12);
  assert.equal(normalized?.budget.maxPapers, undefined);
});

test('an explicit continuation renews the allowance while retaining actual cumulative usage and candidates', () => {
  let ledger = createSurveyCoverageLedger({
    papers: [{ id: 'p1' }, { id: 'p2' }],
    subquestions: [{ id: 'q1', question: 'Evidence?' }],
    budget: { maxPapers: 1, maxTokens: 10, maxMilliseconds: 20 },
  });
  ledger = updateSurveyCoveragePaper(ledger, 'p1', { attempts: 1, stage: 'focused-read', citationIds: ['c1'] });
  ledger = updateSurveyCoverageSubquestion(ledger, 'q1', { state: 'partial', completedPaperIds: ['p1'] });
  ledger = updateSurveyCoverageBudget(ledger, { promptTokens: 7, completionTokens: 3, elapsedMilliseconds: 20 });
  ledger = resumeSurveyCoverageLedger(finishSurveyCoverage(ledger));

  assert.equal(getSurveyCoverageBudgetStopReason(ledger), undefined);
  assert.deepEqual(ledger.papers.map((paper) => paper.paperId), ['p1', 'p2']);
  assert.deepEqual(ledger.papers[0]?.citationIds, ['c1']);
  assert.equal(ledger.budget.promptTokens, 7);
  assert.equal(ledger.budget.completionTokens, 3);
  assert.equal(ledger.budget.elapsedMilliseconds, 20);
  assert.deepEqual(selectSurveyCoverageBatch(ledger, ['p1', 'p2'], 'q1', 4), ['p2']);
  ledger = updateSurveyCoverageBudget(ledger, { promptTokens: 9 });
  assert.equal(getSurveyCoverageBudgetStopReason(ledger), undefined);
  ledger = updateSurveyCoverageBudget(ledger, { completionTokens: 1 });
  assert.equal(getSurveyCoverageBudgetStopReason(ledger), 'budget-tokens');
});

test('176 candidate fixture schedules only the configured paper allowance and continuation skips completed papers', () => {
  const paperIds = Array.from({ length: 176 }, (_, index) => `p${index + 1}`);
  let ledger = createSurveyCoverageLedger({
    papers: paperIds.map((id) => ({ id })),
    subquestions: [{ id: 'q1', question: 'Compare', candidatePaperIds: paperIds }],
    budget: { maxPapers: 5 },
  });
  const first = selectSurveyCoverageBatch(ledger, paperIds, 'q1', 4);
  assert.deepEqual(first, ['p1', 'p2', 'p3', 'p4']);
  for (const id of first) ledger = updateSurveyCoveragePaper(ledger, id, { attempts: 1, stage: 'focused-read' });
  ledger = updateSurveyCoverageSubquestion(ledger, 'q1', { state: 'in-progress', completedPaperIds: first });
  const second = selectSurveyCoverageBatch(ledger, paperIds, 'q1', 4);
  assert.deepEqual(second, ['p5']);
  ledger = updateSurveyCoveragePaper(ledger, 'p5', { attempts: 1, stage: 'focused-read' });
  ledger = updateSurveyCoverageSubquestion(ledger, 'q1', { state: 'partial', completedPaperIds: [...first, ...second] });
  assert.deepEqual(selectSurveyCoverageBatch(ledger, paperIds, 'q1', 4), []);
  assert.equal(summarizeSurveyCoverage(ledger).candidateCount, 176);
  assert.equal(summarizeSurveyCoverage(ledger).focusedReadCount, 5);
  assert.equal(summarizeSurveyCoverage(ledger).pendingCount, 171);
  ledger = resumeSurveyCoverageLedger(finishSurveyCoverage(ledger));
  assert.deepEqual(selectSurveyCoverageBatch(ledger, paperIds, 'q1', 4), ['p6', 'p7', 'p8', 'p9']);
});

test('batch selection retries failed or unresolved work but distinct-paper budget does not double count a retry', () => {
  let ledger = createSurveyCoverageLedger({
    papers: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    subquestions: [{ id: 'q1', question: 'Compare' }],
    budget: { maxPapers: 3 },
  });
  ledger = updateSurveyCoveragePaper(ledger, 'p1', { attempts: 1, failed: true });
  ledger = updateSurveyCoveragePaper(ledger, 'p2', { attempts: 1, unresolved: true });
  ledger = updateSurveyCoveragePaper(ledger, 'p3', { irrelevant: true });
  ledger = updateSurveyCoverageSubquestion(ledger, 'q1', { completedPaperIds: ['p1', 'p2'] });
  assert.deepEqual(selectSurveyCoverageBatch(ledger, ['p1', 'p2', 'p3'], 'q1', 4), ['p1', 'p2']);
  ledger = updateSurveyCoveragePaper(ledger, 'p1', { attempts: 2 });
  assert.deepEqual(ledger.budget.execution?.processedPaperIds, ['p1', 'p2']);
  assert.equal(getSurveyCoverageBudgetStopReason(ledger), undefined);
});

test('completed research can finish when a reviewed paper is not cited in the report', () => {
  let ledger = createSurveyCoverageLedger({
    papers: [{ id: 'p1' }], subquestions: [{ id: 'q1', question: 'Compare' }],
  });
  ledger = updateSurveyCoveragePaper(ledger, 'p1', { stage: 'focused-read', attempts: 1, citationIds: ['c1'] });
  ledger = updateSurveyCoverageSubquestion(ledger, 'q1', { state: 'completed', completedPaperIds: ['p1'], evidenceCitationIds: ['c1'] });
  ledger = finishSurveyCoverage(ledger);
  assert.equal(ledger.runState, 'completed');
  assert.equal(summarizeSurveyCoverage(ledger).pendingCount, 0);
  assert.equal(summarizeSurveyCoverage(ledger).citedCount, 0);
  assert.equal(summarizeSurveyCoverage(ledger).canResume, false);
});

test('empty RAG hits, missing documents and retrieval failures remain distinct from paper task failure', () => {
  let ledger = createSurveyCoverageLedger({ papers: [{ id: 'empty' }, { id: 'missing' }, { id: 'fallback' }, { id: 'failed' }] });
  ledger = updateSurveyCoveragePaper(ledger, 'empty', { retrievalOutcome: 'empty', stage: 'focused-read' });
  ledger = updateSurveyCoveragePaper(ledger, 'missing', { unresolved: true, unresolvedReason: 'no-document', retrievalOutcome: 'unavailable' });
  ledger = updateSurveyCoveragePaper(ledger, 'fallback', { retrievalOutcome: 'failed', stage: 'focused-read', error: 'RAG failed; document fallback used' });
  ledger = updateSurveyCoveragePaper(ledger, 'failed', { failed: true, error: 'context task failed' });
  const summary = summarizeSurveyCoverage(ledger);
  assert.equal(summary.emptyHitCount, 1);
  assert.equal(summary.unreadableCount, 1);
  assert.equal(summary.retrievalFailedCount, 1);
  assert.equal(summary.unresolvedCount, 1);
  assert.equal(summary.failedCount, 1);
  ledger = updateSurveyCoveragePaper(ledger, 'missing', { unresolved: false, stage: 'focused-read' });
  assert.equal(ledger.papers.find((paper) => paper.paperId === 'missing')?.unresolvedReason, undefined);
});

test('a cancelled batch keeps settled evidence and has no result callbacks after cancellation returns', async () => {
  const controller = new AbortController();
  const recorded: string[] = [];
  let releaseCancelled!: () => void;
  let releaseThird!: (value: string) => void;
  const cancelled = new Promise<void>((resolve) => { releaseCancelled = resolve; });
  const third = new Promise<string>((resolve) => { releaseThird = resolve; });
  await assert.rejects(processSurveyCoverageBatch({
    paperIds: ['p1', 'p2', 'p3'], signal: controller.signal,
    async load(id) {
      if (id === 'p1') return 'first evidence';
      if (id === 'p3') return third;
      await cancelled;
      const error = new Error('cancelled'); error.name = 'AbortError'; throw error;
    },
    onResult(result) {
      assert.equal('error' in result, false, 'a cancelled request is not a per-paper failure');
      recorded.push(result.paperId);
      if (result.paperId === 'p1') {
        controller.abort(); releaseCancelled(); releaseThird('third evidence');
      }
    },
  }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  assert.deepEqual(recorded, ['p1', 'p3']);
  await Promise.resolve();
  assert.deepEqual(recorded, ['p1', 'p3']);
});

test('a single failed context stays visible while the batch retains other evidence', async () => {
  const results = await processSurveyCoverageBatch({
    paperIds: ['p1', 'p2', 'p3'],
    async load(id) { if (id === 'p2') throw new Error('request failed'); return `evidence-${id}`; },
    onResult() {},
  });
  assert.equal(results.filter((result) => 'value' in result).length, 2);
  assert.equal(results.filter((result) => 'error' in result).length, 1);
});

test('legacy budgets and malformed execution/context fields normalize without erasing actual usage', () => {
  const legacy = normalizeSurveyCoverageLedger({ papers: [{ paperId: 'p1', attempts: 1 }], budget: { maxPapers: 1, promptTokens: 12 } });
  assert.ok(legacy);
  assert.equal(getSurveyCoverageBudgetStopReason(legacy), 'budget-papers');
  const normalized = normalizeSurveyCoverageLedger({ papers: [{ paperId: 'p1', citationIds: 5 }],
    budget: { promptTokens: 12, completionTokens: 3, elapsedMilliseconds: 5,
      execution: { processedPaperIds: ['p1', 'gone', 'p1'], completedSubquestionIds: 'bad', promptTokenBaseline: 100, completionTokenBaseline: -1, elapsedBaseline: 9 } } });
  assert.deepEqual(normalized?.budget.execution, {
    processedPaperIds: ['p1'], completedSubquestionIds: [], promptTokenBaseline: 12, completionTokenBaseline: 0, elapsedBaseline: 5,
  });
  assert.deepEqual(normalizeSurveyResearchContexts([
    { paperId: 'p1', subquestionId: 'q1', source: 'pdf-text', text: 'actual [[cite:c1]]', citationIds: ['c1', 'c1'] },
    { paperId: 'bad', subquestionId: 'q1', source: 'pdf-text', text: 42 },
    null,
  ]), [{ paperId: 'p1', subquestionId: 'q1', source: 'pdf-text', text: 'actual [[cite:c1]]', citationIds: ['c1'] }]);
});
