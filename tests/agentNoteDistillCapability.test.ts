import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNoteDistillDrafter,
  runNoteDistillCapability,
  validateAgentDistillDraft,
  type AgentDistillDraft,
  type NoteDistillCollectedNote,
} from '../src/services/agentNoteDistillCapability.ts';

test('蒸馏来源预览有上限且标出无句界截断', async () => {
  let sourceText = '';
  let allowedRefs: number[] = [];
  const draft = createNoteDistillDrafter(async ({ user }) => {
    const input = JSON.parse(user) as { sources: Array<{ text: string }>; allowedRefs: number[] };
    sourceText = input.sources[0].text;
    allowedRefs = input.allowedRefs;
    return { content: JSON.stringify({ pageKind: 'concept', title: '测试', content: '## 定义\n内容。' }) };
  });
  await draft({
    instruction: '测试蒸馏',
    collectedNotes: [{ ...EXCERPT_NOTE, excerpt: 'a'.repeat(3000) }],
    ragSnippets: [],
    previousErrors: [],
  });
  assert.ok(sourceText.length < 1850);
  assert.match(sourceText, /来源预览截断/);
  assert.deepEqual(allowedRefs, [1]);
});

const EXCERPT_NOTE: NoteDistillCollectedNote = {
  id: 'note-1',
  title: '过渡走廊摘录',
  pageKind: 'excerpt',
  paperId: 'paper-1',
  excerpt: '动态过渡走廊描述倾转旋翼飞行器在加减速状态下的安全飞行包线。',
  content: '动态过渡走廊描述倾转旋翼飞行器在加减速状态下的安全飞行包线。',
};

const VALID_CONCEPT_DRAFT: AgentDistillDraft = {
  pageKind: 'concept',
  title: '动态过渡走廊',
  content: '## 定义\n\n动态过渡走廊是倾转旋翼飞行器在加减速状态下的安全飞行包线。[[过渡走廊摘录]]',
};

const LIBRARY_PAPERS = [
  { id: 'paper-1', title: '倾转旋翼飞行器动态过渡走廊研究' },
  { id: 'paper-2', title: '旋翼气动噪声数值预测方法' },
];

test('validateAgentDistillDraft：excerpt 红线直接拒绝', () => {
  const errors = validateAgentDistillDraft({
    pageKind: 'excerpt',
    title: '某段摘录',
    content: '这是一段试图由 Agent 直接创建的摘录卡正文内容。',
  });

  assert.ok(errors.length > 0);
  assert.ok(errors.some((error) => error.includes('摘录卡') && error.includes('阅读器')));
});

test('validateAgentDistillDraft：create 草稿伪造锚点链接拒绝', () => {
  const errors = validateAgentDistillDraft({
    pageKind: 'qa',
    title: '某问答',
    content: '答案正文足够长。\n\n## 证据位置\n\n- 见 [锚点](paperquay://anchor/fabricated-1) 与 [1]。',
  });

  assert.ok(errors.some((error) => error.includes('不得发明锚点')));
});

test('validateAgentDistillDraft：update 改写 before 之外的锚点拒绝，原样保留 before 锚点通过', () => {
  const before = '原笔记正文，含已有锚点 [原文](paperquay://anchor/existing-1)。';
  const tampered = validateAgentDistillDraft(
    {
      pageKind: 'qa',
      title: '某问答',
      noteId: 'note-9',
      content: '答案正文足够长。\n\n## 证据位置\n\n- 见 [锚点](paperquay://anchor/rewritten-2) 段落。',
    },
    { before },
  );
  assert.ok(tampered.some((error) => error.includes('paperquay://anchor/rewritten-2') && error.includes('禁止伪造或篡改')));

  const kept = validateAgentDistillDraft(
    {
      pageKind: 'qa',
      title: '某问答',
      noteId: 'note-9',
      content: '答案正文足够长。\n\n## 证据位置\n\n- paperId: paper-1; page: 1; 见 [锚点](paperquay://anchor/existing-1) 段落。',
    },
    { before },
  );
  assert.deepEqual(kept, []);
});

