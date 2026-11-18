import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver', 'DOMParser', 'Event', 'KeyboardEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const bundle = await build({
  entryPoints: ['src/features/reader/assistantSidebarChat.tsx'],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  define: { 'import.meta.url': '"http://localhost/test.js"' },
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { ChatWorkspacePanel } = module.exports;

test('Enter submits the textarea value when the parent draft is stale', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const submitted = [];
  const noop = () => {};
  try {
    await act(async () => root.render(React.createElement(ChatWorkspacePanel, {
      sessions: [], selectedSessionId: '', messages: [], input: 'old draft', loading: false,
      error: '', hasBlocks: true, selectedExcerpt: null, attachments: [], qaModelPresets: [],
      selectedQaPresetId: '', qaRagEnabled: true, qaAnswerRenderMode: 'markdown',
      qaReasoningEffort: 'auto', screenshotLoading: false, onInputChange: noop,
      onSubmit: (value) => submitted.push(value), onQaPresetChange: noop,
      onQaRagEnabledChange: noop, onQaAnswerRenderModeChange: noop,
      onQaReasoningEffortChange: noop, onSessionCreate: noop, onSessionSelect: noop,
      onSessionDelete: noop, onAppendSelectedExcerpt: noop, onSelectImageAttachments: noop,
      onSelectFileAttachments: noop, onCaptureScreenshot: noop, onRemoveAttachment: noop,
    })));
    const textarea = container.querySelector('textarea');
    assert.ok(textarea);
    assert.equal(textarea.value, 'old draft');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'new question');
      textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.deepEqual(submitted, ['new question']);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('chat renders an explicit retrieval warning alongside the answer', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const noop = () => {};
  try {
    await act(async () => root.render(React.createElement(ChatWorkspacePanel, {
      sessions: [], selectedSessionId: '', messages: [{
        id: 'answer', role: 'assistant', content: 'Synthetic answer', createdAt: 1,
        qaContext: { origin: 'local-rag', retrievalState: 'retrieved', retrievedChunkCount: 1,
          ftsStatuses: ['failed'], ftsHitCount: 0, partialSources: true },
      }], input: '', loading: false, error: '', hasBlocks: true, selectedExcerpt: null,
      attachments: [], qaModelPresets: [], selectedQaPresetId: '', qaRagEnabled: true,
      qaAnswerRenderMode: 'markdown', qaReasoningEffort: 'auto', screenshotLoading: false,
      onInputChange: noop, onSubmit: noop, onQaPresetChange: noop, onQaRagEnabledChange: noop,
      onQaAnswerRenderModeChange: noop, onQaReasoningEffortChange: noop,
      onSessionCreate: noop, onSessionSelect: noop, onSessionDelete: noop,
      onAppendSelectedExcerpt: noop, onSelectImageAttachments: noop, onSelectFileAttachments: noop,
      onCaptureScreenshot: noop, onRemoveAttachment: noop,
    })));
    assert.match(container.textContent, /Synthetic answer/);
    assert.match(container.textContent, /关键词检索失败|Keyword retrieval failed/);
    assert.match(container.textContent, /部分来源索引尚未就绪|Some source indexes were not ready/);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
