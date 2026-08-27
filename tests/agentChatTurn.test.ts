import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');

function sseResponse(chunks: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function context() {
  const fail = () => { throw new Error('unexpected storage call'); };
  return {
    ragStore: {
      createAgentRun: fail,
      appendAgentRunEvent: fail,
      finishAgentRun: fail,
      getAgentRun: fail,
      getAgentRunEvents: fail,
      listInterruptedAgentRuns: fail,
      listAgentRunUsageBySession: fail,
      indexDocument: fail,
      reportFailure: fail,
      getDocumentIndexStatus: fail,
      retrieveDocumentChunks: fail,
    },
    agentMemoryStore: {
      appendTrace: fail,
      listMemory: fail,
      readMemory: fail,
      writeMemory: fail,
      clearMemory: fail,
    },
  };
}

test('agent_chat_turn streams tool calls and usage through the shared Agent event channel', async (t) => {
  const requests: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')));
    return sseResponse([
      {
        id: 'chat-1',
        object: 'chat.completion.chunk',
        model: 'test-model',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call-1',
              type: 'function',
              function: { name: 'search_library', arguments: '{"query":"RAG' },
            }],
          },
          finish_reason: null,
        }],
      },
      {
        id: 'chat-1',
        object: 'chat.completion.chunk',
        model: 'test-model',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      },
    ]);
  });
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const commands = createAiCommands(context());
  const result = await commands.agent_chat_turn({
    request: {
      requestId: 'request-1',
      options: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'test-model',
        apiMode: 'chat_completions',
      },
      messages: [{ role: 'user', content: 'Find RAG papers.' }],
      tools: [{
        type: 'function',
        function: {
          name: 'search_library',
          description: 'Search',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      }],
      toolChoice: 'auto',
      stream: true,
    },
  }, {
    sender: {
      send(_channel: string, name: string, payload: Record<string, unknown>) {
        events.push({ name, payload });
      },
    },
  });

  assert.equal(requests.length, 1);
  assert.equal((requests[0]?.messages as Array<Record<string, unknown>>)?.[0]?.role, 'system');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.id, 'call-1');
  assert.equal(result.toolCalls[0]?.name, 'search_library');
  assert.deepEqual(result.toolCalls[0]?.arguments, { query: 'RAG' });
  assert.deepEqual(result.usage, { promptTokens: 11, completionTokens: 4 });
  assert.ok(events.some((event) => event.payload.kind === 'tool_calls'));
  assert.ok(events.some((event) => event.payload.kind === 'done'));
});

test('agent_chat_turn_cancel aborts an in-flight provider request', async (t) => {
  let fetchSignal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    fetchSignal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  });
  const commands = createAiCommands(context());
  const run = commands.agent_chat_turn({
    request: {
      requestId: 'cancel-me',
      options: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'test-model',
        apiMode: 'chat_completions',
      },
      messages: [{ role: 'user', content: 'Long task' }],
      toolChoice: 'none',
      stream: true,
    },
  }, { sender: { send() {} } });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await commands.agent_chat_turn_cancel({ requestId: 'cancel-me' }), true);
  assert.equal(fetchSignal?.aborted, true);
  await assert.rejects(run, (error: unknown) => error instanceof Error && error.name === 'AbortError');
});
