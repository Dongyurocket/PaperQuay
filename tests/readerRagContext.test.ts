import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMineruRagChunks, buildPdfRagChunks, buildRagContextText } from '../src/features/reader/readerRag.ts';
import type { RagChunkInput, RagRetrievalResult } from '../src/types/reader.ts';

const BODY_SEED_TEXT =
  'This paragraph describes the experimental setup in detail with several sentences of plain body text that cannot be confused with a section heading.';

function makeChunk(overrides: Partial<RagChunkInput> & { chunkId: string; chunkIndex: number }): RagChunkInput {
  return {
    pageIndex: null,
    blockId: null,
    text: '',
    ...overrides,
  };
}

function makeHit(overrides: Partial<RagRetrievalResult> & { chunkId: string }): RagRetrievalResult {
  return {
    sourceType: 'mineru-markdown',
    pageIndex: null,
    blockId: null,
    text: '',
    score: 0.1,
    ...overrides,
  };
}

function makePreparedSource(chunks: RagChunkInput[]) {
  return [{ sourceType: 'mineru-markdown' as const, sourceSignature: 'sig', chunks }];
}

test('PDF chunks preserve first, later, and empty-page locations', () => {
  const chunks = buildPdfRagChunks(`# Page 1\n${'Long first page. '.repeat(100)}\n# Page 2\nSecond page.`);
  assert.ok(chunks.filter((chunk) => chunk.pageIndex === 0).length > 1);
  assert.equal(chunks.at(-1)?.pageIndex, 1);
  assert.ok(!chunks[0]?.text.startsWith('# Page'));
  assert.equal(buildPdfRagChunks('# Page 3\nFirst nonempty page.')[0]?.pageIndex, 2);
  assert.equal(buildPdfRagChunks('# Page 1\n\n# Page 2\nSecond page.')[0]?.pageIndex, 1);
  assert.equal(buildPdfRagChunks('Plain text without a page marker.')[0]?.pageIndex, null);
});

test('legacy PDF first-page hit gets a location only when its text matches', () => {
  const chunks = buildPdfRagChunks(`# Page 3\n${'First nonempty page. '.repeat(100)}\n# Page 4\nNext page.`);
  const preparedSources = [{ sourceType: 'pdf-text' as const, sourceSignature: 'sig', chunks }];
  const oldText = `# Page 3\n${chunks[0]!.text.slice(0, 400)}`;
  const context = buildRagContextText({
    results: [makeHit({ sourceType: 'pdf-text', chunkId: 'pdf:0:0', text: oldText })],
    topK: 1,
    mineruBlocks: [],
    preparedSources,
  });
  assert.equal(context.citations[0]?.pageIndex, 2);
  assert.equal(context.retrievals[0]?.pageIndex, 2);
  assert.equal(context.retrievals.length, 1);

  for (const text of ['# Page 4\nFirst nonempty page.', '# Page 3\nUnrelated text.', 'First nonempty page.']) {
    const unmatched = buildRagContextText({
      results: [makeHit({ sourceType: 'pdf-text', chunkId: 'pdf:0:0', text })],
      topK: 1,
      mineruBlocks: [],
      preparedSources,
    });
    assert.equal(unmatched.citations[0]?.pageIndex, null);
  }
});

