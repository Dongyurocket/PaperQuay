import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');

function createContext() {
  return {
    agentMemoryStore: {},
    store: { load: () => ({ papers: [] }) },
    ragStore: {},
  };
}

function distillOptions() {
  return {
    baseUrl: 'https://example.test/v1',
    apiKey: 'chat-key',
    model: 'chat-model',
    text: 'We propose a gated KV store that improves retrieval by 12.4%.',
    paperTitle: 'KVNet: A Study',
    pageLabel: 'P3',
  };
}

test('note distill returns title + distilled markdown and forwards paper context', async (t) => {
  let capturedBody: Record<string, unknown> | null = null;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(String(init.body));
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            title: '门控 KV 存储提升检索 12.4%',
            text: '提出一种门控 KV 存储，使检索指标提升 **12.4%**。',
          }),
        },
      }],
    });
  });

  const commands = createAiCommands(createContext());
  const result = await commands.notes_distill_excerpt_openai_compatible({ options: distillOptions() });

  assert.equal(result.title, '门控 KV 存储提升检索 12.4%');
  assert.match(result.text, /12\.4%/);

  const messages = (capturedBody as { messages?: { role: string; content: string }[] }).messages ?? [];
  const userMessage = messages.find((message) => message.role === 'user');
  const payload = JSON.parse(userMessage?.content ?? '{}');
  assert.equal(payload.paperTitle, 'KVNet: A Study');
  assert.equal(payload.pageLabel, 'P3');
  assert.match(payload.excerpt, /gated KV store/);
});

test('note distill falls back to plain text when a provider ignores JSON mode', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: '<think>hidden</think>\nDistilled plain text.' } }],
  }));

  const commands = createAiCommands(createContext());
  const result = await commands.notes_distill_excerpt_openai_compatible({ options: distillOptions() });

  assert.equal(result.title, '');
  assert.equal(result.text, 'Distilled plain text.');
});

test('note distill rejects empty excerpts without calling the model', async (t) => {
  let fetchCalled = false;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalled = true;
    return Response.json({});
  });

  const commands = createAiCommands(createContext());
  await assert.rejects(
    commands.notes_distill_excerpt_openai_compatible({ options: { ...distillOptions(), text: '  ' } }),
    /选中需要提炼的内容/,
  );
  assert.equal(fetchCalled, false);
});
