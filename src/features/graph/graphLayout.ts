// B7.3: graph layout orchestration (worker request, preset application,
// component packing already happens in the worker, position persistence).
//
// Kept outside KnowledgeGraphWorkspace so the React component stays an
// orchestrator. Cytoscape is only a type import here; the module-level client
// owns the layout worker.

import type { Core, LayoutOptions, NodeSingular } from 'cytoscape';
import {
  positionsToMap,
  type GraphForceSettings,
  type GraphLayoutPosition,
} from './graphLayoutMessages.ts';
import { createGraphLayoutClient, type GraphLayoutClient } from './graphLayoutRunner.ts';
import { runMainThreadGraphLayout } from './graphLayoutFallback.ts';

export type LayoutMode = 'global' | 'local';
export type LocalLayoutMode = 'force' | 'radial';

const GRAPH_POSITIONS_STORAGE_KEY = 'paperquay-graph-positions-v2';
const LEGACY_GRAPH_POSITIONS_STORAGE_KEY = 'paperquay-graph-positions-v1';
const MAX_STORED_SIGNATURES = 3;
const MAX_PERSISTED_NODES = 2000;
// 超过该规模时 fcose 在 5k 节点上需要数分钟；未聚合的大图改用确定性网格，
// 保证 UI 不被布局阻塞。默认聚合阈值 1,500，正常不会走到这里。
export const MAX_FORCE_LAYOUT_NODES = 1200;

// 单个客户端复用同一个 worker；请求序号用于丢弃过期的布局结果。
let graphLayoutClient: GraphLayoutClient | null = null;
let graphLayoutRequestSeq = 0;

function getGraphLayoutClient(): GraphLayoutClient {
  if (!graphLayoutClient) {
    graphLayoutClient = createGraphLayoutClient({
      runFallback: (request) => runMainThreadGraphLayout(request),
    });
  }
  return graphLayoutClient;
}

export function disposeGraphLayoutClient() {
  graphLayoutRequestSeq += 1;
  graphLayoutClient?.dispose();
  graphLayoutClient = null;
}

export function graphContainerHasSize(container: HTMLDivElement | null) {
  return Boolean(container && container.clientWidth > 0 && container.clientHeight > 0);
}

type PositionMap = Map<string, { x: number; y: number }>;

function readLegacyPositions(): PositionMap {
  const result: PositionMap = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_GRAPH_POSITIONS_STORAGE_KEY) || '{}') as Record<string, unknown>;
    for (const [id, value] of Object.entries(raw)) {
      const position = value as { x?: unknown; y?: unknown };
      const x = Number(position?.x);
      const y = Number(position?.y);
      if (id && Number.isFinite(x) && Number.isFinite(y)) result.set(id, { x, y });
    }
  } catch {
    // Positions are a convenience; broken storage must not break the graph.
  }
  return result;
}

/**
 * 按 graphSignature 读取坐标。旧版 v1 是扁平 map，首次读取时迁移到 v2；
 * 只在当前签名缺失时使用旧坐标，避免不同图谱（筛选/局部）互相污染。
 */
export function readStoredGraphPositions(signature: string): PositionMap {
  try {
    const raw = JSON.parse(localStorage.getItem(GRAPH_POSITIONS_STORAGE_KEY) || '{}') as Record<string, unknown>;
    const entry = raw?.[signature];
    if (entry && typeof entry === 'object') {
      const result: PositionMap = new Map();
      for (const [id, value] of Object.entries(entry as Record<string, unknown>)) {
        const position = value as { x?: unknown; y?: unknown };
        const x = Number(position?.x);
        const y = Number(position?.y);
        if (id && Number.isFinite(x) && Number.isFinite(y)) result.set(id, { x, y });
      }
      if (result.size > 0) return result;
    }
  } catch {
    // Fall through to the legacy map.
  }

  return readLegacyPositions();
}

