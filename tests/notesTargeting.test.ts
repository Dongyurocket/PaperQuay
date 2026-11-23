import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveNextActiveNoteId,
  shouldNotifyExternalNoteChange,
} from '../src/stores/notesSelection.ts';

test('searching notes does not rebind the open editor to the first result', () => {
  const filtered = [{ id: 'search-hit' }, { id: 'another-hit' }];

  // 已经打开的笔记 A 不在搜索结果里：保持 A，而不是跳到第一条命中。
  assert.equal(resolveNextActiveNoteId('note-a', filtered), 'note-a');
  assert.equal(resolveNextActiveNoteId('note-a', []), 'note-a');
});

test('an unset selection falls back to the first note in the list', () => {
  assert.equal(resolveNextActiveNoteId(null, [{ id: 'first' }, { id: 'second' }]), 'first');
  assert.equal(resolveNextActiveNoteId(null, []), null);
});

test('external note writes only notify notes whose version actually changed', () => {
  assert.equal(shouldNotifyExternalNoteChange({ updatedAt: 10 }, { updatedAt: 10 }), false);
  assert.equal(shouldNotifyExternalNoteChange({ updatedAt: 10 }, { updatedAt: 11 }), true);
  assert.equal(shouldNotifyExternalNoteChange(undefined, { updatedAt: 11 }), false);
  assert.equal(shouldNotifyExternalNoteChange(null, { updatedAt: 11 }), false);
});
