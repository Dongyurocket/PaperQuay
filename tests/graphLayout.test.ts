import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  GRAPH_LAYOUT_WORKER_PROTOCOL,
  buildFcoseLayoutOptions,
  normalizeLayoutPositions,
  packDisconnectedComponents,
  parseLayoutWorkerResponse,
  positionsToMap,
  resolveLayoutBudget,
} from '../src/features/graph/graphLayoutMessages.ts';
import {
  createGraphLayoutClient,
  type LayoutWorkerLike,
} from '../src/features/graph/graphLayoutRunner.ts';
import {
  formatGraphSamplingSummary,
  readSnapshotMetadata,
} from '../src/features/graph/knowledgeGraphMeta.ts';
import type { GraphLayoutRequestPayload } from '../src/features/graph/graphLayoutMessages.ts';

function createFakeWorker() {
  const messages: unknown[] = [];
  const worker = {
    messages,
    terminated: false,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    postMessage(message: unknown) {
      messages.push(message);
    },
    terminate() {
      worker.terminated = true;
    },
    respond(data: unknown) {
      worker.onmessage?.({ data });
    },
    fail(error: unknown) {
      worker.onerror?.(error);
    },
  };
  return worker;
}

test('layout budget keeps proof/2500 for small graphs and scales down iterations', () => {
  assert.deepEqual(resolveLayoutBudget(0), { quality: 'proof', numIter: 2500 });
  assert.deepEqual(resolveLayoutBudget(45), { quality: 'proof', numIter: 2500 });
  assert.deepEqual(resolveLayoutBudget(500), { quality: 'proof', numIter: 2500 });
  assert.deepEqual(resolveLayoutBudget(501), { quality: 'default', numIter: 1200 });
  assert.deepEqual(resolveLayoutBudget(1500), { quality: 'default', numIter: 1200 });
  assert.deepEqual(resolveLayoutBudget(1501), { quality: 'default', numIter: 600 });
  assert.deepEqual(resolveLayoutBudget(3000), { quality: 'default', numIter: 600 });
  assert.deepEqual(resolveLayoutBudget(3001), { quality: 'default', numIter: 300 });
  assert.deepEqual(resolveLayoutBudget(7000), { quality: 'default', numIter: 300 });
  assert.deepEqual(resolveLayoutBudget(7001), { quality: 'default', numIter: 120 });
  assert.deepEqual(resolveLayoutBudget(10000), { quality: 'default', numIter: 120 });

  // Deterministic and monotonically cheaper as the graph grows.
  let previous = Number.POSITIVE_INFINITY;
  for (const count of [10, 500, 501, 1500, 1501, 3000, 3001, 7000, 7001, 10000, 100000]) {
    const first = resolveLayoutBudget(count);
    assert.deepEqual(resolveLayoutBudget(count), first);
    assert.ok(first.numIter <= previous, `numIter must not grow at ${count}`);
    previous = first.numIter;
  }
});

test('fcose options are headless-safe and keep the historical layout parameters', () => {
  const small = buildFcoseLayoutOptions(45);
  assert.equal(small.name, 'fcose');
  assert.equal(small.quality, 'proof');
  assert.equal(small.numIter, 2500);
  assert.equal(small.randomize, false);
  assert.equal(small.animate, false);
  assert.equal(small.fit, false);
  assert.equal(small.padding, 36);
  assert.equal(small.nodeRepulsion, 40000);
  assert.equal(small.idealEdgeLength, 180);
  assert.equal(small.edgeElasticity, 0.2);
  assert.equal(small.gravity, 0.3);
  assert.equal(small.packComponents, true);
  assert.equal(small.tile, true);
  assert.equal(small.nodeDimensionsIncludeLabels, true);
  assert.equal(small.uniformNodeDimensions, false);

  const large = buildFcoseLayoutOptions(10000);
  assert.equal(large.quality, 'default');
  assert.equal(large.numIter, 120);
});

