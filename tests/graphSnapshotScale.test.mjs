import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
  DEFAULT_GRAPH_NODE_LIMIT,
  applyGraphBounds,
  createKnowledgeGraphSnapshot,
} from '../electron/backend/knowledgeGraphCommands.cjs';

// S5-GRAPH-2 图谱规模基准。默认上限是 10k 节点 + 每节点 250 条边，最坏输出无向边为
// 10,000 × 250 / 2 = 1.25M 条；10k 节点两两相连约 50M 条边，不适合放进 Node 测试。
// 因此用 10k 节点、20 个 hub 的确定性合成图按平均度分档外推：
//   平均度 25  → 125k 输入边（默认档，始终运行）
//   平均度 100 → 500k 输入边（仅 PAPERQUAY_PERF=1）
//   平均度 250 → 1.25M 输入边（仅 PAPERQUAY_PERF=1，对应当前默认上限的最坏输出规模）
// 夹具的采样策略与实现一致：节点超限时按度数降序（同度按 id 升序）保留；每节点保留
// weight 最高的 250 条边（同 weight 按 edge id 升序）。hub 承担 16% 的边且每个 hub
// 的度数在每档都远超 250，因此每档都会触发默认 per-node 裁剪；尾节点度数低于 250，
// 便于精确断言输出边数 = hubCount × 250 + 未被裁剪的尾部边。
const PERF_MODE = process.env.PAPERQUAY_PERF === '1';
const GRAPH_BENCHMARK_NODE_COUNT = 10_000;
const GRAPH_BENCHMARK_HUB_COUNT = 20;
const GRAPH_BENCHMARK_HUB_SHARE = 0.16;
const GRAPH_BENCHMARK_TIERS = [
  {
    averageDegree: 25,
    perfOnly: false,
    budgetMs: 3000,
  },
  {
    averageDegree: 100,
    perfOnly: true,
    budgetMs: 10000,
  },
  {
    averageDegree: 250,
    perfOnly: true,
    budgetMs: 20000,
  },
];

function pad(value, width = 5) {
  return String(value).padStart(width, '0');
}

// 生成 hub 主导的确定性合成快照；边数 = nodeCount × averageDegree / 2。
function buildHubHeavySnapshot(averageDegree) {
  const nodeCount = GRAPH_BENCHMARK_NODE_COUNT;
  const hubCount = GRAPH_BENCHMARK_HUB_COUNT;
  const tailCount = nodeCount - hubCount;
  const totalEdges = Math.floor((nodeCount * averageDegree) / 2);
  // 每个 hub 最多连 tailCount 个尾节点，保证 hub 尾边无重复。
  const hubTailEdges = Math.min(
    Math.floor(totalEdges * GRAPH_BENCHMARK_HUB_SHARE),
    hubCount * tailCount,
  );
  const tailTailEdges = totalEdges - hubTailEdges;

  const nodes = new Array(nodeCount);
  for (let index = 0; index < hubCount; index += 1) {
    nodes[index] = { id: `hub-${pad(index, 3)}`, type: 'tag', label: `Hub ${index}`, size: 20 };
  }
  for (let index = 0; index < tailCount; index += 1) {
    nodes[hubCount + index] = {
      id: `node-${pad(index)}`,
      type: 'paper',
      label: `Paper ${index}`,
      size: 8,
    };
  }

  const edges = new Array(totalEdges);
  let cursor = 0;
  for (let index = 0; index < hubTailEdges; index += 1) {
    const hubIndex = index % hubCount;
    const tailIndex = Math.floor(index / hubCount);
    const source = nodes[hubIndex].id;
    const target = nodes[hubCount + tailIndex].id;
    edges[cursor] = {
      id: `hub:${source}->${target}`,
      source,
      target,
      weight: ((index * 37) % 997) / 1000,
    };
    cursor += 1;
  }
  // 尾节点之间用不同步长的环形偏移连接：同一偏移下每个节点只出现一次，
  // 偏移量小于 tailCount，因此无重复边且输出顺序确定。
  for (let index = 0; index < tailTailEdges; index += 1) {
    const step = Math.floor(index / tailCount) + 1;
    const tailIndex = index % tailCount;
    const source = nodes[hubCount + tailIndex].id;
    const target = nodes[hubCount + ((tailIndex + step) % tailCount)].id;
    edges[cursor] = {
      id: `tail:${source}->${target}`,
      source,
      target,
      weight: ((index * 53) % 997) / 1000,
    };
    cursor += 1;
  }

  return { nodes, edges, generatedAt: 1 };
}