test('buildRagContextText expands plain-text hits with before/after neighbors in reading order', () => {
  const chunks = [
    makeChunk({ chunkId: 'c0', chunkIndex: 0, pageIndex: 0, blockId: 'b0', text: 'Previous paragraph context.' }),
    makeChunk({ chunkId: 'c1', chunkIndex: 1, pageIndex: 1, blockId: 'b1', text: BODY_SEED_TEXT }),
    makeChunk({ chunkId: 'c2', chunkIndex: 2, pageIndex: 1, blockId: 'b2', text: 'Following paragraph context.' }),
  ];
  const seed = makeHit({ chunkId: 'c1', pageIndex: 1, blockId: 'b1', text: BODY_SEED_TEXT });

  const context = buildRagContextText({
    results: [seed],
    topK: 1,
    mineruBlocks: [],
    preparedSources: makePreparedSource(chunks),
  });

  // 阅读顺序：前文切片 → 命中切片 → 后文切片。
  const i0 = context.documentText.indexOf('Previous paragraph context.');
  const i1 = context.documentText.indexOf(BODY_SEED_TEXT);
  const i2 = context.documentText.indexOf('Following paragraph context.');
  assert.ok(i0 >= 0 && i1 > i0 && i2 > i1, `expected before<hit<after order, got ${i0},${i1},${i2}`);

  // 引用锚点保留真实命中位置，不被补充段顶替。
  assert.equal(context.citations.length, 1);
  assert.equal(context.citations[0]?.chunkId, 'c1');
  assert.equal(context.citations[0]?.pageIndex, 1);

  // 直接命中在前；上下文补充标记 retrievalRole/expandedFrom 后追加，不冒充独立命中。
  assert.equal(context.retrievals.length, 3);
  assert.equal(context.retrievals[0]?.chunkId, 'c1');
  assert.equal(context.retrievals[0]?.retrievalRole, undefined);
  const supplements = context.retrievals.slice(1);
  assert.deepEqual(
    supplements.map((r) => `${r.chunkId}:${r.retrievalRole}:${r.expandedFrom}`).sort(),
    ['c0:context:c1', 'c2:context:c1'],
  );
});

test('buildRagContextText skips neighbors that exceed the per-target token budget', () => {
  const hugeBefore = `前文${'文'.repeat(5000)}`;
  const chunks = [
    makeChunk({ chunkId: 'big', chunkIndex: 0, text: hugeBefore }),
    makeChunk({ chunkId: 'hit', chunkIndex: 1, text: 'short body hit.' }),
    makeChunk({ chunkId: 'small', chunkIndex: 2, text: 'short after.' }),
  ];
  const seed = makeHit({ chunkId: 'hit', text: 'short body hit.' });

  const context = buildRagContextText({
    results: [seed],
    topK: 1,
    mineruBlocks: [],
    preparedSources: makePreparedSource(chunks),
  });

  // 超大前片超出单目标窗口预算被跳过；小后片仍补充。
  assert.ok(!context.documentText.includes(hugeBefore));
  assert.ok(context.documentText.includes('short after.'));
  assert.deepEqual(
    context.retrievals.map((r) => r.chunkId),
    ['hit', 'small'],
  );
});

test('buildRagContextText caps total context expansion at the per-question budget', () => {
  // 每个后片约 1300 tokens（CJK 1 token/字），单目标预算内可容纳；
  // 5 个命中共享 6000 tokens 问答预算，最后一个因剩余预算不足而跳过补充。
  const chunks: RagChunkInput[] = [];
  const seeds: RagRetrievalResult[] = [];

  for (let i = 0; i < 5; i += 1) {
    const hitText = `plain body hit number ${i} with enough words to stay a body paragraph.`;
    const afterText = `CTX${i}：${'文'.repeat(1300)}`;
    chunks.push(makeChunk({ chunkId: `hit-${i}`, chunkIndex: i * 2, text: hitText }));
    chunks.push(makeChunk({ chunkId: `after-${i}`, chunkIndex: i * 2 + 1, text: afterText }));
    seeds.push(makeHit({ chunkId: `hit-${i}`, text: hitText }));
  }

  const context = buildRagContextText({
    results: seeds,
    topK: 5,
    mineruBlocks: [],
    preparedSources: makePreparedSource(chunks),
  });

  for (let i = 0; i < 4; i += 1) {
    assert.ok(context.documentText.includes(`CTX${i}：`), `expected neighbor ${i} included`);
  }
  assert.ok(!context.documentText.includes('CTX4：'), 'expected last neighbor budget-capped');
});

test('buildRagContextText keeps heading expansion and marks supplements as context', () => {
  const mineruBlocks = [
    { blockId: 'b-title', pageIndex: 0, blockIndex: 0, type: 'title', content: '1. Introduction' },
    { blockId: 'b-p1', pageIndex: 0, blockIndex: 1, type: 'paragraph', content: 'Body paragraph follows the heading.' },
  ] as never;
  const chunks = [
    makeChunk({ chunkId: 'mineru:b-title:0', chunkIndex: 0, pageIndex: 0, blockId: 'b-title', text: '1. Introduction' }),
    makeChunk({ chunkId: 'mineru:b-p1:0', chunkIndex: 1, pageIndex: 0, blockId: 'b-p1', text: 'Body paragraph follows the heading.' }),
  ];
  const seed = makeHit({
    chunkId: 'mineru:b-title:0',
    pageIndex: 0,
    blockId: 'b-title',
    text: '1. Introduction',
  });

  const context = buildRagContextText({
    results: [seed],
    topK: 1,
    mineruBlocks,
    preparedSources: makePreparedSource(chunks),
  });

  assert.ok(context.documentText.includes('Body paragraph follows the heading.'));
  assert.equal(context.citations[0]?.chunkId, 'mineru:b-title:0');
  const supplement = context.retrievals.find((r) => r.chunkId === 'mineru:b-p1:0');
  assert.equal(supplement?.retrievalRole, 'context');
  assert.equal(supplement?.expandedFrom, 'mineru:b-title:0');
});

