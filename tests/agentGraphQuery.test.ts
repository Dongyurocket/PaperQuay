import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findMissingPaperEdges,
  groupConceptTopics,
  normalizeGraphPaperId,
  paperGraphNodeId,
  reshapeGraphNeighbors,
  GRAPH_MISSING_EDGE_MAX_PAIRS,
  type GraphRawEdge,
  type GraphRawNode,
} from '../src/services/agentGraphQuery.ts';

function makeNode(id: string, type: string, extra: Partial<GraphRawNode> = {}): GraphRawNode {
  return { id, type, label: `label-of-${id}`, ...extra };
}

function makeEdge(source: string, target: string, type: string): GraphRawEdge {
  return { id: `${type}:${source}->${target}`, source, target, type, label: type };
}

test('reshapeGraphNeighbors 默认排除共作者边与向量边', () => {
  const raw = {
    nodes: [
      makeNode('paper:a', 'paper', { paperId: 'a' }),
      makeNode('paper:b', 'paper', { paperId: 'b' }),
      makeNode('note:n1', 'note', { noteId: 'n1' }),
    ],
    edges: [
      makeEdge('paper:a', 'paper:b', 'paper_cites_paper'),
      makeEdge('paper:a', 'paper:b', 'co_author'),
      makeEdge('paper:a', 'paper:b', 'related_by_embedding'),
      makeEdge('note:n1', 'paper:a', 'note_paper'),
    ],
  };

  const result = reshapeGraphNeighbors(raw, { focusId: 'paper:a' });

  assert.equal(result.focusId, 'paper:a');
  assert.equal(result.focusLabel, 'label-of-paper:a');
  assert.deepEqual(
    result.edges.map((edge) => edge.type).sort(),
    ['note_paper', 'paper_cites_paper'],
  );
  assert.equal(result.truncated, false);
  // 焦点节点排在最前
  assert.equal(result.nodes[0]?.id, 'paper:a');
});

test('reshapeGraphNeighbors 节点超上限截断并标记 truncated', () => {
  const nodes = [makeNode('paper:focus', 'paper', { paperId: 'focus' })];
  const edges: GraphRawEdge[] = [];

  for (let index = 0; index < 45; index += 1) {
    nodes.push(makeNode(`note:n${index}`, 'note', { noteId: `n${index}` }));
    edges.push(makeEdge(`note:n${index}`, 'paper:focus', 'note_paper'));
  }

  const result = reshapeGraphNeighbors({ nodes, edges }, { focusId: 'paper:focus' });

  assert.equal(result.nodes.length, 40);
  assert.equal(result.nodes[0]?.id, 'paper:focus');
  assert.equal(result.truncated, true);
  // 被截掉的节点相关边也不得残留
  const keptIds = new Set(result.nodes.map((node) => node.id));
  for (const edge of result.edges) {
    assert.ok(keptIds.has(edge.source) && keptIds.has(edge.target));
  }
  assert.ok(result.edges.length <= 80);
});

test('reshapeGraphNeighbors 未知 focusId 返回空结果而不抛异常', () => {
  const result = reshapeGraphNeighbors(
    { nodes: [makeNode('paper:a', 'paper')], edges: [] },
    { focusId: 'paper:missing' },
  );

  assert.deepEqual(result, {
    focusId: 'paper:missing',
    focusLabel: '',
    nodes: [],
    edges: [],
    truncated: false,
  });

  // null/undefined 输入同样安全
  assert.doesNotThrow(() => reshapeGraphNeighbors(null, { focusId: 'paper:x' }));
  assert.doesNotThrow(() => reshapeGraphNeighbors(undefined));
});

test('findMissingPaperEdges 共享标签且无桥接关系时检出缺边', () => {
  const missing = findMissingPaperEdges({
    papers: [
      { id: 'a', title: '论文 A', tagNames: ['旋翼噪声'], categoryIds: [] },
      { id: 'b', title: '论文 B', tagNames: ['旋翼噪声', '气动'], categoryIds: [] },
    ],
    edges: [],
  });

  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.leftPaperId, 'a');
  assert.equal(missing[0]?.rightPaperId, 'b');
  assert.equal(missing[0]?.reason, 'shared-tag');
  assert.deepEqual(missing[0]?.sharedTags, ['旋翼噪声']);
});

test('findMissingPaperEdges 仅共享分类时理由为 shared-category', () => {
  const missing = findMissingPaperEdges({
    papers: [
      { id: 'a', title: '论文 A', tagNames: [], categoryIds: ['cat-1'] },
      { id: 'b', title: '论文 B', tagNames: [], categoryIds: ['cat-1', 'cat-2'] },
    ],
    edges: [],
  });

  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.reason, 'shared-category');
  assert.deepEqual(missing[0]?.sharedCategoryIds, ['cat-1']);
});

