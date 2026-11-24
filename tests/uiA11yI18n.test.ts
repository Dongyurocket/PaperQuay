import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { BASE_SLASH_COMMANDS, NOTE_TEMPLATES } from '../src/features/notes/noteEditorUtils.ts';
import { noteDisplayTitle } from '../src/features/notes/notesDisplay.ts';
import { UNTITLED_NOTE_TITLE } from '../src/features/notes/notesText.ts';

const CJK_PATTERN = /[一-鿿]/;

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
  assert.match(source, /document\.addEventListener\('keydown', handleDocumentKeyDown, true\)/);
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
  assert.match(css, /box-shadow: 0 0 0 3px var\(--pq-accent\);/);
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

/**
 * D4-9 / D7-9 的 i18n 静态守卫。
 *
 * 规则：源码中任何用户可见中文都必须出现在 l(...) / pickLocaleText(...) /
 * pickDocumentLocaleText(...) 调用内，或者是双语表里 `zh: '...' / en: '...'`、
 * `labelEn` / `descriptionEn`、`['中文', 'English']` 这类键值；注释与 console.* 行豁免。
 * 扫描器同时用于负向自测：硬编码中文（含 \uXXXX 转义）的合成源码必须能报出来。
 */
const NOTES_I18N_GUARDED_FILES = [
  'src/features/notes/NotesWorkspace.tsx',
  'src/features/notes/NotesGraphView.tsx',
  'src/features/notes/noteHealth.ts',
  'src/features/notes/NotesList.tsx',
  'src/features/notes/NotesSidebar.tsx',
  'src/features/notes/NoteEditor.tsx',
  'src/features/notes/NoteEditorToolbar.tsx',
  'src/features/notes/editor/toolbar.tsx',
  'src/features/notes/editor/tableCell.tsx',
  'src/features/notes/NoteCard.tsx',
  'src/features/notes/extensions/suggestionMenu.ts',
  'src/features/notes/extensions/NoteAnchorLink.ts',
  'src/features/notes/noteEditorBlockUtils.ts',
  'src/features/notes/notesText.ts',
  'src/features/notes/notesDisplay.ts',
  'src/services/notes.ts',
  'src/stores/useNotesStore.ts',
  'src/services/noteDistill.ts',
  'src/features/notes/noteUtils.ts',
  'src/features/notes/editor/extensions.tsx',
  'src/features/notes/editor/slashMenu.ts',
  'src/features/notes/noteEditorUtils.ts',
  'src/features/notes/noteReferences.ts',
  'src/features/notes/noteDistill.ts',
  'src/services/noteSystemPages.ts',
  'src/services/noteAggregation.ts',
];

/**
 * 非 UI 文案但确实含中文的数据行，按文件精确豁免：
 * - notesText：旧版「未命名笔记」哨兵，数据层兼容用；
 * - noteEditorBlockUtils：不传 localizer 时保留的「引用」块名（历史测试依赖）；
 * - noteEditorUtils：锚点卡旧数据哨兵与搜索别名；模板正文/标签已改为 { zh, en } 成对数据，
 *   不再需要整块豁免。
 * - noteAggregation：发给外部 Agent 的修复指令，不是用户可见 UI（见源码注释）。
 */
