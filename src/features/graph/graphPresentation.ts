// B7.3: pure snapshot → Cytoscape presentation helpers.
//
// Everything here is deterministic and free of cytoscape/DOM imports so Node
// tests can lock the visual contract: node shape/color, progress rings, edge
// curves, LOD budgets, search matching and scale aggregation.

import type {
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeType,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
  KnowledgeGraphSnapshot,
} from '../../types/knowledgeGraph.ts';

export type GraphColorMode = 'type' | 'category' | 'year' | 'cluster';

export type GraphNodeShape =
  | 'ellipse'
  | 'round-rectangle'
  | 'diamond'
  | 'hexagon'
  | 'rectangle';

export const GRAPH_NODE_COLORS: Record<KnowledgeGraphNodeType, string> = {
  paper: '#2563eb',
  note: '#16a34a',
  tag: '#d97706',
  category: '#7c3aed',
  reference: '#64748b',
};

export const GRAPH_EDGE_COLORS: Record<KnowledgeGraphEdgeType, string> = {
  related_by_embedding: '#0ea5e9',
  note_paper: '#22c55e',
  note_link: '#84cc16',
  paper_tag: '#f59e0b',
  note_tag: '#eab308',
  paper_category: '#8b5cf6',
  paper_cites_paper: '#ef4444',
  paper_reference: '#64748b',
  co_author: '#06b6d4',
  custom_relation: '#14b8a6',
};

export const ANNOTATION_EDGE_TYPES: ReadonlySet<KnowledgeGraphEdgeType> = new Set([
  'paper_tag',
  'note_tag',
  'paper_category',
]);

export const DIRECTIONAL_EDGE_TYPES: ReadonlySet<KnowledgeGraphEdgeType> = new Set([
  'paper_cites_paper',
  'paper_reference',
  'note_link',
  'custom_relation',
]);

const YEAR_BANDS: Array<{ min: number; max: number; color: string }> = [
  { min: Number.NEGATIVE_INFINITY, max: 2010, color: '#94a3b8' },
  { min: 2011, max: 2015, color: '#38bdf8' },
  { min: 2016, max: 2019, color: '#22c55e' },
  { min: 2020, max: 2022, color: '#f59e0b' },
  { min: 2023, max: Number.POSITIVE_INFINITY, color: '#ef4444' },
];

export const UNKNOWN_YEAR_COLOR = '#64748b';
export const UNCATEGORIZED_COLOR = '#64748b';

export function resolveNodeShape(type: KnowledgeGraphNodeType): GraphNodeShape {
  switch (type) {
    case 'note':
      return 'round-rectangle';
    case 'tag':
      return 'diamond';
    case 'category':
      return 'hexagon';
    case 'reference':
      return 'rectangle';
    case 'paper':
    default:
      return 'ellipse';
  }
}

