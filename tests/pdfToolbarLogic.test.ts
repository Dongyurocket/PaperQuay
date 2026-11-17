import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocatePdfToolbarOverflow,
  clampPdfPageNumber,
  getPdfZoomPresetValue,
  parseAndClampPdfPageInput,
} from '../src/features/pdf/toolbar/pdfToolbarLogic.ts';

test('pdf toolbar overflow keeps high-priority items in container order', () => {
  const items = [
    { id: 'tools', width: 144, priority: 100 },
    { id: 'page', width: 126, priority: 100 },
    { id: 'zoom', width: 82, priority: 80 },
    { id: 'delete', width: 40, priority: 30 },
    { id: 'export', width: 40, priority: 20 },
  ] as const;

  assert.deepEqual(allocatePdfToolbarOverflow(items, 360), {
    visible: ['tools', 'page'],
    overflow: ['zoom', 'delete', 'export'],
  });
  assert.deepEqual(allocatePdfToolbarOverflow(items, 520), {
    visible: ['tools', 'page', 'zoom', 'delete', 'export'],
    overflow: [],
  });
});

test('pdf page input parses integers and clamps to the available document range', () => {
  assert.equal(clampPdfPageNumber(0, 12), 1);
  assert.equal(clampPdfPageNumber(99, 12), 12);
  assert.equal(parseAndClampPdfPageInput(' 7 ', 12, 1), 7);
  assert.equal(parseAndClampPdfPageInput('999', 12, 1), 12);
  assert.equal(parseAndClampPdfPageInput('page', 12, 4), 4);
  assert.equal(parseAndClampPdfPageInput('', 0, 7), 1);
});

test('pdf zoom presets resolve to PDF.js scale values', () => {
  assert.equal(getPdfZoomPresetValue('page-width'), 'page-width');
  assert.equal(getPdfZoomPresetValue('page-fit'), 'page-fit');
  assert.equal(getPdfZoomPresetValue('100%'), '1');
});

