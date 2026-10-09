import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
const markdown = '复查 15~30 天。速度 50~200 cm/s。对照区间 0~25，变化 -0.5~2.25。~~删除~~。';
const block = { blockId: 'page-4-block-6', pageIndex: 3, blockIndex: 5, type: 'paragraph', content: markdown };

const components = (async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
        import {BlockItem} from './src/features/blocks/blockViewerContent.tsx';
        import {BlockReparseModal} from './src/features/blocks/BlockReparseModal.tsx';
        import {MarkdownPreview} from './src/features/reader/assistantSidebarPrimitives.tsx';
        export {BlockReparseModal};
        export const renderTree = (tree) => renderToStaticMarkup(tree);
        export const renderBlock = (props) => renderToStaticMarkup(React.createElement(BlockItem, props));
        export const renderSidebar = (props) => renderToStaticMarkup(React.createElement(MarkdownPreview, props));`,
      resolveDir: process.cwd(), loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
    loader: { '.css': 'empty' }, external: ['react', 'react-dom/server', 'react/jsx-runtime'], logLevel: 'silent',
    plugins: [{ name: 'reader-markdown-fixtures', setup(builder) {
      const fixtures: Record<string, string> = {
        uiLanguage: `export const useLocaleText = () => (zh) => zh;`,
        pdfBlockCrop: `export const usePdfBlockCrop = () => ({dataUrl: '', loading: false, error: ''});
          export const getPdfBlockCropDataUrl = async () => null;`,
        blockReparse: `export const getAvailableReparseModelPresets = async () => [{id: 'text-test', label: 'Text test', supportsVision: false}];
          export const reparseBlockWithAi = async () => ({reparsedText: __reparsedText});`,
      };
      builder.onResolve({ filter: /.*/ }, (args) => {
        const name = args.path.replace(/\.(?:tsx?|jsx?)$/, '').split('/').at(-1)!;
        return fixtures[name] ? { path: name, namespace: 'reader-markdown-fixture' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'reader-markdown-fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'js' }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', '__reparsedText', result.outputFiles[0].text)(require, module, module.exports, markdown);
  return module.exports;
})();

function assertRanges(html: string, deletionCount = 1) {
  for (const range of ['15~30', '50~200', '0~25', '-0.5~2.25']) assert.ok(html.includes(range), `${range} must remain literal`);
  assert.equal((html.match(/<del>删除<\/del>/g) ?? []).length, deletionCount);
  assert.equal((html.match(/<del>/g) ?? []).length, deletionCount, 'Only explicit double-tilde text may be deleted');
}

function blockProps() {
  return {
    renderable: { block, markdown, plainText: markdown, isInteractive: true },
    active: false, hovered: false, flashing: false, scale: 1, showBlockMeta: false, compactMode: false,
    translationDisplayMode: 'original', onClick() {}, registerRef() {},
  };
}

test('actual structured block preserves original numeric ranges, translations and repaired text', async () => {
  const { renderBlock } = await components;
  assertRanges(renderBlock(blockProps()));
  assertRanges(renderBlock({ ...blockProps(), customOverrideMarkdown: markdown }));
  assertRanges(renderBlock({ ...blockProps(), translatedText: markdown, translationDisplayMode: 'translated' }));
  assertRanges(renderBlock({ ...blockProps(), translatedText: markdown, translationDisplayMode: 'bilingual' }), 2);
});

test('actual reader assistant preview preserves ranges with and without math normalization', async () => {
  const { renderSidebar } = await components;
  for (const normalizeMath of [true, false]) assertRanges(renderSidebar({ content: markdown, normalizeMath }));
});

type Hook = { value?: any; setter?: (next: any) => void; deps?: unknown[]; effect?: () => any; pending?: boolean; cleanup?: () => void };

// Drive the modal's real state/effects and its repair button; child Markdown is
// rendered by React, while PDF cropping and the external model stay isolated.
class ModalLifecycle {
  hooks: Hook[] = [];
  cursor = 0;
  tree: any;
  component: (props: any) => any;
  props: any;

  constructor(component: (props: any) => any, props: any) { this.component = component; this.props = props; }
  slot() { return this.hooks[this.cursor++] ?? (this.hooks[this.cursor - 1] = {}); }
  useState = (initial: any) => {
    const hook = this.slot();
    if (!hook.setter) {
      hook.value = typeof initial === 'function' ? initial() : initial;
      hook.setter = (next) => { hook.value = typeof next === 'function' ? next(hook.value) : next; };
    }
    return [hook.value, hook.setter];
  };
  useRef = (initial: any) => { const hook = this.slot(); return hook.value ?? (hook.value = { current: initial }); };
  useMemo = (factory: () => any) => { this.slot(); return factory(); };
  useEffect = (effect: () => any, deps: unknown[]) => {
    const hook = this.slot();
    if (!hook.deps || hook.deps.length !== deps.length || hook.deps.some((value, index) => !Object.is(value, deps[index]))) {
      hook.effect = effect; hook.deps = deps; hook.pending = true;
    }
  };
  render() {
    this.cursor = 0;
    const previous = dispatcher.current;
    dispatcher.current = this;
    try { this.tree = this.component(this.props); }
    finally { dispatcher.current = previous; }
    for (const hook of this.hooks.filter((item) => item.pending)) {
      hook.cleanup?.(); hook.pending = false; hook.cleanup = hook.effect?.();
    }
    return this.tree;
  }
  unmount() { for (const hook of this.hooks) hook.cleanup?.(); }
}

function repairButton(tree: any): any {
  if (Array.isArray(tree)) return tree.map(repairButton).find(Boolean);
  if (!tree || typeof tree !== 'object') return undefined;
  const children = tree.props?.children;
  if (tree.type === 'button' && (children === '开始文本修复' || (Array.isArray(children) && children.includes('开始文本修复')))) return tree;
  return repairButton(tree.props?.children);
}

test('actual block reparse modal keeps numerical ranges in the completed repair preview', async () => {
  const { BlockReparseModal, renderTree } = await components;
  const modal = new ModalLifecycle(BlockReparseModal, { block, initialText: markdown, storageReady: true, onApply() {}, onClose() {} });
  try {
    modal.render();
    await Promise.resolve();
    const button = repairButton(modal.render());
    assert.ok(button, 'The actual text-repair action should be rendered');
    assert.equal(button.props.disabled, false);
    await button.props.onClick();
    const html = renderTree(modal.render());
    assert.ok(html.includes('文本修复结果'));
    assertRanges(html);
  } finally { modal.unmount(); }
});