function parseYear(value: string | null | undefined): number | null {
  const match = String(value ?? '').match(/\b(1[89]\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

export function resolveYearColor(year: string | null | undefined): string {
  const parsed = parseYear(year);
  if (parsed === null) return UNKNOWN_YEAR_COLOR;
  return YEAR_BANDS.find((band) => parsed >= band.min && parsed <= band.max)?.color ?? UNKNOWN_YEAR_COLOR;
}

export function resolveNodeColor(
  node: Pick<KnowledgeGraphNode, 'type' | 'color' | 'year'>,
  mode: GraphColorMode,
): string {
  if (mode === 'category' || mode === 'cluster') {
    return node.type === 'paper'
      ? node.color || UNCATEGORIZED_COLOR
      : GRAPH_NODE_COLORS[node.type];
  }

  if (mode === 'year' && (node.type === 'paper' || node.type === 'reference')) {
    return resolveYearColor(node.year);
  }

  return GRAPH_NODE_COLORS[node.type];
}

export function edgePairKey(source: string, target: string): string {
  return source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
}

export function computeEdgePairCounts(
  edges: readonly Pick<KnowledgeGraphEdge, 'source' | 'target'>[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    const key = edgePairKey(edge.source, edge.target);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function resolveEdgeCurve(
  edge: Pick<KnowledgeGraphEdge, 'type' | 'source' | 'target'>,
  options: { multiEdge: boolean; nodeCount: number },
): 'bezier' | 'straight' | 'haystack' {
  if (options.multiEdge || DIRECTIONAL_EDGE_TYPES.has(edge.type)) {
    return 'bezier';
  }
  // 语义边要保留虚线，haystack 不支持虚线；规模大时仍用 straight 保证可读。
  if (edge.type === 'related_by_embedding') {
    return 'straight';
  }
  return options.nodeCount > 700 ? 'haystack' : 'bezier';
}

const PROGRESS_RING_CACHE = new Map<number, string>();
const PROGRESS_RING_BUCKETS = 20;
const PROGRESS_RING_COLOR = '#10b981';
const PROGRESS_RING_TRACK = 'rgba(100, 116, 139, 0.28)';

/**
 * 阅读进度外环：按 5% 分桶生成透明中心的 SVG data URI，最多 20 个缓存项。
 * Cytoscape 的 background-image 支持 data URI；比逐节点生成 SVG 便宜得多。
 */
export function buildProgressRingImage(progress: number | null | undefined): string {
  if (progress === null || progress === undefined || !Number.isFinite(Number(progress))) {
    return '';
  }

  const clamped = Math.max(0, Math.min(1, Number(progress)));
  const bucket = Math.round(clamped * PROGRESS_RING_BUCKETS);
  if (bucket <= 0) return '';

  const cached = PROGRESS_RING_CACHE.get(bucket);
  if (cached) return cached;

  const ratio = bucket / PROGRESS_RING_BUCKETS;
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * ratio;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `<circle cx="50" cy="50" r="${radius}" fill="none" stroke="${PROGRESS_RING_TRACK}" stroke-width="7"/>`,
    `<circle cx="50" cy="50" r="${radius}" fill="none" stroke="${PROGRESS_RING_COLOR}" stroke-width="7"`,
    ` stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}"`,
    ' transform="rotate(-90 50 50)"/>',
    '</svg>',
  ].join('');
  const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  PROGRESS_RING_CACHE.set(bucket, dataUri);
  return dataUri;
}

export function computeDegreeByNode(
  nodes: readonly Pick<KnowledgeGraphNode, 'id' | 'type'>[],
  edges: readonly Pick<KnowledgeGraphEdge, 'type' | 'source' | 'target'>[],
  options: { excludeAnnotations?: boolean } = {},
): Map<string, number> {
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (options.excludeAnnotations && ANNOTATION_EDGE_TYPES.has(edge.type)) continue;
    if (degree.has(edge.source)) degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    if (degree.has(edge.target)) degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

// 标签抽稀：节点较少时全部标注；节点多时只标 hub。
// 不用「随缩放阈值显隐」的原因：隐藏标签会让节点包围盒变小，fit 随即放大视图，
// 标签又重新满足显示条件，形成反馈振荡，总览仍然糊成一片。
export const LABEL_ALL_BELOW = 40;
export const HUB_LABEL_RATIO = 0.2;

export interface GraphElementOptions {
  localizeNodeLabel: (node: KnowledgeGraphNode) => string;
  colorMode?: GraphColorMode;
  /** 图内内容边度数；缺省时用 node.degree。 */
  degreeByNode?: ReadonlyMap<string, number>;
}

export function buildGraphElements(
  snapshot: KnowledgeGraphSnapshot,
  options: GraphElementOptions,
): Array<{ data: Record<string, unknown> }> {
  const colorMode = options.colorMode ?? 'category';
  const degreeByNode = options.degreeByNode
    ?? computeDegreeByNode(snapshot.nodes, snapshot.edges, { excludeAnnotations: true });
  const sizes = snapshot.nodes.map((node) => node.size ?? 28).sort((left, right) => right - left);
  const labelAll = snapshot.nodes.length <= LABEL_ALL_BELOW;
  const hubCount = Math.max(1, Math.round(sizes.length * HUB_LABEL_RATIO));
  const hubCutoff = sizes[Math.min(sizes.length - 1, hubCount - 1)] ?? 0;
  const pairCounts = computeEdgePairCounts(snapshot.edges);

  return [
    ...snapshot.nodes.map((node) => {
      const label = options.localizeNodeLabel(node);
      const size = node.size ?? 28;
      const degree = degreeByNode.get(node.id) ?? node.degree ?? 0;
      const progress = node.type === 'paper' ? Number(node.readingProgress) || 0 : 0;
      // 0.4.42：hasProgress 必须跟着「真的画得出外环」走。进度 < 2.5% 时外环落在
      // 0 桶、图片为空串；若此时仍把节点标记为 hasProgress=1，样式 `data(progressImage)`
      // 会把空串送进 cytoscape 的 multiple 解析，抛出 null.value 并让整张图画不出来。
      const progressImage = buildProgressRingImage(progress);

      return {
        data: {
          ...node,
          // 画布使用本地化标题；rawLabel 保留数据原文，供 locale 切换时就地更新。
          label,
          rawLabel: node.label,
          size,
          degree,
          shape: resolveNodeShape(node.type),
          color: resolveNodeColor(node, colorMode),
          // displayLabel 为画布实际绘制的文本；data(label) 保留给选中态与放大态使用。
          displayLabel: labelAll || size >= hubCutoff ? label : '',
          progressImage,
          hasProgress: progressImage ? 1 : 0,
        },
      };
    }),
    ...snapshot.edges.map((edge) => {
      const multiEdge = (pairCounts.get(edgePairKey(edge.source, edge.target)) ?? 0) > 1;
      return {
        data: {
          ...edge,
          curve: resolveEdgeCurve(edge, { multiEdge, nodeCount: snapshot.nodes.length }),
          multiEdge,
          directional: DIRECTIONAL_EDGE_TYPES.has(edge.type),
          annotation: ANNOTATION_EDGE_TYPES.has(edge.type),
        },
      };
    }),
  ];
}

/** 低缩放 LOD：只显示权重最高的 ratio 部分边；有向边始终保留。 */
export function selectLodVisibleEdgeIds(
  edges: readonly Pick<KnowledgeGraphEdge, 'id' | 'type' | 'weight'>[],
  ratio = 0.2,
): Set<string> {  const clamped = Math.max(0, Math.min(1, Number(ratio)));
  if (clamped >= 1) return new Set(edges.map((edge) => edge.id));

  const weights = edges
    .map((edge) => Number(edge.weight) || 0)
    .sort((left, right) => right - left);
  const keepCount = Math.max(1, Math.ceil(weights.length * clamped));
  const cutoff = weights[Math.min(weights.length - 1, keepCount - 1)] ?? 0;
  const visible = new Set<string>();

  for (const edge of edges) {
    if (DIRECTIONAL_EDGE_TYPES.has(edge.type) || (Number(edge.weight) || 0) >= cutoff) {
      visible.add(edge.id);
    }
  }
  return visible;
}

/** B8 三档 LOD：远看只留 base，中距离约 60%，近看恢复全部。 */
export function resolveLodRatio(zoom: number, baseRatio = 0.2): number {
  const ratio = Math.max(0.05, Math.min(1, Number(baseRatio) || 0.2));
  const level = Number(zoom);
  if (!Number.isFinite(level) || level < 0.5) return ratio;
  if (level < 0.9) return Math.min(0.6, ratio * 2.5);
  return 1;
}

/** B8 命名别名：LOD 可见边集合。 */
export const computeLodVisibleEdgeIds = selectLodVisibleEdgeIds;

export function nodeMatchesQuery(node: Pick<KnowledgeGraphNode, 'label' | 'subtitle' | 'tag' | 'categoryIds' | 'doi'>, query: string): boolean {  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  return [
    node.label,
    node.subtitle,
    node.tag,
    node.doi,
    ...(node.categoryIds ?? []),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
    .includes(normalized);
}

export function matchGraphNodeIds(
  nodes: readonly Pick<KnowledgeGraphNode, 'id' | 'label' | 'subtitle' | 'tag' | 'categoryIds' | 'doi'>[],
  query: string,
): Set<string> {
  const matched = new Set<string>();
  for (const node of nodes) {
    if (nodeMatchesQuery(node, query)) matched.add(node.id);
  }
  return matched;
}

export interface AggregatedGraphOptions {
  /** 已展开的分类 id；展开后显示该分类下的论文节点。 */
  expandedCategoryIds?: ReadonlySet<string>;
  /** 无分类分组的显示名；由调用方按当前语言传入。 */
  uncategorizedLabel?: string;
}

const UNCATEGORIZED_KEY = '__uncategorized__';

function paperCountLabel(count: number): string {
  return `${count} paper${count === 1 ? '' : 's'}`;
}

function categoryKeyForPaper(paper: Pick<KnowledgeGraphNode, 'primaryCategoryId' | 'categoryIds'>): string {
  return paper.primaryCategoryId
    || (Array.isArray(paper.categoryIds) ? paper.categoryIds[0] : '')
    || UNCATEGORIZED_KEY;
}

/**
 * 规模模式（B8）：把论文按主分类折叠为超节点，保留分类节点与超节点之间的
 * 成员数边；展开某分类后，该分类的论文节点恢复，并保留论文之间的引用/语义边。
 * 纯函数，便于测试“成员数守恒”和“展开后节点恢复”。
 */
export function aggregateGraphByCategory(
  snapshot: KnowledgeGraphSnapshot,
  options: AggregatedGraphOptions = {},
): KnowledgeGraphSnapshot {
  const expanded = options.expandedCategoryIds ?? new Set<string>();
  const uncategorizedLabel = options.uncategorizedLabel ?? UNCATEGORIZED_KEY;
  const categoryNodes = snapshot.nodes.filter((node) => node.type === 'category' && node.categoryId);
  const categoryNodeById = new Map(categoryNodes.map((node) => [node.categoryId as string, node]));
  const categoryLabelById = new Map(categoryNodes.map((node) => [node.categoryId as string, node.label]));
  const papers = snapshot.nodes.filter((node) => node.type === 'paper');
  const paperIds = new Set(papers.map((node) => node.id));
  const paperById = new Map(papers.map((node) => [node.id, node]));
  const groups = new Map<string, KnowledgeGraphNode[]>();

  for (const paper of papers) {
    const key = categoryKeyForPaper(paper);
    const group = groups.get(key) ?? [];
    group.push(paper);
    groups.set(key, group);
  }

  const nodes: KnowledgeGraphNode[] = [];
  const includedPaperIds = new Set<string>();
  const supernodeIdByCategory = new Map<string, string>();

  // 有分类节点的组直接复用该分类节点作为超节点，避免“分类 + cluster”重复；
  // 无分类节点的组（含未分类）才创建 cluster 节点。
  for (const [key, members] of groups) {
    if (expanded.has(key)) {
      const categoryNode = categoryNodeById.get(key);
      if (categoryNode) nodes.push(categoryNode);
      nodes.push(...members);
      for (const member of members) includedPaperIds.add(member.id);
      continue;
    }

    const categoryNode = categoryNodeById.get(key);
    const supernode = categoryNode
      ? {
          ...categoryNode,
          subtitle: paperCountLabel(members.length),
          size: Math.min(64, 24 + Math.sqrt(members.length) * 6),
          degree: members.length,
        }
      : {
          id: `cluster:${key}`,
          type: 'category' as const,
          label: key === UNCATEGORIZED_KEY
            ? uncategorizedLabel
            : categoryLabelById.get(key) || key,
          subtitle: paperCountLabel(members.length),
          categoryId: key === UNCATEGORIZED_KEY ? undefined : key,
          size: Math.min(64, 24 + Math.sqrt(members.length) * 6),
          degree: members.length,
        };
    supernodeIdByCategory.set(key, supernode.id);
    nodes.push(supernode);
  }

  // 没有论文的分类节点仍然保留（作为独立的分类/空簇）。
  for (const categoryNode of categoryNodes) {
    if (supernodeIdByCategory.has(categoryNode.categoryId as string)) continue;
    if (nodes.some((node) => node.id === categoryNode.id)) continue;
    nodes.push(categoryNode);
  }

  // 其他非论文、非分类节点（笔记/标签/引用）在规模模式中不参与，避免重新引入蜘蛛网。
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: KnowledgeGraphEdge[] = [];
  const supernodePairCounts = new Map<string, { source: string; target: string; count: number; weight: number }>();

  const supernodeForPaper = (paperId: string): string | null => {
    const paper = paperById.get(paperId);
    if (!paper) return null;
    const key = categoryKeyForPaper(paper);
    return supernodeIdByCategory.get(key) ?? null;
  };

  for (const edge of snapshot.edges) {
    if (ANNOTATION_EDGE_TYPES.has(edge.type)) continue;

    if (paperIds.has(edge.source) && paperIds.has(edge.target)) {
      const sourceIncluded = includedPaperIds.has(edge.source);
      const targetIncluded = includedPaperIds.has(edge.target);
      if (sourceIncluded && targetIncluded) {
        edges.push(edge);
        continue;
      }
      const sourceSuper = supernodeForPaper(edge.source);
      const targetSuper = supernodeForPaper(edge.target);
      if (!sourceSuper || !targetSuper) continue;
      if (sourceSuper === targetSuper) {
        const node = nodeById.get(sourceSuper);
        if (node) {
          node.degree = (node.degree ?? 0) + 1;
          node.size = Math.min(64, 24 + Math.sqrt(node.degree) * 6);
        }
        continue;
      }
      const key = `${sourceSuper}->${targetSuper}`;
      const current = supernodePairCounts.get(key);
      supernodePairCounts.set(key, {
        source: sourceSuper,
        target: targetSuper,
        count: (current?.count ?? 0) + 1,
        weight: Math.max(current?.weight ?? 0, Number(edge.weight) || 0),
      });
      continue;
    }

    // 论文与笔记/标签之间的边在规模模式中不需要；展开后的论文与分类之间的
    // 注释边也不画，分类信息已由分组表达。
    if (includedPaperIds.has(edge.source) || includedPaperIds.has(edge.target)) continue;
  }

  for (const [key, group] of supernodePairCounts) {
    edges.push({
      id: `cluster-edge:${key}`,
      source: group.source,
      target: group.target,
      type: 'related_by_embedding',
      label: `${group.count} links`,
      weight: group.weight,
      similarity: group.weight,
    });
  }

  // 展开后保留分类节点与论文之间的成员边，帮助阅读。
  for (const edge of snapshot.edges) {
    if (edge.type !== 'paper_category') continue;
    if (!includedPaperIds.has(edge.source)) continue;
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    edges.push(edge);
  }

  return {
    ...snapshot,
    nodes,
    edges: edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target)),
  };
}

/** 位置持久化签名：节点/边 id 与布局版本共同决定一份坐标是否可复用。 */
export function computeGraphSignature(snapshot: KnowledgeGraphSnapshot, layoutVersion = 1): string {
  const nodeIds = snapshot.nodes.map((node) => node.id).sort();
  const edgeIds = snapshot.edges.map((edge) => edge.id).sort();
  let hash = 2166136261;
  const feed = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  feed(`v${layoutVersion}|${snapshot.metadata?.graphQuality?.geometryVersion ?? ''}|`);
  for (const id of nodeIds) feed(`${id}\u0001`);
  feed('\u0002');
  for (const id of edgeIds) feed(`${id}\u0001`);
  return `${nodeIds.length}-${edgeIds.length}-${(hash >>> 0).toString(36)}`;
}
