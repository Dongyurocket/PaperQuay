import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * D7-4 / D7-11：焦点环与 kicker 的 WCAG 对比度核算。
 *
 * 直接解析 src/app/index.css 的浅色 `:root` 与深色 `.dark` 令牌，解析
 * var() 链并把 rgba 合成到相邻表面，再按 WCAG 2.x 相对亮度公式计算。
 * 令牌改动导致对比度下降时，这里会失败，而不是只靠肉眼或源码正则。
 */

const CSS = readFileSync(path.resolve('src/app/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function blockFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS block for ${selector}`);
  return match[1];
}

function declarations(block: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of block.matchAll(/(--pq-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    result.set(match[1], match[2].trim());
  }
  return result;
}

const lightTokens = declarations(blockFor(':root'));
const darkTokens = declarations(blockFor('.dark'));

function makeResolver(tokens: Map<string, string>) {
  return function resolve(value: string, seen = new Set<string>()): string {
    const trimmed = value.trim();
    const varMatch = trimmed.match(/^var\(\s*(--pq-[a-z0-9-]+)\s*\)$/);
    if (varMatch) {
      const name = varMatch[1];
      assert.equal(seen.has(name), false, `cyclic token reference: ${name}`);
      const next = tokens.get(name);
      assert.ok(next, `token ${name} is not defined for this theme`);
      seen.add(name);
      return resolve(next, seen);
    }
    return trimmed;
  };
}

const resolveLight = makeResolver(lightTokens);
const resolveDark = makeResolver(darkTokens);

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(input: string): Rgba {
  const value = input.trim();
  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const digits = hex[1];
    const expand = (part: string) => (part.length === 1 ? part + part : part);
    let r: number;
    let g: number;
    let b: number;
    let a = 'ff';
    if (digits.length === 3 || digits.length === 4) {
      [r, g, b] = [0, 1, 2].map((index) => Number.parseInt(expand(digits[index]), 16));
      if (digits.length === 4) a = expand(digits[3]);
    } else if (digits.length === 6 || digits.length === 8) {
      r = Number.parseInt(digits.slice(0, 2), 16);
      g = Number.parseInt(digits.slice(2, 4), 16);
      b = Number.parseInt(digits.slice(4, 6), 16);
      if (digits.length === 8) a = digits.slice(6, 8);
    } else {
      throw new Error(`unsupported hex color: ${value}`);
    }
    return { r, g, b, a: Number.parseInt(a, 16) / 255 };
  }

  const rgba = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((part) => Number.parseFloat(part.trim()));
    assert.equal(parts.length >= 3, true, `unsupported rgb color: ${value}`);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  throw new Error(`unsupported color: ${value}`);
}

/** 把半透明前景合成到不透明背景上。 */
function composite(foreground: Rgba, background: Rgba): Rgba {
  assert.equal(background.a, 1, 'background must be opaque for a deterministic composite');
  const channel = (fg: number, bg: number) => fg * foreground.a + bg * (1 - foreground.a);
  return {
    r: channel(foreground.r, background.r),
    g: channel(foreground.g, background.g),
    b: channel(foreground.b, background.b),
    a: 1,
  };
}

function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenColor(tokens: Map<string, string>, resolve: (value: string) => string, name: string): Rgba {
  const raw = tokens.get(name);
  assert.ok(raw, `token ${name} must exist`);
  return parseColor(resolve(raw));
}

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 允许选择器列表（如 `.pq-input:focus-within, .pq-input:focus {`）。
  const match = CSS.match(new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

function assertNonTextContrast(label: string, foreground: Rgba, background: Rgba) {
  const ratio = contrastRatio(foreground, background);
  assert.ok(ratio >= 3, `${label} must reach 3:1, got ${ratio.toFixed(2)}:1`);
  return ratio;
}

test('the input focus ring uses an opaque accent ring with >=3:1 against both themes', () => {
  const rule = ruleBody('.pq-input:focus-within');
  assert.match(rule, /box-shadow: 0 0 0 3px var\(--pq-accent\);/, 'the 3px ring must stay opaque accent');
  assert.match(rule, /border-color: var\(--pq-accent\);/);

  // 浅色：accent #0f766e 对输入底色 #f5f5f4 = 5.02:1，对白底 #ffffff = 5.47:1。
  // 深色：accent #2dd4bf 对 #262626 = 8.13:1，对 #1a1a1a = 9.35:1。
  const lightAccent = tokenColor(lightTokens, resolveLight, '--pq-accent');
  const darkAccent = tokenColor(darkTokens, resolveDark, '--pq-accent');
  for (const surface of ['--pq-bg-secondary', '--pq-surface-1'] as const) {
    const ratio = assertNonTextContrast(
      `light input ring vs ${surface}`,
      lightAccent,
      tokenColor(lightTokens, resolveLight, surface),
    );
    assert.ok(ratio >= 5.0, `light ${surface} lost contrast: ${ratio.toFixed(2)}`);
  }
  for (const surface of ['--pq-bg-secondary', '--pq-surface-1'] as const) {
    const ratio = assertNonTextContrast(
      `dark input ring vs ${surface}`,
      darkAccent,
      tokenColor(darkTokens, resolveDark, surface),
    );
    assert.ok(ratio >= (surface === '--pq-bg-secondary' ? 8.1 : 9.3), `dark ${surface} regressed: ${ratio.toFixed(2)}`);
  }
});

test('the global :focus-visible outline keeps >=3:1 against the page surfaces', () => {
  const rule = ruleBody(':focus-visible');
  assert.match(rule, /outline: 2px solid var\(--pq-accent\);/);
  assert.match(rule, /outline-offset: 2px;/);

  // 浅色最低为 accent 对 bg-secondary 的 5.02:1（bg-primary 5.24、白底 5.47）；深色最低 8.13:1。
  for (const [theme, tokens, resolve] of [
    ['light', lightTokens, resolveLight],
    ['dark', darkTokens, resolveDark],
  ] as const) {
    const accent = tokenColor(tokens, resolve, '--pq-accent');
    for (const surface of ['--pq-bg-primary', '--pq-bg-secondary', '--pq-surface-1'] as const) {
      const ratio = assertNonTextContrast(
        `${theme} focus outline vs ${surface}`,
        accent,
        tokenColor(tokens, resolve, surface),
      );
      if (theme === 'light') {
        assert.ok(ratio >= 5.0, `light ${surface} outline contrast regressed: ${ratio.toFixed(2)}`);
      } else {
        assert.ok(ratio >= 8.1, `dark ${surface} outline contrast regressed: ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('the note-component kicker keeps >=4.5:1 against its composited accent background', () => {
  const kicker = ruleBody('.pq-note-component-kicker');
  assert.match(kicker, /background: var\(--pq-accent-bg\);/);
  assert.match(kicker, /color: var\(--pq-text-primary\);/);
  // kicker 位于 .pq-note-component-header 上，该表头底为 --pq-bg-secondary。
  const header = ruleBody('.pq-note-component-header');
  assert.match(header, /background: var\(--pq-bg-secondary\);/);

  // 浅色：text-primary #1c1917 合成到 accent 10% over #f5f5f4 ≈ 14.32:1。
  // 深色：white 92% 合成到 accent 14% over #262626 ≈ 9.90:1。
  for (const [theme, tokens, resolve] of [
    ['light', lightTokens, resolveLight],
    ['dark', darkTokens, resolveDark],
  ] as const) {
    const surface = tokenColor(tokens, resolve, '--pq-bg-secondary');
    const background = composite(tokenColor(tokens, resolve, '--pq-accent-bg'), surface);
    const text = composite(tokenColor(tokens, resolve, '--pq-text-primary'), background);
    const ratio = contrastRatio(text, background);
    assert.ok(ratio >= 4.5, `${theme} kicker contrast must reach 4.5:1, got ${ratio.toFixed(2)}:1`);
    if (theme === 'light') {
      assert.ok(ratio >= 14, `light kicker contrast regressed: ${ratio.toFixed(2)}`);
    } else {
      assert.ok(ratio >= 9.8, `dark kicker contrast regressed: ${ratio.toFixed(2)}`);
    }
  }
});


test('graph node labels use opaque 6-digit hex with >=4.5:1 in both themes', () => {
  const source = readFileSync(path.resolve('src/features/graph/graphStyles.ts'), 'utf8');
  const match = source.match(/GRAPH_TEXT_COLORS\s*=\s*\{\s*light:\s*'(#[0-9a-f]{6})',\s*dark:\s*'(#[0-9a-f]{6})',\s*\}/i);
  assert.ok(match, 'graph label colors must be a light/dark 6-digit hex pair');
  const [, light, dark] = match;
  assert.notEqual(dark.toLowerCase(), '#1f2937', 'dark fallback must not reuse the light label color');
  // Cytoscape 不解析 rgba()/CSS 变量：只能传具体 hex。
  assert.equal(/getPropertyValue\('--pq-text'\)/.test(source), false, 'graph must not feed --pq-text rgba() to Cytoscape');

  for (const [theme, color, tokens, resolve] of [
    ['light', light, lightTokens, resolveLight],
    ['dark', dark, darkTokens, resolveDark],
  ] as const) {
    const ratio = contrastRatio(
      parseColor(color),
      tokenColor(tokens, resolve, '--pq-surface'),
    );
    assert.ok(ratio >= 4.5, `${theme} graph label contrast must reach 4.5:1, got ${ratio.toFixed(2)}:1`);
  }
});
