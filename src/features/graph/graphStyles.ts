// B7.3: theme-aware Cytoscape stylesheet.
//
// Cytoscape does not parse rgba() CSS custom properties for every field, so the
// graph tokens are declared as opaque hex in src/app/index.css and read at
// runtime. Shapes/colors that vary per node come from element data, which keeps
// the stylesheet static across snapshots.

import type { StylesheetJson } from 'cytoscape';
import { GRAPH_EDGE_COLORS, GRAPH_NODE_COLORS } from './graphPresentation.ts';

export const GRAPH_TEXT_COLORS = {
  light: '#1f2937',
  dark: '#e5e7eb',
} as const;

export interface GraphTheme {
  text: string;
  textMuted: string;
  border: string;
  selection: string;
  surface: string;
}

const LIGHT_THEME: GraphTheme = {
  text: GRAPH_TEXT_COLORS.light,
  textMuted: '#6b7280',
  border: '#ffffff',
  selection: '#0f172a',
  surface: '#ffffff',
};

const DARK_THEME: GraphTheme = {
  text: GRAPH_TEXT_COLORS.dark,
  textMuted: '#9ca3af',
  border: '#111827',
  selection: '#e5e7eb',
  surface: '#1a1a1a',
};

function readToken(
  getProperty: (name: string) => string,
  name: string,
  fallback: string,
): string {
  try {
    const value = getProperty(name).trim();
    // 只接受具体颜色；rgba()/var() 在部分 Cytoscape 字段会被忽略。
    if (value && !value.startsWith('var(') && !value.includes('rgba(')) return value;
  } catch {
    // getComputedStyle can fail while the window is tearing down.
  }
  return fallback;
}

export function resolveGraphTheme(
  getProperty: (name: string) => string = () => '',
  isDark = false,
): GraphTheme {
  const fallback = isDark ? DARK_THEME : LIGHT_THEME;
  return {
    text: readToken(getProperty, '--pq-graph-text', fallback.text),
    textMuted: readToken(getProperty, '--pq-graph-text-muted', fallback.textMuted),
    border: readToken(getProperty, '--pq-graph-node-border', fallback.border),
    selection: readToken(getProperty, '--pq-graph-selection', fallback.selection),
    surface: readToken(getProperty, '--pq-graph-surface', fallback.surface),
  };
}

