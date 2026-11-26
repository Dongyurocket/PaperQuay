// B7.2: lightweight pointer tooltip (not the native title element).

import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from '../../types/knowledgeGraph.ts';
import { GRAPH_EDGE_COLORS } from './graphPresentation.ts';
import type { GraphHoverPayload } from './graphEvents.ts';

export interface GraphTooltipProps {
  hover: GraphHoverPayload | null;
  nodeById: ReadonlyMap<string, KnowledgeGraphNode>;
  displayNodeLabel: (node: Pick<KnowledgeGraphNode, 'type' | 'label'>) => string;
  edgeTypeLabel: (type: KnowledgeGraphEdge['type']) => string;
  ragStatusLabel: (status: KnowledgeGraphNode['ragStatus']) => string;
  l: (zh: string, en: string) => string;
  containerWidth: number;
}

const TOOLTIP_WIDTH = 260;
const TOOLTIP_HEIGHT = 120;

export function GraphTooltip(props: GraphTooltipProps) {
  const { hover, l } = props;
  if (!hover) return null;

  const left = Math.max(8, Math.min(hover.x + 14, Math.max(8, props.containerWidth - TOOLTIP_WIDTH - 8)));
  const top = Math.max(8, hover.y - TOOLTIP_HEIGHT - 12);

  if (hover.kind === 'node' && hover.node) {
    const node = hover.node;
    return (
      <div
        className="pointer-events-none absolute z-30 w-[260px] rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2.5 py-2 text-[11px] leading-4 text-[var(--pq-text-muted)] shadow-[var(--pq-shadow-float)]"
        style={{ left, top }}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span className="rounded bg-[var(--pq-bg-secondary)] px-1 py-0.5 text-[10px] uppercase text-[var(--pq-text-faint)]">{node.type}</span>
          <span className="min-w-0 flex-1 truncate font-semibold text-[var(--pq-text)]">{props.displayNodeLabel(node)}</span>
        </div>
        {node.subtitle ? <div className="line-clamp-2">{node.subtitle}</div> : null}
        {node.categoryNames?.length ? (
          <div className="mt-1 line-clamp-1 text-[10px] text-[var(--pq-text-muted)]">{node.categoryNames.join(' · ')}</div>
        ) : null}
        {node.tags?.length ? (
          <div className="mt-0.5 line-clamp-1 text-[10px] text-[var(--pq-text-faint)]">#{node.tags.slice(0, 5).join(' #')}</div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--pq-text-faint)]">
          {node.year ? <span>{node.year}</span> : null}
          <span>{l('度数', 'Degree')} {node.degree ?? 0}</span>
          {node.type === 'paper' ? <span>{l('阅读', 'Read')} {Math.round((node.readingProgress ?? 0) * 100)}%</span> : null}
          {node.ragStatus ? <span>RAG {props.ragStatusLabel(node.ragStatus)}</span> : null}
        </div>
      </div>
    );
  }

  if (hover.kind === 'edge' && hover.edge) {
    const edge = hover.edge;
    const source = props.nodeById.get(edge.source);
    const target = props.nodeById.get(edge.target);
    return (
      <div
        className="pointer-events-none absolute z-30 w-[260px] rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2.5 py-2 text-[11px] leading-4 text-[var(--pq-text-muted)] shadow-[var(--pq-shadow-float)]"
        style={{ left, top }}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: GRAPH_EDGE_COLORS[edge.type] }} />
          <span className="min-w-0 flex-1 truncate font-semibold text-[var(--pq-text)]">{props.edgeTypeLabel(edge.type)}</span>
        </div>
        <div className="truncate">
          {source ? props.displayNodeLabel(source) : edge.source}
          {' → '}
          {target ? props.displayNodeLabel(target) : edge.target}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-[var(--pq-text-faint)]">
          {Number.isFinite(Number(edge.similarity)) ? (
            <span>{l('相似度', 'Similarity')} {Number(edge.similarity).toFixed(3)}（{l('中心化', 'centered')}）</span>
          ) : null}
          {Number.isFinite(Number(edge.weight)) ? <span>w {Number(edge.weight).toFixed(2)}</span> : null}
          {edge.type === 'paper_cites_paper' ? <span>{l('引用，不代表相似', 'Citation, not similarity')}</span> : null}
          {edge.type === 'related_by_embedding' ? <span>{l('相似，不代表引用', 'Similarity, not citation')}</span> : null}
        </div>
      </div>
    );
  }

  return null;
}