export function persistGraphPositions(cy: Core, signature: string) {
  if (cy.destroyed() || cy.nodes().length > MAX_PERSISTED_NODES) return;
  try {
    const raw = JSON.parse(localStorage.getItem(GRAPH_POSITIONS_STORAGE_KEY) || '{}') as Record<string, unknown>;
    const positions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((node) => {
      const position = node.position();
      positions[node.id()] = { x: position.x, y: position.y };
    });

    // 保留最近几个签名（筛选组合/局部中心），丢弃更旧的条目。
    const next: Record<string, unknown> = { [signature]: positions };
    for (const key of Object.keys(raw)) {
      if (key === signature) continue;
      if (Object.keys(next).length >= MAX_STORED_SIGNATURES) break;
      next[key] = raw[key];
    }
    localStorage.setItem(GRAPH_POSITIONS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private/locked-down environments.
  }
}

function translatePositions(
  positions: GraphLayoutPosition[],
  centerId: string | undefined,
): GraphLayoutPosition[] {
  if (!centerId) return positions;
  const center = positions.find((position) => position.id === centerId);
  if (!center) return positions;
  return positions.map((position) => ({
    id: position.id,
    x: position.x - center.x,
    y: position.y - center.y,
  }));
}

function applyPresetLayout(
  cy: Core,
  positions: readonly GraphLayoutPosition[],
  options: { fit?: boolean; centerNodeId?: string; signature?: string; persist?: boolean } = {},
) {
  if (cy.destroyed()) return;

  // preset 布局接受「节点 id -> 坐标」映射；未返回坐标的节点保持当前位置。
  const byId = new Map(positions.map((position) => [position.id, position]));
  const positionMap: Record<string, { x: number; y: number }> = {};
  cy.nodes().forEach((node) => {
    const found = byId.get(node.id());
    positionMap[node.id()] = found ? { x: found.x, y: found.y } : node.position();
  });

  const layout = cy.layout(({
    name: 'preset',
    positions: positionMap,
    animate: false,
    fit: options.fit !== false,
    padding: 36,
  } as LayoutOptions));

  layout.run();

  if (options.centerNodeId) {
    const center = cy.$id(options.centerNodeId);
    if (center.nonempty()) cy.center(center);
  }
  if (options.persist !== false && options.signature) {
    persistGraphPositions(cy, options.signature);
  }
}

function runLocalRadialLayout(cy: Core) {
  const layout = cy.layout(({
    name: 'concentric',
    animate: true,
    animationDuration: 320,
    fit: true,
    padding: 36,
    concentric: (node: NodeSingular) => node.degree(),
    levelWidth: () => 2,
    minNodeSpacing: 40,
  } as LayoutOptions));

  layout.run();
}

/**
 * 大图降级布局：按类型/度数排序后放入网格。确定性、O(n)，不追求主题聚类；
 * 目的是在用户关闭聚合时仍有可读、可交互的视图。
 */
function runFastGridLayout(cy: Core) {
  const typeOrder: Record<string, number> = { paper: 0, note: 1, reference: 2, tag: 3, category: 4 };
  const nodes = cy.nodes().toArray().sort((left, right) => {
    const leftType = typeOrder[String(left.data('type'))] ?? 9;
    const rightType = typeOrder[String(right.data('type'))] ?? 9;
    if (leftType !== rightType) return leftType - rightType;
    const degreeDelta = (Number(right.data('degree')) || 0) - (Number(left.data('degree')) || 0);
    if (degreeDelta !== 0) return degreeDelta;
    return left.id().localeCompare(right.id());
  });
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const spacing = 140;
  const positionMap: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, index) => {
    positionMap[node.id()] = {
      x: (index % columns) * spacing,
      y: Math.floor(index / columns) * spacing,
    };
  });
  const layout = cy.layout(({
    name: 'preset',
    positions: positionMap,
    animate: false,
    fit: true,
    padding: 36,
  } as LayoutOptions));
  layout.run();
}

export interface RunGraphLayoutOptions {
  mode: LayoutMode;
  localLayout?: LocalLayoutMode;
  localNodeId?: string;
  forces?: GraphForceSettings;
  signature?: string;
  /** 增量刷新：randomize:false 的 bounded 重排，不主动 fit。 */
  incremental?: boolean;
  /** 默认全局布局会 fit；力参数/增量布局应保留当前视口。 */
  fit?: boolean;
}