test('layout positions are validated, deduplicated and mapped deterministically', () => {
  assert.equal(normalizeLayoutPositions(null), null);
  assert.equal(normalizeLayoutPositions({}), null);

  const positions = normalizeLayoutPositions([
    { id: 'a', x: 1, y: 2 },
    { id: '', x: 9, y: 9 },
    { id: 'b', x: Number.NaN, y: 3 },
    { id: 'c', x: 4, y: Number.POSITIVE_INFINITY },
    null,
    { id: 'd', x: '5', y: '6' },
    { id: 'a', x: 7, y: 8 },
  ]);
  assert.deepEqual(positions, [
    { id: 'a', x: 7, y: 8 },
    { id: 'd', x: 5, y: 6 },
  ]);

  const map = positionsToMap(positions ?? []);
  assert.deepEqual(map.get('a'), { x: 7, y: 8 });
  assert.equal(map.get('missing'), undefined);
});

test('worker responses are parsed strictly', () => {
  assert.equal(parseLayoutWorkerResponse(null), null);
  assert.equal(parseLayoutWorkerResponse({ id: 1, protocol: 999, ok: true, positions: [] }), null);
  assert.equal(parseLayoutWorkerResponse({ id: 0, protocol: GRAPH_LAYOUT_WORKER_PROTOCOL, ok: true, positions: [] }), null);
  assert.deepEqual(
    parseLayoutWorkerResponse({
      id: 3,
      protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
      ok: true,
      positions: [{ id: 'a', x: 1, y: 2 }],
    }),
    { id: 3, ok: true, positions: [{ id: 'a', x: 1, y: 2 }] },
  );
  assert.equal(
    parseLayoutWorkerResponse({
      id: 4,
      protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
      ok: true,
      positions: 'nope',
    }),
    null,
  );
  assert.deepEqual(
    parseLayoutWorkerResponse({
      id: 5,
      protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
      ok: false,
      error: '',
    }),
    { id: 5, ok: false, error: 'Graph layout worker failed' },
  );
});

test('layout client posts requests to the worker and resolves correlated positions', async () => {
  const worker = createFakeWorker();
  const fallbackCalls: GraphLayoutRequestPayload[] = [];
  const client = createGraphLayoutClient({
    createWorker: () => worker as unknown as LayoutWorkerLike,
    runFallback: (request) => {
      fallbackCalls.push(request);
      return [{ id: 'fallback', x: 0, y: 0 }];
    },
  });

  const first = client.requestLayout([{ id: 'a' }, { id: 'b' }], [{ source: 'a', target: 'b' }]);
  const second = client.requestLayout([{ id: 'c' }], []);

  assert.equal(worker.messages.length, 2);
  const [firstMessage, secondMessage] = worker.messages as Array<{
    id: number;
    protocol: number;
    request: GraphLayoutRequestPayload;
  }>;
  assert.equal(firstMessage.protocol, GRAPH_LAYOUT_WORKER_PROTOCOL);
  assert.equal(firstMessage.request.options.name, 'fcose');
  assert.equal(firstMessage.request.nodes.length, 2);
  assert.equal(firstMessage.request.edges.length, 1);
  assert.notEqual(firstMessage.id, secondMessage.id);

  // Answer out of order to prove id correlation.
  worker.respond({
    id: secondMessage.id,
    protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
    ok: true,
    positions: [{ id: 'c', x: 30, y: 40 }],
  });
  worker.respond({
    id: firstMessage.id,
    protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
    ok: true,
    positions: [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 }],
  });

  assert.deepEqual(await first, [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 }]);
  assert.deepEqual(await second, [{ id: 'c', x: 30, y: 40 }]);
  assert.equal(fallbackCalls.length, 0);
  client.dispose();
});

