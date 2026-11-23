import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * E4 / E5 的静态守卫。
 *
 * 不引入 axe-core / testing-library：仓库没有 DOM 测试依赖，
 * 这里用源码断言锁住「语义已接上共享原语」与「文档语言随界面语言」两条，
 * 交互行为由 tests/notesSidebarSearch.test.mjs 等 jsdom 用例间接覆盖。
 */

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('E4: command palette renders through the shared Dialog with combobox semantics', () => {
  const source = read('src/ui/commandPalette.tsx');

  assert.match(source, /<Dialog\b/, 'palette must use the shared Dialog for focus trap and Esc');
  assert.equal(/createPortal/.test(source), false, 'palette must not portal on its own');
  assert.equal(/role="dialog"/.test(source), false, 'Dialog owns the dialog role');
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-activedescendant/);
  assert.match(source, /aria-controls=\{LISTBOX_ID\}/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /aria-live="polite"/);
});

test('E4: Dialog supports top alignment and stack-aware nesting', () => {
  const source = read('src/ui/dialog.tsx');

  assert.match(source, /align\?:\s*'center'\s*\|\s*'top'/, 'Dialog must expose an align prop');
  assert.match(source, /dialogStack/, 'nested dialogs must be tracked so only the topmost handles Esc/Tab');
  assert.match(source, /isTopmostDialog/);
});

test('E4: menu keyboard handling is no longer gated on keyboardAnchor', () => {
  const source = read('src/ui/menu.tsx');

  assert.equal(/if \(!keyboardAnchor\) return;\s*\n\s*if \(event\.key === 'Escape'\)/.test(source), false);
  assert.match(source, /role="menu"/);
  assert.match(source, /role=\{entry\.checked === undefined \? "menuitem" : "menuitemcheckbox"\}/);
  assert.match(source, /restoreFocus/);
});

test('E4: tabs expose tablist/tab semantics and the close button does not bubble', () => {
  const tabItem = read('src/components/tabs/TabItem.tsx');
  const tabBar = read('src/components/tabs/TabBar.tsx');

  assert.match(tabItem, /role="tab"/);
  assert.match(tabItem, /aria-selected=\{active\}/);
  assert.match(tabItem, /aria-controls=\{tabPanelId\(tab\)\}/);
  assert.match(tabItem, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(tabItem, /event\.stopPropagation\(\);/, 'close button must stop keydown bubbling');
  assert.match(tabBar, /role="tablist"/);
  assert.match(tabBar, /handleTabListKeyDown/);
});

test('E4: raw form controls keep a visible focus ring and .pq-input uses a real accent ring', () => {
  const css = read('src/app/index.css');

  // 裸控件不再被 outline:none 一刀切。
  assert.match(css, /input:focus-visible,\s*\n\s*textarea:focus-visible,\s*\n\s*select:focus-visible/);
  assert.match(css, /outline: 2px solid var\(--pq-accent\);/);
  // .pq-input 的焦点环不再用 10% accent。
  assert.match(css, /box-shadow: 0 0 0 3px color-mix\(in srgb, var\(--pq-accent\) 45%, transparent\)/);
  // 全局 :focus-visible 不再改圆角几何。
  assert.equal(/:focus-visible \{\s*\n\s*outline: 2px solid var\(--pq-accent\);\s*\n\s*outline-offset: 2px;\s*\n\s*border-radius: 4px;/.test(css), false);
});

test('E4: ConfirmDialog danger button uses button-level tokens', () => {
  const source = read('src/ui/dialog.tsx');

  assert.match(source, /bg-\[var\(--pq-danger-button-bg\)\]/);
  assert.match(source, /text-\[var\(--pq-danger-button-text\)\]/);
  assert.equal(/bg-\[var\(--pq-danger\)\] font-semibold text-white/.test(source), false);
});

test('E5: document language follows the UI language', () => {
  const i18n = read('src/i18n/uiLanguage.tsx');
  const app = read('src/app/App.tsx');

  assert.match(i18n, /export function applyDocumentLanguage/);
  assert.match(i18n, /document\.documentElement\.lang = locale/);
  assert.match(app, /applyDocumentLanguage\(uiLanguage\)/);
});

test('E5: static tab titles are localized at the display layer', () => {
  const tabItem = read('src/components/tabs/TabItem.tsx');

  assert.match(tabItem, /export function displayTabTitle/);
  assert.match(tabItem, /l\('笔记', 'Notes'\)/);
  assert.match(tabItem, /l\('知识图谱', 'Knowledge Graph'\)/);
});

test('E5: the notes sidebar has no Chinese-only user-visible strings left', () => {
  const source = read('src/features/notes/NotesSidebar.tsx');

  // 把每处 l(...) / pickLocaleText(...) 调用的字符区间标记出来；
  // 区间之外的 CJK 才是未本地化的文案。
  const localized: Array<[number, number]> = [];
  const callPattern = /\b(?:l|pickLocaleText)\(/g;
  for (const match of source.matchAll(callPattern)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let quote: string | null = null;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') { i += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { localized.push([open, i]); break; }
      }
    }
  }

  const inLocalizedCall = (index: number) => localized.some(([start, end]) => index >= start && index <= end);
  const offenders: string[] = [];
  let lineStart = 0;

  for (const rawLine of source.split('\n')) {
    const trimmed = rawLine.trim();
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    const isBilingualEntry = /\bzh:\s*'/.test(rawLine) && /\ben:\s*'/.test(rawLine);

    if (!isComment && !isBilingualEntry) {
      for (let i = 0; i < rawLine.length; i += 1) {
        if (/[一-鿿]/.test(rawLine[i]) && !inLocalizedCall(lineStart + i)) {
          offenders.push(`${lineStart + i}: ${trimmed}`);
          break;
        }
      }
    }

    lineStart += rawLine.length + 1;
  }

  assert.deepEqual(offenders, [], `notes sidebar strings must be bilingual:\n${offenders.join('\n')}`);
});
