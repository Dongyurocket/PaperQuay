import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runAgentLoop,
  type AgentChatTurnRequest,
  type AgentLoopCheckpoint,
  type AgentLoopEvent,
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

test('agent loop keeps note writes behind an independent approval plan', async () => {
  const noteTool: AgentToolDefinition = {
    name: 'write_notes',
    description: 'Create a note write plan.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      return {
        content: 'Created note plan.',
        notePlan: {
          id: 'note-plan-1',
          summary: 'Create a concept note.',
          operations: [
            { kind: 'create' as const, title: 'KV Cache', content: '## 定义\n键值缓存。', tags: ['llm'] },
          ],
          createdAt: 1,
        },
      };
    },
  };

  const result = await runAgentLoop(loopOptions(
    [noteTool],
    async () => ({
      content: '',
      toolCalls: [{ id: 'note-1', name: 'write_notes', arguments: {} }],
    }),
  ));

  assert.equal(result.kind, 'note-plan');
  assert.equal(result.notePlan.summary, 'Create a concept note.');
  assert.equal(result.notePlan.operations[0]?.kind, 'create');
});

test('agent loop rejects mixed note and memory writes before executing either', async () => {
  let noteExecutions = 0;
  let memoryExecutions = 0;
  const noteWrite: AgentToolDefinition = {
    name: 'write_notes',
    description: 'Create a note write plan.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      noteExecutions += 1;
      return { content: 'note plan created' };
    },
  };
  const memoryWrite: AgentToolDefinition = {
    name: 'write_memory',
    description: 'Create a memory update.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      memoryExecutions += 1;
      return { content: 'memory plan created' };
    },
  };
  const calls: AgentChatTurnRequest[] = [];

  const result = await runAgentLoop(loopOptions(
    [noteWrite, memoryWrite],
    async (request) => {
      calls.push(request);
      if (calls.length === 1) {
        return {
          content: '',
          toolCalls: [
            { id: 'w-1', name: 'write_notes', arguments: {} },
            { id: 'w-2', name: 'write_memory', arguments: {} },
          ],
        };
      }
      return { content: '拆分完成', toolCalls: [] };
    },
  ));

  assert.equal(noteExecutions, 0);
  assert.equal(memoryExecutions, 0);
  assert.equal(result.kind, 'answer');
});

test('agent loop rejects mixed paper and memory writes before executing either', async () => {
  let paperExecutions = 0;
  let memoryExecutions = 0;
  const paperWrite: AgentToolDefinition = {
    name: 'rename',
    description: 'Create a rename plan.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      paperExecutions += 1;
      return { content: 'plan created' };
    },
  };
  const memoryWrite: AgentToolDefinition = {
    name: 'write_memory',
    description: 'Create a memory update.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      memoryExecutions += 1;
      return { content: 'memory plan created' };
    },
  };
  const calls: AgentChatTurnRequest[] = [];

  const result = await runAgentLoop(loopOptions(
    [paperWrite, memoryWrite],
    async (request) => {
      calls.push(request);
      return calls.length === 1
        ? {
          content: '',
          toolCalls: [
            { id: 'w-1', name: 'rename', arguments: {} },
            { id: 'w-2', name: 'write_memory', arguments: {} },
          ],
        }
        : { content: 'Split into separate reviewable actions.' };
    },
  ));

  assert.equal(result.kind, 'answer');
  assert.equal(paperExecutions, 0);
  assert.equal(memoryExecutions, 0);
  assert.match(calls[1]?.messages.at(-2)?.content ?? '', /separate turns/);
  assert.match(calls[1]?.messages.at(-1)?.content ?? '', /separate turns/);
});

test('agent loop feeds write tool failures back to the model instead of aborting the run', async () => {
  const failingWrite: AgentToolDefinition = {
    name: 'rename',
    description: 'Create a rename plan.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      throw new Error('plan schema invalid');
    },
  };
  const calls: AgentChatTurnRequest[] = [];

  const result = await runAgentLoop(loopOptions(
    [failingWrite],
    async (request) => {
      calls.push(request);
      return calls.length === 1
        ? { content: '', toolCalls: [{ id: 'w-1', name: 'rename', arguments: {} }] }
        : { content: 'Understood, no changes are needed.' };
    },
  ));

  assert.equal(result.kind, 'answer');
  assert.match(calls[1]?.messages.at(-1)?.content ?? '', /plan schema invalid/);
  assert.match(calls[1]?.messages.at(-1)?.content ?? '', /"isError":true/);
});

