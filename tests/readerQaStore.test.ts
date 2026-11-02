import test from 'node:test';
import assert from 'node:assert/strict';

import { useReaderQaStore } from '../src/stores/useReaderQaStore.ts';
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

function resetStore() {
  useReaderQaStore.setState({
    qaSessions: [],
    selectedQaSessionId: '',
    qaInput: '',
    qaAttachments: [],
    selectedQaPresetId: '',
    qaRagEnabled: true,
    qaAnswerRenderMode: 'markdown',
    qaReasoningEffort: 'auto',
    qaRunningSessionIds: [],
    qaError: '',
  });
}

test('reader QA store exposes the original defaults', () => {
  resetStore();
  const state = useReaderQaStore.getState();

  assert.deepEqual(state.qaSessions, []);
  assert.equal(state.selectedQaSessionId, '');
  assert.equal(state.qaInput, '');
  assert.deepEqual(state.qaAttachments, []);
  assert.equal(state.selectedQaPresetId, '');
  assert.equal(state.qaRagEnabled, true);
  assert.equal(state.qaAnswerRenderMode, 'markdown');
  assert.equal(state.qaReasoningEffort, 'auto');
  assert.deepEqual(state.qaRunningSessionIds, []);
  assert.equal(state.qaError, '');
});

test('reader QA store setters preserve functional updates and shared sessions', () => {
  resetStore();
  const firstReader = useReaderQaStore.getState();
  const sessions = [session('shared-session')];

  firstReader.setQaSessions(sessions);
  firstReader.setSelectedQaSessionId('shared-session');
  firstReader.setQaInput('question');
  firstReader.setQaAttachments([
    { id: 'a1', kind: 'file', name: 'paper.txt', mimeType: 'text/plain', size: 10 },
  ]);
  firstReader.setSelectedQaPresetId('preset-1');
  firstReader.setQaRagEnabled(false);
  firstReader.setQaAnswerRenderMode('html');
  firstReader.setQaReasoningEffort('high');
  firstReader.setQaRunningSessionIds(['shared-session']);
  firstReader.setQaError('failed once');

  firstReader.setQaInput((current) => `${current}!`);
  firstReader.setQaRunningSessionIds((current) => current.filter((id) => id !== 'other'));

  const secondReader = useReaderQaStore.getState();
  assert.equal(secondReader.qaSessions, sessions);
  assert.equal(secondReader.selectedQaSessionId, 'shared-session');
  assert.equal(secondReader.qaInput, 'question!');
  assert.equal(secondReader.qaAttachments[0]?.id, 'a1');
  assert.equal(secondReader.selectedQaPresetId, 'preset-1');
  assert.equal(secondReader.qaRagEnabled, false);
  assert.equal(secondReader.qaAnswerRenderMode, 'html');
  assert.equal(secondReader.qaReasoningEffort, 'high');
  assert.deepEqual(secondReader.qaRunningSessionIds, ['shared-session']);
  assert.equal(secondReader.qaError, 'failed once');
});

test('reader QA store can clear transient input and attachments independently', () => {
  resetStore();
  const state = useReaderQaStore.getState();
  state.setQaInput('draft');
  state.setQaAttachments([{ id: 'a', kind: 'file', name: 'a.txt', mimeType: 'text/plain', size: 1 }]);
  state.setQaInput('');
  state.setQaAttachments([]);
  assert.equal(useReaderQaStore.getState().qaInput, '');
  assert.deepEqual(useReaderQaStore.getState().qaAttachments, []);
});

test('reader QA store action identities remain stable across updates', () => {
  resetStore();
  const before = useReaderQaStore.getState();
  const setInput = before.setQaInput;
  before.setQaInput('changed');
  assert.equal(useReaderQaStore.getState().setQaInput, setInput);
});

test('reader QA store updates session arrays without mutating the source', () => {
  resetStore();
  const original = [session('s1')];
  useReaderQaStore.getState().setQaSessions(original);
  useReaderQaStore.getState().setQaSessions((current) => [...current, session('s2')]);
  assert.deepEqual(original.map((item) => item.id), ['s1']);
  assert.deepEqual(useReaderQaStore.getState().qaSessions.map((item) => item.id), ['s1', 's2']);
});
