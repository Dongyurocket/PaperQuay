import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import type { LibraryCatalogProbeHandle } from './fixtures/libraryCatalogProbe';

const { act } = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const name of [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'HTMLInputElement', 'Event', 'CustomEvent', 'MouseEvent', 'localStorage',
]) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
    writable: true,
  });
}
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);

// esbuild 别名：图书馆/桌面服务在 jsdom 里不可用，用全局闸门交给用例计数与应答。
const MOCKS: Record<string, string> = {
  library: `
export const initializeLiteratureLibrary = () => globalThis.__libraryCatalogTest.initialize();
export const queryLibraryPapers = (request) => globalThis.__libraryCatalogTest.query(request);
export const listLibraryCategories = () => globalThis.__libraryCatalogTest.listCategories();
export const listAllLibraryPapers = async () => [];
export const listLibraryTags = async () => [];
export const getLibraryPaperSummary = async () => null;
`,
  desktop: 'export const localPathsExist = async (paths) => paths.map(() => false);',
  lucide: `
export const Database = () => null;
export const Folder = () => null;
export const FolderOpen = () => null;
export const Star = () => null;
`,
};

const bundle = await build({
  entryPoints: ['tests/fixtures/libraryCatalogProbe.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'library-catalog-test-mocks',
    setup(builder) {
      builder.onResolve({ filter: /services\/library$/ }, () => ({ path: 'library', namespace: 'mock' }));
      builder.onResolve({ filter: /services\/desktop$/ }, () => ({ path: 'desktop', namespace: 'mock' }));
      builder.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'lucide', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
        contents: MOCKS[args.path],
        loader: 'js',
      }));
    },
  }],
});

const probeModule = { exports: {} as Record<string, unknown> };
new Function('require', 'module', 'exports', bundle.outputFiles![0].text)(
  require,
  probeModule,
  probeModule.exports,
);
const { LibraryCatalogProbe } = probeModule.exports as {
  LibraryCatalogProbe: React.ComponentType<{ onCatalog?: (catalog: LibraryCatalogProbeHandle) => void }>;
};

const categories = () => [
  {
    id: 'cat-all', name: '全部', parentId: null, sortOrder: 0,
    isSystem: true, systemKey: 'all', createdAt: 0, updatedAt: 0, paperCount: 0,
  },
  {
    id: 'cat-2', name: '分类二', parentId: null, sortOrder: 1,
    isSystem: false, systemKey: null, createdAt: 0, updatedAt: 0, paperCount: 0,
  },
];

const settings = {
  storageDir: 'C:/paperquay-test-library',
  zoteroLocalDataDir: '',
  importMode: 'copy',
  autoRenameFiles: false,
  fileNamingRule: '',
  createCategoryFolders: false,
  folderWatchEnabled: false,
  preserveOriginalPath: false,
  openAlexEnabled: false,
  openAlexApiKey: '',
  openAlexMailto: '',
};

interface ProbeHarness {
  queries: Array<Record<string, any>>;
  getCatalog: () => LibraryCatalogProbeHandle;
  root: ReturnType<typeof createRoot>;
  container: HTMLElement;
}

