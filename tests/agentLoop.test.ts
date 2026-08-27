import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runAgentLoop,
  type AgentChatTurnRequest,
  type AgentLoopOptions,
  type AgentToolDefinition,
} from '../src/services/agentLoop.ts';

function readTool(
  name: string,
  execute: AgentToolDefinition['execute'],
): AgentToolDefinition {
  return {
    name,
    description: name,
    kind: 'read',
    parameters: { type: 'object', additionalProperties: true },
    execute,
  };
}

function loopOptions(
  tools: AgentToolDefinition[],
  chatTurn: AgentLoopOptions['chatTurn'],
  overrides: Partial<AgentLoopOptions> = {},
): AgentLoopOptions {
  return {
    tools,
    chatTurn,
    mountContext: {
      papersCount: 1,
      hasOpenDocument: false,
      ragReady: true,
      localLibraryMode: true,
    },
    runtimeContext: {},
    messages: [
      { role: 'system', content: 'You are a test agent.' },
      { role: 'user', content: 'Answer the question.' },
    ],
    contextLabel: 'metadata only',
    ...overrides,
  };
}

test('agent loop executes read tools across turns and returns the final answer', async () => {
  const calls: AgentChatTurnRequest[] = [];
  const events: string[] = [];
  const result = await runAgentLoop(loopOptions(
    [readTool('search_library', async () => ({ content: 'Found paper A.' }))],
    async (request) => {
      calls.push(request);
      return calls.length === 1
        ? {
          content: '',
          toolCalls: [{ id: 'call-1', name: 'search_library', arguments: { query: 'A' } }],
          finishReason: 'tool_calls',
        }
        : { content: 'Paper A is relevant.', finishReason: 'stop' };
    },
    {
      onEvent: (event) => events.push(event.kind),
    },
  ));

  assert.equal(result.kind, 'answer');
  assert.equal(result.answer, 'Paper A is relevant.');
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.messages.at(-2)?.role, 'assistant');
  assert.equal(calls[1]?.messages.at(-2)?.toolCalls?.[0]?.id, 'call-1');
  assert.equal(calls[1]?.messages.at(-1)?.role, 'tool');
  assert.match(calls[1]?.messages.at(-1)?.content ?? '', /Found paper A/);
  assert.deepEqual(events.filter((kind) => kind === 'tool_call'), ['tool_call']);
  assert.deepEqual(events.filter((kind) => kind === 'tool_result'), ['tool_result']);
});

test('agent loop rejects mixed read and write calls before creating a write plan', async () => {
  let reads = 0;
  let writes = 0;
  const writeTool: AgentToolDefinition = {
    name: 'rename',
    description: 'Rename',
    kind: 'write',
    parameters: { type: 'object' },
    async execute() {
      writes += 1;
      return { content: 'write' };
    },
  };
  const calls: AgentChatTurnRequest[] = [];
  const result = await runAgentLoop(loopOptions(
    [readTool('search_library', async () => {
      reads += 1;
      return { content: 'read' };
    }), writeTool],
    async (request) => {
      calls.push(request);
      return calls.length === 1
        ? {
          content: '',
          toolCalls: [
            { id: 'read-1', name: 'search_library', arguments: {} },
            { id: 'write-1', name: 'rename', arguments: {} },
          ],
        }
        : { content: 'I will read first and propose a write later.' };
    },
  ));

  assert.equal(result.kind, 'answer');
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.match(calls[1]?.messages.at(-1)?.content ?? '', /same model turn/);
});

test('agent loop turns write calls into a reviewable plan without executing local writes', async () => {
  let executionCount = 0;
  const writeTool: AgentToolDefinition = {
    name: 'rename',
    description: 'Create a rename plan.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      executionCount += 1;
      return {
        content: 'Created one reviewable rename item.',
        plan: {
          id: 'plan-1',
          tool: 'rename',
          title: 'Rename',
          description: 'Review before applying.',
          createdAt: 1,
          items: [{
            id: 'item-1',
            tool: 'rename',
            paperId: 'paper-1',
            paperTitle: 'Before',
            title: 'Rename',
            description: 'Before -> After',
            before: 'Before',
            after: 'After',
            updateRequest: { paperId: 'paper-1', title: 'After' },
          }],
        },
      };
    },
  };

  const result = await runAgentLoop(loopOptions(
    [writeTool],
    async () => ({
      content: '',
      toolCalls: [{ id: 'write-1', name: 'rename', arguments: { items: [] } }],
    }),
  ));

  assert.equal(executionCount, 1);
  assert.equal(result.kind, 'plan');
  assert.equal(result.plan.items.length, 1);
  assert.equal(result.plan.items[0]?.after, 'After');
});

test('agent loop keeps memory writes behind an independent approval plan', async () => {
  const memoryTool: AgentToolDefinition = {
    name: 'write_memory',
    description: 'Create a memory update.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      return {
        content: 'Created memory update.',
        memoryPlan: {
          id: 'memory-plan-1',
          file: 'topics',
          content: '# Topic\n- Evidence',
          summary: 'Store the verified topic.',
          createdAt: 1,
        },
      };
    },
  };

  const result = await runAgentLoop(loopOptions(
    [memoryTool],
    async () => ({
      content: '',
      toolCalls: [{ id: 'memory-1', name: 'write_memory', arguments: {} }],
    }),
  ));

  assert.equal(result.kind, 'memory-plan');
  assert.equal(result.memoryPlan.file, 'topics');
  assert.match(result.memoryPlan.content, /Evidence/);
});

