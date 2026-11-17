import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeNotePaperTarget } from '../src/features/notes/notePaperTarget.ts';

test('legacy onboarding note targets remain readable without being rewritten', () => {
  assert.equal(normalizeNotePaperTarget('onboarding:welcome-paper'), 'onboarding:welcome-paper');
  assert.equal(normalizeNotePaperTarget(' native-library:paper-1 '), 'native-library:paper-1');
  assert.equal(normalizeNotePaperTarget('paper-1'), 'native-library:paper-1');
});