test('MinerU chunks keep the current heading and do not cross into the next section', () => {
  const chunks = buildMineruRagChunks([
    {
      type: 'title',
      blockId: 'h1',
      pageIndex: 0,
      blockIndex: 0,
      content: { text: 'Introduction', text_level: 1 },
    },
    {
      type: 'paragraph',
      blockId: 'p1',
      pageIndex: 0,
      blockIndex: 1,
      content: { text: 'Opening paragraph.' },
    },
    {
      type: 'title',
      blockId: 'h2',
      pageIndex: 0,
      blockIndex: 2,
      content: { text: 'Methods', text_level: 1 },
    },
    {
      type: 'paragraph',
      blockId: 'p2',
      pageIndex: 0,
      blockIndex: 3,
      content: { text: 'Method paragraph.' },
    },
  ]);

  const opening = chunks.find((chunk) => chunk.blockId === 'p1');
  const method = chunks.find((chunk) => chunk.blockId === 'p2');
  assert.equal(opening?.sectionId, 'h1');
  assert.deepEqual(opening?.sectionPath, ['Introduction']);
  assert.equal(opening?.startOffset, 0);
  assert.equal(method?.sectionId, 'h2');
  assert.deepEqual(method?.sectionPath, ['Methods']);
});

test('table extraction indexes both the caption and the table body', async () => {
  const { extractTextFromMineruBlock } = await import('../src/services/mineru.ts');
  const block = {
    type: 'table',
    blockId: 'table-1',
    pageIndex: 0,
    blockIndex: 0,
    content: {
      table_caption: [{ content: 'Table 1: Rotor noise levels' }],
      table_body: '<table><tr><td>Baseline</td><td>82 dB</td></tr></table>',
    },
  } as any;
  const text = extractTextFromMineruBlock(block);
  assert.match(text, /Rotor noise levels/);
  assert.match(text, /Baseline/);
  assert.match(text, /82 dB/);
});

test('citations carry paper identity, evidence kind and relevance', () => {
  const context = buildRagContextText({
    results: [makeHit({ chunkId: 'chunk-1', blockId: 'table-9', pageIndex: 4, text: 'table body' })],
    topK: 1,
    mineruBlocks: [{
      type: 'table', blockId: 'table-9', pageIndex: 4, blockIndex: 0,
      content: { table_caption: [{ content: 'Captions' }], html: '<table><tr><td>1</td></tr></table>' },
    } as any],
    preparedSources: makePreparedSource([makeChunk({ chunkId: 'chunk-1', chunkIndex: 0, blockId: 'table-9', pageIndex: 4, text: 'table body' })]),
    paperId: 'paper-a',
    paperTitle: 'Paper A',
  });
  assert.equal(context.citations[0]?.paperId, 'paper-a');
  assert.equal(context.citations[0]?.paperTitle, 'Paper A');
  assert.equal(context.citations[0]?.evidenceKind, 'table');
  assert.equal(context.citations[0]?.score, 0.1);
});

test('MinerU source signature carries the extractor version', async () => {
  const { prepareReaderRagDocument, MINERU_RAG_EXTRACTOR_VERSION } = await import('../src/features/reader/readerRag.ts');
  const prepared = prepareReaderRagDocument({
    item: { itemKey: 'p', workspaceId: 'p', title: 'P' } as any,
    settings: { ragSourceMode: 'mineru-markdown' },
    mineruBlocks: [{
      type: 'paragraph', blockId: 'b1', pageIndex: 0, blockIndex: 0,
      content: { paragraph_content: [{ type: 'text', content: 'Body text' }] },
    } as any],
    mineruDocumentText: 'Body text',
    pdfDocumentText: '',
  });
  assert.equal(prepared.sources.length, 1);
  assert.ok(MINERU_RAG_EXTRACTOR_VERSION.includes('v3'));
});

