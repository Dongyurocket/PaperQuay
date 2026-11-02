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
