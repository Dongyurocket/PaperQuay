// B7.3: Cytoscape event wiring for the knowledge graph.
//
// The workspace owns React state; this module only translates Cytoscape events
// into handler calls. Handlers live behind a ref so typing in the sidebar does
// not reconstruct the graph.

import type { Core, EdgeSingular, EventObject, NodeSingular } from 'cytoscape';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '../../types/knowledgeGraph.ts';

export interface GraphHoverPayload {
  kind: 'node' | 'edge';
  node?: KnowledgeGraphNode;
  edge?: KnowledgeGraphEdge;
  x: number;
  y: number;
}

export interface GraphEventHandlers {
  onNodeTap(node: KnowledgeGraphNode, target: NodeSingular): void;
  onEdgeTap(edge: KnowledgeGraphEdge, target: EdgeSingular): void;
  onBackgroundTap(): void;
  onNodeDoubleTap(node: KnowledgeGraphNode): void;
  onNodeContextMenu(node: KnowledgeGraphNode, position: { x: number; y: number }): void;
  onHover(payload: GraphHoverPayload | null): void;
  /** 用户手势触发的缩放/平移；用于停止自动 fit，不用于持久化。 */
  onViewAdjusted(): void;
  onZoom(zoom: number): void;
  /** 节点拖拽结束；用于持久化坐标。 */
  onDragFree(): void;
  /** 快速连线模式下点击目标节点；返回 true 表示已消费本次点击。 */
  onQuickRelationTarget(node: KnowledgeGraphNode): boolean;
  onEscape(): void;
}

export interface AttachGraphEventsOptions {
  container: HTMLDivElement;
  handlersRef: { current: GraphEventHandlers };
}

export function attachGraphEvents(
  cy: Core,
  { container, handlersRef }: AttachGraphEventsOptions,
): () => void {
  const setCursor = (value: string) => {
    container.style.setProperty('cursor', value);
  };

  const markUserAdjustedView = (event: EventObject) => {
    if (event.originalEvent) {
      handlersRef.current.onViewAdjusted();
    }
  };

  cy.on('zoom', (event) => {
    markUserAdjustedView(event);
    handlersRef.current.onZoom(cy.zoom());
  });
  cy.on('dragpan', markUserAdjustedView);
  cy.on('dragfree', 'node', () => {
    handlersRef.current.onDragFree();
  });

  cy.on('tap', 'node', (event) => {
    const node = event.target.data() as KnowledgeGraphNode;
    if (handlersRef.current.onQuickRelationTarget(node)) return;
    handlersRef.current.onNodeTap(node, event.target);
  });

  cy.on('tap', 'edge', (event) => {
    handlersRef.current.onEdgeTap(event.target.data() as KnowledgeGraphEdge, event.target);
  });

  cy.on('tap', (event) => {
    if (event.target === cy) {
      handlersRef.current.onBackgroundTap();
    }
  });

  cy.on('dbltap', 'node', (event) => {
    handlersRef.current.onNodeDoubleTap(event.target.data() as KnowledgeGraphNode);
  });

  cy.on('cxttap', 'node', (event) => {
    handlersRef.current.onNodeContextMenu(
      event.target.data() as KnowledgeGraphNode,
      { x: event.renderedPosition.x, y: event.renderedPosition.y },
    );
  });

  const emitHover = (
    kind: 'node' | 'edge',
    target: NodeSingular | EdgeSingular,
    event: EventObject,
  ) => {
    const position = (event as EventObject & { renderedPosition?: { x: number; y: number } }).renderedPosition;
    if (!position) return;
    handlersRef.current.onHover(kind === 'node'
      ? { kind, node: target.data() as KnowledgeGraphNode, x: position.x, y: position.y }
      : { kind, edge: target.data() as KnowledgeGraphEdge, x: position.x, y: position.y });
  };

  cy.on('mouseover', 'node', (event) => {
    setCursor('pointer');
    emitHover('node', event.target, event);
  });
  cy.on('mousemove', 'node', (event) => {
    emitHover('node', event.target, event);
  });
  cy.on('mouseout', 'node', () => {
    setCursor('default');
    handlersRef.current.onHover(null);
  });

  cy.on('mouseover', 'edge', (event) => {
    setCursor('pointer');
    emitHover('edge', event.target, event);
  });
  cy.on('mousemove', 'edge', (event) => {
    emitHover('edge', event.target, event);
  });
  cy.on('mouseout', 'edge', () => {
    setCursor('default');
    handlersRef.current.onHover(null);
  });

  cy.on('tapdragover', 'node', () => setCursor('grab'));
  cy.on('tapdragout', 'node', () => setCursor('default'));

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      handlersRef.current.onEscape();
    }
  };
  window.addEventListener('keydown', handleKeyDown);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    setCursor('default');
  };
}
