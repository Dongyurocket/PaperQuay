// B7.3: right-side inspector with overview / connections / stats tabs.

import { useMemo, useState } from 'react';
import {
  Crosshair,
  ExternalLink,
  Info,
  Link2,
  Trash2,
  X,
} from 'lucide-react';
import type {
  GraphQuality,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from '../../types/knowledgeGraph.ts';
import { GRAPH_EDGE_COLORS } from './graphPresentation.ts';
import { cn } from '../../utils/cn';

export type GraphInspectorTab = 'overview' | 'connections' | 'stats';

export interface GraphEdgeEditState {
  label: string;
  description: string;
  weight: number;
  working: boolean;
}

export interface GraphInspectorProps {
  node: KnowledgeGraphNode | null;
  edge: KnowledgeGraphEdge | null;
  nodeById: ReadonlyMap<string, KnowledgeGraphNode>;
  connections: Array<{ edge: KnowledgeGraphEdge; other: KnowledgeGraphNode | null; sharedTags?: string[] }>;
  customEdges: KnowledgeGraphEdge[];
  edgeEdit: GraphEdgeEditState | null;
  graphQuality?: GraphQuality | null;
  displayNodeLabel: (node: Pick<KnowledgeGraphNode, 'type' | 'label'>) => string;
  edgeTypeLabel: (type: KnowledgeGraphEdge['type']) => string;
  ragStatusLabel: (status: KnowledgeGraphNode['ragStatus']) => string;
  l: (zh: string, en: string) => string;
  onClose: () => void;
  onOpenNode: (node: KnowledgeGraphNode) => void;
  onFocusLocal: (node: KnowledgeGraphNode) => void;
  onStartQuickRelation: (node: KnowledgeGraphNode) => void;
  onSelectEdge: (edge: KnowledgeGraphEdge) => void;
  onSelectNode: (node: KnowledgeGraphNode) => void;
  onDeleteRelation: (relationId: string) => void;
  onEdgeEditChange: (next: GraphEdgeEditState) => void;
  onSaveEdgeEdit: () => void;
  onFocusEdgeNode: (node: KnowledgeGraphNode) => void;
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] leading-5">
      <span className="text-[var(--pq-text-faint)]">{label}</span>
      <span className="min-w-0 truncate text-right text-[var(--pq-text)]">{value}</span>
    </div>
  );
}

function directionLabel(
  edge: KnowledgeGraphEdge,
  node: KnowledgeGraphNode,
  l: (zh: string, en: string) => string,
): string {
  if (edge.source === node.id && edge.target === node.id) return l('自环', 'self');
  return edge.source === node.id ? l('出', 'out') : l('入', 'in');
}

