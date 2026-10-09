import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

import {
  latestAgentRecoveryCheckpoint,
  latestAgentRecoveryCitations,
  latestComparativeSurveyCheckpoint,
  recoveryCheckpointToChatMessages,
} from '../src/features/agent/agentRunRecovery.ts';
import type { AgentRunEventRecord } from '../src/services/agentRuns.ts';
import { runAgentLoop, type AgentLoopMessage, type AgentToolDefinition } from '../src/services/agentLoop.ts';

function event(id: number, kind: string, payload: Record<string, unknown>): AgentRunEventRecord {
  return { id, runId: 'run-a', ts: id, kind, payload };
}

test('Workspace snapshots preserve structured tool continuations and every declared call through recovery', () => {
  // Execute the actual private snapshot function without importing the entire
  // desktop workspace, whose renderer imports require an Electron environment.
  const source = readFileSync(new URL('../src/features/agent/AgentWorkspace.tsx', import.meta.url), 'utf8');
  const declaration = source.match(/function recoverySnapshotMessages\([\s\S]*?\n}\r?\n/);
  assert.ok(declaration);
  const snapshotMessages = new Function(`${stripTypeScriptTypes(declaration[0])}; return recoverySnapshotMessages;`)() as (messages: AgentLoopMessage[]) => AgentLoopMessage[];
  const calls = Array.from({ length: 14 }, (_, index) => ({ id: `call-${index}`, name: 'request_paper_context', arguments: { paperIds: ['paper-a'] } }));
  const result = JSON.stringify({ name: 'request_paper_context', result: JSON.stringify({ status: 'ok',
    papers: [{ paperId: 'paper-a', text: 'evidence '.repeat(1200), contextVersion: 'version-a',
      continuation: { tool: 'request_paper_context', canContinue: true, offset: 9600, contextVersion: 'version-a' } }] }) });
  assert.ok(result.length > 8000);
  const messages: AgentLoopMessage[] = [{ role: 'system', content: 'root' }, { role: 'user', content: 'continue' },
    { role: 'assistant', content: '', toolCalls: calls },
    ...calls.map((call) => ({ role: 'tool' as const, content: result, toolCallId: call.id }))];
  const snapshot = snapshotMessages(messages);
  assert.equal(snapshot[2].toolCalls?.length, calls.length);
  assert.ok(snapshot.filter((message) => message.role === 'tool').every((message) => message.content === result));
  const recovered = latestAgentRecoveryCheckpoint([event(1, 'checkpoint', { messages: JSON.parse(JSON.stringify(snapshot)) })]);
  assert.equal(recovered?.length, messages.length);
  const parsed = JSON.parse(JSON.parse(recovered!.find((message) => message.role === 'tool')!.content).result);
  assert.equal(parsed.papers[0].continuation.offset, 9600);
  assert.equal(parsed.papers[0].continuation.contextVersion, 'version-a');
});

test('recovery preserves the newest canonical evidence independently from truncated model messages', () => {
  const citation = { id: 'source-a', label: '1', paperId: 'paper-a', paperTitle: 'Paper A', sourceType: 'pdf-text',
    pageIndex: 25, blockId: 'block-a', previewText: 'original snippet'.repeat(1000) };
  const events = [event(1, 'checkpoint', { messages: [], citations: [{ ...citation, id: 'old' }] }),
    event(2, 'checkpoint', { messages: [], citations: [citation, { id: 'bad' }] })];
  assert.deepEqual(latestAgentRecoveryCitations(events), [citation]);
  assert.deepEqual(latestAgentRecoveryCitations(events.concat(event(3, 'checkpoint', { messages: [] }))), []);
});

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
  assert.deepEqual(chat.map((message) => message.role), ['user', 'assistant']);
  assert.deepEqual(chat.map((message) => message.content), ['current request', 'complete answer']);
});

