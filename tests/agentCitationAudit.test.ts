import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCitationAuditMarkdown,
  normalizeAuditVerdict,
  runCitationAuditCapability,
  sanitizeExtractedClaims,
  type CitationAuditJudgeVerdict,
  type CitationAuditModelIO,
  type CitationAuditSnippet,
} from '../src/services/agentCitationAudit.ts';

const SNIPPET_A: CitationAuditSnippet = {
  paperId: 'paper-alpha',
  paperTitle: '基于深度学习的旋翼气动噪声预测',
  pageIndex: 12,
  blockId: 'blk-1',
  snippet: '本文采用深度学习神经网络方法，对倾转旋翼飞行器的气动噪声进行高精度数值预测。',
};

const SNIPPET_B: CitationAuditSnippet = {
  paperId: 'paper-beta',
  paperTitle: 'Civil Aircraft Overall Design',
  pageIndex: 45,
  blockId: 'blk-2',
  snippet: 'We introduce aerodynamic optimization using gradient descent algorithm for wing design.',
};

function createModel(options: {
  claims?: string[];
  verdicts?: Record<string, CitationAuditJudgeVerdict>;
  counters?: { extract: number; judge: number };
}): CitationAuditModelIO {
  const counters = options.counters ?? { extract: 0, judge: 0 };
  return {
    async extractClaims() {
      counters.extract += 1;
      return options.claims ?? [];
    },
    async judgeClaim({ claim }) {
      counters.judge += 1;
      return options.verdicts?.[claim] ?? { status: 'partial', reason: '默认判定：部分支持' };
    },
  };
}

function createRetrieve(map: Record<string, CitationAuditSnippet[]>, counters?: { calls: number }) {
  return async (claim: string): Promise<CitationAuditSnippet[]> => {
    if (counters) counters.calls += 1;
    return map[claim] ?? [];
  };
}

