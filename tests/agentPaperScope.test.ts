import test from 'node:test';
import assert from 'node:assert/strict';

import type { LiteraturePaper } from '../src/types/library.ts';
import { resolveAgentPaperIds, resolveAgentPaperScope } from '../src/services/agentPaperScope.ts';
import { createLibraryAgentTools } from '../src/services/agentTools.ts';

function paper(id: string, title = id): LiteraturePaper {
  return {
    id,
    title,
    titleZh: null,
    year: null,
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
    keywords: [],
    importedAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: false,
    userNote: null,
    aiSummary: null,
    citation: null,
    source: 'local',
    sortOrder: 0,
    authors: [],
    tags: [],
    categoryIds: [],
    attachments: [],
  };
}

const context = { signal: undefined, citations: [] };

test('scope resolver keeps explicit empty scopes empty and rejects out-of-scope IDs', () => {
  const papers = [paper('paper-a'), paper('paper-b')];
  const empty = resolveAgentPaperScope(papers, []);
  assert.equal(empty.mode, 'empty');
  assert.deepEqual(empty.papers, []);
  assert.equal(resolveAgentPaperIds(empty, []).error?.code, 'empty_scope');

  const selected = resolveAgentPaperScope(papers, ['paper-a']);
  const result = resolveAgentPaperIds(selected, ['paper-b']);
  assert.equal(result.error?.code, 'paper_out_of_scope');
  assert.deepEqual(result.error?.paperIds, ['paper-b']);
});

test('rag_search defaults to the current scope and never exposes stale papers', async () => {
  const calls: Array<string[] | undefined> = [];
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a'), paper('paper-b')],
    currentPaperScopeIds: ['paper-a'],
    searchRag: async (input) => {
      calls.push(input.paperIds);
      return {
        chunks: [
          { citationId: 'a', evidenceToken: '[[cite:a]]', paperId: 'paper-a', page: 1, blockId: null, snippet: 'A' },
          { citationId: 'b', evidenceToken: '[[cite:b]]', paperId: 'paper-b', page: 1, blockId: null, snippet: 'B' },
        ],
      };
    },
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const tool = tools.find((candidate) => candidate.name === 'rag_search')!;
  const result = await tool.execute({ query: 'query' }, { ...context, signal: undefined });
  const payload = JSON.parse(result.content);

  assert.deepEqual(calls, [['paper-a']]);
  assert.deepEqual(payload.chunks.map((chunk: { paperId: string }) => chunk.paperId), ['paper-a']);
  assert.equal(payload.matchedCount, 1);
  assert.equal(payload.returnedCount, 1);
  assert.equal(payload.truncated, false);
  assert.equal(result.cards?.[0]?.title, '1 RAG evidence snippets');
});

test('fallback rag_search exposes a deterministic top-k chunk batch', async () => {
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a')],
    getPaperContext: async () => ({
      text: 'fallback context',
      source: 'pdf-text',
      citations: Array.from({ length: 14 }, (_, index) => ({
        id: `citation-${index + 1}`,
        label: '',
        sourceType: 'pdf-text' as const,
        pageIndex: index,
        blockId: `block-${index + 1}`,
        previewText: `Evidence ${index + 1}`,
      })),
    }),
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const tool = tools.find((candidate) => candidate.name === 'rag_search')!;
  const payload = JSON.parse((await tool.execute({ query: 'query' }, { ...context, signal: undefined })).content);

  assert.equal(payload.status, 'ok');
  assert.equal(payload.coverage, 'top-k-batch');
  assert.equal(payload.countUnit, 'chunks');
  assert.equal(payload.batchLimit, 12);
  assert.equal(payload.matchedCount, 12);
  assert.equal(payload.returnedCount, 12);
  assert.equal(payload.truncated, false);
  assert.deepEqual(payload.chunks.map((chunk: { citationId: string }) => chunk.citationId), Array.from({ length: 12 }, (_, index) => `citation-${index + 1}`));
});

