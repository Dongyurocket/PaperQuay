import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { modelRequestError } = require('../electron/backend/utils.cjs');

for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET']) {
  test(`model fetch diagnostics retain ${code} without request secrets`, () => {
    const error = modelRequestError(
      { name: 'TypeError', message: 'fetch failed', cause: { code } },
      'https://user:secret@example.com/private?api_key=secret',
    );
    assert.match(error.message, /AGENT_MODEL_NETWORK_ERROR/);
    assert.match(error.message, new RegExp(code));
    assert.match(error.message, /https:\/\/example.com/);
    assert.doesNotMatch(error.message, /secret|private|api_key|user:/);
  });
}

test('model fetch timeout and user cancellation remain distinct', () => {
  const timeout = modelRequestError({ name: 'TimeoutError' }, 'https://example.com');
  assert.match(timeout.message, /AGENT_MODEL_TIMEOUT/);
  const controller = new AbortController();
  controller.abort();
  const cancelled = modelRequestError({ name: 'AbortError' }, 'https://example.com', controller.signal);
  assert.equal(cancelled.name, 'AbortError');
  assert.match(cancelled.message, /AGENT_MODEL_ABORTED/);
});