export function GraphInspector(props: GraphInspectorProps) {
  const [tab, setTab] = useState<GraphInspectorTab>('overview');
  const { node, edge, nodeById, displayNodeLabel, edgeTypeLabel } = props;

  const groupedConnections = useMemo(() => {
    const groups = new Map<string, GraphInspectorProps['connections']>();
    for (const connection of props.connections) {
      const list = groups.get(connection.edge.type) ?? [];
      list.push(connection);
      groups.set(connection.edge.type, list);
    }
    return [...groups.entries()].sort((left, right) => right[1].length - left[1].length);
  }, [props.connections]);

  if (!node && !edge) return null;

  return (
    <aside className="absolute bottom-4 right-4 top-16 z-10 flex w-[344px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] shadow-[var(--pq-shadow-float)]">
      <div className="flex items-center gap-2 border-b border-[var(--pq-border)] px-3 py-2">
        <span className="rounded-md bg-[var(--pq-accent-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--pq-accent)]">
          {node ? node.type : edge?.type}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--pq-text)]">
          {node ? displayNodeLabel(node) : (edge?.label || edge?.type || '')}
        </span>
        <button
          type="button"
          className="pq-icon-button h-6 w-6 shrink-0"
          title={props.l('关闭详情', 'Close details')}
          aria-label={props.l('关闭详情', 'Close details')}
          onClick={props.onClose}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>

      {node ? (
        <>
          <div className="flex shrink-0 gap-1 border-b border-[var(--pq-border)] px-2 py-1.5">
            {([
              ['overview', props.l('概览', 'Overview')],
              ['connections', props.l(`连接 ${props.connections.length}`, `Links ${props.connections.length}`)],
              ['stats', props.l('统计', 'Stats')],
            ] as const).map(([id, zh]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'h-7 rounded-[var(--pq-radius-sm)] px-2 text-[11px] font-medium transition',
                  tab === id
                    ? 'bg-[var(--pq-bg-secondary)] text-[var(--pq-text)]'
                    : 'text-[var(--pq-text-muted)] hover:text-[var(--pq-text)]',
                )}
              >
                {zh}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === 'overview' ? (
              <>
                {node.subtitle ? (
                  <p className="line-clamp-3 text-xs leading-5 text-[var(--pq-text-muted)]">
                    {node.subtitle}
                  </p>
                ) : null}
                <div className="mt-3 space-y-1 rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-2)] p-2">
                  <StatRow label={props.l('度数', 'Degree')} value={node.degree ?? 0} />
                  <StatRow label={props.l('年份', 'Year')} value={node.year || '—'} />
                  <StatRow label={props.l('阅读进度', 'Reading')} value={`${Math.round((node.readingProgress ?? 0) * 100)}%`} />
                  {node.ragStatus ? <StatRow label={props.l('RAG 状态', 'RAG')} value={props.ragStatusLabel(node.ragStatus)} /> : null}
                  {node.categoryIds?.length ? <StatRow label={props.l('分类数', 'Collections')} value={String(node.categoryIds.length)} /> : null}
                </div>
                {node.categoryNames?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {node.categoryNames.slice(0, 6).map((name) => (
                      <span key={name} className="rounded bg-[var(--pq-accent-bg)] px-1.5 py-0.5 text-[10px] text-[var(--pq-accent)]">{name}</span>
                    ))}
                  </div>
                ) : null}
                {node.tags?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {node.tags.slice(0, 8).map((tag) => (
                      <span key={tag} className="rounded bg-[var(--pq-bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--pq-text-muted)]">#{tag}</span>
                    ))}
                  </div>
                ) : null}
                {node.doi ? (
                  <div className="mt-2 truncate rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] px-2 py-1 text-[11px] text-[var(--pq-text-muted)]">
                    DOI: {node.doi}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!(node.paperId || node.noteId)}
                    onClick={() => props.onOpenNode(node)}
                    className="pq-button h-8 px-3 text-xs disabled:opacity-40"
                  >
                    <ExternalLink className="mr-1 h-3.5 w-3.5" /> {props.l('打开', 'Open')}
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onFocusLocal(node)}
                    className="pq-button h-8 px-3 text-xs"
                  >
                    <Crosshair className="mr-1 h-3.5 w-3.5" /> {props.l('局部图谱', 'Local')}
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onStartQuickRelation(node)}
                    className="pq-button h-8 px-3 text-xs"
                  >
                    <Link2 className="mr-1 h-3.5 w-3.5" /> {props.l('连线', 'Link')}
                  </button>
                </div>
                {props.customEdges.length > 0 ? (
                  <div className="mt-3 border-t border-[var(--pq-border)] pt-2">
                    <div className="mb-1.5 text-[11px] font-semibold text-[var(--pq-text)]">
                      {props.l('人工 / AI 关系', 'Manual / AI relations')}
                    </div>
                    <div className="space-y-1">
                      {props.customEdges.map((customEdge) => {
                        const other = nodeById.get(customEdge.source === node.id ? customEdge.target : customEdge.source);
                        return (
                          <div key={customEdge.id} className="flex items-center gap-2 rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] px-2 py-1.5">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] font-medium text-[var(--pq-text)]">
                                {customEdge.label} → {other ? displayNodeLabel(other) : customEdge.target}
                              </div>
                              {customEdge.description ? (
                                <div className="truncate text-[11px] text-[var(--pq-text-faint)]">{customEdge.description}</div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => props.onDeleteRelation(customEdge.id)}
                              className="pq-icon-button h-6 w-6"
                              title={props.l('删除关系', 'Delete relation')}
                              aria-label={props.l('删除关系', 'Delete relation')}
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {tab === 'connections' ? (
              <div className="space-y-3">
                {groupedConnections.length === 0 ? (
                  <div className="text-[11px] text-[var(--pq-text-faint)]">{props.l('没有可见连接。', 'No visible connections.')}</div>
                ) : groupedConnections.map(([type, list]) => (
                  <section key={type}>
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--pq-text)]">
                      <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: GRAPH_EDGE_COLORS[type as KnowledgeGraphEdge['type']] }} />
                      {edgeTypeLabel(type as KnowledgeGraphEdge['type'])}
                      <span className="font-normal text-[var(--pq-text-faint)]">{list.length}</span>
                    </div>
                    <div className="space-y-1">
                      {list.map(({ edge: connection, other, sharedTags }) => (
                        <button
                          key={connection.id}
                          type="button"
                          onClick={() => props.onSelectEdge(connection)}
                          className="w-full rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] px-2 py-1.5 text-left text-[11px] hover:text-[var(--pq-text)]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[var(--pq-text)]">
                              {other ? displayNodeLabel(other) : (connection.source === node.id ? connection.target : connection.source)}
                            </span>
                            <span className="shrink-0 text-[10px] text-[var(--pq-text-faint)]">
                              {directionLabel(connection, node, props.l)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--pq-text-faint)]">
                            {connection.type === 'related_by_embedding' && Number.isFinite(Number(connection.similarity))
                              ? <span>{props.l('相似度', 'Similarity')} {Number(connection.similarity).toFixed(3)}</span>
                              : null}
                            {connection.description && connection.type !== 'related_by_embedding'
                              ? <span className="min-w-0 truncate">{connection.description}</span>
                              : null}
                            {sharedTags?.length ? <span className="min-w-0 truncate">#{sharedTags.slice(0, 3).join(' #')}</span> : null}
                            {Number.isFinite(Number(connection.weight))
                              ? <span className="ml-auto shrink-0">w {Number(connection.weight).toFixed(2)}</span>
                              : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}

            {tab === 'stats' ? (
              <div className="space-y-2">
                <div className="rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-2)] p-2">
                  <StatRow label={props.l('度数', 'Degree')} value={node.degree ?? 0} />
                  <StatRow label={props.l('可见连接', 'Visible links')} value={props.connections.length} />
                  <StatRow label={props.l('类型', 'Type')} value={node.type} />
                </div>
                {props.graphQuality ? (
                  <div className="rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-2)] p-2">
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--pq-text)]">
                      <Info className="h-3.5 w-3.5" /> {props.l('图谱质量', 'Graph quality')}
                    </div>
                    <StatRow label={props.l('节点 / 边', 'Nodes / edges')} value={`${props.graphQuality.nodeCount} / ${props.graphQuality.edgeCount}`} />
                    <StatRow label={props.l('分量', 'Components')} value={props.graphQuality.componentCount} />
                    <StatRow label={props.l('最大度数', 'Max degree')} value={props.graphQuality.degreeMax} />
                    <StatRow label={props.l('孤立节点', 'Isolated')} value={props.graphQuality.isolatedCount} />
                    <StatRow
                      label="Semantic coverage"
                      value={`${props.graphQuality.semanticCoverage.indexed}/${props.graphQuality.semanticCoverage.total}`}
                    />
                    <StatRow label={props.l('Hubness (S10)', 'Hubness (S10)')} value={props.graphQuality.hubnessSkew.toFixed(2)} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {edge ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-1.5 text-xs text-[var(--pq-text-muted)]">
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[var(--pq-text-faint)]">{props.l('起点', 'From')}</span>
              <span className="min-w-0 truncate text-[var(--pq-text)]">
                {nodeById.get(edge.source) ? displayNodeLabel(nodeById.get(edge.source) as KnowledgeGraphNode) : edge.source}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[var(--pq-text-faint)]">{props.l('终点', 'To')}</span>
              <span className="min-w-0 truncate text-[var(--pq-text)]">
                {nodeById.get(edge.target) ? displayNodeLabel(nodeById.get(edge.target) as KnowledgeGraphNode) : edge.target}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[var(--pq-text-faint)]">{props.l('类型', 'Type')}</span>
              <span className="min-w-0 truncate text-[var(--pq-text)]">{edgeTypeLabel(edge.type)}</span>
            </div>
            {Number.isFinite(Number(edge.similarity)) ? (
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[var(--pq-text-faint)]">{props.l('相似度', 'Similarity')}</span>
                <span className="min-w-0 truncate text-[var(--pq-text)]">{Number(edge.similarity).toFixed(4)}（中心化）</span>
              </div>
            ) : null}
            {Number.isFinite(Number(edge.weight)) ? (
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[var(--pq-text-faint)]">{props.l('权重', 'Weight')}</span>
                <span className="min-w-0 truncate text-[var(--pq-text)]">{Number(edge.weight).toFixed(2)}</span>
              </div>
            ) : null}
          </div>

          {props.edgeEdit ? (
            <div className="mt-3 space-y-2">
              <input
                value={props.edgeEdit.label}
                maxLength={80}
                onChange={(event) => props.onEdgeEditChange({ ...props.edgeEdit as GraphEdgeEditState, label: event.target.value })}
                placeholder={props.l('关系名（最多 80 字）', 'Relation label (max 80 chars)')}
                className="h-8 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 text-xs text-[var(--pq-text)] outline-none"
              />
              <textarea
                value={props.edgeEdit.description}
                maxLength={2000}
                onChange={(event) => props.onEdgeEditChange({ ...props.edgeEdit as GraphEdgeEditState, description: event.target.value })}
                placeholder={props.l('说明（最多 2000 字）', 'Description (max 2000 chars)')}
                className="min-h-14 w-full resize-none rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2 py-2 text-xs leading-5 text-[var(--pq-text)] outline-none"
              />
              <label className="flex items-center gap-2 text-xs text-[var(--pq-text-muted)]">
                {props.l('权重', 'Weight')}
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={props.edgeEdit.weight}
                  onChange={(event) => props.onEdgeEditChange({ ...props.edgeEdit as GraphEdgeEditState, weight: Number(event.target.value) })}
                  className="flex-1 accent-[var(--pq-accent)]"
                />
                <span className="w-10 text-right tabular-nums text-[var(--pq-text)]">{props.edgeEdit.weight.toFixed(2)}</span>
              </label>
              <button
                type="button"
                disabled={props.edgeEdit.working || !props.edgeEdit.label.trim()}
                onClick={props.onSaveEdgeEdit}
                className="pq-button h-8 w-full justify-center px-3 text-xs disabled:opacity-40"
              >
                {props.edgeEdit.working ? props.l('保存中...', 'Saving...') : props.l('保存关系修改', 'Save relation changes')}
              </button>
            </div>
          ) : edge.description ? (
            <p className="mt-3 line-clamp-4 rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] px-2 py-2 text-xs leading-5 text-[var(--pq-text-muted)]">
              {edge.description}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {nodeById.get(edge.source) ? (
              <button type="button" onClick={() => props.onFocusEdgeNode(nodeById.get(edge.source) as KnowledgeGraphNode)} className="pq-button h-8 px-3 text-xs">
                {props.l('定位起点', 'Focus From')}
              </button>
            ) : null}
            {nodeById.get(edge.target) ? (
              <button type="button" onClick={() => props.onFocusEdgeNode(nodeById.get(edge.target) as KnowledgeGraphNode)} className="pq-button h-8 px-3 text-xs">
                {props.l('定位终点', 'Focus To')}
              </button>
            ) : null}
            {edge.type === 'custom_relation' ? (
              <button
                type="button"
                onClick={() => props.onDeleteRelation(edge.id)}
                className="pq-button h-8 px-3 text-xs text-[var(--pq-danger)]"
              >
                {props.l('删除', 'Delete')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
