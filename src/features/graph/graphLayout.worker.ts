// S5-GRAPH-1: fcose runs headless in this module worker so a large global
// layout no longer blocks the React renderer. Positions are posted back and
// applied by a cheap preset layout on the main thread.

import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

import {
  GRAPH_LAYOUT_WORKER_PROTOCOL,
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
      ...request.nodes.map((node) => ({ data: { id: node.id } })),
      ...request.edges.map((edge, index) => ({
        data: {
          id: `layout-edge-${index}`,
          source: edge.source,
          target: edge.target,
        },
      })),
    ];
    const cy = cytoscape({ headless: true, elements, styleEnabled: false });

    try {
      const layout = cy.layout(request.options as unknown as cytoscape.LayoutOptions);
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
        positions,
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