test('layout client falls back when no worker exists, on worker errors, and on failure payloads', async () => {
  const noWorkerCalls: GraphLayoutRequestPayload[] = [];
  const noWorkerClient = createGraphLayoutClient({
    createWorker: () => null,
    runFallback: (request) => {
      noWorkerCalls.push(request);
      return [{ id: 'a', x: 1, y: 1 }];
    },
  });
  assert.deepEqual(await noWorkerClient.requestLayout([{ id: 'a' }], []), [{ id: 'a', x: 1, y: 1 }]);
  assert.equal(noWorkerCalls.length, 1);
  noWorkerClient.dispose();

  const failingWorker = createFakeWorker();
  let fallbackCount = 0;
  const errorClient = createGraphLayoutClient({
    createWorker: () => failingWorker as unknown as LayoutWorkerLike,
    runFallback: () => {
      fallbackCount += 1;
      return [{ id: 'a', x: 2, y: 2 }];
    },
  });

  const pending = errorClient.requestLayout([{ id: 'a' }], []);
  const message = failingWorker.messages[0] as { id: number };
  failingWorker.respond({
    id: message.id,
    protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
    ok: false,
    error: 'boom',
  });
  assert.deepEqual(await pending, [{ id: 'a', x: 2, y: 2 }]);
  assert.equal(fallbackCount, 1);

  const pendingError = errorClient.requestLayout([{ id: 'a' }], []);
  failingWorker.fail(new Error('worker crashed'));
  assert.deepEqual(await pendingError, [{ id: 'a', x: 2, y: 2 }]);
  assert.equal(fallbackCount, 2);
  assert.equal(failingWorker.terminated, true);
  errorClient.dispose();
});

test('layout client rejects when the fallback itself fails and dispose cancels pending work', async () => {
  const worker = createFakeWorker();
  const client = createGraphLayoutClient({
    createWorker: () => worker as unknown as LayoutWorkerLike,
    runFallback: () => {
      throw new Error('fallback failed');
    },
  });

  const pending = client.requestLayout([{ id: 'a' }], []);
  const message = worker.messages[0] as { id: number };
  worker.respond({
    id: message.id,
    protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
    ok: false,
    error: 'worker said no',
  });
  await assert.rejects(pending, /fallback failed/);

  const pendingDispose = client.requestLayout([{ id: 'b' }], []);
  client.dispose();
  await assert.rejects(pendingDispose, /disposed/);
  assert.equal(worker.terminated, true);
  await assert.rejects(client.requestLayout([{ id: 'c' }], []), /disposed/);
});

test('layout worker timeout terminates worker and recovers through fallback', async () => {
  const workers = [createFakeWorker(), createFakeWorker()];
  let created = 0;
  const client = createGraphLayoutClient({
    timeoutMs: 5,
    createWorker: () => workers[created++] as unknown as LayoutWorkerLike,
    runFallback: () => [{ id: 'recovered', x: 7, y: 9 }],
  });
  assert.deepEqual(await client.requestLayout([{ id: 'a' }], []), [{ id: 'recovered', x: 7, y: 9 }]);
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(await client.requestLayout([{ id: 'b' }], []), [{ id: 'recovered', x: 7, y: 9 }]);
  assert.equal(created, 2);
  client.dispose();
});

test('a null worker creation is retried on the next request', async () => {
  const worker = createFakeWorker();
  let created = 0;
  let fallbacks = 0;
  const client = createGraphLayoutClient({
    createWorker: () => {
      created += 1;
      return created === 1 ? null : worker as unknown as LayoutWorkerLike;
    },
    runFallback: () => {
      fallbacks += 1;
      return [{ id: 'fallback', x: 1, y: 2 }];
    },
  });

  assert.deepEqual(await client.requestLayout([{ id: 'a' }], []), [{ id: 'fallback', x: 1, y: 2 }]);
  assert.equal(created, 1);
  assert.equal(fallbacks, 1);

  const pending = client.requestLayout([{ id: 'b' }], []);
  assert.equal(created, 2, 'the next request must retry worker creation after null');
  const message = worker.messages[0] as { id: number };
  worker.respond({
    id: message.id,
    protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
    ok: true,
    positions: [{ id: 'b', x: 3, y: 4 }],
  });
  assert.deepEqual(await pending, [{ id: 'b', x: 3, y: 4 }]);
  client.dispose();
});

