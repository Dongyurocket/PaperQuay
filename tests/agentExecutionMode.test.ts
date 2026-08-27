import test from 'node:test';
import assert from 'node:assert/strict';

import { selectLibraryAgentExecutionPath } from '../src/services/agentExecutionMode.ts';

test('Agent execution uses the ReAct path by default and preserves the legacy fallback', () => {
  assert.equal(selectLibraryAgentExecutionPath(undefined), 'react');
  assert.equal(selectLibraryAgentExecutionPath({}), 'react');
  assert.equal(selectLibraryAgentExecutionPath({ agentLegacyMode: false }), 'react');
  assert.equal(selectLibraryAgentExecutionPath({ agentLegacyMode: true }), 'legacy');
});