export function buildGraphStyles(theme: GraphTheme): StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        width: 'data(size)',
        height: 'data(size)',
        shape: 'data(shape)',
        label: 'data(displayLabel)',
        'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
        'font-size': 'mapData(size, 20, 60, 10, 13)',
        'min-zoomed-font-size': 6,
        'font-weight': 600,
        color: theme.text,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 6,
        'text-wrap': 'wrap',
        'text-max-width': 110,
        'text-events': 'no',
        'text-outline-color': theme.surface,
        'text-outline-width': 2,
        'background-color': 'data(color)',
        'background-opacity': 1,
        'border-color': theme.border,
        'border-width': 1.2,
        'overlay-opacity': 0,
      },
    },
    {
      // 阅读进度外环：透明中心的 SVG，按 5% 分桶缓存。
      selector: 'node[hasProgress = 1]',
      style: {
        'background-image': 'data(progressImage)',
        'background-image-opacity': 1,
        'background-fit': 'contain',
        'background-width': '100%',
        'background-height': '100%',
        'background-repeat': 'no-repeat',
      },
    },
    {
      selector: 'node[type = "paper"]',
      style: { 'background-color': 'data(color)' },
    },
    {
      selector: 'node[type = "note"]',
      style: { 'background-color': GRAPH_NODE_COLORS.note },
    },
    {
      selector: 'node[type = "tag"]',
      style: { 'background-color': GRAPH_NODE_COLORS.tag },
    },
    {
      selector: 'node[type = "category"]',
      style: { 'background-color': GRAPH_NODE_COLORS.category },
    },
    {
      selector: 'node[type = "reference"]',
      style: { 'background-color': GRAPH_NODE_COLORS.reference },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-color': theme.selection,
        label: 'data(label)',
      },
    },
    {
      selector: 'node.label-all',
      style: { label: 'data(label)' },
    },
    {
      // hover 时显示被抽稀的节点标题；移出后由 focused 类移除。
      selector: 'node.focused',
      style: { label: 'data(label)' },
    },
    {
      selector: 'node.search-match',
      style: {
        'border-width': 4,
        'border-color': '#f59e0b',
        label: 'data(label)',
      },
    },
    {
      selector: 'node.search-dim',
      style: { opacity: 0.16 },
    },
    {
      selector: 'edge',
      style: {
        width: 'mapData(weight, 0, 1, 0.8, 4)',
        'curve-style': 'data(curve)',
        'line-color': theme.textMuted,
        'target-arrow-color': theme.textMuted,
        'target-arrow-shape': 'none',
        opacity: 1,
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'edge:selected',
      style: {
        width: 5,
        opacity: 0.95,
        'line-color': theme.selection,
        'target-arrow-color': theme.selection,
      },
    },
    {
      selector: 'edge[type = "related_by_embedding"]',
      style: {
        'line-color': GRAPH_EDGE_COLORS.related_by_embedding,
        'line-style': 'dashed',
        'line-dash-pattern': [6, 4],
        width: 'mapData(weight, 0, 1, 0.6, 2.4)',
        opacity: 0.55,
      },
    },
    {
      selector: 'edge[type = "note_paper"]',
      style: { 'line-color': GRAPH_EDGE_COLORS.note_paper, 'target-arrow-shape': 'triangle' },
    },
    {
      selector: 'edge[type = "note_link"]',
      style: {
        'line-color': GRAPH_EDGE_COLORS.note_link,
        'target-arrow-shape': 'triangle',
      },
    },
    {
      selector: 'edge[type = "paper_tag"]',
      style: { 'line-color': GRAPH_EDGE_COLORS.paper_tag, 'line-style': 'dashed', opacity: 0.35 },
    },
    {
      selector: 'edge[type = "note_tag"]',
      style: { 'line-color': GRAPH_EDGE_COLORS.note_tag, 'line-style': 'dashed', opacity: 0.35 },
    },
    {
      selector: 'edge[type = "paper_category"]',
      style: { 'line-color': GRAPH_EDGE_COLORS.paper_category, 'line-style': 'dashed', opacity: 0.35 },
    },
    {
      selector: 'edge[type = "paper_cites_paper"]',
      style: {
        'line-color': GRAPH_EDGE_COLORS.paper_cites_paper,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': GRAPH_EDGE_COLORS.paper_cites_paper,
        opacity: 0.7,
      },
    },
    {
      selector: 'edge[type = "paper_reference"]',
      style: {
        'line-color': GRAPH_EDGE_COLORS.paper_reference,
        'line-style': 'dotted',
        'target-arrow-shape': 'triangle',
      },
    },
    {
      selector: 'edge[type = "co_author"]',
      style: { 'line-color': GRAPH_EDGE_COLORS.co_author, 'line-style': 'dashed', opacity: 0.35 },
    },
    {
      selector: 'edge[type = "custom_relation"]',
      style: {
        'line-color': GRAPH_EDGE_COLORS.custom_relation,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': GRAPH_EDGE_COLORS.custom_relation,
      },
    },
    {
      selector: 'edge.lod-hidden',
      style: { display: 'none' },
    },
    {
      selector: '.faded',
      style: { opacity: 0.1 },
    },
    {
      selector: '.focused',
      style: {
        opacity: 1,
        'border-width': 3,
        'border-color': theme.selection,
      },
    },
  ] as unknown as StylesheetJson;
}

/** WebGL preview 不支持虚线/点线/边标签；启用时先降级样式（B8 决策门）。 */
export function degradeStylesForWebgl(styles: StylesheetJson): StylesheetJson {
  return (styles as Array<{ selector: string; style: Record<string, unknown> }>).map((rule) => {
    const style = { ...rule.style };
    if (style['line-style'] === 'dashed' || style['line-style'] === 'dotted') {
      style['line-style'] = 'solid';
    }
    delete style['line-dash-pattern'];
    return { selector: rule.selector, style };
  }) as unknown as StylesheetJson;
}
