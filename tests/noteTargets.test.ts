import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { paperExists } = require('../electron/backend/noteCommands.cjs');

/**
 * 第 10 批 minor：`native-library:` 前缀后必须带文库主键；
 * 空 id 不能被当成 global-notes 而放行。
 */
test('paperExists rejects an empty native-library target', () => {
  assert.equal(paperExists({}, 'native-library:'), false);
  assert.equal(paperExists({}, 'native-library:   '), false);
  assert.equal(paperExists({}, ''), true, 'an absent paperId still means global notes');
  assert.equal(paperExists({}, 'global-notes'), true);
  assert.equal(paperExists({}, 'standalone:C:\\papers\\local.pdf'), true);
});

test('paperExists resolves native-library targets through the library store', () => {
  const context = {
    store: {
      getPaper: (id: string) => (id === 'paper-1' ? { id } : null),
    },
  };

  assert.equal(paperExists(context, 'native-library:paper-1'), true);
  assert.equal(paperExists(context, 'native-library:paper-2'), false);
  assert.equal(paperExists(context, 'paper-1'), true);
  assert.equal(paperExists({ store: { getPaper: () => { throw new Error('db down'); } } }, 'native-library:paper-1'), false);
});
