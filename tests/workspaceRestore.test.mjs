import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const bundle = await build({
  stdin: {
    contents: `export { useWorkspaceRestore } from './src/app/useWorkspaceRestore';
      export { useTabsStore } from './src/stores/useTabsStore';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'], write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { useWorkspaceRestore, useTabsStore } = module.exports;
const initialStore = useTabsStore.getState();
const key = 'paperquay-active-workspace-v1';

function Harness() {
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openAgent = useTabsStore((state) => state.openAgentTab);
  const openNotes = useTabsStore((state) => state.openNotesTab);
  const openGraph = useTabsStore((state) => state.openGraphTab);
  const active = tabs.find((tab) => tab.id === activeTabId);
  const workspace = ['agent', 'notes', 'graph'].includes(active?.type) ? active.type : 'library';
  useWorkspaceRestore(workspace, openAgent, openNotes, openGraph);
  return React.createElement('div', null, workspace);
}

for (const [stored, expected] of [['agent', 'agent'], ['notes', 'notes'], ['graph', 'graph'], ['review', 'library'], ['unknown', 'library']]) {
  test(`restores ${stored} as ${expected} in strict mode`, async () => {
    useTabsStore.setState(initialStore, true);
    window.localStorage.setItem(key, stored);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness))));
      assert.equal(container.textContent, expected);
      assert.equal(window.localStorage.getItem(key), expected);
      await act(async () => useTabsStore.getState().openNotesTab());
      assert.equal(container.textContent, 'notes');
      assert.equal(window.localStorage.getItem(key), 'notes');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}