test('token budget drops the least relevant sections and reports the count', () => {
  const chunks = [
    makeChunk({ chunkId: 'c1', chunkIndex: 0, blockId: 'b1', text: BODY_SEED_TEXT }),
    makeChunk({ chunkId: 'c2', chunkIndex: 1, blockId: 'b2', text: BODY_SEED_TEXT }),
    makeChunk({ chunkId: 'c3', chunkIndex: 2, blockId: 'b3', text: BODY_SEED_TEXT.repeat(2) }),
    makeChunk({ chunkId: 'c4', chunkIndex: 3, blockId: 'b4', text: BODY_SEED_TEXT }),
  ];
  const context = buildRagContextText({
    results: [
      makeHit({ chunkId: 'c1', blockId: 'b1', text: BODY_SEED_TEXT }),
      makeHit({ chunkId: 'c3', blockId: 'b3', text: BODY_SEED_TEXT.repeat(2), score: 0.2 }),
    ],
    topK: 2,
    mineruBlocks: [],
    preparedSources: makePreparedSource(chunks),
    tokenBudget: 10,
  });
  assert.equal(context.sectionCount, 1);
  assert.equal(context.citations.length, 1);
  assert.equal(context.budgetSkippedCount, 1);
});

test('buildRagContextText bridges figure captions to equations and hydrates referenced bibliography', () => {
  const mineruBlocks = [
    { type: 'title', blockId: 'sec-22', pageIndex: 5, blockIndex: 0, content: { text: '2.2 Rotor Blade Planform Design Selection', text_level: 2 } },
    { type: 'paragraph', blockId: 'p6-16', pageIndex: 5, blockIndex: 1, content: { text: 'For high AOA regions, quasi-steady airfoil performance is estimated using Eqs. 5–7 (Fig. 6) [18].' } },
    { type: 'image', blockId: 'p7-1', pageIndex: 6, blockIndex: 0, content: { image_caption: [{ type: 'text', content: '(a) twin-tiltrotor' }] } },
    { type: 'image', blockId: 'p7-2', pageIndex: 6, blockIndex: 1, content: { image_caption: [{ type: 'text', content: '(b) quad-tiltrotor' }] } },
    { type: 'image', blockId: 'p7-3', pageIndex: 6, blockIndex: 2, content: { image_caption: [{ type: 'text', content: '(c) hexa-tiltrotor Fig. 3 Tiltrotor baseline configurations' }] } },
    { type: 'equation', blockId: 'p7-5', pageIndex: 6, blockIndex: 3, content: { math_content: 'C _{l} = 1. 1 7 5 \\sin 2 (\\alpha - \\alpha_{0}),\\tag{5}' } },
    { type: 'equation', blockId: 'p7-6', pageIndex: 6, blockIndex: 4, content: { math_content: 'C _{m} = - 0. 5 \\sin (\\alpha - \\alpha_{0}) + 0. 1 1 \\sin 2 (\\alpha - \\alpha_{0}),\\tag{6}' } },
    { type: 'equation', blockId: 'p7-7', pageIndex: 6, blockIndex: 5, content: { math_content: 'C _{d} = 1. 1 3 5 - 1. 0 5 \\cos 2 (\\alpha - \\alpha_{0}).\\tag{7}' } },
    { type: 'title', blockId: 'sec-refs', pageIndex: 14, blockIndex: 0, content: { text: 'References', text_level: 1 } },
    { type: 'paragraph', blockId: 'p15-2', pageIndex: 14, blockIndex: 1, content: { text: '18. Leishman JG (2000) Principles of Helicopter Aerodynamics. Cambridge University Press' } },
  ] as any;

  // Simulate legacy 1-block-per-chunk v2 index where vector retrieval only hit p6-16.
  const chunks = [
    makeChunk({ chunkId: 'mineru:p6-16:0', chunkIndex: 0, pageIndex: 5, blockId: 'p6-16', sectionId: 'sec-22', text: 'For high AOA regions, quasi-steady airfoil performance is estimated using Eqs. 5–7 (Fig. 6) [18].' }),
    makeChunk({ chunkId: 'mineru:p7-1:0', chunkIndex: 1, pageIndex: 6, blockId: 'p7-1', sectionId: 'sec-22', text: '(a) twin-tiltrotor' }),
    makeChunk({ chunkId: 'mineru:p7-2:0', chunkIndex: 2, pageIndex: 6, blockId: 'p7-2', sectionId: 'sec-22', text: '(b) quad-tiltrotor' }),
    makeChunk({ chunkId: 'mineru:p7-3:0', chunkIndex: 3, pageIndex: 6, blockId: 'p7-3', sectionId: 'sec-22', text: '(c) hexa-tiltrotor Fig. 3 Tiltrotor baseline configurations' }),
    makeChunk({ chunkId: 'mineru:p7-5:0', chunkIndex: 4, pageIndex: 6, blockId: 'p7-5', sectionId: 'sec-22', text: 'C _{l} = 1. 1 7 5 \\sin 2 (\\alpha - \\alpha_{0}),\\tag{5}' }),
    makeChunk({ chunkId: 'mineru:p7-6:0', chunkIndex: 5, pageIndex: 6, blockId: 'p7-6', sectionId: 'sec-22', text: 'C _{m} = - 0. 5 \\sin (\\alpha - \\alpha_{0}) + 0. 1 1 \\sin 2 (\\alpha - \\alpha_{0}),\\tag{6}' }),
    makeChunk({ chunkId: 'mineru:p7-7:0', chunkIndex: 6, pageIndex: 6, blockId: 'p7-7', sectionId: 'sec-22', text: 'C _{d} = 1. 1 3 5 - 1. 0 5 \\cos 2 (\\alpha - \\alpha_{0}).\\tag{7}' }),
    makeChunk({ chunkId: 'mineru:p15-2:0', chunkIndex: 7, pageIndex: 14, blockId: 'p15-2', sectionId: 'sec-refs', sectionPath: ['References'], text: '18. Leishman JG (2000) Principles of Helicopter Aerodynamics. Cambridge University Press' }),
  ];

  const context = buildRagContextText({
    results: [makeHit({ chunkId: 'mineru:p6-16:0', pageIndex: 5, blockId: 'p6-16', text: chunks[0].text })],
    topK: 1,
    mineruBlocks,
    preparedSources: makePreparedSource(chunks),
    question: '公式(6)，cm的计算公式是哪里来的',
  });

  assert.match(context.documentText, /\\tag\{5\}/);
  assert.match(context.documentText, /\\tag\{6\}/);
  assert.match(context.documentText, /\\tag\{7\}/);
  assert.match(context.documentText, /\$\$[\s\S]*\\tag\{6\}[\s\S]*\$\$/);
  assert.match(context.documentText, /18\. Leishman JG/);
});

