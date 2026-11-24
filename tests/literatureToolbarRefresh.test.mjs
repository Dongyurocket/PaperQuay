import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

/**
 * D4-6：后台刷新必须在工具栏可见地报告状态（role=status + aria-live），
 * 同时列表继续渲染旧行，不能退回加载卡片。
 *
 * 仓库没有 @testing-library；这里用 esbuild 打包组件后走
 * react-dom/server 合成渲染（不执行 effect），断言静态输出。
 */
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const bundle = await build({
  entryPoints: ['src/features/literature/components/LiteratureToolbar.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  write: false,
  logLevel: 'silent',
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, compiled, compiled.exports);
const LiteratureToolbar = compiled.exports.default;

const listBundle = await build({
  entryPoints: ['src/features/literature/components/LiteraturePaperList.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  write: false,
  logLevel: 'silent',
});
const listCompiled = { exports: {} };
new Function('require', 'module', 'exports', listBundle.outputFiles[0].text)(require, listCompiled, listCompiled.exports);
const LiteraturePaperList = listCompiled.exports.default;

const DEFAULT_FILTERS = {
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

function renderToolbar(overrides = {}) {
  const props = {
    working: false,
    refreshing: false,
    total: 2,
    libraryTotal: 2,
    selectAllState: 'none',
    onToggleSelectAll: () => {},
    search: '',
    onSearch: () => {},
    filters: DEFAULT_FILTERS,
    onFilters: () => {},
    tags: [],
    sortBy: 'manual',
    sortDirection: 'asc',
    onSort: () => {},
    titleMode: 'both',
    onTitleMode: () => {},
    showHeatmap: false,
    onHeatmap: () => {},
    compact: false,
    onCompact: () => {},
    onImport: () => {},
    onAudit: () => {},
    onRefresh: () => {},
    statusMessage: '',
    error: '',
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(LiteratureToolbar, props));
}

test('the toolbar exposes a live status region while refreshing', () => {
  const idle = renderToolbar();
  assert.match(idle, /role="status"/, 'the status region must always exist for screen readers');
  assert.match(idle, /aria-live="polite"/);
  assert.doesNotMatch(idle, /正在刷新|Refreshing/, 'idle renders no refresh text');

  const refreshing = renderToolbar({ refreshing: true });
  assert.match(refreshing, /role="status"/);
  assert.match(refreshing, /aria-live="polite"/);
  assert.match(refreshing, /正在刷新…/, 'the Chinese locale must announce the refresh');
  assert.match(refreshing, />2</, 'the existing result count must stay rendered');
});

test('the list keeps old rows during a background refresh instead of showing the skeleton', () => {
  const noop = () => {};
  const paper = {
    id: 'paper-1',
    title: 'Retained paper',
    titleZh: null,
    year: '2024',
    publication: null,
    authors: [],
    tags: [],
    categoryIds: [],
    attachments: [],
    isFavorite: false,
    readingProgress: 0,
    aiSummary: null,
    importedAt: 1,
    updatedAt: 1,
    lastReadAt: null,
  };
  const props = {
    loading: false,
    working: false,
    refreshing: true,
    papers: [paper],
    papersTotal: 1,
    paperStatuses: {},
    selectedPaper: null,
    searchQuery: '',
    filters: DEFAULT_FILTERS,
    onFiltersChange: noop,
    tags: [],
    libraryTotal: 1,
    sortBy: 'manual',
    sortDirection: 'asc',
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

  const idle = renderToStaticMarkup(React.createElement(LiteraturePaperList, props));
  assert.match(idle, /Retained paper/, 'rows stay mounted while refreshing');
  assert.match(idle, /正在刷新…/, 'the toolbar status is part of the same pane');
  assert.doesNotMatch(idle, /正在加载文献库/, 'a background refresh must not show the loading card');

  const firstLoad = renderToStaticMarkup(React.createElement(LiteraturePaperList, {
    ...props,
    loading: true,
    papers: [],
  }));
  assert.match(firstLoad, /正在加载文献库/);
  assert.doesNotMatch(firstLoad, /Retained paper/);
});
