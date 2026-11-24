import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getReaderQaTabSnapshot,
  useReaderQaStore,
} from '../src/stores/useReaderQaStore.ts';
import type { DocumentChatSession } from '../src/types/reader.ts';

function session(id: string): DocumentChatSession {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  };
}

function resetStore(): void {
  useReaderQaStore.setState({ tabs: {} });
}

test('reader QA store exposes the original defaults per tab', () => {
  resetStore();
  assert.equal(getReaderQaTabSnapshot('reader:a'), undefined);

  useReaderQaStore.getState().setTabField('reader:a', 'qaInput', '');
  const state = getReaderQaTabSnapshot('reader:a');

  assert.deepEqual(state?.qaSessions, []);
  assert.equal(state?.selectedQaSessionId, '');
  assert.equal(state?.qaInput, '');
  assert.deepEqual(state?.qaAttachments, []);
  assert.equal(state?.selectedQaPresetId, '');
  assert.equal(state?.qaRagEnabled, true);
  assert.equal(state?.qaAnswerRenderMode, 'markdown');
  assert.equal(state?.qaReasoningEffort, 'auto');
  assert.deepEqual(state?.qaRunningSessionIds, []);
  assert.equal(state?.qaError, '');
});

test('reader QA store setters preserve functional updates without sharing state across tabs', () => {
  resetStore();
  const store = useReaderQaStore.getState();
  const sessions = [session('shared-session')];

  store.setTabField('reader:a', 'qaSessions', sessions);
  store.setTabField('reader:a', 'selectedQaSessionId', 'shared-session');
  store.setTabField('reader:a', 'qaInput', 'question');
  store.setTabField('reader:a', 'qaAttachments', [
    { id: 'a1', kind: 'file', name: 'paper.txt', mimeType: 'text/plain', size: 10 },
  ]);
  store.setTabField('reader:a', 'selectedQaPresetId', 'preset-1');
  store.setTabField('reader:a', 'qaRagEnabled', false);
  store.setTabField('reader:a', 'qaAnswerRenderMode', 'html');
  store.setTabField('reader:a', 'qaReasoningEffort', 'high');
  store.setTabField('reader:a', 'qaRunningSessionIds', ['shared-session']);
  store.setTabField('reader:a', 'qaError', 'failed once');
  store.setTabField('reader:a', 'qaInput', (current) => `${current}!`);
  store.setTabField('reader:a', 'qaRunningSessionIds', (current) => current.filter((id) => id !== 'other'));

  const state = getReaderQaTabSnapshot('reader:a');
  assert.equal(state?.qaSessions, sessions);
  assert.equal(state?.selectedQaSessionId, 'shared-session');
  assert.equal(state?.qaInput, 'question!');
  assert.equal(state?.qaAttachments[0]?.id, 'a1');
  assert.equal(state?.selectedQaPresetId, 'preset-1');
  assert.equal(state?.qaRagEnabled, false);
  assert.equal(state?.qaAnswerRenderMode, 'html');
  assert.equal(state?.qaReasoningEffort, 'high');
  assert.deepEqual(state?.qaRunningSessionIds, ['shared-session']);
  assert.equal(state?.qaError, 'failed once');

  // B has its own defaults; A's draft and sessions did not leak.
  assert.equal(getReaderQaTabSnapshot('reader:b'), undefined);
  assert.equal(getReaderQaTabSnapshot('reader:a')?.qaInput, 'question!');
});

test('reader QA store can clear transient input and attachments independently', () => {
  resetStore();
  const store = useReaderQaStore.getState();
  store.setTabField('reader:a', 'qaInput', 'draft');
  store.setTabField('reader:a', 'qaAttachments', [
    { id: 'a', kind: 'file', name: 'a.txt', mimeType: 'text/plain', size: 1 },
  ]);
  store.setTabField('reader:a', 'qaInput', '');
  store.setTabField('reader:a', 'qaAttachments', []);

  assert.equal(getReaderQaTabSnapshot('reader:a')?.qaInput, '');
  assert.deepEqual(getReaderQaTabSnapshot('reader:a')?.qaAttachments, []);
});

test('reader QA store action identities remain stable across updates', () => {
  resetStore();
  const before = useReaderQaStore.getState();
  const setTabField = before.setTabField;
  before.setTabField('reader:a', 'qaInput', 'changed');
  assert.equal(useReaderQaStore.getState().setTabField, setTabField);
  assert.equal(useReaderQaStore.getState().removeTab, before.removeTab);
});

test('reader QA store updates session arrays without mutating the source', () => {
  resetStore();
  const original = [session('s1')];
  const store = useReaderQaStore.getState();
  store.setTabField('reader:a', 'qaSessions', original);
  store.setTabField('reader:a', 'qaSessions', (current) => [...current, session('s2')]);
  assert.deepEqual(original.map((item) => item.id), ['s1']);
  assert.deepEqual(
    getReaderQaTabSnapshot('reader:a')?.qaSessions.map((item) => item.id),
    ['s1', 's2'],
  );
});