test('agent loop preserves successful approval drafts and replies to every call when a write sibling fails', async () => {
  let planExecutions = 0;
  const writeTool: AgentToolDefinition = {
    name: 'rename',
    description: 'Create a rename plan.',
    kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute(args) {
      planExecutions += 1;
      if (args.fail) throw new Error('second rename plan invalid');
      return {
        content: 'Created a reviewable rename plan.',
        plan: {
          id: 'plan-success',
          tool: 'rename',
          title: 'Rename',
          description: 'Review before applying.',
          createdAt: 1,
          items: [{
            id: 'item-success',
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
  const calls: AgentChatTurnRequest[] = [];
  const checkpoints: AgentLoopCheckpoint[] = [];
  const events: AgentLoopEvent[] = [];
  const result = await runAgentLoop(loopOptions([writeTool], async (request) => {
    calls.push(request);
    return calls.length === 1
      ? {
        content: '',
        toolCalls: [
          { id: 'write-success', name: 'rename', arguments: {} },
          { id: 'write-failure', name: 'rename', arguments: { fail: true } },
        ],
      }
      : { content: 'The plans need correction before approval.' };
  }, {
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    onEvent: (event) => events.push(event),
  }));

  assert.equal(planExecutions, 2);
  assert.equal(result.kind, 'plan');
  if (result.kind !== 'plan') assert.fail('The successful write draft must remain reviewable.');
  assert.deepEqual(result.plan.items.map((item) => item.id), ['item-success']);
  assert.match(result.plan.description, /only the successful actions/);
  assert.match(result.plan.description, /second rename plan invalid/);
  assert.equal(calls.length, 1);
  assert.equal(events.find((event) => event.kind === 'turn_end')?.finishReason, 'partial_write_plan');
  for (const messages of [checkpoints[0]!.messages]) {
    const declared = messages.find((message) => message.toolCalls?.length === 2)?.toolCalls ?? [];
    const replies = messages.filter((message) => message.role === 'tool');
    assert.deepEqual(replies.map((message) => message.toolCallId), declared.map((call) => call.id));
    assert.equal(replies.length, 2);
    assert.deepEqual(JSON.parse(replies[0]!.content), {
      name: 'rename', isError: false, result: 'Created a reviewable rename plan.',
    });
    assert.deepEqual(JSON.parse(replies[1]!.content), {
      name: 'rename', isError: true, result: 'second rename plan invalid',
    });
  }
});

test('agent loop combines every successful note draft and exposes a failed sibling in its approval summary', async () => {
  const writeNotes: AgentToolDefinition = {
    name: 'write_notes', description: 'Propose note writes.', kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute(args) {
      if (args.fail) throw new Error('third note draft invalid');
      return { content: 'Ready for approval.', notePlan: {
        id: `note-plan-${args.title}`, summary: `Create ${args.title}`, createdAt: 1,
        operations: [{ kind: 'create', title: String(args.title), content: 'Evidence-backed draft.' }],
      } };
    },
  };
  let modelCalls = 0;
  const result = await runAgentLoop(loopOptions([writeNotes], async () => {
    modelCalls += 1;
    return { content: '', toolCalls: [
      { id: 'n1', name: 'write_notes', arguments: { title: 'First' } },
      { id: 'n2', name: 'write_notes', arguments: { title: 'Second' } },
      { id: 'n3', name: 'write_notes', arguments: { fail: true } },
    ] };
  }));
  assert.equal(modelCalls, 1);
  assert.equal(result.kind, 'note-plan');
  if (result.kind !== 'note-plan') assert.fail('Both successful note drafts must remain reviewable.');
  assert.deepEqual(result.notePlan.operations.map((operation) => operation.title), ['First', 'Second']);
  assert.match(result.notePlan.summary, /third note draft invalid/);
  assert.match(result.notePlan.summary, /only the successful actions/);
});

test('agent loop rejects multiple memory writes before creating a draft and lets the model propose a single approval', async () => {
  let planExecutions = 0;
  const writeMemory: AgentToolDefinition = {
    name: 'write_memory', description: 'Propose a memory write.', kind: 'write',
    parameters: { type: 'object', additionalProperties: true },
    async execute() {
      planExecutions += 1;
      return { content: 'Ready for approval.', memoryPlan: {
        id: 'memory-plan', file: 'topics', content: 'Reviewed facts.', summary: 'Update memory', createdAt: 1,
      } };
    },
  };
  const calls: AgentChatTurnRequest[] = [];
  const result = await runAgentLoop(loopOptions([writeMemory], async (request) => {
    calls.push(request);
    return { content: '', toolCalls: calls.length === 1 ? [
      { id: 'm1', name: 'write_memory', arguments: { file: 'topics' } },
      { id: 'm2', name: 'write_memory', arguments: { file: 'synthesis' } },
    ] : [{ id: 'm3', name: 'write_memory', arguments: { file: 'topics' } }] };
  }));
  assert.equal(planExecutions, 1);
  assert.equal(result.kind, 'memory-plan');
  const rejected = calls[1]!.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(rejected.map((message) => message.toolCallId), ['m1', 'm2']);
  assert.ok(rejected.every((message) => JSON.parse(message.content).isError === true));
  assert.ok(rejected.every((message) => /only one memory write per turn/.test(message.content)));
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

test('agent loop settles cancelled parallel tools and checkpoints every response before aborting', async () => {
  const controller = new AbortController();
  const events: AgentLoopEvent[] = [];
  const checkpoints: AgentLoopCheckpoint[] = [];
  const completed: string[] = [];
  let startedCount = 0;
  let resolveStarted!: () => void;
  const allStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const started = () => {
    startedCount += 1;
    if (startedCount === 3) resolveStarted();
  };
  let releaseDelayed!: () => void;
  const delayed = new Promise<void>((resolve) => { releaseDelayed = resolve; });
  const context = {
    status: 'ok',
    matchedCount: 1,
    returnedCount: 1,
    contexts: [{
      paperId: 'paper-a',
      documentKey: 'paper-a.pdf',
      contextVersion: 'version-a',
      text: 'verified evidence',
      textStart: 0,
      textEnd: 17,
      truncated: true,
      continuation: { tool: 'request_paper_context', paperIds: ['paper-a'], offset: 17, canContinue: true },
    }],
    continuation: { tool: 'request_paper_context', canContinue: true },
  };
  let modelCalls = 0;
  let settled = false;
  const run = runAgentLoop(loopOptions([
    readTool('ready_context', async () => {
      started();
      completed.push('ready');
      return { content: JSON.stringify(context) };
    }),
    readTool('abort_context', async (_args, toolContext) => {
      started();
      await new Promise<never>((_resolve, reject) => {
        toolContext.signal!.addEventListener('abort', () => {
          const error = new Error('context cancelled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
      return { content: 'unreachable' };
    }),
    readTool('delayed_context', async () => {
      started();
      await delayed;
      completed.push('delayed');
      return { content: 'second verified context' };
    }),
  ], async () => {
    modelCalls += 1;
    return {
      content: '',
      toolCalls: [
        { id: 'read-ready', name: 'ready_context', arguments: {} },
        { id: 'read-abort', name: 'abort_context', arguments: {} },
        { id: 'read-delayed', name: 'delayed_context', arguments: {} },
      ],
      finishReason: 'tool_calls',
      usage: { promptTokens: 111, completionTokens: 222 },
    };
  }, {
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
  }));
  const outcome = run.then(
    () => { settled = true; return { kind: 'resolved' as const }; },
    (error: unknown) => { settled = true; return { kind: 'rejected' as const, error }; },
  );

  await allStarted;
  controller.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const settledBeforeRelease = settled;
  releaseDelayed();
  const result = await outcome;

  assert.equal(settledBeforeRelease, false, 'the run must await the bounded delayed sibling');
  assert.ok(result.kind === 'rejected');
  assert.ok(result.error instanceof Error && result.error.name === 'AbortError');
  assert.equal(modelCalls, 1);
  assert.deepEqual(completed, ['ready', 'delayed']);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0]!.turn, 1);
  const messages = checkpoints[0]!.messages;
  const declared = messages.find((message) => message.toolCalls?.length === 3)?.toolCalls ?? [];
  const replies = messages.filter((message) => message.role === 'tool');
  assert.deepEqual(replies.map((message) => message.toolCallId), declared.map((call) => call.id));
  assert.equal(replies.length, 3);
  assert.deepEqual(JSON.parse(JSON.parse(replies[0]!.content).result), context);
  assert.equal(JSON.parse(replies[1]!.content).isError, true);
  assert.equal(JSON.parse(replies[2]!.content).result, 'second verified context');
  assert.deepEqual(events.filter((event) => event.kind === 'turn_end'), [{
    kind: 'turn_end', turn: 1, finishReason: 'cancelled', promptTokens: 111, completionTokens: 222,
  }]);
  for (const call of declared) {
    assert.equal(events.filter((event) => event.kind === 'tool_result' && event.callId === call.id).length, 1);
  }
  const eventCount = events.length;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(events.length, eventCount);
  assert.deepEqual(completed, ['ready', 'delayed']);
  assert.equal(checkpoints.length, 1);
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
