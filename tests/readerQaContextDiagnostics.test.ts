import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQaContext, formatQaContextHint, getQaContextBadgeTone } from '../src/features/reader/readerQaContext.ts';

const chinese = (zh: string) => zh;

test('reader QA retains retrieval diagnostics and warns on degraded or partial sources', () => {
  const context = buildQaContext({
    origin: 'local-rag',
    rag: { kind: 'retrieved', documentText: 'evidence', retrievedChunkCount: 1,
      citations: [], retrievals: [], ftsStatuses: ['unavailable'], ftsHitCount: 0, partialSources: true },
  });
  assert.equal(getQaContextBadgeTone(context), 'warning');
  assert.match(formatQaContextHint(context, chinese) ?? '', /关键词索引不可用/);
  assert.match(formatQaContextHint(context, chinese) ?? '', /部分来源索引尚未就绪/);
});

test('reader QA distinguishes keyword misses from failures after an empty retrieval', () => {
  const context = buildQaContext({
    origin: 'pdf-text', rag: { kind: 'empty', ftsStatuses: ['searched'], ftsHitCount: 0 },
  });
  assert.match(formatQaContextHint(context, chinese) ?? '', /关键词通道已检索，命中 0/);
  assert.doesNotMatch(formatQaContextHint(context, chinese) ?? '', /关键词检索失败/);
});
