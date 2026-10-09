import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runAgentLoop,
  truncateToolContent,
  type AgentChatTurnRequest,
  type AgentLoopOptions,
  type AgentToolDefinition,
} from '../src/services/agentLoop.ts';
import { sliceAgentToolText } from '../src/services/agentToolContent.ts';

test('paragraph clipping keeps evidence tokens and Unicode characters indivisible', () => {
  const token = '[[cite:source-123456]]';
  const source = `prefix ${token}😀 suffix`;
  const beforeToken = sliceAgentToolText(source, 16);
  assert.equal(beforeToken.text, 'prefix ');
  const tokenPage = sliceAgentToolText(source, token.length, beforeToken.offset);
  assert.equal(tokenPage.text, token);
  const beforeSurrogate = sliceAgentToolText(source, 1, tokenPage.offset);
  assert.equal(beforeSurrogate.text, '');
  assert.equal(beforeSurrogate.offset, tokenPage.offset);
  const last = sliceAgentToolText(source, 30, tokenPage.offset);
  assert.equal(beforeToken.text + tokenPage.text + last.text, source);
});

test('structured tool truncation keeps JSON, evidence identity, and count units', () => {
  const payload = {
    status: 'ok',
    matchedCount: 3,
    chunks: [1, 2, 3].map((index) => ({
      citationId: `agent-rag:paper-${index}:pdf-text:chunk-${index}`,
      evidenceToken: `[[cite:agent-rag:paper-${index}:pdf-text:chunk-${index}]]`,
      paperId: `paper-${index}`,
      page: index,
      blockId: `block-${index}`,
      snippet: `第一段证据 ${index}。\n\n第二段证据 ${index}。\n\n第三段证据 ${index}。`,
    })),
    ragErrors: [],
  };

  const content = truncateToolContent(JSON.stringify(payload), 560);
  assert.ok(content.length <= 560);
  const result = JSON.parse(content) as typeof payload & {
    returnedCount: number;
    truncated: boolean;
    continuation?: { omittedRecords: number };
  };
  assert.equal(result.matchedCount, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.returnedCount, result.chunks.length);
  assert.equal(result.continuation?.omittedRecords, 3 - result.returnedCount);
  for (const chunk of result.chunks) {
    assert.match(chunk.citationId, /^agent-rag:paper-\d+:pdf-text:chunk-\d+$/);
    assert.equal(chunk.evidenceToken, `[[cite:${chunk.citationId}]]`);
    assert.match(chunk.paperId, /^paper-\d+$/);
    assert.equal(typeof chunk.page, 'number');
    assert.equal(typeof chunk.blockId, 'string');
  }
});

test('plain text tool truncation returns a parseable continuation envelope', () => {
  const content = truncateToolContent('段落一。\n\n段落二。\n\n' + 'x'.repeat(800), 240);
  assert.ok(content.length <= 240);
  const result = JSON.parse(content) as {
    status: string;
    text: string;
    truncated: boolean;
    continuation?: { offset: number };
  };
  assert.equal(result.status, 'truncated');
  assert.equal(result.truncated, true);
  assert.ok(result.text.length < 850);
  // Offset is measured in the original text and includes the omitted
  // paragraph separator after the returned prefix.
  assert.equal(result.continuation?.offset, 12);
});

test('further JSON clipping updates a paged record cursor and its false truncation flag', () => {
  const originalText = 'word '.repeat(600);
  const payload = { status: 'ok', countUnit: 'papers', matchedCount: 1, returnedCount: 1, truncated: false,
    omittedPaperIds: [], continuation: { canContinue: false, tool: 'request_paper_context' },
    papers: [{ paperId: 'paper-a', text: originalText, textStart: 100, textEnd: 100 + originalText.length,
      textTruncated: false, contextVersion: 'version-a',
      continuation: { canContinue: false, tool: 'request_paper_context', paperIds: ['paper-a'], offset: 100 + originalText.length, contextVersion: 'version-a' } }] };
  const content = truncateToolContent(JSON.stringify(payload), 1000);
  assert.ok(content.length <= 1000);
  const clipped = JSON.parse(content);
  assert.equal(clipped.papers.length, 1);
  const record = clipped.papers[0];
  assert.equal(record.textTruncated, true);
  assert.equal(record.text, originalText.slice(0, record.textEnd - record.textStart));
  assert.equal(record.continuation.offset, record.textEnd);
  assert.equal(record.continuation.contextVersion, 'version-a');
  assert.equal(record.continuation.canContinue, true);
  assert.equal(clipped.continuation.canContinue, true);
});

