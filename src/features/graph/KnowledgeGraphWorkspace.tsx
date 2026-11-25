import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Crosshair,
  Download,
  FileJson2,
  Link2,
  FileText,
  Filter,
  GitBranch,
  Loader2,
  Maximize2,
  Minus,
  Network,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  StickyNote,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { emitOpenLibraryPaper } from '../../app/appEvents';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import { noteDisplayTitle } from '../notes/notesDisplay';
import {
  createKnowledgeGraphRelation,
  updateKnowledgeGraphRelation,
  deleteKnowledgeGraphRelation,
  getKnowledgeGraph,
} from '../../services/knowledgeGraph';
import {
  fetchAllLibraryReferences,
  listenLibraryReferenceProgress,
} from '../../services/library';
import { useTabsStore } from '../../stores/useTabsStore';
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeType,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
  KnowledgeGraphSnapshot,
} from '../../types/knowledgeGraph';
import type { LibraryReferenceProgress } from '../../types/library';
import { cn } from '../../utils/cn';
import { positionsToMap } from './graphLayoutMessages.ts';
import { createGraphLayoutClient, type GraphLayoutClient } from './graphLayoutRunner.ts';
import { runMainThreadGraphLayout } from './graphLayoutFallback.ts';
import { formatGraphSamplingSummary, readSnapshotMetadata } from './knowledgeGraphMeta.ts';

type LayoutMode = 'global' | 'local';
type GraphPerspective = 'mixed' | 'paper' | 'note' | 'reference' | 'semantic' | 'custom';
type GraphContextMenuState = {
  x: number;
  y: number;
  node: KnowledgeGraphNode;
} | null;

function areStringSetsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

