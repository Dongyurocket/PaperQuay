// B7.3: graph control sidebar. Rendering-only; all state lives in the workspace.

import type { ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  Download,
  FileJson2,
  FileText,
  Filter,
  GitBranch,
  Link2,
  Loader2,
  Maximize2,
  Network,
  RefreshCw,
  Search,
  StickyNote,
  X,
} from 'lucide-react';
import type {
  GraphQuality,
  KnowledgeGraphEdgeType,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
} from '../../types/knowledgeGraph.ts';
import type { LibraryReferenceProgress } from '../../types/library.ts';
import type { GraphColorMode } from './graphPresentation.ts';
import { GRAPH_EDGE_COLORS, GRAPH_NODE_COLORS } from './graphPresentation.ts';
import type { GraphForceSettings } from './graphLayoutMessages.ts';
import type {
  GraphLocalLayoutMode,
  GraphRendererMode,
  GraphSearchMode,
} from './graphPreferences.ts';
import { cn } from '../../utils/cn';

export type GraphPerspective = 'mixed' | 'paper' | 'note' | 'reference' | 'semantic' | 'custom';
export type GraphViewMode = 'overview' | 'focus' | 'mixed' | 'custom';
export type LayoutMode = 'global' | 'local';

export interface GraphPerspectiveOption {
  id: GraphPerspective;
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
}

export interface GraphNodeTypeOption {
  type: KnowledgeGraphNodeType;
  zh: string;
  en: string;
  icon: typeof FileText;
}

export interface GraphEdgeTypeOption {
  type: KnowledgeGraphEdgeType;
  zh: string;
  en: string;
}

export interface GraphTopNode {
  node: KnowledgeGraphNode;
  degree: number;
}

export interface GraphPerfStats {
  snapshotMs: number | null;
  elementsMs: number | null;
  layoutMs: number | null;
  firstFrameMs: number | null;
  /** pan/zoom 交互期间的 rAF 帧时间 p50/p95（ms）。 */
  interactionP50: number | null;
  interactionP95: number | null;
  layoutStrategy: 'fcose' | 'radial' | 'grid' | null;
}

export interface GraphSidebarProps {
  l: (zh: string, en: string) => string;
  isEnglish: boolean;
  workspaceActive: boolean;

  search: string;
  onSearchChange: (value: string) => void;
  searchMode: GraphSearchMode;
  onSearchModeChange: (mode: GraphSearchMode) => void;
  searchMatchCount: number;
  onSearchStep: (delta: number) => void;

  viewMode: GraphViewMode;
  onViewModeChange: (mode: GraphViewMode) => void;
  perspective: GraphPerspective;
  perspectives: GraphPerspectiveOption[];
  activePerspective: GraphPerspectiveOption;
  onPerspectiveChange: (perspective: GraphPerspective) => void;
  colorBy: GraphColorMode;
  onColorByChange: (mode: GraphColorMode) => void;

  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  localLayout: GraphLocalLayoutMode;
  onLocalLayoutChange: (mode: GraphLocalLayoutMode) => void;
  localDepth: number;
  onLocalDepthChange: (depth: number) => void;
  localNodeId: string;

  nodeTypes: GraphNodeTypeOption[];
  edgeTypes: GraphEdgeTypeOption[];
  nodeTypeCounts: Record<KnowledgeGraphNodeType, number>;
  edgeTypeCounts: Record<KnowledgeGraphEdgeType, number>;
  enabledNodeTypes: Record<KnowledgeGraphNodeType, boolean>;
  enabledEdgeTypes: Record<KnowledgeGraphEdgeType, boolean>;
  onToggleNodeType: (type: KnowledgeGraphNodeType) => void;
  onToggleEdgeType: (type: KnowledgeGraphEdgeType) => void;

  embeddingNeighbors: number;
  onEmbeddingNeighborsChange: (value: number) => void;
  embeddingBridge: boolean;
  onEmbeddingBridgeChange: (value: boolean) => void;

  forces: GraphForceSettings;
  onForceChange: (key: keyof GraphForceSettings, value: number) => void;
  onResetForces: () => void;

