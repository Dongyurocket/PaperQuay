import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeFakeSuperscripts,
  separateCollidingDollarMath,
  normalizeMarkdownMath,
  remarkSuperscriptPlugin,
} from '../src/utils/markdown.ts';

test('sanitizeFakeSuperscripts cleans ligatures in word middle and beginnings', () => {
  // 截图 2 中的真实案例
  assert.equal(
    sanitizeFakeSuperscripts('signi<sup>fi</sup>cant promise but also presents'),
    'significant promise but also presents',
  );
  assert.equal(
    sanitizeFakeSuperscripts('speci<sup>fi</sup>cally tailored'),
    'specifically tailored',
  );
  assert.equal(
    sanitizeFakeSuperscripts('The <sup>fi</sup>ndings demonstrate'),
    'The findings demonstrate',
  );
  assert.equal(
    sanitizeFakeSuperscripts('high-<sup>fi</sup>delity disciplinary'),
    'high-fidelity disciplinary',
  );
  assert.equal(
    sanitizeFakeSuperscripts('horizontal <sup>fl</sup>ight'),
    'horizontal flight',
  );
  assert.equal(
    sanitizeFakeSuperscripts('ef-<sup>fi</sup>ciency'),
    'ef-ficiency',
  );
  assert.equal(
    sanitizeFakeSuperscripts('Speci<sup>fi</sup>c geometry data'),
    'Specific geometry data',
  );
});

test('sanitizeFakeSuperscripts restores misplaced punctuation and quotes', () => {
  assert.equal(
    sanitizeFakeSuperscripts('0.2<sup>–</sup>0.7'),
    '0.2–0.7',
  );
  assert.equal(
    sanitizeFakeSuperscripts('specialists<sup>’</sup>'),
    'specialists’',
  );
});

test('sanitizeFakeSuperscripts preserves valid academic superscripts', () => {
  assert.equal(
    sanitizeFakeSuperscripts('disk loading of 24.87 kg/ m<sup>2</sup> and wing loading of106 kg/m<sup>2</sup>'),
    'disk loading of 24.87 kg/ m<sup>2</sup> and wing loading of106 kg/m<sup>2</sup>',
  );
  assert.equal(
    sanitizeFakeSuperscripts('reference [1]<sup>1</sup> or authors<sup>*</sup>'),
    'reference [1]<sup>1</sup> or authors<sup>*</sup>',
  );
  assert.equal(
    sanitizeFakeSuperscripts('citation<sup>[1-3]</sup>'),
    'citation<sup>[1-3]</sup>',
  );
});

test('separateCollidingDollarMath separates adjacent inline formulas', () => {
  assert.equal(
    separateCollidingDollarMath('$a$$b$'),
    '$a$ $b$',
  );
  assert.equal(
    separateCollidingDollarMath('where: $formula1$$formula2$$formula3$'),
    'where: $formula1$ $formula2$ $formula3$',
  );
  // 保留合法的块级公式定界符
  assert.equal(
    separateCollidingDollarMath('$$\nE=mc^2\n$$'),
    '$$\nE=mc^2\n$$',
  );
});

test('normalizeMarkdownMath integrates superscript sanitizing and separates colliding formulas', () => {
  const input = 'Speci<sup>fi</sup>cally, $a$$b$ and 24.87 kg/ m<sup>2</sup>';
  const output = normalizeMarkdownMath(input);
  assert.ok(output.includes('Specifically'));
  assert.ok(!output.includes('$kg/ m<sup>2</sup>$')); // 不被误当成公式包裹 $
  assert.ok(output.includes('kg/ m<sup>2</sup>') || output.includes('kg/m<sup>2</sup>'));
});

test('remarkSuperscriptPlugin converts <sup> and <sub> tags into ast sup/sub nodes', () => {
  const mockTree = {
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'selected a disk loading of 24.87 kg/m<sup>2</sup> and citation<sup>[1-3]</sup>' },
        ],
      },
    ],
  };

  const transform = remarkSuperscriptPlugin();
  transform(mockTree);

  const paragraphChildren = (mockTree.children[0] as any).children;
  // 验证提取出了 sup 节点
  const supNodes = paragraphChildren.filter((c: any) => c.type === 'sup');
  assert.equal(supNodes.length, 2);
  assert.equal(supNodes[0].data.hName, 'sup');
  assert.equal(supNodes[0].children[0].value, '2');
  assert.equal(supNodes[1].children[0].value, '[1-3]');
});
