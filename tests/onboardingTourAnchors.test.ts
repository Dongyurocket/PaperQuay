import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Read JSX attributes rather than comments or strings in unrelated code. Both
// data-tour and the StatusChip forwarding prop contribute to the DOM contract.
function tourAnchors(relativePath: string): string[] {
  const source = ts.createSourceFile(
    relativePath,
    readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const anchors: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node)
      && ['data-tour', 'dataTour'].includes(node.name.getText(source))
      && node.initializer && ts.isStringLiteral(node.initializer)) {
      anchors.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return anchors;
}

function overviewTourAnchors(): string[] {
  return [
    ...tourAnchors('features/reader/readerWorkspaceOverview.tsx'),
    ...tourAnchors('features/reader/overview/OverviewProcessMenu.tsx'),
  ];
}

test('mounted library details cannot claim overview or reader tour targets', () => {
  const libraryAnchors = [
    ...tourAnchors('features/literature/LiteratureLibraryView.tsx'),
    ...tourAnchors('features/literature/details/PaperDetailsStatusBar.tsx'),
  ];
  const readerAnchors = new Set([
    ...overviewTourAnchors(),
    ...tourAnchors('features/reader/assistantSidebarPrimitives.tsx'),
  ]);

  assert.ok(libraryAnchors.length > 0);
  assert.ok(readerAnchors.size > 0);
  assert.deepEqual(libraryAnchors.filter((anchor) => readerAnchors.has(anchor)), []);
  assert.equal(new Set(libraryAnchors).size, libraryAnchors.length);
});

test('overview keeps its public tour anchors while the library has distinct equivalents', () => {
  const overviewAnchors = overviewTourAnchors();
  for (const anchor of ['overview-actions', 'overview-mineru-parse', 'overview-translate-document', 'ai-summary']) {
    assert.equal(overviewAnchors.filter((value) => value === anchor).length, 1, anchor);
  }

  const libraryAnchors = tourAnchors('features/literature/LiteratureLibraryView.tsx');
  for (const anchor of ['library-sidebar', 'paper-list', 'library-ai-summary']) {
    assert.ok(libraryAnchors.includes(anchor), anchor);
  }
  const actionAnchors = tourAnchors('features/literature/details/PaperDetailsStatusBar.tsx');
  for (const anchor of ['library-mineru-parse', 'library-translate-document', 'library-generate-summary']) {
    assert.ok(actionAnchors.includes(anchor), anchor);
  }
});
