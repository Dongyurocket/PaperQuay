import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// D6-9：文献库面板在 Notes/Graph 下仍以 hidden 挂载，详情表单的
// Ctrl/Cmd+S 与 Esc 只应作用于「可见且焦点在面板内」的草稿。
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'localStorage']) {
  Object.defineProperty(globalThis, name, { value: (dom.window as any)[name], configurable: true, writable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 不执行布局，getClientRects 恒为空；这里按 hidden/display 语义返回矩形，
// 让可见性判断在测试中只取决于面板与工作区的隐藏状态。
function visibleClientRects(start: any) {
  let node: any = start;
  while (node) {
    if (node.hidden === true || node.style?.display === 'none') return { length: 0 };
    node = node.parentElement;
  }
  return { length: 1 };
}

Object.defineProperty(dom.window.Element.prototype, 'getClientRects', {
  configurable: true,
  value(this: any) {
    return visibleClientRects(this);
  },
});

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

// 组件本身与草稿校验（paperDetailsDraft/metadataValidation）走真实实现；
// 仅替换与快捷键无关的展示层与工作台依赖，避免测试绑定 UI 细节。
const fixtures: Record<string, string> = {
  uiLanguage: `export const useLocaleText = () => (zh, en) => zh;
    export const useAppLocale = () => 'zh-CN';`,
  useWheelScrollDelegate: `export const useWheelScrollDelegate = () => () => {};`,
  paperHistory: `export const loadPaperHistory = () => null;
    export const PAPER_READING_HEATMAP_UPDATED_EVENT = 'pq-test:heatmap';`,
  clipboard: `export const copyTextToClipboard = async () => true;`,
  bibtex: `export const paperToBibtexEntry = () => '';`,
  bibliography: `export const formatBibliographyEntry = () => '';`,
  literatureUi: `export const paperPdfPath = () => 'C:/fixture/paper.pdf';
    export const paperTranslatedPdfAttachment = () => null;`,
  titleDisplay: `export const resolvePaperTitleDisplay = (paper) => ({ primary: paper.title, secondary: null });`,
  paperTaskProgress: `export const getPaperTaskProgress = () => null;`,
  paperDetailsSections: `export const loadPaperDetailsSections = () => ({ information: false, abstract: false,
      overview: false, keywords: false, notes: false, readingTime: true });
    export const persistPaperDetailsSections = () => {};`,
  paperOverviewPresentation: `export const parsePaperOverviewForDisplay = () => [];`,
  PaperEditForm: `import React from 'react';
    export default function PaperEditForm({ draft, onDraftChange }) {
      return React.createElement('div', null,
        React.createElement('span', { 'data-draft-title': '' }, draft.title),
        React.createElement('button', {
          type: 'button', 'data-change-draft': '',
          onClick: () => onDraftChange({ ...draft, title: '草稿标题' }),
        }, 'change draft'));
    }`,
  PaperDetailsStatusBar: `export default function PaperDetailsStatusBar() { return null; }`,
  MetadataRecognitionDialog: `export default function MetadataRecognitionDialog() { return null; }`,
  usePaperFileLocationMenu: `export const usePaperFileLocationMenu = () => [];`,
  LiteratureReadingTimeChart: `export default function LiteratureReadingTimeChart() { return null; }`,
  TranslatedPdfLanguageDialog: `export default function TranslatedPdfLanguageDialog() { return null; }`,
  dialog: `export const Dialog = ({ open, children }) => (open ? children : null);
    export const ConfirmDialog = () => null;`,
  menu: `export const Menu = () => null;`,
  toast: `export const toast = (input) => {
      globalThis.__detailsToasts = [...(globalThis.__detailsToasts ?? []), input];
    };`,
  'lucide-react': ['BookOpenText', 'Check', 'ChevronDown', 'Copy', 'ExternalLink', 'FileText', 'Languages',
    'MoreHorizontal', 'Pencil', 'Save', 'Star', 'Trash2', 'X']
    .map((name) => `export const ${name} = () => null;`).join('\n'),
};

const detailsBundle = build({
  entryPoints: ['src/features/literature/components/LiteraturePaperDetails.tsx'],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*'],
  define: { 'import.meta.url': JSON.stringify(import.meta.url) },
  loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
  plugins: [{ name: 'literature-details-fixtures', setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => {
      const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
      return fixtures[name] ? { path: name, namespace: 'details-fixture' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'details-fixture' }, (args) => ({
      contents: fixtures[args.path], loader: 'js',
    }));
  } }],
});

const components = (async () => {
  const bundle = await detailsBundle;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports as {
    default: (props: any) => any;
    isDetailsPanelVisible: (root: any) => boolean;
    isEventInsideDetails: (root: any, event: any) => boolean;
  };
})();

function paperFixture() {
  return {
    id: 'paper-1', title: 'Original Title', titleZh: null, year: '2020', publication: 'Journal',
    doi: null, url: null, abstractText: null, itemType: 'journalArticle', keywords: [], importedAt: 1,
    updatedAt: 2, lastReadAt: null, readingProgress: 0, isFavorite: false, userNote: null, aiSummary: null,
    citation: null, source: 'local', sortOrder: 0, authors: [], tags: [], categoryIds: [], attachments: [],
    ragEnabled: true,
  };
}

async function mountDetails() {
  const { default: LiteraturePaperDetails } = await components;
  const saves: any[] = [];
  const paper = paperFixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    selectedPaper: paper,
    titleDisplayMode: 'both',
    saving: false,
    categories: [],
    libraryTags: [],
    citationKeys: [],
    onOpenPaper() {},
    onSavePaper: async (request: any) => { saves.push(request); },
    onRestorePaperSelection() {},
  };
  await act(async () => { root.render(React.createElement(LiteraturePaperDetails, props)); });
  return {
    container, saves, paper,
    draftLabel: () => container.querySelector('[data-draft-title]'),
    async click(element: Element) {
      await act(async () => {
        element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    async press(target: EventTarget, key: string, ctrlKey = false) {
      await act(async () => {
        target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

const editButton = (container: Element) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === '编辑');

async function startEditing(view: Awaited<ReturnType<typeof mountDetails>>) {
  const button = editButton(view.container);
  assert.ok(button, '详情面板应提供编辑按钮');
  await view.click(button);
  assert.ok(view.draftLabel(), '编辑按钮应打开草稿表单');
}

test('visible and focused details panel handles Ctrl+S and Escape', async (t) => {
  const view = await mountDetails();
  t.after(() => view.unmount());
  await startEditing(view);

  await view.click(view.container.querySelector('[data-change-draft]')!);
  assert.equal(view.draftLabel()!.textContent, '草稿标题');
  await view.press(view.draftLabel()!, 's', true);
  assert.equal(view.saves.length, 1, '面板内的 Ctrl+S 应保存草稿');
  assert.equal(view.saves[0].paperId, view.paper.id);
  assert.equal(view.saves[0].title, '草稿标题');
  assert.equal(view.draftLabel(), null, '保存成功后应退出编辑态');

  await startEditing(view);
  await view.click(view.container.querySelector('[data-change-draft]')!);
  assert.equal(view.draftLabel()!.textContent, '草稿标题');
  await view.press(view.draftLabel()!, 'Escape');
  assert.equal(view.draftLabel(), null, '面板内的 Esc 应关闭编辑态');
  await startEditing(view);
  assert.equal(view.draftLabel()!.textContent, 'Original Title', 'Esc 应丢弃未保存的草稿');
});

test('hidden library workspace ignores Ctrl+S and Escape without touching the draft', async (t) => {
  const view = await mountDetails();
  t.after(() => view.unmount());
  await startEditing(view);
  await view.click(view.container.querySelector('[data-change-draft]')!);
  assert.equal(view.draftLabel()!.textContent, '草稿标题');

  // 模拟 App.tsx：切到 Notes/Graph 时文献库工作区以 hidden 保持挂载。
  view.container.hidden = true;
  await view.press(view.draftLabel()!, 's', true);
  await view.press(view.draftLabel()!, 'Escape');
  assert.deepEqual(view.saves, [], '隐藏的面板不得保存草稿');
  assert.equal(view.draftLabel()?.textContent, '草稿标题', '隐藏的面板不得丢弃或改写草稿');

  view.container.hidden = false;
  await view.press(view.draftLabel()!, 's', true);
  assert.equal(view.saves.length, 1, '面板重新可见后快捷键应恢复');
});

test('visible details panel ignores shortcuts whose focus is outside it', async (t) => {
  const view = await mountDetails();
  t.after(() => view.unmount());
  await startEditing(view);
  await view.click(view.container.querySelector('[data-change-draft]')!);

  const outside = document.createElement('button');
  document.body.append(outside);
  t.after(() => outside.remove());
  await view.press(outside, 's', true);
  await view.press(outside, 'Escape');
  assert.deepEqual(view.saves, [], '焦点在面板外时不得保存草稿');
  assert.equal(view.draftLabel()?.textContent, '草稿标题', '焦点在面板外时不得丢弃草稿');

  await view.press(document.body, 's', true);
  await view.press(document.body, 'Escape');
  assert.deepEqual(view.saves, []);
  assert.equal(view.draftLabel()?.textContent, '草稿标题');

  await view.press(view.draftLabel()!, 'Escape');
  assert.equal(view.draftLabel(), null, '面板内焦点恢复后 Esc 应关闭编辑态');
});

test('details panel helpers treat hidden ancestors and outside targets as inactive', async () => {
  const { isDetailsPanelVisible, isEventInsideDetails } = await components;
  const visible = { getClientRects: () => ({ length: 1 }), offsetParent: {} };
  assert.equal(isDetailsPanelVisible(visible), true);
  assert.equal(isDetailsPanelVisible({ ...visible, hidden: true }), false);
  assert.equal(isDetailsPanelVisible({ ...visible, parentElement: { hidden: true } }), false);
  assert.equal(isDetailsPanelVisible({ ...visible, parentElement: { style: { display: 'none' } } }), false);
  assert.equal(isDetailsPanelVisible({ getClientRects: () => ({ length: 0 }), offsetParent: {} }), false);
  assert.equal(isDetailsPanelVisible({ offsetParent: {} }), true);
  assert.equal(isDetailsPanelVisible({ offsetParent: null }), false);
  assert.equal(isDetailsPanelVisible(null), false);

  const inside = { name: 'inside' };
  const outside = { name: 'outside' };
  const root = { contains: (node: unknown) => node === inside };
  assert.equal(isEventInsideDetails(root, { target: inside }), true);
  assert.equal(isEventInsideDetails(root, { target: outside }), false);
  assert.equal(isEventInsideDetails(root, { target: root }), true);
  assert.equal(isEventInsideDetails(root, {}), false);
  assert.equal(isEventInsideDetails(root, { target: outside, composedPath: () => [outside, root] }), true);
  assert.equal(isEventInsideDetails(root, { target: inside, composedPath: () => [] }), true);
  assert.equal(isEventInsideDetails(null, { target: inside }), false);
});
