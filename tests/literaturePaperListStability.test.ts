import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

/**
 * 文献列表渲染稳定性（第 9 项）。
 *
 * 用 esbuild 把 LiteraturePaperRow 替换成「计数 memo 桩」：桩是 React.memo，
 * 每次真正执行函数体时按 paper.id 记一次渲染。列表本身保持真实实现。
 *
 * 断言：
 * - 只改 selectedPaper：仅新旧选中行重渲染；
 * - 只改 filters 引用：所有行渲染计数不变；
 * - 改 papers 数组：新行集合每行只渲染一次，不整表重复渲染；
 * - 父组件每次渲染都传新的回调引用（真实 LiteratureLibraryView 的形态：
 *   onSelectPaper 依赖 selectedPaperId、onPaperContextMenu 是普通函数、
 *   onPaperReorder 是内联箭头）：未选中行不得重渲染，点击后只有新旧选中行渲染。
 *   与前面用例的区别：那些用例传的是模块级 noop，回调引用天然稳定，发现不了
 *   列表透传外部回调导致的 memo 击穿。
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const name of [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'localStorage',
]) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as any)[name],
    configurable: true,
    writable: true,
  });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

const fixtures: Record<string, string> = {
  uiLanguage: `export const useLocaleText = () => (zh, en) => zh;
export const useAppLocale = () => 'zh-CN';`,
  useWheelScrollDelegate: `export const useWheelScrollDelegate = () => () => {};`,
  paperHistory: `export const loadPaperHistoryMap = () => ({});
export const PAPER_READING_HEATMAP_UPDATED_EVENT = 'pq-test:heatmap';`,
  literatureUi: `export const paperAuthors = () => '';
export const paperPdfPath = () => '';`,
  titleDisplay: `export const resolvePaperTitleDisplay = (paper) => ({ primary: paper.title, secondary: null });`,
  LiteratureReadingHeatmapPreview: `export default function LiteratureReadingHeatmapPreview() { return null; }`,
  LiteratureToolbar: `import React from 'react';
export default function LiteratureToolbar() { return React.createElement('div', { 'data-toolbar': '' }); }`,
  // 计数 memo 桩：只有 React 真正渲染该行时函数体才执行。
  LiteraturePaperRow: `import React from 'react';
function CountingPaperRow(props) {
  const counts = globalThis.__paperRowRenderCounts ?? (globalThis.__paperRowRenderCounts = {});
  counts[props.paper.id] = (counts[props.paper.id] ?? 0) + 1;
  globalThis.__paperRowRenderProps = props;
  return React.createElement('div', {
    role: 'listitem',
    'data-paper-row-id': props.paper.id,
    'data-paper-row-index': props.position - 1,
    'aria-posinset': props.position,
    'aria-setsize': props.setSize,
    'data-active': String(props.active),
    // 真实行把点击转交给 onSelectPaper；桩只需模拟这一条路径供「点击后不整表重渲染」用例使用。
    onClick: () => props.onSelectPaper(props.paper.id, {}),
  }, props.paper.title);
}
const MemoRow = React.memo(CountingPaperRow);
MemoRow.displayName = 'CountingPaperRowStub';
export default MemoRow;`,
  'lucide-react': ['BookOpenText', 'Check', 'GripVertical', 'SearchX', 'Star']
    .map((name) => `export const ${name} = () => null;`)
    .join('\n'),
};

const bundle = await build({
  entryPoints: ['src/features/literature/components/LiteraturePaperList.tsx'],
  absWorkingDir: repoRoot,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'paper-list-stability-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (!args.importer) return undefined;
        const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
        return fixtures[name] ? { path: name, namespace: 'paper-list-stability' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'paper-list-stability' }, (args) => ({
        contents: fixtures[args.path],
        loader: 'js',
      }));
    },
  }],
});

const compiled = { exports: {} as any };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, compiled, compiled.exports);
const LiteraturePaperList = compiled.exports.default as (props: any) => any;

const noop = () => {};

const filters = {
  favorite: false,
  recentlyRead: false,
  tagIds: [],
  yearFrom: null,
  yearTo: null,
  itemTypes: [],
  readStatus: null,
  hasPdf: false,
  hasTranslatedPdf: false,
  missingFile: false,
  hasSummary: false,
  mineruParsed: false,
  source: '',
  ragMembership: 'all',
};

function paper(index: number) {
  return {
    id: `paper-${index}`,
    title: `Paper ${index}`,
    titleZh: null,
    year: '2024',
    publication: 'Journal',
    doi: null,
    url: null,
    abstractText: null,
    keywords: [],
    importedAt: 1700000000000 + index,
    updatedAt: 1700000000000 + index,
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: false,
    userNote: null,
    aiSummary: null,
    citation: null,
    source: 'local',
    sortOrder: index,
    authors: [],
    tags: [],
    categoryIds: [],
    attachments: [],
    ragEnabled: true,
  };
}

function papers(count: number) {
  return Array.from({ length: count }, (_, index) => paper(index));
}

const EMPTY_IDS: string[] = [];
const EMPTY_TAGS: any[] = [];

function baseProps(list: any[]) {
  return {
    loading: false,
    working: false,
    papers: list,
    paperStatuses: {},
    selectedPaper: null,
    // 默认值改由模块级常量承担后，这里仍显式传稳定数组，避免测试自身制造抖动。
    multiSelectedPaperIds: EMPTY_IDS,
    selectAllState: 'none',
    searchQuery: '',
    filters,
    onFiltersChange: noop,
    tags: EMPTY_TAGS,
    libraryTotal: list.length,
    sortBy: 'importedAt',
    sortDirection: 'desc',
    titleDisplayMode: 'both',
    statusMessage: '',
    error: '',
    onSearchQueryChange: noop,
    onSortChange: noop,
    onTitleDisplayModeChange: noop,
    onImportPdfs: noop,
    onInspectPdfAssets: noop,
    onRefresh: noop,
    onSelectPaper: noop,
    onOpenPaper: noop,
    onPaperDragStart: noop,
    onPaperReorder: noop,
    onPaperDropOnCategory: noop,
    onPaperPointerDragOverCategory: noop,
    onPaperContextMenu: noop,
  };
}

function resetCounts() {
  (globalThis as any).__paperRowRenderCounts = {};
  (globalThis as any).__paperRowRenderProps = null;
}

function snapshot(): Record<string, number> {
  return { ...((globalThis as any).__paperRowRenderCounts ?? {}) };
}

function rowElement(container: Element, id: string): HTMLElement {
  const element = container.querySelector(`[data-paper-row-id="${id}"]`) as HTMLElement | null;
  assert.ok(element, `row ${id} should be mounted`);
  return element;
}

function diff(before: Record<string, number>, after: Record<string, number>) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const delta: Record<string, number> = {};
  for (const id of ids) {
    const change = (after[id] ?? 0) - (before[id] ?? 0);
    if (change !== 0) delta[id] = change;
  }
  return delta;
}

async function mountList(props: any) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(LiteraturePaperList, props));
  });
  return {
    container,
    async render(next: any) {
      await act(async () => {
        root.render(React.createElement(LiteraturePaperList, next));
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('changing only selectedPaper re-renders the old and new active rows', async (t) => {
  resetCounts();
  const list = papers(8);
  const view = await mountList({ ...baseProps(list), selectedPaper: list[1] });
  t.after(() => view.unmount());

  const initial = snapshot();
  assert.equal(Object.keys(initial).length, 8, '8 行全部渲染');
  assert.deepEqual(
    [...new Set(Object.values(initial))],
    [1],
    '初次挂载每行只渲染一次',
  );
  const lastProps = (globalThis as any).__paperRowRenderProps;
  assert.equal('papers' in lastProps, false, '行 props 不应携带整份 papers 数组');

  await view.render({ ...baseProps(list), selectedPaper: list[3] });
  const delta = diff(initial, snapshot());
  assert.deepEqual(delta, { 'paper-1': 1, 'paper-3': 1 }, '仅新旧选中行重渲染');
  t.diagnostic(`selection change render delta: ${JSON.stringify(delta)}`);
});

test('changing only the filters reference does not re-render any row', async (t) => {
  resetCounts();
  const list = papers(8);
  const view = await mountList({ ...baseProps(list), selectedPaper: list[2] });
  t.after(() => view.unmount());
  const before = snapshot();

  const nextFilters = { ...filters, favorite: true, tagIds: ['tag-1'] };
  await view.render({
    ...baseProps(list),
    selectedPaper: list[2],
    filters: nextFilters,
  });
  const delta = diff(before, snapshot());
  assert.deepEqual(delta, {}, '仅 filters 引用变化不应重渲染任何行');
  t.diagnostic(`filters-only render delta: ${JSON.stringify(delta)}`);
});

test('a changed paper collection renders each new row exactly once', async (t) => {
  resetCounts();
  const initial = papers(8);
  const view = await mountList({ ...baseProps(initial), selectedPaper: initial[1] });
  t.after(() => view.unmount());
  const before = snapshot();

  // 模拟筛选结果变化：保留 4 篇，但 paper 对象是新引用。
  const next = [paper(1), paper(3), paper(5), paper(7)];
  await view.render({ ...baseProps(next), selectedPaper: initial[1] });
  const delta = diff(before, snapshot());

  assert.deepEqual(delta, {
    'paper-1': 1,
    'paper-3': 1,
    'paper-5': 1,
    'paper-7': 1,
  }, '新行集合每行只渲染一次，不重复渲染');
  assert.equal(delta['paper-1'], 1, '选中行也不得因选择状态再渲染一次');
  assert.equal(view.container.querySelectorAll('[data-paper-row-id]').length, 4);
  t.diagnostic(`papers change render delta: ${JSON.stringify(delta)}`);
});

test('unstable parent callback references still re-render only the affected rows', async (t) => {
  resetCounts();
  const list = papers(8);
  const selectCalls: string[] = [];
  let generation = 0;

  // 复刻 LiteratureLibraryView 的真实形态：onSelectPaper 依赖 selectedPaperId、
  // onPaperContextMenu 是普通函数、onPaperReorder 是内联箭头，父组件每次渲染都换引用。
  // 每代闭包写入自己的代号，顺带验证 ref 转发调用的是最新一代实现。
  const parentProps = (selected: any) => {
    generation += 1;
    const renderGeneration = generation;
    return {
      ...baseProps(list),
      selectedPaper: selected,
      onSelectPaper: (paperId: string) => {
        selectCalls.push(`${renderGeneration}:${paperId}`);
      },
      onOpenPaper: (item: any) => selectCalls.push(`${renderGeneration}:open:${item.id}`),
      onPaperContextMenu: () => {},
      onPaperReorder: () => {},
      onPaperDragStart: () => {},
      onPaperDropOnCategory: () => {},
      onPaperPointerDragOverCategory: () => {},
    };
  };

  const view = await mountList(parentProps(null));
  t.after(() => view.unmount());
  const initial = snapshot();
  assert.deepEqual(
    [...new Set(Object.values(initial))],
    [1],
    '初次挂载每行只渲染一次',
  );

  // 仅父组件重渲染：8 个回调全部换引用，但选中态与数据不变，不应有任何行重渲染。
  await view.render(parentProps(null));
  const idleDelta = diff(initial, snapshot());
  assert.deepEqual(idleDelta, {}, '不稳定回调引用不得击穿 memo');
  t.diagnostic(`unstable-callback idle render delta: ${JSON.stringify(idleDelta)}`);

  // 点击选择 paper-2，父组件带着新的闭合引用与新的选中态重渲染。
  await act(async () => {
    rowElement(view.container, 'paper-2').dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    );
  });
  assert.deepEqual(selectCalls, ['2:paper-2'], '行应调用最新一次渲染的 onSelectPaper');
  const beforeFirstSelect = snapshot();
  await view.render(parentProps(list[2]));
  const firstDelta = diff(beforeFirstSelect, snapshot());
  assert.deepEqual(firstDelta, { 'paper-2': 1 }, '只有新选中行重渲染');
  t.diagnostic(`unstable-callback first select delta: ${JSON.stringify(firstDelta)}`);

  // 再选择 paper-5：旧选中行与新选中行各渲染一次，其余行保持不动。
  await act(async () => {
    rowElement(view.container, 'paper-5').dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    );
  });
  assert.deepEqual(selectCalls, ['2:paper-2', '3:paper-5'], '再次点击应使用第 3 代闭包');
  const beforeSecondSelect = snapshot();
  await view.render(parentProps(list[5]));
  const secondDelta = diff(beforeSecondSelect, snapshot());
  assert.deepEqual(secondDelta, { 'paper-2': 1, 'paper-5': 1 }, '仅新旧选中行重渲染');
  t.diagnostic(`unstable-callback second select delta: ${JSON.stringify(secondDelta)}`);

  // 回调稳定性不应牺牲内容：选中状态仍落到行 props 上。
  assert.equal(rowElement(view.container, 'paper-5').getAttribute('data-active'), 'true');
  assert.equal(rowElement(view.container, 'paper-2').getAttribute('data-active'), 'false');
});
