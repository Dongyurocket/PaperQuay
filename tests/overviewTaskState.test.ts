import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOverviewTask, shouldReadOverviewCache, type OverviewTaskInput } from '../src/features/reader/overview/overviewTaskState.ts';

const base: OverviewTaskInput = { loading: false, translating: false, summaryLoading: false, blockCount: 20, translatedCount: 0, translationCompleted: 0, translationTotal: 0, hasSummary: false };
test('overview tasks derive idle and cached completion independently', () => {
  assert.equal(deriveOverviewTask('mineru', base).status, 'success');
  assert.equal(deriveOverviewTask('translation', base).status, 'idle');
  assert.equal(deriveOverviewTask('overview', { ...base, hasSummary: true }).status, 'success');
  assert.equal(deriveOverviewTask('translation', { ...base, translatedCount: 20 }).status, 'success');
  assert.equal(deriveOverviewTask('translation', { ...base, translatedCount: 19 }).status, 'idle');
});
test('running and failed tasks override old cached completion and preserve shared progress semantics', () => {
  const operation = { kind: 'translation', status: 'running', label: '', message: 'Working', completed: 3, total: 20, updatedAt: 1 } as const;
  const running = deriveOverviewTask('translation', { ...base, translating: true, translatedCount: 20, operation });
  assert.equal(running.status, 'running');
  assert.equal(running.progress.countText, '3/20');
  assert.equal(running.progress.percent, 15);
  const failed = deriveOverviewTask('translation', { ...base, operation: { ...operation, status: 'error', total: null } });
  assert.equal(failed.status, 'error');
  assert.equal(failed.progress.countText, '3/?');
  assert.equal(failed.progress.showProgressBar, false);
  assert.equal(failed.message, 'Working');
  assert.equal(deriveOverviewTask('overview', { ...base, hasSummary: true, summaryError: 'Offline' }).status, 'error');
});
test('an unrelated operation cannot mark another process running or failed', () => {
  const operation = { kind: 'mineru', status: 'error', label: '', message: 'Parse failed', updatedAt: 1 } as const;
  assert.equal(deriveOverviewTask('overview', { ...base, hasSummary: true, operation }).status, 'success');
  assert.equal(deriveOverviewTask('translation', { ...base, operation }).status, 'idle');
});
test('running unknown totals use indeterminate progress', () => {
  const running = deriveOverviewTask('overview', { ...base, summaryLoading: true });
  assert.equal(running.progress.indeterminate, true);
  assert.equal(running.progress.countText, null);
});
test('only an explicit force request bypasses an available overview cache', () => {
  assert.equal(shouldReadOverviewCache('source'), true);
  assert.equal(shouldReadOverviewCache('source', false), true);
  assert.equal(shouldReadOverviewCache('source', true), false);
  assert.equal(shouldReadOverviewCache(' '), false);
});