export interface RunGraphLayoutResult {
  durationMs: number;
  mode: LayoutMode;
  nodeCount: number;
  strategy: 'fcose' | 'radial' | 'grid';
}

/**
 * 全局/局部布局统一走 fcose worker；局部图禁用组件打包并把中心节点置于原点，
 * 然后 `cy.center` 保持阅读焦点。径向布局保留为局部图的可选模式。
 */
export async function runGraphLayout(
  cy: Core,
  options: RunGraphLayoutOptions,
): Promise<RunGraphLayoutResult | null> {
  if (cy.destroyed()) return null;

  if (options.mode === 'local' && options.localLayout === 'radial') {
    const startedAt = performance.now();
    runLocalRadialLayout(cy);
    if (options.localNodeId) {
      const center = cy.$id(options.localNodeId);
      if (center.nonempty()) cy.center(center);
    }
    return {
      durationMs: performance.now() - startedAt,
      mode: 'local',
      nodeCount: cy.nodes().length,
      strategy: 'radial',
    };
  }

  if (cy.nodes().length > MAX_FORCE_LAYOUT_NODES) {
    const startedAt = performance.now();
    runFastGridLayout(cy);
    if (options.mode === 'local' && options.localNodeId) {
      const center = cy.$id(options.localNodeId);
      if (center.nonempty()) cy.center(center);
    }
    if (options.signature) persistGraphPositions(cy, options.signature);
    return {
      durationMs: performance.now() - startedAt,
      mode: options.mode,
      nodeCount: cy.nodes().length,
      strategy: 'grid',
    };
  }

  const requestId = graphLayoutRequestSeq + 1;
  graphLayoutRequestSeq = requestId;
  const startedAt = performance.now();
  const nodes = cy.nodes().map((node) => {
    const position = node.position();
    return {
      id: node.id(),
      type: String(node.data('type') ?? ''),
      size: Number(node.data('size')) || 28,
      degree: Number(node.data('degree')) || 0,
      x: position.x,
      y: position.y,
    };
  });
  const edges = cy.edges().map((edge) => ({
    source: edge.source().id(),
    target: edge.target().id(),
    type: String(edge.data('type') ?? ''),
    weight: Number(edge.data('weight')) || 0,
  }));

  try {
    const result = await getGraphLayoutClient().requestLayout(nodes, edges, {
      forces: options.forces,
      packComponents: options.mode === 'global',
      incremental: options.incremental,
    });
    if (requestId !== graphLayoutRequestSeq) return null;
    // 局部图：fcose 不锁定中心节点；布局后把中心平移到原点，再 cy.center。
    applyPresetLayout(
      cy,
      translatePositions(result, options.mode === 'local' ? options.localNodeId : undefined),
      {
        fit: options.fit ?? options.mode !== 'local',
        centerNodeId: options.mode === 'local' ? options.localNodeId : undefined,
        signature: options.signature,
      },
    );
    return {
      durationMs: performance.now() - startedAt,
      mode: options.mode,
      nodeCount: nodes.length,
      strategy: 'fcose',
    };
  } catch (error) {
    if (requestId !== graphLayoutRequestSeq) return null;
    console.warn('[paperquay] Knowledge graph layout failed; keeping current positions.', error);
    if (!cy.destroyed()) cy.fit(undefined, 36);
    return null;
  }
}

export function applyStoredPositions(cy: Core, signature: string): number {
  const stored = readStoredGraphPositions(signature);
  let restored = 0;
  cy.nodes().forEach((node) => {
    const position = stored.get(node.id());
    if (position) {
      node.position(position);
      restored += 1;
    }
  });
  return restored;
}

export function positionsFromCore(cy: Core): GraphLayoutPosition[] {
  return cy.nodes().map((node) => ({ ...node.position(), id: node.id() }));
}

export { positionsToMap };