test('validateAgentDistillDraft：单篇引用的 synthesis 拒绝，两篇合规通过', () => {
  const singlePaper = validateAgentDistillDraft(
    {
      pageKind: 'synthesis',
      title: '过渡走廊研究综述',
      content: '过渡走廊研究为倾转旋翼飞行器提供了安全包线 [1]。\n\n## 参考文献\n\n- [1] 倾转旋翼飞行器动态过渡走廊研究',
    },
    { papers: LIBRARY_PAPERS },
  );
  assert.ok(singlePaper.some((error) => error.includes('至少两篇')));

  const twoPapers = validateAgentDistillDraft(
    {
      pageKind: 'synthesis',
      title: '过渡走廊与噪声预测研究综述',
      content: '过渡走廊研究给出了安全包线 [1]，噪声预测研究提供了数值方法 [2]。\n\n## 参考文献\n\n- [1] 倾转旋翼飞行器动态过渡走廊研究\n- [2] 旋翼气动噪声数值预测方法',
    },
    { papers: LIBRARY_PAPERS },
  );
  assert.deepEqual(twoPapers, []);
});

test('validateAgentDistillDraft：concept 需要定义段、干净标题与 [[回链]]', () => {
  // 合法 concept：定义段 + 实质句带 [[收集到的标题]] → 通过
  const valid = validateAgentDistillDraft(VALID_CONCEPT_DRAFT, { collectedNoteTitles: [EXCERPT_NOTE.title] });
  assert.deepEqual(valid, []);

  // 标题带「笔记」冗余词
  const badTitle = validateAgentDistillDraft(
    { ...VALID_CONCEPT_DRAFT, title: '动态过渡走廊笔记' },
    { collectedNoteTitles: [EXCERPT_NOTE.title] },
  );
  assert.ok(badTitle.some((error) => error.includes('冗余词')));

  // 缺定义段
  const noDefinition = validateAgentDistillDraft(
    { ...VALID_CONCEPT_DRAFT, content: '动态过渡走廊是倾转旋翼飞行器在加减速状态下的安全飞行包线。[[过渡走廊摘录]]' },
    { collectedNoteTitles: [EXCERPT_NOTE.title] },
  );
  assert.ok(noDefinition.some((error) => error.includes('定义段')));

  // 实质句没有 [[回链]]
  const noLink = validateAgentDistillDraft(
    { ...VALID_CONCEPT_DRAFT, content: '## 定义\n\n动态过渡走廊是倾转旋翼飞行器在加减速状态下的安全飞行包线。' },
    { collectedNoteTitles: [EXCERPT_NOTE.title] },
  );
  assert.ok(noLink.some((error) => error.includes('链回')));

  // [[链接]] 未指向 collect 收集到的笔记
  const foreignLink = validateAgentDistillDraft(
    { ...VALID_CONCEPT_DRAFT, content: '## 定义\n\n动态过渡走廊是倾转旋翼飞行器在加减速状态下的安全飞行包线。[[没收集到的页面]]' },
    { collectedNoteTitles: [EXCERPT_NOTE.title] },
  );
  assert.ok(foreignLink.some((error) => error.includes('未链回 collect 收集到的笔记')));
});

test('validateAgentDistillDraft：qa 需要证据位置段；paper-card 需要 paperId 与我的判断', () => {
  const qaMissing = validateAgentDistillDraft({ pageKind: 'qa', title: '某问答', content: '这是一段没有列明任何出处小节的回答内容正文。' });
  assert.ok(qaMissing.some((error) => error.includes('证据位置')));

  const cardNoPaper = validateAgentDistillDraft({ pageKind: 'paper-card', title: '某论文卡片', content: '## 我的判断\n\n这篇论文的方法可以推广到其他构型分析。' });
  assert.ok(cardNoPaper.some((error) => error.includes('paperId')));

  const cardNoJudgement = validateAgentDistillDraft({
    pageKind: 'paper-card',
    title: '某论文卡片',
    paperId: 'paper-1',
    content: '这篇论文给出了过渡走廊的计算方法与实验验证过程。',
  });
  assert.ok(cardNoJudgement.some((error) => error.includes('我的判断')));
});

