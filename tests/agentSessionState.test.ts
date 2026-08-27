import test from 'node:test';
import assert from 'node:assert/strict';

import {
  forkAgentHistorySession,
  patchAgentHistorySessionMessage,
  upsertAgentHistorySession,
} from '../src/features/agent/agentSessionState.ts';
import type { AgentChatMessage, AgentHistorySession } from '../src/features/agent/AgentWorkspace.types.ts';
import { applyAgentLoopEventToTrace } from '../src/features/agent/AgentWorkspace.model.ts';

function message(id: string, role: AgentChatMessage['role'], content: string): AgentChatMessage {
  return {
    id,
    role,
    content,
    createdAt: 1,
  };
}

function session(id: string, messages: AgentChatMessage[]): AgentHistorySession {
  return {
    id,
    title: id,
    summary: id,
    updatedAt: 1,
    messages,
    selectedPaperIds: [],
    lastInstruction: '',
    status: 'success',
  };
}

test('upsertAgentHistorySession inserts and replaces by session id', () => {
  const sessions = upsertAgentHistorySession([], {
    sessionId: 's1',
    messages: [message('m1', 'assistant', 'hello')],
    selectedPaperIds: ['p1'],
    lastInstruction: 'hi',
    locale: 'en-US',
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 's1');

  const replaced = upsertAgentHistorySession(sessions, {
    sessionId: 's1',
    messages: [message('m2', 'assistant', 'updated')],
    selectedPaperIds: ['p2'],
    lastInstruction: 'updated',
    locale: 'en-US',
  });

  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].messages[0]?.id, 'm2');
  assert.deepEqual(replaced[0].selectedPaperIds, ['p2']);
});

test('patchAgentHistorySessionMessage only updates the targeted session and message', () => {
  const sessions = [
    session('s1', [message('m1', 'assistant', 'old'), message('m2', 'user', 'keep')]),
    session('s2', [message('m3', 'assistant', 'other')]),
  ];

  const patched = patchAgentHistorySessionMessage(sessions, {
    sessionId: 's1',
    messageId: 'm1',
    updater: (current) => ({ ...current, content: 'new' }),
    locale: 'en-US',
  });

  assert.equal(patched[0].id, 's1');
  assert.equal(patched[0].messages[0]?.content, 'new');
  assert.equal(patched[0].messages[1]?.content, 'keep');
  assert.equal(patched[1].messages[0]?.content, 'other');
});

test('upsertAgentHistorySession marks a session as running when the latest assistant trace is running', () => {
  const sessions = upsertAgentHistorySession([], {
    sessionId: 's1',
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Agent is replying...',
        createdAt: 1,
        trace: [
          {
            id: 'trace-1',
            type: 'intent',
            title: 'Understanding request',
            summary: 'The Agent is processing the instruction.',
            status: 'running',
          },
        ],
      },
    ],
    selectedPaperIds: [],
    lastInstruction: 'classify selected papers',
    locale: 'en-US',
  });

  assert.equal(sessions[0]?.status, 'running');
});

test('Agent tool traces resolve the same call from running to a terminal result', () => {
  const started = applyAgentLoopEventToTrace([], {
    kind: 'tool_call',
    turn: 1,
    callId: 'call-1',
    name: 'search_library',
    args: { query: 'paper' },
  });
  const completed = applyAgentLoopEventToTrace(started, {
    kind: 'tool_result',
    turn: 1,
    callId: 'call-1',
    name: 'search_library',
    ok: true,
    preview: 'Found one result.',
  });

  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.type, 'tool-result');
  assert.equal(completed[0]?.status, 'success');
  assert.equal(completed[0]?.detail, 'Found one result.');
});

test('forkAgentHistorySession copies a message prefix without sharing mutable message arrays', () => {
  const source = session('source', [
    message('m1', 'user', 'first'),
    {
      ...message('m2', 'assistant', 'second'),
      attachments: [{
        id: 'image-1',
        kind: 'image',
        name: 'figure.png',
        mimeType: 'image/png',
        size: 12,
        dataUrl: 'data:image/png;base64,not-persisted',
      }],
      paperScopeIds: ['paper-a'],
    },
    message('m3', 'user', 'third'),
  ]);
  source.selectedPaperIds = ['paper-a'];
  source.lastInstruction = 'compare papers';

  const fork = forkAgentHistorySession({
    source,
    messageId: 'm2',
    forkSessionId: 'fork',
    locale: 'en-US',
  });

  assert.equal(fork?.id, 'fork');
  assert.deepEqual(fork?.messages.map((item) => item.id), ['m1', 'm2']);
  assert.deepEqual(fork?.selectedPaperIds, ['paper-a']);
  assert.equal(fork?.messages[1]?.attachments?.[0]?.dataUrl, undefined);
  fork?.messages[1]?.paperScopeIds?.push('paper-b');
  assert.deepEqual(source.messages[1]?.paperScopeIds, ['paper-a']);
});
