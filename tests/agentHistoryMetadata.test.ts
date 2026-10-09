import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentHistorySession,
  loadAgentHistorySessions,
  normalizeAgentHistoryMessageMeta,
  normalizeAgentHistorySessionMeta,
  saveAgentHistorySessions,
} from '../src/features/agent/AgentWorkspace.model.ts';
import type { AgentChatMessage, AgentHistorySession, AgentTraceStep } from '../src/features/agent/AgentWorkspace.types.ts';
import { normalizeAgentCitationTokens } from '../src/services/agentAnswerEvidence.ts';

function legacyMessage(final?: Partial<AgentTraceStep>): AgentChatMessage {
  return {
    id: 'answer', role: 'assistant', content: '原始正文 [[cite:agent-rag:paper-1:pdf-text:page-1]]。',
    meta: '流式回复中', createdAt: 100,
    paperScopeIds: [],
    citationBindings: normalizeAgentCitationTokens('Historical evidence [1]', []),
    ragCitations: [{
      id: 'agent-rag:paper-1:pdf-text:page-1', label: '1', paperId: 'paper-1', paperTitle: 'Original paper',
      sourceType: 'pdf-text', pageIndex: 0,
    }],
    trace: final ? [{
      id: 'final', type: 'final', title: '运行结果', summary: '回答已完成。', status: 'success', durationMs: 1200,
      ...final,
    }] : undefined,
  };
}

function history(message: AgentChatMessage): AgentHistorySession {
  return {
    id: 'saved-chat', title: '原任务', summary: `流式回复中 · ${message.content}`, updatedAt: 200,
    messages: [message], selectedPaperIds: [], lastInstruction: '原任务', status: 'running',
  };
}

test('history snapshots replace an old stream label using the final result without changing evidence', () => {
  const original = legacyMessage({});
  const snapshot = buildAgentHistorySession({
    id: 'saved-chat', messages: [original], selectedPaperIds: [], lastInstruction: '原任务', locale: 'zh-CN',
  });
  assert.equal(snapshot.messages[0].meta, '回答已完成。 · 1.2s');
  assert.equal(snapshot.status, 'success');
  assert.equal(original.meta, '流式回复中');
  assert.equal(snapshot.messages[0].content, original.content);
  assert.equal(snapshot.messages[0].createdAt, original.createdAt);
  assert.strictEqual(snapshot.messages[0].citationBindings, original.citationBindings);
  assert.strictEqual(snapshot.messages[0].ragCitations, original.ragCitations);
  assert.strictEqual(snapshot.messages[0].trace, original.trace);
  assert.deepEqual(snapshot.messages[0].paperScopeIds, []);
});

test('stored history load and save repair the label and sidebar summary without changing its timestamp', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let persisted = JSON.stringify([history(legacyMessage({}))]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: () => persisted,
      setItem: (_key: string, value: string) => { persisted = value; },
    },
  } });
  try {
    const loaded = loadAgentHistorySessions();
    assert.equal(loaded[0].messages[0].meta, '回答已完成。 · 1.2s');
    assert.equal(loaded[0].summary.startsWith('回答已完成。 · 1.2s · '), true);
    assert.equal(loaded[0].updatedAt, 200);
    assert.equal(loaded[0].status, 'success');
    saveAgentHistorySessions(loaded);
    assert.deepEqual(loadAgentHistorySessions(), loaded);
    saveAgentHistorySessions([history(legacyMessage({}))]);
    const saved = JSON.parse(persisted)[0];
    assert.equal(saved.messages[0].meta, '回答已完成。 · 1.2s');
    assert.equal(saved.updatedAt, 200);
    assert.equal(saved.messages[0].content, legacyMessage({}).content);
    assert.deepEqual(saved.messages[0].ragCitations, legacyMessage({}).ragCitations);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('history with no terminal evidence or a latest nonterminal final keeps its original stream label', () => {
  const unknown = legacyMessage();
  assert.strictEqual(normalizeAgentHistoryMessageMeta(unknown), unknown);
  for (const status of ['running', 'waiting', 'skipped'] as const) {
    const current = legacyMessage({ status });
    assert.strictEqual(normalizeAgentHistoryMessageMeta(current), current);
    assert.strictEqual(normalizeAgentHistorySessionMeta(history(current)).messages[0], current);
  }
  const resumed = legacyMessage({});
  resumed.trace!.push({ id: 'react-final', type: 'final', title: 'Next turn', summary: 'Working', status: 'running' });
  assert.strictEqual(normalizeAgentHistoryMessageMeta(resumed), resumed);
  const user = { ...legacyMessage({}), role: 'user' as const };
  assert.strictEqual(normalizeAgentHistoryMessageMeta(user), user);
});

test('partial, cancelled and failed results retain their final summaries and measured durations', () => {
  for (const summary of ['回答部分完成，请查看交付检查。', '运行已取消，可从检查点继续。', '笔记计划已生成，等待审批。']) {
    assert.equal(normalizeAgentHistoryMessageMeta(legacyMessage({ status: 'warning', summary })).meta, `${summary} · 1.2s`);
  }
  const failed = legacyMessage({ status: 'error', summary: 'Connection failed', durationMs: 14 });
  failed.meta = 'Streaming';
  assert.equal(normalizeAgentHistoryMessageMeta(failed).meta, 'Connection failed · 14ms');
  const unmeasured = legacyMessage({ status: 'warning', summary: '', durationMs: undefined });
  unmeasured.meta = 'Streaming';
  assert.equal(normalizeAgentHistoryMessageMeta(unmeasured).meta, 'Run ended; review its result.');
  for (const durationMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(normalizeAgentHistoryMessageMeta(legacyMessage({ durationMs })).meta, '回答已完成。');
  }
});

test('current service metadata stays authoritative and normalization is idempotent when switching chats', () => {
  const current = { ...legacyMessage({}), meta: '共享文库 RAG · 1.2s' };
  assert.strictEqual(normalizeAgentHistoryMessageMeta(current), current);
  assert.strictEqual(normalizeAgentHistorySessionMeta(history(current)).messages[0], current);
  const restored = normalizeAgentHistorySessionMeta(history(legacyMessage({})));
  assert.strictEqual(normalizeAgentHistorySessionMeta(restored), restored);
  assert.equal(restored.messages[0].meta, '回答已完成。 · 1.2s');
});