const NOTES_I18N_LINE_ALLOWLIST: Record<string, RegExp[]> = {
  // 旧版「未命名笔记」哨兵（数据层兼容）+ 后端 warning 中文原文的匹配模式（不渲染给用户）。
  'src/features/notes/notesText.ts': [/UNTITLED_NOTE_TITLE/, /text\.includes\(/],
  // 锚点卡来源/定位的旧数据哨兵比较；命中后都经 l() 输出双语，比较字面量不渲染。
  'src/features/notes/notesDisplay.ts': [
    /text === '摘录'/,
    /text === '文献'/,
    /text === '定位'/,
    /text === '引用'/,
    /text === 'Reference'/,
    /normalized === 'Untitled (N|n)ote'/,
  ],
  'src/features/notes/noteEditorBlockUtils.ts': [/noteAnchorBlock.*引用/],
  // noteUtils：锚点/标题的旧数据哨兵与默认值；命中后均经展示层本地化。
  'src/features/notes/noteUtils.ts': [
    /titleFromText\(excerpt, '引用'\)/,
    /: '定位'/,
    /\|\| '文献'/,
    /sourceLabel: anchor\.source/,
  ],
  // editor/extensions：Tiptap 节点 attrs 的旧数据默认值；渲染处已用 l()/noteAnchorDisplayText。
  'src/features/notes/editor/extensions.tsx': [
    /node\.attrs\.label \|\| '定位'/,
    /node\.attrs\.sourceLabel \|\| '摘录'/,
    /default: '定位'/,
    /default: '摘录'/,
    /getAttribute\('data-note-anchor-(label|source)'\) \|\|/,
  ],
  'src/features/notes/noteEditorUtils.ts': [
    /'定位'/,
    /'文献'/,
    /aliases:.*文献/,
  ],
  // 参考文献列表的默认标题是写入文档的数据（旧文档兼容），英文标题按 locale 选择。
  'src/features/notes/noteReferences.ts': [
    /REFERENCE_LIST_HEADING = '参考文献'/,
  ],
  // 体检修复指令发给外部 Agent（MCP write_notes），不是用户可见 UI，指令正文保持中文。
  'src/services/noteAggregation.ts': [
    /请根据以下笔记体检报告/,
    /删除类问题只列出清单/,
    /断链修复必须优先/,
    /只可新增真实锚点/,
  ],
};

/** 判断 `/` 是否开启正则字面量（除法、注释已在调用前排除）。 */
function isRegexLiteralStart(source: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
  if (cursor < 0) return true;

  const previous = source[cursor];
  if ('([{:;,=!&|?+-*%^~<>'.includes(previous)) return true;

  const wordEnd = cursor + 1;
  while (cursor >= 0 && /[A-Za-z0-9_$]/.test(source[cursor])) cursor -= 1;
  const word = source.slice(cursor + 1, wordEnd);
  return [
    'return', 'case', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
    'void', 'throw', 'else', 'do', 'yield', 'await', 'default',
  ].includes(word);
}

/** 正则字面量是代码不是文案：用空格覆盖（保持长度）后再做 CJK 判定。 */
function maskRegexLiteral(source: string, chars: string[], start: number): number {
  let i = start + 1;
  let inCharacterClass = false;

  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') break;
    if (ch === '\\') {
      chars[i] = ' ';
      if (i + 1 < source.length && source[i + 1] !== '\n') chars[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (ch === '[') inCharacterClass = true;
    else if (ch === ']') inCharacterClass = false;
    else if (ch === '/' && !inCharacterClass) {
      chars[i] = ' ';
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i])) { chars[i] = ' '; i += 1; }
      return i;
    }
    chars[i] = ' ';
    i += 1;
  }

  return i;
}

/** 把 // 与 /* *\/ 注释、正则字面量替换为空格；字符串内容原样保留，避免把中文注释误判成文案。 */
function stripComments(source: string): string {
  const chars = source.split('');
  let quote: string | null = null;
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { chars[i] = ' '; i += 1; }
      continue;
    }

    if (ch === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') chars[i] = ' ';
        i += 1;
      }
      if (i < source.length) { chars[i] = ' '; chars[i + 1] = ' '; i += 2; }
      continue;
    }

    if (ch === '/' && isRegexLiteralStart(source, i)) {
      chars[i] = ' ';
      i = maskRegexLiteral(source, chars, i);
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }

    i += 1;
  }

  return chars.join('');
}

/**
 * 解码字符串字面量里的 \uXXXX / \u{...} 转义，并用 NUL 补齐到原长度，
 * 这样 CJK 命中位置仍能对齐 stripComments 后的源码坐标；只解码、不缩短文本。
 */
function decodeUnicodeEscapes(source: string): string {
  const pad = (ch: string, length: number) => ch + '\u0000'.repeat(Math.max(0, length - ch.length));

  return source
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (match, hex) => pad(String.fromCodePoint(parseInt(hex, 16)), match.length))
    .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => pad(String.fromCharCode(parseInt(hex, 16)), match.length));
}

function localizedCallRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const callPattern = /\b(?:l|pickLocaleText|pickDocumentLocaleText)\(/g;

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
        if (depth === 0) { ranges.push([open, i]); break; }
      }
    }
  }

  return ranges;
}

function stringLiteralAt(source: string, start: number): { value: string; start: number; end: number } | null {
  const quote = source[start];
  if (quote !== '\'' && quote !== '"' && quote !== '`') return null;

  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === quote) {
      return { value: source.slice(start, i + 1), start, end: i };
    }
    i += 1;
  }

  return null;
}