test('buildRagContextText hydrates missing formula block even when separated across sections or pages', () => {
  const mineruBlocks = [
    { type: 'paragraph', blockId: 'p2-1', pageIndex: 1, blockIndex: 0, content: { text: 'The pitching moment follows Eq. (6) [18], assuming x = 1.' } },
    { type: 'equation', blockId: 'p7-6', pageIndex: 6, blockIndex: 0, content: { math_content: 'C_{m} = -0.5\\sin(\\alpha - \\alpha_{0}),\\tag{6}' } },
  ] as any;
  const chunks = [
    makeChunk({ chunkId: 'mineru:p2-1:0', chunkIndex: 0, pageIndex: 1, blockId: 'p2-1', sectionId: 'sec-a', text: 'The pitching moment follows Eq. (6) [18], assuming x = 1.' }),
    ...Array.from({ length: 8 }, (_, idx) => makeChunk({
      chunkId: `mineru:filler-${idx}:0`,
      chunkIndex: idx + 1,
      pageIndex: 3,
      blockId: `filler-${idx}`,
      sectionId: 'sec-b',
      text: `Intermediate filler paragraph ${idx} discussing unrelated structural trade-offs.`,
    })),
    makeChunk({ chunkId: 'mineru:p7-6:0', chunkIndex: 9, pageIndex: 6, blockId: 'p7-6', sectionId: 'sec-c', text: 'C_{m} = -0.5\\sin(\\alpha - \\alpha_{0}),\\tag{6}' }),
  ];

  const context = buildRagContextText({
    results: [makeHit({ chunkId: 'mineru:p2-1:0', pageIndex: 1, blockId: 'p2-1', text: chunks[0].text })],
    topK: 1,
    mineruBlocks,
    preparedSources: makePreparedSource(chunks),
    question: '公式(6)是什么',
  });

  assert.match(context.documentText, /\\tag\{6\}/);
  assert.equal(context.citations.some((cite) => cite.evidenceKind === 'equation' && cite.blockId === 'p7-6'), true);
});