  renderer: GraphRendererMode;
  onRendererChange: (renderer: GraphRendererMode) => void;
  webglSupported: boolean;
  edgeBudget: number;
  onEdgeBudgetChange: (value: number) => void;
  lodEnabled: boolean;
  onLodEnabledChange: (value: boolean) => void;
  lodRatio: number;
  onLodRatioChange: (value: number) => void;
  aggregateThreshold: number;
  onAggregateThresholdChange: (value: number) => void;
  aggregateEnabled: boolean;
  onAggregateEnabledChange: (value: boolean) => void;

  relationSourceNode: KnowledgeGraphNode | null;
  relationTargetNode: KnowledgeGraphNode | null;
  relationTargetSearch: string;
  onRelationTargetSearchChange: (value: string) => void;
  relationTargetOptions: KnowledgeGraphNode[];
  relationLabel: string;
  onRelationLabelChange: (value: string) => void;
  relationDescription: string;
  onRelationDescriptionChange: (value: string) => void;
  relationWorking: boolean;
  selectedNode: KnowledgeGraphNode | null;
  onUseSelectedAsSource: () => void;
  onChooseRelationTarget: (node: KnowledgeGraphNode) => void;
  onCreateRelation: () => void;

  collapsedPanels: Record<string, boolean>;
  onTogglePanel: (panel: string) => void;

  nodeCount: number;
  edgeCount: number;
  samplingSummary: string;
  graphQuality?: GraphQuality | null;
  topNodes: GraphTopNode[];
  onFocusNode: (node: KnowledgeGraphNode) => void;
  displayNodeLabel: (node: Pick<KnowledgeGraphNode, 'type' | 'label'>) => string;
  perf: GraphPerfStats;

  referenceSyncProgress: LibraryReferenceProgress | null;
  referenceSyncWorking: boolean;
  onSyncReferences: () => void;
  onRefresh: () => void;
  onRerunLayout: () => void;
  onFit: () => void;
  onFocusSelectedAsLocal: () => void;
  onExportPng: () => void;
  onExportJson: () => void;
  canFocusSelected: boolean;
}

function CollapsiblePanel({
  title,
  summary,
  icon,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  summary?: ReactNode;
  icon?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mt-3 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs font-semibold text-[var(--pq-text)]"
      >
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--pq-text-muted)]" strokeWidth={1.8} />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--pq-text-muted)]" strokeWidth={1.8} />}
        {icon ? <span className="shrink-0 text-[var(--pq-text-muted)]">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {summary ? <span className="shrink-0 text-[11px] font-medium text-[var(--pq-text-muted)]">{summary}</span> : null}
      </button>
      {collapsed ? null : <div className="border-t border-[var(--pq-border)] p-3">{children}</div>}
    </section>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-[var(--pq-text)]">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--pq-text-muted)]">{value}{suffix ?? ''}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--pq-accent)]"
      />
    </div>
  );
}

const VIEW_MODES: Array<{ id: GraphViewMode; zh: string; en: string; hintZh: string; hintEn: string }> = [
  { id: 'overview', zh: '主题总览', en: 'Overview', hintZh: '论文 + 引用 + 语义，标签/分类只用于着色。', hintEn: 'Papers, citations and semantic links; tags/collections only color the graph.' },
  { id: 'focus', zh: '聚焦', en: 'Focus', hintZh: '以选中文献为中心，显示 1 跳邻居。', hintEn: 'Center on the selected paper and show one hop.' },
  { id: 'mixed', zh: '混合', en: 'Mixed', hintZh: '文献、笔记、标签、分类一起看。', hintEn: 'Papers, notes, tags and collections together.' },
  { id: 'custom', zh: '自定义', en: 'Custom', hintZh: '保留当前节点/边组合。', hintEn: 'Keep the current node/edge selection.' },
];

