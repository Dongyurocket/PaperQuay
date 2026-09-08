import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeFakeSuperscripts,
  sanitizeDropCapArtifacts,
  reconstructNomenclature,
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

test('sanitizeFakeSuperscripts cleans cross-reference fake superscripts and restores comma spacing', () => {
  // 真实复现案例：Table <sup>8</sup>,while -> Table 8, while
  assert.equal(
    sanitizeFakeSuperscripts(
      'The parameters presented in Table 10 maintain consistency with those in Table <sup>8</sup>,while exhibiting increased',
    ),
    'The parameters presented in Table 10 maintain consistency with those in Table 8, while exhibiting increased',
  );

  // Unicode 上标数字形式：Table ⁸,while -> Table 8, while
  assert.equal(
    sanitizeFakeSuperscripts(
      'The parameters presented in Table 10 maintain consistency with those in Table ⁸,while exhibiting increased',
    ),
    'The parameters presented in Table 10 maintain consistency with those in Table 8, while exhibiting increased',
  );

  // Figure / Eq. / Algorithm 等交叉引用
  assert.equal(
    sanitizeFakeSuperscripts('as shown in Figure <sup>3a</sup>,which is clear'),
    'as shown in Figure 3a, which is clear',
  );
  assert.equal(
    sanitizeFakeSuperscripts('see Eq. <sup>12</sup>,where x is speed'),
    'see Eq. 12, where x is speed',
  );
  assert.equal(
    sanitizeFakeSuperscripts('in Section <sup>IV</sup>,we discuss'),
    'in Section IV, we discuss',
  );

  // 连续引用（如 Table 8 and 9 或 Table 8, 9）
  assert.equal(
    sanitizeFakeSuperscripts('Table <sup>8</sup> and <sup>9</sup>,respectively'),
    'Table 8 and 9, respectively',
  );
  assert.equal(
    sanitizeFakeSuperscripts('Figure <sup>2</sup>, <sup>3</sup>,and <sup>4</sup>'),
    'Figure 2, 3, and 4',
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

test('sanitizeDropCapArtifacts restores drop cap erroneously marked as superscript or split', () => {
  // 截图 1 & 2 中的真实案例：HTML <sup>
  assert.equal(
    sanitizeDropCapArtifacts('U<sup>RBAN air mobility (UAM) is an emerging industry that has</sup> the potential'),
    'Urban air mobility (UAM) is an emerging industry that has the potential',
  );

  // Markdown / LaTeX 形式 U^{RBAN...}
  assert.equal(
    sanitizeDropCapArtifacts('U^{RBAN air mobility (UAM) is an emerging industry that has} the potential'),
    'Urban air mobility (UAM) is an emerging industry that has the potential',
  );

  // 纯单词词干：U<sup>RBAN</sup>
  assert.equal(
    sanitizeDropCapArtifacts('U<sup>RBAN</sup> air mobility is emerging'),
    'Urban air mobility is emerging',
  );

  // 单字母空格断开：U RBAN air mobility -> Urban air mobility
  assert.equal(
    sanitizeDropCapArtifacts('U RBAN air mobility (UAM) is an emerging industry'),
    'Urban air mobility (UAM) is an emerging industry',
  );

  // A CCORDING -> According
  assert.equal(
    sanitizeDropCapArtifacts('A CCORDING to recent studies'),
    'According to recent studies',
  );
});

test('reconstructNomenclature parses collapsed nomenclature paragraph into markdown table', () => {
  // 截图 3 & 4 中的真实案例
  const rawInput =
    'Nomenclature\n\n' +
    'Bnumber of rotor blades ^bwing span, m C_Bbattery capacity, Ah C_{D_p}parasitic drag coefficient ' +
    'Dtotal drag, N EYoung\'s modulus, GPa Gshear modulus, GPa Llift, N mmass, kg ' +
    'npbattery cells in parallel nsbattery cells in series OCVbattery open current voltage, V ' +
    'Tthrust, N t/cthickness-to-chord ratio';

  const output = reconstructNomenclature(rawInput);

  // 必须重构成带有表头的 Markdown 表格
  assert.ok(output.includes('| 符号 (Symbol) | 说明与单位 (Description) |'));
  assert.ok(output.includes('| :--- | :--- |'));
  // 符号必须解耦，且包裹 $
  assert.ok(output.includes('| $B$ | number of rotor blades |'));
  assert.ok(output.includes('| $b$ | wing span, m |'));
  assert.ok(output.includes('| $C_B$ | battery capacity, Ah |'));
  assert.ok(output.includes('| $D$ | total drag, N |'));
  assert.ok(output.includes('| $T$ | thrust, N |'));
  assert.ok(output.includes('| $t/c$ | thickness-to-chord ratio |'));
});