function createPapers(count) {
  const papers = [];
  for (let index = 0; index < count; index += 1) {
    papers.push({
      id: `paper-${pad(index)}`,
      title: `Synthetic Graph Paper ${index} On Topic ${index % 500}`,
      authors: [{ name: `Author ${index}` }],
      year: String(2000 + (index % 25)),
      publication: `Journal ${index % 50}`,
      readingProgress: (index % 100) / 100,
      // 20 tags * 500 papers each and 10 collections * 1000 papers each create
      // realistic hubs for the degree-based sampling test.
      tags: [{ name: `tag-${index % 20}` }],
      categoryIds: [`cat-${index % 10}`],
      references: [],
    });
  }
  return papers;
}

function createContext(papers) {
  return {
    appPaths: { dataDir: '' },
    store: {
      load() {
        return {
          papers,
          categories: Array.from({ length: 10 }, (_, index) => ({
            id: `cat-${index}`,
            name: `Category ${index}`,
            paperCount: Math.ceil(papers.length / 10),
            isSystem: false,
          })),
        };
      },
      loadAllReferences() {
        return [];
      },
    },
    noteStore: { listNotes: () => [] },
    ragStore: { available: false },
  };
}

function edgeDegree(snapshot, nodeId) {
  let degree = 0;
  for (const edge of snapshot.edges) {
    if (edge.source === nodeId || edge.target === nodeId) degree += 1;
  }
  return degree;
}

test('applyGraphBounds returns the same snapshot when nothing exceeds the budget', () => {
  const snapshot = {
    nodes: [{ id: 'paper:a' }, { id: 'paper:b' }],
    edges: [{ id: 'e1', source: 'paper:a', target: 'paper:b', weight: 0.5 }],
    generatedAt: 1,
  };
  const bounded = applyGraphBounds(snapshot, { nodeLimit: 100, edgeLimitPerNode: 50 });
  assert.equal(bounded, snapshot);
  assert.equal(bounded.metadata, undefined);
});

test('applyGraphBounds samples deterministically by degree desc then id asc', () => {
  const snapshot = {
    nodes: ['c', 'b', 'a', 'd'].map((id) => ({ id })),
    edges: [
      { id: 'e-a1', source: 'a', target: 'b', weight: 0.4 },
      { id: 'e-a2', source: 'a', target: 'c', weight: 0.4 },
      { id: 'e-d1', source: 'd', target: 'c', weight: 0.4 },
    ],
    generatedAt: 1,
  };

  const first = applyGraphBounds(snapshot, { nodeLimit: 2, edgeLimitPerNode: 10 });
  const second = applyGraphBounds(snapshot, { nodeLimit: 2, edgeLimitPerNode: 10 });

  assert.deepEqual(first.nodes.map((node) => node.id), ['c', 'a']);
  assert.deepEqual(second.nodes.map((node) => node.id), ['c', 'a']);
  assert.deepEqual(first.edges.map((edge) => edge.id), ['e-a2']);
  assert.deepEqual(first.metadata, {
    sampled: true,
    truncated: true,
    nodeLimit: 2,
    edgeLimitPerNode: 10,
    totalNodes: 4,
    returnedNodes: 2,
    totalEdges: 3,
    returnedEdges: 1,
  });
});

