import test from 'node:test';
import assert from 'node:assert/strict';

import type { LiteraturePaper } from '../src/types/library.ts';
import { sliceAgentToolText } from '../src/services/agentToolContent.ts';
import { truncateToolContent } from '../src/services/agentLoop.ts';
import { createLibraryAgentTools } from '../src/services/agentTools.ts';

const paperId = '9cf43861-084d-4b3d-9816-1b5d843c117b';
const citationId = `agent-context:${paperId}:pdf-text:${'a'.repeat(64)}:0:1600`;
const token = `[[cite:${citationId}]]`;

const paper: LiteraturePaper = {
  id: paperId, title: 'Paper A', titleZh: null, year: null, publication: null,
  doi: null, url: null, abstractText: null, keywords: [], importedAt: 1, updatedAt: 1,
  lastReadAt: null, readingProgress: 0, isFavorite: false, userNote: null,
  aiSummary: null, citation: null, source: 'local', sortOrder: 0, authors: [],
  tags: [], categoryIds: [], attachments: [],
};

function contextTool(source: string, evidenceId = citationId) {
  return createLibraryAgentTools({
    papers: [paper],
    getPaperContext: async () => ({
      text: source, source: 'pdf-text-rag',
      citations: [{ id: evidenceId, label: '1', paperId, paperTitle: paper.title,
        sourceType: 'pdf-text', pageIndex: 0, blockId: null, previewText: 'Source evidence.' }],
    }),
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  }).find((tool) => tool.name === 'request_paper_context')!;
}

test('a canonical evidence token longer than the prose budget advances an exact-start cursor', () => {
  assert.ok(token.length > 128);
  const source = `prefix ${token} evidence body`;
  const start = source.indexOf(token);
  const slice = sliceAgentToolText(source, 128, start);
  assert.equal(slice.text, token);
  assert.equal(slice.offset, start + token.length);
  assert.equal(slice.truncated, true);
});

test('minimum-size context pages resume through long canonical tokens without losing source identity', async () => {
  const source = `# Source ${token}\n${'evidence 😀 body '.repeat(35)}\n\nConclusion.`;
  const tool = contextTool(source);
  let args: Record<string, unknown> = { mode: 'pdf-text', reason: 'q', paperIds: [paperId], maxChars: 128 };
  let assembled = '';
  let contextVersion: string | undefined;
  let sawAtomicPage = false;
  for (let segment = 0; segment < 20; segment += 1) {
    const payload = JSON.parse((await tool.execute(args, { citations: [] })).content);
    assert.equal(payload.status, 'ok');
    const record = payload.papers[0];
    assert.equal(record.textStart, assembled.length);
    assert.ok(record.textEnd > record.textStart);
    assert.equal(record.text, source.slice(record.textStart, record.textEnd));
    assert.ok(record.text.length <= 1600);
    contextVersion ??= record.contextVersion;
    assert.equal(record.contextVersion, contextVersion);
    assert.equal(record.citations[0].id, citationId);
    assert.equal(record.citations[0].evidenceToken, token);
    if (record.textStart === source.indexOf(token)) {
      assert.equal(record.text, token);
      sawAtomicPage = true;
    }
    assembled += record.text;
    if (!record.continuation.canContinue) break;
    assert.equal(record.continuation.offset, record.textEnd);
    assert.equal(record.continuation.contextVersion, contextVersion);
    args = record.continuation;
  }
  assert.ok(sawAtomicPage);
  assert.equal(assembled, source);
});

test('secondary JSON budgets retain a progressing atomic page or explicitly omit its whole record', () => {
  const textStart = 320;
  const originalText = token + ' evidence body '.repeat(120);
  const contextVersion = 'a'.repeat(64);
  const payload = {
    mode: 'pdf-text', status: 'ok', requestedCount: 1, matchedCount: 1, returnedCount: 1,
    countUnit: 'papers', omittedPaperIds: [], truncated: true,
    continuation: { canContinue: true, tool: 'request_paper_context', omittedPaperIds: [] },
    papers: [{ paperId, title: paper.title, source: 'pdf-text-rag', sourceCoverage: 'retrieved-snippets',
      text: originalText, textStart, textEnd: textStart + originalText.length,
      totalTextChars: 5000, textTruncated: true, citations: [], contextVersion,
      continuation: { canContinue: true, tool: 'request_paper_context', paperIds: [paperId],
        mode: 'pdf-text', reason: 'q', fullText: false, offset: textStart + originalText.length,
        maxChars: 1600, contextVersion } }],
  };
  let sawRetainedAtomicPage = false;
  let sawOmittedRecord = false;
  for (const budget of [900, 1000, 1100, 1200, 1400]) {
    const content = truncateToolContent(JSON.stringify(payload), budget);
    assert.ok(content.length <= budget);
    const clipped = JSON.parse(content);
    assert.equal(clipped.matchedCount, 1);
    assert.equal(clipped.returnedCount, clipped.papers.length);
    assert.equal(clipped.continuation.omittedRecords, 1 - clipped.returnedCount);
    if (clipped.papers.length === 0) {
      assert.deepEqual(clipped.omittedPaperIds, [paperId]);
      sawOmittedRecord = true;
      continue;
    }
    const record = clipped.papers[0];
    assert.ok(record.textEnd > record.textStart);
    assert.equal(record.text, originalText.slice(0, record.textEnd - textStart));
    assert.ok(record.text.includes(token));
    assert.equal(record.contextVersion, contextVersion);
    assert.equal(record.continuation.contextVersion, contextVersion);
    assert.equal(record.continuation.offset, record.textEnd);
    assert.equal(record.continuation.canContinue, true);
    if (record.text === token) sawRetainedAtomicPage = true;
  }
  assert.ok(sawRetainedAtomicPage);
  assert.ok(sawOmittedRecord);
});

test('an indivisible token exceeding the maximum context page returns an explicit budget error', async () => {
  const oversizedId = 'source-' + 'x'.repeat(1600);
  const oversizedToken = `[[cite:${oversizedId}]]`;
  const tool = contextTool(oversizedToken + ' remaining body', oversizedId);
  const payload = JSON.parse((await tool.execute({
    mode: 'pdf-text', reason: 'q', paperIds: [paperId], maxChars: 1600,
  }, { citations: [] })).content);
  assert.equal(payload.status, 'continuation_error');
  const record = payload.papers[0];
  assert.equal(record.code, 'evidence_token_exceeds_page_budget');
  assert.equal(record.requiredChars, oversizedToken.length);
  assert.equal(record.maximumPageChars, 1600);
  assert.equal(record.textStart, 0);
  assert.equal(record.textEnd, 0);
  assert.equal(record.text, undefined);
  assert.equal(record.continuation.canContinue, false);
  assert.equal(typeof record.contextVersion, 'string');
});
