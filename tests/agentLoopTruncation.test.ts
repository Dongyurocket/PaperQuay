import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runAgentLoop,
  type AgentChatTurnRequest,
  type AgentLoopOptions,
  type AgentToolDefinition,
} from '../src/services/agentLoop.ts';

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

test('agent loop recovers when first turn is truncated by length with empty content', async () => {
  const calls: AgentChatTurnRequest[] = [];
  const events: Array<{ kind: string; finishReason?: string; message?: string }> = [];

  const result = await runAgentLoop(loopOptions(
    [],
    async (request) => {
      calls.push(request);
      if (calls.length === 1) {
        // 第一轮：耗尽 token 截断，正文为空
        return {
          content: '',
          thinking: 'Thinking process...',
          finishReason: 'length',
        };
      }
      // 第二轮（恢复轮）：直接给出答案
      return {
        content: '这是截断后自动恢复的最终回答。',
        finishReason: 'stop',
      };
    },
    {
      onEvent: (event) => events.push({
        kind: event.kind,
        finishReason: 'finishReason' in event ? event.finishReason : undefined,
        message: 'message' in event ? event.message : undefined,
      }),
    },
  ));

  assert.equal(result.kind, 'answer');
  assert.equal(result.answer, '这是截断后自动恢复的最终回答。');
  assert.equal(calls.length, 2);

  // 第一轮 turn_end 记录 length 截断
  const turnEnds = events.filter((e) => e.kind === 'turn_end');
  assert.equal(turnEnds[0]?.finishReason, 'length');
  assert.equal(turnEnds[1]?.finishReason, 'stop');

  // 第二轮请求不带 tools，强制输出最终回答，且包含截断提示 system message
  assert.equal(calls[1]?.tools, undefined);
  const recoverySystemMsg = calls[1]?.messages.find(
    (m) => m.role === 'system' && m.content.includes('截断'),
  );
  assert.ok(recoverySystemMsg, 'Expected recovery system message in second turn');
});

test('agent loop throws localized error without english fallback when recovery also produces empty content', async () => {
  const calls: AgentChatTurnRequest[] = [];
  const events: Array<{ kind: string; message?: string }> = [];

  await assert.rejects(
    async () => {
      await runAgentLoop(loopOptions(
        [],
        async (request) => {
          calls.push(request);
          return {
            content: '',
            finishReason: 'length',
          };
        },
        {
          onEvent: (event) => events.push({
            kind: event.kind,
            message: 'message' in event ? event.message : undefined,
          }),
        },
      ));
    },
    (err: Error) => {
      // 不再出现旧的英文兜底句
      assert.doesNotMatch(err.message, /The model did not return a final answer/);
      // 包含中文本地化提示
      assert.match(err.message, /模型输出被长度上限截断/);
      assert.match(err.message, /finish_reason=length/);
      return true;
    },
  );

  // 必须经历了恢复轮（共 2 轮）
  assert.equal(calls.length, 2);

  // 检查抛出了 error 事件
  const errorEvents = events.filter((e) => e.kind === 'error');
  assert.equal(errorEvents.length, 1);
  assert.match(errorEvents[0]?.message ?? '', /模型输出被长度上限截断/);
});