const EDGE_COLORS: Record<KnowledgeGraphEdgeType, string> = {
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

const nodeTypes: Array<{
  type: KnowledgeGraphNodeType;
  zh: string;
  en: string;
  icon: typeof FileText;
}> = [
  { type: 'paper', zh: '文献', en: 'Papers', icon: FileText },
  { type: 'note', zh: '笔记', en: 'Notes', icon: StickyNote },
  { type: 'tag', zh: '标签', en: 'Tags', icon: Filter },
  { type: 'category', zh: '分类', en: 'Collections', icon: GitBranch },
  { type: 'reference', zh: '引用', en: 'References', icon: Link2 },
];

const edgeTypes: Array<{
  type: KnowledgeGraphEdgeType;
  zh: string;
  en: string;
}> = [
  { type: 'co_author', zh: '共同作者', en: 'Co-authors' },
  { type: 'related_by_embedding', zh: '语义相似', en: 'Embedding Related' },
  { type: 'note_paper', zh: '笔记引用文献', en: 'Note to Paper' },
  { type: 'note_link', zh: '笔记链接', en: 'Note Links' },
  { type: 'paper_tag', zh: '文献标签', en: 'Paper Tags' },
  { type: 'note_tag', zh: '笔记标签', en: 'Note Tags' },
  { type: 'paper_category', zh: '分类', en: 'Collections' },
  { type: 'paper_cites_paper', zh: '文献互引', en: 'Paper Citations' },
  { type: 'paper_reference', zh: '外部参考文献', en: 'External References' },
  { type: 'custom_relation', zh: '自定义关系', en: 'Custom Relations' },
];

const visibleNodeTypes = nodeTypes.filter((item) => item.type !== 'reference');
const visibleEdgeTypes = edgeTypes.filter((item) => item.type !== 'paper_reference');

const graphPerspectives: Array<{
  id: GraphPerspective;
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
}> = [
  {
    id: 'mixed',
    zh: '混合图谱',
    en: 'Mixed',
    descriptionZh: '文献、笔记、标签、分类和引用一起探索。',
    descriptionEn: 'Explore papers, notes, tags, collections, and references together.',
  },
  {
    id: 'paper',
    zh: '单论文网络',
    en: 'Paper',
    descriptionZh: '突出论文之间的引用、分类和语义关系。',
    descriptionEn: 'Emphasize citation, collection, and semantic paper relations.',
  },
  {
    id: 'note',
    zh: '笔记网络',
    en: 'Notes',
    descriptionZh: '突出笔记双链、笔记引用文献和笔记标签。',
    descriptionEn: 'Emphasize note links, note-paper anchors, and note tags.',
  },
  {
    id: 'reference',
    zh: '参考文献',
    en: 'Citations',
    descriptionZh: '查看文献互引和未入库参考文献。',
    descriptionEn: 'Inspect citation links between papers already in the library.',
  },
  {
    id: 'semantic',
    zh: '语义相似',
    en: 'Semantic',
    descriptionZh: '突出 sqlite-vec/RAG 自动生成的相似文献边。',
    descriptionEn: 'Focus on sqlite-vec/RAG embedding similarity edges.',
  },
  {
    id: 'custom',
    zh: '自定义/AI',
    en: 'Custom/AI',
    descriptionZh: '查看人工添加和 AI 建议后确认的关系。',
    descriptionEn: 'Inspect manually added and approved AI-suggested relations.',
  },
];

const NODE_COLORS: Record<string, string> = {
  paper: '#2563eb',
  note: '#16a34a',
  tag: '#d97706',
  category: '#7c3aed',
  reference: '#64748b',
};

// Cytoscape 只接受具体颜色值：深色主题的 --pq-text 是 rgba()，直接传入会被忽略。
// 两套 6 位 hex 均对图谱画布（--pq-surface #ffffff / #1a1a1a）≥14:1。
const GRAPH_TEXT_COLORS = {
  light: '#1f2937',
  dark: '#e5e7eb',
} as const;

const graphStyles = [
  {
    selector: 'node',
    style: {
      width: 'data(size)',
      height: 'data(size)',
      label: 'data(displayLabel)',
      'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
      // 字号随节点规模（size 即 hub 程度）微调；配合 displayLabel 的数据驱动抽稀。
      'font-size': 'mapData(size, 20, 60, 10, 13)',
      'min-zoomed-font-size': 6,
      'font-weight': 600,
      color: GRAPH_TEXT_COLORS.light,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 6,
      'text-wrap': 'wrap',
      'text-max-width': 110,
      'background-color': '#64748b',
      'border-color': '#ffffff',
      'border-width': 1.2,
      'overlay-opacity': 0,
      'transition-property': 'background-color, border-color, opacity, width, height',
      'transition-duration': 120,
    },
  },
  { selector: 'node[type = "paper"]', style: { 'background-color': 'data(color)' } },
  { selector: 'node[type = "note"]', style: { 'background-color': NODE_COLORS.note } },
  { selector: 'node[type = "tag"]', style: { 'background-color': NODE_COLORS.tag } },
  { selector: 'node[type = "category"]', style: { 'background-color': NODE_COLORS.category } },
  { selector: 'node[type = "reference"]', style: { 'background-color': NODE_COLORS.reference } },
  {
    selector: 'node:selected',
    style: {
      'border-width': 4,
      'border-color': '#0f172a',
      // 选中节点总是显示标签，即使它在总览下属于被抽稀的非 hub 节点。
      label: 'data(label)',
    },
  },
  {
    // 用户主动放大后（LABEL_ALL_ZOOM）给全部节点恢复标签。
    selector: 'node.label-all',
    style: {
      label: 'data(label)',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'mapData(weight, 0, 1, 0.8, 4)',
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      'curve-style': 'bezier',
      opacity: 0.42,
      'overlay-opacity': 0,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      width: 5,
      opacity: 0.92,
      'line-color': '#111827',
      'target-arrow-color': '#111827',
    },
  },
  {
    selector: 'edge[type = "related_by_embedding"]',
    style: {
      'line-color': EDGE_COLORS.related_by_embedding,
      'line-style': 'dashed',
      width: 'mapData(weight, 0, 1, 0.6, 2.4)',
      opacity: 0.5,
    },
  },
  { selector: 'edge[type = "note_paper"]', style: { 'line-color': EDGE_COLORS.note_paper } },
  { selector: 'edge[type = "note_link"]', style: { 'line-color': EDGE_COLORS.note_link, 'target-arrow-shape': 'triangle' } },
  { selector: 'edge[type = "paper_tag"]', style: { 'line-color': EDGE_COLORS.paper_tag } },
  { selector: 'edge[type = "note_tag"]', style: { 'line-color': EDGE_COLORS.note_tag, 'line-style': 'dashed' } },
  { selector: 'edge[type = "paper_category"]', style: { 'line-color': EDGE_COLORS.paper_category } },
  { selector: 'edge[type = "paper_cites_paper"]', style: { 'line-color': EDGE_COLORS.paper_cites_paper, 'target-arrow-shape': 'triangle' } },
  { selector: 'edge[type = "paper_reference"]', style: { 'line-color': EDGE_COLORS.paper_reference, 'line-style': 'dotted', 'target-arrow-shape': 'triangle' } },
  { selector: 'edge[type = "co_author"]', style: { 'line-color': EDGE_COLORS.co_author, 'line-style': 'dashed' } },
  { selector: 'edge[type = "custom_relation"]', style: { 'line-color': EDGE_COLORS.custom_relation, 'target-arrow-shape': 'triangle' } },
  {
    selector: '.faded',
    style: {
      opacity: 0.1,
    },
  },
  {
    selector: '.focused',
    style: {
      opacity: 1,
      'border-width': 3,
      'border-color': '#111827',
    },
  },
] as unknown as StylesheetJson;

function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function perspectiveNodeTypes(perspective: GraphPerspective): Record<KnowledgeGraphNodeType, boolean> {
  const all = {
    paper: true,
    note: true,
    tag: true,
    category: true,
    reference: true,
  };

  if (perspective === 'paper') {
    return { ...all, note: false, reference: false, tag: false, category: false };
  }

  if (perspective === 'note') {
    return { ...all, category: false, reference: false };
  }

  if (perspective === 'reference') {
    return { ...all, note: false, tag: false, category: false };
  }

  if (perspective === 'semantic') {
    return { paper: true, note: false, tag: false, category: false, reference: false };
  }

  if (perspective === 'custom') {
    return { paper: true, note: true, tag: false, category: false, reference: false };
  }

  return all;
}

function perspectiveEdgeTypes(perspective: GraphPerspective): Record<KnowledgeGraphEdgeType, boolean> {
  const all = {
    related_by_embedding: true,
    note_paper: true,
    note_link: true,
    paper_tag: true,
    note_tag: true,
    paper_category: true,
    paper_cites_paper: true,
    paper_reference: true,
    co_author: false,
    custom_relation: true,
  };

  if (perspective === 'paper') {
    return {
      ...all,
      note_paper: false,
      note_link: false,
      note_tag: false,
      paper_reference: false,
      paper_tag: false,
      paper_category: false,
      co_author: false,
      custom_relation: true,
    };
  }

  if (perspective === 'note') {
    return {
      ...all,
      related_by_embedding: false,
      paper_tag: false,
      paper_category: false,
      paper_cites_paper: false,
      paper_reference: false,
      co_author: false,
    };
  }

  if (perspective === 'reference') {
    return {
      ...all,
      related_by_embedding: false,
      note_paper: false,
      note_link: false,
      paper_tag: false,
      note_tag: false,
      paper_category: false,
      co_author: false,
      custom_relation: false,
    };
  }

  if (perspective === 'semantic') {
    return {
      related_by_embedding: true,
      note_paper: false,
      note_link: false,
      paper_tag: false,
      note_tag: false,
      paper_category: false,
      paper_cites_paper: false,
      paper_reference: false,
      co_author: false,
      custom_relation: false,
    };
  }

  if (perspective === 'custom') {
    return {
      related_by_embedding: false,
      note_paper: false,
      note_link: false,
      paper_tag: false,
      note_tag: false,
      paper_category: false,
      paper_cites_paper: false,
      paper_reference: false,
      co_author: false,
      custom_relation: true,
    };
  }

  return all;
}

// 标签抽稀：节点较少时全部标注；节点多时只标 hub。
// 不用「随缩放阈值显隐」的原因：隐藏标签会让节点包围盒变小，fit 随即放大视图，
// 标签又重新满足显示条件，形成反馈振荡，总览仍然糊成一片。这里改用确定性的数据驱动标注。
const LABEL_ALL_BELOW = 40;
const HUB_LABEL_RATIO = 0.2;
const LABEL_ALL_ZOOM = 1.15;

function toElements(
  snapshot: KnowledgeGraphSnapshot,
  localizeNodeLabel: (node: KnowledgeGraphNode) => string,
): ElementDefinition[] {
  const nodeSizes = snapshot.nodes.map((node) => node.size ?? 28).sort((left, right) => right - left);
  const labelAll = snapshot.nodes.length <= LABEL_ALL_BELOW;
  const hubCount = Math.max(1, Math.round(nodeSizes.length * HUB_LABEL_RATIO));
  const hubCutoff = nodeSizes[Math.min(nodeSizes.length - 1, hubCount - 1)] ?? 0;

  return [
    ...snapshot.nodes.map((node) => {
      const size = node.size ?? 28;
      const label = localizeNodeLabel(node);

      return {
        data: {
          ...node,
          // 画布使用本地化标题；rawLabel 保留数据原文，供 locale 切换时就地更新。
          label,
          rawLabel: node.label,
          size,
          color: node.color ?? NODE_COLORS[node.type] ?? NODE_COLORS.paper,
          // displayLabel 为画布实际绘制的文本；data(label) 保留给选中态与放大态使用。
          displayLabel: labelAll || size >= hubCutoff ? label : '',
        },
      };
    }),
    ...snapshot.edges.map((edge) => ({
      data: edge,
    })),
  ];
}

// S5-GRAPH-1：全局 fcose 布局在 module worker 中计算（headless cytoscape），
// 主线程只用 preset 布局套用坐标，避免 2500 次迭代阻塞渲染。
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

function disposeGraphLayoutClient() {
  graphLayoutRequestSeq += 1;
  graphLayoutClient?.dispose();
  graphLayoutClient = null;
}

function runLocalGraphLayout(cy: Core) {
  const layout = cy.layout(({
    name: 'concentric',
    animate: true,
    animationDuration: 320,
    fit: true,
    padding: 36,
    concentric: (node: cytoscape.NodeSingular) => node.degree(),
    levelWidth: () => 2,
    minNodeSpacing: 40,
  } as cytoscape.LayoutOptions));

  layout.run();
}

function applyPresetLayout(cy: Core, positions: ReturnType<typeof positionsToMap>) {
  if (cy.destroyed()) return;

  // preset 布局接受「节点 id -> 坐标」映射；未返回坐标的节点保持当前位置。
  const positionMap: Record<string, { x: number; y: number }> = {};
  cy.nodes().forEach((node) => {
    positionMap[node.id()] = positions.get(node.id()) ?? node.position();
  });

  const layout = cy.layout(({
    name: 'preset',
    positions: positionMap,
    animate: false,
    fit: true,
    padding: 36,
  } as cytoscape.LayoutOptions));

  layout.run();
}

function runGraphLayout(cy: Core, mode: LayoutMode) {
  // 局部 concentric 布局很轻，留在主线程；全局 fcose 交给 worker。
  if (mode === 'local') {
    runLocalGraphLayout(cy);
    return;
  }

  const requestId = graphLayoutRequestSeq + 1;
  graphLayoutRequestSeq = requestId;
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

  void getGraphLayoutClient()
    .requestLayout(nodes, edges)
    .then((result) => {
      if (requestId !== graphLayoutRequestSeq) return;
      applyPresetLayout(cy, positionsToMap(result));
    })
    .catch((error) => {
      if (requestId !== graphLayoutRequestSeq) return;
      console.warn('[paperquay] Knowledge graph layout failed; keeping current positions.', error);
      if (!cy.destroyed()) cy.fit(undefined, 36);
    });
}

function graphContainerHasSize(container: HTMLDivElement | null) {
  return Boolean(container && container.clientWidth > 0 && container.clientHeight > 0);
}

function CollapsiblePanel({
  title,
  summary,
  icon,
  collapsed,
  onToggle,
  children,
  className,
}: {
  title: string;
  summary?: ReactNode;
  icon?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mt-3 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)]', className)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs font-semibold text-[var(--pq-text)]"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--pq-text-muted)]" strokeWidth={1.8} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--pq-text-muted)]" strokeWidth={1.8} />
        )}
        {icon ? <span className="shrink-0 text-[var(--pq-text-muted)]">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {summary ? (
          <span className="shrink-0 text-[11px] font-medium text-[var(--pq-text-muted)]">
            {summary}
          </span>
        ) : null}
      </button>
      {collapsed ? null : (
        <div className="border-t border-[var(--pq-border)] p-3">
          {children}
        </div>
      )}
    </section>
  );
}

