import assert from 'node:assert/strict';
import test from 'node:test';
import { createScrollRestoreScheduler } from '../src/features/pdf/scrollRestoreScheduler.ts';

function createFrames() {
  let pending: Array<() => void> = [];
  return {
    request(callback: () => void) { pending.push(callback); },
    advance() {
      const callbacks = pending;
      pending = [];
      callbacks.forEach((callback) => callback());
    },
  };
}

test('explicit navigation cancels a restore already waiting for its second frame', () => {
  const frames = createFrames();
  const scheduler = createScrollRestoreScheduler(frames.request);
  let position = 'saved page';
  scheduler.schedule(() => { position = 'old saved page'; });
  frames.advance();
  scheduler.cancel();
  position = 'citation page';
  frames.advance();
  assert.equal(position, 'citation page');
});

test('new restores after manual navigation or document changes remain actionable', () => {
  const frames = createFrames();
  const scheduler = createScrollRestoreScheduler(frames.request);
  const applied: string[] = [];
  scheduler.schedule(() => applied.push('old document'));
  scheduler.cancel();
  scheduler.schedule(() => applied.push('new document'));
  frames.advance();
  frames.advance();
  assert.deepEqual(applied, ['new document']);
  scheduler.cancel();
  scheduler.schedule(() => applied.push('later external position'));
  frames.advance();
  frames.advance();
  assert.deepEqual(applied, ['new document', 'later external position']);
});