function createSearchNotes(notes: NoteDistillCollectedNote[]) {
  const calls: Array<{ pageKind: string }> = [];
  return {
    calls,
    searchNotesFn: async (input: { query: string; pageKind: 'excerpt' | 'qa'; limit: number }) => {
      calls.push({ pageKind: input.pageKind });
      return notes.filter((note) => note.pageKind === input.pageKind);
    },
  };
}

test('runNoteDistillCapability：合法 concept 草稿产出审批计划', async () => {
  const { searchNotesFn } = createSearchNotes([EXCERPT_NOTE]);
  let draftCalls = 0;

  const result = await runNoteDistillCapability({
    instruction: '把过渡走廊相关的摘录卡蒸馏成概念页',
    papers: LIBRARY_PAPERS,
    searchNotesFn,
    draft: async (input) => {
      draftCalls += 1;
      assert.equal(input.previousErrors.length, 0);
      assert.equal(input.collectedNotes.length, 1);
      return VALID_CONCEPT_DRAFT;
    },
  });

  assert.equal(draftCalls, 1);
  assert.equal(result.kind, 'note-plan');
  assert.ok(result.notePlan, '通过校验后必须产出审批计划');
  assert.equal(result.notePlan!.operations.length, 1);
  assert.equal(result.notePlan!.operations[0].kind, 'create');
  assert.equal(result.notePlan!.operations[0].pageKind, 'concept');
  assert.equal(result.notePlan!.operations[0].title, '动态过渡走廊');
  assert.match(result.answer, /草稿/);
});

test('runNoteDistillCapability：校验未通过喂回一次草稿，仍不通过返回说明且不产卡', async () => {
  const { searchNotesFn } = createSearchNotes([EXCERPT_NOTE]);
  let draftCalls = 0;
  const seenErrorFeedback: string[][] = [];

  const result = await runNoteDistillCapability({
    instruction: '把过渡走廊相关的摘录蒸馏成概念页',
    papers: LIBRARY_PAPERS,
    searchNotesFn,
    draft: async (input) => {
      draftCalls += 1;
      seenErrorFeedback.push([...input.previousErrors]);
      // 永远产出非法草稿：excerpt 红线
      return {
        pageKind: 'excerpt',
        title: '伪造摘录卡',
        content: '这是一段试图伪造摘录卡的蒸馏草稿正文内容。',
      };
    },
  });

  assert.equal(draftCalls, 2, '校验失败只允许喂回草稿器重试一次');
  assert.equal(seenErrorFeedback[0].length, 0);
  assert.equal(seenErrorFeedback[1].length > 0, true, '第二次调用必须携带第一轮校验错误');
  assert.equal(result.notePlan, null);
  assert.match(result.answer, /未产生笔记审批卡/);
});

test('runNoteDistillCapability：证据门禁不通过时喂回一次，仍不通过返回说明', async () => {
  const { searchNotesFn } = createSearchNotes([EXCERPT_NOTE]);
  let draftCalls = 0;

  const result = await runNoteDistillCapability({
    instruction: '把过渡走廊相关的摘录蒸馏成概念页',
    papers: LIBRARY_PAPERS,
    searchNotesFn,
    draft: async () => {
      draftCalls += 1;
      // 结构校验通过（有定义段、有 [[回链]]），但句子内容与摘录片段毫无重叠 → 证据门禁 partial 且无「我的推断」
      return {
        pageKind: 'concept',
        title: '量子引力 phenomenology',
        content: '## 定义\n\n量子引力现象学研究时空泡沫对宇宙线传播的色散修正效应。[[过渡走廊摘录]]',
      };
    },
  });

  assert.equal(draftCalls, 2, '证据门禁失败只允许喂回草稿器重试一次');
  assert.equal(result.notePlan, null);
  assert.match(result.answer, /未产生笔记审批卡/);
});

