import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateGraphByCategory,
  buildGraphElements,
  buildProgressRingImage,
  computeEdgePairCounts,
  computeGraphSignature,
  computeLodVisibleEdgeIds,
  matchGraphNodeIds,
  resolveEdgeCurve,
  resolveNodeColor,
  resolveLodRatio,
  resolveNodeShape,
  resolveYearColor,
  selectLodVisibleEdgeIds,
} from '../src/features/graph/graphPresentation.ts';
import type { KnowledgeGraphSnapshot } from '../src/types/knowledgeGraph.ts';

function node(overrides: Partial<KnowledgeGraphSnapshot['nodes'][number]> = {}) {
  return {
    id: 'paper:1',
    type: 'paper' as const,
    label: 'A paper',
    ...overrides,
  };
}

function edge(overrides: Partial<KnowledgeGraphSnapshot['edges'][number]> = {}) {
  return {
    id: 'e1',
    source: 'paper:1',
    target: 'paper:2',
    type: 'related_by_embedding' as const,
    label: 'similar',
    weight: 0.5,
    ...overrides,
  };
}

test('node shapes follow the visual contract', () => {
  assert.equal(resolveNodeShape('paper'), 'ellipse');
  assert.equal(resolveNodeShape('note'), 'round-rectangle');
  assert.equal(resolveNodeShape('tag'), 'diamond');
  assert.equal(resolveNodeShape('category'), 'hexagon');
  assert.equal(resolveNodeShape('reference'), 'rectangle');
});

test('color modes: category, type, year and cluster', () => {
  const paper = node({ color: '#123456', year: '2021' });
  assert.equal(resolveNodeColor(paper, 'category'), '#123456');
  assert.equal(resolveNodeColor(paper, 'type'), '#2563eb');
  assert.equal(resolveNodeColor(paper, 'year'), '#f59e0b');
  assert.equal(resolveNodeColor(paper, 'cluster'), '#123456');

  const noCategory = node({ color: undefined });
  assert.equal(resolveNodeColor(noCategory, 'category'), '#64748b');

  assert.equal(resolveYearColor('2009'), '#94a3b8');
  assert.equal(resolveYearColor('2013'), '#38bdf8');
  assert.equal(resolveYearColor('2018'), '#22c55e');
  assert.equal(resolveYearColor('2021'), '#f59e0b');
  assert.equal(resolveYearColor('2024'), '#ef4444');
  assert.equal(resolveYearColor(null), '#64748b');
  assert.equal(resolveYearColor('unknown'), '#64748b');
});

test('progress rings are bucketed, cached and empty at zero', () => {
  assert.equal(buildProgressRingImage(0), '');
  assert.equal(buildProgressRingImage(null), '');
  // 0.4.42 回归：不足半桶的进度没有外环，必须返回空串（调用方据此关闭 hasProgress）。
  assert.equal(buildProgressRingImage(0.005), '');
  assert.equal(buildProgressRingImage(0.024), '');
  const half = buildProgressRingImage(0.5);
  assert.ok(half.startsWith('data:image/svg+xml,'));
  // 同一 5% 桶命中缓存，返回同一字符串。
  assert.equal(buildProgressRingImage(0.51), half);
  assert.equal(buildProgressRingImage(0.52), half);
  assert.notEqual(buildProgressRingImage(0.9), half);
  assert.ok(buildProgressRingImage(1).startsWith('data:image/svg+xml,'));
});

test('parallel and directional edges use distinguishable curves', () => {
  assert.equal(resolveEdgeCurve(edge(), { multiEdge: false, nodeCount: 100 }), 'straight');
  assert.equal(resolveEdgeCurve(edge(), { multiEdge: true, nodeCount: 100 }), 'bezier');
  assert.equal(resolveEdgeCurve(edge({ type: 'paper_cites_paper' }), { multiEdge: false, nodeCount: 100 }), 'bezier');
  assert.equal(resolveEdgeCurve(edge({ type: 'paper_tag' }), { multiEdge: false, nodeCount: 100 }), 'bezier');
  assert.equal(resolveEdgeCurve(edge({ type: 'paper_tag' }), { multiEdge: false, nodeCount: 1000 }), 'haystack');

  const counts = computeEdgePairCounts([
    { source: 'b', target: 'a' },
    { source: 'a', target: 'b' },
    { source: 'c', target: 'a' },
  ]);
  assert.equal(counts.get('a\u0000b'), 2);
  assert.equal(counts.get('a\u0000c'), 1);
});

