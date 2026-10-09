import test from 'node:test';
import assert from 'node:assert/strict';

import { isComparativeSurveyInstruction } from '../src/services/agentCapabilityTrigger.ts';

test('comparative survey trigger is explicit and requires multiple papers', () => {
  assert.equal(isComparativeSurveyInstruction('请做一份对比调研报告', 3), true);
  assert.equal(isComparativeSurveyInstruction('Write a comparative survey', 2), true);
  assert.equal(isComparativeSurveyInstruction('比较一下这两篇论文', 2), false);
  assert.equal(isComparativeSurveyInstruction('请做一份对比调研报告', 1), false);
});

test('full surveys and inspection of every paper body route to the research pipeline', () => {
  for (const instruction of ['请写完整版综述', '请对全部候选查全文或切片', '逐篇检查正文', 'Read the full text of every paper', 'Write a comprehensive review']) {
    assert.equal(isComparativeSurveyInstruction(instruction, 176), true, instruction);
    assert.equal(isComparativeSurveyInstruction(instruction, 1), false, instruction);
  }
});

test('candidate volume and ordinary batch library operations do not trigger surveys', () => {
  for (const instruction of ['给全部论文打标签', '把所有文献移入分类', '检查全文是否存在', '有176篇候选，请列出题名', 'Read this abstract']) {
    assert.equal(isComparativeSurveyInstruction(instruction, 176), false, instruction);
  }
});