/** 标记 `{ zh: '...', en: '...' }` 这类双语表里的字符串字面量位置。 */
function bilingualLiteralRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    if (ch !== '\'' && ch !== '"' && ch !== '`') {
      i += 1;
      continue;
    }

    const start = i;
    i += 1;
    while (i < source.length) {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i] === ch) { i += 1; break; }
      i += 1;
    }
    const end = i - 1;

    let cursor = start - 1;
    while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
    if (source[cursor] === ':') {
      cursor -= 1;
      while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
      const keyEnd = cursor + 1;
      while (cursor >= 0 && /[A-Za-z0-9_$]/.test(source[cursor])) cursor -= 1;
      const key = source.slice(cursor + 1, keyEnd);
      if (key === 'zh' || key === 'en' || /(?:Zh|En)$/.test(key)) {
        ranges.push([start, end]);
      }
    }
  }

  return ranges;
}

/**
 * `['中文', 'English']` 这类二元组也是双语表：只有一侧含 CJK 时才视为翻译对，
 * 避免把 `['删除', '编辑']` 这种硬编码中文列表误当双语表放过。
 */
function tupleBilingualRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pattern = /\[\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*\]/g;

  for (const match of source.matchAll(pattern)) {
    const first = match[1];
    const second = match[2];
    if (!first || !second) continue;
    const firstLiteral = stringLiteralAt(source, (match.index ?? 0) + match[0].indexOf(first));
    const secondLiteral = stringLiteralAt(source, (match.index ?? 0) + match[0].lastIndexOf(second));
    if (!firstLiteral || !secondLiteral) continue;

    const firstHasCjk = CJK_PATTERN.test(decodeUnicodeEscapes(firstLiteral.value));
    const secondHasCjk = CJK_PATTERN.test(decodeUnicodeEscapes(secondLiteral.value));
    if (firstHasCjk === secondHasCjk) continue;

    ranges.push([firstLiteral.start, firstLiteral.end]);
    ranges.push([secondLiteral.start, secondLiteral.end]);
  }

  return ranges;
}

function findUnlocalizedCjk(source: string, filePath?: string): string[] {
  const stripped = stripComments(source);
  const decoded = decodeUnicodeEscapes(stripped);
  const allowed = [
    ...localizedCallRanges(stripped),
    ...bilingualLiteralRanges(stripped),
    ...tupleBilingualRanges(stripped),
  ];
  const isAllowed = (index: number) => allowed.some(([start, end]) => index >= start && index <= end);
  const lineAllowlist = filePath ? NOTES_I18N_LINE_ALLOWLIST[filePath] ?? [] : [];
  const offenders: string[] = [];
  let lineStart = 0;

  for (const rawLine of decoded.split('\n')) {
    const lineAllowed = lineAllowlist.some((pattern) => pattern.test(rawLine));
    if (!lineAllowed && !/\bconsole\./.test(rawLine)) {
      for (let i = 0; i < rawLine.length; i += 1) {
        if (CJK_PATTERN.test(rawLine[i]) && !isAllowed(lineStart + i)) {
          offenders.push(`${lineStart + i}: ${rawLine.trim()}`);
          break;
        }
      }
    }
    lineStart += rawLine.length + 1;
  }

  return offenders;
}

test('D4-9: notes UI files keep user-visible Chinese inside l() or bilingual tables', () => {
  const offenders = NOTES_I18N_GUARDED_FILES.flatMap((file) =>
    findUnlocalizedCjk(read(file), file).map((entry) => `${file}: ${entry}`),
  );

  assert.deepEqual(offenders, [], `notes user-visible strings must be bilingual:\n${offenders.join('\n')}`);
});

test('D4-9: i18n guard rejects hardcoded Chinese and accepts localized copy', () => {
  assert.notDeepEqual(findUnlocalizedCjk("const label = '删除';"), []);
  assert.notDeepEqual(findUnlocalizedCjk('const node = <div>参考文献</div>;'), []);
  assert.deepEqual(findUnlocalizedCjk("const label = l('删除', 'Delete');"), []);
  assert.deepEqual(findUnlocalizedCjk("const label = pickLocaleText('删除', 'Delete');"), []);
  assert.deepEqual(findUnlocalizedCjk("const label = pickDocumentLocaleText('删除', 'Delete');"), []);
  assert.deepEqual(findUnlocalizedCjk("const text = { zh: '删除', en: 'Delete' };"), []);
  assert.deepEqual(findUnlocalizedCjk("const text = ['删除', 'Delete'];"), []);
  assert.deepEqual(findUnlocalizedCjk('// 这是注释\nconst value = 1;'), []);
  assert.deepEqual(findUnlocalizedCjk("console.log('删除');"), []);
});

