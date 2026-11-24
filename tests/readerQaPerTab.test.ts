import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  getReaderQaAbortControllers,
  getReaderQaTabSnapshot,
  removeReaderQaTab,
  useReaderQaStore,
} from '../src/stores/useReaderQaStore.ts';
import { stripEmptyAssistantMessages } from '../src/features/reader/documentReaderQaSessions.ts';
import { ReaderQaStreamStore } from '../src/features/reader/readerAssistantSidebarProps.ts';
import type { DocumentChatMessage, DocumentChatSession } from '../src/types/reader.ts';

function resetStore(): void {
  useReaderQaStore.setState({ tabs: {} });
}

function message(
  id: string,
  role: DocumentChatMessage['role'],
  content: string,
): DocumentChatMessage {
  return { id, role, content, createdAt: 1 };
}

function session(id: string, messages: DocumentChatMessage[] = []): DocumentChatSession {
  return { id, title: id, createdAt: 1, updatedAt: 1, messages };
}

test('drafts are sharded per reader tab and survive switching away and back', () => {
  resetStore();
  const store = useReaderQaStore.getState();

  store.setTabField('reader:a', 'qaInput', 'draft A');
  store.setTabField('reader:a', 'qaAttachments', [{
    id: 'att-a',
    kind: 'file',
    name: 'a.txt',
    mimeType: 'text/plain',
    size: 1,
  }]);

  // Switching to B reads a different slice; A is untouched.
  assert.equal(getReaderQaTabSnapshot('reader:b')?.qaInput ?? '', '');
  assert.equal(getReaderQaTabSnapshot('reader:a')?.qaInput, 'draft A');

  store.setTabField('reader:b', 'qaInput', 'draft B');
  assert.equal(getReaderQaTabSnapshot('reader:a')?.qaInput, 'draft A');
  assert.equal(getReaderQaTabSnapshot('reader:b')?.qaInput, 'draft B');
  assert.deepEqual(
    getReaderQaTabSnapshot('reader:a')?.qaAttachments.map((item) => item.id),
    ['att-a'],
  );
});

test('an in-flight answer keeps streaming into its own tab after switching tabs', () => {
  resetStore();
  const store = useReaderQaStore.getState();
  const pending = session('s-a', [message('m-user', 'user', 'question'), message('m-assistant', 'assistant', '')]);
  store.setTabField('reader:a', 'qaSessions', [pending]);
  store.setTabField('reader:a', 'qaRunningSessionIds', ['s-a']);

  // Switching to B performs no store mutation on A; it may create its own slice.
  store.setTabField('reader:b', 'qaInput', 'draft B');
  assert.deepEqual(getReaderQaTabSnapshot('reader:a')?.qaRunningSessionIds, ['s-a']);
  assert.deepEqual(getReaderQaTabSnapshot('reader:b')?.qaRunningSessionIds, []);

  // The background stream continues appending to A's session.
  store.setTabField('reader:a', 'qaSessions', (current) => current.map((item) => ({
    ...item,
    messages: item.messages.map((entry) => entry.id === 'm-assistant'
      ? { ...entry, content: 'streamed answer' }
      : entry),
  })));
  store.setTabField('reader:a', 'qaRunningSessionIds', []);

  assert.equal(
    getReaderQaTabSnapshot('reader:a')?.qaSessions[0]?.messages[1]?.content,
    'streamed answer',
  );
  assert.deepEqual(getReaderQaTabSnapshot('reader:a')?.qaRunningSessionIds, []);
  assert.equal(getReaderQaTabSnapshot('reader:b')?.qaSessions.length, 0);
});

test('background streaming stays sharded to the tab session after switching tabs', () => {
  resetStore();
  const store = useReaderQaStore.getState();
  const streamStore = new ReaderQaStreamStore({
    scheduler: { schedule: () => 0, cancel: () => undefined },
  });
  store.setTabField('reader:a', 'qaSessions', [
    session('s-a', [message('m-user', 'user', 'question'), message('m-assistant', 'assistant', '')]),
  ]);
  store.setTabField('reader:a', 'qaRunningSessionIds', ['s-a']);

  streamStore.update('s-a', 'm-assistant', 'streamed answer');

  // Switching to tab B neither moves nor clears tab A's transient stream slice.
  store.setTabField('reader:b', 'qaInput', 'draft B');
  assert.equal(streamStore.getSnapshot('s-a', 'm-assistant')?.text, 'streamed answer');
  assert.equal(streamStore.getSnapshot('s-b', 'm-assistant'), null);
  assert.deepEqual(getReaderQaTabSnapshot('reader:a')?.qaRunningSessionIds, ['s-a']);
  assert.deepEqual(getReaderQaTabSnapshot('reader:b')?.qaRunningSessionIds, []);
});

test('empty assistant placeholders are filtered before persistence', () => {
  const sessions = [
    session('s-a', [
      message('m-user', 'user', 'question'),
      message('m-empty', 'assistant', ''),
      message('m-space', 'assistant', '   '),
      message('m-answer', 'assistant', 'answer'),
    ]),
    session('s-b', [message('m-user-2', 'user', '')]),
  ];

  const persisted = stripEmptyAssistantMessages(sessions);

  assert.deepEqual(persisted[0]?.messages.map((item) => item.id), ['m-user', 'm-answer']);
  assert.deepEqual(persisted[1]?.messages.map((item) => item.id), ['m-user-2']);
  // Non-empty sessions keep their original object identity.
  assert.equal(persisted[1], sessions[1]);

  const documentReaderHook = readFileSync(
    path.join(process.cwd(), 'src/features/reader/hooks/useReaderDocument.ts'),
    'utf8',
  );
  assert.match(documentReaderHook, /qaSessions: stripEmptyAssistantMessages\(qaSessionsRef\.current\)/);
});

test('closing a tab removes only that tab slice and aborts only its answers', () => {
  resetStore();
  const store = useReaderQaStore.getState();
  store.setTabField('reader:a', 'qaInput', 'draft A');
  store.setTabField('reader:b', 'qaInput', 'draft B');

  const controllerA = new AbortController();
  const controllerB = new AbortController();
  getReaderQaAbortControllers('reader:a').set('s-a', controllerA);
  getReaderQaAbortControllers('reader:b').set('s-b', controllerB);

  removeReaderQaTab('reader:a');

  assert.equal(getReaderQaTabSnapshot('reader:a'), undefined);
  assert.equal(getReaderQaTabSnapshot('reader:b')?.qaInput, 'draft B');
  assert.equal(controllerA.signal.aborted, true);
  assert.equal(controllerB.signal.aborted, false);
  assert.deepEqual([...getReaderQaAbortControllers('reader:b').keys()], ['s-b']);
});
