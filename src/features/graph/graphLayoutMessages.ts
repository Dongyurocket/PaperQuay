// S5-GRAPH-1: pure helpers for the off-thread fcose layout.
//
// This module deliberately imports no cytoscape code so Node tests can exercise
// the worker protocol, the adaptive iteration budget and the position mapping.

export const GRAPH_LAYOUT_WORKER_PROTOCOL = 1;

export type FcoseQuality = 'draft' | 'default' | 'proof';

export interface FcoseLayoutOptions {
  name: 'fcose';
  quality: FcoseQuality;
  randomize: boolean;
  animate: boolean;
  fit: boolean;
  padding: number;
  nodeRepulsion: number;
  idealEdgeLength: number;
  edgeElasticity: number;
  gravity: number;
  numIter: number;
  packComponents: boolean;
  tile: boolean;
  nodeDimensionsIncludeLabels: boolean;
  uniformNodeDimensions?: boolean;
  /** 力参数（B6.5）；worker 会按节点/边类型换算成 fcose 函数。 */
  forces?: GraphForceSettings;
}

export interface GraphForceSettings {
  /** 聚集力 0–1。 */
  gravity: number;
  /** 斥力 0–20；10 对应论文节点 40k。 */
  repulsion: number;
  /** 连线长度 30–500；默认 180。 */
  edgeLength: number;
}

export const DEFAULT_GRAPH_FORCES: GraphForceSettings = {
  gravity: 0.3,
  repulsion: 10,
  edgeLength: 180,
};

export function normalizeGraphForces(input?: Partial<GraphForceSettings> | null): GraphForceSettings {
  const number = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    gravity: Math.max(0, Math.min(1, number(input?.gravity, DEFAULT_GRAPH_FORCES.gravity))),
    repulsion: Math.max(0, Math.min(20, number(input?.repulsion, DEFAULT_GRAPH_FORCES.repulsion))),
    edgeLength: Math.max(30, Math.min(500, number(input?.edgeLength, DEFAULT_GRAPH_FORCES.edgeLength))),
  };
}

/** 论文节点斥力基准 40k（repulsion=10）；标签/分类锚点 3×，笔记 0.75×。 */
export function resolveNodeRepulsion(forces: GraphForceSettings, type?: string): number {
  const base = Math.max(1000, 400 * forces.repulsion * forces.repulsion);
  if (type === 'tag' || type === 'category') return base * 3;
  if (type === 'note') return base * 0.75;
  return base;
}

/** 语义 110 / 引用 140 / 标签分类 220 的基准比值，随 UI 连线长度缩放。 */
export function resolveIdealEdgeLength(forces: GraphForceSettings, type?: string): number {
  const factor = type === 'related_by_embedding'
    ? 110 / 180
    : type === 'paper_cites_paper' || type === 'paper_reference'
      ? 140 / 180
      : type === 'paper_tag' || type === 'note_tag' || type === 'paper_category'
        ? 220 / 180
        : 1;
  return forces.edgeLength * factor;
}

export function resolveEdgeElasticity(type?: string): number {
  if (type === 'paper_tag' || type === 'note_tag' || type === 'paper_category') return 0.08;
  if (type === 'related_by_embedding') return 0.16;
  return 0.2;
}

export interface GraphLayoutNodeInput {
  id: string;
  type?: string;
  size?: number;
  degree?: number;
  x?: number;
  y?: number;
}

export interface GraphLayoutEdgeInput {
  source: string;
  target: string;
  type?: string;
  weight?: number;
}

export interface GraphLayoutRequestPayload {
  nodes: GraphLayoutNodeInput[];
  edges: GraphLayoutEdgeInput[];
  options: FcoseLayoutOptions;
}

export interface GraphLayoutPosition {
  id: string;
  x: number;
  y: number;
}

export interface GraphLayoutWorkerMessage {
  id: number;
  protocol: number;
  request: GraphLayoutRequestPayload;
}

