import test from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';

import {
  buildGraphStyles,
  degradeStylesForWebgl,
  resolveGraphTheme,
} from '../src/features/graph/graphStyles.ts';
import { buildGraphElements } from '../src/features/graph/graphPresentation.ts';
import type { KnowledgeGraphSnapshot } from '../src/types/knowledgeGraph.ts';

const snapshot: KnowledgeGraphSnapshot = {
  generatedAt: 0,
  nodes: [
    { id: 'paper:1', type: 'paper', label: 'Paper', color: '#2563eb', size: 30, readingProgress: 0.5 },
    { id: 'paper:2', type: 'paper', label: 'Paper 2', color: '#2563eb', size: 24 },
    { id: 'note:1', type: 'note', label: 'Note' },
    { id: 'tag:1', type: 'tag', label: '#tag' },
    { id: 'category:1', type: 'category', label: 'Collection' },
  ],
  edges: [
    { id: 'e1', source: 'paper:1', target: 'paper:2', type: 'related_by_embedding', label: 'similar', weight: 0.6 },
    { id: 'e2', source: 'paper:1', target: 'paper:2', type: 'paper_cites_paper', label: 'cites', weight: 0.8 },
  ],
};

test('theme fallbacks are opaque hexes for light and dark', () => {
  const light = resolveGraphTheme(() => '', false);
  const dark = resolveGraphTheme(() => '', true);
  for (const theme of [light, dark]) {
    for (const value of Object.values(theme)) {
      assert.match(value, /^#[0-9a-f]{6}$/i);
    }
  }
  assert.notEqual(light.text, dark.text);
});

test('stylesheet applies node shapes, curves, progress rings and LOD class', () => {
  const styles = buildGraphStyles(resolveGraphTheme(() => '', false)) as Array<{
    selector: string;
    style: Record<string, unknown>;
  }>;
  const bySelector = new Map(styles.map((rule) => [rule.selector, rule.style]));
  assert.equal(bySelector.get('node')?.shape, 'data(shape)');
  assert.equal(bySelector.get('node')?.label, 'data(displayLabel)');
  assert.equal(bySelector.get('node[hasProgress = 1]')?.['background-image'], 'data(progressImage)');
  assert.equal(bySelector.get('edge')?.['curve-style'], 'data(curve)');
  assert.equal(bySelector.get('edge[type = "related_by_embedding"]')?.['line-style'], 'dashed');
  assert.equal(bySelector.get('edge[type = "paper_cites_paper"]')?.['target-arrow-shape'], 'triangle');
  assert.equal(bySelector.get('edge.lod-hidden')?.display, 'none');

  const webgl = degradeStylesForWebgl(buildGraphStyles(resolveGraphTheme(() => '', false))) as Array<{
    selector: string;
    style: Record<string, unknown>;
  }>;
  const webglSemantic = webgl.find((rule) => rule.selector === 'edge[type = "related_by_embedding"]');
  assert.equal(webglSemantic?.style['line-style'], 'solid');
  assert.equal(webglSemantic?.style['line-dash-pattern'], undefined);
});

test('cytoscape accepts the stylesheet with generated elements', () => {
  const elements = buildGraphElements(snapshot, {
    localizeNodeLabel: (node) => node.label,
    colorMode: 'category',
  });
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements,
    style: buildGraphStyles(resolveGraphTheme(() => '', false)),
  });
  try {
    assert.equal(cy.nodes().length, snapshot.nodes.length);
    assert.equal(cy.edges().length, snapshot.edges.length);
    assert.equal(cy.$id('paper:1').data('shape'), 'ellipse');
    assert.equal(cy.$id('note:1').data('shape'), 'round-rectangle');
    assert.equal(cy.$id('tag:1').data('shape'), 'diamond');
    assert.equal(cy.$id('category:1').data('shape'), 'hexagon');
    // 同对两条边：都需要 bezier（平行边）。
    for (const edge of cy.edges()) {
      assert.equal(edge.data('curve'), 'bezier');
      assert.equal(edge.data('multiEdge'), true);
    }
  } finally {
    cy.destroy();
  }
});
