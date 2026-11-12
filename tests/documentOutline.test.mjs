import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { deriveDocumentOutline } = require('../electron/backend/documentOutline.cjs');

const heading = (title, level = 1) => ({
  type: 'title',
  content: { title_content: [{ type: 'text', content: title }], text_level: level },
});

test('derives the same physical chapter mapping from flat, page-array, and page-dictionary content lists', () => {
  const shapes = [
    [
      { ...heading('Introduction'), page_idx: 0 },
      { ...heading('Methods', 2), page_idx: 1 },
      { ...heading('Results'), page_idx: 2 },
    ],
    [[heading('Introduction')], [heading('Methods', 2)], [heading('Results')]],
    [{ 0: heading('Introduction') }, { 0: heading('Methods', 2) }, { 0: heading('Results') }],
  ];

  const outlines = shapes.map((content, index) => deriveDocumentOutline(content, {
    generationId: `generation-${index}`,
    sourceVersion: 'sha256-source-v1',
    pageCount: 3,
  }));

  for (const outline of outlines) {
    assert.equal(outline.quality, 'candidate-outline');
    assert.deepEqual(outline.units.filter((unit) => unit.title).map((unit) => [unit.title, unit.physicalStart, unit.physicalEnd]), [
      ['Introduction', 1, 2], ['Methods', 2, 2], ['Results', 3, 3],
    ]);
    assert.deepEqual(outline.pages.map((page) => page.physicalPage), [1, 2, 3]);
    assert.deepEqual(outline.pages.map((page) => page.printedPage), [null, null, null]);
  }
});

test('keeps printed pagination unknown and falls back to a document unit when no reliable heading exists', () => {
  const outline = deriveDocumentOutline([
    { type: 'paragraph', content: { paragraph_content: [{ type: 'text', content: 'Body text' }] } },
    { type: 'title', content: { title_content: 'Unreliable title without a level' } },
  ], { generationId: 'page-only-generation', sourceVersion: 'sha256-source-v1', pageCount: 2 });

  assert.equal(outline.quality, 'page-only');
  assert.equal(outline.headingCount, 0);
  assert.equal(outline.units.length, 1);
  assert.deepEqual(outline.pages.map((page) => [page.physicalPage, page.printedPage, page.unitId]), [
    [1, null, 'document:page-only-generation:root'],
    [2, null, 'document:page-only-generation:root'],
  ]);
});