test('JSON budgets preserve all omitted paper IDs and add selected-away context records', () => {
  const omitted = Array.from({ length: 24 }, (_, index) => `remaining-paper-${index}`);
  const payload = { status: 'ok', countUnit: 'papers', matchedCount: 26, returnedCount: 2, truncated: true,
    omittedPaperIds: omitted, continuation: { canContinue: true, tool: 'request_paper_context', omittedPaperIds: omitted },
    papers: [{ paperId: 'paper-a', text: 'first '.repeat(600) }, { paperId: 'paper-b', identity: 'z'.repeat(3000), text: 'second' }] };
  const content = truncateToolContent(JSON.stringify(payload), 2400);
  assert.ok(content.length <= 2400);
  const result = JSON.parse(content);
  assert.equal(result.papers.length, 1);
  assert.deepEqual(result.omittedPaperIds, [...omitted, 'paper-b']);
  assert.deepEqual(result.continuation.omittedPaperIds, [...omitted, 'paper-b']);
  assert.equal(result.matchedCount, 26);
  assert.equal(result.returnedCount, 1);
  assert.equal(result.continuation.omittedRecords, 25);
});

test('oversized identity metadata returns an explicit empty budget error instead of partial JSON prose', () => {
  const payload = { status: 'ok', countUnit: 'chunks', matchedCount: 2,
    sourceIdentity: 'stable-but-long-identity'.repeat(300),
    chunks: [{ citationId: 'a', evidenceToken: '[[cite:a]]', paperId: 'paper-a', snippet: 'data' }] };
  const content = truncateToolContent(JSON.stringify(payload), 500);
  assert.ok(content.length <= 500);
  const result = JSON.parse(content);
  assert.equal(result.status, 'budget_exceeded');
  assert.equal(result.countUnit, 'chunks');
  assert.equal(result.matchedCount, 2);
  assert.equal(result.returnedCount, 0);
  assert.deepEqual(result.chunks, []);
  assert.equal(result.text, undefined);
});

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

test('nonempty length finish remains truncated on the final allowed turn', async () => {
  const events: Array<{ kind: string; finishReason?: string }> = [];
  const result = await runAgentLoop(loopOptions([], async () => ({ content: 'Partial answer.', finishReason: 'length' }), {
    maxTurns: 1,
    onEvent: (event) => events.push({ kind: event.kind, finishReason: 'finishReason' in event ? event.finishReason : undefined }),
  }));
  assert.equal(result.answer, 'Partial answer.');
  assert.equal(events.find((event) => event.kind === 'turn_end')?.finishReason, 'length');
});

test('empty stop responses are recorded as empty responses and never mislabeled as length', async () => {
  const calls: AgentChatTurnRequest[] = [];
  const reasons: string[] = [];
  await assert.rejects(runAgentLoop(loopOptions([], async (request) => {
    calls.push(request);
    return { content: '', finishReason: 'stop' };
  }, { onEvent: (event) => { if (event.kind === 'turn_end') reasons.push(event.finishReason); } })), (error: Error) => {
    assert.match(error.message, /模型未返回回答正文/);
    assert.doesNotMatch(error.message, /长度|length/);
    return true;
  });
  assert.deepEqual(reasons, ['empty_response', 'empty_response']);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].messages.some((message) => message.role === 'system' && message.content.includes('上一次模型未返回回答正文')));
  assert.ok(!calls[1].messages.some((message) => message.content.includes('上一次输出被长度限制')));
});

test('context-size retry discards previously emitted turn text and re-emits the successful draft', async () => {
  const events: Array<{ kind: string; text?: string; turn?: number }> = [];
  let attempts = 0;
  const result = await runAgentLoop(loopOptions([], async (request) => {
    attempts += 1;
    if (attempts === 1) {
      request.onAnswerDelta?.('discarded answer');
      request.onThinkingDelta?.('discarded thinking');
      throw new Error('maximum context length exceeded');
    }
    return { content: 'Successful answer.', thinking: 'Successful thinking.', finishReason: 'stop' };
  }, { onEvent: (event) => events.push({ kind: event.kind, text: 'text' in event ? event.text : undefined, turn: 'turn' in event ? event.turn : undefined }) }));
  assert.equal(result.answer, 'Successful answer.');
  assert.equal(attempts, 2);
  assert.deepEqual(events.filter((event) => event.kind === 'turn_start').map((event) => event.turn), [1, 1]);
  const secondStart = events.findIndex((event, index) => index > 0 && event.kind === 'turn_start');
  assert.deepEqual(events.slice(secondStart + 1).filter((event) => event.kind.endsWith('_delta')).map((event) => event.text), ['Successful thinking.', 'Successful answer.']);
});
