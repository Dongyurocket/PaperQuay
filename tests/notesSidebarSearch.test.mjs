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
  entryPoints: ['src/features/notes/NotesSidebar.tsx'], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
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
const { NotesSidebar } = module.exports;
const notes = [
  { id: 'one', title: 'First', folderId: 'folder', pageKind: 'concept', type: 'standalone', updatedAt: 1, anchors: [], tags: [], content: '', contentText: '' },
  { id: 'two', title: 'Second', folderId: null, pageKind: 'qa', type: 'standalone', updatedAt: 2, anchors: [], tags: [], content: '', contentText: '' },
];
const noop = () => {};

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

test('sidebar scopes searches and discards stale results while displaying fallback status', async () => {
  const calls = [];
  globalThis.__sidebarSearch = (request) => new Promise((resolve) => calls.push({ request, resolve }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(NotesSidebar, {
      notes, activeNoteId: 'one', loading: false, saving: false, error: '', selectedExcerpt: null,
      onAddSelectionToNote: noop, onCreateStandaloneNote: noop, onSelectNote: noop,
      onUpdateNote: noop, onDeleteNote: noop, onJumpToNoteAnchor: noop,
    })));
    await click(container, '摘录');
    await click(container, '笔记 2');
    const input = container.querySelector('input[placeholder="搜索笔记"]');
    assert.ok(input);
    await setInput(input, 'old query');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.deepEqual(calls[0].request.noteIds, ['one', 'two']);
    const select = container.querySelector('select[aria-label="筛选笔记文件夹"]');
    await act(async () => { select.value = 'folder'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await setInput(input, 'new query');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.deepEqual(calls[1].request.noteIds, ['one']);
    assert.equal(calls[1].request.query, 'new query');
    await act(async () => calls[1].resolve({ notes: [{ ...notes[0], channels: ['fts'] }], retrievalMode: 'keyword', warning: 'Embedding unavailable', total: 1 }));
    assert.match(container.textContent, /关键词检索/);
    assert.match(container.textContent, /Embedding unavailable/);
    assert.match(container.textContent, /First/);
    assert.match(container.textContent, /fts/);
    await act(async () => calls[0].resolve({ notes: [{ ...notes[1], channels: ['vector'] }], retrievalMode: 'hybrid', total: 1 }));
    assert.match(container.textContent, /First/);
    assert.doesNotMatch(container.textContent, /Second/);
    assert.match(container.textContent, /关键词检索/);
    await click(container, '问答');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.deepEqual(calls[2].request.noteIds, []);
    await act(async () => calls[2].resolve({ notes: [], retrievalMode: 'keyword', total: 0 }));
    assert.doesNotMatch(container.textContent, /First/);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    delete globalThis.__sidebarSearch;
  }
});