test('elements carry shape, color, degree, display labels and progress', () => {
  const snapshot: KnowledgeGraphSnapshot = {
    generatedAt: 0,
    nodes: [
      node({ id: 'paper:1', label: 'First', color: '#111111', size: 30, readingProgress: 0.5 }),
      node({ id: 'paper:2', label: 'Second', color: '#222222', size: 20, degree: 4 }),
      node({ id: 'note:1', type: 'note', label: 'Note' }),
    ],
    edges: [edge()],
  };
  const elements = buildGraphElements(snapshot, {
    localizeNodeLabel: (item) => item.label,
    colorMode: 'category',
  });
  const paper = elements.find((item) => item.data.id === 'paper:1');
  const note = elements.find((item) => item.data.id === 'note:1');
  assert.ok(paper);
  assert.equal(paper.data.shape, 'ellipse');
  assert.equal(paper.data.color, '#111111');
  assert.equal(paper.data.hasProgress, 1);
  assert.ok(String(paper.data.progressImage).startsWith('data:image/svg+xml,'));
  assert.equal(paper.data.displayLabel, 'First');
  assert.equal(note?.data.shape, 'round-rectangle');
  assert.equal(note?.data.hasProgress, 0);
});

test('sub-threshold reading progress never enables the empty progress ring', () => {
  // 0.4.41 实机缺陷：0.523% 的进度让 hasProgress=1 但 progressImage=''，
  // cytoscape 解析空 background-image 时抛 null.value，整张图谱空白。
  const snapshot: KnowledgeGraphSnapshot = {
    generatedAt: 0,
    nodes: [
      node({ id: 'paper:low', label: 'Low', readingProgress: 0.005230672664504656 }),
      node({ id: 'paper:zero', label: 'Zero', readingProgress: 0 }),
      node({ id: 'paper:mid', label: 'Mid', readingProgress: 0.4 }),
    ],
    edges: [],
  };
  const elements = buildGraphElements(snapshot, { localizeNodeLabel: (item) => item.label });
  const byId = new Map(elements.map((item) => [String(item.data.id), item.data]));
  assert.equal(byId.get('paper:low')?.hasProgress, 0);
  assert.equal(byId.get('paper:low')?.progressImage, '');
  assert.equal(byId.get('paper:zero')?.hasProgress, 0);
  assert.equal(byId.get('paper:mid')?.hasProgress, 1);
  assert.ok(String(byId.get('paper:mid')?.progressImage).startsWith('data:image/svg+xml,'));

  // 任意节点只要声明了 hasProgress=1，就必须有可解析的图片。
  for (const data of byId.values()) {
    if (data.hasProgress === 1) assert.notEqual(data.progressImage, '');
  }
});

test('LOD keeps top-weight edges and every directional edge', () => {
  const edges = [
    edge({ id: 'low', weight: 0.1 }),
    edge({ id: 'mid', weight: 0.4 }),
    edge({ id: 'high', weight: 0.9 }),
    edge({ id: 'cite', type: 'paper_cites_paper', weight: 0.01 }),
  ];
  assert.deepEqual([...selectLodVisibleEdgeIds(edges, 0.25)].sort(), ['cite', 'high']);
  assert.deepEqual([...selectLodVisibleEdgeIds(edges, 1)].sort(), ['cite', 'high', 'low', 'mid']);
  assert.deepEqual([...computeLodVisibleEdgeIds(edges, 0.5)].sort(), ['cite', 'high', 'mid']);
});

test('search matches labels, subtitles, tags and DOIs', () => {
  const nodes = [
    node({ id: 'a', label: 'Rotor aerodynamics', tag: 'VTOL' }),
    node({ id: 'b', label: 'Other', subtitle: 'Xiang Chen · 2024', doi: '10.1/ABC' }),
  ];
  assert.deepEqual([...matchGraphNodeIds(nodes, 'rotor')], ['a']);
  assert.deepEqual([...matchGraphNodeIds(nodes, 'vtol')], ['a']);
  assert.deepEqual([...matchGraphNodeIds(nodes, '10.1/abc')], ['b']);
  assert.deepEqual([...matchGraphNodeIds(nodes, 'xiang')], ['b']);
  assert.equal(matchGraphNodeIds(nodes, '').size, 0);
});