test('runNoteDistillCapability：无笔记命中时对选中论文做一次 RAG 兜底', async () => {
  const { searchNotesFn } = createSearchNotes([]);
  let ragCalls = 0;

  const result = await runNoteDistillCapability({
    instruction: '蒸馏过渡走廊相关内容',
    papers: LIBRARY_PAPERS,
    currentPaperScopeIds: ['paper-1'],
    searchNotesFn,
    searchRag: async () => {
      ragCalls += 1;
      return {
        chunks: [{
          paperId: 'paper-1',
          paperTitle: '倾转旋翼飞行器动态过渡走廊研究',
          page: 5,
          blockId: 'blk-9',
          snippet: '动态过渡走廊描述倾转旋翼飞行器在加减速状态下的安全飞行包线。',
        }],
        ragErrors: [],
      };
    },
    draft: async (input) => {
      assert.equal(input.ragSnippets.length, 1);
      return {
        pageKind: 'paper-card',
        title: '倾转旋翼动态过渡走廊研究卡片',
        paperId: 'paper-1',
        content: '动态过渡走廊描述倾转旋翼飞行器在加减速状态下的安全飞行包线 [1]。\n\n## 我的判断\n\n我的推断是该方法可以推广到其他旋翼构型的走廊计算 [1]。',
      };
    },
  });

  assert.equal(ragCalls, 1, '无笔记命中时只允许一次 RAG 兜底检索');
  assert.ok(result.notePlan);
  assert.equal(result.notePlan!.operations[0].pageKind, 'paper-card');
  assert.equal(result.notePlan!.operations[0].paperId, 'paper-1');
});

test('runNoteDistillCapability：概念/跨篇指令会追加搜索 qa 页', async () => {
  const { calls, searchNotesFn } = createSearchNotes([EXCERPT_NOTE]);

  await runNoteDistillCapability({
    instruction: '围绕这个概念整理跨篇笔记',
    papers: LIBRARY_PAPERS,
    searchNotesFn,
    draft: async () => VALID_CONCEPT_DRAFT,
  });

  assert.deepEqual(calls.map((call) => call.pageKind), ['excerpt', 'qa']);
});

test('synthesis bibliography cannot substitute for two distinct collected paper IDs', async () => {
  const secondNote = { ...EXCERPT_NOTE, id: 'note-2', title: '另一段走廊摘录' };
  const { searchNotesFn } = createSearchNotes([EXCERPT_NOTE, secondNote]);
  const result = await runNoteDistillCapability({
    instruction: '对比两篇文献中的过渡走廊研究',
    papers: LIBRARY_PAPERS,
    searchNotesFn,
    draft: async () => ({
      pageKind: 'synthesis', title: '过渡走廊综述',
      content: '动态过渡走廊描述倾转旋翼飞行器的安全飞行包线 [1]。动态过渡走廊描述倾转旋翼飞行器的安全飞行包线 [2]。\n\n## 参考文献\n\n- [1] 倾转旋翼飞行器动态过渡走廊研究\n- [2] 旋翼气动噪声数值预测方法',
    }),
  });
  assert.equal(result.notePlan, null);
  assert.match(result.answer, /不同文献|不同 paperId|参考文献条目/);
});

