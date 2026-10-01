import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeQaModelPreset } from '../src/features/reader/readerShared.ts';
import utils from '../electron/backend/utils.cjs';

const { openAiChat } = utils;

test('normalizeQaModelPreset normalizes maxOutputTokens correctly', () => {
  // 正常范围
  const preset1 = normalizeQaModelPreset({ maxOutputTokens: 4096 });
  assert.equal(preset1.maxOutputTokens, 4096);

  // 浮点数截断
  const preset2 = normalizeQaModelPreset({ maxOutputTokens: 2048.8 });
  assert.equal(preset2.maxOutputTokens, 2048);

  // 小于最小值 256
  const preset3 = normalizeQaModelPreset({ maxOutputTokens: 50 });
  assert.equal(preset3.maxOutputTokens, 256);

  // 大于最大值 200,000
  const preset4 = normalizeQaModelPreset({ maxOutputTokens: 500000 });
  assert.equal(preset4.maxOutputTokens, 200000);

  // 未指定或非法值返回 undefined
  const preset5 = normalizeQaModelPreset({});
  assert.equal(preset5.maxOutputTokens, undefined);

  const preset6 = normalizeQaModelPreset({ maxOutputTokens: NaN });
  assert.equal(preset6.maxOutputTokens, undefined);
});

test('openAiChat builds max_tokens for chat_completions and max_output_tokens for responses', async () => {
  let capturedBody: any = null;

  // Mock global fetch to inspect request body
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    // 1. chat_completions 模式
    await openAiChat(
      {
        baseUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'test-model',
        apiMode: 'chat_completions',
        maxOutputTokens: 8192,
      },
      [{ role: 'user', content: 'hello' }],
      { stream: false },
    );

    assert.equal(capturedBody.max_tokens, 8192);
    assert.equal(capturedBody.max_output_tokens, undefined);

    // 2. responses 模式
    await openAiChat(
      {
        baseUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'test-model',
        apiMode: 'responses',
        maxOutputTokens: 4096,
      },
      [{ role: 'user', content: 'hello' }],
      { stream: false },
    );

    assert.equal(capturedBody.max_output_tokens, 4096);
    assert.equal(capturedBody.max_tokens, undefined);

    // 3. 未配置 maxOutputTokens 时不应出现字段
    await openAiChat(
      {
        baseUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'test-model',
        apiMode: 'chat_completions',
      },
      [{ role: 'user', content: 'hello' }],
      { stream: false },
    );

    assert.equal('max_tokens' in capturedBody, false);
    assert.equal('max_output_tokens' in capturedBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
