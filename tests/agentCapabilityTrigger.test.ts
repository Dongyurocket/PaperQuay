import test from 'node:test';
import assert from 'node:assert/strict';

import { isComparativeSurveyInstruction } from '../src/services/agentCapabilityTrigger.ts';

test('comparative survey trigger is explicit and requires multiple papers', () => {
  assert.equal(isComparativeSurveyInstruction('请做一份对比调研报告', 3), true);
  assert.equal(isComparativeSurveyInstruction('Write a comparative survey', 2), true);
  assert.equal(isComparativeSurveyInstruction('比较一下这两篇论文', 2), false);
  assert.equal(isComparativeSurveyInstruction('请做一份对比调研报告', 1), false);
});
