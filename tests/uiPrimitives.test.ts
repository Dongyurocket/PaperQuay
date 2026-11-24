import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * D7-14：UI 按钮原语的结构守卫。
 *
 * 仓库没有 DOM 测试依赖，这里用源码扫描锁住三件事：
 *   1. src/ui/button.tsx 提供 Button / IconButton 与 size/variant 类型，尺寸只来自 --pq-control-sm/md；
 *   2. 28/32px 的手写按钮迁移到共享原语（对话框关闭、块阅读器工具栏、思考强度触发器）；
 *   3. src/ui/*.tsx 内不再出现按钮上的裸 h-7/h-8（菜单行是全宽列表项，按 D7-14 保留）。
 */

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

/** 提取某个 JSX 元素的开始标签；能跨过属性里的箭头函数与字符串。 */
function openingTags(source: string, tag: string): string[] {
  const tags: string[] = [];
  const pattern = new RegExp(`<${tag}\\b`, 'g');

  for (const match of source.matchAll(pattern)) {
    let depth = 0;
    let quote: string | null = null;

    for (let index = (match.index ?? 0) + match[0].length; index < source.length; index += 1) {
      const character = source[index];

      if (quote) {
        if (character === '\\') {
          index += 1;
          continue;
        }
        if (character === quote) quote = null;
        continue;
      }

      if (character === '"' || character === '\'' || character === '`') {
        quote = character;
        continue;
      }
      if (character === '{') {
        depth += 1;
        continue;
      }
      if (character === '}') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (character === '>' && depth === 0) {
        tags.push(source.slice(match.index, index + 1));
        break;
      }
    }
  }

  return tags;
}

test('D7-14: button primitives expose size/variant API backed by control tokens', () => {
  const source = read('src/ui/button.tsx');

  assert.match(source, /export\s+(?:const|function)\s+Button\b/, 'button.tsx must export Button');
  assert.match(source, /export\s+(?:const|function)\s+IconButton\b/, 'button.tsx must export IconButton');

  assert.match(source, /export type ButtonSize\s*=\s*'sm'\s*\|\s*'md'/, 'ButtonSize must be sm | md');
  assert.match(
    source,
    /export type ButtonVariant\s*=\s*'primary'\s*\|\s*'secondary'\s*\|\s*'ghost'\s*\|\s*'danger'/,
    'ButtonVariant must expose the four variants',
  );
  assert.match(source, /export interface ButtonProps\b/);
  assert.match(source, /export interface IconButtonProps\b/);

  for (const variant of ['primary', 'secondary', 'ghost', 'danger']) {
    assert.match(source, new RegExp(`\\b${variant}:`), `variant map must handle ${variant}`);
  }

  // 尺寸只来自 main 进程已加入的 --pq-control-sm/md；不允许再写死 h-7/h-8。
  assert.match(source, /var\(--pq-control-sm\)/);
  assert.match(source, /var\(--pq-control-md\)/);
  assert.equal(/\bh-[78]\b/.test(source), false, 'button primitives must not hardcode 28/32px heights');

  // 默认 md（32px），图标按钮默认等宽高。
  assert.match(source, /size = 'md'/);
  assert.match(source, /w-\[var\(--pq-control-sm\)\]/);
  assert.match(source, /w-\[var\(--pq-control-md\)\]/);

  // 复用现有 CSS 原语与按钮级语义令牌。
  assert.match(source, /pq-button-primary/);
  assert.match(source, /pq-button['"]/);
  assert.match(source, /pq-icon-button/);
  assert.match(source, /--pq-accent-button-bg/);
  assert.match(source, /--pq-danger-button-bg/);

  // IconButton 固定渲染 type="button"，避免表单里意外提交。
  assert.match(source, /<button[^>]*type="button"/s);
});

test('D7-14: dialog, block viewer toolbar and reasoning picker use the shared primitives', () => {
  const dialog = read('src/ui/dialog.tsx');
  assert.match(dialog, /import \{[^}]*IconButton[^}]*\} from '\.\/button'/, 'dialog must import IconButton');
  assert.match(dialog, /<IconButton\b/);
  assert.equal(/pq-icon-button h-8 w-8/.test(dialog), false, 'dialog close button must use the size token');

  const blockViewer = read('src/features/blocks/BlockViewer.tsx');
  assert.match(
    blockViewer,
    /import \{[^}]*IconButton[^}]*\} from '\.\.\/\.\.\/ui\/button'/,
    'BlockViewer must import IconButton',
  );
  assert.equal(blockViewer.match(/<IconButton\b/g)?.length, 3, 'all three 28/32px toolbar icon buttons migrate');
  assert.equal(/!h-8 !w-8/.test(blockViewer), false, '32px info button must use the md token');
  assert.equal(/!h-7 !w-7/.test(blockViewer), false, '28px zoom buttons must use the sm token');
  // 导航 pill 是分段切换组的选项，不是 28/32px 图标按钮：保留并在此登记例外。
  assert.match(blockViewer, /pq-nav-item !h-7/);

  const reasoning = read('src/components/ReasoningEffortPicker.tsx');
  assert.match(
    reasoning,
    /import \{[^}]*IconButton[^}]*\} from '\.\.\/ui\/button'/,
    'ReasoningEffortPicker must import IconButton',
  );
  assert.match(reasoning, /<IconButton\b/);
  assert.equal(/'h-8 w-8'/.test(reasoning), false, 'compact trigger must use the md token');
  assert.match(reasoning, /h-10 w-10/, 'non-compact 40px trigger size stays unchanged via className override');
});

test('D7-14: src/ui buttons no longer use bare h-7/h-8 heights', () => {
  // 菜单行（menu.tsx）是全宽列表项（role=menuitem），h-8 是行高而不是 28px 控件尺寸；
  // 迁移到 Button/IconButton 会改变 role/aria 与行内布局，因此按 D7-14 保留并登记。
  const allowlist = new Set(['src/ui/menu.tsx']);
  const violations: string[] = [];
  const uiRoot = path.resolve('src/ui');

  for (const entry of readdirSync(uiRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue;

    const relativePath = path.posix.join('src/ui', entry.name);
    if (allowlist.has(relativePath)) continue;

    for (const tag of openingTags(read(relativePath), 'button')) {
      if (/\bh-[78]\b/.test(tag)) {
        violations.push(`${relativePath}: ${tag.replace(/\s+/g, ' ').trim()}`);
      }
    }
  }

  assert.deepEqual(violations, [], `use Button/IconButton size tokens instead of h-7/h-8:\n${violations.join('\n')}`);

  // 例外仍有据可查：菜单行保持原样。
  assert.match(read('src/ui/menu.tsx'), /h-8 w-full/);
});
