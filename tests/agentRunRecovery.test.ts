import test from 'node:test';
import assert from 'node:assert/strict';

import {
  latestAgentRecoveryCheckpoint,
  latestComparativeSurveyCheckpoint,
  recoveryCheckpointToChatMessages,
} from '../src/features/agent/agentRunRecovery.ts';
import type { AgentRunEventRecord } from '../src/services/agentRuns.ts';

function event(id: number, kind: string, payload: Record<string, unknown>): AgentRunEventRecord {
  return { id, runId: 'run-a', ts: id, kind, payload };
}

test('recovery chooses the newest complete checkpoint and preserves user/assistant conversation', () => {
  const checkpoint = latestAgentRecoveryCheckpoint([
    event(1, 'checkpoint', {
      messages: [
        { role: 'system', content: 'old root' },
        { role: 'user', content: 'old request' },
      ],
    }),
    event(2, 'turn_end', { turn: 1 }),
    event(3, 'checkpoint', {
      messages: [
        { role: 'system', content: 'root' },
        { role: 'user', content: 'current request' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-1', name: 'search_library', arguments: { query: 'x' } }],
        },
        { role: 'tool', content: 'tool record', toolCallId: 'call-1' },
        { role: 'assistant', content: 'complete answer' },
      ],
    }),
    event(4, 'tool_call', { name: 'unfinished next call' }),
  ]);

  // 工具调用轮的空 content assistant 消息必须保留，否则 tool 消息成为孤儿。
  assert.deepEqual(checkpoint?.map((message) => message.content), [
    'root',
    'current request',
    ' ',
    'tool record',
    'complete answer',
  ]);
  assert.equal(checkpoint?.[3]?.toolCallId, 'call-1');
  assert.equal(checkpoint?.[2]?.toolCalls?.[0]?.id, 'call-1');

  const chat = recoveryCheckpointToChatMessages(checkpoint ?? []);
  assert.deepEqual(chat.map((message) => message.role), ['user', 'assistant', 'assistant']);
  assert.deepEqual(chat.map((message) => message.content), ['current request', ' ', 'complete answer']);
});

test('recovery drops orphan tool messages and unanswered tool-call assistant messages', () => {
  const checkpoint = latestAgentRecoveryCheckpoint([
    event(1, 'checkpoint', {
      messages: [
        { role: 'system', content: 'root' },
        { role: 'user', content: 'request' },
        // 没有前置 assistant toolCalls 的 tool 消息：孤儿，必须丢弃。
        { role: 'tool', content: 'orphan tool result', toolCallId: 'missing-call' },
        // toolCalls 没有对应 tool 应答的 assistant 消息：provider 会拒绝，必须丢弃。
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'unanswered', name: 'search_library', arguments: {} }],
        },
        { role: 'assistant', content: 'final answer' },
      ],
    }),
  ]);

  assert.deepEqual(checkpoint?.map((message) => message.role), ['system', 'user', 'assistant']);
  assert.deepEqual(checkpoint?.map((message) => message.content), ['root', 'request', 'final answer']);
});

test('recovery ignores malformed checkpoint payloads', () => {
  assert.equal(latestAgentRecoveryCheckpoint([
    event(1, 'checkpoint', { messages: [{ role: 'unknown', content: 'bad' }] }),
  ]), null);
});

test('recovery extracts the newest comparative-survey stage checkpoint', () => {
  const checkpoint = latestComparativeSurveyCheckpoint([
    event(1, 'checkpoint', {
      capabilityId: 'comparative-survey',
      artifacts: {
        rephrasedQuestion: 'Saved question',
        subquestions: ['Q1'],
        citations: [{
          paperId: 'paper-a',
          paperTitle: 'Paper A',
          pageIndex: 2,
          blockId: 'block-a',
          previewText: 'Saved evidence',
          sourceType: 'mineru-markdown',
        }],
        completedStages: ['rephrase', 'decompose', 'invalid'],
      },
    }),
  ]);

  assert.deepEqual(checkpoint, {
    rephrasedQuestion: 'Saved question',
    subquestions: ['Q1'],
    researchNotes: undefined,
    citations: [{
      paperId: 'paper-a',
      paperTitle: 'Paper A',
      pageIndex: 2,
      blockId: 'block-a',
      previewText: 'Saved evidence',
      sourceType: 'mineru-markdown',
    }],
    completedStages: ['rephrase', 'decompose'],
  });
});
