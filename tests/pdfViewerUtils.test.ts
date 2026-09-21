import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAnnotatedFileName,
  buildAnnotatedSiblingPath,
  buildScrollRestoreKey,
  buildThumbnailPageIndexes,
  clampScrollRatio,
  resolveThumbnailWindow,
  THUMBNAIL_ITEM_STRIDE_PX,
  getPdfAnnotationColorLabel,
  getPercentProgress,
  isPdfLifecycleCancellation,
  releasePdfDocument,
  resolveBBoxBaseSize,
} from '../src/features/pdf/pdfViewerUtils.ts';
import type { PdfScrollPosition } from '../src/types/reader.ts';

test('annotated PDF file names preserve existing annotated names', () => {
  assert.equal(buildAnnotatedFileName('paper.pdf'), 'paper.annotated.pdf');
  assert.equal(buildAnnotatedFileName('paper.annotated.pdf'), 'paper.annotated.pdf');
  assert.equal(buildAnnotatedFileName('paper'), 'paper.annotated.pdf');
  assert.equal(buildAnnotatedFileName('   '), 'document.annotated.pdf');
});

test('buildAnnotatedSiblingPath places the annotated file beside the source PDF', () => {
  assert.equal(
    buildAnnotatedSiblingPath('D:/papers/source.pdf'),
    'D:/papers/source.annotated.pdf',
  );
  assert.equal(
    buildAnnotatedSiblingPath('D:\\papers\\source.pdf'),
    'D:\\papers\\source.annotated.pdf',
  );
});

test('buildThumbnailPageIndexes includes leading pages and current-page neighbors', () => {
  assert.deepEqual(buildThumbnailPageIndexes(5, 3), [0, 1, 2, 3, 4]);
  assert.deepEqual(
    buildThumbnailPageIndexes(30, 20),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  );
});

test('resolveThumbnailWindow keeps only nearby page buttons for a long PDF', () => {
  const window = resolveThumbnailWindow(400, THUMBNAIL_ITEM_STRIDE_PX * 50, 600, 2);

  assert.equal(window.totalSize, THUMBNAIL_ITEM_STRIDE_PX * 400);
  assert.equal(window.startIndex, 47);
  assert.equal(window.endIndex, 56);
  assert.ok(window.endIndex - window.startIndex < 20);
  assert.ok(window.endIndex - window.startIndex < 400);
});

test('scroll helpers clamp ratios and build stable rounded restore keys', () => {
  const position: PdfScrollPosition = {
    sourceKey: 'doc',
    top: 12.6,
    left: 2.2,
    page: 3,
    pageOffsetTop: 40.7,
    pageOffsetRatio: 0.123456,
    pageHeight: 700.2,
    updatedAt: 1,
  };

  assert.equal(clampScrollRatio(Number.NaN), 0);
  assert.equal(clampScrollRatio(-1), 0);
  assert.equal(clampScrollRatio(2), 1);
  assert.equal(clampScrollRatio(0.5), 0.5);
  assert.equal(buildScrollRestoreKey(position), 'doc:13:2:3:41:12346:700');
});

test('progress and color helpers keep toolbar display values stable', () => {
  assert.equal(getPercentProgress(1, 4), 25);
  assert.equal(getPercentProgress(5, 4), 100);
  assert.equal(getPercentProgress(-1, 4), 0);
  assert.equal(getPercentProgress(1, 0), 0);

  assert.equal(getPdfAnnotationColorLabel('yellow', (zh) => zh), '黄色');
  assert.equal(getPdfAnnotationColorLabel('blue', (_zh, en) => en), 'Blue');
});

test('resolveBBoxBaseSize respects normalized and explicit page-size metadata', () => {
  const originalPage = { width: 595, height: 842 };

  assert.deepEqual(
    resolveBBoxBaseSize({ bboxCoordinateSystem: 'normalized-1000', bboxPageSize: [10, 20] }, originalPage),
    { width: 1000, height: 1000 },
  );
  assert.deepEqual(
    resolveBBoxBaseSize({ bboxCoordinateSystem: 'pdf', bboxPageSize: [300, 400] }, originalPage),
    { width: 300, height: 400 },
  );
  assert.deepEqual(resolveBBoxBaseSize(null, originalPage), originalPage);
});

test('isPdfLifecycleCancellation matches PDF.js cancellation errors', () => {
  const error = new Error('render task cancelled');
  error.name = 'RenderingCancelledException';

  assert.equal(isPdfLifecycleCancellation(error), true);
  assert.equal(isPdfLifecycleCancellation(new Error('Transport destroyed')), true);
  assert.equal(isPdfLifecycleCancellation(new Error('Unexpected PDF parse failure')), false);
});

test('releasePdfDocument calls cleanup and destroy best-effort', () => {
  let cleanupCalled = false;
  let destroyCalled = false;

  releasePdfDocument({
    cleanup() {
      cleanupCalled = true;
    },
    destroy() {
      destroyCalled = true;
      return Promise.resolve();
    },
  });

  assert.equal(cleanupCalled, true);
  assert.equal(destroyCalled, true);
});
