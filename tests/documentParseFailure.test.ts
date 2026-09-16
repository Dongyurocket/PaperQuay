import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectDocumentParseTasks,
  documentParseTaskMessage,
  getDocumentParseTask,
  reportDocumentParseFailure,
  subscribeDocumentParseTasks,
  type DocumentParseTask,
} from '../src/services/documentParseTasks.ts';
import { toPaperParseTaskState } from '../src/features/reader/documentParseTaskState.ts';

const base: DocumentParseTask = {
  documentKey: 'paper', taskId: 'new', revision: 10, startedAt: 100,
  updatedAt: 110, status: 'running', stage: 'assets', completed: 2, total: 4,
};

test('connection failures reach terminal state without clobbering newer or duplicate tasks', async (t) => {
  let emit!: (event: { payload: DocumentParseTask }) => void;
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = { paperquay: {
    listen: async (_name: string, listener: typeof emit) => { emit = listener; return () => {}; },
    invoke: async () => [],
  } };
  t.after(() => { (globalThis as any).window = previousWindow; });
  let notifications = 0;
  const unsubscribe = subscribeDocumentParseTasks(() => { notifications += 1; });
  t.after(unsubscribe);
  await connectDocumentParseTasks();

  reportDocumentParseFailure('first', 'unconnected', new Error('IPC unavailable'), 1);
  assert.equal(getDocumentParseTask('first')?.status, 'error');
  assert.equal(getDocumentParseTask('first')?.revision, 0);

  emit({ payload: base });
  reportDocumentParseFailure('paper', 'duplicate', new Error('already running'), 120);
  assert.equal(getDocumentParseTask('paper')?.taskId, 'new');
  assert.equal(getDocumentParseTask('paper')?.status, 'running');

  reportDocumentParseFailure('paper', 'new', new Error('IPC disconnected'), 99);
  assert.equal(getDocumentParseTask('paper')?.status, 'error');
  assert.equal(getDocumentParseTask('paper')?.revision, 10);
  // Backend revisions remain authoritative even after a local transport failure.
  emit({ payload: { ...base, revision: 11, status: 'success', stage: 'done', updatedAt: 130 } });
  reportDocumentParseFailure('paper', 'old', new Error('late old error'), 90);
  reportDocumentParseFailure('paper', 'new', new Error('late same-task error'), 99);
  assert.equal(getDocumentParseTask('paper')?.status, 'success');

  // A genuinely later invocation can fail before reaching the backend.
  reportDocumentParseFailure('paper', 'later', new Error('connection failed'), 140);
  assert.equal(getDocumentParseTask('paper')?.taskId, 'later');
  assert.equal(getDocumentParseTask('paper')?.status, 'error');
  reportDocumentParseFailure('paper', 'old', new Error('late old error'), 90);
  assert.equal(getDocumentParseTask('paper')?.taskId, 'later');
  assert.ok(notifications >= 5);
});

test('PaddleOCR labels and stage progress honor the selected locale', () => {
  assert.equal(documentParseTaskMessage(base, 'en-US'), 'PaddleOCR-VL · Downloading images (2/4)');
  assert.equal(documentParseTaskMessage(base, 'zh-CN'), 'PaddleOCR-VL · 下载图片资源 (2/4)');
  assert.equal(toPaperParseTaskState(base, 'en-US').label, 'PaddleOCR-VL Parse');
  assert.equal(documentParseTaskMessage({ ...base, status: 'error' }, 'en-US'), 'PaddleOCR-VL parse failed');
});
