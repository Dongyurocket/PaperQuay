// Persistent graph view preferences (B8/B7). Kept out of the app settings
// document: these are view-only knobs and must not trigger settings migrations.

import type { GraphColorMode } from './graphPresentation.ts';
import {
  DEFAULT_GRAPH_FORCES,
  normalizeGraphForces,
  type GraphForceSettings,
} from './graphLayoutMessages.ts';

export type GraphRendererMode = 'canvas' | 'webgl';
export type GraphSearchMode = 'spotlight' | 'filter';
export type GraphLocalLayoutMode = 'force' | 'radial';

export interface GraphPreferences {
  colorBy: GraphColorMode;
  /** 用户是否显式改过着色；未改时按视角自动选择。 */
  colorByOverridden: boolean;
  forces: GraphForceSettings;
  localLayout: GraphLocalLayoutMode;
  renderer: GraphRendererMode;
  /** 渲染层总边预算；0 表示不限制。 */
  edgeBudget: number;
  lodEnabled: boolean;
  lodRatio: number;
  aggregateThreshold: number;
  aggregateEnabled: boolean;
  searchMode: GraphSearchMode;
  /** 互近邻图跨分量自动桥接；默认开启。 */
  embeddingBridge: boolean;
}

export const DEFAULT_GRAPH_PREFERENCES: GraphPreferences = {
  colorBy: 'category',
  colorByOverridden: false,
  forces: DEFAULT_GRAPH_FORCES,
  localLayout: 'force',
  renderer: 'canvas',
  edgeBudget: 50_000,
  lodEnabled: true,
  lodRatio: 0.2,
  aggregateThreshold: 1_500,
  aggregateEnabled: true,
  searchMode: 'spotlight',
  embeddingBridge: true,
};

const STORAGE_KEY = 'paperquay-graph-preferences-v1';

function pickColorMode(value: unknown): GraphColorMode {
  return value === 'type' || value === 'year' || value === 'cluster' || value === 'category'
    ? value
    : DEFAULT_GRAPH_PREFERENCES.colorBy;
}

export function normalizeGraphPreferences(raw: unknown): GraphPreferences {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const edgeBudget = Number(record.edgeBudget);
  const lodRatio = Number(record.lodRatio);
  const aggregateThreshold = Number(record.aggregateThreshold);

  return {
    colorBy: pickColorMode(record.colorBy),
    colorByOverridden: record.colorByOverridden === true,
    forces: normalizeGraphForces(record.forces as Partial<GraphForceSettings> | undefined),
    localLayout: record.localLayout === 'radial' ? 'radial' : 'force',
    renderer: record.renderer === 'webgl' ? 'webgl' : 'canvas',
    edgeBudget: Number.isFinite(edgeBudget)
      ? Math.max(0, Math.min(200_000, Math.trunc(edgeBudget)))
      : DEFAULT_GRAPH_PREFERENCES.edgeBudget,
    lodEnabled: record.lodEnabled !== false,
    lodRatio: Number.isFinite(lodRatio)
      ? Math.max(0.05, Math.min(1, lodRatio))
      : DEFAULT_GRAPH_PREFERENCES.lodRatio,
    aggregateThreshold: Number.isFinite(aggregateThreshold)
      ? Math.max(200, Math.min(10_000, Math.trunc(aggregateThreshold)))
      : DEFAULT_GRAPH_PREFERENCES.aggregateThreshold,
    aggregateEnabled: record.aggregateEnabled !== false,
    searchMode: record.searchMode === 'filter' ? 'filter' : 'spotlight',
    embeddingBridge: record.embeddingBridge !== false,
  };
}

export function loadGraphPreferences(): GraphPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return normalizeGraphPreferences(raw);
  } catch {
    return { ...DEFAULT_GRAPH_PREFERENCES, forces: { ...DEFAULT_GRAPH_FORCES } };
  }
}

export function saveGraphPreferences(preferences: GraphPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // View preferences are best-effort.
  }
}