test('a late onerror from a replaced worker does not terminate the new worker', async () => {
  const workers = [createFakeWorker(), createFakeWorker()];
  let created = 0;
  const client = createGraphLayoutClient({
    timeoutMs: 5,
    createWorker: () => workers[created++] as unknown as LayoutWorkerLike,
    runFallback: () => [{ id: 'recovered', x: 7, y: 9 }],
  });

  // 第一个 worker 超时被替换。
  assert.deepEqual(await client.requestLayout([{ id: 'a' }], []), [{ id: 'recovered', x: 7, y: 9 }]);
  assert.equal(workers[0].terminated, true);

  // 第二个 worker 上的在途请求不能被旧 worker 的迟到 onerror 打断。
  const pending = client.requestLayout([{ id: 'b' }], []);
  assert.equal(created, 2);
  workers[0].fail(new Error('late error from the replaced worker'));
  assert.equal(workers[1].terminated, false, 'the new worker must survive a stale onerror');

  const message = workers[1].messages[0] as { id: number };
  workers[1].respond({
    id: message.id,
    protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
    ok: true,
    positions: [{ id: 'b', x: 5, y: 6 }],
  });
  assert.deepEqual(await pending, [{ id: 'b', x: 5, y: 6 }]);
  client.dispose();
});

test('snapshot metadata is read defensively and formatted for both locales', () => {
  assert.equal(readSnapshotMetadata({ nodes: [], edges: [], generatedAt: 0 }), null);

  const metadata = readSnapshotMetadata({
    nodes: [],
    edges: [],
    generatedAt: 0,
    metadata: {
      sampled: true,
      truncated: true,
      nodeLimit: 10000,
      edgeLimitPerNode: 250,
      totalNodes: 12000,
      returnedNodes: 10000,
      totalEdges: 30000,
      returnedEdges: 25000,
    },
  });
  assert.deepEqual(metadata, {
    sampled: true,
    truncated: true,
    nodeLimit: 10000,
    edgeLimitPerNode: 250,
    totalNodes: 12000,
    returnedNodes: 10000,
    totalEdges: 30000,
    returnedEdges: 25000,
  });
  assert.equal(formatGraphSamplingSummary(metadata, 'en'), 'Sampled 10000/12000 nodes');
  assert.equal(formatGraphSamplingSummary(metadata, 'zh'), '已抽样 10000/12000 个节点');
  assert.equal(formatGraphSamplingSummary(null), '');

  const edgeOnly = { ...metadata!, sampled: false, returnedNodes: 12000, returnedEdges: 25000, totalEdges: 30000 };
  assert.equal(formatGraphSamplingSummary(edgeOnly, 'en'), 'Trimmed 25000/30000 edges');
  assert.equal(formatGraphSamplingSummary(edgeOnly, 'zh'), '已裁剪 25000/30000 条关系');
});

