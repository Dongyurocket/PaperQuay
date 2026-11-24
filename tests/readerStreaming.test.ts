import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ReaderQaStreamStore,
  buildReaderQaStreamKey,
  buildStreamedQaSession,
  createBoundedStringCache,
  resolveReaderQaStreamAbortCleanup,
  type ReaderQaStreamScheduler,
} from '../src/features/reader/readerAssistantSidebarProps.ts';
import type { DocumentChatMessage, DocumentChatSession } from '../src/types/reader.ts';

function manualScheduler() {
  const queue: Array<() => void> = [];
  const scheduler: ReaderQaStreamScheduler = {
    schedule(callback) {
      queue.push(callback);
      return queue.length;
    },
    cancel() {
      // Manual scheduler: callbacks are drained by flush().
    },
  };

  return {
    scheduler,
    flush() {
      while (queue.length > 0) {
        queue.shift()?.();
      }
    },
    get pending() {
      return queue.length;
    },
  };
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

test('streaming deltas do not rebuild committed history and notify at most once per frame', () => {
  const { scheduler, flush } = manualScheduler();
  const store = new ReaderQaStreamStore({ scheduler, now: () => 50 });
  const history = Array.from({ length: 100 }, (_value, index) =>
    message(`m-${index}`, index % 2 === 0 ? 'user' : 'assistant', `history ${index}`),
  );
  const placeholder = message('m-assistant', 'assistant', '');
  const pending = session('s-a', [...history, placeholder]);
  const pendingMessagesRef = pending.messages;
  const assistantRef = pending.messages[100];

  let notifications = 0;
  const unsubscribe = store.subscribe('s-a', 'm-assistant', () => {
    notifications += 1;
  });

  store.start('s-a', 'm-assistant', { modelId: 'model-a', modelLabel: 'Model A' });
  const startedAt = performance.now();
  for (let index = 0; index < 200; index += 1) {
    store.update('s-a', 'm-assistant', 'x'.repeat(index + 1));
  }
  const deltaHandlingMs = performance.now() - startedAt;

  // No React updates are scheduled until the animation-frame flush.
  assert.equal(notifications, 0);
  flush();
  assert.ok(notifications >= 1, 'the throttle flushes the latest text');
  assert.ok(notifications <= 2, 'deltas collapse into a bounded number of notifications');

  // The committed session object and its messages stay untouched while streaming.
  assert.equal(pending.messages, pendingMessagesRef);
  assert.equal(pending.messages[100], assistantRef);
  assert.equal(store.getSnapshot('s-a', 'm-assistant')?.text.length, 200);

  // Commit exactly once, mirroring useReaderQa's end-of-stream commit.
  let commitCalls = 0;
  const finalAnswer = 'x'.repeat(200);
  const committed = buildStreamedQaSession(pending, history, placeholder, finalAnswer, 200);
  commitCalls += 1;
  store.finish('s-a', 'm-assistant');
  flush();
  unsubscribe();

  assert.equal(commitCalls, 1);
  assert.equal(committed.messages.length, 101);
  assert.equal(committed.messages[100]?.content, finalAnswer);
  assert.equal(committed.messages[100]?.role, 'assistant');
  assert.equal(committed.updatedAt, 200);
  // Completed history keeps object identity, so memoized rows do not re-render.
  for (let index = 0; index < 100; index += 1) {
    assert.equal(committed.messages[index], history[index]);
  }
  assert.equal(store.getSnapshot('s-a', 'm-assistant'), null);

  if (process.env.PAPERQUAY_PERF === '1') {
    console.log(
      `[reader-streaming] 100 history messages + 200 deltas: ${deltaHandlingMs.toFixed(2)} ms ` +
        `(${((deltaHandlingMs / 200) * 1000).toFixed(1)} µs/delta), notifications=${notifications}, commits=${commitCalls}`,
    );
  }
});

test('abort cleanup rules commit a partial answer and remove an empty placeholder', () => {
  assert.equal(
    resolveReaderQaStreamAbortCleanup({ aborted: true, sameGeneration: true, streamedAnswer: 'partial' }),
    'commit-partial',
  );
  assert.equal(
    resolveReaderQaStreamAbortCleanup({ aborted: true, sameGeneration: true, streamedAnswer: '   ' }),
    'remove-placeholder',
  );
  assert.equal(
    resolveReaderQaStreamAbortCleanup({ aborted: true, sameGeneration: false, streamedAnswer: 'partial' }),
    'discard',
  );
  assert.equal(
    resolveReaderQaStreamAbortCleanup({ aborted: false, sameGeneration: true, streamedAnswer: 'partial' }),
    'none',
  );

  const history = [message('m-user', 'user', 'question')];
  const placeholder = message('m-assistant', 'assistant', '');
  const committed = buildStreamedQaSession(session('s-a', [...history, placeholder]), history, placeholder, 'partial answer', 90);
  assert.equal(committed.messages.at(-1)?.content, 'partial answer');
});

test('an in-flight stream keeps targeting its own session while another tab is selected', () => {
  const { scheduler, flush } = manualScheduler();
  const store = new ReaderQaStreamStore({ scheduler, now: () => 1 });
  let sessionANotifications = 0;
  let sessionBNotifications = 0;
  store.subscribe('s-a', 'm-a', () => {
    sessionANotifications += 1;
  });
  store.subscribe('s-b', 'm-b', () => {
    sessionBNotifications += 1;
  });

  store.update('s-a', 'm-a', 'answer for tab A');
  // Selecting session B (another tab) performs no mutation on A's stream.
  flush();
  assert.equal(store.getSnapshot('s-a', 'm-a')?.text, 'answer for tab A');
  assert.equal(store.getSnapshot('s-b', 'm-b'), null);
  assert.ok(sessionANotifications >= 1);
  assert.equal(sessionBNotifications, 0);
});

test('stream keys are session-scoped so equal message ids do not collide', () => {
  assert.notEqual(buildReaderQaStreamKey('s-a', 'm-1'), buildReaderQaStreamKey('s-b', 'm-1'));
  const { scheduler } = manualScheduler();
  const store = new ReaderQaStreamStore({ scheduler });
  store.update('s-a', 'm-1', 'A');
  store.update('s-b', 'm-1', 'B');
  assert.equal(store.getSnapshot('s-a', 'm-1')?.text, 'A');
  assert.equal(store.getSnapshot('s-b', 'm-1')?.text, 'B');
});

test('bounded string cache evicts least-recently-used entries and respects character budgets', () => {
  const cache = createBoundedStringCache({ maxEntries: 2, maxCharacters: 20 });
  cache.set('a', 'one');
  cache.set('b', 'two');
  assert.equal(cache.get('a'), 'one'); // refresh recency of a
  cache.set('c', 'three');
  assert.equal(cache.size, 2);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 'one');
  assert.equal(cache.get('c'), 'three');

  const charBounded = createBoundedStringCache({ maxEntries: 10, maxCharacters: 4 });
  charBounded.set('long', '12345');
  assert.equal(charBounded.size, 0, 'entries larger than the budget are skipped');
  charBounded.set('x', '1234');
  charBounded.set('y', '56');
  assert.equal(charBounded.size, 1);
  assert.equal(charBounded.get('x'), undefined);
  assert.equal(charBounded.get('y'), '56');
});

