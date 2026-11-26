// S5-GRAPH-1: deterministic fallback used when the layout worker cannot be
// created or fails. cytoscape/fcose are imported lazily so the renderer only
// pays for them when the worker path is unavailable.

import {
  packDisconnectedComponents,
  type GraphLayoutPosition,
  type GraphLayoutRequestPayload,
} from './graphLayoutMessages.ts';

export async function runMainThreadGraphLayout(
  request: GraphLayoutRequestPayload,
): Promise<GraphLayoutPosition[]> {
  const cytoscapeModule = await import('cytoscape');
  const fcoseModule = await import('cytoscape-fcose');
  const cytoscape = cytoscapeModule.default;
  const fcose = fcoseModule.default;

  cytoscape.use(fcose);

  const elements = [
    ...request.nodes.map((node) => ({
      data: {
        id: node.id,
        type: node.type ?? '',
        size: Number(node.size) || 28,
        degree: Number(node.degree) || 0,
      },
      style: { width: Number(node.size) || 28, height: Number(node.size) || 28 },
    })),
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
  const cy = cytoscape({ headless: true, elements, styleEnabled: true });

  try {
    const layout = cy.layout(request.options as unknown as cytoscape.LayoutOptions);
    layout.run();

    const positions = cy.nodes().map((node) => ({
      id: node.id(),
      x: node.position('x'),
      y: node.position('y'),
    }));
    return request.options.packComponents === false
      ? positions
      : packDisconnectedComponents(request.nodes, request.edges, positions);
  } finally {
    cy.destroy();
  }
}
