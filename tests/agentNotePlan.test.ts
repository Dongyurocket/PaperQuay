import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentNoteWritePlan } from '../src/services/agentNotePlan.ts';

test('createAgentNoteWritePlan keeps valid create operations and fills defaults', async () => {
  const plan = await createAgentNoteWritePlan({
    summary: ' add notes ',
    operations: [
      {
        kind: 'create',
        title: ' 方法笔记 ',
        content: '## 方法\n内容',
        tags: ['llm', 'llm', 'agent', ''],
        paperId: 'paper-1',
        reason: '记录方法',
      },
    ],
  });

  assert.equal(plan.summary, 'add notes');
  assert.equal(plan.operations.length, 1);
  const [operation] = plan.operations;
  assert.equal(operation.kind, 'create');
  assert.equal(operation.title, '方法笔记');
  assert.equal(operation.content, '## 方法\n内容');
  assert.deepEqual(operation.tags, ['llm', 'agent']);
  assert.equal(operation.paperId, 'paper-1');
});

test('createAgentNoteWritePlan drops invalid operations', async () => {
  const plan = await createAgentNoteWritePlan({
    operations: [
      // update without any change payload → dropped
      { kind: 'update', noteId: 'n-1' },
      // valid delete
      { kind: 'delete', noteId: 'n-2' },
      // delete without noteId → dropped
      { kind: 'delete' },
      // update without noteId → dropped
      { kind: 'update', title: 'x' },
      null,
      'garbage',
      // unknown kind → dropped
      { kind: 'explode', noteId: 'n-3' },
    ],
  });

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].kind, 'delete');
  assert.equal(plan.operations[0].noteId, 'n-2');
});

test('createAgentNoteWritePlan keeps a valid update payload', async () => {
  const plan = await createAgentNoteWritePlan({
    operations: [
      {
        kind: 'update',
        noteId: 'n-9',
        title: '新标题',
        content: '新正文',
        tags: ['revised'],
      },
    ],
  });

  assert.equal(plan.operations.length, 1);
  const [operation] = plan.operations;
  assert.equal(operation.kind, 'update');
  assert.equal(operation.noteId, 'n-9');
  assert.equal(operation.title, '新标题');
  assert.equal(operation.content, '新正文');
  assert.deepEqual(operation.tags, ['revised']);
});