test('useReaderQa keeps deltas out of qaSessions and commits once at the end', () => {
  const hookSource = readFileSync(
    path.join(process.cwd(), 'src/features/reader/hooks/useReaderQa.ts'),
    'utf8',
  );
  const deltaStart = hookSource.indexOf('const updateStreamingAnswer');
  const deltaEnd = hookSource.indexOf('const answer = await askDocumentOpenAICompatibleStream');
  assert.ok(deltaStart >= 0 && deltaEnd > deltaStart, 'streaming delta handler is present');
  const deltaBody = hookSource.slice(deltaStart, deltaEnd);
  assert.doesNotMatch(deltaBody, /setQaSessions/, 'deltas must not rebuild sessions');
  assert.match(deltaBody, /readerQaStreamStore\.update\(/);

  assert.match(hookSource, /readerQaStreamStore\.start\(/);
  assert.match(hookSource, /readerQaStreamStore\.finish\(/);
  assert.match(hookSource, /buildStreamedQaSession\(/, 'final answer is committed through the helper');

  const chatSource = readFileSync(
    path.join(process.cwd(), 'src/features/reader/assistantSidebarChat.tsx'),
    'utf8',
  );
  assert.match(chatSource, /useSyncExternalStore/, 'the streaming bubble subscribes to its own slice');
  assert.match(chatSource, /memo\(/, 'history rows are memoized');
  assert.match(chatSource, /cacheNormalization=\{!isStreaming\}/, 'streaming content bypasses the markdown cache');

  const primitivesSource = readFileSync(
    path.join(process.cwd(), 'src/features/reader/assistantSidebarPrimitives.tsx'),
    'utf8',
  );
  assert.match(primitivesSource, /readerMarkdownNormalizationCache/);
});
