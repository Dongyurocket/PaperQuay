import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import {
  CircleAlert,
  Crosshair,
  FileText,
  GitBranch,
  Link2,
  Loader2,
} from 'lucide-react';
import {
  consumePendingGraphFocus,
  emitOpenLibraryPaper,
  NOTE_CHANGED_EVENT,
  OPEN_GRAPH_FOCUS_EVENT,
  type OpenGraphFocusEventDetail,
} from '../../app/appEvents';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import { noteDisplayTitle } from '../notes/notesDisplay';
import {
  createKnowledgeGraphRelation,
  updateKnowledgeGraphRelation,
  deleteKnowledgeGraphRelation,
  getKnowledgeGraph,
  invalidateKnowledgeGraphCache,
} from '../../services/knowledgeGraph';
import {
  fetchAllLibraryReferences,
  listenLibraryReferenceProgress,
} from '../../services/library';
import { RAG_INDEX_STATUS_UPDATED_EVENT } from '../../services/ragIndexStatus.ts';
import {
  LIBRARY_READING_UPDATED_EVENT,
  NATIVE_PAPER_UPDATED_EVENT,
} from '../literature/libraryEvents.ts';
import { useTabsStore } from '../../stores/useTabsStore';
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeType,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
  KnowledgeGraphSnapshot,
} from '../../types/knowledgeGraph';
import type { LibraryReferenceProgress } from '../../types/library';
import { perfMark, perfMeasure } from '../../utils/perfTrace.ts';
import {
  aggregateGraphByCategory,
  buildGraphElements,
  computeDegreeByNode,
  computeGraphSignature,
  matchGraphNodeIds,
  resolveLodRatio,
  selectLodVisibleEdgeIds,
  type GraphColorMode,
} from './graphPresentation.ts';
import { buildGraphStyles, degradeStylesForWebgl, resolveGraphTheme } from './graphStyles.ts';
import {
  applyStoredPositions,
  disposeGraphLayoutClient,
  graphContainerHasSize,
  persistGraphPositions,
  runGraphLayout,
  type LayoutMode,
} from './graphLayout.ts';
import { attachGraphEvents, type GraphEventHandlers, type GraphHoverPayload } from './graphEvents.ts';
import {
  DEFAULT_GRAPH_PREFERENCES,
  loadGraphPreferences,
  saveGraphPreferences,
  type GraphPreferences,
} from './graphPreferences.ts';
import { DEFAULT_GRAPH_FORCES } from './graphLayoutMessages.ts';
import { formatGraphSamplingSummary, readSnapshotMetadata } from './knowledgeGraphMeta.ts';
import {
  GRAPH_EDGE_TYPE_OPTIONS,
  GRAPH_NODE_TYPE_OPTIONS,
  GraphSidebar,
  type GraphEdgeTypeOption,
  type GraphNodeTypeOption,
  type GraphPerfStats,
  type GraphPerspective,
  type GraphViewMode,
} from './GraphSidebar.tsx';
import { GraphInspector, type GraphEdgeEditState } from './GraphInspector.tsx';
import { GraphToolbar } from './GraphToolbar.tsx';
import { GraphTooltip } from './GraphTooltip.tsx';

type GraphContextMenuState = {
  x: number;
  y: number;
  node: KnowledgeGraphNode;
} | null;

const GRAPH_PERSPECTIVES = [
  {
    id: 'mixed' as GraphPerspective,
    zh: '混合图谱',
    en: 'Mixed',
    descriptionZh: '文献、笔记、标签、分类和引用一起探索。',
    descriptionEn: 'Explore papers, notes, tags, collections, and references together.',
  },
  {
    id: 'paper' as GraphPerspective,
    zh: '单论文网络',
    en: 'Paper',
    descriptionZh: '突出论文之间的引用和语义关系；标签/分类只用于着色。',
    descriptionEn: 'Emphasize citation and semantic relations; tags/collections only color the graph.',
  },
  {
    id: 'note' as GraphPerspective,
    zh: '笔记网络',
    en: 'Notes',
    descriptionZh: '突出笔记双链、笔记引用文献和笔记标签。',
    descriptionEn: 'Emphasize note links, note-paper anchors, and note tags.',
  },
  {
    id: 'reference' as GraphPerspective,
    zh: '参考文献',
    en: 'Citations',
    descriptionZh: '查看文献互引和未入库参考文献。',
    descriptionEn: 'Inspect citation links between papers already in the library.',
  },
  {
    id: 'semantic' as GraphPerspective,
    zh: '语义相似',
    en: 'Semantic',
    descriptionZh: '突出 sqlite-vec/RAG 自动生成的相似文献边。',
    descriptionEn: 'Focus on sqlite-vec/RAG embedding similarity edges.',
  },
  {
    id: 'custom' as GraphPerspective,
    zh: '自定义/AI',
    en: 'Custom/AI',
    descriptionZh: '查看人工添加和 AI 建议后确认的关系。',
    descriptionEn: 'Inspect manually added and approved AI-suggested relations.',
  },
];

const VISIBLE_NODE_TYPES = GRAPH_NODE_TYPE_OPTIONS.filter((item) => item.type !== 'reference');
const VISIBLE_EDGE_TYPES = GRAPH_EDGE_TYPE_OPTIONS.filter((item) => item.type !== 'paper_reference');

const MAX_BACKEND_NODES = 3000;
const MAX_BACKEND_EDGES_PER_NODE = 60;
const AUTO_REFRESH_DEBOUNCE_MS = 800;

function perspectiveNodeTypes(perspective: GraphPerspective): Record<KnowledgeGraphNodeType, boolean> {
  const all = { paper: true, note: true, tag: true, category: true, reference: true };
  if (perspective === 'paper') return { ...all, note: false, reference: false, tag: false, category: false };
  if (perspective === 'note') return { ...all, category: false, reference: false };
  if (perspective === 'reference') return { ...all, note: false, tag: false, category: false };
  if (perspective === 'semantic') return { paper: true, note: false, tag: false, category: false, reference: false };
  if (perspective === 'custom') return { paper: true, note: true, tag: false, category: false, reference: false };
  return all;
}

function perspectiveEdgeTypes(perspective: GraphPerspective): Record<KnowledgeGraphEdgeType, boolean> {
  const all: Record<KnowledgeGraphEdgeType, boolean> = {
    related_by_embedding: true,
    note_paper: true,
    note_link: true,
    paper_tag: true,
    note_tag: true,
    paper_category: true,
    paper_cites_paper: true,
    paper_reference: true,
    co_author: false,
    custom_relation: false,
  };
  if (perspective === 'paper') {
    return { ...all, note_paper: false, note_link: false, note_tag: false, paper_reference: false, paper_tag: false, paper_category: false, co_author: false };
  }
  if (perspective === 'note') {
    return { ...all, related_by_embedding: false, paper_tag: false, paper_category: false, paper_cites_paper: false, paper_reference: false, co_author: false };
  }
  if (perspective === 'reference') {
    return { ...all, related_by_embedding: false, note_paper: false, note_link: false, paper_tag: false, note_tag: false, paper_category: false, co_author: false, custom_relation: false };
  }
  if (perspective === 'semantic') {
    return { related_by_embedding: true, note_paper: false, note_link: false, paper_tag: false, note_tag: false, paper_category: false, paper_cites_paper: false, paper_reference: false, co_author: false, custom_relation: false };
  }
  if (perspective === 'custom') {
    return { related_by_embedding: false, note_paper: false, note_link: false, paper_tag: false, note_tag: false, paper_category: false, paper_cites_paper: false, paper_reference: false, co_author: false, custom_relation: true };
  }
  return all;
}

