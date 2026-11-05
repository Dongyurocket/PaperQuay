import test from 'node:test';
import assert from 'node:assert/strict';

import {
  removeQaSession,
  removeFailedQaAssistantPlaceholder,
  resolveActiveQaSession,
  resolveQaModelPreset,
  resolveQaSessionSelection,
} from '../src/features/reader/documentReaderQaSessions.ts';
import type { DocumentChatSession, QaModelPreset } from '../src/types/reader.ts';

function session(id: string): DocumentChatSession {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  };
}

function preset(id: string): QaModelPreset {
  return {
    id,
    label: id,
    baseUrl: 'https://api.example.test',
    apiKey: 'key',
    model: 'model',
    apiMode: 'chat_completions',
  };
}

test('resolveActiveQaSession falls back to the first session', () => {
  const sessions = [session('s1'), session('s2')];

  assert.equal(resolveActiveQaSession(sessions, 's2')?.id, 's2');
  assert.equal(resolveActiveQaSession(sessions, 'missing')?.id, 's1');
  assert.equal(resolveActiveQaSession([], 'missing'), null);
});

test('resolveQaSessionSelection only returns explicit existing sessions', () => {
  const sessions = [session('s1')];

  assert.equal(resolveQaSessionSelection(sessions, 's1')?.id, 's1');
  assert.equal(resolveQaSessionSelection(sessions, 'missing'), null);
  assert.equal(resolveQaSessionSelection(sessions, ''), null);
});

test('removeQaSession removes existing sessions and reports fallback selection', () => {
  const removedMiddle = removeQaSession(
    [session('s1'), session('s2'), session('s3')],
    's2',
    () => session('fallback'),
  );

  assert.equal(removedMiddle.removed, true);
  assert.deepEqual(removedMiddle.sessions.map((item) => item.id), ['s1', 's3']);
  assert.equal(removedMiddle.selectedSessionId, 's1');

  const removedLast = removeQaSession([session('s1')], 's1', () => session('fallback'));

  assert.equal(removedLast.removed, true);
  assert.deepEqual(removedLast.sessions.map((item) => item.id), ['fallback']);
  assert.equal(removedLast.selectedSessionId, 'fallback');
});

test('removeQaSession leaves unknown ids unchanged', () => {
  const sessions = [session('s1')];
  const result = removeQaSession(sessions, 'missing', () => session('fallback'));

  assert.equal(result.removed, false);
  assert.equal(result.sessions, sessions);
});

test('failed first answer retains question, attachments and session metadata without mutation', () => {
  const user = { id: 'question', role: 'user' as const, content: 'Question', createdAt: 2,
    attachments: [{ id: 'file', kind: 'file' as const, name: 'context.txt', mimeType: 'text/plain', size: 15, textContent: 'runtime content' }] };
  const placeholder = { id: 'pending', role: 'assistant' as const, content: ' \n\t', createdAt: 3 };
  const target = { ...session('s1'), title: 'Question title', updatedAt: 3, messages: [user, placeholder] };
  const other = session('s2');
  const sessions = [target, other];
  const snapshot = structuredClone(sessions);
  const result = removeFailedQaAssistantPlaceholder(sessions, 's1', 'pending');
  assert.deepEqual(sessions, snapshot);
  assert.notEqual(result, sessions);
  assert.equal(result[1], other);
  assert.deepEqual(result[0], { ...target, messages: [user], updatedAt: 2 });
  assert.equal(result[0].messages[0], user);
  assert.equal(result[0].messages[0].attachments, user.attachments);
});

test('failed answer cleanup preserves current history and targets only the supplied id', () => {
  const history = { id: 'history', role: 'assistant' as const, content: 'Earlier answer', createdAt: 2 };
  const user = { id: 'question', role: 'user' as const, content: 'Next question', createdAt: 4 };
  const pending = { id: 'pending', role: 'assistant' as const, content: '', createdAt: 5 };
  const newer = { id: 'newer', role: 'user' as const, content: 'Current state', createdAt: 6 };
  const target = { ...session('s1'), updatedAt: 6, messages: [history, user, pending, newer] };
  const result = removeFailedQaAssistantPlaceholder([target], 's1', 'pending');
  assert.deepEqual(result[0].messages, [history, user, newer]);
  assert.equal(result[0].updatedAt, 6);
  assert.equal(result[0].messages[0], history);
});

test('failed answer cleanup is a reference-preserving no-op for missing or nonempty targets', () => {
  for (const message of [
    { id: 'pending', role: 'assistant' as const, content: 'Partial answer', createdAt: 2 },
    { id: 'pending', role: 'user' as const, content: '', createdAt: 2 },
  ]) {
    const sessions = [{ ...session('s1'), messages: [message] }];
    assert.equal(removeFailedQaAssistantPlaceholder(sessions, 'missing', 'pending'), sessions);
    assert.equal(removeFailedQaAssistantPlaceholder(sessions, 's1', 'missing'), sessions);
    assert.equal(removeFailedQaAssistantPlaceholder(sessions, 's1', 'pending'), sessions);
  }
  const empty: DocumentChatSession[] = [];
  assert.equal(removeFailedQaAssistantPlaceholder(empty, 'missing', 'pending'), empty);
});

test('removing a sole empty placeholder uses the session creation time', () => {
  const target = { ...session('s1'), updatedAt: 3,
    messages: [{ id: 'pending', role: 'assistant' as const, content: '', createdAt: 3 }] };
  const result = removeFailedQaAssistantPlaceholder([target], 's1', 'pending');
  assert.deepEqual(result[0].messages, []);
  assert.equal(result[0].updatedAt, target.createdAt);
});

test('resolveQaModelPreset returns requested preset or first fallback', () => {
  const presets = [preset('p1'), preset('p2')];

  assert.equal(resolveQaModelPreset(presets, 'p2')?.id, 'p2');
  assert.equal(resolveQaModelPreset(presets, 'missing')?.id, 'p1');
  assert.equal(resolveQaModelPreset([], 'missing'), null);
});
