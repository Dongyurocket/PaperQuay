// S5-GRAPH-1: fcose runs headless in this module worker so a large global
// layout no longer blocks the React renderer. Positions are posted back and
// applied by a cheap preset layout on the main thread.

import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

import {
  GRAPH_LAYOUT_WORKER_PROTOCOL,
  normalizeGraphForces,
  packDisconnectedComponents,
  resolveEdgeElasticity,
  resolveIdealEdgeLength,
  resolveNodeRepulsion,
  type GraphLayoutWorkerMessage,
  type GraphLayoutWorkerResponse,
} from './graphLayoutMessages.ts';

cytoscape.use(fcose);

interface WorkerScope {
  onmessage: ((event: MessageEvent<GraphLayoutWorkerMessage>) => void) | null;
  postMessage: (message: GraphLayoutWorkerResponse) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const message = event.data;
  if (!message || message.protocol !== GRAPH_LAYOUT_WORKER_PROTOCOL) {
    return;
  }

  const startedAt = Date.now();
  const { id, request } = message;

  try {
    const elements = [
      ...request.nodes.map((node, index) => {
        const size = Number.isFinite(Number(node.size)) ? Math.max(8, Number(node.size)) : 28;
        // 没有历史坐标时按黄金角螺旋给出确定性初始位置：全量布局由 fcose 的谱
        // 初始化覆盖，增量布局（randomize:false）则拿它当松弛起点，避免共线退化。
        const hasPosition = Number.isFinite(Number(node.x))
          && Number.isFinite(Number(node.y))
          && (Number(node.x) !== 0 || Number(node.y) !== 0);
        const angle = index * 2.399963229728653;
        const radius = 36 * Math.sqrt(index + 1);
        return {
          data: {
            id: node.id,
            type: node.type ?? '',
            size,
            degree: Number(node.degree) || 0,
          },
          position: hasPosition
            ? { x: Number(node.x), y: Number(node.y) }
            : { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
          style: { width: size, height: size },
        };
      }),
      ...request.edges.map((edge, index) => ({
        data: {
          id: `layout-edge-${index}`,
          source: edge.source,
          target: edge.target,
          type: edge.type ?? '',
          weight: Number(edge.weight) || 0,
        },
      })),
    ];
    // 需要 styleEnabled 才能让 fcose 读到每个节点的 width/height 与标签尺寸。
    const cy = cytoscape({ headless: true, elements, styleEnabled: true });

    try {
      const forces = normalizeGraphForces(request.options.forces);
      const layoutOptions = {
        ...request.options,
        // 函数不能通过 postMessage 传递；在这里按节点/边类型注入。
        nodeRepulsion: (node: cytoscape.NodeSingular) =>
          resolveNodeRepulsion(forces, String(node.data('type') ?? '')),
        idealEdgeLength: (edge: cytoscape.EdgeSingular) =>
          resolveIdealEdgeLength(forces, String(edge.data('type') ?? '')),
        edgeElasticity: (edge: cytoscape.EdgeSingular) =>
          resolveEdgeElasticity(String(edge.data('type') ?? '')),
      };
      const layout = cy.layout(layoutOptions as unknown as cytoscape.LayoutOptions);
      layout.run();

      const positions = cy.nodes().map((node) => ({
        id: node.id(),
        x: node.position('x'),
        y: node.position('y'),
      }));

      scope.postMessage({
        id,
        protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
        ok: true,
        positions: request.options.packComponents === false
          ? positions
          : packDisconnectedComponents(request.nodes, request.edges, positions),
        durationMs: Date.now() - startedAt,
      });
    } finally {
      cy.destroy();
    }
  } catch (error) {
    scope.postMessage({
      id,
      protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
  }
};