test('explicit synthesis request cannot become qa during a retry', async () => {
  const { searchNotesFn } = createSearchNotes([EXCERPT_NOTE, {
    ...EXCERPT_NOTE, id: 'note-2', paperId: 'paper-2', title: '噪声预测摘录',
  }]);
  let attempts = 0;
  const result = await runNoteDistillCapability({
    instruction: '请写 synthesis 综述',
    papers: LIBRARY_PAPERS,
    searchNotesFn,
    draft: async () => {
      attempts += 1;
      return attempts === 1
        ? { pageKind: 'synthesis', title: '单篇综述', content: '## 参考文献\n- [1] 倾转旋翼飞行器动态过渡走廊研究' }
        : { pageKind: 'qa', title: '错误改型', content: '回答。\n\n## 证据位置\n- [1] paperId: paper-1, page: 5' };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result.notePlan, null);
  assert.match(result.answer, /不得改变页面类型/);
});

test('selected multi-paper synthesis searches every paper even when a note already matched', async () => {
  const { searchNotesFn } = createSearchNotes([EXCERPT_NOTE]);
  const ragCalls: string[][] = [];
  let draftCalls = 0;
  await runNoteDistillCapability({
    instruction: '根据两篇论文写 synthesis 综述',
    papers: LIBRARY_PAPERS,
    currentPaperScopeIds: ['paper-1', 'paper-2'],
    searchNotesFn,
    searchRag: async ({ paperIds }) => {
      ragCalls.push(paperIds ?? []);
      return { chunks: [{
        paperId: paperIds![0], paperTitle: LIBRARY_PAPERS.find((paper) => paper.id === paperIds![0])!.title,
        page: 3, blockId: 'b-1', snippet: '这篇论文给出了可核对的研究结果与证据。',
      }] };
    },
    draft: async ({ collectedNotes, ragSnippets }) => {
      draftCalls += 1;
      assert.equal(collectedNotes[0].paperTitle, LIBRARY_PAPERS[0].title);
      assert.deepEqual(ragSnippets.map((snippet) => snippet.paperId), ['paper-1', 'paper-2']);
      return { pageKind: 'synthesis', title: '待补充的综述', content: '## 参考文献' };
    },
  });
  assert.deepEqual(ragCalls, [['paper-1'], ['paper-2']]);
  assert.equal(draftCalls, 2);
});

test('selected synthesis ignores notes outside the selected papers and supplies the paper title to the drafter', async () => {
  const { searchNotesFn } = createSearchNotes([
    EXCERPT_NOTE,
    { ...EXCERPT_NOTE, id: 'note-other', paperId: 'paper-other', title: '无关笔记' },
  ]);
  let draftSources: Array<{ title?: string; paperTitle?: string; paperId: string }> = [];
  const result = await runNoteDistillCapability({
    instruction: '根据两篇论文写 synthesis 综述',
    papers: LIBRARY_PAPERS,
    currentPaperScopeIds: ['paper-1', 'paper-2'],
    searchNotesFn,
    searchRag: async ({ paperIds }) => ({ chunks: paperIds?.[0] === 'paper-2' ? [{
      paperId: 'paper-2', paperTitle: LIBRARY_PAPERS[1].title,
      page: 2, blockId: 'b-2', snippet: '第二篇论文的可核对内容。',
    }] : [] }),
    draft: createNoteDistillDrafter(async ({ user }) => {
      draftSources = (JSON.parse(user) as { sources: typeof draftSources }).sources;
      return { content: JSON.stringify({ pageKind: 'synthesis', title: '待补充综述', content: '## 参考文献' }) };
    }),
  });
  assert.equal(result.notePlan, null);
  assert.deepEqual(draftSources.map((source) => source.paperId), ['paper-1', 'paper-2']);
  assert.equal(draftSources[0].title, EXCERPT_NOTE.title);
  assert.equal(draftSources[0].paperTitle, LIBRARY_PAPERS[0].title);
});

test('synthesis with evidence from only one paper does not call the draft model', async () => {
  const { searchNotesFn } = createSearchNotes([EXCERPT_NOTE]);
  const result = await runNoteDistillCapability({
    instruction: '根据两篇论文写 synthesis 综述',
    papers: LIBRARY_PAPERS,
    currentPaperScopeIds: ['paper-1', 'paper-2'],
    searchNotesFn,
    searchRag: async ({ paperIds }) => ({ chunks: paperIds?.[0] === 'paper-1' ? [{
      paperId: 'paper-1', paperTitle: LIBRARY_PAPERS[0].title,
      page: 3, blockId: 'b-1', snippet: '第一篇论文的证据。',
    }] : [] }),
    draft: async () => { throw new Error('draft model must not run'); },
  });
  assert.equal(result.notePlan, null);
  assert.match(result.answer, /不足两篇/);
});

test('explicit excerpt creation is rejected before retrieval or drafting', async () => {
  const result = await runNoteDistillCapability({
    instruction: '请把当前论文的一段原文制成 excerpt 摘录卡，没有阅读器选区',
    currentPaperScopeIds: ['paper-1'],
    searchNotesFn: async () => { throw new Error('retrieval should not run'); },
    draft: async () => { throw new Error('drafter should not run'); },
  });
  assert.equal(result.notePlan, null);
  assert.match(result.answer, /阅读器.*选区/);
});

test('single selected paper cannot produce synthesis before retrieval or drafting', async () => {
  const result = await runNoteDistillCapability({
    instruction: '请只根据当前选中的论文写 synthesis 综述',
    currentPaperScopeIds: ['paper-1'],
    searchNotesFn: async () => { throw new Error('retrieval should not run'); },
    draft: async () => { throw new Error('drafter should not run'); },
  });
  assert.equal(result.notePlan, null);
  assert.match(result.answer, /至少两篇/);
});

test('cross-language synthesis checks each cited source before creating an approval plan', async () => {
  const citedClaims: Array<{ claim: string; papers: string[] }> = [];
  const result = await runNoteDistillCapability({
    instruction: '根据两篇论文写 synthesis 综述',
    papers: LIBRARY_PAPERS,
    currentPaperScopeIds: ['paper-1', 'paper-2'],
    searchNotesFn: async () => [],
    searchRag: async ({ paperIds }) => ({ chunks: [{
      paperId: paperIds![0], paperTitle: LIBRARY_PAPERS.find((paper) => paper.id === paperIds![0])!.title,
      page: 3, blockId: 'b-1',
      snippet: paperIds![0] === 'paper-1'
        ? 'The transition corridor defines a safe envelope during tiltrotor acceleration.'
        : 'The method predicts rotor aerodynamic noise using numerical simulation.',
    }] }),
    draft: async () => ({
      pageKind: 'synthesis', title: '跨语言综述',
      content: '第一篇界定倾转旋翼加速时的安全过渡包线 [1]。\n第二篇使用数值模拟预测旋翼气动噪声 [2]。\n\n## 参考文献\n- [1] 倾转旋翼飞行器动态过渡走廊研究\n- [2] 旋翼气动噪声数值预测方法',
    }),
    judgeSynthesisClaim: async ({ claim, snippets }) => {
      citedClaims.push({ claim, papers: snippets.map((snippet) => snippet.paperId) });
      return { status: 'supported', reason: 'The cited passage states this fact.', snippetIndexes: [1] };
    },
  });
  assert.ok(result.notePlan);
  assert.deepEqual(citedClaims.map(({ papers }) => papers), [['paper-1'], ['paper-2']]);
});

test('synthesis bibliography uses titles from the current cited sources', async () => {
  const result = await runNoteDistillCapability({
    instruction: '根据两篇论文写 synthesis 综述',
    papers: LIBRARY_PAPERS,
    currentPaperScopeIds: ['paper-1', 'paper-2'],
    searchNotesFn: async () => [],
    searchRag: async ({ paperIds }) => ({ chunks: [{
      paperId: paperIds![0], paperTitle: LIBRARY_PAPERS.find((paper) => paper.id === paperIds![0])!.title,
      page: 3, blockId: 'b-1', snippet: 'The rotor is analyzed in this paper.',
    }] }),
    draft: async () => ({
      pageKind: 'synthesis', title: '来源标题综述',
      content: '第一篇论文使用数值方法分析旋翼的气动特性 [1]。\n第二篇论文使用数值方法分析旋翼的气动特性 [2]。\n\n## 参考文献\n- [1] 错误标题\n- [2] 错误标题',
    }),
    judgeSynthesisClaim: async () => ({ status: 'supported', reason: 'Cited source supports claim.', snippetIndexes: [1] }),
  });
  assert.ok(result.notePlan);
  const content = JSON.stringify(result.notePlan);
  assert.match(content, /倾转旋翼飞行器动态过渡走廊研究/);
  assert.match(content, /旋翼气动噪声数值预测方法/);
  assert.doesNotMatch(content, /错误标题/);
});

test('cross-language synthesis rejects invented numbers and contradictory verdicts', async () => {
  const run = (firstClaim: string, firstVerdict: 'supported' | 'contradicted') => runNoteDistillCapability({
    instruction: '根据两篇论文写 synthesis 综述',
    papers: LIBRARY_PAPERS,
    currentPaperScopeIds: ['paper-1', 'paper-2'],
    searchNotesFn: async () => [],
    searchRag: async ({ paperIds }) => ({ chunks: [{
      paperId: paperIds![0], paperTitle: LIBRARY_PAPERS.find((paper) => paper.id === paperIds![0])!.title,
      page: 3, blockId: 'b-1',
      snippet: paperIds![0] === 'paper-1'
        ? 'The flight range is 9.3 km in the baseline case.'
        : 'The second paper evaluates rotor aerodynamic noise.',
    }] }),
    draft: async () => ({
      pageKind: 'synthesis', title: '数值核对综述',
      content: `${firstClaim} [1]。\n第二篇评价旋翼气动噪声 [2]。\n\n## 参考文献\n- [1] 倾转旋翼飞行器动态过渡走廊研究\n- [2] 旋翼气动噪声数值预测方法`,
    }),
    judgeSynthesisClaim: async () => ({ status: firstVerdict, reason: 'Evidence disagrees.', snippetIndexes: [1] }),
  });
  const inventedNumber = await run('第一篇报告基线航程为 20 km', 'supported');
  assert.equal(inventedNumber.notePlan, null);
  assert.match(inventedNumber.answer, /数值未在对应来源中出现/);

  const contradicted = await run('第一篇报告基线航程为 9.3 km', 'contradicted');
  assert.equal(contradicted.notePlan, null);
  assert.match(contradicted.answer, /contradicted/);
});

test('an excerpt update outside collected search results is rejected', async () => {
  const { searchNotesFn } = createSearchNotes([EXCERPT_NOTE]);
  const result = await runNoteDistillCapability({
    instruction: '整理动态过渡走廊概念', papers: LIBRARY_PAPERS, searchNotesFn,
    readNoteContent: async () => ({ content: '原始摘录', pageKind: 'excerpt' }),
    draft: async () => ({ ...VALID_CONCEPT_DRAFT, noteId: 'other-excerpt' }),
  });
  assert.equal(result.notePlan, null);
  assert.match(result.answer, /摘录卡/);
});

test('qa evidence rows require source and position, and updates preserve anchors', () => {
  const draft: AgentDistillDraft = { pageKind: 'qa', title: '核对', content: '答案。\n\n## 证据位置\n\n- [1] 来源' };
  assert.ok(validateAgentDistillDraft(draft).some((error) => error.includes('paperId')));
  assert.ok(validateAgentDistillDraft({ ...draft, content: '答案。\n\n## 证据位置\n\n- paperId: paper-1; blockId: b1' },
    { before: '[原文](paperquay://anchor/existing-1)' }).some((error) => error.includes('不得删除已有锚点')));
});