test('applyGraphBounds keeps the highest-weight edges per node and is deterministic', () => {
  const nodes = [{ id: 'hub' }, ...Array.from({ length: 6 }, (_, index) => ({ id: `leaf-${index}` }))];
  const edges = Array.from({ length: 6 }, (_, index) => ({
    id: `edge-${index}`,
    source: 'hub',
    target: `leaf-${index}`,
    // Two equal weights exercise the id-based tie-break.
    weight: index < 2 ? 0.9 : index < 4 ? 0.5 : 0.5,
  }));
  const snapshot = { nodes, edges, generatedAt: 1 };

  const first = applyGraphBounds(snapshot, { nodeLimit: 100, edgeLimitPerNode: 2 });
  const second = applyGraphBounds(snapshot, { nodeLimit: 100, edgeLimitPerNode: 2 });

  assert.deepEqual(first.edges.map((edge) => edge.id), ['edge-0', 'edge-1']);
  assert.deepEqual(second.edges.map((edge) => edge.id), ['edge-0', 'edge-1']);
  assert.equal(first.metadata.truncated, true);
  assert.equal(first.metadata.sampled, false);
  assert.equal(first.metadata.totalEdges, 6);
  assert.equal(first.metadata.returnedEdges, 2);
});

test('untitled notes keep an empty graph label instead of an English sentinel', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-untitled-'));
  try {
    const context = createContext([]);
    context.appPaths.dataDir = dir;
    context.noteStore = {
      listNotes: () => [{
        id: 'note-untitled',
        title: '',
        paperId: 'global-notes',
        type: 'standalone',
        content: '',
        contentText: '',
        tags: [],
        linkedNoteIds: [],
        linkedPaperIds: [],
        folderId: null,
        updatedAt: 1,
      }],
    };
    const snapshot = await createKnowledgeGraphSnapshot(context, {
      includePapers: false,
      includeTags: false,
      includeCategories: false,
      includeReferences: false,
      includeCoAuthors: false,
      includeEmbeddingEdges: false,
    });
    const node = snapshot.nodes.find((item) => item.id === 'note:note-untitled');
    assert.ok(node);
    assert.equal(node.label, '');
    assert.doesNotMatch(String(node.label), /Untitled Note/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('small libraries keep the historic snapshot shape without sampling metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-small-'));
  try {
    const context = createContext(createPapers(3));
    context.appPaths.dataDir = dir;
    const snapshot = await createKnowledgeGraphSnapshot(context, {});
    assert.equal(snapshot.metadata?.sampled, undefined);
    assert.equal(snapshot.metadata?.truncated, undefined);
    assert.ok(snapshot.metadata?.graphQuality);
    assert.equal(snapshot.metadata.graphQuality.nodeCount, snapshot.nodes.length);
    assert.equal(snapshot.nodes.length, 3 + 3 + 10);
    assert.ok(snapshot.edges.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('per-node edge cap bounds hub degree and reports truncation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-cap-'));
  try {
    const papers = createPapers(120).map((paper, index) => ({
      ...paper,
      id: `paper-hub-${pad(index)}`,
      tags: [{ name: 'shared-hub' }],
      categoryIds: ['cat-0'],
    }));
    const context = createContext(papers);
    context.appPaths.dataDir = dir;

    const snapshot = await createKnowledgeGraphSnapshot(context, {
      graphEdgeLimitPerNode: 5,
      includePapers: true,
      graphNodeLimit: 10000,
    });
    const hub = snapshot.nodes.find((node) => node.id === 'tag:shared-hub');
    assert.ok(hub, 'the shared tag hub must survive node sampling');
    assert.ok(edgeDegree(snapshot, 'tag:shared-hub') <= 5);
    assert.equal(snapshot.metadata?.truncated, true);
    assert.equal(snapshot.metadata?.sampled, false);
    assert.equal(snapshot.metadata?.edgeLimitPerNode, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('10k-paper snapshot is bounded, deterministic, and fast', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-scale-'));
  try {
    const papers = createPapers(10_000);
    const context = createContext(papers);
    context.appPaths.dataDir = dir;

    const startedAt = performance.now();
    const snapshot = await createKnowledgeGraphSnapshot(context, {});
    const elapsedMs = performance.now() - startedAt;

    assert.ok(elapsedMs < 2000, `10k snapshot took ${elapsedMs.toFixed(0)}ms (budget 2000ms)`);
    assert.equal(snapshot.metadata?.sampled, true);
    assert.equal(snapshot.metadata?.truncated, true);
    assert.equal(snapshot.metadata?.nodeLimit, DEFAULT_GRAPH_NODE_LIMIT);
    assert.equal(snapshot.metadata?.totalNodes, 10_000 + 20 + 10);
    assert.equal(snapshot.metadata?.returnedNodes, DEFAULT_GRAPH_NODE_LIMIT);
    assert.ok(snapshot.nodes.length <= DEFAULT_GRAPH_NODE_LIMIT);
    assert.ok(snapshot.edges.length <= snapshot.metadata?.totalEdges);

    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
    for (const edge of snapshot.edges) {
      assert.ok(nodeIds.has(edge.source), `dangling source ${edge.source}`);
      assert.ok(nodeIds.has(edge.target), `dangling target ${edge.target}`);
    }

    // High-degree hubs survive the top-degree sample.
    assert.ok(nodeIds.has('tag:tag-0'));
    assert.ok(nodeIds.has('category:cat-0'));

    const repeated = await createKnowledgeGraphSnapshot(context, {});
    assert.deepEqual(
      repeated.nodes.map((node) => node.id),
      snapshot.nodes.map((node) => node.id),
    );
    assert.deepEqual(
      repeated.edges.map((edge) => edge.id),
      snapshot.edges.map((edge) => edge.id),
    );

    console.log(`[graph benchmark] 10k papers snapshot: ${elapsedMs.toFixed(0)}ms, nodes=${snapshot.nodes.length}, edges=${snapshot.edges.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('graphNodeLimit bounds the returned node count', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-nodecap-'));
  try {
    const context = createContext(createPapers(500));
    context.appPaths.dataDir = dir;

    const snapshot = await createKnowledgeGraphSnapshot(context, { graphNodeLimit: 50 });
    assert.equal(snapshot.nodes.length, 50);
    assert.equal(snapshot.metadata?.sampled, true);
    assert.equal(snapshot.metadata?.nodeLimit, 50);
    assert.ok(snapshot.metadata.totalNodes > 50);
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
    assert.ok(nodeIds.has('tag:tag-0'), 'tag hubs have the highest degree');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('default budgets leave a small graph untouched (same object, no metadata)', () => {
  const snapshot = {
    nodes: [{ id: 'paper:a' }, { id: 'paper:b' }, { id: 'tag:t' }],
    edges: [
      { id: 'e1', source: 'paper:a', target: 'tag:t', weight: 0.9 },
      { id: 'e2', source: 'paper:b', target: 'tag:t', weight: 0.4 },
    ],
    generatedAt: 11,
  };

  const bounded = applyGraphBounds(snapshot, {
    nodeLimit: DEFAULT_GRAPH_NODE_LIMIT,
    edgeLimitPerNode: DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
  });

  assert.equal(bounded, snapshot);
  assert.equal(bounded.metadata, undefined);
});

test('exceeding the default node budget samples by degree then id without dangling edges', () => {
  const nodeCount = DEFAULT_GRAPH_NODE_LIMIT + 50;
  const connectedCount = DEFAULT_GRAPH_NODE_LIMIT;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({ id: `n-${pad(index)}` }));
  const edges = [];
  // 度数最高的星形 hub 只连前 101 个节点（度数 100，低于 per-node 上限），
  // 其余前 10k 节点两两配对；最后 50 个节点保持孤立，必然被 top-degree 抽样淘汰。
  for (let index = 1; index <= 100; index += 1) {
    edges.push({
      id: `star-${pad(index, 3)}`,
      source: 'n-00000',
      target: `n-${pad(index)}`,
      weight: 0.5,
    });
  }
  for (let index = 2; index + 1 < connectedCount; index += 2) {
    edges.push({
      id: `pair-${pad(index)}`,
      source: `n-${pad(index)}`,
      target: `n-${pad(index + 1)}`,
      weight: 0.5,
    });
  }

  const bounded = applyGraphBounds(
    { nodes, edges, generatedAt: 12 },
    { nodeLimit: DEFAULT_GRAPH_NODE_LIMIT, edgeLimitPerNode: DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE },
  );

  assert.deepEqual(bounded.metadata, {
    sampled: true,
    truncated: true,
    nodeLimit: DEFAULT_GRAPH_NODE_LIMIT,
    edgeLimitPerNode: DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
    totalNodes: nodeCount,
    returnedNodes: DEFAULT_GRAPH_NODE_LIMIT,
    totalEdges: edges.length,
    returnedEdges: edges.length,
  });
  assert.equal(bounded.nodes.length, DEFAULT_GRAPH_NODE_LIMIT);

  const nodeIds = new Set(bounded.nodes.map((node) => node.id));
  for (const node of nodes.slice(0, connectedCount)) {
    assert.ok(nodeIds.has(node.id), `expected connected ${node.id} to survive sampling`);
  }
  for (const node of nodes.slice(connectedCount)) {
    assert.ok(!nodeIds.has(node.id), `expected isolated ${node.id} to be sampled out`);
  }
  for (const edge of bounded.edges) {
    assert.ok(nodeIds.has(edge.source), `dangling source ${edge.source}`);
    assert.ok(nodeIds.has(edge.target), `dangling target ${edge.target}`);
  }
});

test('exceeding the default per-node edge budget keeps top-weight edges with full metadata', () => {
  const nodes = [
    { id: 'hub' },
    ...Array.from({ length: 300 }, (_, index) => ({ id: `leaf-${pad(index, 3)}` })),
  ];
  const edges = Array.from({ length: 300 }, (_, index) => ({
    id: `hub-edge-${pad(index, 3)}`,
    source: 'hub',
    target: `leaf-${pad(index, 3)}`,
    // 0.9..0.0 各 30 条：先按 weight 降序，再按 edge id 升序补齐。
    weight: (index % 10) / 10,
  }));

  const bounded = applyGraphBounds(
    { nodes, edges, generatedAt: 13 },
    { nodeLimit: DEFAULT_GRAPH_NODE_LIMIT, edgeLimitPerNode: DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE },
  );

  assert.deepEqual(bounded.metadata, {
    sampled: false,
    truncated: true,
    nodeLimit: DEFAULT_GRAPH_NODE_LIMIT,
    edgeLimitPerNode: DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
    totalNodes: 301,
    returnedNodes: 301,
    totalEdges: 300,
    returnedEdges: DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
  });

  // 权重 0.9..0.2 各 30 条全部保留（240 条），再从权重 0.1 的 30 条中按 id 升序补 10 条。
  const keptIds = bounded.edges.map((edge) => edge.id).sort();
  const expectedIds = edges
    .filter((edge) => edge.weight > 0.1)
    .map((edge) => edge.id)
    .concat(edges.filter((edge) => edge.weight === 0.1).slice(0, 10).map((edge) => edge.id))
    .sort();
  assert.deepEqual(keptIds, expectedIds);

  const nodeIds = new Set(bounded.nodes.map((node) => node.id));
  const degree = new Map();
  for (const edge of bounded.edges) {
    assert.ok(nodeIds.has(edge.source), `dangling source ${edge.source}`);
    assert.ok(nodeIds.has(edge.target), `dangling target ${edge.target}`);
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  assert.equal(degree.get('hub'), DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE);
  // 保留下来的 250 条边各自连到不同 leaf，因此出现的 leaf 度数恒为 1。
  assert.equal(degree.size, DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE + 1);
  for (const [nodeId, nodeDegree] of degree) {
    if (nodeId === 'hub') continue;
    assert.equal(nodeDegree, 1, `leaf ${nodeId} degree`);
  }
});

for (const tier of GRAPH_BENCHMARK_TIERS) {
  const inputEdges = Math.floor((GRAPH_BENCHMARK_NODE_COUNT * tier.averageDegree) / 2);
  test(
    `default graph budgets hold for 10k nodes with ${inputEdges.toLocaleString('en-US')} input edges`,
    {
      skip: tier.perfOnly && !PERF_MODE
        ? 'set PAPERQUAY_PERF=1 to run the heavy graph tiers'
        : false,
    },
    () => {
      const fixtureStartedAt = performance.now();
      const snapshot = buildHubHeavySnapshot(tier.averageDegree);
      const fixtureMs = performance.now() - fixtureStartedAt;

      const tailCount = GRAPH_BENCHMARK_NODE_COUNT - GRAPH_BENCHMARK_HUB_COUNT;
      const hubTailEdges = Math.min(
        Math.floor(snapshot.edges.length * GRAPH_BENCHMARK_HUB_SHARE),
        GRAPH_BENCHMARK_HUB_COUNT * tailCount,
      );
      const expectedReturnedEdges = GRAPH_BENCHMARK_HUB_COUNT * DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE
        + (snapshot.edges.length - hubTailEdges);

      const heapBefore = process.memoryUsage().heapUsed;
      const startedAt = performance.now();
      const bounded = applyGraphBounds(snapshot, {
        nodeLimit: DEFAULT_GRAPH_NODE_LIMIT,
        edgeLimitPerNode: DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
      });
      const elapsedMs = performance.now() - startedAt;
      const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);

      assert.equal(bounded.metadata.sampled, false);
      assert.equal(bounded.metadata.truncated, true);
      assert.equal(bounded.metadata.nodeLimit, DEFAULT_GRAPH_NODE_LIMIT);
      assert.equal(bounded.metadata.edgeLimitPerNode, DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE);
      assert.equal(bounded.metadata.totalNodes, GRAPH_BENCHMARK_NODE_COUNT);
      assert.equal(bounded.metadata.returnedNodes, GRAPH_BENCHMARK_NODE_COUNT);
      assert.equal(bounded.metadata.totalEdges, snapshot.edges.length);
      assert.equal(bounded.metadata.returnedEdges, expectedReturnedEdges);
      assert.equal(bounded.edges.length, expectedReturnedEdges);

      const nodeIds = new Set(bounded.nodes.map((node) => node.id));
      const degree = new Map();
      let maxDegree = 0;
      for (const edge of bounded.edges) {
        assert.ok(nodeIds.has(edge.source), `dangling source ${edge.source}`);
        assert.ok(nodeIds.has(edge.target), `dangling target ${edge.target}`);
        const sourceDegree = (degree.get(edge.source) ?? 0) + 1;
        const targetDegree = (degree.get(edge.target) ?? 0) + 1;
        degree.set(edge.source, sourceDegree);
        degree.set(edge.target, targetDegree);
        if (sourceDegree > maxDegree) maxDegree = sourceDegree;
        if (targetDegree > maxDegree) maxDegree = targetDegree;
      }
      assert.ok(
        maxDegree <= DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE,
        `max degree ${maxDegree} exceeds ${DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE}`,
      );
      for (let index = 0; index < GRAPH_BENCHMARK_HUB_COUNT; index += 1) {
        assert.equal(degree.get(`hub-${pad(index, 3)}`), DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE);
      }

      // 每节点按 weight 降序保留：hub-000 保留边的最小权重不低于被丢弃边的最大权重。
      const keptHubIds = new Set(
        bounded.edges
          .filter((edge) => edge.source === 'hub-000' || edge.target === 'hub-000')
          .map((edge) => edge.id),
      );
      assert.equal(keptHubIds.size, DEFAULT_GRAPH_EDGE_LIMIT_PER_NODE);
      let keptMinWeight = Infinity;
      let droppedMaxWeight = -Infinity;
      for (const edge of snapshot.edges) {
        if (edge.source !== 'hub-000' && edge.target !== 'hub-000') continue;
        if (keptHubIds.has(edge.id)) {
          keptMinWeight = Math.min(keptMinWeight, edge.weight);
        } else {
          droppedMaxWeight = Math.max(droppedMaxWeight, edge.weight);
        }
      }
      assert.ok(
        keptMinWeight >= droppedMaxWeight,
        `hub-000 kept min weight ${keptMinWeight} < dropped max weight ${droppedMaxWeight}`,
      );

      assert.ok(
        elapsedMs < tier.budgetMs,
        `graph bounds at ${inputEdges} edges took ${elapsedMs.toFixed(0)}ms (budget ${tier.budgetMs}ms)`,
      );
      console.log(
        `[graph benchmark] bounds nodes=10000 edges=${inputEdges} returnedEdges=${bounded.edges.length} `
          + `elapsed=${elapsedMs.toFixed(0)}ms heapDelta=${heapDeltaMb.toFixed(1)}MB `
          + `fixture=${fixtureMs.toFixed(0)}ms budget=${tier.budgetMs}ms`,
      );
    },
  );
}