test('findMissingPaperEdges 直接引用与自定义关系算已连接', () => {
  const papers = [
    { id: 'a', title: '论文 A', tagNames: ['t'], categoryIds: [] },
    { id: 'b', title: '论文 B', tagNames: ['t'], categoryIds: [] },
    { id: 'c', title: '论文 C', tagNames: ['t'], categoryIds: [] },
    { id: 'd', title: '论文 D', tagNames: ['t'], categoryIds: [] },
  ];

  const missing = findMissingPaperEdges({
    papers,
    edges: [
      makeEdge('paper:a', 'paper:b', 'paper_cites_paper'),
      makeEdge('paper:c', 'paper:d', 'custom_relation'),
      makeEdge('paper:d', 'paper:a', 'paper_reference'),
    ],
  });

  // 6 对组合中 a-b（cites）、c-d（custom）、a-d（reference）已连接；剩 a-c、b-c、b-d
  const keys = missing.map((edge) => [edge.leftPaperId, edge.rightPaperId].sort().join('::'));
  assert.ok(!keys.includes('a::b'));
  assert.ok(!keys.includes('c::d'));
  assert.ok(!keys.includes('a::d'));
  assert.deepEqual([...keys].sort(), ['a::c', 'b::c', 'b::d']);
});

test('findMissingPaperEdges 同一篇笔记桥接算已连接', () => {
  const missing = findMissingPaperEdges({
    papers: [
      { id: 'a', title: '论文 A', tagNames: ['t'], categoryIds: [] },
      { id: 'b', title: '论文 B', tagNames: ['t'], categoryIds: [] },
    ],
    edges: [
      makeEdge('note:n1', 'paper:a', 'note_paper'),
      makeEdge('note:n1', 'paper:b', 'note_paper'),
    ],
  });

  assert.equal(missing.length, 0);
});

test('findMissingPaperEdges 共享标签边本身不算已连接（红线）', () => {
  // 两篇论文经 paper_tag 指向同一个 tag: 节点——这不构成「已连接」
  const missing = findMissingPaperEdges({
    papers: [
      { id: 'a', title: '论文 A', tagNames: ['旋翼'], categoryIds: [] },
      { id: 'b', title: '论文 B', tagNames: ['旋翼'], categoryIds: [] },
    ],
    edges: [
      makeEdge('paper:a', 'tag:旋翼', 'paper_tag'),
      makeEdge('paper:b', 'tag:旋翼', 'paper_tag'),
    ],
  });

  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.reason, 'shared-tag');
});

test('findMissingPaperEdges 向量对达阈值才报 embedding-near', () => {
  const papers = [
    { id: 'a', title: '论文 A', tagNames: [], categoryIds: [] },
    { id: 'b', title: '论文 B', tagNames: [], categoryIds: [] },
  ];

  const near = findMissingPaperEdges({
    papers,
    edges: [],
    embeddingPairs: [{ leftPaperId: 'a', rightPaperId: 'b', similarity: 0.9 }],
    embeddingMinSimilarity: 0.82,
  });
  assert.equal(near.length, 1);
  assert.equal(near[0]?.reason, 'embedding-near');

  const below = findMissingPaperEdges({
    papers,
    edges: [],
    embeddingPairs: [{ leftPaperId: 'a', rightPaperId: 'b', similarity: 0.5 }],
    embeddingMinSimilarity: 0.82,
  });
  assert.equal(below.length, 0);

  // 无共享标签/分类且未给向量对时不报缺边
  assert.equal(findMissingPaperEdges({ papers, edges: [] }).length, 0);
});

test('findMissingPaperEdges 单次输出不超过 24 对', () => {
  const papers = Array.from({ length: 12 }, (_, index) => ({
    id: `p${index}`,
    title: `论文 ${index}`,
    tagNames: ['共同标签'],
    categoryIds: [],
  }));

  // 12 篇两两组合共 66 对，全部无连接
  const missing = findMissingPaperEdges({ papers, edges: [] });

  assert.equal(missing.length, GRAPH_MISSING_EDGE_MAX_PAIRS);
  assert.ok(missing.length <= 24);
});

test('findMissingPaperEdges 论文少于 2 篇时返回空数组', () => {
  assert.deepEqual(
    findMissingPaperEdges({
      papers: [{ id: 'a', title: '论文 A', tagNames: ['t'], categoryIds: [] }],
      edges: [],
    }),
    [],
  );
});

test('normalizeGraphPaperId 去掉已知前缀', () => {
  assert.equal(normalizeGraphPaperId('paper:abc'), 'abc');
  assert.equal(normalizeGraphPaperId('native-library:abc'), 'abc');
  assert.equal(normalizeGraphPaperId('abc'), 'abc');
  assert.equal(paperGraphNodeId('paper:abc'), 'paper:abc');
});

test('groupConceptTopics 提取概念页定义片段与关联文献统计', () => {
  const longBody = '概'.repeat(300);
  const topics = groupConceptTopics([
    {
      id: 'n1',
      title: '主动降噪',
      pageKind: 'concept',
      contentText: longBody,
      paperId: 'p1',
      linkedPaperIds: ['p1', 'p2'],
    },
    {
      id: 'n2',
      title: '普通笔记',
      pageKind: 'excerpt',
      contentText: '不应被收录',
      linkedPaperIds: ['p9'],
    },
    {
      id: 'n3',
      title: '空正文概念',
      pageKind: 'concept',
      contentText: '',
      linkedPaperIds: [],
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.noteId, 'n1');
  assert.equal(topics[0]?.definitionSnippet.length, 240);
  assert.deepEqual(topics[0]?.linkedPaperIds, ['p1', 'p2']);
  assert.equal(topics[0]?.linkedPaperCount, 2);
  // 无正文时不编造定义
  assert.equal(topics[1]?.definitionSnippet, '');
  assert.equal(topics[1]?.linkedPaperCount, 0);
});
