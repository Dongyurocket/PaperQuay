import assert from 'node:assert/strict';
import { beforeEach, describe, mock, test } from 'node:test';

import {
  BACKGROUND_TASK_ERROR_RETENTION_MS,
  applyRagIndexBackgroundUpdate,
  clearFinishedBackgroundTasks,
  failBackgroundTask,
  finishBackgroundTask,
  listBackgroundTaskPublishLog,
  listBackgroundTasks,
  nextProgressPublishGate,
  removeBackgroundTask,
  resetBackgroundTasksForTests,
  shouldPublishBackgroundProgress,
  subscribeBackgroundTasks,
  taskCenterPercent,
  upsertBackgroundTask,
  type ProgressPublishGate,
} from '../src/services/backgroundTasks.ts';
import { buildTaskCenterEntries } from '../src/ui/taskCenterEntries.ts';
import type { DocumentParseTask } from '../src/services/documentParseTasks.ts';

describe('background tasks', { concurrency: 1 }, () => {
  beforeEach(() => {
    resetBackgroundTasksForTests();
  });

  test('throttle writes far fewer updates than one-per-block over 10 seconds', () => {
    const total = 240;
    const startedAt = 1_700_000_000_000;
    let gate: ProgressPublishGate | null = null;
    let writes = 0;

    for (let completed = 0; completed <= total; completed += 1) {
      const now = startedAt + completed * 40;

      if (!shouldPublishBackgroundProgress(gate, completed, total, now)) {
        continue;
      }

      gate = nextProgressPublishGate(completed, total, now);
      writes += 1;
    }

    const elapsedMs = total * 40;
    console.log(`translation throttle: ${total} block updates over ${elapsedMs}ms -> ${writes} upserts`);
    assert.ok(elapsedMs >= 9_000 && elapsedMs <= 10_000);
    assert.ok(writes < total / 4, `expected ${writes} upserts to be well below ${total} blocks`);
    assert.ok(writes >= 2);
  });

  test('percent stays empty unless both completed and total are usable', () => {
    assert.equal(taskCenterPercent(null, null), null);
    assert.equal(taskCenterPercent(3, null), null);
    assert.equal(taskCenterPercent(1, 0), null);
    assert.equal(taskCenterPercent(1, 4), 25);
    assert.equal(taskCenterPercent(8, 4), 100);
  });

  test('upsert records a publish and ignores an identical running snapshot', () => {
    upsertBackgroundTask({
      id: 'translate:paper',
      kind: 'translate',
      title: 'Paper',
      completed: 2,
      total: 10,
    });
    upsertBackgroundTask({
      id: 'translate:paper',
      kind: 'translate',
      title: 'Paper',
      completed: 2,
      total: 10,
    });

    assert.equal(listBackgroundTaskPublishLog().length, 1);
    assert.equal(listBackgroundTasks()[0]?.status, 'running');
    assert.equal(listBackgroundTasks()[0]?.completed, 2);
  });

  test('finish is visible once to subscribers and then leaves the registry', () => {
    const seen: string[][] = [];
    const unsubscribe = subscribeBackgroundTasks(() => {
      seen.push(listBackgroundTasks().map((task) => `${task.id}:${task.status}`));
    });

    upsertBackgroundTask({
      id: 'translate:paper',
      kind: 'translate',
      title: 'Paper',
      completed: 1,
      total: 2,
    });
    const finished = finishBackgroundTask('translate:paper');
    unsubscribe();

    assert.equal(finished?.status, 'success');
    assert.deepEqual(seen.map((row) => row.join(',')), [
      'translate:paper:running',
      'translate:paper:success',
      '',
    ]);
    assert.deepEqual(listBackgroundTasks(), []);
    assert.equal(finishBackgroundTask('translate:paper'), null);
  });

  test('cancel removes a running task without a terminal status', () => {
    upsertBackgroundTask({
      id: 'translate:paper',
      kind: 'translate',
      title: 'Paper',
      completed: 1,
      total: 4,
    });
    removeBackgroundTask('translate:paper');
    assert.deepEqual(listBackgroundTasks(), []);
  });

  test('rag pending has no percent, and two sources finish once', () => {
    applyRagIndexBackgroundUpdate({ documentKey: 'paper-1' });
    assert.deepEqual(listBackgroundTasks(), []);

    applyRagIndexBackgroundUpdate({
      documentKey: 'paper-1',
      status: 'pending',
      title: 'Tilt rotor',
      sourceType: 'mineru-markdown',
    });
    applyRagIndexBackgroundUpdate({
      documentKey: 'paper-1',
      status: 'pending',
      title: 'Tilt rotor',
      sourceType: 'pdf-text',
    });

    const running = listBackgroundTasks();
    assert.equal(running.length, 1);
    assert.equal(running[0]?.kind, 'rag');
    assert.equal(running[0]?.status, 'running');
    assert.equal(running[0]?.total ?? null, null);
    assert.equal(running[0]?.completed ?? null, null);
    assert.equal(taskCenterPercent(running[0]?.completed, running[0]?.total), null);

    applyRagIndexBackgroundUpdate({
      documentKey: 'paper-1',
      status: 'ready',
      title: 'Tilt rotor',
      sourceType: 'mineru-markdown',
    });
    assert.equal(listBackgroundTasks()[0]?.status, 'running');

    const seenSuccess = { count: 0 };
    const unsubscribe = subscribeBackgroundTasks(() => {
      if (listBackgroundTasks().some((task) => task.status === 'success')) {
        seenSuccess.count += 1;
      }
    });
    applyRagIndexBackgroundUpdate({
      documentKey: 'paper-1',
      status: 'ready',
      title: 'Tilt rotor',
      sourceType: 'pdf-text',
    });
    unsubscribe();

    assert.equal(seenSuccess.count, 1);
    assert.deepEqual(listBackgroundTasks(), []);
  });

  test('rag failure stays for 60 seconds and excluded work disappears', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });

    try {
      applyRagIndexBackgroundUpdate({
        documentKey: 'paper-2',
        status: 'pending',
        title: 'Failed paper',
        sourceType: 'mineru-markdown',
      });
      applyRagIndexBackgroundUpdate({
        documentKey: 'paper-2',
        status: 'failed',
        title: 'Failed paper',
        error: 'embedding down',
        sourceType: 'mineru-markdown',
      });
      applyRagIndexBackgroundUpdate({
        documentKey: 'paper-2',
        status: 'failed',
        title: 'Failed paper',
        error: 'embedding down',
        sourceType: 'mineru-markdown',
      });

      assert.equal(listBackgroundTasks().length, 1);
      assert.equal(listBackgroundTasks()[0]?.status, 'error');
      assert.equal(listBackgroundTasks()[0]?.error, 'embedding down');

      mock.timers.tick(BACKGROUND_TASK_ERROR_RETENTION_MS - 1);
      assert.equal(listBackgroundTasks().length, 1);
      mock.timers.tick(1);
      assert.deepEqual(listBackgroundTasks(), []);

      applyRagIndexBackgroundUpdate({
        documentKey: 'paper-3',
        status: 'pending',
        title: 'Excluded',
        sourceType: 'mineru-markdown',
      });
      applyRagIndexBackgroundUpdate({
        documentKey: 'paper-3',
        status: 'excluded',
        sourceType: 'mineru-markdown',
      });
      assert.deepEqual(listBackgroundTasks(), []);
    } finally {
      mock.timers.reset();
    }
  });

  test('clearFinished removes terminal tasks and keeps running ones', () => {
    upsertBackgroundTask({
      id: 'translate:live',
      kind: 'translate',
      title: 'Live',
      completed: 1,
      total: 3,
    });
    failBackgroundTask('rag:dead', 'boom', { kind: 'rag', title: 'Dead' });
    clearFinishedBackgroundTasks();

    assert.deepEqual(listBackgroundTasks().map((task) => task.id), ['translate:live']);
  });

  test('task center merges both sources by updatedAt and hides success', () => {
    const parseTask: DocumentParseTask = {
      taskId: 'parse-1',
      documentKey: 'doc-1',
      revision: 1,
      startedAt: 10,
      updatedAt: 50,
      status: 'running',
      stage: 'recognizing',
      completed: 1,
      total: 2,
    };
    const entries = buildTaskCenterEntries({
      now: 1_000,
      english: false,
      parseTasks: [
        parseTask,
        { ...parseTask, documentKey: 'old-error', status: 'error', updatedAt: 1_000 - 60_000, error: 'old' },
        { ...parseTask, documentKey: 'done', status: 'success', updatedAt: 900 },
      ],
      backgroundTasks: [
        {
          id: 'translate:doc-2',
          kind: 'translate',
          title: 'Translated paper',
          status: 'running',
          completed: 4,
          total: 8,
          startedAt: 20,
          updatedAt: 80,
        },
        {
          id: 'rag:doc-3',
          kind: 'rag',
          title: 'Indexed paper',
          status: 'running',
          completed: null,
          total: null,
          startedAt: 30,
          updatedAt: 40,
        },
        {
          id: 'translate:done',
          kind: 'translate',
          title: 'Done',
          status: 'success',
          completed: 8,
          total: 8,
          startedAt: 1,
          updatedAt: 900,
        },
      ],
    });

    assert.deepEqual(entries.map((entry) => `${entry.kind}:${entry.percent}:${entry.kindLabel}`), [
      'translate:50:翻译',
      'parse:50:解析',
      'rag:null:索引',
    ]);
    assert.equal(entries[2]?.detail, 'Indexed paper');
  });
});
