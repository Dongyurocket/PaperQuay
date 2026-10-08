import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bindAnswerEvidence,
  assertEvidenceForNoteDraft,
  type InputCitation,
} from '../src/services/agentAnswerEvidence.ts';

const mockCitations: InputCitation[] = [
  {
    label: '1',
    paperId: 'paper-alpha',
    paperTitle: '基于深度学习的旋翼气动噪声预测',
    pageIndex: 12,
    blockId: 'blk-1',
    previewText: '本文采用深度学习神经网络方法，对倾转旋翼飞行器的气动噪声进行高精度数值预测。',
  },
  {
    label: '2',
    paperId: 'paper-beta',
    paperTitle: 'Civil Aircraft Overall Design',
    pageIndex: 45,
    blockId: 'blk-2',
    previewText: 'We introduce aerodynamic optimization using gradient descent algorithm for wing design.',
  },
];

test('bindAnswerEvidence ignores markdown headers, empty lines, and code blocks', () => {
  const answer = `
# 调研概述
这是一段标题后面的介绍文本。

\`\`\`ts
const x = 1;
// 代码块中的内容不应当被解析为主张
\`\`\`

## 核心结论
这里是另一个小节的分析内容。
`;

  const result = bindAnswerEvidence({ answer, citations: mockCitations });
  // 标题行和代码块应被剔除
  for (const claim of result.claims) {
    assert.ok(!claim.text.startsWith('#'));
    assert.ok(!claim.text.includes('const x = 1'));
  }
});

test('bindAnswerEvidence ignores sentences shorter than 12 characters, pure questions, and pure citation lines', () => {
  const answer = `
你好。
[1]
[1][2]
这是什么原理？
这是一个超过十二个字符的正常分析陈述句，没有任何多余问句。
`;

  const result = bindAnswerEvidence({ answer, citations: mockCitations });
  assert.equal(result.claims.length, 1);
  assert.ok(result.claims[0].text.includes('正常分析陈述句'));
});

test('bindAnswerEvidence identifies supported claim when token overlap >= 2', () => {
  const answer = '本项研究采用深度学习神经网络对旋翼气动噪声进行建模分析 [1]。';
  const result = bindAnswerEvidence({ answer, citations: mockCitations });

  assert.equal(result.claims.length, 1);
  const claim = result.claims[0];
  assert.equal(claim.status, 'supported');
  assert.equal(claim.reason, 'snippet-overlap');
  assert.equal(claim.citations.length, 1);
  assert.equal(claim.citations[0].paperId, 'paper-alpha');
  assert.equal(result.counts.supported, 1);
  assert.equal(result.counts.partial, 0);
  assert.equal(result.counts['not-in-library'], 0);
});

test('bindAnswerEvidence marks partial when cited without sufficient token overlap', () => {
  const answer = '在空间结构物理学领域中行星自转轴偏角导致了潮汐变迁 [1]。';
  const result = bindAnswerEvidence({ answer, citations: mockCitations });

  assert.equal(result.claims.length, 1);
  const claim = result.claims[0];
  assert.equal(claim.status, 'partial');
  assert.equal(claim.reason, 'cited-without-overlap');
  assert.equal(result.counts.partial, 1);
  assert.equal(result.counts.supported, 0);
});

test('numeric claim needs the same number in a bound snippet', () => {
  const citations: InputCitation[] = [{
    label: '1', paperId: 'paper-range', paperTitle: 'Tiltrotor Range Study',
    pageIndex: 8, previewText: '前飞航程统一设定为 9.3 km，作为飞行器基线。',
  }];
  const wrong = bindAnswerEvidence({ answer: '飞行器基线前飞航程设定为 20 km [1]。', citations });
  const correct = bindAnswerEvidence({ answer: '飞行器基线前飞航程设定为 9.3 km [1]。', citations });
  assert.equal(wrong.claims[0].status, 'partial');
  assert.equal(correct.claims[0].status, 'supported');
});

