// S5-GRAPH-1: deterministic fallback used when the layout worker cannot be
// created or fails. cytoscape/fcose are imported lazily so the renderer only
// pays for them when the worker path is unavailable.

import {
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

    return cy.nodes().map((node) => ({
      id: node.id(),
      x: node.position('x'),
      y: node.position('y'),
    }));
  } finally {
    cy.destroy();
  }
}
