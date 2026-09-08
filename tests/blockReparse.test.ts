import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeClientReparsedText } from '../src/utils/markdown.ts';

test('sanitizeClientReparsedText strips thinking tags', () => {
  const input = '<think>\nHere is some reasoning about the equation...\n</think>\n\nUrban air mobility (UAM) is an emerging industry';
  assert.equal(
    sanitizeClientReparsedText(input),
    'Urban air mobility (UAM) is an emerging industry',
  );
});

test('sanitizeClientReparsedText strips markdown code block fences', () => {
  const input = '```markdown\n| 符号 (Symbol) | 说明 (Description) |\n| :--- | :--- |\n| $B$ | number of rotor blades |\n```';
  assert.equal(
    sanitizeClientReparsedText(input),
    '| 符号 (Symbol) | 说明 (Description) |\n| :--- | :--- |\n| $B$ | number of rotor blades |',
  );
});

test('sanitizeClientReparsedText strips conversational filler and prefixes', () => {
  const input1 = 'Here is the corrected markdown:\n\n| $B$ | number of rotor blades |';
  assert.equal(
    sanitizeClientReparsedText(input1),
    '| $B$ | number of rotor blades |',
  );

  const input2 = '这是重新识别整理后的内容：\n\nUrban air mobility is an emerging industry';
  assert.equal(
    sanitizeClientReparsedText(input2),
    'Urban air mobility is an emerging industry',
  );

  const input3 = '```\nUrban air mobility\n```';
  assert.equal(
    sanitizeClientReparsedText(input3),
    'Urban air mobility',
  );
});