export interface GraphLayoutWorkerSuccess {
  id: number;
  protocol: number;
  ok: true;
  positions: GraphLayoutPosition[];
  durationMs: number;
}

export interface GraphLayoutWorkerFailure {
  id: number;
  protocol: number;
  ok: false;
  error: string;
  durationMs?: number;
}

export type GraphLayoutWorkerResponse = GraphLayoutWorkerSuccess | GraphLayoutWorkerFailure;

export interface LayoutBudget {
  quality: FcoseQuality;
  numIter: number;
}

/**
 * Graph-size driven budget. Up to 500 nodes keeps the historical proof/2500
 * settings; larger graphs trade solver quality for a bounded wall clock so a
 * 10k-node graph still finishes inside the UI budget. Thresholds are measured
 * with the headless fcose build on Node 24 (see tests/graphSnapshotScale).
 */
export const LAYOUT_BUDGET_TIERS: ReadonlyArray<LayoutBudget & { maxNodes: number }> = [
  { maxNodes: 500, quality: 'proof', numIter: 2500 },
  { maxNodes: 1500, quality: 'default', numIter: 1200 },
  // 不用 fcose 的 draft：draft + randomize:false 会读取未生成的 spectralResult 并崩溃。
  { maxNodes: 3000, quality: 'default', numIter: 600 },
  { maxNodes: 7000, quality: 'default', numIter: 300 },
  { maxNodes: Number.POSITIVE_INFINITY, quality: 'default', numIter: 120 },
];

export function resolveLayoutBudget(nodeCount: number): LayoutBudget {
  const count = Number.isFinite(nodeCount) ? Math.max(0, Math.floor(nodeCount)) : 0;

  for (const tier of LAYOUT_BUDGET_TIERS) {
    if (count <= tier.maxNodes) {
      return { quality: tier.quality, numIter: tier.numIter };
    }
  }

  // LAYOUT_BUDGET_TIERS ends with Infinity, so this is unreachable; keep a
  // deterministic fallback so a future edit cannot return undefined.
  return { quality: 'default', numIter: 120 };
}

export function buildFcoseLayoutOptions(
  nodeCount: number,
  forcesInput?: Partial<GraphForceSettings> | null,
  extra: { packComponents?: boolean; incremental?: boolean } = {},
): FcoseLayoutOptions {
  const budget = resolveLayoutBudget(nodeCount);
  // 增量刷新只做一次 bounded 的随机化关闭布局，避免每次新增节点都全量重排。
  const numIter = extra.incremental ? Math.min(budget.numIter, 600) : budget.numIter;
  const forces = normalizeGraphForces(forcesInput);

  return {
    name: 'fcose',
    quality: budget.quality,
    numIter,
    randomize: false,
    // The worker never animates; the main thread applies a preset layout.
    animate: false,
    fit: false,
    padding: 36,
    nodeRepulsion: resolveNodeRepulsion(forces, 'paper'),
    idealEdgeLength: forces.edgeLength,
    edgeElasticity: 0.2,
    gravity: forces.gravity,
    packComponents: extra.packComponents !== false,
    tile: extra.packComponents !== false,
    nodeDimensionsIncludeLabels: true,
    uniformNodeDimensions: false,
    forces,
  };
}

/**
 * Worker positions become the input of a preset layout, so coordinates must be
 * finite and ids must be non-empty. Invalid entries are dropped rather than
 * failing the whole layout; a non-array payload returns null so the caller can
 * fall back to the main thread.
 */
export function normalizeLayoutPositions(raw: unknown): GraphLayoutPosition[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const byId = new Map<string, GraphLayoutPosition>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const x = Number(record.x);
    const y = Number(record.y);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    byId.set(id, { id, x, y });
  }

  return Array.from(byId.values());
}

export function positionsToMap(
  positions: readonly GraphLayoutPosition[],
): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  for (const position of positions) {
    map.set(position.id, { x: position.x, y: position.y });
  }
  return map;
}