test('interrupted tool-turn recovery hides drafts and empty chat messages while the loop resumes intact', async () => {
  const controller = new AbortController();
  const events: AgentRunEventRecord[] = [];
  const draft = '先检索目标文献，然后汇总证据。';
  const toolContent = JSON.stringify({ papers: [{ paperId: 'paper-a', text: 'Evidence [[cite:c1]]',
    contextVersion: 'version-a', continuation: { offset: 128, contextVersion: 'version-a', canContinue: true } }] });
  let toolExecutions = 0;
  const tool: AgentToolDefinition = {
    name: 'request_paper_context', description: 'Read paper evidence', kind: 'read',
    parameters: { type: 'object' },
    execute: async () => {
      toolExecutions += 1;
      return { content: toolContent };
    },
  };
  const options = {
    tools: [tool], mountContext: { papersCount: 1, hasOpenDocument: true, ragReady: true, localLibraryMode: true },
    runtimeContext: {}, contextLabel: 'selected paper',
  };
  await assert.rejects(runAgentLoop({
    ...options,
    messages: [
      { role: 'system', content: 'root' },
      { role: 'user', content: 'previous request' },
      { role: 'assistant', content: 'previous final answer', toolCalls: [] },
      { role: 'user', content: '' },
      { role: 'assistant', content: ' \n\t' },
      { role: 'user', content: 'current request' },
    ],
    signal: controller.signal,
    chatTurn: async () => ({ content: draft, finishReason: 'tool_calls',
      toolCalls: [{ id: 'call-1', name: tool.name, arguments: { paperIds: ['paper-a'] } }] }),
    onCheckpoint: ({ messages }) => {
      // Persist and reload the checkpoint as the interrupted workspace does.
      events.push(event(1, 'checkpoint', { messages: JSON.parse(JSON.stringify(messages)) }));
      controller.abort();
    },
  }), { name: 'AbortError' });

  const checkpoint = latestAgentRecoveryCheckpoint(events);
  assert.ok(checkpoint);
  const beforePresentation = JSON.stringify(checkpoint);
  const chat = recoveryCheckpointToChatMessages(checkpoint);
  assert.deepEqual(chat.map(({ content }) => content), ['previous request', 'previous final answer', 'current request']);
  assert.equal(JSON.stringify(checkpoint), beforePresentation);
  assert.equal(checkpoint.at(-2)?.content, draft);
  assert.equal(checkpoint.at(-2)?.toolCalls?.[0]?.id, 'call-1');
  assert.equal(checkpoint.at(-1)?.toolCallId, 'call-1');

  const finalAnswer = '证据已汇总，最终回答。';
  const resumed = await runAgentLoop({
    ...options,
    messages: [...checkpoint, { role: 'user', content: 'current request' }],
    chatTurn: async ({ messages }) => {
      assert.equal(messages.at(-3)?.content, draft);
      assert.deepEqual(messages.at(-3)?.toolCalls?.[0]?.arguments, { paperIds: ['paper-a'] });
      const savedResult = JSON.parse(messages.at(-2)!.content);
      assert.equal(savedResult.result, toolContent);
      assert.equal(JSON.parse(savedResult.result).papers[0].continuation.contextVersion, 'version-a');
      return { content: finalAnswer, toolCalls: [], finishReason: 'stop' };
    },
    onCheckpoint: ({ messages }) => events.push(event(2, 'checkpoint', { messages: JSON.parse(JSON.stringify(messages)) })),
  });
  assert.equal(resumed.kind, 'answer');
  assert.equal(resumed.answer, finalAnswer);
  assert.equal(toolExecutions, 1);
  const resumedChat = recoveryCheckpointToChatMessages(latestAgentRecoveryCheckpoint(events)!);
  assert.equal(resumedChat.at(-1)?.content, finalAnswer);
  assert.ok(resumedChat.every(({ content }) => content.trim() && content !== draft));
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

test('recovery backward compatibility: checkpoint without capabilityId defaults to comparative-survey', () => {
  const checkpoint = latestComparativeSurveyCheckpoint([
    event(1, 'checkpoint', {
      // 旧版 checkpoint 没有 capabilityId 字段
      artifacts: {
        rephrasedQuestion: 'Old legacy question',
        completedStages: ['rephrase'],
      },
    }),
  ]);

  assert.ok(checkpoint);
  assert.equal(checkpoint.rephrasedQuestion, 'Old legacy question');
  assert.deepEqual(checkpoint.completedStages, ['rephrase']);
});

test('comparative recovery preserves canonical token identity and display label', () => {
  const checkpoint = latestComparativeSurveyCheckpoint([event(1, 'checkpoint', {
    artifacts: { citations: [{ id: 'source-a', label: '7', paperId: 'paper-a', paperTitle: 'Paper A' }] },
  })]);
  assert.equal(checkpoint?.citations?.[0].id, 'source-a');
  assert.equal(checkpoint?.citations?.[0].label, '7');
});

test('comparative recovery preserves a normalized coverage ledger when present', () => {
  const checkpoint = latestComparativeSurveyCheckpoint([event(1, 'checkpoint', {
    capabilityId: 'comparative-survey',
    artifacts: {
      coverage: {
        version: 1,
        runState: 'partial',
        papers: [{
          paperId: 'paper-a',
          candidate: true,
          abstractReviewed: true,
          bodySearched: false,
          focusedRead: false,
          cited: false,
          unresolved: true,
          irrelevant: false,
          failed: false,
          attempts: 1,
          citationIds: ['c1', 'c1'],
          subquestionIds: ['q1'],
        }],
        subquestions: [{
          id: 'q1',
          question: 'Missing evidence?',
          state: 'partial',
          candidatePaperIds: ['paper-a'],
          evidenceCitationIds: [],
          evidenceGaps: ['No full text'],
          completedPaperIds: [],
          failedPaperIds: [],
        }],
        budget: { maxPapers: 1, promptTokens: 2, completionTokens: 3, elapsedMilliseconds: 4 },
        updatedAt: 123,
      },
    },
  })]);

  assert.equal(checkpoint?.coverage?.runState, 'partial');
  assert.equal(checkpoint?.coverage?.papers[0]?.unresolved, true);
  assert.deepEqual(checkpoint?.coverage?.papers[0]?.citationIds, ['c1']);
  assert.deepEqual(checkpoint?.coverage?.subquestions[0]?.evidenceGaps, ['No full text']);
});

test('comparative recovery preserves unsynthesized body excerpts and rejects malformed checkpoint entries', () => {
  const checkpoint = latestComparativeSurveyCheckpoint([event(1, 'checkpoint', {
    capabilityId: 'comparative-survey', artifacts: { researchContexts: [
      { paperId: 'paper-a', subquestionId: 'q1', source: 'pdf-text', text: 'Actual [[cite:c1]]', citationIds: ['c1', 'c1'] },
      { paperId: 'paper-b', subquestionId: 'q1', source: 'pdf-text', text: 9, citationIds: ['bad'] },
      null,
    ] },
  })]);
  assert.deepEqual(checkpoint?.researchContexts, [{
    paperId: 'paper-a', subquestionId: 'q1', source: 'pdf-text', text: 'Actual [[cite:c1]]', citationIds: ['c1'],
  }]);
});
