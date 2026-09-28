import test from 'node:test';
import assert from 'node:assert/strict';

import { placeAnchoredMenu } from '../src/utils/anchoredMenu.ts';

const dockedComposerAnchor = {
  left: 640,
  top: 760,
  bottom: 800,
  width: 190,
};

test('opens above a bottom-docked anchor instead of clipping past the viewport', () => {
  const placement = placeAnchoredMenu({
    anchor: dockedComposerAnchor,
    viewportWidth: 1200,
    viewportHeight: 840,
    preferredWidth: 220,
  });

  assert.equal(placement.placement, 'above');
  assert.equal(placement.top, undefined);
  assert.equal(placement.bottom, 840 - 760 + 8);
  assert.ok(placement.maxHeight <= 760 - 8 - 12);
  assert.ok(placement.maxHeight >= 220);
});

test('keeps opening below when the anchor has room underneath', () => {
  const placement = placeAnchoredMenu({
    anchor: { left: 240, top: 180, bottom: 220, width: 156 },
    viewportWidth: 1200,
    viewportHeight: 840,
    preferredWidth: 220,
  });

  assert.equal(placement.placement, 'below');
  assert.equal(placement.top, 228);
  assert.equal(placement.bottom, undefined);
  assert.equal(placement.width, 220);
});

test('does not force the menu taller than the space on the chosen side', () => {
  const placement = placeAnchoredMenu({
    anchor: { left: 40, top: 150, bottom: 190, width: 180 },
    viewportWidth: 800,
    viewportHeight: 210,
    preferredWidth: 220,
    minUsefulHeight: 220,
  });

  assert.equal(placement.placement, 'above');
  assert.equal(placement.maxHeight, 150 - 8 - 12);
  assert.ok(placement.maxHeight < 220);
});

test('clamps the menu inside the viewport horizontally', () => {
  const placement = placeAnchoredMenu({
    anchor: { left: 1100, top: 80, bottom: 120, width: 190 },
    viewportWidth: 1200,
    viewportHeight: 800,
    preferredWidth: 220,
  });

  assert.equal(placement.left, 1200 - placement.width - 12);
  assert.ok(placement.left >= 12);
});