test('a semicolon clause keeps its citation at the end of the sentence', () => {
  const citations: InputCitation[] = [{
    label: '1', paperId: 'battery', paperTitle: 'Battery Study',
    previewText: 'The battery is 250 Wh/kg; the installed pack is 192.31 Wh/kg.',
  }];
  const result = bindAnswerEvidence({
    answer: 'The battery is 250 Wh/kg; the installed pack is 192.31 Wh/kg [1].',
    citations,
  });
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].status, 'supported');
});

test('bindAnswerEvidence marks not-in-library when citation label is dangling or missing', () => {
  // 悬挂编号 [99] 不在引用列表中
  const answer1 = '这是一句挂着不存在引用的实质性学术结论陈述句 [99]。';
  const result1 = bindAnswerEvidence({ answer: answer1, citations: mockCitations });

  assert.equal(result1.claims.length, 1);
  assert.equal(result1.claims[0].status, 'not-in-library');
  assert.equal(result1.claims[0].reason, 'dangling-citation');
  assert.equal(result1.counts['not-in-library'], 1);

  // 完全没有引用
  const answer2 = '这是一句没有任何引用编号标注的实质性分析论述句子。';
  const result2 = bindAnswerEvidence({ answer: answer2, citations: mockCitations });

  assert.equal(result2.claims.length, 1);
  assert.equal(result2.claims[0].status, 'not-in-library');
  assert.equal(result2.claims[0].reason, 'no-citation-in-run');
  assert.equal(result2.counts['not-in-library'], 1);
});

test('bindAnswerEvidence resolves a unique short-title page citation from current run only', () => {
  const citations: InputCitation[] = [
    { label: '1', paperId: 'paper-a', paperTitle: 'Conceptual Design of an AAM Tiltrotor via Aircraft-Level Weight-Performance Feedback', pageIndex: 11, previewText: 'The flight range will increase approximately three times compared to the baseline.' },
    { label: '2', paperId: 'paper-b', paperTitle: 'Another Rotor Study', pageIndex: 11, previewText: 'Different findings.' },
  ];
  const result = bindAnswerEvidence({
    answer: 'The flight range will increase approximately three times [Conceptual Design of an AAM Tiltrotor, p.12].',
    citations,
  });
  assert.equal(result.claims[0].status, 'supported');
  assert.deepEqual(result.claims[0].citations.map((citation) => citation.paperId), ['paper-a']);

  const absentPage = bindAnswerEvidence({
    answer: 'The flight range will increase approximately three times [Conceptual Design of an AAM Tiltrotor, p.99].',
    citations,
  });
  assert.equal(absentPage.claims[0].status, 'not-in-library');
});

test('numeric citation metadata conflicts are marked partial even when the snippet overlaps', () => {
  const citations: InputCitation[] = [
    { label: '3', paperId: 'a', paperTitle: '宽速域变体飞机总体方案设计', pageIndex: 69, previewText: '飞机总体设计决定性能并影响后续设计机会。' },
    { label: '4', paperId: 'b', paperTitle: '基于飞行品质的无人旋翼飞行器总体多学科设计优化研究', pageIndex: 25, previewText: '飞行品质设计优化。' },
  ];
  const result = bindAnswerEvidence({
    answer: '[3] 基于飞行品质的无人旋翼飞行器总体多学科设计优化研究，第 26 页：飞机总体设计决定性能并影响后续设计机会。',
    citations,
  });
  assert.equal(result.claims[0].status, 'partial');
  assert.equal(result.claims[0].reason, 'citation-mismatch');
});

test('duplicate numeric labels are not valid evidence', () => {
  const result = bindAnswerEvidence({
    answer: '本文采用深度学习神经网络方法对旋翼气动噪声进行建模 [1]。',
    citations: [mockCitations[0], { ...mockCitations[1], label: '1' }],
  });
  assert.equal(result.claims[0].status, 'not-in-library');
  assert.equal(result.claims[0].reason, 'dangling-citation');
});