test('extract -> retrieve -> judge 映射四种状态，rejectedClaimLines 只收否定项', async () => {
  const claimSupported = '深度学习神经网络可以高精度预测倾转旋翼飞行器的气动噪声。';
  const claimPartial = '该方法同时给出了风洞试验与飞行试验的完整对比数据。';
  const claimMissing = '行星自转轴偏角导致的潮汐变迁会改变旋翼气动特性。';
  const claimContradicted = '深度学习预测与试验测量之间不存在任何显著相关性。';
  const retrieveMap: Record<string, CitationAuditSnippet[]> = {
    [claimSupported]: [SNIPPET_A],
    [claimPartial]: [SNIPPET_A],
    [claimMissing]: [SNIPPET_B],
    [claimContradicted]: [SNIPPET_A],
  };
  const model = createModel({
    claims: [claimSupported, claimPartial, claimMissing, claimContradicted],
    verdicts: {
      [claimSupported]: { status: 'supported', reason: '片段明确支持', snippetIndexes: [1] },
      [claimPartial]: { status: 'partial', reason: '片段未覆盖对比数据' },
      [claimMissing]: { status: 'not-in-library', reason: '片段与主张无关' },
      [claimContradicted]: { status: 'contradicted', reason: '片段给出相反的强相关结论', snippetIndexes: [1] },
    },
  });

  const { kind, audit } = await runCitationAuditCapability({
    instruction: [claimSupported, claimPartial, claimMissing, claimContradicted].join('\n'),
    model,
    retrieve: createRetrieve(retrieveMap),
  });

  assert.equal(kind, 'audit');
  assert.deepEqual(audit.claims.map((claim) => claim.status), [
    'supported',
    'partial',
    'not-in-library',
    'contradicted',
  ]);

  // supported 主张携带 judge 选中的片段引用
  assert.equal(audit.claims[0].citations.length, 1);
  assert.equal(audit.claims[0].citations[0].paperId, 'paper-alpha');
  assert.equal(audit.claims[0].citations[0].pageIndex, 12);
  assert.equal(audit.claims[2].citations.length, 0, '库内无证据不应展示无关检索页码');

  // rejectedClaimLines 仅 not-in-library 与 contradicted，且为工作记忆行格式
  assert.equal(audit.rejectedClaimLines.length, 2);
  assert.ok(audit.rejectedClaimLines[0].startsWith('- [not-in-library] '));
  assert.ok(audit.rejectedClaimLines[1].startsWith('- [contradicted] '));
  assert.ok(audit.rejectedClaimLines.every((line) => line.includes('| reason: ') && line.endsWith('| source: citation-audit')));

  // markdown 是结构化表格：主张、状态（文字）、页码、理由
  assert.match(audit.markdown, /## 引用核对结果/);
  assert.match(audit.markdown, /\| # \| 主张 \| 状态 \| 页码 \| 理由 \|/);
  assert.match(audit.markdown, /库内无证据/);
  assert.match(audit.markdown, /证据相反/);
  assert.match(audit.markdown, /p\.13/);
});

test('没有检索片段的主张不得为 supported，且不送 judge 模型', async () => {
  const claim = '某篇不存在的文献证明了旋翼噪声可以完全消除的实质性结论。';
  const counters = { extract: 0, judge: 0 };
  const model = createModel({ claims: [claim], counters });

  const { audit } = await runCitationAuditCapability({
    instruction: claim,
    model,
    retrieve: async () => [],
  });

  assert.equal(audit.claims.length, 1);
  assert.equal(audit.claims[0].status, 'not-in-library');
  assert.equal(audit.claims[0].citations.length, 0);
  assert.equal(counters.judge, 0, '无片段的主张必须先标 not-in-library，不送模型');
  assert.equal(audit.rejectedClaimLines.length, 1);
});

test('同一回答的短句检索落空时复用明确同一事实的片段并重新判定', async () => {
  const shortClaim = '基线前飞航程为 9.3 km';
  const detailedClaim = '双倾转旋翼飞行器的前飞航程统一设定为 9.3 km';
  const unrelatedClaim = '月球表面海水的盐度为 35%';
  const evidence = { ...SNIPPET_A, snippet: '双倾转旋翼飞行器的前飞航程统一设定为 9.3 km。' };
  const judged: string[] = [];
  const { audit } = await runCitationAuditCapability({
    instruction: [shortClaim, detailedClaim, unrelatedClaim].join('\n'),
    model: {
      async extractClaims() { return [shortClaim, detailedClaim, unrelatedClaim]; },
      async judgeClaim({ claim }) {
        judged.push(claim);
        return { status: 'supported', reason: '片段明确支持', snippetIndexes: [1] };
      },
    },
    retrieve: createRetrieve({ [detailedClaim]: [evidence] }),
  });

  assert.deepEqual(judged, [shortClaim, detailedClaim]);
  assert.deepEqual(audit.claims.map((claim) => claim.status), ['supported', 'supported', 'not-in-library']);
  assert.equal(audit.claims[0].citations[0].pageIndex, evidence.pageIndex);
  assert.deepEqual(audit.rejectedClaimLines.length, 1);
});

test('主张携带的悬挂 [n] 编号经编号解析后直接标 not-in-library，不送 judge', async () => {
  const claim = '这条主张引用了一个检索结果里不存在的编号作为证据 [9]。';
  const counters = { extract: 0, judge: 0 };
  const model = createModel({ claims: [claim], counters });

  const { audit } = await runCitationAuditCapability({
    instruction: claim,
    model,
    retrieve: createRetrieve({ [claim]: [SNIPPET_A, SNIPPET_B] }),
  });

  assert.equal(audit.claims[0].status, 'not-in-library');
  assert.match(audit.claims[0].reason, /悬挂引用/);
  assert.equal(counters.judge, 0);
});

test('judge 输出非法状态时归一化为 partial（拿不准用 partial）', async () => {
  const claim = '深度学习神经网络可以高精度预测倾转旋翼飞行器的气动噪声。';
  const model = createModel({
    claims: [claim],
    verdicts: { [claim]: { status: 'definitely-true' as never, reason: '' } },
  });

  const { audit } = await runCitationAuditCapability({
    instruction: claim,
    model,
    retrieve: createRetrieve({ [claim]: [SNIPPET_A] }),
  });

  assert.equal(audit.claims[0].status, 'partial');
  assert.match(audit.claims[0].reason, /无法解析/);
});

test('空主张列表：直接说明，不编造主张，不产记忆建议', async () => {
  const retrieveCounters = { calls: 0 };
  const model = createModel({ claims: [] });

  const { audit } = await runCitationAuditCapability({
    instruction: '你好',
    model,
    retrieve: createRetrieve({}, retrieveCounters),
  });

  assert.equal(audit.claims.length, 0);
  assert.equal(audit.rejectedClaimLines.length, 0);
  assert.match(audit.markdown, /未能从指令中抽取/);
  assert.equal(retrieveCounters.calls, 0, '没有主张时不应发起检索');
});

test('明确核对上一条回答时只从实际回答逐字抽取主张', async () => {
  const prior = '这篇论文报告四倾转旋翼的前飞航程约为基线三倍。';
  let extractionSource = '';
  const { audit } = await runCitationAuditCapability({
    instruction: '请核对上一条回答。',
    priorAssistantAnswer: prior,
    model: {
      async extractClaims({ instruction }) {
        extractionSource = instruction;
        return [prior, '这篇论文证明了不存在的临床疗效。'];
      },
      async judgeClaim() { return { status: 'partial', reason: '证据不足' }; },
    },
    retrieve: async () => [],
  });
  assert.equal(extractionSource, prior);
  assert.deepEqual(audit.claims.map((claim) => claim.text), [prior]);
});

test('extract 抽取上限为 8 条且去重', async () => {
  const claims = Array.from({ length: 12 }, (_, index) => `这是第 ${index + 1} 条需要核对的实质性学术主张。`);
  const model = createModel({ claims });

  const { audit } = await runCitationAuditCapability({
    instruction: claims.join('\n'),
    model,
    retrieve: async () => [],
  });

  assert.equal(audit.claims.length, 8);
});

test('sanitizeExtractedClaims 去符号、过滤短行、去重、截断上限', () => {
  const sanitized = sanitizeExtractedClaims([
    '- 深度学习网络可以预测旋翼气动噪声。',
    '1. 深度学习网络可以预测旋翼气动噪声。',
    '短句',
    '* 风洞试验可以测量旋翼噪声水平。',
    '   ',
  ]);

  assert.deepEqual(sanitized, [
    '深度学习网络可以预测旋翼气动噪声。',
    '风洞试验可以测量旋翼噪声水平。',
  ]);
});

test('模型改写或编造的主张不得进入核对报告和工作记忆建议', async () => {
  const original = '论文报告采用反馈迭代方法，航程增加三倍。';
  const invented = '抱歉，我无法从现有文本中提取相关主张。';
  const { audit } = await runCitationAuditCapability({
    instruction: `请核对：${original}`,
    model: createModel({ claims: [invented, '论文报告采用反馈迭代方法，航程减少三倍。', original] }),
    retrieve: async () => [],
  });
  assert.deepEqual(audit.claims.map((claim) => claim.text), [original]);
  assert.equal(audit.rejectedClaimLines.length, 1);
});

test('normalizeAuditVerdict 保留合法四状态并清洗 snippetIndexes', () => {
  const verdict = normalizeAuditVerdict({ status: 'contradicted', reason: '片段相反', snippetIndexes: [1, 0, -2, 3] });
  assert.equal(verdict.status, 'contradicted');
  assert.deepEqual(verdict.snippetIndexes, [1, 3]);

  assert.equal(normalizeAuditVerdict(null).status, 'partial');
  assert.equal(normalizeAuditVerdict({ status: 'supported', reason: '' }).status, 'supported');
});

test('buildCitationAuditMarkdown 空主张时给出说明而不是空表', () => {
  const markdown = buildCitationAuditMarkdown([]);
  assert.match(markdown, /未能从指令中抽取/);
  assert.ok(!markdown.includes('| --- |'));
});
