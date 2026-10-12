import test from 'node:test';
import assert from 'node:assert/strict';

import { createQaPreset, normalizeModelTemperature } from '../src/features/reader/readerShared.ts';
import {
  createPresetNumberDraft,
  reducePresetNumberDraft,
  type PresetNumberDraft,
} from '../src/features/reader/presetNumberDraft.ts';

function typeThenCommit(
  keystrokes: string[],
  normalize: (value: number | undefined) => number | undefined,
  external?: number,
) {
  let state = createPresetNumberDraft(external);
  let commits = 0;

  for (const text of keystrokes) {
    const next = reducePresetNumberDraft(state, { type: 'change', text });
    assert.equal(next.didCommit, false);
    commits += next.didCommit ? 1 : 0;
    state = next.state;
  }

  const committed = reducePresetNumberDraft(state, { type: 'commit', normalize });
  return { state: committed.state, committed: committed.committed, commits: commits + 1 };
}

test('preset number draft keeps intermediate keystrokes out of persistence', () => {
  const typed = typeThenCommit(
    ['1', '12', '128', '1280', '12800', '128000'],
    (value) => createQaPreset({ contextWindow: value }).contextWindow,
  );

  assert.equal(typed.commits, 1);
  assert.equal(typed.committed, 128000);
  assert.equal(typed.state.text, '128000');
  assert.equal(typed.state.editing, false);
});

test('preset number draft clamps below the context window minimum on commit', () => {
  const typed = typeThenCommit(
    ['1'],
    (value) => createQaPreset({ contextWindow: value }).contextWindow,
  );

  assert.equal(typed.committed, 4096);
  assert.equal(typed.state.text, '4096');
});

test('preset number draft clears to undefined and clamps max output on commit', () => {
  const cleared = typeThenCommit(
    ['8192', ''],
    (value) => createQaPreset({ maxOutputTokens: value }).maxOutputTokens,
    8192,
  );
  assert.equal(cleared.committed, undefined);
  assert.equal(cleared.state.text, '');

  const clamped = typeThenCommit(
    ['1'],
    (value) => createQaPreset({ maxOutputTokens: value }).maxOutputTokens,
  );
  assert.equal(clamped.committed, 256);
  assert.equal(clamped.state.text, '256');
});

test('preset number draft does not normalize temperature until commit', () => {
  let state = createPresetNumberDraft(undefined);
  for (const text of ['0', '0.', '0.1']) {
    const next = reducePresetNumberDraft(state, { type: 'change', text });
    assert.equal(next.didCommit, false);
    assert.equal(next.state.text, text);
    state = next.state;
  }

  const committed = reducePresetNumberDraft(state, {
    type: 'commit',
    normalize: normalizeModelTemperature,
  });
  assert.equal(committed.committed, 0.1);
  assert.equal(committed.state.text, '0.1');

  const tooHigh = typeThenCommit(['3'], normalizeModelTemperature);
  assert.equal(tooHigh.committed, 2);
  assert.equal(tooHigh.state.text, '2');
});

test('editing a preset number draft ignores external sync and reset discards it', () => {
  let state: PresetNumberDraft = reducePresetNumberDraft(
    createPresetNumberDraft(8192),
    { type: 'change', text: '12' },
  ).state;

  const synced = reducePresetNumberDraft(state, { type: 'sync', value: 128000 });
  assert.equal(synced.state.text, '12');
  assert.equal(synced.state.editing, true);

  const reset = reducePresetNumberDraft(synced.state, { type: 'reset', value: 128000 });
  assert.equal(reset.state.text, '128000');
  assert.equal(reset.state.editing, false);
});