test('structured [[cite:id]] tokens resolve to canonical labels before evidence checks', () => {
  const citations: InputCitation[] = [
    { id: 'agent-rag:paper-alpha:pdf-text:chunk-1', label: '1', paperId: 'paper-alpha', paperTitle: '基于深度学习的旋翼气动噪声预测', pageIndex: 12, previewText: '本文采用深度学习神经网络方法，对倾转旋翼飞行器的气动噪声进行高精度数值预测。' },
  ];
  const result = bindAnswerEvidence({
    answer: '本项研究采用深度学习神经网络对旋翼气动噪声进行建模分析 [[cite:agent-rag:paper-alpha:pdf-text:chunk-1]]。',
    citations,
  });
  assert.equal(result.claims[0].status, 'supported');
  assert.equal(result.claims[0].citations[0].paperId, 'paper-alpha');

  const unknown = bindAnswerEvidence({
    answer: '本项研究采用深度学习神经网络对旋翼气动噪声进行建模分析 [[cite:agent-rag:unknown:chunk]]。',
    citations,
  });
  assert.equal(unknown.claims[0].status, 'not-in-library');
});

test('assertEvidenceForNoteDraft enforces strict gate on excerpt and synthesis', () => {
  // synthesis 包含 partial 句时被拒绝
  assert.throws(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'synthesis',
        content: '在空间结构物理学领域中行星自转轴偏角导致了潮汐变迁 [1]。',
      },
      mockCitations,
    );
  }, /写入笔记草稿被门禁拦截（pageKind="synthesis"）/);

  // synthesis 包含 not-in-library 句时被拒绝
  assert.throws(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'synthesis',
        content: '这是一句没有任何引用支撑但声称是综述的句子。',
      },
      mockCitations,
    );
  }, /写入笔记草稿被门禁拦截（pageKind="synthesis"）/);

  // excerpt 包含未完全支持的句子被拒绝
  assert.throws(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'excerpt',
        content: '未在原文献片段出现的摘录文字表述内容 [1]。',
      },
      mockCitations,
    );
  }, /写入笔记草稿被门禁拦截（pageKind="excerpt"）/);

  // synthesis 全为 supported 时放行通过
  assert.doesNotThrow(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'synthesis',
        content: '本项研究采用深度学习神经网络对旋翼气动噪声进行建模分析 [1]。',
      },
      mockCitations,
    );
  });
});

test('assertEvidenceForNoteDraft handles qa, concept, paper-card inference relaxation', () => {
  // qa 含 not-in-library 必定拒绝
  assert.throws(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'qa',
        content: '这是一个毫无库内证据支持的凭空断言句子。',
      },
      mockCitations,
    );
  }, /写入笔记草稿被门禁拦截（pageKind="qa"）/);

  // qa 含 partial 且无「我的推断」时拒绝
  assert.throws(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'qa',
        content: '在空间物理学中自转轴偏角导致潮汐规律发生改变 [1]。',
      },
      mockCitations,
    );
  }, /部分支持的陈述必须明确标注「我的推断」/);

  // qa 含 partial 且明确写了「我的推断」时放行
  assert.doesNotThrow(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'qa',
        content: '我的推断是在空间物理学中自转轴偏角可能引发潮汐变迁 [1]。',
      },
      mockCitations,
    );
  });

  // concept / paper-card 同理：明确写了「我的推断」时放行 partial
  assert.doesNotThrow(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'concept',
        content: '我的推断是该优化算法在复杂边界约束下仍能收敛 [2]。',
      },
      mockCitations,
    );
  });
});

test('assertEvidenceForNoteDraft allows index, log, overview without restrictions', () => {
  assert.doesNotThrow(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'index',
        content: '任意系统索引维护内容，无需挂文献编号与片段。',
      },
      mockCitations,
    );
  });

  assert.doesNotThrow(() => {
    assertEvidenceForNoteDraft(
      {
        pageKind: 'log',
        content: '系统运行日志或日常实验记录文本内容。',
      },
      mockCitations,
    );
  });
});
