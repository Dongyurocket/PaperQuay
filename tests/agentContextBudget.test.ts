import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_VISUAL_CONTEXT_MESSAGE,
  compactMessagesAtUserBoundary,
  emptyAgentSessionArtifacts,
  estimateMessagesTokens,
  estimateTokens,
  findLatestUserTurnBoundary,
  normalizeCompactionSummary,
  planAgentContextCompaction,
} from '../src/services/agentContextBudget.ts';
import type { AgentLoopMessage } from '../src/services/agentLoop.ts';

function message(role: AgentLoopMessage['role'], content: string): AgentLoopMessage {
  return { role, content };
}

test('context budget estimates English and CJK text conservatively', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcdefgh'), 2);
  assert.equal(estimateTokens('中文字符'), 3);
  assert.equal(estimateMessagesTokens([message('user', 'abcd'), message('assistant', '中文字符')]), 4);
});

test('context budget counts tool-call arguments and attachment payloads', () => {
  const withToolCalls = estimateMessagesTokens([{
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'c1', name: 'search_library', arguments: { query: 'a'.repeat(400) } }],
  }]);
  const withAttachment = estimateMessagesTokens([{
    role: 'user',
    content: AGENT_VISUAL_CONTEXT_MESSAGE,
    attachments: [{
      id: 'a1',
      kind: 'image',
      name: 'figure.png',
      mimeType: 'image/png',
      size: 1024,
      dataUrl: `data:image/png;base64,${'A'.repeat(4000)}`,
    }],
  }]);

  assert.ok(withToolCalls > estimateTokens(''));
  assert.ok(withToolCalls >= 100);
  assert.ok(withAttachment >= 1000);
});

test('compaction boundary skips synthetic visual-context user messages', () => {
  const messages = [
    message('system', 'root instructions'),
    message('user', 'real question'),
    message('assistant', 'tool call'),
    message('tool', 'tool result'),
    { role: 'user' as const, content: AGENT_VISUAL_CONTEXT_MESSAGE },
  ];

  // 合成视觉消息不是真实用户指令，边界必须落在真实 user 消息上。
  assert.equal(findLatestUserTurnBoundary(messages), 1);
});

test('context compaction only starts before the current user turn', () => {
  const messages = [
    message('system', 'root instructions'),
    message('user', 'old question'),
    message('assistant', 'old answer'),
    message('user', 'current question'),
    message('assistant', 'tool call'),
    message('tool', 'tool result must remain whole'),
  ];
  const plan = planAgentContextCompaction({
    messages,
    contextWindow: 20,
    reserve: 1,
  });

  assert.equal(plan.required, true);
  assert.equal(findLatestUserTurnBoundary(messages), 3);
  assert.deepEqual(plan.messagesToCompact.map((item) => item.content), ['old question', 'old answer']);

  const compacted = compactMessagesAtUserBoundary({
    messages,
    boundaryIndex: plan.boundaryIndex,
    summary: '## 会话进度摘要\n- 目标: answer current question',
    artifacts: {
      readPaperIds: ['paper-a'],
      citedPages: ['paper-a#2'],
      appliedPlanIds: [],
    },
  });

  assert.equal(compacted[0]?.content, 'root instructions');
  assert.match(compacted[1]?.content ?? '', /Persistent Artifacts/);
  assert.deepEqual(compacted.slice(2).map((item) => item.content), [
    'current question',
    'tool call',
    'tool result must remain whole',
  ]);
});

test('context compaction does not split a first active turn without history', () => {
  const messages = [
    message('system', 'root'),
    message('user', 'current only'),
    message('assistant', 'tool call'),
    message('tool', 'tool result'),
  ];
  const plan = planAgentContextCompaction({ messages, contextWindow: 2, reserve: 0 });

  assert.equal(plan.required, false);
  assert.equal(plan.messagesToCompact.length, 0);
});

test('compaction summary always contains structured fields and artifacts', () => {
  const summary = normalizeCompactionSummary('short model summary', {
    ...emptyAgentSessionArtifacts(),
    readPaperIds: ['paper-a'],
    appliedPlanIds: ['plan-a'],
  });

  assert.match(summary, /^## 会话进度摘要/m);
  assert.match(summary, /- 目标:/);
  assert.match(summary, /Read papers: paper-a/);
  assert.match(summary, /Applied plans: plan-a/);
});