test('category aggregation conserves papers and expands one cluster', () => {
  const snapshot: KnowledgeGraphSnapshot = {
    generatedAt: 0,
    nodes: [
      node({ id: 'paper:1', label: 'One', primaryCategoryId: 'cat-a', categoryIds: ['cat-a'] }),
      node({ id: 'paper:2', label: 'Two', primaryCategoryId: 'cat-a', categoryIds: ['cat-a'] }),
      node({ id: 'paper:3', label: 'Three', primaryCategoryId: 'cat-b', categoryIds: ['cat-b'] }),
      node({ id: 'paper:4', label: 'Four', categoryIds: [] }),
      node({ id: 'category:cat-a', type: 'category', label: 'A', categoryId: 'cat-a' }),
      node({ id: 'category:cat-b', type: 'category', label: 'B', categoryId: 'cat-b' }),
    ],
    edges: [
      edge({ id: 'a1', source: 'paper:1', target: 'paper:2' }),
      edge({ id: 'ab', source: 'paper:1', target: 'paper:3' }),
      edge({ id: 'note', source: 'paper:1', target: 'note:x', type: 'note_paper' }),
    ],
  };

  const collapsed = aggregateGraphByCategory(snapshot, { uncategorizedLabel: 'Uncategorized' });
  assert.equal(collapsed.nodes.filter((item) => item.type === 'paper').length, 0);
  // 有分类节点的组复用原分类节点；只有未分类新建 cluster 超节点。
  const catA = collapsed.nodes.find((item) => item.id === 'category:cat-a');
  const catB = collapsed.nodes.find((item) => item.id === 'category:cat-b');
  const uncategorized = collapsed.nodes.find((item) => item.id === 'cluster:__uncategorized__');
  assert.equal(catA?.subtitle, '2 papers');
  assert.equal(catB?.subtitle, '1 paper');
  assert.equal(uncategorized?.subtitle, '1 paper');
  assert.equal(collapsed.nodes.filter((item) => item.type === 'category').length, 3);
  assert.ok(collapsed.edges.some((item) => item.id.startsWith('cluster-edge:')));

  const expanded = aggregateGraphByCategory(snapshot, {
    uncategorizedLabel: 'Uncategorized',
    expandedCategoryIds: new Set(['cat-a']),
  });
  assert.equal(expanded.nodes.filter((item) => item.type === 'paper').length, 2);
  assert.ok(expanded.edges.some((item) => item.id === 'a1'), 'paper-paper edge survives expansion');
});

test('graph signature is order-independent and changes with membership', () => {
  const left: KnowledgeGraphSnapshot = {
    generatedAt: 0,
    nodes: [node({ id: 'a' }), node({ id: 'b' })],
    edges: [edge({ id: 'e', source: 'a', target: 'b' })],
  };
  const right: KnowledgeGraphSnapshot = {
    generatedAt: 99,
    nodes: [node({ id: 'b' }), node({ id: 'a' })],
    edges: [edge({ id: 'e', source: 'a', target: 'b' })],
  };
  assert.equal(computeGraphSignature(left), computeGraphSignature(right));
  const changed: KnowledgeGraphSnapshot = { ...left, nodes: [...left.nodes, node({ id: 'c' })] };
  assert.notEqual(computeGraphSignature(left), computeGraphSignature(changed));
});

test('LOD ratio follows zoom tiers with a bounded base', () => {
  assert.equal(resolveLodRatio(0.2, 0.2), 0.2);
  assert.equal(resolveLodRatio(0.49, 0.2), 0.2);
  assert.equal(resolveLodRatio(0.6, 0.2), 0.5);
  assert.equal(resolveLodRatio(0.6, 0.5), 0.6);
  assert.equal(resolveLodRatio(0.9, 0.2), 1);
  assert.equal(resolveLodRatio(2, 0.2), 1);
  assert.equal(resolveLodRatio(Number.NaN, 0.2), 0.2);
});
