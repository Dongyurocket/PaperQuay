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
}

export interface GraphLayoutNodeInput {
  id: string;
}

export interface GraphLayoutEdgeInput {
  source: string;
  target: string;
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
  { maxNodes: 3000, quality: 'draft', numIter: 600 },
  { maxNodes: 7000, quality: 'draft', numIter: 300 },
  { maxNodes: Number.POSITIVE_INFINITY, quality: 'draft', numIter: 120 },
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
  return { quality: 'draft', numIter: 120 };
}

export function buildFcoseLayoutOptions(nodeCount: number): FcoseLayoutOptions {
  const budget = resolveLayoutBudget(nodeCount);

  return {
    name: 'fcose',
    quality: budget.quality,
    numIter: budget.numIter,
    randomize: true,
    // The worker never animates; the main thread applies a preset layout.
    animate: false,
    fit: false,
    padding: 36,
    nodeRepulsion: 40000,
    idealEdgeLength: 180,
    edgeElasticity: 0.2,
    gravity: 0.3,
    packComponents: true,
    tile: true,
    nodeDimensionsIncludeLabels: false,
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
