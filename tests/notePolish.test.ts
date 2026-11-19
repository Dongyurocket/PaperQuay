import test from 'node:test';
import assert from 'node:assert/strict';
import { notePolishTextToNodes } from '../src/features/notes/notePolish.ts';

test('distilled excerpt text keeps basic Markdown structure', () => {
  const textNodes = notePolishTextToNodes('# Summary\n\n- First\n- Second\n\nConclusion');
  assert.deepEqual(textNodes.map((node) => node.type), ['heading', 'bulletList', 'paragraph']);
});

test('plain text becomes a single paragraph without executing HTML', () => {
  const nodes = notePolishTextToNodes('<b>not html</b>');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]?.type, 'paragraph');
  assert.equal(nodes[0]?.content?.[0]?.text, '<b>not html</b>');
});