test('buildMineruRagChunks merges equation groups with section context and definition paragraphs', () => {
  const blocks = [
    { type: 'title', blockId: 'h1', pageIndex: 5, blockIndex: 0, content: { text: '2.2 Rotor Design', text_level: 2 } },
    { type: 'image', blockId: 'fig-a', pageIndex: 6, blockIndex: 0, content: { image_caption: [{ type: 'text', content: '(a) twin-tiltrotor' }] } },
    { type: 'image', blockId: 'fig-b', pageIndex: 6, blockIndex: 1, content: { image_caption: [{ type: 'text', content: '(b) quad-tiltrotor Fig. 3 Baseline' }] } },
    { type: 'equation', blockId: 'eq-5', pageIndex: 6, blockIndex: 2, content: { math_content: 'C _ {l} = 1. 1 7 5 \\sin 2 (\\alpha - \\alpha_ {0}),\\tag{5}' } },
    { type: 'equation', blockId: 'eq-6', pageIndex: 6, blockIndex: 3, content: { math_content: 'C _ {m} = - 0. 5 \\sin (\\alpha - \\alpha_ {0}) + 0. 1 1 \\sin 2 (\\alpha - \\alpha_ {0}),\\tag{6}' } },
    { type: 'paragraph', blockId: 'where-p', pageIndex: 6, blockIndex: 4, content: { text: 'where alpha is the angle of attack.' } },
    { type: 'paragraph', blockId: 'next-topic', pageIndex: 6, blockIndex: 5, content: { text: 'Next we discuss blade structural constraints across hover and cruise segments.' } },
  ] as any;

  const chunks = buildMineruRagChunks(blocks);
  // Title stays separate; captions merge into 1 chunk; eq-5 + eq-6 + where-p merge into 1 chunk; subsequent unrelated prose stays separate.
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0]?.blockId, 'h1');
  assert.match(chunks[1]?.text ?? '', /\(a\) twin-tiltrotor[\s\S]*\(b\) quad-tiltrotor/);
  assert.equal(chunks[2]?.blockId, 'eq-5');
  assert.match(chunks[2]?.text ?? '', /C_\{m\} = - 0\.5/);
  assert.match(chunks[2]?.text ?? '', /1\.175/);
  assert.match(chunks[2]?.text ?? '', /where alpha is the angle of attack/);
  assert.equal(chunks[3]?.blockId, 'next-topic');
});

test('mergeHybridSourceRetrievals prevents RRF vs L2 distance scale mismatch from dropping FTS formula hits', async () => {
  const { mergeHybridSourceRetrievals } = await import('../src/features/reader/readerRag.ts');
  const merged = mergeHybridSourceRetrievals(
    [
      {
        sourceType: 'mineru-markdown',
        ftsHitCount: 0,
        results: [
          makeHit({ chunkId: 'm1', sourceType: 'mineru-markdown', pageIndex: 5, text: 'Prose mention Eqs. 5-7', score: 0.52 }),
          makeHit({ chunkId: 'm2', sourceType: 'mineru-markdown', pageIndex: 1, text: 'Introduction prose', score: 0.58 }),
        ],
      },
      {
        sourceType: 'pdf-text',
        ftsHitCount: 1,
        results: [
          makeHit({
            chunkId: 'pdf:6:0',
            sourceType: 'pdf-text',
            pageIndex: 6,
            text: 'Cm = -0.5 sin(alpha - alpha0) + 0.11 sin 2(alpha - alpha0), (6)',
            score: 0.9672,
            channels: ['vector', 'fts'],
          }),
        ],
      },
    ],
    2,
  );

  assert.equal(merged.length, 2);
  assert.ok(merged.some((item) => item.chunkId === 'pdf:6:0'), 'FTS-matched formula chunk must survive hybrid merge');
});
