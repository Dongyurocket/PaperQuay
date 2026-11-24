import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const bundle = await build({
  stdin: {
    contents: `export { NotesSidebar } from './src/features/notes/NotesSidebar.tsx';
      export { AppLocaleProvider } from './src/i18n/uiLanguage.tsx';`,
    resolveDir: process.cwd(),
    loader: 'ts',
    sourcefile: 'notesSidebarSearchEntry.ts',
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'], write: false, logLevel: 'silent',
  plugins: [{ name: 'sidebar-test-mocks', setup(builder) {
    builder.onResolve({ filter: /^\.\/NoteEditor$/ }, () => ({ path: 'editor', namespace: 'mock' }));
    builder.onResolve({ filter: /^\.\.\/\.\.\/services\/notes$/ }, () => ({ path: 'notes', namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
      contents: args.path === 'editor'
        ? 'export function NoteEditor() { return null; }'
        : `export const listNoteFolders = async () => [{ id: 'folder', name: 'Folder', parentId: null }];
           export const searchNotes = (...args) => globalThis.__sidebarSearch(...args);`,
      loader: 'js',
    }));
  }}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { NotesSidebar, AppLocaleProvider } = module.exports;
const notes = [
  { id: 'one', title: 'First', folderId: 'folder', pageKind: 'concept', type: 'standalone', updatedAt: 1, anchors: [], tags: [], content: '', contentText: '' },
  { id: 'two', title: 'Second', folderId: null, pageKind: 'qa', type: 'standalone', updatedAt: 2, anchors: [], tags: [], content: '', contentText: '' },
];
const noop = () => {};
// 后端 electron/backend/noteHybridSearch.cjs 实际返回的中文 warning。
const BACKEND_EMBEDDING_WARNING = 'Embedding 未在 PaperQuay 中配置，已降级为关键词检索。';
const CJK = /[一-鿿]/;

async function click(container, text) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.includes(text));
  assert.ok(button, `Missing button ${text}`);
  await act(async () => button.click());
}

async function setInput(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function waitFor(condition, label, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail(`Timed out waiting for ${label}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function mountSidebar(locale) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(AppLocaleProvider, { value: locale },
    React.createElement(NotesSidebar, {
      notes, activeNoteId: 'one', loading: false, saving: false, error: '', selectedExcerpt: null,
      onAddSelectionToNote: noop, onCreateStandaloneNote: noop, onSelectNote: noop,
      onUpdateNote: noop, onDeleteNote: noop, onJumpToNoteAnchor: noop,
    }))));
  return {
    container,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('sidebar scopes searches, discards stale results, and localizes backend warnings under en-US', async () => {
  const calls = [];
  globalThis.__sidebarSearch = (request) => new Promise((resolve) => calls.push({ request, resolve }));
  const mounted = await mountSidebar('en-US');
  const { container } = mounted;
  try {
    await click(container, 'Excerpts');
    await click(container, 'Notes 2');
    const input = container.querySelector('input[placeholder="Search notes"]');
    assert.ok(input);
    await setInput(input, 'old query');
    await waitFor(() => calls.length === 1, 'the first debounced search');
    assert.deepEqual(calls[0].request.noteIds, ['one', 'two']);
    const select = container.querySelector('select[aria-label="Filter note folders"]');
    assert.ok(select);
    await waitFor(
      () => [...select.querySelectorAll('option')].some((option) => option.value === 'folder'),
      'the folder options',
    );
    await act(async () => { select.value = 'folder'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await setInput(input, 'new query');
    await waitFor(() => calls.length === 2, 'the second debounced search');
    assert.deepEqual(calls[1].request.noteIds, ['one']);
    assert.equal(calls[1].request.query, 'new query');
    await act(async () => calls[1].resolve({
      notes: [{ ...notes[0], channels: ['fts'] }],
      retrievalMode: 'keyword',
      warning: BACKEND_EMBEDDING_WARNING,
      total: 1,
    }));
    const text = container.textContent;
    // 英文界面不得出现后端中文 warning（本轮模板只拼接固定英文文案）。
    assert.doesNotMatch(text, CJK, `unexpected Chinese text in en-US sidebar: ${text}`);
    assert.doesNotMatch(text, /Embedding 未在 PaperQuay 中配置/);
    assert.match(text, /Embedding is not configured; using keyword search\./);
    assert.match(text, /Keyword search/);
    assert.match(text, /First/);
    assert.match(text, /fts/);
    await act(async () => calls[0].resolve({ notes: [{ ...notes[1], channels: ['vector'] }], retrievalMode: 'hybrid', total: 1 }));
    assert.match(container.textContent, /First/);
    assert.doesNotMatch(container.textContent, /Second/);
    assert.match(container.textContent, /Keyword search/);
    await click(container, 'Q&A');
    await waitFor(() => calls.length === 3, 'the tab-scoped search');
    assert.deepEqual(calls[2].request.noteIds, []);
    await act(async () => calls[2].resolve({ notes: [], retrievalMode: 'keyword', total: 0 }));
    assert.doesNotMatch(container.textContent, /First/);
  } finally {
    await mounted.unmount();
    delete globalThis.__sidebarSearch;
  }
});

test('sidebar shows the localized Chinese degradation notice under zh-CN', async () => {
  const calls = [];
  globalThis.__sidebarSearch = (request) => new Promise((resolve) => calls.push({ request, resolve }));
  const mounted = await mountSidebar('zh-CN');
  const { container } = mounted;
  try {
    await click(container, '摘录');
    await click(container, '笔记 2');
    const input = container.querySelector('input[placeholder="搜索笔记"]');
    assert.ok(input);
    await setInput(input, 'warning');
    await waitFor(() => calls.length === 1, 'the debounced search');
    await act(async () => calls[0].resolve({
      notes: [{ ...notes[0], channels: ['fts'] }],
      retrievalMode: 'keyword',
      warning: BACKEND_EMBEDDING_WARNING,
      total: 1,
    }));
    const text = container.textContent;
    assert.match(text, /Embedding 未配置，已降级为关键词检索。/);
    assert.match(text, /关键词检索/);
    // 固定文案与后端原句不同，确认不是原样拼接。
    assert.doesNotMatch(text, /Embedding 未在 PaperQuay 中配置/);
  } finally {
    await mounted.unmount();
    delete globalThis.__sidebarSearch;
  }
});