interface ComponentBounds {
  ids: string[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * fcose 的 packComponents 只有在注册 layout-utilities 时才生效；这里自己按
 * 连通分量做 shelf packing，避免 8 个分量散落在画布各处。
 */
export function packDisconnectedComponents(
  nodes: readonly GraphLayoutNodeInput[],
  edges: readonly GraphLayoutEdgeInput[],
  positions: readonly GraphLayoutPosition[],
  options: { gap?: number; maxRowWidth?: number } = {},
): GraphLayoutPosition[] {
  if (positions.length < 2) return [...positions];

  const parent = new Map<string, string>();
  for (const node of nodes) parent.set(node.id, node.id);
  const find = (value: string): string => {
    let current = value;
    while (parent.get(current) !== current) {
      parent.set(current, parent.get(parent.get(current) as string) as string);
      current = parent.get(current) as string;
    }
    return current;
  };
  const union = (left: string, right: string) => {
    if (!parent.has(left) || !parent.has(right)) return;
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const edge of edges) union(edge.source, edge.target);

  const groups = new Map<string, GraphLayoutPosition[]>();
  for (const position of positions) {
    if (!parent.has(position.id)) parent.set(position.id, position.id);
    const root = find(position.id);
    const group = groups.get(root) ?? [];
    group.push(position);
    groups.set(root, group);
  }

  const bounds: ComponentBounds[] = [...groups.values()].map((group) => ({
    ids: group.map((position) => position.id),
    minX: Math.min(...group.map((position) => position.x)),
    minY: Math.min(...group.map((position) => position.y)),
    maxX: Math.max(...group.map((position) => position.x)),
    maxY: Math.max(...group.map((position) => position.y)),
  }));
  if (bounds.length <= 1) return [...positions];

  const gap = Math.max(0, Number(options.gap) || 60);
  const totalArea = bounds.reduce(
    (sum, item) => sum + (item.maxX - item.minX + gap) * (item.maxY - item.minY + gap),
    0,
  );
  const maxRowWidth = Math.max(
    Number(options.maxRowWidth) || 0,
    1600,
    Math.sqrt(Math.max(1, totalArea)) * 1.5,
  );
  const ordered = bounds
    .slice()
    .sort((left, right) => (
      (right.maxX - right.minX) * (right.maxY - right.minY)
      - (left.maxX - left.minX) * (left.maxY - left.minY)
      || left.ids[0].localeCompare(right.ids[0])
    ));

  const byId = new Map(positions.map((position) => [position.id, position]));
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const packed: GraphLayoutPosition[] = [];

  for (const item of ordered) {
    const width = item.maxX - item.minX;
    const height = item.maxY - item.minY;
    if (cursorX > 0 && cursorX + width > maxRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    const offsetX = cursorX - item.minX;
    const offsetY = cursorY - item.minY;
    for (const id of item.ids) {
      const position = byId.get(id);
      if (!position) continue;
      packed.push({ id, x: position.x + offsetX, y: position.y + offsetY });
    }
    cursorX += width + gap;
    rowHeight = Math.max(rowHeight, height);
  }

  return packed;
}

export type ParsedLayoutWorkerResponse =
  | { id: number; ok: true; positions: GraphLayoutPosition[] }
  | { id: number; ok: false; error: string };

/** Validate a raw worker message; used by the main-thread layout client. */
export function parseLayoutWorkerResponse(raw: unknown): ParsedLayoutWorkerResponse | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (record.protocol !== GRAPH_LAYOUT_WORKER_PROTOCOL) {
    return null;
  }

  const id = Number(record.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  if (record.ok === true) {
    const positions = normalizeLayoutPositions(record.positions);
    return positions ? { id, ok: true, positions } : null;
  }

  if (record.ok === false) {
    const error = typeof record.error === 'string' && record.error.trim()
      ? record.error
      : 'Graph layout worker failed';
    return { id, ok: false, error };
  }

  return null;
}
