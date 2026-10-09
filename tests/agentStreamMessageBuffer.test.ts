import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentStreamMessageBuffer } from '../src/features/agent/agentStreamMessageBuffer.ts';

function harness() {
  let clock = 0;
  let isActive = true;
  let nextTimer = 0;
  let message = { content: 'Pending', thinking: '', meta: 'Running', error: undefined as string | undefined };
  const scheduled = new Map<number, () => void>();
  const queuedUpdates: Array<() => void> = [];
  const buffer = createAgentStreamMessageBuffer({
    isActive: () => isActive,
    now: () => clock,
    schedule: (callback) => { nextTimer += 1; scheduled.set(nextTimer, callback); return nextTimer; },
    cancel: (timer) => { scheduled.delete(timer); },
    commit: (draft, canApply) => {
      queuedUpdates.push(() => {
        if (!canApply()) return;
        message = { ...message, content: draft.answer || message.content, thinking: draft.thinking || message.thinking, meta: 'Streaming', error: undefined };
      });
    },
  });
  return {
    buffer, scheduled, queuedUpdates,
    message: () => message,
    advance: (value: number) => { clock += value; },
    switchAway: () => { isActive = false; },
    applyUpdates: () => { queuedUpdates.splice(0).forEach((apply) => apply()); },
    settle: (meta: string) => { buffer.close(); message = { content: 'Final answer', thinking: 'Final thinking', meta, error: meta === 'Failed' ? 'Failed' : undefined }; },
  };
}

test('queued stream drafts and late answer or thinking deltas cannot replace any final state', () => {
  for (const meta of ['Completed', 'Partial', 'Failed', 'Cancelled', 'Awaiting approval']) {
    const state = harness();
    state.buffer.startTurn(1);
    state.buffer.receiveAnswer('First draft', 1);
    state.advance(10);
    state.buffer.receiveThinking('Draft thinking', 1);
    const lateTimer = [...state.scheduled.values()][0];
    assert.equal(state.scheduled.size, 1);
    state.settle(meta);
    state.buffer.receiveAnswer('Late answer', 1);
    state.buffer.receiveThinking('Late thinking', 1);
    lateTimer();
    state.applyUpdates();
    assert.equal(state.scheduled.size, 0);
    assert.deepEqual(state.message(), { content: 'Final answer', thinking: 'Final thinking', meta, error: meta === 'Failed' ? 'Failed' : undefined });
  }
});

test('a retry in the same turn invalidates queued text without hiding the new draft', () => {
  const state = harness();
  state.buffer.startTurn(1);
  state.buffer.receiveAnswer('Discarded answer', 1);
  state.buffer.startTurn(1);
  state.advance(120);
  state.buffer.receiveThinking('Current thinking', 1);
  state.buffer.receiveAnswer('Current answer', 1);
  const timer = [...state.scheduled.values()][0];
  state.advance(120);
  timer();
  state.applyUpdates();
  assert.deepEqual(state.message(), { content: 'Current answer', thinking: 'Current thinking', meta: 'Streaming', error: undefined });
});

test('a tool-call turn discards queued prose and cannot flush it into the next turn', () => {
  const state = harness();
  state.buffer.startTurn(1);
  state.buffer.receiveAnswer('I will search first', 1);
  state.buffer.discardTurn();
  state.applyUpdates();
  assert.equal(state.message().content, 'Pending');
  state.buffer.startTurn(2);
  state.buffer.receiveAnswer('Wrong previous-turn answer', 1);
  state.advance(120);
  state.buffer.receiveAnswer('Second turn answer', 2);
  state.applyUpdates();
  assert.equal(state.message().content, 'Second turn answer');
});

test('switching away before queued updates are applied leaves the other chat unchanged', () => {
  const state = harness();
  state.buffer.receiveAnswer('Scope-local draft');
  state.switchAway();
  state.applyUpdates();
  assert.equal(state.message().content, 'Pending');
});
