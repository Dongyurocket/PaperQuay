import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGluedLatex,
  normalizeMarkdownMath,
  normalizeRawLatexExpression,
  remarkFixGluedLatex,
} from '../src/utils/markdown.ts';

// 截图中出现的粘连控制序列实例（eVTOL 论文公式 5.1–5.28）
test('normalizeGluedLatex 修复截图中的粘连命令', () => {
  assert.equal(normalizeGluedLatex('\\pir^2'), '\\pi r^2');
  assert.equal(normalizeGluedLatex('\\Omegar'), '\\Omega r');
  assert.equal(normalizeGluedLatex('\\kappaC_T^2'), '\\kappa C_T^2');
  assert.equal(normalizeGluedLatex('\\sigmaC_{d_0}'), '\\sigma C_{d_0}');
  assert.equal(normalizeGluedLatex('\\qquada_z'), '\\qquad a_z');
  assert.equal(normalizeGluedLatex('\\intV_x'), '\\int V_x');
  assert.equal(normalizeGluedLatex('\\sumT_{z,rotor_i}'), '\\sum T_{z,rotor_i}');
  assert.equal(normalizeGluedLatex('\\timesa_z'), '\\times a_z');
});

test('normalizeGluedLatex 修复完整公式（式 5.2 功率系数）', () => {
  assert.equal(
    normalizeGluedLatex('C_P=\\frac{P_{req}}{\\pir^2\\rho(\\Omegar)^3}'),
    'C_P=\\frac{P_{req}}{\\pi r^2\\rho(\\Omega r)^3}',
  );
});

test('normalizeGluedLatex 修复完整公式（式 5.5 诱导功率）', () => {
  assert.equal(
    normalizeGluedLatex('\\frac{\\sigmaC_{d_0}}{8}(1+4.6\\mu^2)'),
    '\\frac{\\sigma C_{d_0}}{8}(1+4.6\\mu^2)',
  );
});

test('normalizeGluedLatex 对正确公式幂等', () => {
  const correct = [
    '\\pi r^2',
    '\\frac{\\sigma C_{d_0}}{8}(1+4.6\\mu^2)',
    '\\sum T_{z,\\mathrm{rotor}_i}',
    '\\qquad a_z = \\int V_x\\,dt',
    'P_{\\mathrm{induced}} = \\kappa C_T^{2}',
  ];
  for (const formula of correct) {
    assert.equal(normalizeGluedLatex(formula), formula);
  }
});

test('normalizeGluedLatex 不拆分完整的合法长命令', () => {
  const valid = [
    '\\bigl(', // bigl 不能以 big 拆
    '\\limsup_{n}', // limsup 不能以 lim 拆
    '\\rightarrow', // rightarrow 完整保留
    '\\infty', // infty 不能以 in 拆
    '\\injlim', // injlim 不能以 in 拆
    '\\subseteqq', // 不能以 subset 拆
    '\\varepsilon', // var 变体完整保留
    '\\boldsymbol{T}',
    '\\operatorname{rotor}',
  ];
  for (const formula of valid) {
    assert.equal(normalizeGluedLatex(formula), formula);
  }
});

test('normalizeGluedLatex 保留未知命令原样', () => {
  assert.equal(normalizeGluedLatex('\\foo'), '\\foo');
  assert.equal(normalizeGluedLatex('\\foo x'), '\\foo x');
  // 无任何已知前缀的未知命令保持原样；带已知前缀的（如 \notacommand → \not）按设计拆分去红
  assert.equal(normalizeGluedLatex('\\quantizzle{a}'), '\\quantizzle{a}');
});

test('normalizeGluedLatex 拆分双命令粘连时补回反斜杠', () => {
  assert.equal(normalizeGluedLatex('\\alphabeta'), '\\alpha \\beta');
  assert.equal(normalizeGluedLatex('\\pirho'), '\\pi \\rho');
});

test('normalizeGluedLatex 不破坏换行命令 \\\\', () => {
  assert.equal(normalizeGluedLatex('a = 1 \\\\ b = 2'), 'a = 1 \\\\ b = 2');
});

test('normalizeGluedLatex 空输入与非公式输入安全', () => {
  assert.equal(normalizeGluedLatex(''), '');
  assert.equal(normalizeGluedLatex('plain text'), 'plain text');
});

test('normalizeRawLatexExpression 集成修复（EquationContentComponent 直渲路径）', () => {
  assert.equal(normalizeRawLatexExpression('\\sumT_{z,rotor_i}'), '\\sum T_{z,rotor_i}');
  assert.equal(normalizeRawLatexExpression('C_P=\\frac{P}{\\pir^2}'), 'C_P=\\frac{P}{\\pi r^2}');
});

test('normalizeMarkdownMath 修复 $$ 块中的粘连命令', () => {
  const output = normalizeMarkdownMath('$$\nC_P=\\frac{P_{req}}{\\pir^2\\rho(\\Omegar)^3}\n$$');
  assert.ok(output.includes('\\pi r^2'), `应包含 \\pi r^2，实际输出：${output}`);
  assert.ok(output.includes('\\Omega r'), `应包含 \\Omega r，实际输出：${output}`);
  assert.ok(!output.includes('\\pir'), `不应残留 \\pir，实际输出：${output}`);
});

test('remarkFixGluedLatex 修复 math/inlineMath 节点且不动 code 节点', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: '前缀 $\\pir^2$ 后缀' },
          { type: 'inlineMath', value: '\\pir^2' },
        ],
      },
      { type: 'math', value: '\\sumT_{z}' },
      { type: 'code', value: '\\pir' },
    ],
  };
  remarkFixGluedLatex()(tree);
  assert.equal(tree.children[0].children[1].value, '\\pi r^2');
  assert.equal(tree.children[1].value, '\\sum T_{z}');
  assert.equal(tree.children[2].value, '\\pir'); // code 节点不碰
  assert.equal(tree.children[0].children[0].value, '前缀 $\\pir^2$ 后缀'); // text 节点不碰
});
