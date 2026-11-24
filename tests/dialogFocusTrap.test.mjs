import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

/**
 * D7-6：Dialog 的焦点陷阱必须跳过 `tabindex="-1"` 元素（命令面板 option），
 * 否则 Tab 会停在不可达的边界上。用 jsdom + 真实 Dialog 渲染验证。
 */

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 不执行布局，offsetParent 恒为 null；Dialog 用它过滤不可见元素。
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get() {
    return this.parentElement ?? dom.window.document.body;
  },
});

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const bundle = await build({
  entryPoints: ['src/ui/dialog.tsx'],
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
const { Dialog } = compiled.exports;

async function waitFor(condition, label, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail(`Timed out waiting for ${label}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

function pressTab(shiftKey = false) {
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
  }));
}

test('the dialog focus trap skips tabindex=-1 elements and wraps in both directions', async () => {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let closed = 0;

  try {
    await act(async () => root.render(React.createElement(
      Dialog,
      { open: true, onClose: () => { closed += 1; }, labelledBy: 'title' },
      React.createElement('div', null,
        React.createElement('h2', { id: 'title' }, 'Focus trap'),
        React.createElement('button', { id: 'first', type: 'button' }, 'First'),
        React.createElement('button', { id: 'last', type: 'button' }, 'Last'),
        // 放在最后：若选择器未排除 tabindex=-1，Last/First 的循环边界会变成它。
        React.createElement('div', { id: 'option', tabIndex: -1, role: 'option' }, 'Command option'),
      ),
    )));
    await waitFor(
      () => dom.window.document.activeElement?.id === 'first',
      'the dialog to focus its first focusable element',
    );

    const byId = (id) => dom.window.document.getElementById(id);
    assert.equal(dom.window.document.activeElement, byId('first'), 'opening focuses the first focusable element');

    byId('last').focus();
    pressTab(false);
    assert.equal(dom.window.document.activeElement, byId('first'), 'Tab from the last item wraps to the first');

    byId('first').focus();
    pressTab(true);
    assert.equal(dom.window.document.activeElement, byId('last'), 'Shift+Tab from the first item wraps to the last');

    // 选择器本身必须排除 tabindex=-1（jsdom 不执行默认 Tab 导航，无法断言浏览器后续焦点）。
    const dialogSource = readFileSync('src/ui/dialog.tsx', 'utf8');
    assert.match(dialogSource, /button:not\(\[disabled\]\):not\(\[tabindex="-1"\]\)/);
    assert.match(dialogSource, /\[tabindex\]:not\(\[tabindex="-1"\]\)/);
    assert.equal(byId('option').tabIndex, -1);

    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(closed, 1, 'Escape still closes the dialog');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