export default function KnowledgeGraphWorkspace({ workspaceActive = true }: { workspaceActive?: boolean }) {
  const locale = useAppLocale();
  const l = useLocaleText();
  const isEnglish = locale === 'en-US';
  // 笔记节点的空标题/旧哨兵按当前语言显示；论文、标签等节点保持后端标签。
  const displayNodeLabel = useCallback(
    (node: Pick<KnowledgeGraphNode, 'type' | 'label'>) =>
      node.type === 'note' ? noteDisplayTitle(node.label, l) : node.label,
    [l],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  // 用户手动缩放/平移后不再自动 refit，避免拖拽侧栏或改窗口尺寸时把视图拉回原位。
  const userAdjustedViewRef = useRef(false);
  // 当前是否已切换到「全部标签」密度，避免同一 zoom 事件重复加/减类。
  const labelsExpandedRef = useRef(false);
  const quickRelationSourceRef = useRef<KnowledgeGraphNode | null>(null);
  const renderedNodeIdsRef = useRef<Set<string>>(new Set());
  const renderedEdgeIdsRef = useRef<Set<string>>(new Set());
  const renderedLayoutModeRef = useRef<LayoutMode>('global');
  // 容器不可见（工作区 hidden 挂载）时推迟的布局，激活后补跑
  const pendingLayoutRef = useRef(false);
  const openNoteTab = useTabsStore((state) => state.openNoteTab);
  const [snapshot, setSnapshot] = useState<KnowledgeGraphSnapshot | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeGraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeGraphEdge | null>(null);
  const [edgeEdit, setEdgeEdit] = useState<{
    label: string;
    description: string;
    weight: number;
    working: boolean;
  } | null>(null);
  const [relationSourceNode, setRelationSourceNode] = useState<KnowledgeGraphNode | null>(null);
  const [relationTargetNode, setRelationTargetNode] = useState<KnowledgeGraphNode | null>(null);
  const [quickRelationSourceNode, setQuickRelationSourceNode] = useState<KnowledgeGraphNode | null>(null);
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [perspective, setPerspective] = useState<GraphPerspective>('paper');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('global');
  const [localNodeId, setLocalNodeId] = useState('');
  const [localDepth, setLocalDepth] = useState(1);
  const [enabledNodeTypes, setEnabledNodeTypes] = useState<Record<KnowledgeGraphNodeType, boolean>>(
    perspectiveNodeTypes('paper'),
  );
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Record<KnowledgeGraphEdgeType, boolean>>(
    perspectiveEdgeTypes('paper'),
  );
  const [embeddingNeighbors, setEmbeddingNeighbors] = useState(10);
  // 邻里数连续拖动时每次都请求后端会打满主进程；防抖后再触发图谱重建。
  const [debouncedEmbeddingNeighbors, setDebouncedEmbeddingNeighbors] = useState(10);
  const [relationLabel, setRelationLabel] = useState('related');
  const [relationDescription, setRelationDescription] = useState('');
  const [relationWorking, setRelationWorking] = useState(false);
  const [referenceSyncProgress, setReferenceSyncProgress] = useState<LibraryReferenceProgress | null>(null);
  const [referenceSyncWorking, setReferenceSyncWorking] = useState(false);
  const [relationTargetSearch, setRelationTargetSearch] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    localDepth: false,
    nodeTypes: false,
    edgeTypes: false,
    embedding: true,
    customRelations: true,
    graphStats: true,
  });

  const openGraphNode = useCallback(async (node: KnowledgeGraphNode) => {
    if (node.type === 'paper' && node.paperId) {
      emitOpenLibraryPaper(node.paperId);
      return;
    }

    if (node.type === 'note' && node.noteId) {
      openNoteTab(node.noteId, node.label);
    }
  }, [openNoteTab]);

  const filteredSnapshot = useMemo<KnowledgeGraphSnapshot | null>(() => {
    if (!snapshot) return null;
    const allowedNodeIds = new Set(
      snapshot.nodes
        .filter((node) => enabledNodeTypes[node.type])
        .map((node) => node.id),
    );

    return {
      ...snapshot,
      nodes: snapshot.nodes.filter((node) => allowedNodeIds.has(node.id)),
      edges: snapshot.edges.filter((edge) =>
        enabledEdgeTypes[edge.type] &&
        allowedNodeIds.has(edge.source) &&
        allowedNodeIds.has(edge.target),
      ),
    };
  }, [enabledEdgeTypes, enabledNodeTypes, snapshot]);

  const nodeById = useMemo(() => {
    const nodes = snapshot?.nodes ?? [];
    return new Map(nodes.map((node) => [node.id, node]));
  }, [snapshot]);

  const graphStats = useMemo(() => {
    const graph = filteredSnapshot;
    if (!graph) {
      return { topNodes: [] as Array<{ node: KnowledgeGraphNode; degree: number }> };
    }

    const degreeByNode = new Map(graph.nodes.map((node) => [node.id, 0]));
    for (const edge of graph.edges) {
      degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
      degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);
    }

    return {
      topNodes: graph.nodes
        .map((node) => ({ node, degree: degreeByNode.get(node.id) ?? 0 }))
        .filter((item) => item.degree > 0)
        .sort((left, right) => right.degree - left.degree)
        .slice(0, 10),
    };
  }, [filteredSnapshot]);

  const selectedCustomEdges = useMemo(() => {
    if (!snapshot || !selectedNode) return [];
    return snapshot.edges.filter((edge) =>
      edge.type === 'custom_relation' &&
      (edge.source === selectedNode.id || edge.target === selectedNode.id),
    );
  }, [selectedNode, snapshot]);

  const activePerspective = graphPerspectives.find((item) => item.id === perspective) ?? graphPerspectives[0];

  useEffect(() => {
    quickRelationSourceRef.current = quickRelationSourceNode;
  }, [quickRelationSourceNode]);

  const selectGraphNode = useCallback((node: KnowledgeGraphNode, target?: cytoscape.NodeSingular) => {
    const cy = cyRef.current;
    setSelectedNode(node);
    setSelectedEdge(null);
    setContextMenu(null);

    if (!cy) return;

    cy.elements().removeClass('faded focused');
    cy.elements().unselect();
    const element = target ?? cy.$id(node.id);
    if (element.empty()) return;
    element.select();
    cy.elements().addClass('faded');
    element.removeClass('faded').addClass('focused');
    element.neighborhood().removeClass('faded').addClass('focused');
  }, []);

  const selectGraphEdge = useCallback((edge: KnowledgeGraphEdge, target?: cytoscape.EdgeSingular) => {
    const cy = cyRef.current;
    setSelectedEdge(edge);
    setSelectedNode(null);
    setContextMenu(null);

    if (!cy) return;

    cy.elements().removeClass('faded focused');
    cy.elements().unselect();
    const element = target ?? cy.$id(edge.id);
    if (element.empty()) return;
    element.select();
    cy.elements().addClass('faded');
    element.removeClass('faded').addClass('focused');
    element.connectedNodes().removeClass('faded').addClass('focused');
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 220);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedEmbeddingNeighbors(embeddingNeighbors), 260);
    return () => window.clearTimeout(handle);
  }, [embeddingNeighbors]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void listenLibraryReferenceProgress((progress) => {
      if (!cancelled) {
        setReferenceSyncProgress(progress);
      }
    }).then((nextUnsubscribe) => {
      if (cancelled) {
        nextUnsubscribe();
        return;
      }
      unsubscribe = nextUnsubscribe;
    }).catch(console.error);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    // 工作区在 App.tsx 中常驻 hidden 挂载：激活前不构建图谱，
    // 避免启动时全量相似边计算阻塞主进程、拖慢文献库等其它 IPC。
    if (!workspaceActive) return undefined;

    let cancelled = false;

    async function loadGraph() {
      setLoading(true);
      setError('');

      try {
        const graph = await getKnowledgeGraph({
          search: debouncedSearch,
          localNodeId: layoutMode === 'local' ? localNodeId : '',
          localDepth: layoutMode === 'local' ? localDepth : 0,
          includeEmbeddingEdges: enabledEdgeTypes.related_by_embedding,
          includeReferences: enabledEdgeTypes.paper_cites_paper,
          includeCoAuthors: enabledEdgeTypes.co_author,
          includeCustomRelations: enabledEdgeTypes.custom_relation,
          embeddingStrategy: 'mutual-knn',
          embeddingK: debouncedEmbeddingNeighbors,
        });

        if (cancelled) return;
        setSnapshot(graph);
        setSelectedNode((current) =>
          current && graph.nodes.some((node) => node.id === current.id)
            ? graph.nodes.find((node) => node.id === current.id) ?? null
            : null,
        );
        setSelectedEdge((current) =>
          current && graph.edges.some((edge) => edge.id === current.id)
            ? graph.edges.find((edge) => edge.id === current.id) ?? null
            : null,
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [
    workspaceActive,
    debouncedSearch,
    debouncedEmbeddingNeighbors,
    enabledEdgeTypes.custom_relation,
    enabledEdgeTypes.co_author,
    enabledEdgeTypes.paper_cites_paper,
    enabledEdgeTypes.related_by_embedding,
    layoutMode,
    localDepth,
    localNodeId,
    refreshToken,
  ]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !filteredSnapshot) return;

    const nextNodeIds = new Set(filteredSnapshot.nodes.map((node) => node.id));
    const nextEdgeIds = new Set(filteredSnapshot.edges.map((edge) => edge.id));
    const nodesChanged = !areStringSetsEqual(renderedNodeIdsRef.current, nextNodeIds);
    const layoutModeChanged = renderedLayoutModeRef.current !== layoutMode;

    if (nodesChanged || layoutModeChanged) {
      const previousPositions = new Map(
        cy.nodes().map((node) => [node.id(), { ...node.position() }]),
      );
      cy.elements().remove();
      cy.add(toElements(filteredSnapshot, displayNodeLabel));
      renderedNodeIdsRef.current = nextNodeIds;
      renderedEdgeIdsRef.current = nextEdgeIds;
      renderedLayoutModeRef.current = layoutMode;

      // 旧节点保留坐标；新增节点放在已定位邻居的质心附近，避免整张图重新洗牌。
      for (const node of cy.nodes()) {
        const previous = previousPositions.get(node.id());
        if (previous) node.position(previous);
      }
      if (previousPositions.size > 0 && !layoutModeChanged) {
        const neighbors = new Map<string, Array<{ x: number; y: number }>>();
        for (const edge of filteredSnapshot.edges) {
          const source = cy.$id(edge.source);
          const target = cy.$id(edge.target);
          const sourcePosition = previousPositions.get(edge.source);
          const targetPosition = previousPositions.get(edge.target);
          if (sourcePosition && target.isNode()) {
            const list = neighbors.get(edge.target) ?? [];
            list.push(sourcePosition);
            neighbors.set(edge.target, list);
          }
          if (targetPosition && source.isNode()) {
            const list = neighbors.get(edge.source) ?? [];
            list.push(targetPosition);
            neighbors.set(edge.source, list);
          }
        }
        for (const node of cy.nodes()) {
          if (previousPositions.has(node.id())) continue;
          const list = neighbors.get(node.id());
          if (list?.length) {
            node.position({
              x: list.reduce((sum, item) => sum + item.x, 0) / list.length,
              y: list.reduce((sum, item) => sum + item.y, 0) / list.length,
            });
          }
        }
        // 没有已定位邻居的新节点（例如新导入且暂无语义边）放到外围，避免叠在原点。
        let orphanIndex = 0;
        for (const node of cy.nodes()) {
          if (previousPositions.has(node.id()) || neighbors.get(node.id())?.length) continue;
          const angle = orphanIndex * 2.399963229728653;
          const radius = 120 + 24 * Math.sqrt(orphanIndex + 1);
          node.position({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
          orphanIndex += 1;
        }
        return;
      }

      // 工作区以 hidden 常驻挂载（App.tsx），容器为 0x0 时布局会把所有节点压成一团，
      // 这里推迟到工作区激活（workspaceActive）后再补跑。
      userAdjustedViewRef.current = false;
      if (graphContainerHasSize(containerRef.current)) {
        runGraphLayout(cy, layoutMode);
      } else {
        pendingLayoutRef.current = true;
      }
      return;
    }

    for (const edgeId of renderedEdgeIdsRef.current) {
      if (!nextEdgeIds.has(edgeId)) {
        cy.$id(edgeId).remove();
      }
    }

    for (const edge of filteredSnapshot.edges) {
      if (!renderedEdgeIdsRef.current.has(edge.id)) {
        cy.add({ data: edge });
      } else {
        cy.$id(edge.id).data(edge);
      }
    }

    for (const node of filteredSnapshot.nodes) {
      const element = cy.$id(node.id);
      const label = displayNodeLabel(node);
      element.data({
        ...node,
        label,
        rawLabel: node.label,
        size: node.size ?? 28,
        // 保留当前抽稀结果：原本为空的位置不因本地化切回可见。
        displayLabel: element.data('displayLabel') ? label : '',
      });
    }

    renderedEdgeIdsRef.current = nextEdgeIds;
  }, [displayNodeLabel, filteredSnapshot, layoutMode]);

  // 工作区从 hidden 切换为可见时：同步画布尺寸，补跑被推迟的布局（或重新适配视图）。
  useEffect(() => {
    if (!workspaceActive) return;
    const cy = cyRef.current;
    if (!cy) return;

    cy.resize();
    if (pendingLayoutRef.current) {
      pendingLayoutRef.current = false;
      runGraphLayout(cy, renderedLayoutModeRef.current);
    } else if (cy.nodes().length > 0) {
      cy.fit(undefined, 36);
    }
  }, [workspaceActive]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedEdge) return;

    const edge = cy.$id(selectedEdge.id);
    if (edge.empty()) return;

    cy.elements().removeClass('faded focused');
    cy.elements().unselect();
    edge.select();
    cy.elements().addClass('faded');
    edge.removeClass('faded').addClass('focused');
    edge.connectedNodes().removeClass('faded').addClass('focused');
  }, [selectedEdge]);

  const fitGraph = () => {
    userAdjustedViewRef.current = false;
    cyRef.current?.fit(undefined, 36);
  };

  const zoomGraphBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;

    userAdjustedViewRef.current = true;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };

  const rerunLayout = () => {
    if (cyRef.current) {
      userAdjustedViewRef.current = false;
      runGraphLayout(cyRef.current, layoutMode);
    }
  };

  const focusSelectedAsLocal = () => {
    if (!selectedNode) return;
    setLocalNodeId(selectedNode.id);
    setLayoutMode('local');
  };

  const focusGraphNode = (node: KnowledgeGraphNode) => {
    const cy = cyRef.current;
    if (!cy) return;

    const target = cy.$id(node.id);
    if (target.empty()) return;

    cy.elements().unselect();
    target.select();
    setSelectedNode(node);
    cy.animate({
      center: { eles: target },
      zoom: Math.max(cy.zoom(), 1.05),
      duration: 260,
    });
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportGraphPng = () => {
    const cy = cyRef.current;
    if (!cy) return;

    const blob = cy.png({ output: 'blob', full: true, scale: 2 }) as Blob;
    downloadBlob(blob, `paperquay-knowledge-graph-${Date.now()}.png`);
  };

  const exportGraphJson = () => {
    const graph = filteredSnapshot ?? snapshot;
    if (!graph) return;

    downloadBlob(
      new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' }),
      `paperquay-knowledge-graph-${Date.now()}.json`,
    );
  };

  const syncReferences = async () => {
    setReferenceSyncWorking(true);
    setError('');

    try {
      await fetchAllLibraryReferences(false);
      setRefreshToken((value) => value + 1);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setReferenceSyncWorking(false);
    }
  };

  const applyPerspective = (nextPerspective: GraphPerspective) => {
    setPerspective(nextPerspective);
    setEnabledNodeTypes(perspectiveNodeTypes(nextPerspective));
    setEnabledEdgeTypes(perspectiveEdgeTypes(nextPerspective));
    if (nextPerspective === 'semantic') {
      setLayoutMode('global');
    }
  };

  const toggleNodeType = (type: KnowledgeGraphNodeType) => {
    setEnabledNodeTypes((current) => ({ ...current, [type]: !current[type] }));
  };

  const toggleEdgeType = (type: KnowledgeGraphEdgeType) => {
    setEnabledEdgeTypes((current) => ({ ...current, [type]: !current[type] }));
  };

  const togglePanel = (panel: string) => {
    setCollapsedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  };

  const createRelation = useCallback(async (
    source: KnowledgeGraphNode | null,
    target: KnowledgeGraphNode | null,
    label = relationLabel,
    description = relationDescription,
  ) => {
    if (!source || !target || source.id === target.id) {
      setError(l('请选择两个不同节点。', 'Select two different nodes.'));
      return;
    }

    setRelationWorking(true);
    setError('');

    try {
      const relation = await createKnowledgeGraphRelation({
        source: source.id,
        target: target.id,
        label,
        description,
      });
      const edge: KnowledgeGraphEdge = {
        id: relation.id,
        source: relation.source,
        target: relation.target,
        type: relation.type,
        label: relation.label,
        description: relation.description,
        confidence: relation.confidence,
        weight: relation.weight ?? 0.58,
        createdAt: relation.createdAt,
        updatedAt: relation.updatedAt,
      };

      setSnapshot((current) => current
        ? {
            ...current,
            edges: current.edges.some((item) => item.id === edge.id)
              ? current.edges.map((item) => (item.id === edge.id ? edge : item))
              : [...current.edges, edge],
          }
        : current);
      setSelectedEdge(edge);
      setSelectedNode(null);
      setRelationDescription('');
      setRelationLabel('related');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setRelationWorking(false);
    }
  }, [l, relationDescription, relationLabel]);

  const deleteRelation = async (relationId: string) => {
    setRelationWorking(true);
    setError('');

    try {
      await deleteKnowledgeGraphRelation(relationId);
      setSnapshot((current) => current
        ? {
            ...current,
            edges: current.edges.filter((edge) => edge.id !== relationId),
          }
        : current);
      setSelectedEdge((current) => (current?.id === relationId ? null : current));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setRelationWorking(false);
    }
  };

  useEffect(() => {
    if (selectedEdge?.type !== 'custom_relation') {
      setEdgeEdit(null);
      return;
    }
    setEdgeEdit({
      label: selectedEdge.label ?? '',
      description: selectedEdge.description ?? '',
      weight: Number(selectedEdge.weight) || 0.58,
      working: false,
    });
  }, [selectedEdge?.id]);

  const saveEdgeEdit = async () => {
    if (!selectedEdge || !edgeEdit || selectedEdge.type !== 'custom_relation') return;
    setEdgeEdit((current) => (current ? { ...current, working: true } : current));
    setError('');
    try {
      const updated = await updateKnowledgeGraphRelation(selectedEdge.id, {
        label: edgeEdit.label,
        description: edgeEdit.description,
        weight: edgeEdit.weight,
      });
      const nextEdge: KnowledgeGraphEdge = { ...selectedEdge, ...updated };
      setSnapshot((current) => current
        ? { ...current, edges: current.edges.map((edge) => (edge.id === nextEdge.id ? nextEdge : edge)) }
        : current);
      setSelectedEdge(nextEdge);
      setEdgeEdit({
        label: nextEdge.label,
        description: nextEdge.description ?? '',
        weight: Number(nextEdge.weight) || 0.58,
        working: false,
      });
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
      setEdgeEdit((current) => (current ? { ...current, working: false } : current));
    }
  };

  const startQuickRelation = useCallback((node: KnowledgeGraphNode) => {
    setQuickRelationSourceNode(node);
    setRelationSourceNode(node);
    setSelectedNode(node);
    setSelectedEdge(null);
    setContextMenu(null);
  }, []);

  const cancelQuickRelation = useCallback(() => {
    setQuickRelationSourceNode(null);
  }, []);

  // createRelation 依赖 relationLabel/relationDescription 等输入态，引用会频繁变化。
  // cytoscape 实例只能创建一次，事件回调统一走 ref，避免输入文字时销毁重建整个图谱。
  const createRelationRef = useRef(createRelation);
  useEffect(() => {
    createRelationRef.current = createRelation;
  }, [createRelation]);

  useEffect(() => {
    if (!containerRef.current) return;

    let disconnectResizeObserver: (() => void) | null = null;
    // 主题切换时只换两套不透明 hex；不要从 CSS 变量读 --pq-text，深色值是 rgba()。
    const graphTextColor = () => (
      document.documentElement.classList.contains('dark')
        ? GRAPH_TEXT_COLORS.dark
        : GRAPH_TEXT_COLORS.light
    );
    const resolvedGraphStyles = (): StylesheetJson => {
      const nodeStyle = graphStyles[0] as { selector: string; style: Record<string, unknown> };
      return [
        { ...nodeStyle, style: { ...nodeStyle.style, color: graphTextColor() } },
        ...graphStyles.slice(1),
      ] as StylesheetJson;
    };
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: resolvedGraphStyles(),
      minZoom: 0.08,
      maxZoom: 2.8,
    });
    cyRef.current = cy;
    const themeObserver = new MutationObserver(() => cy.style(resolvedGraphStyles()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

    // 容器尺寸变化（拖拽侧栏、窗口最大化、分屏）时同步画布尺寸；若用户未手动缩放/平移，
    // 同时重新适配视图，否则图谱会停在旧视口位置（最大化后挤在左侧、右侧大片空白）。
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimerRef.current !== null) {
          window.clearTimeout(resizeTimerRef.current);
        }

        resizeTimerRef.current = window.setTimeout(() => {
          resizeTimerRef.current = null;
          const current = cyRef.current;
          if (!current) return;

          current.resize();

          if (!userAdjustedViewRef.current && current.nodes().length > 0) {
            current.fit(undefined, 36);
          }
        }, 180);
      });

      resizeObserver.observe(containerRef.current);
      disconnectResizeObserver = () => resizeObserver.disconnect();
    }

    const markUserAdjustedView = (event: cytoscape.EventObject) => {
      if (event.originalEvent) {
        userAdjustedViewRef.current = true;
      }
    };

    // 放大到阈值后恢复全部标签，缩回时收回；用于替代会影响 fit 包围盒的缩放阈值显隐。
    const syncLabelDensity = () => {
      const showAll = cy.zoom() >= LABEL_ALL_ZOOM;
      if (showAll === labelsExpandedRef.current) return;

      labelsExpandedRef.current = showAll;
      cy.nodes().toggleClass('label-all', showAll);
    };

    cy.on('zoom', markUserAdjustedView);
    cy.on('zoom', syncLabelDensity);
    cy.on('dragpan', markUserAdjustedView);

    cy.on('tap', 'node', (event) => {
      const data = event.target.data() as KnowledgeGraphNode;
      const quickSource = quickRelationSourceRef.current;
      if (quickSource && quickSource.id !== data.id) {
        void createRelationRef.current(quickSource, data).then(() => {
          setQuickRelationSourceNode(null);
        });
        return;
      }

      selectGraphNode(data, event.target);
    });

    cy.on('tap', 'edge', (event) => {
      const data = event.target.data() as KnowledgeGraphEdge;
      selectGraphEdge(data, event.target);
    });

    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelectedNode(null);
        setSelectedEdge(null);
        setContextMenu(null);
        cy.elements().removeClass('faded focused');
      }
    });

    cy.on('dbltap', 'node', (event) => {
      const data = event.target.data() as KnowledgeGraphNode;
      setLocalNodeId(data.id);
      setLayoutMode('local');
    });

    cy.on('cxttap', 'node', (event) => {
      const data = event.target.data() as KnowledgeGraphNode;
      selectGraphNode(data, event.target);
      setContextMenu({
        x: event.renderedPosition.x,
        y: event.renderedPosition.y,
        node: data,
      });
    });

    cy.on('mouseover', 'node', (event) => {
      containerRef.current?.style.setProperty('cursor', 'pointer');
      if (cy.$(':selected').length > 0) return;
      cy.elements().addClass('faded');
      event.target.removeClass('faded').addClass('focused');
      event.target.neighborhood().removeClass('faded').addClass('focused');
    });

    cy.on('mouseout', 'node', () => {
      containerRef.current?.style.setProperty('cursor', 'default');
      if (cy.$(':selected').length > 0) return;
      cy.elements().removeClass('faded focused');
    });

    cy.on('tapdragover', 'node', (event) => {
      containerRef.current?.style.setProperty('cursor', 'grab');
      event.target.addClass('focused');
    });

    cy.on('tapdragout', 'node', (event) => {
      containerRef.current?.style.setProperty('cursor', 'default');
      if (cy.$(':selected').length === 0) event.target.removeClass('focused');
    });

    return () => {
      disconnectResizeObserver?.();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      themeObserver.disconnect();
      // 丢弃还在计算的布局结果并释放 worker。
      disposeGraphLayoutClient();
      cy.destroy();
      cyRef.current = null;
    };
    // selectGraphNode/selectGraphEdge 依赖均为空、引用稳定；createRelation 走 createRelationRef。
  }, [selectGraphEdge, selectGraphNode]);

  const nodeCount = filteredSnapshot?.nodes.length ?? 0;
  const edgeCount = filteredSnapshot?.edges.length ?? 0;
  // S5-GRAPH-2：后端在超过节点/边预算时会抽样，并把统计放进 snapshot.metadata。
  const snapshotMetadata = useMemo(
    () => (snapshot ? readSnapshotMetadata(snapshot) : null),
    [snapshot],
  );
  const samplingSummary = useMemo(
    () => formatGraphSamplingSummary(snapshotMetadata, isEnglish ? 'en' : 'zh'),
    [isEnglish, snapshotMetadata],
  );
  const enabledNodeTypeCount = visibleNodeTypes.filter((item) => enabledNodeTypes[item.type]).length;
  const enabledEdgeTypeCount = visibleEdgeTypes.filter((item) => enabledEdgeTypes[item.type]).length;
  const canOpenSelectedNode =
    Boolean(selectedNode?.type === 'paper' && selectedNode.paperId) ||
    Boolean(selectedNode?.type === 'note' && selectedNode.noteId);
  const selectedEdgeSource = selectedEdge ? nodeById.get(selectedEdge.source) : null;
  const selectedEdgeTarget = selectedEdge ? nodeById.get(selectedEdge.target) : null;
  const canDeleteSelectedEdge = selectedEdge?.type === 'custom_relation';
  const normalizedRelationTargetSearch = relationTargetSearch.trim().toLowerCase();
  const relationTargetOptions = (filteredSnapshot?.nodes ?? [])
    .filter((node) =>
      node.id !== relationSourceNode?.id &&
      (node.type === 'paper' || node.type === 'note'),
    )
    .filter((node) => {
      if (!normalizedRelationTargetSearch) return true;
      return [displayNodeLabel(node), node.subtitle, node.id]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
        .includes(normalizedRelationTargetSearch);
    })
    .slice(0, 50);

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)]">
      <aside className="flex w-[292px] shrink-0 flex-col border-r border-[var(--pq-border)] bg-[var(--pq-surface-1)]">
        <div className="border-b border-[var(--pq-border)] p-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]">
              <Network className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--pq-text)]">
                {l('知识图谱', 'Knowledge Graph')}
              </div>
              <div className="text-[11px] text-[var(--pq-text-muted)]">
                {compactNumber(nodeCount)} {l('节点', 'nodes')} · {compactNumber(edgeCount)} {l('关系', 'edges')}
              </div>
              {samplingSummary ? (
                <div className="truncate text-[10px] font-medium text-[var(--pq-text-faint)]" title={samplingSummary}>
                  {samplingSummary}
                </div>
              ) : null}
            </div>
          </div>

          <label className="mt-3 flex h-9 items-center gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--pq-text-muted)]" strokeWidth={1.8} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={l('搜索文献、笔记、标签', 'Search papers, notes, tags')}
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]"
            />
          </label>

          <div className="mt-3">
            <div className="mb-1.5 text-xs font-semibold text-[var(--pq-text)]">
              {l('图谱视角', 'Graph Perspective')}
            </div>
            <select
              aria-label={l('图谱视角', 'Graph perspective')}
              value={perspective}
              onChange={(event) => applyPerspective(event.target.value as GraphPerspective)}
              className="h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)] outline-none"
            >
              {graphPerspectives.map((item) => (
                <option key={item.id} value={item.id}>
                  {isEnglish ? item.en : item.zh}
                </option>
              ))}
            </select>
            <div className="mt-1.5 text-[11px] leading-5 text-[var(--pq-text-faint)]">
              {isEnglish ? activePerspective.descriptionEn : activePerspective.descriptionZh}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="grid grid-cols-2 gap-1 rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] p-1">
            {(['global', 'local'] as LayoutMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLayoutMode(mode)}
                className={cn(
                  'h-8 rounded-[var(--pq-radius-sm)] text-xs font-medium transition',
                  layoutMode === mode
                    ? 'bg-[var(--pq-surface)] text-[var(--pq-text)] shadow-[var(--pq-shadow-soft)]'
                    : 'text-[var(--pq-text-muted)] hover:text-[var(--pq-text)]',
                )}
              >
                {mode === 'global' ? l('全局', 'Global') : l('局部', 'Local')}
              </button>
            ))}
          </div>

          {layoutMode === 'local' ? (
            <CollapsiblePanel
              title={l('局部深度', 'Local Depth')}
              summary={localDepth}
              collapsed={collapsedPanels.localDepth}
              onToggle={() => togglePanel('localDepth')}
            >
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--pq-text)]">
                <span>{l('局部深度', 'Local Depth')}</span>
                <span className="text-[var(--pq-text-muted)]">{localDepth}</span>
              </div>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={localDepth}
                onChange={(event) => setLocalDepth(Number(event.target.value))}
                className="w-full accent-[var(--pq-accent)]"
              />
              <div className="mt-2 text-[11px] leading-5 text-[var(--pq-text-faint)]">
                {localNodeId
                  ? l('双击节点或点击详情卡按钮可更换局部中心。', 'Double-click a node or use the detail card to change the local center.')
                  : l('先选择一个节点作为局部中心。', 'Select a node as the local center first.')}
              </div>
            </CollapsiblePanel>
          ) : null}

          <CollapsiblePanel
            title={l('节点类型', 'Node Types')}
            summary={`${enabledNodeTypeCount}/${visibleNodeTypes.length}`}
            collapsed={collapsedPanels.nodeTypes}
            onToggle={() => togglePanel('nodeTypes')}
          >
            <div className="mb-2 text-xs font-semibold text-[var(--pq-text)]">
              {l('节点类型', 'Node Types')}
            </div>
            <div className="space-y-1.5">
              {visibleNodeTypes.map((item) => {
                const Icon = item.icon;
                return (
                  <label
                    key={item.type}
                    className="flex h-8 cursor-default items-center gap-2 rounded-[var(--pq-radius-sm)] px-2 text-xs text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)]"
                  >
                    <input
                      type="checkbox"
                      checked={enabledNodeTypes[item.type]}
                      onChange={() => toggleNodeType(item.type)}
                      className="h-3.5 w-3.5 accent-[var(--pq-accent)]"
                    />
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                    <span>{isEnglish ? item.en : item.zh}</span>
                  </label>
                );
              })}
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title={l('关系类型', 'Edge Types')}
            summary={`${enabledEdgeTypeCount}/${visibleEdgeTypes.length}`}
            collapsed={collapsedPanels.edgeTypes}
            onToggle={() => togglePanel('edgeTypes')}
          >
            <div className="mb-2 text-xs font-semibold text-[var(--pq-text)]">
              {l('关系类型', 'Edge Types')}
            </div>
            <div className="space-y-1.5">
              {visibleEdgeTypes.map((item) => (
                <label
                  key={item.type}
                  className="flex h-8 cursor-default items-center gap-2 rounded-[var(--pq-radius-sm)] px-2 text-xs text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)]"
                >
                  <input
                    type="checkbox"
                    checked={enabledEdgeTypes[item.type]}
                    onChange={() => toggleEdgeType(item.type)}
                    className="h-3.5 w-3.5 accent-[var(--pq-accent)]"
                  />
                  <span
                    className="h-2 w-5 rounded-full"
                    style={{ backgroundColor: EDGE_COLORS[item.type] }}
                  />
                  <span>{isEnglish ? item.en : item.zh}</span>
                </label>
              ))}
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title={l('语义邻居数', 'Semantic Neighbors')}
            summary={String(embeddingNeighbors)}
            collapsed={collapsedPanels.embedding}
            onToggle={() => togglePanel('embedding')}
          >
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--pq-text)]">
              <span>{l('每篇保留的语义邻居数', 'Neighbors per paper')}</span>
              <span className="text-[var(--pq-text-muted)]">{embeddingNeighbors}</span>
            </div>
            <input
              type="range"
              min={3}
              max={20}
              step={1}
              value={embeddingNeighbors}
              onChange={(event) => setEmbeddingNeighbors(Number(event.target.value))}
              className="w-full accent-[var(--pq-accent)]"
            />
            <p className="mt-1 text-[11px] leading-4 text-[var(--pq-text-muted)]">
              {l('互近邻会限制每篇的度数；断开的主题会被自动桥接。', 'Mutual neighbors cap each paper’s degree; disconnected topics are bridged automatically.')}
            </p>
          </CollapsiblePanel>

          <CollapsiblePanel
            title={l('自定义关系', 'Custom Relations')}
            icon={<Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
            summary={relationSourceNode ? l('已选起点', 'Source set') : undefined}
            collapsed={collapsedPanels.customRelations}
            onToggle={() => togglePanel('customRelations')}
          >
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--pq-text)]">
              <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              {l('自定义关系', 'Custom Relations')}
            </div>
            <div className="space-y-2">
              <button
                type="button"
                disabled={!selectedNode}
                onClick={() => {
                  if (!selectedNode) return;
                  setRelationSourceNode(selectedNode);
                  setRelationTargetNode((current) => (current?.id === selectedNode.id ? null : current));
                }}
                className="pq-button h-8 w-full justify-center px-2 text-xs disabled:opacity-40"
              >
                {relationSourceNode
                  ? l(`起点：${displayNodeLabel(relationSourceNode)}`, `Source: ${displayNodeLabel(relationSourceNode)}`)
                  : l('将选中节点设为起点', 'Use selected node as source')}
              </button>
              <div className="space-y-1">
                <input
                  value={relationTargetSearch}
                  onChange={(event) => setRelationTargetSearch(event.target.value)}
                  placeholder={l('搜索终点节点', 'Search target node')}
                  className="h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)] outline-none"
                />
                <div className="max-h-36 overflow-auto rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)]">
                  {relationTargetOptions.length > 0 ? relationTargetOptions.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        selectGraphNode(node);
                        if (relationSourceNode && relationSourceNode.id !== node.id) {
                          setRelationTargetNode(node);
                        }
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-[var(--pq-bg-secondary)]',
                        selectedNode?.id === node.id ? 'text-[var(--pq-accent)]' : 'text-[var(--pq-text-muted)]',
                      )}
                    >
                      <span className="min-w-0 truncate">{displayNodeLabel(node)}</span>
                      <span className="shrink-0 text-[11px] uppercase text-[var(--pq-text-faint)]">{node.type}</span>
                    </button>
                  )) : (
                    <div className="px-2 py-2 text-[11px] text-[var(--pq-text-faint)]">
                      {l('没有匹配节点', 'No matching nodes')}
                    </div>
                  )}
                </div>
              </div>
              <input
                value={relationLabel}
                onChange={(event) => setRelationLabel(event.target.value)}
                placeholder={l('关系名，例如：方法相似', 'Relation label, e.g. similar method')}
                className="h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)] outline-none"
              />
              <textarea
                value={relationDescription}
                onChange={(event) => setRelationDescription(event.target.value)}
                placeholder={l('可选说明', 'Optional description')}
                className="min-h-16 w-full resize-none rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 py-2 text-xs leading-5 text-[var(--pq-text)] outline-none"
              />
              <button
                type="button"
                disabled={relationWorking || !relationSourceNode || !relationTargetNode
                  || relationSourceNode.id === relationTargetNode.id}
                onClick={() => {
                  void createRelation(relationSourceNode, relationTargetNode).then(() => {
                    setRelationTargetNode(null);
                    setRelationSourceNode(null);
                  });
                }}
                className="pq-button h-8 w-full justify-center px-2 text-xs disabled:opacity-40"
              >
                {relationWorking
                  ? l('保存中...', 'Saving...')
                  : relationTargetNode
                    ? l(`添加关系：${displayNodeLabel(relationTargetNode)}`, `Add relation to ${displayNodeLabel(relationTargetNode)}`)
                    : l('先选择终点节点', 'Choose a target node first')}
              </button>
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title={l('图谱统计', 'Graph Stats')}
            summary={`${nodeCount}/${edgeCount}`}
            collapsed={collapsedPanels.graphStats}
            onToggle={() => togglePanel('graphStats')}
          >
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--pq-text)]">
              <span>{l('图谱统计', 'Graph Stats')}</span>
              <span className="text-[var(--pq-text-muted)]">{nodeCount}/{edgeCount}</span>
            </div>
            {snapshot?.metadata?.graphQuality ? (
              <div className="mb-2 space-y-1 rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-2)] p-2 text-[11px] leading-5 text-[var(--pq-text-muted)]">
                <div>
                  {l(
                    `语义覆盖 ${snapshot.metadata.graphQuality.semanticCoverage.indexed}/${snapshot.metadata.graphQuality.semanticCoverage.total} · 分量 ${snapshot.metadata.graphQuality.componentCount} · 最大度数 ${snapshot.metadata.graphQuality.degreeMax}`,
                    `Semantic coverage ${snapshot.metadata.graphQuality.semanticCoverage.indexed}/${snapshot.metadata.graphQuality.semanticCoverage.total} · components ${snapshot.metadata.graphQuality.componentCount} · max degree ${snapshot.metadata.graphQuality.degreeMax}`,
                  )}
                </div>
                {snapshot.metadata.graphQuality.isolatedCount > 0 ? (
                  <div className="text-[var(--pq-warning)]">
                    {l(`有 ${snapshot.metadata.graphQuality.isolatedCount} 个孤立节点`, `${snapshot.metadata.graphQuality.isolatedCount} isolated nodes`)}
                  </div>
                ) : null}
                {snapshot.metadata.graphQuality.hubnessSkew > 1.4 ? (
                  <div className="text-[var(--pq-warning)]">
                    {l('语义边仍集中在少数 hub，可降低邻居数或检查索引质量。', 'Semantic edges still concentrate on a few hubs; lower K or check index quality.')}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-1">
              {graphStats.topNodes.length > 0 ? graphStats.topNodes.map((item, index) => (
                <button
                  key={item.node.id}
                  type="button"
                  onClick={() => focusGraphNode(item.node)}
                  className="flex w-full items-center gap-2 rounded-[var(--pq-radius-sm)] px-2 py-1.5 text-left text-[11px] text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)] hover:text-[var(--pq-text)]"
                >
                  <span className="w-4 shrink-0 text-[var(--pq-text-faint)]">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{displayNodeLabel(item.node)}</span>
                  <span className="shrink-0 rounded bg-[var(--pq-bg-secondary)] px-1.5 py-0.5 text-[11px]">
                    {item.degree}
                  </span>
                </button>
              )) : (
                <div className="text-[11px] leading-5 text-[var(--pq-text-faint)]">
                  {l('暂无中心节点排名。', 'No centrality ranking yet.')}
                </div>
              )}
            </div>
          </CollapsiblePanel>

        </div>

        <div className="border-t border-[var(--pq-border)] p-3">
          <div className="grid grid-cols-6 gap-2">
            <button type="button" onClick={rerunLayout} className="pq-button h-8 px-2 text-xs" title={l('重新布局', 'Re-layout')}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={fitGraph} className="pq-button h-8 px-2 text-xs" title={l('适配视图', 'Fit view')}>
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={focusSelectedAsLocal}
              disabled={!selectedNode}
              className="pq-button h-8 px-2 text-xs disabled:opacity-40"
              title={l('设为局部中心', 'Use as local center')}
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={exportGraphPng} className="pq-button h-8 px-2 text-xs" title={l('导出 PNG', 'Export PNG')}>
              <Download className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={exportGraphJson} className="pq-button h-8 px-2 text-xs" title={l('导出 JSON', 'Export JSON')}>
              <FileJson2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void syncReferences()}
              disabled={referenceSyncWorking}
              className="pq-button h-8 px-2 text-xs disabled:opacity-40"
              title={l('同步参考文献', 'Sync references')}
            >
              {referenceSyncWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            </button>
          </div>
          {referenceSyncProgress ? (
            <div className="mt-2 truncate text-[11px] text-[var(--pq-text-muted)]">
              {l(
                `参考文献 ${referenceSyncProgress.current}/${referenceSyncProgress.total}，成功 ${referenceSyncProgress.fetched}，跳过 ${referenceSyncProgress.skipped}，失败 ${referenceSyncProgress.failed}`,
                `References ${referenceSyncProgress.current}/${referenceSyncProgress.total}, fetched ${referenceSyncProgress.fetched}, skipped ${referenceSyncProgress.skipped}, failed ${referenceSyncProgress.failed}`,
              )}
            </div>
          ) : null}
        </div>
      </aside>

      <section className="relative min-w-0 flex-1 bg-[radial-gradient(circle_at_1px_1px,var(--pq-border)_1px,transparent_0)] [background-size:22px_22px]">
        <div ref={containerRef} className="h-full w-full" />

        <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-1 shadow-[var(--pq-shadow-float)]">
            <button
              type="button"
              onClick={() => zoomGraphBy(1 / 1.25)}
              className="pq-icon-button h-7 w-7"
              title={l('缩小', 'Zoom out')}
              aria-label={l('缩小', 'Zoom out')}
            >
              <Minus className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => zoomGraphBy(1.25)}
              className="pq-icon-button h-7 w-7"
              title={l('放大', 'Zoom in')}
              aria-label={l('放大', 'Zoom in')}
            >
              <Plus className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={fitGraph}
              className="pq-icon-button h-7 w-7"
              title={l('适配视图', 'Fit view')}
              aria-label={l('适配视图', 'Fit view')}
            >
              <Maximize2 className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
          <div className="pointer-events-auto flex max-w-[220px] flex-wrap justify-end gap-x-3 gap-y-1 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2.5 py-1.5 text-[11px] text-[var(--pq-text-muted)] shadow-[var(--pq-shadow-soft)]">
            {[
              { type: 'paper', label: l('文献', 'Papers') },
              { type: 'note', label: l('笔记', 'Notes') },
              { type: 'tag', label: l('标签', 'Tags') },
              { type: 'category', label: l('分类', 'Categories') },
            ].map((item) => (
              <span key={item.type} className="inline-flex items-center gap-1 whitespace-nowrap">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: NODE_COLORS[item.type] }}
                />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {quickRelationSourceNode ? (
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-accent-border)] bg-[var(--pq-surface)] px-3 py-2 text-xs text-[var(--pq-text)] shadow-[var(--pq-shadow-float)]">
            <Link2 className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.8} />
            <span className="max-w-[360px] truncate">
              {l(`已选择起点：${displayNodeLabel(quickRelationSourceNode)}。点击另一个节点添加连接。`, `Source: ${displayNodeLabel(quickRelationSourceNode)}. Click another node to add a relation.`)}
            </span>
            <button
              type="button"
              onClick={cancelQuickRelation}
              className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)] hover:text-[var(--pq-text)]"
            >
              {l('取消', 'Cancel')}
            </button>
          </div>
        ) : null}

        {contextMenu ? (
          <div
            className="absolute z-20 w-44 overflow-hidden rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] py-1 text-xs shadow-[var(--pq-shadow-float)]"
            style={{
              left: Math.min(contextMenu.x + 8, Math.max(8, (containerRef.current?.clientWidth ?? 220) - 188)),
              top: Math.min(contextMenu.y + 8, Math.max(8, (containerRef.current?.clientHeight ?? 220) - 180)),
            }}
          >
            <button
              type="button"
              disabled={!(contextMenu.node.type === 'paper' || contextMenu.node.type === 'note')}
              onClick={() => {
                const node = contextMenu.node;
                setContextMenu(null);
                void openGraphNode(node).catch(console.error);
              }}
              className="flex h-8 w-full items-center gap-2 px-3 text-left text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)] hover:text-[var(--pq-text)] disabled:opacity-40"
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
              {l('打开', 'Open')}
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalNodeId(contextMenu.node.id);
                setLayoutMode('local');
                setContextMenu(null);
              }}
              className="flex h-8 w-full items-center gap-2 px-3 text-left text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)] hover:text-[var(--pq-text)]"
            >
              <Crosshair className="h-3.5 w-3.5" strokeWidth={1.8} />
              {l('设为局部中心', 'Use as local center')}
            </button>
            <button
              type="button"
              onClick={() => startQuickRelation(contextMenu.node)}
              className="flex h-8 w-full items-center gap-2 px-3 text-left text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)] hover:text-[var(--pq-text)]"
            >
              <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              {l('从此节点添加连接', 'Add relation from here')}
            </button>
            <button
              type="button"
              onClick={() => {
                setRelationSourceNode(contextMenu.node);
                setCollapsedPanels((current) => ({ ...current, customRelations: false }));
                setContextMenu(null);
              }}
              className="flex h-8 w-full items-center gap-2 px-3 text-left text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)] hover:text-[var(--pq-text)]"
            >
              <GitBranch className="h-3.5 w-3.5" strokeWidth={1.8} />
              {l('设为关系起点', 'Set relation source')}
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--pq-surface)]/70 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-3 py-2 text-xs text-[var(--pq-text-muted)] shadow-[var(--pq-shadow-float)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {l('正在构建图谱...', 'Building graph...')}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="absolute left-4 top-4 flex max-w-md items-start gap-2 rounded-[var(--pq-radius-sm)] border border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-error-bg)] px-3 py-2 text-xs leading-5 text-[var(--pq-danger)] shadow-[var(--pq-shadow-float)]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {!loading && !error && nodeCount === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-[var(--pq-radius-sm)] border border-dashed border-[var(--pq-border)] bg-[var(--pq-surface)] px-4 py-8 text-center text-xs leading-5 text-[var(--pq-text-muted)]">
              {l('暂无可显示的图谱节点。导入文献、创建笔记或完成 RAG 索引后再试。', 'No graph nodes yet. Import papers, create notes, or build RAG indexes first.')}
            </div>
          </div>
        ) : null}

        {selectedNode ? (
          <div className="absolute bottom-4 right-4 w-[320px] rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-3 shadow-[var(--pq-shadow-float)]">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[var(--pq-accent-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--pq-accent)]">
                {selectedNode.type}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--pq-text)]">
                {displayNodeLabel(selectedNode)}
              </span>
            </div>
            {selectedNode.subtitle ? (
              <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--pq-text-muted)]">
                {selectedNode.subtitle}
              </p>
            ) : null}
            <div className="mt-2 text-[11px] leading-5 text-[var(--pq-text-faint)]">
              {selectedNode.type === 'paper'
                ? l('文献节点可直接打开阅读，也可作为局部图谱中心。', 'Paper nodes can be opened in the reader or used as a local graph center.')
                : selectedNode.type === 'note'
                  ? l('笔记节点可直接打开编辑，也可作为局部图谱中心。', 'Note nodes can be opened for editing or used as a local graph center.')
                  : selectedNode.type === 'reference'
                    ? l('参考文献节点来自解析到的引用列表；入库后会自动合并为文献节点。', 'Reference nodes come from parsed bibliographies; they merge into paper nodes once imported.')
                    : l('标签和分类节点适合用于观察主题聚合关系。', 'Tag and collection nodes help inspect thematic clusters.')}
            </div>
            {selectedNode.doi ? (
              <div className="mt-2 truncate rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] px-2 py-1 text-[11px] text-[var(--pq-text-muted)]">
                DOI: {selectedNode.doi}
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={!canOpenSelectedNode}
                onClick={() => selectedNode && void openGraphNode(selectedNode).catch(console.error)}
                className="pq-button h-8 px-3 text-xs disabled:opacity-40"
              >
                {l('打开', 'Open')}
              </button>
              <button
                type="button"
                onClick={focusSelectedAsLocal}
                className="pq-button h-8 px-3 text-xs"
              >
                {l('局部图谱', 'Local Graph')}
              </button>
              <button
                type="button"
                onClick={() => startQuickRelation(selectedNode)}
                className="pq-button h-8 px-3 text-xs"
              >
                {l('设为关系起点', 'Set Source')}
              </button>
            </div>
            {selectedCustomEdges.length > 0 ? (
              <div className="mt-3 border-t border-[var(--pq-border)] pt-2">
                <div className="mb-1.5 text-[11px] font-semibold text-[var(--pq-text)]">
                  {l('人工/AI 关系', 'Manual / AI Relations')}
                </div>
                <div className="max-h-36 space-y-1 overflow-auto pr-1">
                  {selectedCustomEdges.map((edge) => {
                    const otherNode = nodeById.get(edge.source === selectedNode.id ? edge.target : edge.source);
                    return (
                      <div key={edge.id} className="flex items-center gap-2 rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] px-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium text-[var(--pq-text)]">
                            {edge.label} {'->'} {otherNode ? displayNodeLabel(otherNode) : edge.target}
                          </div>
                          {edge.description ? (
                            <div className="truncate text-[11px] text-[var(--pq-text-faint)]">
                              {edge.description}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteRelation(edge.id)}
                          className="pq-icon-button h-6 w-6"
                          title={l('删除关系', 'Delete relation')}
                          aria-label={l('删除关系', 'Delete relation')}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedEdge ? (
          <div className="absolute bottom-4 right-4 w-[320px] rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-3 shadow-[var(--pq-shadow-float)]">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-7 shrink-0 rounded-full"
                style={{ backgroundColor: EDGE_COLORS[selectedEdge.type] }}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--pq-text)]">
                {selectedEdge.label || selectedEdge.type}
              </span>
              <span className="shrink-0 rounded-md bg-[var(--pq-bg-secondary)] px-1.5 py-0.5 text-[11px] uppercase text-[var(--pq-text-faint)]">
                {selectedEdge.type}
              </span>
            </div>
            <div className="mt-3 space-y-1.5 text-xs text-[var(--pq-text-muted)]">
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[var(--pq-text-faint)]">{l('起点', 'From')}</span>
                <span className="min-w-0 truncate text-[var(--pq-text)]">{selectedEdgeSource ? displayNodeLabel(selectedEdgeSource) : selectedEdge.source}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[var(--pq-text-faint)]">{l('终点', 'To')}</span>
                <span className="min-w-0 truncate text-[var(--pq-text)]">{selectedEdgeTarget ? displayNodeLabel(selectedEdgeTarget) : selectedEdge.target}</span>
              </div>
            </div>
            {edgeEdit ? (
              <div className="mt-3 space-y-2">
                <input
                  value={edgeEdit.label}
                  maxLength={80}
                  onChange={(event) => setEdgeEdit({ ...edgeEdit, label: event.target.value })}
                  placeholder={l('关系名（最多 80 字）', 'Relation label (max 80 chars)')}
                  className="h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)] outline-none"
                />
                <textarea
                  value={edgeEdit.description}
                  maxLength={2000}
                  onChange={(event) => setEdgeEdit({ ...edgeEdit, description: event.target.value })}
                  placeholder={l('说明（最多 2000 字）', 'Description (max 2000 chars)')}
                  className="min-h-14 w-full resize-none rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 py-2 text-xs leading-5 text-[var(--pq-text)] outline-none"
                />
                <label className="flex items-center gap-2 text-xs text-[var(--pq-text-muted)]">
                  {l('权重', 'Weight')}
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={edgeEdit.weight}
                    onChange={(event) => setEdgeEdit({ ...edgeEdit, weight: Number(event.target.value) })}
                    className="flex-1 accent-[var(--pq-accent)]"
                  />
                  <span className="w-10 text-right tabular-nums text-[var(--pq-text)]">{edgeEdit.weight.toFixed(2)}</span>
                </label>
                <button
                  type="button"
                  disabled={edgeEdit.working || !edgeEdit.label.trim()}
                  onClick={() => void saveEdgeEdit()}
                  className="pq-button h-8 w-full justify-center px-3 text-xs disabled:opacity-40"
                >
                  {edgeEdit.working ? l('保存中...', 'Saving...') : l('保存关系修改', 'Save relation changes')}
                </button>
              </div>
            ) : selectedEdge.description ? (
              <p className="mt-3 line-clamp-4 rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] px-2 py-2 text-xs leading-5 text-[var(--pq-text-muted)]">
                {selectedEdge.description}
              </p>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              {selectedEdgeSource ? (
                <button
                  type="button"
                  onClick={() => focusGraphNode(selectedEdgeSource)}
                  className="pq-button h-8 px-3 text-xs"
                >
                  {l('定位起点', 'Focus From')}
                </button>
              ) : null}
              {selectedEdgeTarget ? (
                <button
                  type="button"
                  onClick={() => focusGraphNode(selectedEdgeTarget)}
                  className="pq-button h-8 px-3 text-xs"
                >
                  {l('定位终点', 'Focus To')}
                </button>
              ) : null}
              {canDeleteSelectedEdge ? (
                <button
                  type="button"
                  onClick={() => {
                    const edgeId = selectedEdge.id;
                    setSelectedEdge(null);
                    void deleteRelation(edgeId);
                  }}
                  className="pq-button h-8 px-3 text-xs text-[var(--pq-danger)]"
                >
                  {l('删除', 'Delete')}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
