import test from 'node:test';
import assert from 'node:assert/strict';

import { runMainThreadGraphLayout } from '../src/features/graph/graphLayoutFallback.ts';
import { buildFcoseLayoutOptions } from '../src/features/graph/graphLayoutMessages.ts';

// B8.1 迁移决策门的合成 fixture：5,000 节点 / 25,000 边。
// 渲染帧率需要在 Electron 实机测量；这里只锁定“headless 布局时间”这一半：
//   PASS:    完整布局 < 3s
//   TUNE:    3–10s
//   MIGRATE: > 10s 且真实 pan/zoom p95 > 66ms
// 用 PAPERQUAY_PERF=1 打开，避免常规测试拖慢 CI。
const PERF_MODE = process.env.PAPERQUAY_PERF === '1';
const NODE_COUNT = 5000;
const EDGE_COUNT = 25_000;

function buildFixture() {
  const nodes = Array.from({ length: NODE_COUNT }, (_, index) => ({
    id: `n-${index}`,
    type: index % 3 === 0 ? 'paper' : index % 3 === 1 ? 'note' : 'paper',
    size: 18 + (index % 24),
    degree: 10,
    x: Math.cos(index * 0.7) * 400,
    y: Math.sin(index * 0.7) * 400,
  }));
  const edges = Array.from({ length: EDGE_COUNT }, (_, index) => ({
    source: `n-${index % NODE_COUNT}`,
    target: `n-${(index * 37 + 11) % NODE_COUNT}`,
    type: index % 5 === 0 ? 'paper_cites_paper' : 'related_by_embedding',
    weight: 0.2 + (index % 80) / 100,
  })).filter((edge) => edge.source !== edge.target);
  return { nodes, edges };
}

test('5,000-node fixture keeps the production fcose budget and completes', {
  skip: PERF_MODE ? false : 'set PAPERQUAY_PERF=1 to run the 5k layout fixture',
  timeout: 600_000,
}, async () => {
  const { nodes, edges } = buildFixture();
  const options = buildFcoseLayoutOptions(nodes.length);
  assert.equal(options.quality, 'default');
  assert.equal(options.numIter, 300);

  const startedAt = performance.now();
  const positions = await runMainThreadGraphLayout({ nodes, edges, options });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(positions.length, nodes.length);
  assert.ok(positions.every((position) => Number.isFinite(position.x) && Number.isFinite(position.y)));
  const tier = elapsedMs < 3000 ? 'PASS' : elapsedMs < 10_000 ? 'TUNE' : 'MIGRATE';
  console.log(`[graph decision gate] 5k nodes / ${edges.length} edges layout: ${elapsedMs.toFixed(0)}ms (${tier})`);
  // 决策门是信息性的：记录 PASS/TUNE/MIGRATE，不把慢机器或 G6 迁移决策变成红灯。
  assert.ok(['PASS', 'TUNE', 'MIGRATE'].includes(tier));
});