/** 真实防抖下轮询等待条件成立，避免 fake timers 卡住 jsdom 的 rAF/调度。 */
async function waitFor(condition: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail(`Timed out waiting for ${label}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function settle(ms: number): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

async function mountProbe(): Promise<ProbeHarness> {
  dom.window.localStorage.clear();
  const queries: Array<Record<string, any>> = [];
  (globalThis as Record<string, any>).__libraryCatalogTest = {
    initialize: async () => ({ settings, categories: categories() }),
    query: async (request: Record<string, any>) => {
      queries.push(request);
      return { papers: [], total: 0, offset: request.offset ?? 0, limit: request.limit ?? 0 };
    },
    listCategories: async () => categories(),
  };

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let latest: LibraryCatalogProbeHandle | null = null;

  await act(async () => {
    root.render(React.createElement(LibraryCatalogProbe, {
      onCatalog: (catalog: LibraryCatalogProbeHandle) => { latest = catalog; },
    }));
  });
  await waitFor(
    () => Boolean(latest) && !latest!.loading && latest!.selectedCategoryId === 'cat-all',
    'first-screen library load',
  );
  // 首屏只查一次，且 first-screen skip 已被防抖 effect 消费。
  await settle(220);
  assert.equal(queries.length, 1, '首屏只发一次查询，first-screen skip 不应重复查询');
  assert.equal(queries[0].categoryId, 'cat-all');

  return { queries, getCatalog: () => latest!, root, container };
}

async function unmountProbe(probe: ProbeHarness): Promise<void> {
  await act(async () => { probe.root.unmount(); });
  probe.container.remove();
  delete (globalThis as Record<string, any>).__libraryCatalogTest;
}

test('点击当前已选分类不查询，且不会吞掉随后的筛选查询', async () => {
  const probe = await mountProbe();
  try {
    const beforeClick = probe.queries.length;
    await act(async () => { probe.getCatalog().handleSelectCategory('cat-all'); });
    const afterClick = probe.queries.length;
    assert.equal(afterClick, beforeClick, '点击当前已选分类不应发请求');

    await act(async () => {
      probe.getCatalog().setFilters((filters) => ({ ...filters, favorite: true }));
    });
    await waitFor(
      () => probe.queries.length === afterClick + 1,
      '筛选变化后的防抖查询',
    );
    await settle(250);
    assert.equal(probe.queries.length, afterClick + 1, '陈旧 skip 不得吞掉或复制后续查询');
    assert.equal(probe.queries[probe.queries.length - 1].favorite, true, '查询携带新的筛选条件');
  } finally {
    await unmountProbe(probe);
  }
});

test('同一事件循环内对未选分类连点两次只发一次请求', async () => {
  const probe = await mountProbe();
  try {
    const beforeClick = probe.queries.length;
    const catalog = probe.getCatalog();
    await act(async () => {
      catalog.handleSelectCategory('cat-2');
      catalog.handleSelectCategory('cat-2');
    });
    assert.equal(probe.queries.length, beforeClick + 1, '双击只应触发一次分类查询');
    await settle(250);
    assert.equal(probe.queries.length, beforeClick + 1, '随后的防抖查询应按条件键跳过');
    assert.equal(probe.getCatalog().selectedCategoryId, 'cat-2');
  } finally {
    await unmountProbe(probe);
  }
});

test('分类 A 切到 B 立即查询一次，防抖不再重复', async () => {
  const probe = await mountProbe();
  try {
    const beforeClick = probe.queries.length;
    assert.equal(probe.getCatalog().selectedCategoryId, 'cat-all');

    await act(async () => { probe.getCatalog().handleSelectCategory('cat-2'); });
    assert.equal(probe.queries.length, beforeClick + 1, '切换分类立即查询一次');
    assert.equal(probe.queries[beforeClick].categoryId, 'cat-2');
    await settle(250);
    assert.equal(probe.queries.length, beforeClick + 1, '防抖不再重复同一条件');

    await act(async () => { probe.getCatalog().handleSelectCategory('cat-all'); });
    assert.equal(probe.queries.length, beforeClick + 2, '切回原分类立即查询一次');
    assert.equal(probe.queries[beforeClick + 1].categoryId, 'cat-all');
    await settle(250);
    assert.equal(probe.queries.length, beforeClick + 2, '切回后仍无重复查询');
  } finally {
    await unmountProbe(probe);
  }
});

test('分类动作（创建/删除/拖放）直接查询后，防抖不再重复同一条件', async () => {
  const probe = await mountProbe();
  try {
    const before = probe.queries.length;
    // 模拟 useCategoryActions 的「设置分类 + refreshPapers」路径：
    // 先登记本次分类查询的条件键，再选中分类并直接查询。
    await act(async () => {
      const catalog = probe.getCatalog();
      catalog.markCategoryQueryHandled('cat-2');
      catalog.setSelectedCategoryId('cat-2');
      await catalog.refreshPapers('cat-2');
    });
    assert.equal(probe.queries.length, before + 1, '设置分类 + refreshPapers 立即查询一次');
    assert.equal(probe.queries[before].categoryId, 'cat-2');
    await settle(260);
    assert.equal(probe.queries.length, before + 1, '超过防抖窗口后仍不应重复同一条件查询');
    assert.equal(probe.getCatalog().selectedCategoryId, 'cat-2');
  } finally {
    await unmountProbe(probe);
  }
});

test('useCategoryActions 三处直接分类查询都先登记条件键再改选择（源码守卫）', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/features/literature/hooks/useCategoryActions.ts', import.meta.url)),
    'utf8',
  );
  // useCategoryActions 依赖确认弹窗/忙碌状态与 IPC 服务，jsdom 里低成本挂载成本过高；
  // 这里用源码守卫锁住三处直接查询的调用顺序，行为由上面的探针用例覆盖。
  const blocks: Array<[string, string, string]> = [
    [
      'handleSubmitCategoryName 创建分支',
      'const handleSubmitCategoryName = async (name: string) => {',
      'const handleDeleteCategory = (category: LiteratureCategory) => {',
    ],
    [
      'deleteCategoryAfterConfirm',
      'const deleteCategoryAfterConfirm = async (category: LiteratureCategory) => {',
      'const handleMoveCategory = async',
    ],
    [
      'assignPaperToCategory',
      'const assignPaperToCategory = async (paperId: string, category: LiteratureCategory) => {',
      'const handlePaperDropOnCategory =',
    ],
  ];

  for (const [label, start, end] of blocks) {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `${label} 必须存在`);
    const endIndex = source.indexOf(end, startIndex);
    assert.notEqual(endIndex, -1, `${label} 的结束标记必须存在`);
    const block = source.slice(startIndex, endIndex);
    const markIndex = block.indexOf('markCategoryQueryHandled(');
    const selectIndex = block.indexOf('setSelectedCategoryId(');
    const refreshIndex = block.indexOf('await refreshPapers(');

    assert.notEqual(markIndex, -1, `${label} 必须调用 markCategoryQueryHandled`);
    assert.notEqual(selectIndex, -1, `${label} 必须设置选中分类`);
    assert.notEqual(refreshIndex, -1, `${label} 必须直接查询文献`);
    assert.ok(markIndex < selectIndex, `${label} 必须在 setSelectedCategoryId 之前登记条件键`);
    assert.ok(selectIndex < refreshIndex, `${label} 必须在 refreshPapers 之前改选择`);
  }

  assert.equal(
    source.match(/markCategoryQueryHandled\(/g)?.length,
    3,
    '三处直接查询各调用一次 markCategoryQueryHandled',
  );
});
