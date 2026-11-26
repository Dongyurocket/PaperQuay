// B7.3: canvas overlay controls and interactive legend.

import { Maximize2, Minus, Plus } from 'lucide-react';
import type {
  KnowledgeGraphEdgeType,
  KnowledgeGraphNodeType,
} from '../../types/knowledgeGraph.ts';
import { GRAPH_EDGE_COLORS, GRAPH_NODE_COLORS } from './graphPresentation.ts';
import type { GraphEdgeTypeOption, GraphNodeTypeOption } from './GraphSidebar.tsx';

export interface GraphToolbarProps {
  l: (zh: string, en: string) => string;
  isEnglish: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  nodeTypes: GraphNodeTypeOption[];
  edgeTypes: GraphEdgeTypeOption[];
  nodeTypeCounts: Record<KnowledgeGraphNodeType, number>;
  edgeTypeCounts: Record<KnowledgeGraphEdgeType, number>;
  enabledNodeTypes: Record<KnowledgeGraphNodeType, boolean>;
  enabledEdgeTypes: Record<KnowledgeGraphEdgeType, boolean>;
  onToggleNodeType: (type: KnowledgeGraphNodeType) => void;
  onToggleEdgeType: (type: KnowledgeGraphEdgeType) => void;
}

export function GraphToolbar(props: GraphToolbarProps) {
  const { l, isEnglish } = props;
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 flex max-w-[calc(100%-2rem)] flex-col items-start gap-2">
      <div className="pointer-events-auto flex items-center gap-1 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-1 shadow-[var(--pq-shadow-float)]">
        <button type="button" onClick={props.onZoomOut} className="pq-icon-button h-7 w-7" title={l('缩小', 'Zoom out')} aria-label={l('缩小', 'Zoom out')}>
          <Minus className="h-4 w-4" strokeWidth={1.9} />
        </button>
        <button type="button" onClick={props.onZoomIn} className="pq-icon-button h-7 w-7" title={l('放大', 'Zoom in')} aria-label={l('放大', 'Zoom in')}>
          <Plus className="h-4 w-4" strokeWidth={1.9} />
        </button>
        <button type="button" onClick={props.onFit} className="pq-icon-button h-7 w-7" title={l('适配视图', 'Fit view')} aria-label={l('适配视图', 'Fit view')}>
          <Maximize2 className="h-4 w-4" strokeWidth={1.9} />
        </button>
      </div>

      <div className="pointer-events-auto flex max-w-[340px] flex-col gap-1 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface)] px-2.5 py-1.5 text-[11px] text-[var(--pq-text-muted)] shadow-[var(--pq-shadow-soft)]">
        <div className="flex flex-wrap justify-start gap-x-3 gap-y-1">
          {props.nodeTypes.map((item) => (
            <button
              key={item.type}
              type="button"
              disabled={props.nodeTypeCounts[item.type] === 0}
              onClick={() => props.onToggleNodeType(item.type)}
              title={l(`切换${item.zh}节点`, `Toggle ${item.en} nodes`)}
              className={[
                'inline-flex items-center gap-1 whitespace-nowrap rounded px-0.5 transition disabled:opacity-40',
                props.enabledNodeTypes[item.type] ? 'text-[var(--pq-text)]' : 'text-[var(--pq-text-faint)] line-through',
              ].join(' ')}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GRAPH_NODE_COLORS[item.type] }} />
              {isEnglish ? item.en : item.zh}
              <span className="tabular-nums text-[var(--pq-text-faint)]">{props.nodeTypeCounts[item.type]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap justify-start gap-x-3 gap-y-1 border-t border-[var(--pq-border-soft)] pt-1">
          {props.edgeTypes.map((item) => (
            <button
              key={item.type}
              type="button"
              disabled={props.edgeTypeCounts[item.type] === 0}
              onClick={() => props.onToggleEdgeType(item.type)}
              title={l(`切换${item.zh}关系`, `Toggle ${item.en} edges`)}
              className={[
                'inline-flex items-center gap-1 whitespace-nowrap rounded px-0.5 transition disabled:opacity-40',
                props.enabledEdgeTypes[item.type] ? 'text-[var(--pq-text)]' : 'text-[var(--pq-text-faint)] line-through',
              ].join(' ')}
            >
              <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: GRAPH_EDGE_COLORS[item.type] }} />
              {isEnglish ? item.en : item.zh}
              <span className="tabular-nums text-[var(--pq-text-faint)]">{props.edgeTypeCounts[item.type]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