test('rag_search and context requests return structured scope errors', async () => {
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a'), paper('paper-b')],
    currentPaperScopeIds: ['paper-a'],
    searchRag: async () => ({ chunks: [] }),
    getPaperContext: async (target) => ({ text: target.title, source: 'test' }),
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const rag = tools.find((candidate) => candidate.name === 'rag_search')!;
  const contextTool = tools.find((candidate) => candidate.name === 'request_paper_context')!;

  const ragPayload = JSON.parse((await rag.execute({ query: 'q', paperIds: ['paper-b'] }, context)).content);
  const contextPayload = JSON.parse((await contextTool.execute({ mode: 'summary', reason: 'r', paperIds: ['paper-b'] }, context)).content);
  assert.equal(ragPayload.status, 'scope_error');
  assert.equal(contextPayload.status, 'scope_error');

  const emptyTools = createLibraryAgentTools({
    papers: [paper('paper-a')],
    currentPaperScopeIds: [],
    searchRag: async () => ({ chunks: [] }),
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const emptyPayload = JSON.parse((await emptyTools.find((candidate) => candidate.name === 'rag_search')!.execute({ query: 'q' }, context)).content);
  assert.equal(emptyPayload.status, 'scope_error');
  assert.equal(emptyPayload.error.code, 'empty_scope');
});

test('scope errors preserve unknown and out-of-scope ID details', async () => {
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a'), paper('paper-b')],
    currentPaperScopeIds: ['paper-a'],
    searchRag: async () => ({ chunks: [] }),
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const rag = tools.find((candidate) => candidate.name === 'rag_search')!;
  const payload = JSON.parse((await rag.execute({ query: 'q', paperIds: ['paper-b', 'missing'] }, context)).content);
  assert.equal(payload.error.code, 'paper_scope_mixed');
  assert.deepEqual(payload.error.unknownPaperIds, ['missing']);
  assert.deepEqual(payload.error.outOfScopePaperIds, ['paper-b']);
});

test('request_paper_context permits omitted paperIds and uses the full library when scope is omitted', async () => {
  const requested: string[] = [];
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a'), paper('paper-b')],
    getPaperContext: async (target) => {
      requested.push(target.id);
      return { text: target.title, source: 'test' };
    },
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const contextTool = tools.find((candidate) => candidate.name === 'request_paper_context')!;
  const definition = contextTool.parameters as { required?: string[] };
  assert.deepEqual(definition.required, ['mode', 'reason']);
  const payload = JSON.parse((await contextTool.execute({ mode: 'summary', reason: 'r' }, context)).content);
  assert.equal(payload.status, 'ok');
  assert.deepEqual(requested, ['paper-a', 'paper-b']);
  assert.equal(payload.requestedCount, 2);
});

test('paper context batches expose every omitted ID and permit fetching the remaining papers', async () => {
  const requested: string[] = [];
  const tools = createLibraryAgentTools({
    papers: Array.from({ length: 9 }, (_, index) => paper(`paper-${index}`)),
    getPaperContext: async (target) => {
      requested.push(target.id);
      return { text: target.title, source: 'summary' };
    },
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const tool = tools.find((candidate) => candidate.name === 'request_paper_context')!;
  const first = JSON.parse((await tool.execute({ mode: 'summary', reason: 'read candidates' }, context)).content);
  assert.equal(first.requestedCount, 9);
  assert.equal(first.returnedCount, 5);
  assert.equal(first.countUnit, 'papers');
  assert.equal(first.continuation.canContinue, true);
  assert.deepEqual(first.omittedPaperIds, ['paper-5', 'paper-6', 'paper-7', 'paper-8']);
  const second = JSON.parse((await tool.execute({ mode: 'summary', reason: 'read candidates', paperIds: first.omittedPaperIds }, context)).content);
  assert.equal(second.returnedCount, 4);
  assert.equal(second.truncated, false);
  assert.deepEqual(second.omittedPaperIds, []);
  assert.deepEqual(requested, Array.from({ length: 9 }, (_, index) => `paper-${index}`));
});

test('paper text continuation concatenates the original source without split tokens or characters', async () => {
  const citation = { id: 'context-1', label: '1', sourceType: 'pdf-text' as const,
    pageIndex: 0, blockId: 'block-1', previewText: 'Evidence for continuation.' };
  const token = '[[cite:context-1]]';
  const source = `Introduction.\n\n${'x'.repeat(120)}${token}😀${'tail '.repeat(80)}.\n\nConclusion.`;
  const inputs: Array<{ mode: string; query: string; fullText?: boolean }> = [];
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a')],
    getPaperContext: async (_target, input) => {
      inputs.push(input);
      return { text: source, source: 'pdf-text', citations: [citation] };
    },
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const tool = tools.find((candidate) => candidate.name === 'request_paper_context')!;
  let args: Record<string, unknown> = { mode: 'pdf-text', reason: 'full original text', paperIds: ['paper-a'], fullText: true, maxChars: 128 };
  let assembled = '';
  let cursor = 0;
  let segments = 0;
  while (segments < 20) {
    const payload = JSON.parse((await tool.execute(args, context)).content);
    assert.equal(payload.status, 'ok');
    const record = payload.papers[0];
    assert.equal(record.sourceCoverage, 'document-text');
    assert.equal(record.textStart, cursor);
    assert.equal(record.text, source.slice(record.textStart, record.textEnd));
    assert.ok(record.textEnd > cursor);
    assert.doesNotMatch(record.text, /\[\[cite:[^\]]*$/);
    assert.doesNotMatch(record.text, /[\uD800-\uDBFF]$/);
    assert.doesNotMatch(record.text, /^[\uDC00-\uDFFF]/);
    assert.equal(record.citations.length, record.text.includes(token) ? 1 : 0);
    assembled += record.text;
    cursor = record.textEnd;
    segments += 1;
    if (!record.continuation.canContinue) break;
    args = record.continuation;
  }
  assert.ok(segments > 1 && segments < 20);
  assert.equal(assembled, source);
  assert.equal(cursor, source.length);
  assert.ok(inputs.every((input) => input.fullText === true && input.query === 'full original text'));
});

test('paper snippet continuations retain the overlapping canonical source after its header', async () => {
  const firstCitation = { id: 'context-first', label: '1', paperId: 'paper-a', paperTitle: 'Paper A',
    sourceType: 'pdf-text' as const, pageIndex: 2, blockId: null, previewText: 'First source.' };
  const secondCitation = { ...firstCitation, id: 'context-second', label: '2', pageIndex: 7, previewText: 'Second source.' };
  const firstToken = '[[cite:context-first]]';
  const secondToken = '[[cite:context-second]]';
  const source = `# Source ${firstToken}\n${'first '.repeat(65)}\n\n# Source ${secondToken}\n${'second '.repeat(45)}`;
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a')],
    getPaperContext: async () => ({ text: source, source: 'pdf-text-rag', citations: [firstCitation, secondCitation] }),
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const tool = tools.find((candidate) => candidate.name === 'request_paper_context')!;
  let args: Record<string, unknown> = { mode: 'pdf-text', reason: 'q', paperIds: ['paper-a'], maxChars: 128 };
  let sawFirstBodyContinuation = false;
  let sawSecondBodyContinuation = false;
  const secondStart = source.indexOf('# Source ' + secondToken);
  for (let segment = 0; segment < 20; segment += 1) {
    const record = JSON.parse((await tool.execute(args, context)).content).papers[0];
    assert.ok(record.textEnd > record.textStart);
    const expected = [
      ...(record.textStart < secondStart ? [firstCitation] : []),
      ...(record.textEnd > secondStart ? [secondCitation] : []),
    ];
    assert.deepEqual(record.citations.map((item: { id: string }) => item.id), expected.map((item) => item.id));
    for (const item of record.citations) assert.equal(item.evidenceToken, `[[cite:${item.id}]]`);
    if (record.textStart > 0 && record.textEnd <= secondStart && !record.text.includes(firstToken)) sawFirstBodyContinuation = true;
    if (record.textStart > secondStart && !record.text.includes(secondToken)) sawSecondBodyContinuation = true;
    if (!record.continuation.canContinue) break;
    args = record.continuation;
  }
  assert.ok(sawFirstBodyContinuation && sawSecondBodyContinuation);
});

test('paper continuation rejects missing versions, changed sources, and offsets inside evidence', async () => {
  let source = `${'x'.repeat(140)}[[cite:source-a]]${'suffix '.repeat(40)}`;
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a')],
    getPaperContext: async () => ({ text: source, source: 'pdf-text-rag' }),
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const tool = tools.find((candidate) => candidate.name === 'request_paper_context')!;
  const base = { mode: 'pdf-text', reason: 'q', paperIds: ['paper-a'], maxChars: 128 };
  const first = JSON.parse((await tool.execute(base, context)).content).papers[0];
  assert.equal(first.sourceCoverage, 'retrieved-snippets');
  const missingVersion = JSON.parse((await tool.execute({ ...base, offset: first.textEnd }, context)).content);
  assert.equal(missingVersion.code, 'context_version_required');
  const invalid = JSON.parse((await tool.execute({ ...first.continuation, offset: source.indexOf('[[cite:') + 3 }, context)).content);
  assert.equal(invalid.status, 'continuation_error');
  assert.equal(invalid.papers[0].code, 'invalid_offset');
  const outOfRange = JSON.parse((await tool.execute({ ...first.continuation, offset: source.length + 1 }, context)).content);
  assert.equal(outOfRange.papers[0].code, 'offset_out_of_range');
  source += ' Source changed.';
  const changed = JSON.parse((await tool.execute(first.continuation, context)).content);
  assert.equal(changed.status, 'continuation_error');
  assert.equal(changed.papers[0].code, 'context_changed');
});

test('graph tools keep focus papers inside the run scope and default missing-edge searches to that scope', async () => {
  const tools = createLibraryAgentTools({
    papers: [paper('paper-a'), paper('paper-b')],
    currentPaperScopeIds: ['paper-a'],
    createWritePlan: () => ({ id: 'plan', tool: 'metadata', title: '', description: '', items: [], createdAt: 1 }),
  });
  const neighbors = tools.find((candidate) => candidate.name === 'graph_neighbors')!;
  const missingEdges = tools.find((candidate) => candidate.name === 'graph_missing_edges')!;
  const neighborPayload = JSON.parse((await neighbors.execute({ paperId: 'paper-b' }, context)).content);
  const missingPayload = JSON.parse((await missingEdges.execute({}, context)).content);
  assert.equal(neighborPayload.status, 'scope_error');
  assert.deepEqual(neighborPayload.error.outOfScopePaperIds, ['paper-b']);
  assert.equal(missingPayload.status, undefined);
  assert.deepEqual(missingPayload.missingEdges, []);
  assert.match(missingPayload.note, /at least two known library papers/i);
});
