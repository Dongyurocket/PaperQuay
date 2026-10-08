import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentChatErrorMessage } from '../src/services/agentError.ts';

test('Agent chat network errors become actionable localized messages', () => {
  assert.equal(
    normalizeAgentChatErrorMessage(
      "Error invoking remote method 'paperquay:invoke': Error: AGENT_MODEL_NETWORK_ERROR (ENOTFOUND): Unable to reach https://example.com.",
      'fallback',
    ),
    '无法连接模型服务。请检查模型 Base URL、API Key、网络连接或代理设置，然后重试。',
  );
});

test('Agent chat preserves server HTTP errors instead of calling them network failures', () => {
  const message = 'OpenAI-compatible agent stream HTTP 401: invalid API key';
  assert.equal(normalizeAgentChatErrorMessage(message, 'fallback'), message);
});