test('fcose stays behind a dynamic import in the main-thread fallback', () => {
  const source = readFileSync(path.resolve('src/features/graph/graphLayoutFallback.ts'), 'utf8');

  // 主线程回退是 fcose 唯一的非 Worker 入口；改成静态 import 会把 fcose
  // 并进 KnowledgeGraphWorkspace chunk，打开图谱就多下载约 500KB。
  // 产物级守卫见 tests/initialChunks.test.mjs。
  assert.match(source, /import\(\s*['"]cytoscape-fcose['"]\s*\)/);
  assert.match(source, /import\(\s*['"]cytoscape['"]\s*\)/);
  assert.doesNotMatch(source, /from\s+['"](?:cytoscape-fcose|cose-base|layout-base)['"]/);
  assert.doesNotMatch(source, /^\s*import\s+[\w$]+\s+from\s+['"]cytoscape['"]/m);
});

test('disconnected layout components are shelf-packed without overlap', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const edges = [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }];
  const positions = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 100, y: 0 },
    { id: 'c', x: 0, y: 0 },
    { id: 'd', x: 100, y: 0 },
  ];

  const packed = packDisconnectedComponents(nodes, edges, positions, { gap: 60 });
  assert.equal(packed.length, 4);
  const byId = new Map(packed.map((position) => [position.id, position]));
  const left = [byId.get('a')!, byId.get('b')!];
  const right = [byId.get('c')!, byId.get('d')!];
  const leftBox = {
    minX: Math.min(...left.map((item) => item.x)),
    maxX: Math.max(...left.map((item) => item.x)),
  };
  const rightBox = {
    minX: Math.min(...right.map((item) => item.x)),
    maxX: Math.max(...right.map((item) => item.x)),
  };

  assert.ok(
    leftBox.maxX + 60 <= rightBox.minX || rightBox.maxX + 60 <= leftBox.minX,
    'packed components must keep at least the configured gap',
  );

  const single = packDisconnectedComponents([{ id: 'a' }], [], [{ id: 'a', x: 4, y: 5 }]);
  assert.deepEqual(single, [{ id: 'a', x: 4, y: 5 }]);
});

test('force settings clamp and map to per-type fcose inputs', async () => {
  const {
    DEFAULT_GRAPH_FORCES,
    normalizeGraphForces,
    resolveIdealEdgeLength,
    resolveNodeRepulsion,
    resolveEdgeElasticity,
  } = await import('../src/features/graph/graphLayoutMessages.ts');

  assert.deepEqual(normalizeGraphForces({ gravity: 9, repulsion: -1, edgeLength: 1000 }), {
    gravity: 1,
    repulsion: 0,
    edgeLength: 500,
  });
  assert.deepEqual(normalizeGraphForces(null), DEFAULT_GRAPH_FORCES);

  assert.equal(resolveNodeRepulsion(DEFAULT_GRAPH_FORCES, 'paper'), 40000);
  assert.equal(resolveNodeRepulsion(DEFAULT_GRAPH_FORCES, 'tag'), 120000);
  assert.equal(resolveNodeRepulsion(DEFAULT_GRAPH_FORCES, 'category'), 120000);
  assert.equal(resolveNodeRepulsion(DEFAULT_GRAPH_FORCES, 'note'), 30000);
  assert.ok(Math.abs(resolveIdealEdgeLength(DEFAULT_GRAPH_FORCES, 'related_by_embedding') - 110) < 1e-9);
  assert.ok(Math.abs(resolveIdealEdgeLength(DEFAULT_GRAPH_FORCES, 'paper_cites_paper') - 140) < 1e-9);
  assert.ok(Math.abs(resolveIdealEdgeLength(DEFAULT_GRAPH_FORCES, 'paper_category') - 220) < 1e-9);
  assert.ok(Math.abs(resolveIdealEdgeLength(DEFAULT_GRAPH_FORCES, 'note_paper') - 180) < 1e-9);
  assert.equal(resolveEdgeElasticity('paper_category'), 0.08);
  assert.equal(resolveEdgeElasticity('related_by_embedding'), 0.16);
});

test('incremental layouts cap iterations and can skip component packing', () => {
  const incremental = buildFcoseLayoutOptions(10000, null, { incremental: true, packComponents: false });
  assert.equal(incremental.numIter, 120);
  assert.equal(incremental.packComponents, false);
  assert.equal(incremental.tile, false);

  const normal = buildFcoseLayoutOptions(10000);
  assert.equal(normal.numIter, 120);
  const medium = buildFcoseLayoutOptions(2000, null, { incremental: true });
  assert.equal(medium.numIter, 600);
});

test('layout requests preserve node type/size/degree and edge type/weight', async () => {
  const worker = createFakeWorker();
  const client = createGraphLayoutClient({
    createWorker: () => worker as unknown as LayoutWorkerLike,
    runFallback: () => [],
  });

  void client.requestLayout(
    [{ id: 'paper:a', type: 'paper', size: 42, degree: 7, x: 1, y: 2 }],
    [{ source: 'paper:a', target: 'paper:b', type: 'related_by_embedding', weight: 0.8 }],
    { forces: { gravity: 0.4, repulsion: 12, edgeLength: 200 }, packComponents: false, incremental: true },
  );

  const [message] = worker.messages as Array<{ request: GraphLayoutRequestPayload }>;
  assert.deepEqual(message.request.nodes[0], {
    id: 'paper:a', type: 'paper', size: 42, degree: 7, x: 1, y: 2,
  });
  assert.deepEqual(message.request.edges[0], {
    source: 'paper:a', target: 'paper:b', type: 'related_by_embedding', weight: 0.8,
  });
  assert.equal(message.request.options.forces?.repulsion, 12);
  assert.equal(message.request.options.packComponents, false);
  assert.equal(message.request.options.numIter, 600);
});
