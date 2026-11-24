import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

/**
 * 文献列表语义与键盘漫游（第 7、8 项）。
 *
 * 用真实 LiteraturePaperList + LiteraturePaperRow 渲染：
 * - role=list / listitem / aria-posinset 在虚拟窗口里必须用全局索引；
 * - role=list 的直接子元素只能是 listitem 与 presentation（上下高度占位）；
 * - aria-setsize 保持已加载行数 papers.length，分页总数由工具栏/加载更多播报；
 * - ArrowUp/ArrowDown/Home/End 移动焦点，跨虚拟窗口时先滚动再 rAF 轮询挂载；
 *   覆盖中间行 ArrowUp 向上跨窗口、Home 从末尾回到 0、ArrowDown 逐步越出窗口；
 * - 方向键只移动焦点，不改变选择；Enter/Space 行为保持不变。
 *
 * jsdom 不执行布局：clientHeight 为 0 时组件回退到 600 视口；行高测量为 0，
 * 因此窗口按默认行高 132+8 计算。ResizeObserver 未注入，组件走 undefined 分支。
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

// 只替换与列表语义/键盘无关的展示依赖；列表与行保持真实实现。
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
  'lucide-react': ['BookOpenText', 'Check', 'GripVertical', 'Star']
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
    name: 'paper-list-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (!args.importer) return undefined;
        const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
        return fixtures[name] ? { path: name, namespace: 'paper-list-fixture' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'paper-list-fixture' }, (args) => ({
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

function baseProps(list: any[]) {
  return {
    loading: false,
    working: false,
    papers: list,
    paperStatuses: {},
    selectedPaper: null,
    multiSelectedPaperIds: [],
    selectAllState: 'none',
    searchQuery: '',
    filters,
    onFiltersChange: noop,
    tags: [],
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

function scroller(container: Element) {
  return container.querySelector('[data-wheel-scroll-target]') as HTMLElement;
}

function rowButton(container: Element, id: string) {
  return container.querySelector(`[data-paper-row-id="${id}"]`) as HTMLElement | null;
}

function activeRowId() {
  const active = dom.window.document.activeElement as HTMLElement | null;
  return active?.dataset?.paperRowId ?? null;
}

async function press(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
  });
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail(`Timed out waiting for ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

/** 当前挂载行的全局索引（升序）。 */
function mountedIndexes(container: Element): number[] {
  return [...container.querySelectorAll('[data-paper-row-index]')]
    .map((element) => Number((element as HTMLElement).dataset.paperRowIndex))
    .sort((left, right) => left - right);
}

/** role=list 的内容模型：直接子元素只能是 listitem 或 presentation（高度占位）。 */
function assertListContentModel(container: Element): HTMLElement[] {
  const listElement = container.querySelector('[role="list"]');
  assert.ok(listElement, '列表 wrapper 应有 role=list');
  const spacers: HTMLElement[] = [];
  for (const child of [...listElement!.children] as HTMLElement[]) {
    const role = child.getAttribute('role');
    if (role === 'presentation') {
      spacers.push(child);
      continue;
    }
    assert.equal(role, 'listitem', `role=list 的直接子元素只能有 listitem 或 presentation，实际 ${role}`);
  }
  for (const spacer of spacers) {
    assert.equal(spacer.getAttribute('aria-hidden'), 'true', '高度占位应对读屏隐藏');
    assert.match(spacer.style.height, /^\d+px$/, '高度占位仍保留像素高度');
  }
  return spacers;
}

/** 挂载窗口的全局索引连续，aria-posinset 用全局位置，aria-setsize 用给定集合大小。 */
function assertContiguousPositions(container: Element, setSize: number) {
  const items = [...container.querySelectorAll('[role="listitem"]')]
    .map((element) => ({
      index: Number((element as HTMLElement).dataset.paperRowIndex),
      posinset: Number(element.getAttribute('aria-posinset')),
      setsize: element.getAttribute('aria-setsize'),
    }))
    .sort((left, right) => left.index - right.index);
  assert.equal(items.length > 0, true, '窗口内应有挂载行');
  for (let offset = 0; offset < items.length; offset += 1) {
    if (offset > 0) {
      assert.equal(items[offset].index, items[offset - 1].index + 1, '窗口内全局索引必须连续');
    }
    assert.equal(items[offset].posinset, items[offset].index + 1, 'aria-posinset 用全局索引');
    assert.equal(items[offset].setsize, String(setSize), 'aria-setsize 用已加载行数');
  }
}

