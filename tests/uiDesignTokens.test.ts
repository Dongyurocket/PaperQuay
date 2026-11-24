import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OPACITY_PATTERN =
  /(?:bg|text|border|from|to|via|ring|divide|shadow|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-[0-9]{2,3})?\/([0-9]+)/g;

function walk(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...walk(entryPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      output.push(entryPath);
    }
  }
  return output;
}

test('every Tailwind palette opacity is on the default 5-step scale', () => {
  const violations: string[] = [];

  for (const filePath of walk(path.resolve('src'))) {
    const source = readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(OPACITY_PATTERN)) {
      const value = Number(match[1]);
      if (value % 5 !== 0) {
        violations.push(`${path.relative(process.cwd(), filePath)}: ${match[0]}`);
      }
    }
  }

  assert.deepEqual(violations, [], `non-standard opacities emit no CSS:\n${violations.join('\n')}`);
});

test('the overlay tokens exist for both themes and the dialog uses them', () => {
  const css = readFileSync(path.resolve('src/app/index.css'), 'utf8');
  assert.ok((css.match(/--pq-overlay-soft:/g) ?? []).length >= 2, 'soft overlay token must exist in light and dark');
  assert.ok((css.match(/--pq-overlay-strong:/g) ?? []).length >= 2, 'strong overlay token must exist in light and dark');

  const dialog = readFileSync(path.resolve('src/ui/dialog.tsx'), 'utf8');
  assert.equal(/slate-950\//.test(dialog), false);
  assert.match(dialog, /bg-\[var\(--pq-overlay-soft\)\]/);
  assert.match(dialog, /bg-\[var\(--pq-overlay-strong\)\]/);

  // E2：设置窗口、输入对话框与笔记提炼预览改为复用 Dialog，遮罩令牌只在 Dialog 里定义一次。
  for (const relativePath of [
    'src/features/reader/ReaderPreferencesWindow.tsx',
    'src/ui/textInputDialog.tsx',
    'src/features/notes/NoteDistillPreviewPanel.tsx',
  ]) {
    const source = readFileSync(path.resolve(relativePath), 'utf8');
    assert.match(source, /<Dialog\b/, `${relativePath} must render the shared Dialog`);
    assert.equal(/fixed inset-0/.test(source), false, `${relativePath} must not hand-roll an overlay`);
  }
});

test('the dark-theme white-on-white surfaces use theme tokens', () => {  const e1Files = [
    'src/features/notes/NoteDistillPreviewPanel.tsx',
    'src/app/settings/settingsPrimitives.tsx',
    'src/features/reader/readerPreferencesContent.tsx',
    'src/features/reader/readerPreferencesModelsSection.tsx',
    'src/features/blocks/blockViewerContent.tsx',
  ];
  const violations: string[] = [];

  for (const relativePath of e1Files) {
    const lines = readFileSync(path.resolve(relativePath), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/(^|[\s'"])bg-white($|[\s'"],)/.test(line)) {
        return;
      }
      if (line.includes('dark:')) {
        return;
      }
      // 切换开关的白色圆点是刻意保持白色（两种主题下都需要高对比）。
      if (line.includes('rounded-full bg-white shadow-sm')) {
        return;
      }
      violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(violations, [], `unpaired light-only surfaces:\n${violations.join('\n')}`);
});

/** 去掉注释与字符串以外的干扰：只保留代码行，避免把注释里的示例当成违规。 */
function codeLines(source: string): Array<{ line: number; text: string }> {
  const output: Array<{ line: number; text: string }> = [];
  let inBlockComment = false;

  source.split('\n').forEach((raw, index) => {
    let text = raw;
    if (inBlockComment) {
      const end = text.indexOf('*/');
      if (end === -1) return;
      text = text.slice(end + 2);
      inBlockComment = false;
    }

    const blockStart = text.indexOf('/*');
    if (blockStart !== -1 && text.indexOf('*/', blockStart) === -1) {
      inBlockComment = true;
      text = text.slice(0, blockStart);
    }

    const lineComment = text.indexOf('//');
    if (lineComment !== -1 && !/https?:\/\//.test(text.slice(Math.max(0, lineComment - 6), lineComment + 1))) {
      text = text.slice(0, lineComment);
    }

    output.push({ line: index + 1, text });
  });

  return output;
}

test('E2: no native browser dialogs remain in src', () => {
  const violations: string[] = [];

  for (const filePath of walk(path.resolve('src'))) {
    for (const { line, text } of codeLines(readFileSync(filePath, 'utf8'))) {
      if (/\bwindow\.(confirm|alert|prompt)\s*\(/.test(text)) {
        violations.push(`${path.relative(process.cwd(), filePath)}:${line}: ${text.trim()}`);
      }
    }
  }

  assert.deepEqual(violations, [], `use confirmAction()/Dialog/TextInputDialog instead:\n${violations.join('\n')}`);
});

test('E2: hand-rolled full-screen overlays live only in src/ui', () => {
  const violations: string[] = [];
  const uiRoot = path.resolve('src/ui');

  for (const filePath of walk(path.resolve('src'))) {
    if (filePath.startsWith(uiRoot)) continue;
    for (const { line, text } of codeLines(readFileSync(filePath, 'utf8'))) {
      if (/fixed inset-0/.test(text)) {
        violations.push(`${path.relative(process.cwd(), filePath)}:${line}: ${text.trim()}`);
      }
    }
  }

  assert.deepEqual(violations, [], `render the shared Dialog instead:\n${violations.join('\n')}`);
});

test('E2: no hardcoded palette classes or arbitrary hex colors in src', () => {
  const violations: string[] = [];
  const palettePattern =
    /(?:bg|text|border|ring|divide|from|to|via|fill|stroke|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/;
  const hexPattern = /(?:bg|text|border|ring|fill|stroke|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/;

  for (const filePath of walk(path.resolve('src'))) {
    for (const { line, text } of codeLines(readFileSync(filePath, 'utf8'))) {
      if (palettePattern.test(text)) {
        violations.push(`${path.relative(process.cwd(), filePath)}:${line}: palette class`);
      }
      if (hexPattern.test(text)) {
        violations.push(`${path.relative(process.cwd(), filePath)}:${line}: arbitrary hex color`);
      }
    }
  }

  assert.deepEqual(violations, [], `use var(--pq-*) tokens:\n${violations.join('\n')}`);
});

test('E2: solid accent/danger buttons use button-level tokens, not text-white', () => {
  const violations: string[] = [];

  for (const filePath of walk(path.resolve('src'))) {
    for (const { line, text } of codeLines(readFileSync(filePath, 'utf8'))) {
      if (/\btext-white\b/.test(text)) {
        violations.push(`${path.relative(process.cwd(), filePath)}:${line}: ${text.trim()}`);
      }
    }
  }

  assert.deepEqual(violations, [], `use --pq-{accent,danger,success,warning}-button-text:\n${violations.join('\n')}`);
});

test('E1: no light-only bg-white or bg-slate-50 surfaces remain anywhere in src', () => {  // 允许两处刻意保持白色的表面：开关圆点与 PDF 切片预览的图片衬底。
  const intentionalWhite = (relativePath: string, text: string) =>
    (relativePath.endsWith('settingsPrimitives.tsx') && text.includes('rounded-full bg-white')) ||
    (relativePath.endsWith('BlockReparseModal.tsx') && text.includes('bg-white object-contain'));
  const surfacePattern = /(^|[\s'"])bg-white(\/|$|[\s'",)])|(^|[\s'"])bg-slate-50(\/|$|[\s'",)])/;
  const violations: string[] = [];

  for (const filePath of walk(path.resolve('src'))) {
    const relativePath = path.relative(process.cwd(), filePath);
    for (const { line, text } of codeLines(readFileSync(filePath, 'utf8'))) {
      if (!surfacePattern.test(text) || text.includes('dark:')) continue;
      if (intentionalWhite(relativePath, text)) continue;
      violations.push(`${relativePath}:${line}: ${text.trim()}`);
    }
  }

  assert.deepEqual(violations, [], `add a dark: counterpart or use var(--pq-surface-*):\n${violations.join('\n')}`);
});

/** 收集 index.css 两个主题块里定义的 --pq-* 令牌。 */
function cssTokenNames(css: string): string[] {
  return [...new Set([...css.matchAll(/(--pq-[a-z0-9-]+)\s*:/g)].map((match) => match[1]))];
}

test('D7-13: every declared design token is referenced by source or another token', () => {
  const css = readFileSync(path.resolve('src/app/index.css'), 'utf8');
  const tokens = cssTokenNames(css);
  assert.ok(tokens.length > 40, 'token table unexpectedly small');

  const usageFiles = walk(path.resolve('src')).filter((file) => !file.endsWith('index.css'));
  usageFiles.push(...walk(path.resolve('electron')));
  const usage = usageFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  const tokenUsage = `${usage}\n${css}`;

  const unused = tokens.filter((token) => {
    const occurrences = [...tokenUsage.matchAll(new RegExp(`var\\(\\s*${token}\\s*\\)`, 'g'))].length;
    return occurrences === 0;
  });

  assert.deepEqual(unused, [], `delete or wire up unused tokens:\n${unused.join('\n')}`);
});

/** 从 Tailwind 配置源码中收集所有 var(--pq-*) 引用（按出现顺序去重）。 */
function tailwindTokenReferences(configSource: string): string[] {
  return [...new Set([...configSource.matchAll(/var\(\s*(--pq-[a-z0-9-]+)\s*\)/g)].map((match) => match[1]))];
}

/** 去掉注释后，收集 index.css 中 :root 与 .dark 主题块各自声明的令牌。 */
function cssThemeTokenDeclarations(cssSource: string): {
  root: Set<string>;
  dark: Set<string>;
  all: Set<string>;
} {
  const css = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    return match?.[1] ?? '';
  };
  const names = (body: string) =>
    new Set([...body.matchAll(/(--pq-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
  const root = names(block(':root'));
  const dark = names(block('.dark'));
  return { root, dark, all: new Set([...root, ...dark]) };
}

/** 审计 Tailwind 配置：返回被引用但 index.css 从未声明的令牌。 */
function auditTailwindTokenReferences(configSource: string, cssSource: string): string[] {
  const { all } = cssThemeTokenDeclarations(cssSource);
  return tailwindTokenReferences(configSource).filter((token) => !all.has(token));
}

test('D7-13: tailwind.config.ts only maps declared design tokens', () => {
  const config = readFileSync(path.resolve('tailwind.config.ts'), 'utf8');
  const css = readFileSync(path.resolve('src/app/index.css'), 'utf8');
  const violations = auditTailwindTokenReferences(config, css);

  assert.deepEqual(violations, [], `tailwind.config.ts maps undeclared tokens:\n${violations.join('\n')}`);
});

test('D7-13: theme-varying tailwind tokens are declared in both themes', () => {
  // --pq-radius-* 是主题无关的尺寸令牌，只在 :root 声明一次即可；
  // 其余被 Tailwind 引用的颜色/阴影令牌都随主题变化，必须在 :root 与 .dark 各自声明。
  const themeIndependent = new Set(['--pq-radius-sm', '--pq-radius-md', '--pq-radius-lg']);
  const config = readFileSync(path.resolve('tailwind.config.ts'), 'utf8');
  const { root, dark } = cssThemeTokenDeclarations(readFileSync(path.resolve('src/app/index.css'), 'utf8'));

  const violations = tailwindTokenReferences(config).filter((token) => {
    if (!root.has(token)) return true;
    return !themeIndependent.has(token) && !dark.has(token);
  });

  assert.deepEqual(violations, [], `tailwind tokens missing from :root or .dark:\n${violations.join('\n')}`);
});

test('D7-13: tailwind token audit reports a removed declaration', () => {
  const config = [
    'colors: {',
    "  alpha: 'var(--pq-test-alpha)',",
    "  omega: 'var(--pq-test-omega)',",
    '},',
  ].join('\n');
  const css = [
    ':root {',
    '  --pq-test-alpha: #111111;',
    '  --pq-test-omega: #222222;',
    '}',
    '.dark {',
    '  --pq-test-alpha: #eeeeee;',
    '  --pq-test-omega: #dddddd;',
    '}',
  ].join('\n');

  assert.deepEqual(auditTailwindTokenReferences(config, css), [], 'fixture must start clean');
  // 删掉最后一个引用（--pq-test-omega）所在的声明后必须报错。
  const brokenCss = css.replace(/--pq-test-omega:[^;]*;\s*/g, '');
  assert.deepEqual(auditTailwindTokenReferences(config, brokenCss), ['--pq-test-omega']);
});

test('D7-13: MinerU tables and scrollbars use semantic tokens in both themes', () => {
  const css = readFileSync(path.resolve('src/app/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const themeBlock = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `missing ${selector} theme block`);
    return match[1];
  };
  const lightBlock = themeBlock(':root');
  const darkBlock = themeBlock('.dark');

  for (const token of [
    '--pq-table-text',
    '--pq-table-head-text',
    '--pq-table-head-bg',
    '--pq-table-border',
    '--pq-table-row-alt-bg',
    '--pq-table-row-hover-bg',
    '--pq-scrollbar-thumb',
    '--pq-scrollbar-thumb-hover',
  ]) {
    assert.match(lightBlock, new RegExp(`${token}:`), `${token} must be defined in :root`);
    assert.match(darkBlock, new RegExp(`${token}:`), `${token} must be defined in .dark`);
  }

  // 取出所有 .mineru-table 规则体（不包含 .dark 前缀的重复规则——现在已没有）。
  const mineruRules = [...css.matchAll(/\.mineru-table[^{}]*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(mineruRules.length > 0, 'MinerU table rules must exist');
  const mineruBodies = mineruRules.join('\n');
  assert.equal(/#[0-9a-f]{3,8}/i.test(mineruBodies), false, `MinerU table rules must not hardcode hex colors:\n${mineruBodies}`);
  assert.equal(/rgba?\(/.test(mineruBodies), false, `MinerU table rules must not hardcode rgba colors:\n${mineruBodies}`);

  const scrollbarBodies = [...css.matchAll(/\*::-webkit-scrollbar-thumb[^{}]*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join('\n');
  assert.match(scrollbarBodies, /var\(--pq-scrollbar-thumb\)/);
  assert.match(scrollbarBodies, /var\(--pq-scrollbar-thumb-hover\)/);
  assert.equal(/rgba?\(/.test(scrollbarBodies), false, 'scrollbar thumb colors must come from tokens');
  assert.equal(/#[0-9a-f]{3,8}/i.test(scrollbarBodies), false, 'scrollbar thumb colors must not hardcode hex');
});
