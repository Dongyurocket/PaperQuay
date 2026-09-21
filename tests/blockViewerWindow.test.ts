import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateBlockHeight } from '../src/features/blocks/blockViewerWindow.ts';

test('estimateBlockHeight scales text blocks and leaves visual blocks bilingual-neutral', () => {
  const paragraph = estimateBlockHeight(
    { type: 'paragraph' },
    { scale: 1, compactMode: false, bilingual: false },
  );
  const bilingual = estimateBlockHeight(
    { type: 'paragraph' },
    { scale: 1, compactMode: false, bilingual: true },
  );
  const compactTitle = estimateBlockHeight(
    { type: 'title' },
    { scale: 1, compactMode: true, bilingual: false },
  );
  const image = estimateBlockHeight(
    { type: 'image' },
    { scale: 1, compactMode: false, bilingual: true },
  );
  const scaledImage = estimateBlockHeight(
    { type: 'image' },
    { scale: 1.2, compactMode: false, bilingual: false },
  );

  assert.equal(paragraph, 80);
  assert.equal(bilingual, 132);
  assert.equal(compactTitle, 62);
  assert.equal(image, 280);
  assert.equal(scaledImage, 336);
});