test('paper list exposes list semantics with per-row positions and sizes', async (t) => {
  const list = papers(3);
  const view = await mountList(baseProps(list));
  t.after(() => view.unmount());

  const listElement = view.container.querySelector('[role="list"]');
  assert.ok(listElement, '列表 wrapper 应有 role=list');
  assert.equal(listElement!.getAttribute('aria-label'), '文献列表');

  const items = [...view.container.querySelectorAll('[role="listitem"]')];
  assert.equal(items.length, 3);
  items.forEach((item, index) => {
    assert.equal(item.getAttribute('aria-setsize'), '3');
    assert.equal(item.getAttribute('aria-posinset'), String(index + 1));
    const button = item.querySelector('[data-paper-row-id]');
    assert.equal(button?.getAttribute('role'), 'button', '内层行保持 role=button');
    assert.equal((button as HTMLElement).tabIndex, 0, '内层行保持可 Tab 聚焦');
  });
  assert.equal(view.container.querySelectorAll('[role="listitem"] [data-paper-row-id]').length, 3);
});

test('virtual windows report global aria-posinset values', async (t) => {
  const list = papers(100);
  const view = await mountList(baseProps(list));
  t.after(() => view.unmount());

  const initialItems = [...view.container.querySelectorAll('[role="listitem"]')];
  assert.equal(initialItems.length > 0, true);
  assert.equal(initialItems.length < 100, true, '100 行列表只挂载窗口内行');
  assert.equal(initialItems[0].getAttribute('aria-posinset'), '1');

  // 手动触发 onScroll：jsdom 不会在 scrollTop 赋值后自动派发 scroll。
  await act(async () => {
    const element = scroller(view.container);
    element.scrollTop = 4000;
    element.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => {
    const items = [...view.container.querySelectorAll('[role="listitem"]')];
    return items.length > 0 && Number(items[0].getAttribute('aria-posinset')) > 1;
  }, 'virtual window to move after scroll');

  const scrolledItems = [...view.container.querySelectorAll('[role="listitem"]')];
  for (const item of scrolledItems) {
    const globalIndex = Number((item as HTMLElement).dataset.paperRowIndex);
    assert.equal(globalIndex > 0, true, '虚拟窗口首行不应回到全局索引 0');
    assert.equal(item.getAttribute('aria-posinset'), String(globalIndex + 1));
    assert.equal(item.getAttribute('aria-setsize'), '100');
  }

  // 上下高度占位只能是 presentation，role=list 直接子元素不得混入无 role 的 div。
  const spacers = assertListContentModel(view.container);
  assert.equal(spacers.length, 2, '虚拟列表上下各一个高度占位');
  assertContiguousPositions(view.container, 100);
});

test('non-virtual lists keep the same list content model without spacers', async (t) => {
  const list = papers(8);
  const view = await mountList(baseProps(list));
  t.after(() => view.unmount());

  const spacers = assertListContentModel(view.container);
  assert.equal(spacers.length, 0, '非虚拟列表不需要高度占位');
  assertContiguousPositions(view.container, 8);
});

test('aria-setsize stays the loaded row count when the pagination total is larger', async (t) => {
  // 任务口径：aria-setsize 用 papers.length，而不是分页总数 papersTotal；
  // 分页总数由工具栏「全选当前结果（N 篇）」与加载更多提示播报。
  const list = papers(100);
  const view = await mountList({ ...baseProps(list), papersTotal: 5000 });
  t.after(() => view.unmount());

  const items = [...view.container.querySelectorAll('[role="listitem"]')];
  assert.equal(items.length > 0, true);
  assert.equal(items.length < 100, true);
  for (const item of items) {
    assert.equal(item.getAttribute('aria-setsize'), '100', 'aria-setsize 不得改用分页总数');
  }
  assertContiguousPositions(view.container, 100);

  const loadMore = scroller(view.container).querySelector('[role="status"]');
  assert.match(loadMore?.textContent ?? '', /已加载 100 \/ 5000/, '分页总数由加载更多提示播报');

  // 非虚拟分页列表同理。
  const smallList = papers(8);
  const small = await mountList({ ...baseProps(smallList), papersTotal: 100 });
  t.after(() => small.unmount());
  for (const item of small.container.querySelectorAll('[role="listitem"]')) {
    assert.equal(item.getAttribute('aria-setsize'), '8');
  }
});

test('loading, empty and load-more states announce status', async (t) => {
  const loading = await mountList({ ...baseProps([]), loading: true });
  t.after(() => loading.unmount());
  const loadingScroller = scroller(loading.container);
  assert.equal(loadingScroller.getAttribute('aria-busy'), 'true', '加载时滚动容器 aria-busy');
  const loadingStatus = loadingScroller.querySelector('[role="status"]');
  assert.ok(loadingStatus, '加载占位应是状态区域');
  assert.match(loadingStatus!.textContent ?? '', /正在加载文献库/);

  const empty = await mountList(baseProps([]));
  t.after(() => empty.unmount());
  const emptyStatus = scroller(empty.container).querySelector('[role="status"]');
  assert.ok(emptyStatus, '空态应有明确语义');
  assert.match(emptyStatus!.textContent ?? '', /还没有文献/);

  const more = await mountList({
    ...baseProps(papers(3)),
    papersTotal: 10,
    loadingMore: true,
  });
  t.after(() => more.unmount());
  const moreStatus = scroller(more.container).querySelector('[role="status"]');
  assert.ok(moreStatus, '加载更多提示应是状态区域');
  assert.equal(moreStatus!.getAttribute('aria-live'), 'polite');
  assert.match(moreStatus!.textContent ?? '', /正在加载更多/);
});

test('selection count is announced through a dedicated live region', async (t) => {
  const list = papers(3);
  const view = await mountList({ ...baseProps(list), multiSelectedPaperIds: ['paper-0'] });
  t.after(() => view.unmount());

  const status = () => view.container.querySelector('[data-paper-selection-status]');
  assert.ok(status(), '应存在选择计数播报区域');
  assert.equal(status()!.getAttribute('role'), 'status');
  assert.equal(status()!.getAttribute('aria-live'), 'polite');
  assert.equal(status()!.getAttribute('aria-atomic'), 'true');
  assert.equal(status()!.textContent, '已选择 1 篇');

  await view.render({ ...baseProps(list), multiSelectedPaperIds: ['paper-0', 'paper-1'] });
  assert.equal(status()!.textContent, '已选择 2 篇');

  await view.render({ ...baseProps(list), multiSelectedPaperIds: [] });
  assert.equal(status()!.textContent, '');
});

test('arrow, Home and End move focus without changing selection on a short list', async (t) => {
  const list = papers(8);
  const selected: string[] = [];
  const opened: string[] = [];
  const view = await mountList({
    ...baseProps(list),
    onSelectPaper: (id: string) => selected.push(id),
    onOpenPaper: (item: any) => opened.push(item.id),
  });
  t.after(() => view.unmount());

  const first = rowButton(view.container, 'paper-0')!;
  first.focus();
  assert.equal(activeRowId(), 'paper-0');

  await press(first, 'ArrowDown');
  assert.equal(activeRowId(), 'paper-1');
  await press(rowButton(view.container, 'paper-1')!, 'ArrowDown');
  assert.equal(activeRowId(), 'paper-2');
  await press(rowButton(view.container, 'paper-2')!, 'ArrowUp');
  assert.equal(activeRowId(), 'paper-1');
  await press(rowButton(view.container, 'paper-1')!, 'Home');
  assert.equal(activeRowId(), 'paper-0');
  await press(rowButton(view.container, 'paper-0')!, 'End');
  assert.equal(activeRowId(), 'paper-7');

  // 边界不越界。
  await press(rowButton(view.container, 'paper-7')!, 'ArrowDown');
  assert.equal(activeRowId(), 'paper-7');
  await press(rowButton(view.container, 'paper-7')!, 'ArrowUp');
  assert.equal(activeRowId(), 'paper-6');
  await press(rowButton(view.container, 'paper-6')!, 'Home');
  await press(rowButton(view.container, 'paper-0')!, 'ArrowUp');
  assert.equal(activeRowId(), 'paper-0');

  // 无关键不移动焦点，方向键不触发选择。
  await press(rowButton(view.container, 'paper-0')!, 'a');
  assert.equal(activeRowId(), 'paper-0');
  assert.deepEqual(selected, [], '方向键不得触发选择');

  // 行内 Enter/Space 语义保持不变。
  await press(rowButton(view.container, 'paper-0')!, 'Enter');
  assert.deepEqual(opened, ['paper-0']);
  await press(rowButton(view.container, 'paper-0')!, ' ');
  assert.deepEqual(selected, ['paper-0']);
});

test('keyboard navigation reaches rows outside the virtual window', async (t) => {
  const list = papers(100);
  const view = await mountList(baseProps(list));
  t.after(() => view.unmount());

  rowButton(view.container, 'paper-0')!.focus();
  await press(rowButton(view.container, 'paper-0')!, 'ArrowDown');
  await press(dom.window.document.activeElement as Element, 'ArrowDown');
  await press(dom.window.document.activeElement as Element, 'ArrowDown');
  assert.equal(activeRowId(), 'paper-3', '窗口内方向键直接移动焦点');

  await press(dom.window.document.activeElement as Element, 'End');
  await waitFor(() => activeRowId() === 'paper-99', 'focus to reach the last row after End');

  const mounted = view.container.querySelectorAll('[data-paper-row-id]').length;
  assert.equal(scroller(view.container).scrollTop > 0, true, 'End 应滚动列表');
  assert.equal(mounted < 30, true, `100 行列表滚动后仍只挂载窗口内行，实际 ${mounted} 行`);

  // 末尾继续 ArrowDown 不越界。
  await press(dom.window.document.activeElement as Element, 'ArrowDown');
  assert.equal(activeRowId(), 'paper-99');

  t.diagnostic(`100-row virtual list mounted ${mounted} rows after End`);
});

test('ArrowUp, Home and ArrowDown cross virtual windows in both directions', async (t) => {
  const list = papers(100);
  const view = await mountList(baseProps(list));
  t.after(() => view.unmount());
  const scrollElement = scroller(view.container);

  // 先把窗口滚到中部；jsdom 不会在 scrollTop 赋值后自动派发 scroll。
  await act(async () => {
    scrollElement.scrollTop = 4000;
    scrollElement.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => {
    const indexes = mountedIndexes(view.container);
    return indexes.length > 0 && indexes[0] > 10;
  }, 'virtual window to move to the middle');
  const middleIndexes = mountedIndexes(view.container);
  const firstMounted = middleIndexes[0];
  const scrollBeforeArrowUp = scrollElement.scrollTop;
  assert.equal(scrollBeforeArrowUp, 4000);

  // 中间行 ArrowUp：焦点在窗口首行，目标是窗口外上一行，必须先滚动再挂载。
  rowButton(view.container, `paper-${firstMounted}`)!.focus();
  await press(dom.window.document.activeElement as Element, 'ArrowUp');
  await waitFor(
    () => activeRowId() === `paper-${firstMounted - 1}`,
    'ArrowUp to mount and focus the row above the window',
  );
  const afterArrowUp = mountedIndexes(view.container);
  assert.equal(afterArrowUp[0] <= firstMounted - 1, true, 'ArrowUp 后目标行已挂载');
  assert.equal(scrollElement.scrollTop < scrollBeforeArrowUp, true, 'ArrowUp 跨窗口应向上滚动');
  assert.equal(afterArrowUp.length < 30, true, `ArrowUp 后仍只挂载窗口内行，实际 ${afterArrowUp.length} 行`);
  assertContiguousPositions(view.container, 100);
  t.diagnostic(
    `middle ArrowUp: window [${middleIndexes[0]}..${middleIndexes.at(-1)}] -> [${afterArrowUp[0]}..${afterArrowUp.at(-1)}], scrollTop ${scrollBeforeArrowUp} -> ${scrollElement.scrollTop}`,
  );

  // End 到末尾，再 Home 从末尾向后跨窗口回到 0。
  await press(dom.window.document.activeElement as Element, 'End');
  await waitFor(() => activeRowId() === 'paper-99', 'End to reach the last row');
  const endIndexes = mountedIndexes(view.container);
  assert.equal(endIndexes.at(-1), 99);
  assert.equal(scrollElement.scrollTop > 0, true);

  await press(dom.window.document.activeElement as Element, 'Home');
  await waitFor(() => activeRowId() === 'paper-0', 'Home to return to the first row');
  assert.equal(scrollElement.scrollTop, 0, 'Home 应把列表滚回顶部');
  assert.equal(mountedIndexes(view.container)[0], 0, 'Home 后从第 0 行开始挂载');
  assert.equal(mountedIndexes(view.container).length < 30, true);
  assertContiguousPositions(view.container, 100);

  // ArrowDown 逐步走出当前窗口：越过窗口末尾后应滚动、挂载并聚焦目标行。
  const windowEnd = mountedIndexes(view.container).at(-1)!;
  assert.equal(windowEnd < 99, true, '顶部窗口不覆盖整份列表');
  for (let step = 1; step <= windowEnd + 2; step += 1) {
    await press(dom.window.document.activeElement as Element, 'ArrowDown');
    await waitFor(() => activeRowId() === `paper-${step}`, `ArrowDown to focus paper-${step}`);
    assert.equal(mountedIndexes(view.container).length < 30, true, '逐步 ArrowDown 时挂载行数仍受限');
  }
  assert.equal(activeRowId(), `paper-${windowEnd + 2}`);
  assert.equal(scrollElement.scrollTop > 0, true, '越过窗口后应滚动列表');
  const afterArrowDown = mountedIndexes(view.container);
  assert.equal(afterArrowDown[0] <= windowEnd + 1, true, '越过窗口时目标行已滚动挂载');
  assertContiguousPositions(view.container, 100);
  const spacers = assertListContentModel(view.container);
  assert.equal(spacers.length, 2, '跨窗口滚动后上下高度占位仍为 presentation');
  t.diagnostic(
    `ArrowDown past window ${windowEnd}: mounted [${afterArrowDown[0]}..${afterArrowDown.at(-1)}], scrollTop ${scrollElement.scrollTop}, active ${activeRowId()}`,
  );
});