function edgeTypeLabel(type: KnowledgeGraphEdgeType, isEnglish: boolean): string {
  const item = GRAPH_EDGE_TYPE_OPTIONS.find((entry) => entry.type === type);
  return item ? (isEnglish ? item.en : item.zh) : type;
}

function ragStatusLabel(status: KnowledgeGraphNode['ragStatus'], isEnglish: boolean): string {
  switch (status) {
    case 'ready': return isEnglish ? 'Indexed' : '已索引';
    case 'stale': return isEnglish ? 'Outdated' : '待更新';
    case 'pending': return isEnglish ? 'Pending' : '待索引';
    case 'failed': return isEnglish ? 'Failed' : '失败';
    case 'none': return isEnglish ? 'Not indexed' : '未建立';
    case 'excluded': return isEnglish ? 'Excluded' : '已排除';
    default: return isEnglish ? 'Unknown' : '未知';
  }
}

function defaultColorByForPerspective(perspective: GraphPerspective): GraphColorMode {
  if (perspective === 'paper' || perspective === 'semantic' || perspective === 'custom') return 'category';
  if (perspective === 'reference') return 'year';
  return 'type';
}

function detectWebglSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '') : '';
    // SwiftShader / llvmpipe 是软件渲染，启用 WebGL 反而更慢。
    return !/swiftshader|llvmpipe|software/i.test(renderer);
  } catch {
    return false;
  }
}

function setsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export default function KnowledgeGraphWorkspace({ workspaceActive = true }: { workspaceActive?: boolean }) {
  const locale = useAppLocale();
  const l = useLocaleText();
  const isEnglish = locale === 'en-US';
  const displayNodeLabel = useCallback(
    (node: Pick<KnowledgeGraphNode, 'type' | 'label'>) =>
      node.type === 'note' ? noteDisplayTitle(node.label, l) : node.label,
    [l],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const userAdjustedViewRef = useRef(false);
  const labelsExpandedRef = useRef(false);
  const lodActiveRef = useRef(false);
  // 记录已经套用的 LOD 档位与边数，避免每个 zoom 帧都遍历所有边。
  const lodAppliedRef = useRef({ ratio: -1, edgeCount: -1 });
  const quickRelationSourceRef = useRef<KnowledgeGraphNode | null>(null);
  const renderedNodeIdsRef = useRef<Set<string>>(new Set());
  const renderedEdgeIdsRef = useRef<Set<string>>(new Set());
  const renderedLayoutModeRef = useRef<LayoutMode>('global');
  const pendingLayoutRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const openNoteTab = useTabsStore((state) => state.openNoteTab);

  const [snapshot, setSnapshot] = useState<KnowledgeGraphSnapshot | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeGraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeGraphEdge | null>(null);
  const [edgeEdit, setEdgeEdit] = useState<GraphEdgeEditState | null>(null);
  const [relationSourceNode, setRelationSourceNode] = useState<KnowledgeGraphNode | null>(null);
  const [relationTargetNode, setRelationTargetNode] = useState<KnowledgeGraphNode | null>(null);
  const [quickRelationSourceNode, setQuickRelationSourceNode] = useState<KnowledgeGraphNode | null>(null);
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState>(null);
  const [hover, setHover] = useState<GraphHoverPayload | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);

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
  const [debouncedEmbeddingNeighbors, setDebouncedEmbeddingNeighbors] = useState(10);

  const [preferences, setPreferences] = useState<GraphPreferences>(() => loadGraphPreferences());
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set());
  const [webglSupported, setWebglSupported] = useState(false);
  // renderer 变化会重建 cytoscape 实例；epoch 让元素 effect 在新实例上重放。
  const [cyEpoch, setCyEpoch] = useState(0);

  const [relationLabel, setRelationLabel] = useState('related');
  const [relationDescription, setRelationDescription] = useState('');
  const [relationWorking, setRelationWorking] = useState(false);
  const [referenceSyncProgress, setReferenceSyncProgress] = useState<LibraryReferenceProgress | null>(null);
  const [referenceSyncWorking, setReferenceSyncWorking] = useState(false);
  const [relationTargetSearch, setRelationTargetSearch] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [perf, setPerf] = useState<GraphPerfStats>({
    snapshotMs: null,
    elementsMs: null,
    layoutMs: null,
    firstFrameMs: null,
    interactionP50: null,
    interactionP95: null,
    layoutStrategy: null,
  });
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    localDepth: false,
    nodeTypes: false,
    edgeTypes: false,
    embedding: true,
    forces: true,
    performance: true,
    customRelations: true,
    graphStats: true,
  });

  const updatePreferences = useCallback((patch: Partial<GraphPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      saveGraphPreferences(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const supported = detectWebglSupport();
    setWebglSupported(supported);
    if (!supported && preferences.renderer === 'webgl') {
      updatePreferences({ renderer: 'canvas' });
    }
  }, [preferences.renderer, updatePreferences]);

  const openGraphNode = useCallback(async (node: KnowledgeGraphNode) => {
    if (node.type === 'paper' && node.paperId) {
      emitOpenLibraryPaper(node.paperId);
      return;
    }
    if (node.type === 'note' && node.noteId) {
      openNoteTab(node.noteId, node.label);
    }
  }, [openNoteTab]);

  const typeFilteredSnapshot = useMemo<KnowledgeGraphSnapshot | null>(() => {
    if (!snapshot) return null;
    const visiblePaperCount = snapshot.nodes.filter(
      (node) => node.type === 'paper' && enabledNodeTypes.paper,
    ).length;
    const shouldAggregate = preferences.aggregateEnabled
      && visiblePaperCount > preferences.aggregateThreshold;

    // 聚合需要分类节点作为簇标签/成员边；即使“分类”未勾选也临时纳入，
    // 聚合结果只输出超节点 + 展开后的论文节点。
    const allowedNodeIds = new Set(
      snapshot.nodes
        .filter((node) => enabledNodeTypes[node.type] || (shouldAggregate && node.type === 'category'))
        .map((node) => node.id),
    );
    const filtered: KnowledgeGraphSnapshot = {
      ...snapshot,
      nodes: snapshot.nodes.filter((node) => allowedNodeIds.has(node.id)),
      edges: snapshot.edges.filter((edge) =>
        enabledEdgeTypes[edge.type]
        && allowedNodeIds.has(edge.source)
        && allowedNodeIds.has(edge.target)),
    };

    if (!shouldAggregate) return filtered;
    return aggregateGraphByCategory(filtered, {
      expandedCategoryIds,
      uncategorizedLabel: l('未分类', 'Uncategorized'),
    });
  }, [
    enabledEdgeTypes,
    enabledNodeTypes,
    snapshot,
    preferences.aggregateEnabled,
    preferences.aggregateThreshold,
    expandedCategoryIds,
    l,
  ]);

  const displaySnapshot = useMemo<KnowledgeGraphSnapshot | null>(() => {
    if (!typeFilteredSnapshot) return null;
    if (!preferences.edgeBudget || typeFilteredSnapshot.edges.length <= preferences.edgeBudget) {
      return typeFilteredSnapshot;
    }
    // 边预算：保留权重最高的边，避免 5 万条以外把渲染拖死。
    const kept = new Set(
      typeFilteredSnapshot.edges
        .slice()
        .sort((left, right) => (Number(right.weight) || 0) - (Number(left.weight) || 0))
        .slice(0, preferences.edgeBudget)
        .map((edge) => edge.id),
    );
    return { ...typeFilteredSnapshot, edges: typeFilteredSnapshot.edges.filter((edge) => kept.has(edge.id)) };
  }, [typeFilteredSnapshot, preferences.edgeBudget]);

  const nodeById = useMemo(() => {
    const nodes = snapshot?.nodes ?? [];
    return new Map(nodes.map((node) => [node.id, node]));
  }, [snapshot]);

  const degreeByNode = useMemo(() => (
    displaySnapshot
      ? computeDegreeByNode(displaySnapshot.nodes, displaySnapshot.edges, { excludeAnnotations: true })
      : new Map<string, number>()
  ), [displaySnapshot]);

  const graphStats = useMemo(() => {
    if (!displaySnapshot) return { topNodes: [] as Array<{ node: KnowledgeGraphNode; degree: number }> };
    return {
      topNodes: displaySnapshot.nodes
        .map((node) => ({ node, degree: degreeByNode.get(node.id) ?? 0 }))
        .filter((item) => item.degree > 0)
        .sort((left, right) => right.degree - left.degree)
        .slice(0, 10),
    };
  }, [degreeByNode, displaySnapshot]);

  const nodeTypeCounts = useMemo(() => {
    const counts: Record<KnowledgeGraphNodeType, number> = {
      paper: 0, note: 0, tag: 0, category: 0, reference: 0,
    };
    for (const node of displaySnapshot?.nodes ?? []) counts[node.type] += 1;
    return counts;
  }, [displaySnapshot]);

  const edgeTypeCounts = useMemo(() => {
    const counts = Object.fromEntries(GRAPH_EDGE_TYPE_OPTIONS.map((item) => [item.type, 0])) as Record<KnowledgeGraphEdgeType, number>;
    for (const edge of displaySnapshot?.edges ?? []) counts[edge.type] += 1;
    return counts;
  }, [displaySnapshot]);

  const searchMatchIds = useMemo(() => (
    displaySnapshot && debouncedSearch
      ? matchGraphNodeIds(displaySnapshot.nodes, debouncedSearch)
      : new Set<string>()
  ), [debouncedSearch, displaySnapshot]);

  const searchMatchList = useMemo(() => (
    displaySnapshot ? displaySnapshot.nodes.filter((node) => searchMatchIds.has(node.id)) : []
  ), [displaySnapshot, searchMatchIds]);

  const selectedCustomEdges = useMemo(() => {
    if (!snapshot || !selectedNode) return [];
    return snapshot.edges.filter((edge) =>
      edge.type === 'custom_relation'
      && (edge.source === selectedNode.id || edge.target === selectedNode.id));
  }, [selectedNode, snapshot]);

  const selectedNodeConnections = useMemo(() => {
    if (!selectedNode || !displaySnapshot) return [];
    return displaySnapshot.edges
      .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
      .map((edge) => {
        const other = nodeById.get(edge.source === selectedNode.id ? edge.target : edge.source) ?? null;
        const sharedTags = other?.tags?.length && selectedNode.tags?.length
          ? other.tags.filter((tag) => selectedNode.tags?.includes(tag))
          : [];
        return { edge, other, sharedTags };
      })
      .sort((left, right) => (Number(right.edge.weight) || 0) - (Number(left.edge.weight) || 0))
      .slice(0, 32);
  }, [displaySnapshot, nodeById, selectedNode]);

  const activePerspective = GRAPH_PERSPECTIVES.find((item) => item.id === perspective) ?? GRAPH_PERSPECTIVES[0];
  const viewMode: GraphViewMode = layoutMode === 'local'
    ? 'focus'
    : perspective === 'paper'
      ? 'overview'
      : perspective === 'mixed'
        ? 'mixed'
        : 'custom';

  useEffect(() => {
    quickRelationSourceRef.current = quickRelationSourceNode;
  }, [quickRelationSourceNode]);

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
      if (!cancelled) setReferenceSyncProgress(progress);
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

  // 载入快照。聚光搜索不请求后端过滤，保留全图；仅“显示匹配”走服务端过滤。
  useEffect(() => {
    if (!workspaceActive) return undefined;
    let cancelled = false;

    async function loadGraph() {
      setLoading(true);
      setError('');
      const startedAt = performance.now();
      perfMark('graph:snapshot');
      try {
        const graph = await getKnowledgeGraph({
          search: preferences.searchMode === 'filter' ? debouncedSearch : '',
          localNodeId: layoutMode === 'local' ? localNodeId : '',
          localDepth: layoutMode === 'local' ? localDepth : 0,
          includeEmbeddingEdges: enabledEdgeTypes.related_by_embedding,
          includeReferences: enabledEdgeTypes.paper_cites_paper || enabledNodeTypes.reference,
          includeCoAuthors: enabledEdgeTypes.co_author,
          includeCustomRelations: enabledEdgeTypes.custom_relation,
          includeNotes: enabledNodeTypes.note,
          includeTags: enabledNodeTypes.tag,
          includeCategories: enabledNodeTypes.category || preferences.aggregateEnabled,
          embeddingStrategy: 'mutual-knn',
          embeddingK: debouncedEmbeddingNeighbors,
          embeddingBridge: preferences.embeddingBridge,
          graphNodeLimit: MAX_BACKEND_NODES,
          graphEdgeLimitPerNode: MAX_BACKEND_EDGES_PER_NODE,
        });
        if (cancelled) return;
        setSnapshot(graph);
        setSelectedNode((current) =>
          current && graph.nodes.some((node) => node.id === current.id)
            ? graph.nodes.find((node) => node.id === current.id) ?? null
            : null);
        setSelectedEdge((current) =>
          current && graph.edges.some((edge) => edge.id === current.id)
            ? graph.edges.find((edge) => edge.id === current.id) ?? null
            : null);
        setPerf((current) => ({ ...current, snapshotMs: Math.round(performance.now() - startedAt) }));
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
        perfMeasure('graph snapshot', 'graph:snapshot');
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [
    workspaceActive,
    debouncedSearch,
    preferences.searchMode,
    preferences.aggregateEnabled,
    debouncedEmbeddingNeighbors,
    preferences.embeddingBridge,
    enabledEdgeTypes.custom_relation,
    enabledEdgeTypes.co_author,
    enabledEdgeTypes.paper_cites_paper,
    enabledEdgeTypes.related_by_embedding,
    enabledNodeTypes.note,
    enabledNodeTypes.tag,
    enabledNodeTypes.category,
    enabledNodeTypes.reference,
    layoutMode,
    localDepth,
    localNodeId,
    refreshToken,
  ]);

  const graphSignature = useMemo(
    () => (displaySnapshot ? computeGraphSignature(displaySnapshot) : ''),
    [displaySnapshot],
  );

  const syncLod = useCallback((cy: Core) => {
    if (!displaySnapshot) return;
    if (!preferences.lodEnabled) {
      lodActiveRef.current = false;
      lodAppliedRef.current = { ratio: -1, edgeCount: -1 };
      cy.edges().removeClass('lod-hidden');
      return;
    }
    const zoom = cy.zoom();
    // 迟滞区间 0.9 / 1.05，避免阈值附近抖动。
    if (!lodActiveRef.current && zoom < 0.9) lodActiveRef.current = true;
    else if (lodActiveRef.current && zoom > 1.05) lodActiveRef.current = false;

    if (!lodActiveRef.current) {
      lodAppliedRef.current = { ratio: -1, edgeCount: -1 };
      cy.edges().removeClass('lod-hidden');
      return;
    }
    // 三档 LOD：远看只留 10–20%，中距离约一半，近看恢复全部。
    const ratio = resolveLodRatio(zoom, preferences.lodRatio);
    if (
      lodAppliedRef.current.ratio === ratio
      && lodAppliedRef.current.edgeCount === displaySnapshot.edges.length
    ) {
      return;
    }
    lodAppliedRef.current = { ratio, edgeCount: displaySnapshot.edges.length };
    const visible = selectLodVisibleEdgeIds(displaySnapshot.edges, ratio);
    cy.edges().forEach((edge) => {
      edge.toggleClass('lod-hidden', !visible.has(edge.id()));
    });
  }, [displaySnapshot, preferences.lodEnabled, preferences.lodRatio]);

  const applySearchHighlight = useCallback((cy: Core) => {
    if (!debouncedSearch || searchMatchIds.size === 0) {
      cy.nodes().removeClass('search-match search-dim');
      return;
    }
    cy.nodes().forEach((element) => {
      const matched = searchMatchIds.has(element.id());
      element.toggleClass('search-match', matched);
      element.toggleClass('search-dim', !matched && preferences.searchMode === 'spotlight');
    });
  }, [debouncedSearch, preferences.searchMode, searchMatchIds]);

  const layoutSignatureRef = useRef('');
  layoutSignatureRef.current = graphSignature;
  // 元素 effect 只负责画布增量；布局参数走 ref，避免拖动滑杆时重建元素。
  const layoutPrefsRef = useRef({ localLayout: preferences.localLayout, forces: preferences.forces });
  layoutPrefsRef.current = { localLayout: preferences.localLayout, forces: preferences.forces };

  // 元素构建/增量更新。
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !displaySnapshot) return;

    const elementsStartedAt = performance.now();
    // 快照变化后强制重算 LOD 类，避免同边数但拓扑变化时新边漏加/漏减。
    lodAppliedRef.current = { ratio: -1, edgeCount: -1 };
    const elements = buildGraphElements(displaySnapshot, {
      localizeNodeLabel: displayNodeLabel,
      colorMode: preferences.colorBy,
      degreeByNode,
    });
    const displayNodeIds = new Set(displaySnapshot.nodes.map((node) => node.id));
    const elementDataById = new Map(
      elements
        .filter((element) => displayNodeIds.has(String(element.data.id)))
        .map((element) => [String(element.data.id), element.data]),
    );

    const nextNodeIds = new Set(displaySnapshot.nodes.map((node) => node.id));
    const nextEdgeIds = new Set(displaySnapshot.edges.map((edge) => edge.id));
    const nodesChanged = !setsEqual(renderedNodeIdsRef.current, nextNodeIds);
    const layoutModeChanged = renderedLayoutModeRef.current !== layoutMode;

    cy.batch(() => {
      if (nodesChanged || layoutModeChanged) {
        const previousPositions = new Map(
          cy.nodes().map((node) => [node.id(), { ...node.position() }]),
        );
        cy.elements().remove();
        cy.add(elements as ElementDefinition[]);
        renderedNodeIdsRef.current = nextNodeIds;
        renderedEdgeIdsRef.current = nextEdgeIds;
        renderedLayoutModeRef.current = layoutMode;

        for (const node of cy.nodes()) {
          const previous = previousPositions.get(node.id());
          if (previous) node.position(previous);
        }
        if (previousPositions.size === 0) {
          const restored = graphSignature ? applyStoredPositions(cy, graphSignature) : 0;
          if (restored === nextNodeIds.size) {
            if (graphContainerHasSize(containerRef.current)) cy.fit(undefined, 36);
            return;
          }
        }
        if (previousPositions.size > 0 && !layoutModeChanged) {
          const neighbors = new Map<string, Array<{ x: number; y: number }>>();
          for (const edge of displaySnapshot.edges) {
            const sourcePosition = previousPositions.get(edge.source);
            const targetPosition = previousPositions.get(edge.target);
            if (sourcePosition) {
              const list = neighbors.get(edge.target) ?? [];
              list.push(sourcePosition);
              neighbors.set(edge.target, list);
            }
            if (targetPosition) {
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
          let orphanIndex = 0;
          for (const node of cy.nodes()) {
            if (previousPositions.has(node.id()) || neighbors.get(node.id())?.length) continue;
            const angle = orphanIndex * 2.399963229728653;
            const radius = 120 + 24 * Math.sqrt(orphanIndex + 1);
            node.position({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
            orphanIndex += 1;
          }
          // 新增节点先就近落位，再做一次 bounded 的 randomize:false 布局，
          // 让局部拥挤化开；不 fit，保留用户当前视口。
          window.setTimeout(() => {
            const current = cyRef.current;
            if (!current || current.destroyed()) return;
            void runGraphLayout(current, {
              mode: layoutMode,
              localLayout: layoutPrefsRef.current.localLayout,
              localNodeId,
              forces: layoutPrefsRef.current.forces,
              signature: graphSignature,
              incremental: true,
              fit: false,
            }).then((result) => {
              if (result) setPerf((currentPerf) => ({ ...currentPerf, layoutMs: Math.round(result.durationMs), layoutStrategy: result.strategy }));
            });
          }, 0);
          return;
        }

        userAdjustedViewRef.current = false;
        if (graphContainerHasSize(containerRef.current)) {
          void runGraphLayout(cy, {
            mode: layoutMode,
            localLayout: layoutPrefsRef.current.localLayout,
            localNodeId,
            forces: layoutPrefsRef.current.forces,
            signature: graphSignature,
          }).then((result) => {
            if (result) setPerf((current) => ({ ...current, layoutMs: Math.round(result.durationMs), layoutStrategy: result.strategy }));
          });
        } else {
          pendingLayoutRef.current = true;
        }
        return;
      }

      for (const edgeId of renderedEdgeIdsRef.current) {
        if (!nextEdgeIds.has(edgeId)) cy.$id(edgeId).remove();
      }
      for (const edge of displaySnapshot.edges) {
        if (!renderedEdgeIdsRef.current.has(edge.id)) {
          cy.add({ data: edge } as ElementDefinition);
        } else {
          cy.$id(edge.id).data(edge);
        }
      }
      for (const node of displaySnapshot.nodes) {
        const element = cy.$id(node.id);
        const data = elementDataById.get(node.id);
        if (element.nonempty() && data) element.data(data);
      }
      renderedEdgeIdsRef.current = nextEdgeIds;
    });

    applySearchHighlight(cy);
    syncLod(cy);
    setPerf((current) => ({
      ...current,
      elementsMs: Math.round(performance.now() - elementsStartedAt),
    }));
    const frameHandle = window.requestAnimationFrame(() => {
      setPerf((current) => ({
        ...current,
        firstFrameMs: Math.round(performance.now() - elementsStartedAt),
      }));
    });
    return () => window.cancelAnimationFrame(frameHandle);
  }, [
    applySearchHighlight,
    cyEpoch,
    degreeByNode,
    displayNodeLabel,
    displaySnapshot,
    graphSignature,
    layoutMode,
    localNodeId,
    preferences.colorBy,
    syncLod,
  ]);

  // 力参数/局部布局变化后防抖重排；不影响元素增量更新。
  const forceSignature = [
    preferences.forces.gravity,
    preferences.forces.repulsion,
    preferences.forces.edgeLength,
    preferences.localLayout,
  ].join('|');
  const previousForceSignatureRef = useRef(forceSignature);
  useEffect(() => {
    if (previousForceSignatureRef.current === forceSignature) return undefined;
    previousForceSignatureRef.current = forceSignature;
    const handle = window.setTimeout(() => {
      const cy = cyRef.current;
      if (!cy || cy.nodes().length === 0) return;
      userAdjustedViewRef.current = false;
      void runGraphLayout(cy, {
        mode: layoutMode,
        localLayout: preferences.localLayout,
        localNodeId,
        forces: preferences.forces,
        signature: layoutSignatureRef.current,
        fit: false,
      }).then((result) => {
        if (result) setPerf((current) => ({ ...current, layoutMs: Math.round(result.durationMs), layoutStrategy: result.strategy }));
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [
    forceSignature,
    layoutMode,
    localNodeId,
    preferences.forces,
    preferences.localLayout,
  ]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applySearchHighlight(cy);
    syncLod(cy);
  }, [applySearchHighlight, syncLod]);

  useEffect(() => {
    if (!workspaceActive) return;
    const cy = cyRef.current;
    if (!cy) return;
    cy.resize();
    if (pendingLayoutRef.current) {
      pendingLayoutRef.current = false;
      void runGraphLayout(cy, {
        mode: renderedLayoutModeRef.current,
        localLayout: preferences.localLayout,
        localNodeId,
        forces: preferences.forces,
        signature: layoutSignatureRef.current,
      });
    } else if (cy.nodes().length > 0) {
      cy.fit(undefined, 36);
    }
  }, [workspaceActive, localNodeId, preferences.forces, preferences.localLayout]);

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

  const fitGraph = useCallback(() => {
    userAdjustedViewRef.current = false;
    cyRef.current?.fit(undefined, 36);
  }, []);

  const zoomGraphBy = useCallback((factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    userAdjustedViewRef.current = true;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }, []);

  const rerunLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    userAdjustedViewRef.current = false;
    void runGraphLayout(cy, {
      mode: layoutMode,
      localLayout: preferences.localLayout,
      localNodeId,
      forces: preferences.forces,
      signature: graphSignature,
    }).then((result) => {
      if (result) setPerf((current) => ({ ...current, layoutMs: Math.round(result.durationMs), layoutStrategy: result.strategy }));
    });
  }, [graphSignature, layoutMode, localNodeId, preferences.forces, preferences.localLayout]);

  const focusSelectedAsLocal = useCallback(() => {
    if (!selectedNode) return;
    setLocalNodeId(selectedNode.id);
    setLayoutMode('local');
  }, [selectedNode]);

  const focusGraphNode = useCallback((node: KnowledgeGraphNode) => {
    const cy = cyRef.current;
    if (!cy) return;
    const target = cy.$id(node.id);
    if (target.empty()) return;
    cy.elements().unselect();
    target.select();
    setSelectedNode(node);
    cy.animate({ center: { eles: target }, zoom: Math.max(cy.zoom(), 1.05), duration: 260 });
  }, []);

  const focusLocalNode = useCallback((node: KnowledgeGraphNode) => {
    setLocalNodeId(node.id);
    setLayoutMode('local');
  }, []);

  const exportGraphPng = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const blob = cy.png({ output: 'blob', full: true, scale: 2 }) as Blob;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `paperquay-knowledge-graph-${Date.now()}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const exportGraphJson = useCallback(() => {
    const graph = displaySnapshot ?? snapshot;
    if (!graph) return;
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `paperquay-knowledge-graph-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [displaySnapshot, snapshot]);

  const refreshGraph = useCallback(() => {
    void invalidateKnowledgeGraphCache().finally(() => {
      setRefreshToken((value) => value + 1);
    });
  }, []);

  const syncReferences = useCallback(async () => {
    setReferenceSyncWorking(true);
    setError('');
    try {
      await fetchAllLibraryReferences(false);
      refreshGraph();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setReferenceSyncWorking(false);
    }
  }, [refreshGraph]);

  const applyPerspective = useCallback((nextPerspective: GraphPerspective) => {
    setPerspective(nextPerspective);
    setEnabledNodeTypes(perspectiveNodeTypes(nextPerspective));
    setEnabledEdgeTypes(perspectiveEdgeTypes(nextPerspective));
    if (nextPerspective === 'semantic') setLayoutMode('global');
    if (nextPerspective !== 'paper') setExpandedCategoryIds(new Set());
    if (!preferences.colorByOverridden) {
      const colorBy = defaultColorByForPerspective(nextPerspective);
      if (colorBy !== preferences.colorBy) {
        setPreferences((current) => {
          const next = { ...current, colorBy };
          saveGraphPreferences(next);
          return next;
        });
      }
    }
  }, [preferences.colorBy, preferences.colorByOverridden]);

  const handleViewModeChange = useCallback((mode: GraphViewMode) => {
    if (mode === 'overview') {
      applyPerspective('paper');
      setLayoutMode('global');
      return;
    }
    if (mode === 'mixed') {
      applyPerspective('mixed');
      setLayoutMode('global');
      return;
    }
    if (mode === 'focus') {
      const centerId = localNodeId || selectedNode?.id;
      if (!centerId) {
        setError(l('请先在图中选择一个节点作为聚焦中心。', 'Select a node in the graph as the focus center first.'));
        return;
      }
      setLocalNodeId(centerId);
      setLayoutMode('local');
      return;
    }
    setPerspective('custom');
  }, [applyPerspective, l, localNodeId, selectedNode]);

  const toggleNodeType = useCallback((type: KnowledgeGraphNodeType) => {
    setEnabledNodeTypes((current) => ({ ...current, [type]: !current[type] }));
    setPerspective('custom');
  }, []);

  const toggleEdgeType = useCallback((type: KnowledgeGraphEdgeType) => {
    setEnabledEdgeTypes((current) => ({ ...current, [type]: !current[type] }));
    setPerspective('custom');
  }, []);

  const togglePanel = useCallback((panel: string) => {
    setCollapsedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }, []);

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
      const relation = await createKnowledgeGraphRelation({ source: source.id, target: target.id, label, description });
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
      void invalidateKnowledgeGraphCache();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setRelationWorking(false);
    }
  }, [l, relationDescription, relationLabel]);

  const deleteRelation = useCallback(async (relationId: string) => {
    setRelationWorking(true);
    setError('');
    try {
      await deleteKnowledgeGraphRelation(relationId);
      setSnapshot((current) => current
        ? { ...current, edges: current.edges.filter((edge) => edge.id !== relationId) }
        : current);
      setSelectedEdge((current) => (current?.id === relationId ? null : current));
      void invalidateKnowledgeGraphCache();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setRelationWorking(false);
    }
  }, []);

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
  }, [selectedEdge?.description, selectedEdge?.id, selectedEdge?.label, selectedEdge?.type, selectedEdge?.weight]);

  const saveEdgeEdit = useCallback(async () => {
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
      void invalidateKnowledgeGraphCache();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
      setEdgeEdit((current) => (current ? { ...current, working: false } : current));
    }
  }, [edgeEdit, selectedEdge]);

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

  const interactionSampleRef = useRef(false);
  const interactionFrameRef = useRef<number | null>(null);
  const startInteractionSampling = useCallback(() => {
    if (interactionSampleRef.current) return;
    interactionSampleRef.current = true;
    const startedAt = performance.now();
    const deltas: number[] = [];
    let last = startedAt;
    const tick = (now: number) => {
      deltas.push(now - last);
      last = now;
      if (now - startedAt < 700) {
        interactionFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      interactionSampleRef.current = false;
      interactionFrameRef.current = null;
      if (deltas.length === 0) return;
      deltas.sort((left, right) => left - right);
      const percentile = (ratio: number) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * ratio))];
      setPerf((current) => ({
        ...current,
        interactionP50: Math.round(percentile(0.5) * 10) / 10,
        interactionP95: Math.round(percentile(0.95) * 10) / 10,
      }));
    };
    interactionFrameRef.current = window.requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => {
    if (interactionFrameRef.current !== null) window.cancelAnimationFrame(interactionFrameRef.current);
  }, []);

  // 事件处理器走 ref，输入文字/切换面板不会重建 cytoscape。
  const handlersRef = useRef<GraphEventHandlers>({
    onNodeTap: () => {},
    onEdgeTap: () => {},
    onBackgroundTap: () => {},
    onNodeDoubleTap: () => {},
    onNodeContextMenu: () => {},
    onHover: () => {},
    onViewAdjusted: () => {},
    onZoom: () => {},
    onDragFree: () => {},
    onQuickRelationTarget: () => false,
    onEscape: () => {},
  });
  handlersRef.current = {
    onNodeTap: selectGraphNode,
    onEdgeTap: selectGraphEdge,
    onBackgroundTap: () => {
      setSelectedNode(null);
      setSelectedEdge(null);
      setContextMenu(null);
      cyRef.current?.elements().removeClass('faded focused');
    },
    onNodeDoubleTap: (node) => focusLocalNode(node),
    onNodeContextMenu: (node, position) => {
      selectGraphNode(node);
      setContextMenu({ x: position.x, y: position.y, node });
    },
    onHover: (payload) => {
      setHover(payload);
      const cy = cyRef.current;
      if (!cy) return;
      if (!payload) {
        if (cy.$(':selected').length === 0) cy.elements().removeClass('faded focused');
        return;
      }
      if (payload.kind === 'node' && payload.node) {
        const target = cy.$id(payload.node.id);
        if (target.empty() || cy.$(':selected').length > 0) return;
        cy.elements().addClass('faded');
        target.removeClass('faded').addClass('focused');
        target.neighborhood().removeClass('faded').addClass('focused');
      }
    },
    onViewAdjusted: () => {
      userAdjustedViewRef.current = true;
      startInteractionSampling();
    },
    onZoom: () => {
      const cy = cyRef.current;
      if (!cy) return;
      const zoom = cy.zoom();
      // 1.15 / 0.95 迟滞：避免在阈值附近来回抖动导致标签闪烁。
      if (!labelsExpandedRef.current && zoom > 1.15) {
        labelsExpandedRef.current = true;
        cy.nodes().addClass('label-all');
      } else if (labelsExpandedRef.current && zoom < 0.95) {
        labelsExpandedRef.current = false;
        cy.nodes().removeClass('label-all');
      }
      syncLod(cy);
      startInteractionSampling();
    },
    onDragFree: () => {
      userAdjustedViewRef.current = true;
      const cy = cyRef.current;
      if (cy && layoutSignatureRef.current) persistGraphPositions(cy, layoutSignatureRef.current);
    },
    onQuickRelationTarget: (node) => {
      const source = quickRelationSourceRef.current;
      if (!source || source.id === node.id) return false;
      void createRelation(source, node).then(() => setQuickRelationSourceNode(null));
      return true;
    },
    onEscape: () => {
      setSelectedNode(null);
      setSelectedEdge(null);
      setContextMenu(null);
      setQuickRelationSourceNode(null);
      cyRef.current?.elements().removeClass('faded focused').unselect();
    },
  };

  // cytoscape 实例：渲染器变化时重建（WebGL 只能在初始化时选择）。
  const rendererMode = preferences.renderer === 'webgl' && webglSupported ? 'webgl' : 'canvas';
  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disconnectResizeObserver: (() => void) | null = null;
    const theme = resolveGraphTheme(
      (name) => window.getComputedStyle(document.documentElement).getPropertyValue(name),
      document.documentElement.classList.contains('dark'),
    );
    const styles = rendererMode === 'webgl'
      ? degradeStylesForWebgl(buildGraphStyles(theme))
      : buildGraphStyles(theme);

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: styles,
      minZoom: 0.08,
      maxZoom: 2.8,
      hideEdgesOnViewport: true,
      hideLabelsOnViewport: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      ...(rendererMode === 'webgl' ? { webgl: true } : {}),
    });
    cyRef.current = cy;
    setCyEpoch((value) => value + 1);

    const themeObserver = new MutationObserver(() => {
      const nextTheme = resolveGraphTheme(
        (name) => window.getComputedStyle(document.documentElement).getPropertyValue(name),
        document.documentElement.classList.contains('dark'),
      );
      const nextStyles = rendererMode === 'webgl'
        ? degradeStylesForWebgl(buildGraphStyles(nextTheme))
        : buildGraphStyles(nextTheme);
      cy.style(nextStyles);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = window.setTimeout(() => {
          resizeTimerRef.current = null;
          const current = cyRef.current;
          if (!current) return;
          current.resize();
          if (!userAdjustedViewRef.current && current.nodes().length > 0) current.fit(undefined, 36);
        }, 180);
      });
      resizeObserver.observe(containerRef.current);
      disconnectResizeObserver = () => resizeObserver.disconnect();
    }

    const detachEvents = attachGraphEvents(cy, { container: containerRef.current, handlersRef });

    return () => {
      detachEvents();
      disconnectResizeObserver?.();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      themeObserver.disconnect();
      disposeGraphLayoutClient();
      cy.destroy();
      cyRef.current = null;
      renderedNodeIdsRef.current = new Set();
      renderedEdgeIdsRef.current = new Set();
    };
  }, [rendererMode]);

  // 隐藏期间不监听变更；重新激活时主动刷新一次，避免看到旧快照。
  const wasWorkspaceActiveRef = useRef(false);
  useEffect(() => {
    if (workspaceActive && wasWorkspaceActiveRef.current) {
      refreshGraph();
    }
    wasWorkspaceActiveRef.current = workspaceActive;
  }, [refreshGraph, workspaceActive]);

  // 文献/笔记/RAG 变更后防抖刷新；位置由增量渲染保留。
  useEffect(() => {
    if (!workspaceActive) return undefined;
    const events = [
      NOTE_CHANGED_EVENT,
      NATIVE_PAPER_UPDATED_EVENT,
      LIBRARY_READING_UPDATED_EVENT,
      RAG_INDEX_STATUS_UPDATED_EVENT,
      'paperquay:native-summary-updated',
      'paperquay:native-mineru-status-updated',
    ];
    const schedule = () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        refreshGraph();
      }, AUTO_REFRESH_DEBOUNCE_MS);
    };
    for (const event of events) window.addEventListener(event, schedule);
    return () => {
      for (const event of events) window.removeEventListener(event, schedule);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [refreshGraph, workspaceActive]);

  // 文献库/阅读器/笔记“在图中查看”：切换视角并聚焦到指定节点。
  useEffect(() => {
    const applyFocus = (detail: OpenGraphFocusEventDetail | null) => {
      if (!detail) return;
      const nodeId = detail.nodeId
        || (detail.paperId ? `paper:${detail.paperId}` : '')
        || (detail.noteId ? `note:${detail.noteId}` : '');
      if (!nodeId) return;
      const isNote = nodeId.startsWith('note:');
      setPerspective(isNote ? 'note' : 'paper');
      setEnabledNodeTypes(perspectiveNodeTypes(isNote ? 'note' : 'paper'));
      setEnabledEdgeTypes(perspectiveEdgeTypes(isNote ? 'note' : 'paper'));
      setLocalNodeId(nodeId);
      setLayoutMode('local');
      setSelectedNode(null);
      setSelectedEdge(null);
    };
    // 首次打开时工作区尚未挂载，消费 App 暂存的请求。
    applyFocus(consumePendingGraphFocus());
    const handle = (event: Event) => {
      applyFocus((event as CustomEvent<OpenGraphFocusEventDetail>).detail ?? null);
      consumePendingGraphFocus();
    };
    window.addEventListener(OPEN_GRAPH_FOCUS_EVENT, handle);
    return () => window.removeEventListener(OPEN_GRAPH_FOCUS_EVENT, handle);
  }, []);

  // 聚合超节点双击展开。
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return undefined;
    const expand = (event: cytoscape.EventObject) => {
      const data = event.target.data() as KnowledgeGraphNode;
      if (!String(data.id).startsWith('cluster:')) return;
      const key = String(data.id).slice('cluster:'.length);
      setExpandedCategoryIds((current) => new Set(current).add(key));
    };
    cy.on('dbltap', 'node', expand);
    return () => {
      cy.off('dbltap', 'node', expand);
    };
  }, []);

  const searchMatchCount = searchMatchIds.size;
  useEffect(() => {
    setSearchIndex((current) => (searchMatchList.length === 0 ? 0 : Math.min(current, searchMatchList.length - 1)));
  }, [searchMatchList.length]);

  const stepSearch = useCallback((delta: number) => {
    if (searchMatchList.length === 0) return;
    const nextIndex = (searchIndex + delta + searchMatchList.length) % searchMatchList.length;
    setSearchIndex(nextIndex);
    focusGraphNode(searchMatchList[nextIndex]);
  }, [focusGraphNode, searchIndex, searchMatchList]);

  const snapshotMetadata = useMemo(
    () => (snapshot ? readSnapshotMetadata(snapshot) : null),
    [snapshot],
  );
  const samplingSummary = useMemo(() => {
    const parts = [formatGraphSamplingSummary(snapshotMetadata, isEnglish ? 'en' : 'zh')].filter(Boolean);
    if (displaySnapshot && typeFilteredSnapshot && displaySnapshot.edges.length < typeFilteredSnapshot.edges.length) {
      parts.push(isEnglish
        ? `Edge budget kept ${displaySnapshot.edges.length}/${typeFilteredSnapshot.edges.length}`
        : `边预算保留 ${displaySnapshot.edges.length}/${typeFilteredSnapshot.edges.length}`);
    }
    return parts.join(' · ');
  }, [displaySnapshot, isEnglish, snapshotMetadata, typeFilteredSnapshot]);

  const normalizedRelationTargetSearch = relationTargetSearch.trim().toLowerCase();
  const relationTargetOptions = (displaySnapshot?.nodes ?? [])
    .filter((node) => node.id !== relationSourceNode?.id && (node.type === 'paper' || node.type === 'note'))
    .filter((node) => {
      if (!normalizedRelationTargetSearch) return true;
      return [displayNodeLabel(node), node.subtitle, node.id]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
        .includes(normalizedRelationTargetSearch);
    })
    .slice(0, 50);

  const nodeCount = displaySnapshot?.nodes.length ?? 0;
  const edgeCount = displaySnapshot?.edges.length ?? 0;
  const visibleNodeTypes: GraphNodeTypeOption[] = VISIBLE_NODE_TYPES;
  const visibleEdgeTypes: GraphEdgeTypeOption[] = VISIBLE_EDGE_TYPES;

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)]">
      <GraphSidebar
        l={l}
        isEnglish={isEnglish}
        workspaceActive={workspaceActive}
        search={search}
        onSearchChange={setSearch}
        searchMode={preferences.searchMode}
        onSearchModeChange={(mode) => updatePreferences({ searchMode: mode })}
        searchMatchCount={searchMatchCount}
        onSearchStep={stepSearch}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        perspective={perspective}
        perspectives={GRAPH_PERSPECTIVES}
        activePerspective={activePerspective}
        onPerspectiveChange={applyPerspective}
        colorBy={preferences.colorBy}
        onColorByChange={(mode: GraphColorMode) => updatePreferences({ colorBy: mode, colorByOverridden: true })}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        localLayout={preferences.localLayout}
        onLocalLayoutChange={(mode) => updatePreferences({ localLayout: mode })}
        localDepth={localDepth}
        onLocalDepthChange={setLocalDepth}
        localNodeId={localNodeId}
        nodeTypes={visibleNodeTypes}
        edgeTypes={visibleEdgeTypes}
        nodeTypeCounts={nodeTypeCounts}
        edgeTypeCounts={edgeTypeCounts}
        enabledNodeTypes={enabledNodeTypes}
        enabledEdgeTypes={enabledEdgeTypes}
        onToggleNodeType={toggleNodeType}
        onToggleEdgeType={toggleEdgeType}
        embeddingNeighbors={embeddingNeighbors}
        onEmbeddingNeighborsChange={setEmbeddingNeighbors}
        embeddingBridge={preferences.embeddingBridge}
        onEmbeddingBridgeChange={(value) => updatePreferences({ embeddingBridge: value })}
        forces={preferences.forces}
        onForceChange={(key, value) => {
          updatePreferences({ forces: { ...preferences.forces, [key]: value } });
        }}
        onResetForces={() => updatePreferences({ forces: { ...DEFAULT_GRAPH_FORCES } })}
        renderer={preferences.renderer}
        onRendererChange={(renderer) => updatePreferences({ renderer })}
        webglSupported={webglSupported}
        edgeBudget={preferences.edgeBudget}
        onEdgeBudgetChange={(value) => updatePreferences({ edgeBudget: value })}
        lodEnabled={preferences.lodEnabled}
        onLodEnabledChange={(value) => updatePreferences({ lodEnabled: value })}
        lodRatio={preferences.lodRatio}
        onLodRatioChange={(value) => updatePreferences({ lodRatio: value })}
        aggregateThreshold={preferences.aggregateThreshold}
        onAggregateThresholdChange={(value) => updatePreferences({
          aggregateThreshold: Math.max(200, Math.min(10_000, Number(value) || DEFAULT_GRAPH_PREFERENCES.aggregateThreshold)),
        })}
        aggregateEnabled={preferences.aggregateEnabled}
        onAggregateEnabledChange={(value) => updatePreferences({ aggregateEnabled: value })}
        relationSourceNode={relationSourceNode}
        relationTargetNode={relationTargetNode}
        relationTargetSearch={relationTargetSearch}
        onRelationTargetSearchChange={setRelationTargetSearch}
        relationTargetOptions={relationTargetOptions}
        relationLabel={relationLabel}
        onRelationLabelChange={setRelationLabel}
        relationDescription={relationDescription}
        onRelationDescriptionChange={setRelationDescription}
        relationWorking={relationWorking}
        selectedNode={selectedNode}
        onUseSelectedAsSource={() => selectedNode && setRelationSourceNode(selectedNode)}
        onChooseRelationTarget={(node) => {
          selectGraphNode(node);
          if (relationSourceNode && relationSourceNode.id !== node.id) setRelationTargetNode(node);
        }}
        onCreateRelation={() => {
          void createRelation(relationSourceNode, relationTargetNode).then(() => {
            setRelationTargetNode(null);
            setRelationSourceNode(null);
          });
        }}
        collapsedPanels={collapsedPanels}
        onTogglePanel={togglePanel}
        nodeCount={nodeCount}
        edgeCount={edgeCount}
        samplingSummary={samplingSummary}
        graphQuality={snapshot?.metadata?.graphQuality ?? null}
        topNodes={graphStats.topNodes}
        onFocusNode={focusGraphNode}
        displayNodeLabel={displayNodeLabel}
        perf={perf}
        referenceSyncProgress={referenceSyncProgress}
        referenceSyncWorking={referenceSyncWorking}
        onSyncReferences={() => void syncReferences()}
        onRefresh={refreshGraph}
        onRerunLayout={rerunLayout}
        onFit={fitGraph}
        onFocusSelectedAsLocal={focusSelectedAsLocal}
        onExportPng={exportGraphPng}
        onExportJson={exportGraphJson}
        canFocusSelected={Boolean(selectedNode)}
      />

      <section className="pq-graph-canvas relative min-w-0 flex-1 bg-[radial-gradient(circle_at_1px_1px,var(--pq-border)_1px,transparent_0)] [background-size:22px_22px]">
        <div ref={containerRef} className="h-full w-full" />

        <GraphToolbar
          l={l}
          isEnglish={isEnglish}
          onZoomIn={() => zoomGraphBy(1.25)}
          onZoomOut={() => zoomGraphBy(1 / 1.25)}
          onFit={fitGraph}
          nodeTypes={visibleNodeTypes}
          edgeTypes={visibleEdgeTypes}
          nodeTypeCounts={nodeTypeCounts}
          edgeTypeCounts={edgeTypeCounts}
          enabledNodeTypes={enabledNodeTypes}
          enabledEdgeTypes={enabledEdgeTypes}
          onToggleNodeType={toggleNodeType}
          onToggleEdgeType={toggleEdgeType}
        />

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
                focusLocalNode(contextMenu.node);
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
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--pq-surface)]/70 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-3 py-2 text-xs text-[var(--pq-text-muted)] shadow-[var(--pq-shadow-float)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {l('正在构建图谱...', 'Building graph...')}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="absolute left-4 top-4 z-20 flex max-w-md items-start gap-2 rounded-[var(--pq-radius-sm)] border border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-error-bg)] px-3 py-2 text-xs leading-5 text-[var(--pq-danger)] shadow-[var(--pq-shadow-float)]">
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

        <GraphTooltip
          hover={hover}
          nodeById={nodeById}
          displayNodeLabel={displayNodeLabel}
          edgeTypeLabel={(type) => edgeTypeLabel(type, isEnglish)}
          ragStatusLabel={(status) => ragStatusLabel(status, isEnglish)}
          l={l}
          containerWidth={containerRef.current?.clientWidth ?? 800}
        />

        <GraphInspector
          node={selectedNode}
          edge={selectedEdge}
          nodeById={nodeById}
          connections={selectedNodeConnections}
          customEdges={selectedCustomEdges}
          edgeEdit={edgeEdit}
          graphQuality={snapshot?.metadata?.graphQuality ?? null}
          displayNodeLabel={displayNodeLabel}
          edgeTypeLabel={(type) => edgeTypeLabel(type, isEnglish)}
          ragStatusLabel={(status) => ragStatusLabel(status, isEnglish)}
          l={l}
          onClose={() => {
            setSelectedNode(null);
            setSelectedEdge(null);
            cyRef.current?.elements().removeClass('faded focused').unselect();
          }}
          onOpenNode={(node) => void openGraphNode(node).catch(console.error)}
          onFocusLocal={focusLocalNode}
          onStartQuickRelation={startQuickRelation}
          onSelectEdge={(edge) => selectGraphEdge(edge, cyRef.current?.$id(edge.id) as cytoscape.EdgeSingular | undefined)}
          onSelectNode={(node) => selectGraphNode(node, cyRef.current?.$id(node.id) as cytoscape.NodeSingular | undefined)}
          onDeleteRelation={(relationId) => {
            setSelectedEdge(null);
            void deleteRelation(relationId);
          }}
          onEdgeEditChange={setEdgeEdit}
          onSaveEdgeEdit={() => void saveEdgeEdit()}
          onFocusEdgeNode={focusGraphNode}
        />
      </section>
    </div>
  );
}