test('agent loop forces a final tool-free turn at maxTurns', async () => {
  const calls: AgentChatTurnRequest[] = [];
  const result = await runAgentLoop(loopOptions(
    [readTool('search_library', async () => ({ content: 'intermediate' }))],
    async (request) => {
      calls.push(request);
      return calls.length === 1
        ? { content: '', toolCalls: [{ id: 'call-1', name: 'search_library', arguments: {} }] }
        : { content: 'Forced final answer.', toolCalls: [{ id: 'ignored', name: 'search_library', arguments: {} }] };
    },
    { maxTurns: 2 },
  ));

  assert.equal(result.kind, 'answer');
  assert.equal(result.answer, 'Forced final answer.');
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.toolChoice, 'none');
  assert.equal(calls[1]?.tools, undefined);
  assert.match(calls[1]?.messages.at(-1)?.content ?? '', /final allowed turn/i);
});

test('agent loop returns tool errors to the model for self-correction', async () => {
  const calls: AgentChatTurnRequest[] = [];
  const result = await runAgentLoop(loopOptions(
    [readTool('broken_tool', async () => {
      throw new Error('source unavailable');
    })],
    async (request) => {
      calls.push(request);
      return calls.length === 1
        ? { content: '', toolCalls: [{ id: 'call-1', name: 'broken_tool', arguments: {} }] }
        : { content: 'I used the remaining metadata instead.' };
    },
  ));

  assert.equal(result.kind, 'answer');
  assert.match(calls[1]?.messages.at(-1)?.content ?? '', /source unavailable/);
  assert.match(calls[1]?.messages.at(-1)?.content ?? '', /"isError":true/);
});

test('agent loop stops before issuing a model call when aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    runAgentLoop(loopOptions([], async () => {
      calls += 1;
      return { content: 'unreachable' };
    }, { signal: controller.signal })),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );

  assert.equal(calls, 0);
});

test('agent loop compacts only completed history before the current user turn', async () => {
  const requests: AgentChatTurnRequest[] = [];
  let compacted = 0;
  const result = await runAgentLoop(loopOptions([], async (request) => {
    requests.push(request);
    return { content: 'Current answer.' };
  }, {
    messages: [
      { role: 'system', content: 'root' },
      { role: 'user', content: 'old user '.repeat(20) },
      { role: 'assistant', content: 'old assistant '.repeat(20) },
      { role: 'user', content: 'current question' },
      { role: 'assistant', content: 'active tool call' },
      { role: 'tool', toolCallId: 'call-1', content: 'active tool result' },
    ],
    contextCompaction: {
      contextWindow: 20,
      reserve: 1,
      artifacts: { readPaperIds: ['paper-a'], citedPages: [], appliedPlanIds: [] },
      async compact() {
        compacted += 1;
        return '## 会话进度摘要\n- 目标: preserve current turn';
      },
    },
  }));

  assert.equal(result.kind, 'answer');
  assert.equal(compacted, 1);
  assert.deepEqual(requests[0]?.messages.slice(-3).map((item) => item.content), [
    'current question',
    'active tool call',
    'active tool result',
  ]);
  assert.match(requests[0]?.messages[1]?.content ?? '', /Persistent Artifacts/);
});

test('agent loop caps parallel tool images to four and eight megabytes per turn', async () => {
  const calls: AgentChatTurnRequest[] = [];
  const imageTool = readTool('read_paper_figure', async (args) => ({
    content: `figure ${args.index}`,
    attachments: [{
      id: `image-${args.index}`,
      kind: 'image',
      name: `figure-${args.index}`,
      mimeType: 'image/jpeg',
      size: 2 * 1024 * 1024,
      dataUrl: 'data:image/jpeg;base64,AA==',
    }],
  }));
  const result = await runAgentLoop(loopOptions(
    [imageTool],
    async (request) => {
      calls.push(request);
      return calls.length === 1
        ? {
          content: '',
          toolCalls: Array.from({ length: 6 }, (_, index) => ({
            id: `call-${index}`,
            name: 'read_paper_figure',
            arguments: { index },
          })),
        }
        : { content: 'Compared the available figures.' };
    },
  ));

  assert.equal(result.kind, 'answer');
  const imageMessages = calls[1]?.messages.filter((message) => message.attachments?.length) ?? [];
  assert.equal(imageMessages.length, 1);
  assert.equal(imageMessages.flatMap((message) => message.attachments ?? []).length, 4);
  const toolRoles = calls[1]?.messages
    .slice(1)
    .filter((message) => message.role === 'tool' || message.attachments?.length)
    .map((message) => message.role);
  assert.deepEqual(toolRoles, ['tool', 'tool', 'tool', 'tool', 'tool', 'tool', 'user']);
});