test('D4-9: i18n guard decodes \\uXXXX escapes before checking CJK', () => {
  // 转义中文必须能被抓出来；放进 l()/双语表/翻译对里则放行。
  assert.notDeepEqual(findUnlocalizedCjk("const label = '\\u5220\\u9664';"), []);
  assert.notDeepEqual(findUnlocalizedCjk("const node = <span>\\u53c2\\u8003\\u6587\\u732e</span>;"), []);
  assert.deepEqual(findUnlocalizedCjk("const label = l('\\u5220\\u9664', 'Delete');"), []);
  assert.deepEqual(findUnlocalizedCjk("const text = ['\\u5220\\u9664', 'Delete'];"), []);
});

test('D4-9: bilingual tuple tables require one side to be translated', () => {
  // 两侧都是中文的数组不是双语表。
  assert.notDeepEqual(findUnlocalizedCjk("const labels = ['删除', '编辑'];"), []);
  assert.deepEqual(findUnlocalizedCjk("const labels = ['删除', 'Delete'];"), []);
});

test('D4-9: noteDisplayTitle maps empty and legacy sentinel titles to the active locale', () => {
  const en = <T,>(_zh: T, enText: T) => enText;
  const zh = <T,>(zhText: T, _en: T) => zhText;

  assert.equal(noteDisplayTitle('', en), 'Untitled note');
  assert.equal(noteDisplayTitle('   ', en), 'Untitled note');
  assert.equal(noteDisplayTitle(null, en), 'Untitled note');
  assert.equal(noteDisplayTitle(UNTITLED_NOTE_TITLE, en), 'Untitled note');
  assert.equal(noteDisplayTitle(' 我的笔记 ', en), ' 我的笔记 ');
  assert.equal(noteDisplayTitle('', zh), '未命名笔记');
  assert.equal(noteDisplayTitle('My note', zh), 'My note');
});

test('D4-9: note templates expose English labels, descriptions and bodies', () => {
  for (const template of NOTE_TEMPLATES) {
    assert.ok(template.labelEn && template.labelEn.trim(), `${template.id} must define labelEn`);
    assert.ok(template.descriptionEn && template.descriptionEn.trim(), `${template.id} must define descriptionEn`);
    assert.doesNotMatch(template.labelEn, CJK_PATTERN);
    assert.doesNotMatch(template.descriptionEn, CJK_PATTERN);
    assert.ok(template.contentEn.length > 0, `${template.id} must define contentEn`);
    assert.equal(
      template.contentEn.length,
      template.content.length,
      `${template.id} contentEn must mirror content`,
    );
    assert.doesNotMatch(JSON.stringify(template.contentEn), CJK_PATTERN);
  }

  const templateCommands = BASE_SLASH_COMMANDS.filter((item) => item.id.startsWith('template:'));
  assert.equal(templateCommands.length, NOTE_TEMPLATES.length);
  for (const item of templateCommands) {
    assert.ok(item.labelEn?.trim(), `${item.id} slash item must define labelEn`);
    assert.ok(item.descriptionEn?.trim(), `${item.id} slash item must define descriptionEn`);
    assert.doesNotMatch(item.labelEn ?? '', CJK_PATTERN);
    assert.doesNotMatch(item.descriptionEn ?? '', CJK_PATTERN);
  }
});

test('E5: template insertion resolves the body from the active locale', () => {
  const toolbar = read('src/features/notes/NoteEditorToolbar.tsx');
  assert.match(toolbar, /useAppLocale\(\)/);
  assert.match(toolbar, /templateContentForLocale\(template, locale\)/);

  const slashMenu = read('src/features/notes/editor/slashMenu.ts');
  assert.match(slashMenu, /locale: UiLanguage = 'zh-CN'/);
  // 斜杠命令执行时以 <html lang> 取实时语言，不能只用扩展创建时捕获的 locale。
  assert.match(slashMenu, /document\.documentElement\?\.lang/);
  assert.match(slashMenu, /templateContentForLocale\(template, effectiveLocale\)/);

  const extensions = read('src/features/notes/editor/extensions.tsx');
  assert.match(extensions, /locale: UiLanguage/);
  assert.match(extensions, /\}, locale\);/);
  assert.match(extensions, /referenceListHeadingForLocale\(headingLocale\)/);
});
