import test from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

import { buildFcoseLayoutOptions } from '../src/features/graph/graphLayoutMessages.ts';

cytoscape.use(fcose);

/**
 * 0.4.42 实机验收：196 节点全部落在 y = x 上，整张图退化成一条斜线。
 * 根因是 fcose 在 `randomize:false` 时走 pure-incremental，只沿既有弹簧松弛，
 * 不给谱初始化；起始点共线时结果保持一维。这条回归测试用真实 fcose 跑一次
 * 全量布局，断言二维铺开，避免默认参数再次退回 randomize:false。
 */
function buildGraph(nodeCount: number, edgeCount: number) {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    data: { id: `n${index}`, type: 'paper', size: 28, degree: 0 },
    style: { width: 28, height: 28 },
  }));
  const edges: Array<{ data: { id: string; source: string; target: string; type: string; weight: number } }> = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const source = Math.floor(next() * nodeCount);
    const target = Math.floor(next() * nodeCount);
    if (source === target) continue;
    edges.push({ data: { id: `e${index}`, source: `n${source}`, target: `n${target}`, type: 'semantic', weight: 0.5 } });
  }
  return { nodes, edges };
}

function spread(points: Array<{ x: number; y: number }>) {
  const count = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / count;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / count;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= count;
  syy /= count;
  sxy /= count;
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  return { major: Math.sqrt(trace / 2 + disc), minor: Math.sqrt(Math.max(0, trace / 2 - disc)) };
}

test('global fcose layout spreads the graph over two dimensions', () => {
  const { nodes, edges } = buildGraph(60, 150);
  const cy = cytoscape({ headless: true, elements: [...nodes, ...edges], styleEnabled: true });
  try {
    cy.layout(buildFcoseLayoutOptions(60) as unknown as cytoscape.LayoutOptions).run();
    const points = cy.nodes().map((node) => ({ x: node.position('x'), y: node.position('y') }));
    const { major, minor } = spread(points);
    assert.ok(major > 10, `expected a spread-out layout, got major=${major}`);
    assert.ok(minor > 1, `layout collapsed onto a line (minor=${minor})`);
    assert.ok(minor / major > 0.05, `layout is nearly one-dimensional (ratio=${minor / major})`);
  } finally {
    cy.destroy();
  }
});
