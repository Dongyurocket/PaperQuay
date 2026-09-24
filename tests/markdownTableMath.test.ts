import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { normalizeMarkdownMath } from '../src/utils/markdown.ts';

// 截图中的 agent 输出：模型写的是裸 LaTeX（无 `$`），表格四列。修复前
// `wrapInlineLatexSegments` 的候选字符集含 `|`，候选串跨单元格把下一格的 `T_i`
// 吞进来，补出的 `$` 分别落在相邻两格（`仅 $T_i | τ$ 预调度`），remark-math 无法
// 跨格配对，整行公式退化为字面 `$`。
const SCREENSHOT_TABLE = [
  '| 路线 | 未知量 | 闭合手段 | 建议 |',
  '| --- | --- | --- | --- |',
  '| A. Lim 式 | 仅 T_i | τ 预调度 + θ≡0 + 升力分配规则（p.106, p.114） | 作为基准复现，别当主方案 |',
  '| **B. 半自由（起手推荐）** | T_i + θ | τ 预调度，**力矩方程定 θ** | 最稳、代码最少 |',
  '| C. 全自由（目标） | T_i + θ + τ | **外层牛顿 + 内层 QP 控制分配** | 最终形态 |',
  '| D. +转速 | 再 + Ω_i | 加电机功率/扭矩 map 与效率 | 进阶 |',
].join('\n');

const SCREENSHOT_TABLE_FIXED = [
  '| 路线 | 未知量 | 闭合手段 | 建议 |',
  '| --- | --- | --- | --- |',
  '| A. Lim 式 | 仅 $T_i$ | τ 预调度 + θ≡0 + 升力分配规则（p.106, p.114） | 作为基准复现，别当主方案 |',
  '| **B. 半自由（起手推荐）** | $T_i + θ$ | τ 预调度，**力矩方程定 θ** | 最稳、代码最少 |',
  '| C. 全自由（目标） | $T_i + θ + τ$ | **外层牛顿 + 内层 QP 控制分配** | 最终形态 |',
  '| D. +转速 | 再 + Ω_i | 加电机功率/扭矩 map 与效率 | 进阶 |',
].join('\n');

// 每个 `$...$` 段（按行配对）不得含 `|`，且每行 `$` 数为偶数（无不配对定界符）
function assertNoCrossCellMath(output: string) {
  for (const line of output.split('\n')) {
    if (!line.includes('$')) {
      continue;
    }

    const dollars = line.match(/\$/g)?.length ?? 0;
    assert.equal(dollars % 2, 0, `该行 $ 未成对：${line}`);

    for (const segment of line.match(/\$[^$]*\$/g) ?? []) {
      assert.ok(!segment.includes('|'), `公式段跨越单元格分隔符：${segment}`);
    }
  }
}

test('normalizeMarkdownMath 表格行按单元格补公式，$ 不跨单元格', () => {
  assert.equal(normalizeMarkdownMath(SCREENSHOT_TABLE), SCREENSHOT_TABLE_FIXED);
  assertNoCrossCellMath(normalizeMarkdownMath(SCREENSHOT_TABLE));
});

test('normalizeMarkdownMath 无外层 | 的表格行同样按单元格处理', () => {
  const input = 'A. Lim 式 | 仅 T_i | τ 预调度 | 作为基准复现';
  const output = normalizeMarkdownMath(input);

  assert.equal(output, 'A. Lim 式 | 仅 $T_i$ | τ 预调度 | 作为基准复现');
  assertNoCrossCellMath(output);
});

test('normalizeMarkdownMath 表格行处理幂等', () => {
  const once = normalizeMarkdownMath(SCREENSHOT_TABLE);

  assert.equal(normalizeMarkdownMath(once), once);
});

test('normalizeMarkdownMath 不动表格内已渲染的 $...$ 单元格', () => {
  const input = '| a | $T_i$ | τ 预调度 | b |';

  assert.equal(normalizeMarkdownMath(input), input);
});

test('normalizeMarkdownMath 非表格的含 | 数学表达式行为不变', () => {
  assert.equal(normalizeMarkdownMath('A = |x| < 1'), '$A = |x| < 1$');
  assert.equal(normalizeMarkdownMath('P(A | B) = 0.5'), '$P(A | B) = 0.5$');
});

test('normalizeMarkdownMath 单元格内 Unicode 下标不产生 $ 包裹', () => {
  const input = '| D. +转速 | 再 + Ω_i | 加电机功率/扭矩 map 与效率 | 进阶 |';

  assert.equal(normalizeMarkdownMath(input), input);
});

test('表格行补出的公式被 remark-math 解析为 inlineMath 而非字面 $', () => {
  const output = normalizeMarkdownMath(SCREENSHOT_TABLE);
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(output);

  const inlineMath: string[] = [];
  const literalDollars: string[] = [];
  const walk = (node: { type?: string; value?: string; children?: unknown[] }) => {
    if (node.type === 'inlineMath' && typeof node.value === 'string') {
      inlineMath.push(node.value);
    }
    if (node.type === 'text' && typeof node.value === 'string' && node.value.includes('$')) {
      literalDollars.push(node.value);
    }
    for (const child of (node.children ?? []) as typeof node[]) {
      walk(child);
    }
  };
  walk(tree as never);

  assert.deepEqual(inlineMath, ['T_i', 'T_i + θ', 'T_i + θ + τ']);
  assert.deepEqual(literalDollars, []);
});
