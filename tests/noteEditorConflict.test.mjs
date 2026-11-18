import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTableCellElement', 'ShadowRoot', 'MutationObserver', 'DOMParser', 'CustomEvent', 'Event', 'MouseEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const bundle = await build({
  entryPoints: ['src/features/notes/NoteEditor.tsx'],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  define: { 'import.meta.url': '"http://localhost/test.js"' },
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { NoteEditor } = module.exports;

function note(id, title, updatedAt = 1) {
  return { id, paperId: 'global-notes', type: 'standalone', title, content: 'Body', contentText: 'Body',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
    contentHtml: '<p>Body</p>', aiChatMessageIds: [], anchors: [], tags: [], color: '#fef3c7',
    createdAt: 1, updatedAt, linkedPaperIds: [], linkedNoteIds: [], linkedNoteTitles: [], wordCount: 1 };
}

async function setTitle(container, title) {
  const input = container.querySelector('input');
  assert.ok(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, title);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function click(container, text) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.includes(text));
  assert.ok(button, `Missing button: ${text}`);
  await act(async () => button.click());
}

test('external changes preserve the draft and require confirmation before refresh or overwrite', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const original = note('conflict', 'Original');
  let updates = 0;
  const onUpdate = async () => { updates += 1; };
  let confirm = false;
  window.confirm = () => confirm;
  const render = async (current) => act(async () => root.render(React.createElement(NoteEditor, { note: current, saving: false, onUpdate, editorSourceId: 'conflict-test' })));
  try {
    await render(original);
    await setTitle(container, 'Local draft');
    await render(note('conflict', 'External', 2));
    assert.equal(container.querySelector('input').value, 'Local draft');
    await click(container, '刷新');
    assert.equal(container.querySelector('input').value, 'Local draft');
    await click(container, '保存');
    assert.equal(updates, 0);
    confirm = true;
    await click(container, '刷新');
    assert.equal(container.querySelector('input').value, 'External');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('a late save does not replace the title of a newly selected note', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let finish;
  const onUpdate = () => new Promise((resolve) => { finish = resolve; });
  const render = async (current) => act(async () => root.render(React.createElement(NoteEditor, { note: current, saving: false, onUpdate, editorSourceId: 'switch-test' })));
  try {
    await render(note('first', 'First'));
    await setTitle(container, 'First draft');
    await click(container, '保存');
    assert.equal(typeof finish, 'function');
    await render(note('second', 'Second'));
    await act(async () => finish(note('first', 'First draft', 2)));
    assert.equal(container.querySelector('input').value, 'Second');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('edits made while a save is pending remain dirty after it completes', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let finish;
  const patches = [];
  const onUpdate = (_id, patch) => {
    patches.push(patch);
    return new Promise((resolve) => { finish = resolve; });
  };
  try {
    await act(async () => root.render(React.createElement(NoteEditor, { note: note('pending', 'Original'), saving: false, onUpdate, editorSourceId: 'pending-test' })));
    await setTitle(container, 'First edit');
    await click(container, '保存');
    await setTitle(container, 'Second edit');
    await act(async () => finish(note('pending', 'First edit', 2)));
    assert.equal(container.querySelector('input').value, 'Second edit');
    await click(container, '保存');
    assert.equal(patches.length, 2);
    assert.equal(patches[1].title, 'Second edit');
    await act(async () => finish(note('pending', 'Second edit', 3)));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('failed or unconfirmed saves keep the draft dirty and retryable', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let calls = 0;
  const onUpdate = async () => {
    calls += 1;
    if (calls === 1) return undefined;
    if (calls === 2) throw new Error('save failed');
    return note('failed', 'Draft', 2);
  };
  try {
    await act(async () => root.render(React.createElement(NoteEditor, { note: note('failed', 'Original'), saving: false, onUpdate, editorSourceId: 'failed-test' })));
    await setTitle(container, 'Draft');
    await click(container, '保存');
    assert.equal(container.querySelector('input').value, 'Draft');
    await click(container, '保存');
    assert.equal(container.querySelector('input').value, 'Draft');
    await click(container, '保存');
    assert.equal(calls, 3);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('restored drafts retain anchor metadata removed by an external version', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const anchor = { id: 'anchor-1', paperId: 'paper-1', label: 'P3', sourceTitle: 'Paper', excerpt: 'Evidence', source: 'pdf', pageIndex: 2, pdfLocation: { pageNumber: 3 }, createdAt: 1 };
  const original = note('anchored', 'Original');
  original.anchors = [anchor];
  original.contentJson.content.push({ type: 'noteAnchorBlock', attrs: { anchorId: anchor.id, label: 'P3', sourceLabel: '摘录', sourceTitle: 'Paper', excerpt: 'Evidence', aiEnhanced: false } });
  let savedPatch;
  const onUpdate = async (_id, patch) => { savedPatch = patch; };
  const render = async (current) => act(async () => root.render(React.createElement(NoteEditor, { note: current, saving: false, onUpdate, editorSourceId: 'anchor-test' })));
  window.confirm = () => true;
  try {
    await render(original);
    await setTitle(container, 'Local draft');
    await render(note('other', 'Other'));
    await render(note('anchored', 'External', 2));
    assert.equal(container.querySelector('input').value, 'Local draft');
    await click(container, '保存');
    assert.deepEqual(savedPatch.anchors, [anchor]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
