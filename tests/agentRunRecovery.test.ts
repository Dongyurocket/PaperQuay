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
        { role: 'assistant', content: 'complete answer' },
        { role: 'tool', content: 'tool record', toolCallId: 'call-1' },
      ],
    }),
    event(4, 'tool_call', { name: 'unfinished next call' }),
  ]);

  assert.deepEqual(checkpoint?.map((message) => message.content), [
    'root',
    'current request',
    'complete answer',
    'tool record',
  ]);

  const chat = recoveryCheckpointToChatMessages(checkpoint ?? []);
  assert.deepEqual(chat.map((message) => message.role), ['user', 'assistant']);
  assert.deepEqual(chat.map((message) => message.content), ['current request', 'complete answer']);
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
        completedStages: ['rephrase', 'decompose', 'invalid'],
      },
    }),
  ]);

  assert.deepEqual(checkpoint, {
    rephrasedQuestion: 'Saved question',
    subquestions: ['Q1'],
    researchNotes: undefined,
    completedStages: ['rephrase', 'decompose'],
  });
});
