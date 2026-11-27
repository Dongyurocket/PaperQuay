import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// 验证重解析覆盖层：BlockViewer 与翻译共享同一份状态，且保存后即使组件尚未
// 重渲染，同步读取也能拿到新文本（自动重译依赖这一点）。
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

for (const name of [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'CustomEvent',
  'getComputedStyle',
  'localStorage',
]) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
    writable: true,
  });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

const harnessBundle = build({
  stdin: {
    contents: `
      import React from 'react';
      import { useBlockReparseOverrides } from './src/features/blocks/useBlockReparseOverrides.ts';
      export function Harness({ blocks, mineruPath, pdfSource }) {
        const api = useBlockReparseOverrides({ blocks, mineruPath, pdfSource });
        globalThis.__reparseApi = api;
        return null;
      }
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
  write: false,
  logLevel: 'silent',
});

async function loadHarness() {
  const bundle = await harnessBundle;
  const source = bundle.outputFiles[0].text;
  const module = { exports: {} as Record<string, unknown> };
  const evaluator = new Function('module', 'exports', 'require', source);
  evaluator(module, module.exports, require);
  return module.exports as { Harness: (props: Record<string, unknown>) => unknown };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('timed out waiting for reparse override state');
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const blocks = [
  {
    blockId: 'page-1-block-1',
    pageIndex: 0,
    blockIndex: 0,
    type: 'text' as const,
    content: 'Original OCR text',
  },
];
const pdfSource = { kind: 'local-path' as const, path: 'C:/papers/paper.pdf' };

interface ReparseApi {
  overrides: Record<string, string>;
  storageReady: boolean;
  storageError: string;
  getOverrideMarkdown: (blockId: string) => string | undefined;
  saveOverride: (blockId: string, markdown: string | null) => void;
}

function currentApi(): ReparseApi {
  const api = (globalThis as unknown as { __reparseApi?: ReparseApi }).__reparseApi;
  assert.ok(api, 'harness did not publish the reparse API');
  return api;
}

test('block reparse overrides persist per parse revision and read synchronously right after save', async () => {
  window.localStorage.clear();
  const { Harness } = await loadHarness();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(Harness, { blocks, mineruPath: 'C:/papers/paper.json', pdfSource }));
  });
  await waitFor(() => currentApi().storageReady);

  assert.deepEqual(currentApi().overrides, {});
  assert.equal(currentApi().getOverrideMarkdown('page-1-block-1'), undefined);

  await act(async () => {
    currentApi().saveOverride('page-1-block-1', '**Repaired** text');
  });

  // 同一事件内的同步读取必须拿到新值，自动重译才不会用回旧文本。
  assert.equal(currentApi().getOverrideMarkdown('page-1-block-1'), '**Repaired** text');
  assert.deepEqual(currentApi().overrides, { 'page-1-block-1': '**Repaired** text' });

  await act(async () => {
    root.unmount();
  });

  // 重新挂载（等价于重新打开阅读页）时从 localStorage 恢复同一份修复。
  const secondContainer = document.createElement('div');
  document.body.appendChild(secondContainer);
  const secondRoot = createRoot(secondContainer);

  await act(async () => {
    secondRoot.render(React.createElement(Harness, { blocks, mineruPath: 'C:/papers/paper.json', pdfSource }));
  });
  await waitFor(() => currentApi().storageReady);

  assert.deepEqual(currentApi().overrides, { 'page-1-block-1': '**Repaired** text' });

  await act(async () => {
    currentApi().saveOverride('page-1-block-1', null);
  });

  assert.equal(currentApi().getOverrideMarkdown('page-1-block-1'), undefined);
  assert.deepEqual(currentApi().overrides, {});

  await act(async () => {
    secondRoot.unmount();
  });
  container.remove();
  secondContainer.remove();
});
