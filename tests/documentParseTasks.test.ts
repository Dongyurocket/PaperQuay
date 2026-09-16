import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptDocumentParseTask, connectDocumentParseTasks, getDocumentParseTask, subscribeDocumentParseTasks, type DocumentParseTask } from '../src/services/documentParseTasks.ts';
import { shouldShowParseTask, toPaperParseTaskState } from '../src/features/reader/documentParseTaskState.ts';

const task: DocumentParseTask = { documentKey: 'paper', taskId: 'new', status: 'success', stage: 'done', revision: 5, startedAt: 10, updatedAt: 20, blockCount: 2 };

test('old events and query snapshots cannot overwrite a newer task', () => {
  assert.equal(acceptDocumentParseTask(task, { ...task, taskId: 'old', revision: 4 }), false);
  assert.equal(acceptDocumentParseTask(task, { ...task, revision: 5 }), false);
  assert.equal(acceptDocumentParseTask(task, { ...task, revision: 6 }), true);
});

test('orphaned running operation yields to authoritative completion but newer operations survive', () => {
  const stale = { ...toPaperParseTaskState(task), status: 'running' as const, updatedAt: 11 };
  assert.equal(shouldShowParseTask(task, stale), true);
  assert.equal(toPaperParseTaskState(task).label, 'PaddleOCR-VL 解析');
  assert.equal(shouldShowParseTask(task, { ...stale, kind: 'translation', updatedAt: 30 }), false);
});

test('subscription precedes snapshot, stale snapshot is ignored, terminal events survive tab unsubscribe', async () => {
  let callback!: (event: { payload: DocumentParseTask }) => void;
  let subscribed = false;
  let notifyCount = 0;
  (globalThis as any).window = { paperquay: {
    listen: async (_name: string, handler: typeof callback) => { callback = handler; subscribed = true; return () => {}; },
    invoke: async () => {
      assert.equal(subscribed, true);
      callback({ payload: task });
      return [{ ...task, revision: 2, status: 'running' }];
    },
  } };
  const unmount = subscribeDocumentParseTasks(() => notifyCount++);
  await connectDocumentParseTasks();
  assert.equal(getDocumentParseTask('paper')?.status, 'success');
  unmount();
  callback({ payload: { ...task, taskId: 'second', revision: 6, status: 'running' } });
  callback({ payload: { ...task, taskId: 'second', revision: 7, status: 'error', error: 'timeout' } });
  assert.equal(getDocumentParseTask('paper')?.status, 'error');
  assert.ok(notifyCount > 0);
  delete (globalThis as any).window;
});