export function GraphSidebar(props: GraphSidebarProps) {
  const { l, isEnglish } = props;
  const activeViewMode = VIEW_MODES.find((mode) => mode.id === props.viewMode) ?? VIEW_MODES[0];

  return (
    <aside className="flex w-[292px] shrink-0 flex-col border-r border-[var(--pq-border)] bg-[var(--pq-surface-1)]">
      <div className="border-b border-[var(--pq-border)] p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]">
            <Network className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--pq-text)]">
              {l('知识图谱', 'Knowledge Graph')}
            </div>
            <div className="text-[11px] text-[var(--pq-text-muted)]">
              {props.nodeCount} {l('节点', 'nodes')} · {props.edgeCount} {l('关系', 'edges')}
            </div>
            {props.samplingSummary ? (
              <div className="truncate text-[10px] font-medium text-[var(--pq-text-faint)]" title={props.samplingSummary}>
                {props.samplingSummary}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={props.onRefresh}
            className="pq-icon-button h-7 w-7 shrink-0"
            title={l('刷新图谱', 'Refresh graph')}
            aria-label={l('刷新图谱', 'Refresh graph')}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>

        <label className="mt-3 flex h-9 items-center gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2">
          <Search className="h-4 w-4 shrink-0 text-[var(--pq-text-muted)]" strokeWidth={1.8} />
          <input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder={l('搜索文献、笔记、标签', 'Search papers, notes, tags')}
            className="min-w-0 flex-1 bg-transparent text-xs text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]"
          />
          {props.search ? (
            <button
              type="button"
              onClick={() => props.onSearchChange('')}
              className="rounded p-0.5 text-[var(--pq-text-faint)] hover:text-[var(--pq-text)]"
              aria-label={l('清除搜索', 'Clear search')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        {props.search ? (
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--pq-text-muted)]">
            <select
              value={props.searchMode}
              onChange={(event) => props.onSearchModeChange(event.target.value as GraphSearchMode)}
              className="h-7 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-1.5 text-[11px]"
            >
              <option value="spotlight">{l('聚光', 'Spotlight')}</option>
              <option value="filter">{l('仅显示匹配', 'Only matches')}</option>
            </select>
            <span>{l(`${props.searchMatchCount} 个匹配`, `${props.searchMatchCount} matches`)}</span>
            <button type="button" onClick={() => props.onSearchStep(-1)} className="pq-icon-button h-6 w-6" aria-label={l('上一个', 'Previous')}>
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            </button>
            <button type="button" onClick={() => props.onSearchStep(1)} className="pq-icon-button h-6 w-6" aria-label={l('下一个', 'Next')}>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold text-[var(--pq-text)]">{l('视图模式', 'View Mode')}</div>
          <select
            aria-label={l('视图模式', 'View mode')}
            value={props.viewMode}
            onChange={(event) => props.onViewModeChange(event.target.value as GraphViewMode)}
            className="h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)] outline-none"
          >
            {VIEW_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>{isEnglish ? mode.en : mode.zh}</option>
            ))}
          </select>
          <div className="mt-1.5 text-[11px] leading-5 text-[var(--pq-text-faint)]">
            {isEnglish ? activeViewMode.hintEn : activeViewMode.hintZh}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[11px] font-medium text-[var(--pq-text-muted)]">
            {l('视角', 'Perspective')}
            <select
              value={props.perspective}
              onChange={(event) => props.onPerspectiveChange(event.target.value as GraphPerspective)}
              className="mt-1 h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)]"
            >
              {props.perspectives.map((item) => (
                <option key={item.id} value={item.id}>{isEnglish ? item.en : item.zh}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-medium text-[var(--pq-text-muted)]">
            {l('着色', 'Color by')}
            <select
              value={props.colorBy}
              onChange={(event) => props.onColorByChange(event.target.value as GraphColorMode)}
              className="mt-1 h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)]"
            >
              <option value="category">{l('主分类', 'Collection')}</option>
              <option value="type">{l('节点类型', 'Node type')}</option>
              <option value="year">{l('年份', 'Year')}</option>
              <option value="cluster">{l('聚类', 'Cluster')}</option>
            </select>
          </label>
        </div>
        <div className="mt-1.5 text-[11px] leading-5 text-[var(--pq-text-faint)]">
          {isEnglish ? props.activePerspective.descriptionEn : props.activePerspective.descriptionZh}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid grid-cols-2 gap-1 rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] p-1">
          {(['global', 'local'] as LayoutMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => props.onLayoutModeChange(mode)}
              className={cn(
                'h-8 rounded-[var(--pq-radius-sm)] text-xs font-medium transition',
                props.layoutMode === mode
                  ? 'bg-[var(--pq-surface)] text-[var(--pq-text)] shadow-[var(--pq-shadow-soft)]'
                  : 'text-[var(--pq-text-muted)] hover:text-[var(--pq-text)]',
              )}
            >
              {mode === 'global' ? l('全局', 'Global') : l('局部', 'Local')}
            </button>
          ))}
        </div>

        {props.layoutMode === 'local' ? (
          <CollapsiblePanel
            title={l('局部图谱', 'Local Graph')}
            summary={`${props.localDepth}`}
            collapsed={props.collapsedPanels.localDepth}
            onToggle={() => props.onTogglePanel('localDepth')}
          >
            <RangeField
              label={l('局部深度', 'Local depth')}
              value={props.localDepth}
              min={1}
              max={5}
              step={1}
              onChange={props.onLocalDepthChange}
            />
            <label className="flex items-center justify-between gap-2 text-[11px] text-[var(--pq-text-muted)]">
              {l('局部布局', 'Local layout')}
              <select
                value={props.localLayout}
                onChange={(event) => props.onLocalLayoutChange(event.target.value as GraphLocalLayoutMode)}
                className="h-7 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-1.5 text-[11px]"
              >
                <option value="force">{l('力导向', 'Force')}</option>
                <option value="radial">{l('径向', 'Radial')}</option>
              </select>
            </label>
            {props.localDepth > 2 ? (
              <div className="mt-2 text-[11px] leading-5 text-[var(--pq-warning)]">
                {l('深度超过 2 跳时节点可能快速膨胀。', 'Depth above 2 hops may explode the node count.')}
              </div>
            ) : null}
            <div className="mt-2 text-[11px] leading-5 text-[var(--pq-text-faint)]">
              {props.localNodeId
                ? l('双击节点或使用详情卡可更换局部中心。', 'Double-click a node or use the inspector to change the center.')
                : l('先选择一个节点作为局部中心。', 'Select a node as the local center first.')}
            </div>
          </CollapsiblePanel>
        ) : null}

        <CollapsiblePanel
          title={l('节点类型', 'Node Types')}
          summary={`${props.nodeTypes.filter((item) => props.enabledNodeTypes[item.type]).length}/${props.nodeTypes.length}`}
          collapsed={props.collapsedPanels.nodeTypes}
          onToggle={() => props.onTogglePanel('nodeTypes')}
        >
          <div className="space-y-1.5">
            {props.nodeTypes.map((item) => {
              const Icon = item.icon;
              return (
                <label key={item.type} className="flex h-8 cursor-default items-center gap-2 rounded-[var(--pq-radius-sm)] px-2 text-xs text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)]">
                  <input
                    type="checkbox"
                    checked={props.enabledNodeTypes[item.type]}
                    onChange={() => props.onToggleNodeType(item.type)}
                    className="h-3.5 w-3.5 accent-[var(--pq-accent)]"
                  />
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate">{isEnglish ? item.en : item.zh}</span>
                  <span className="tabular-nums text-[10px] text-[var(--pq-text-faint)]">{props.nodeTypeCounts[item.type]}</span>
                </label>
              );
            })}
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel
          title={l('关系类型', 'Edge Types')}
          summary={`${props.edgeTypes.filter((item) => props.enabledEdgeTypes[item.type]).length}/${props.edgeTypes.length}`}
          collapsed={props.collapsedPanels.edgeTypes}
          onToggle={() => props.onTogglePanel('edgeTypes')}
        >
          <div className="space-y-1.5">
            {props.edgeTypes.map((item) => (
              <label key={item.type} className="flex h-8 cursor-default items-center gap-2 rounded-[var(--pq-radius-sm)] px-2 text-xs text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)]">
                <input
                  type="checkbox"
                  checked={props.enabledEdgeTypes[item.type]}
                  onChange={() => props.onToggleEdgeType(item.type)}
                  className="h-3.5 w-3.5 accent-[var(--pq-accent)]"
                />
                <span className="h-2 w-5 rounded-full" style={{ backgroundColor: GRAPH_EDGE_COLORS[item.type] }} />
                <span className="min-w-0 flex-1 truncate">{isEnglish ? item.en : item.zh}</span>
                <span className="tabular-nums text-[10px] text-[var(--pq-text-faint)]">{props.edgeTypeCounts[item.type]}</span>
              </label>
            ))}
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel
          title={l('语义邻居数', 'Semantic Neighbors')}
          summary={String(props.embeddingNeighbors)}
          collapsed={props.collapsedPanels.embedding}
          onToggle={() => props.onTogglePanel('embedding')}
        >
          <RangeField
            label={l('每篇保留的语义邻居数', 'Neighbors per paper')}
            value={props.embeddingNeighbors}
            min={3}
            max={20}
            step={1}
            onChange={props.onEmbeddingNeighborsChange}
          />
          <label className="mt-1 flex items-center justify-between text-[11px] text-[var(--pq-text-muted)]">
            {l('跨分量自动桥接', 'Bridge disconnected topics')}
            <input
              type="checkbox"
              checked={props.embeddingBridge}
              onChange={(event) => props.onEmbeddingBridgeChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--pq-accent)]"
            />
          </label>
          <p className="mt-1 text-[11px] leading-4 text-[var(--pq-text-muted)]">
            {l('互近邻会限制每篇的度数；关闭桥接后可观察真实的主题隔离。', 'Mutual neighbors cap each paper’s degree; disable bridging to inspect genuine topic isolation.')}
          </p>
          {props.graphQuality?.similarityMin != null && props.graphQuality?.similarityMax != null ? (
            <p className="mt-1 text-[10px] leading-4 text-[var(--pq-text-faint)]">
              {l(
                `当前库中心化余弦范围 ${props.graphQuality.similarityMin.toFixed(3)}–${props.graphQuality.similarityMax.toFixed(3)}；仅作证据，不作为阈值。`,
                `Centered cosine range ${props.graphQuality.similarityMin.toFixed(3)}–${props.graphQuality.similarityMax.toFixed(3)}; evidence only, not a threshold.`,
              )}
            </p>
          ) : null}
        </CollapsiblePanel>

        <CollapsiblePanel
          title={l('力参数', 'Forces')}
          summary={`${props.forces.gravity.toFixed(2)} / ${props.forces.repulsion} / ${props.forces.edgeLength}`}
          collapsed={props.collapsedPanels.forces}
          onToggle={() => props.onTogglePanel('forces')}
        >
          <RangeField
            label={l('聚集力', 'Gravity')}
            value={props.forces.gravity}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => props.onForceChange('gravity', value)}
          />
          <RangeField
            label={l('斥力', 'Repulsion')}
            value={props.forces.repulsion}
            min={0}
            max={20}
            step={1}
            onChange={(value) => props.onForceChange('repulsion', value)}
          />
          <RangeField
            label={l('连线长度', 'Edge length')}
            value={props.forces.edgeLength}
            min={30}
            max={500}
            step={10}
            onChange={(value) => props.onForceChange('edgeLength', value)}
          />
          <button type="button" onClick={props.onResetForces} className="pq-button h-7 w-full justify-center px-2 text-[11px]">
            {l('恢复默认', 'Reset defaults')}
          </button>
        </CollapsiblePanel>

        <CollapsiblePanel
          title={l('性能与规模', 'Performance & Scale')}
          summary={`${props.edgeBudget === 0 ? '∞' : props.edgeBudget}`}
          collapsed={props.collapsedPanels.performance}
          onToggle={() => props.onTogglePanel('performance')}
        >
          <label className="flex items-center justify-between gap-2 text-[11px] text-[var(--pq-text-muted)]">
            {l('渲染器', 'Renderer')}
            <select
              value={props.renderer}
              onChange={(event) => props.onRendererChange(event.target.value as GraphRendererMode)}
              className="h-7 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-1.5 text-[11px]"
            >
              <option value="canvas">Canvas</option>
              <option value="webgl" disabled={!props.webglSupported}>{l('WebGL（实验）', 'WebGL (experimental)')}</option>
            </select>
          </label>
          {!props.webglSupported ? (
            <p className="mt-1 text-[10px] leading-4 text-[var(--pq-text-faint)]">
              {l('当前环境 WebGL 不可用或为软件渲染，已保持 Canvas。', 'WebGL is unavailable or software-rendered here; Canvas is kept.')}
            </p>
          ) : null}
          <div className="mt-2 space-y-1">
            <RangeField
              label={l('总边预算', 'Edge budget')}
              value={props.edgeBudget}
              min={0}
              max={200000}
              step={5000}
              onChange={props.onEdgeBudgetChange}
            />
            <label className="flex items-center justify-between text-[11px] text-[var(--pq-text-muted)]">
              {l('低缩放 LOD', 'Low-zoom LOD')}
              <input
                type="checkbox"
                checked={props.lodEnabled}
                onChange={(event) => props.onLodEnabledChange(event.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--pq-accent)]"
              />
            </label>
            {props.lodEnabled ? (
              <RangeField
                label={l('LOD 保留比例', 'LOD keep ratio')}
                value={Math.round(props.lodRatio * 100)}
                min={5}
                max={100}
                step={5}
                onChange={(value) => props.onLodRatioChange(value / 100)}
                suffix="%"
              />
            ) : null}
            <label className="flex items-center justify-between text-[11px] text-[var(--pq-text-muted)]">
              {l('大规模自动聚合', 'Auto-aggregate large graphs')}
              <input
                type="checkbox"
                checked={props.aggregateEnabled}
                onChange={(event) => props.onAggregateEnabledChange(event.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--pq-accent)]"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-[11px] text-[var(--pq-text-muted)]">
              {l('聚合阈值', 'Aggregate above')}
              <input
                type="number"
                min={200}
                max={10000}
                step={100}
                value={props.aggregateThreshold}
                onChange={(event) => props.onAggregateThresholdChange(Number(event.target.value))}
                className="h-7 w-20 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-1.5 text-right text-[11px]"
              />
            </label>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel
          title={l('自定义关系', 'Custom Relations')}
          icon={<Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
          summary={props.relationSourceNode ? l('已选起点', 'Source set') : undefined}
          collapsed={props.collapsedPanels.customRelations}
          onToggle={() => props.onTogglePanel('customRelations')}
        >
          <div className="space-y-2">
            <button
              type="button"
              disabled={!props.selectedNode}
              onClick={props.onUseSelectedAsSource}
              className="pq-button h-8 w-full justify-center px-2 text-xs disabled:opacity-40"
            >
              {props.relationSourceNode
                ? l(`起点：${props.displayNodeLabel(props.relationSourceNode)}`, `Source: ${props.displayNodeLabel(props.relationSourceNode)}`)
                : l('将选中节点设为起点', 'Use selected node as source')}
            </button>
            <input
              value={props.relationTargetSearch}
              onChange={(event) => props.onRelationTargetSearchChange(event.target.value)}
              placeholder={l('搜索终点节点', 'Search target node')}
              className="h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)] outline-none"
            />
            <div className="max-h-36 overflow-auto rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)]">
              {props.relationTargetOptions.length > 0 ? props.relationTargetOptions.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => props.onChooseRelationTarget(node)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-[var(--pq-bg-secondary)]',
                    props.selectedNode?.id === node.id ? 'text-[var(--pq-accent)]' : 'text-[var(--pq-text-muted)]',
                  )}
                >
                  <span className="min-w-0 truncate">{props.displayNodeLabel(node)}</span>
                  <span className="shrink-0 text-[11px] uppercase text-[var(--pq-text-faint)]">{node.type}</span>
                </button>
              )) : (
                <div className="px-2 py-2 text-[11px] text-[var(--pq-text-faint)]">{l('没有匹配节点', 'No matching nodes')}</div>
              )}
            </div>
            <input
              value={props.relationLabel}
              onChange={(event) => props.onRelationLabelChange(event.target.value)}
              placeholder={l('关系名，例如：方法相似', 'Relation label, e.g. similar method')}
              className="h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)] outline-none"
            />
            <textarea
              value={props.relationDescription}
              onChange={(event) => props.onRelationDescriptionChange(event.target.value)}
              placeholder={l('可选说明', 'Optional description')}
              className="min-h-16 w-full resize-none rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 py-2 text-xs leading-5 text-[var(--pq-text)] outline-none"
            />
            <button
              type="button"
              disabled={props.relationWorking || !props.relationSourceNode || !props.relationTargetNode
                || props.relationSourceNode.id === props.relationTargetNode.id}
              onClick={props.onCreateRelation}
              className="pq-button h-8 w-full justify-center px-2 text-xs disabled:opacity-40"
            >
              {props.relationWorking
                ? l('保存中...', 'Saving...')
                : props.relationTargetNode
                  ? l(`添加关系：${props.displayNodeLabel(props.relationTargetNode)}`, `Add relation to ${props.displayNodeLabel(props.relationTargetNode)}`)
                  : l('先选择终点节点', 'Choose a target node first')}
            </button>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel
          title={l('图谱统计', 'Graph Stats')}
          summary={`${props.nodeCount}/${props.edgeCount}`}
          collapsed={props.collapsedPanels.graphStats}
          onToggle={() => props.onTogglePanel('graphStats')}
        >
          {props.graphQuality ? (
            <div className="mb-2 space-y-1 rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-2)] p-2 text-[11px] leading-5 text-[var(--pq-text-muted)]">
              <div>
                {l(
                  `语义覆盖 ${props.graphQuality.semanticCoverage.indexed}/${props.graphQuality.semanticCoverage.total} · 分量 ${props.graphQuality.componentCount} · 最大度数 ${props.graphQuality.degreeMax}`,
                  `Semantic coverage ${props.graphQuality.semanticCoverage.indexed}/${props.graphQuality.semanticCoverage.total} · components ${props.graphQuality.componentCount} · max degree ${props.graphQuality.degreeMax}`,
                )}
              </div>
              <div>
                {l(
                  `度数中位 ${props.graphQuality.degreeMedian} · 孤立 ${props.graphQuality.isolatedCount} · Hubness ${props.graphQuality.hubnessSkew.toFixed(2)}`,
                  `Median degree ${props.graphQuality.degreeMedian} · isolated ${props.graphQuality.isolatedCount} · hubness ${props.graphQuality.hubnessSkew.toFixed(2)}`,
                )}
              </div>
              {props.graphQuality.isolatedCount > 0 ? (
                <div className="text-[var(--pq-warning)]">
                  {l(`有 ${props.graphQuality.isolatedCount} 个孤立节点`, `${props.graphQuality.isolatedCount} isolated nodes`)}
                </div>
              ) : null}
              {props.graphQuality.hubnessSkew > 1.4 ? (
                <div className="text-[var(--pq-warning)]">
                  {l('语义边仍集中在少数 hub，可降低邻居数或检查索引质量。', 'Semantic edges still concentrate on a few hubs; lower K or check index quality.')}
                </div>
              ) : null}
              {props.graphQuality.degreeMax > props.embeddingNeighbors * 2 ? (
                <div className="text-[var(--pq-warning)]">
                  {l(
                    `最大度数 ${props.graphQuality.degreeMax} 超过 2×K（${props.embeddingNeighbors * 2}），检查桥边或标签层是否开启。`,
                    `Max degree ${props.graphQuality.degreeMax} exceeds 2×K (${props.embeddingNeighbors * 2}); check bridge edges or annotation layers.`,
                  )}
                </div>
              ) : null}
              {props.graphQuality.componentCount > 1 ? (
                <div className="text-[var(--pq-warning)]">
                  {l(
                    `图仍有 ${props.graphQuality.componentCount} 个连通分量；可启用桥接或检查孤立主题。`,
                    `Still ${props.graphQuality.componentCount} components; enable bridging or inspect isolated topics.`,
                  )}
                </div>
              ) : null}
              {props.samplingSummary ? (
                <div className="text-[10px] text-[var(--pq-text-faint)]">{props.samplingSummary}</div>
              ) : null}
              {props.perf.layoutStrategy === 'grid' ? (
                <div className="text-[var(--pq-warning)]">
                  {l(
                    '当前图较大，已使用快速网格布局；开启“大规模自动聚合”可获得力导向主题布局。',
                    'Large graph: using the fast grid layout. Enable auto-aggregation for a force-directed topic layout.',
                  )}
                </div>
              ) : null}
              <div className="text-[10px] text-[var(--pq-text-faint)]">
                {l(
                  `快照 ${props.perf.snapshotMs ?? '—'}ms · 元素 ${props.perf.elementsMs ?? '—'}ms · 布局 ${props.perf.layoutMs ?? '—'}ms · 首帧 ${props.perf.firstFrameMs ?? '—'}ms`,
                  `Snapshot ${props.perf.snapshotMs ?? '—'}ms · elements ${props.perf.elementsMs ?? '—'}ms · layout ${props.perf.layoutMs ?? '—'}ms · first frame ${props.perf.firstFrameMs ?? '—'}ms`,
                )}
              </div>
              <div className="text-[10px] text-[var(--pq-text-faint)]">
                {l(
                  `交互帧 p50 ${props.perf.interactionP50 ?? '—'}ms · p95 ${props.perf.interactionP95 ?? '—'}ms · 布局 ${props.perf.layoutStrategy ?? '—'}`,
                  `Interaction frame p50 ${props.perf.interactionP50 ?? '—'}ms · p95 ${props.perf.interactionP95 ?? '—'}ms · layout ${props.perf.layoutStrategy ?? '—'}`,
                )}
              </div>
            </div>
          ) : null}
          <div className="space-y-1">
            {props.topNodes.length > 0 ? props.topNodes.map((item, index) => (
              <button
                key={item.node.id}
                type="button"
                onClick={() => props.onFocusNode(item.node)}
                className="flex w-full items-center gap-2 rounded-[var(--pq-radius-sm)] px-2 py-1.5 text-left text-[11px] text-[var(--pq-text-muted)] hover:bg-[var(--pq-bg-secondary)] hover:text-[var(--pq-text)]"
              >
                <span className="w-4 shrink-0 text-[var(--pq-text-faint)]">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{props.displayNodeLabel(item.node)}</span>
                <span className="shrink-0 rounded bg-[var(--pq-bg-secondary)] px-1.5 py-0.5 text-[11px]">{item.degree}</span>
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
        <div className="grid grid-cols-7 gap-1.5">
          <button type="button" onClick={props.onRefresh} className="pq-button h-8 px-1.5 text-xs" title={l('刷新', 'Refresh')}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={props.onRerunLayout} className="pq-button h-8 px-1.5 text-xs" title={l('重新布局', 'Re-layout')}>
            <GitBranch className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={props.onFit} className="pq-button h-8 px-1.5 text-xs" title={l('适配视图', 'Fit view')}>
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={props.onFocusSelectedAsLocal}
            disabled={!props.canFocusSelected}
            className="pq-button h-8 px-1.5 text-xs disabled:opacity-40"
            title={l('设为局部中心', 'Use as local center')}
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={props.onExportPng} className="pq-button h-8 px-1.5 text-xs" title={l('导出 PNG', 'Export PNG')}>
            <Download className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={props.onExportJson} className="pq-button h-8 px-1.5 text-xs" title={l('导出 JSON', 'Export JSON')}>
            <FileJson2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={props.onSyncReferences}
            disabled={props.referenceSyncWorking}
            className="pq-button h-8 px-1.5 text-xs disabled:opacity-40"
            title={l('同步参考文献', 'Sync references')}
          >
            {props.referenceSyncWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          </button>
        </div>
        {props.referenceSyncProgress ? (
          <div className="mt-2 truncate text-[11px] text-[var(--pq-text-muted)]">
            {l(
              `参考文献 ${props.referenceSyncProgress.current}/${props.referenceSyncProgress.total}，成功 ${props.referenceSyncProgress.fetched}，跳过 ${props.referenceSyncProgress.skipped}，失败 ${props.referenceSyncProgress.failed}`,
              `References ${props.referenceSyncProgress.current}/${props.referenceSyncProgress.total}, fetched ${props.referenceSyncProgress.fetched}, skipped ${props.referenceSyncProgress.skipped}, failed ${props.referenceSyncProgress.failed}`,
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export const GRAPH_NODE_TYPE_OPTIONS: GraphNodeTypeOption[] = [
  { type: 'paper', zh: '文献', en: 'Papers', icon: FileText },
  { type: 'note', zh: '笔记', en: 'Notes', icon: StickyNote },
  { type: 'tag', zh: '标签', en: 'Tags', icon: Filter },
  { type: 'category', zh: '分类', en: 'Collections', icon: GitBranch },
  { type: 'reference', zh: '引用', en: 'References', icon: Link2 },
];

export const GRAPH_EDGE_TYPE_OPTIONS: GraphEdgeTypeOption[] = [
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

export const GRAPH_NODE_COLOR_MAP = GRAPH_NODE_COLORS;
