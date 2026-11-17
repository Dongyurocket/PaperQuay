import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { PaperSummary } from '../src/types/reader.ts';
import {
  parseSummarySections,
  resolveSummaryPanelState,
} from '../src/features/reader/overview/summarySections.ts';

function summary(overrides: Partial<PaperSummary> = {}): PaperSummary {
  return {
    title: 'A translated paper title', abstract: '', overview: '', background: '', researchProblem: '',
    approach: '', experimentSetup: '', keyFindings: [], conclusions: '', limitations: '',
    takeaways: [], keywords: [], ...overrides,
  };
}

test('structured summaries keep the eight sections in reading order and render findings as list items', () => {
  const input = summary({ overview: 'Scope', background: 'Context', researchProblem: 'Question',
    approach: 'Method body', experimentSetup: 'Setup', keyFindings: ['First **result**', 'Second $x$'],
    conclusions: 'Final conclusion.', limitations: 'Limit' });
  const before = structuredClone(input);
  const sections = parseSummarySections(input);
  assert.deepEqual(sections.map((section) => section.key),
    ['overview', 'background', 'problem', 'approach', 'experiment', 'findings', 'conclusion', 'limitations']);
  assert.deepEqual(sections[5].items, ['First **result**', 'Second $x$']);
  assert.equal(sections[5].content, '- First **result**\n- Second $x$');
  assert.deepEqual(input, before, 'parsing does not mutate the cached object');
});

test('missing, whitespace-only, and label-only sections never create empty tabs', () => {
  assert.deepEqual(parseSummarySections(summary({ overview: ' \n', background: '## Background',
    researchProblem: '问题：', approach: 'Method body', keyFindings: ['', '  ', '-  '] })),
  [{ key: 'approach', content: 'Method body' }]);
  for (const empty of [null, undefined, '', ' \r\n', summary(), '## Overview\n\n## Findings']) {
    assert.deepEqual(parseSummarySections(empty), []);
  }
});

test('plain Markdown without headings is retained as one overview section', () => {
  const text = 'A paragraph with **emphasis** and $x+y$.\n\nA second paragraph.';
  assert.deepEqual(parseSummarySections(text), [{ key: 'overview', content: text }]);
});

test('complete English Markdown recognizes case-insensitive headings and removes only section labels', () => {
  const sections = parseSummarySections('## OVERVIEW\nScope\n## Background\nContext\n## Research Problem\nQuestion\n' +
    '## Approach\nMethod body\n### Ablation details\nKeep this subheading.\n## Experimental Setup\nSetup\n' +
    '## Key Findings\n1. Result A\n2. Result B\n## Conclusions\nFinal conclusion.\n## Limitations\nLimit');
  assert.equal(sections.length, 8);
  assert.equal(sections[3].content, 'Method body\n### Ablation details\nKeep this subheading.');
  assert.deepEqual(sections[5].items, ['Result A', 'Result B']);
});

test('Chinese and bilingual headings support numbered, bold, inline, and setext forms', () => {
  const sections = parseSummarySections('概览\n====\n范围\n## 一、研究背景 / Background\n背景正文\n' +
    '**研究问题：** 问题正文\n## 4. 方法（Approach）\n方法正文\n实验设置\n----\n实验正文\n' +
    '**关键发现**\n- 发现一\n- 发现二\n结论：结论正文\n局限性 (Limitations)\n局限正文');
  assert.deepEqual(sections.map((section) => section.key),
    ['overview', 'background', 'problem', 'approach', 'experiment', 'findings', 'conclusion', 'limitations']);
  assert.equal(sections[2].content, '问题正文');
  assert.deepEqual(sections[5].items, ['发现一', '发现二']);
  assert.equal(sections[6].content, '结论正文');
});

test('bold inline content is preserved when the label delimiter closes before its colon', () => {
  assert.deepEqual(parseSummarySections('**Overview**: **Important** content'),
    [{ key: 'overview', content: '**Important** content' }]);
});

test('partial Markdown keeps its unheaded preface and merges repeated populated sections', () => {
  assert.deepEqual(parseSummarySections('Unheaded preface.\r\n## Methods\r\nFirst method.\r\n## Approach\r\nSecond method.\r\n## Limitations\r\n'),
    [{ key: 'overview', content: 'Unheaded preface.' }, { key: 'approach', content: 'First method.\n\nSecond method.' }]);
});

test('unknown headings and heading-like text inside fenced or indented code remain content', () => {
  const content = '## Custom section\nKeep it.\n```md\n## Findings\n- code example\n```\n' +
    '~~~text\nBackground: code\n~~~\n    ## Limitations';
  assert.deepEqual(parseSummarySections(content), [{ key: 'overview', content }]);
});

test('legacy Markdown in overview is split while explicit structured sections take precedence', () => {
  const sections = parseSummarySections(summary({ overview: '## Background\nOld context\n## Methods\nFallback method\n' +
    '## Findings\n- Old finding', background: '## Background\nNew context', keyFindings: ['New finding'] }));
  assert.deepEqual(sections, [{ key: 'background', content: 'New context' },
    { key: 'approach', content: 'Fallback method' },
    { key: 'findings', content: '- New finding', items: ['New finding'] }]);
});

test('an abstract-only historical cache remains readable as overview', () => {
  assert.deepEqual(parseSummarySections(summary({ abstract: 'Saved abstract', overview: '  ' })),
    [{ key: 'overview', content: 'Saved abstract' }]);
  assert.deepEqual(parseSummarySections(summary({ abstract: 'Saved abstract', overview: '## Overview\n\n## Methods\nMethod body' })),
    [{ key: 'overview', content: 'Saved abstract' }, { key: 'approach', content: 'Method body' }]);
});

test('findings preserve continuation paragraphs, nested Markdown, and separate top-level results', () => {
  const sections = parseSummarySections('## Findings\n- Result **A**\n  with continuation\n  - Supporting detail\n\n- Result B');
  assert.deepEqual(sections[0].items, ['Result **A**\nwith continuation\n- Supporting detail', 'Result B']);
  assert.deepEqual(parseSummarySections('## Findings\nFirst paragraph.\n\nSecond paragraph.')[0].items,
    ['First paragraph.', 'Second paragraph.']);
});

test('structured findings drop empty entries and avoid repeated bullet or number markers', () => {
  const result = parseSummarySections(summary({ keyFindings: ['- First', '2. Second', '', '   ', '• Third'] }));
  assert.deepEqual(result[0].items, ['First', 'Second', 'Third']);
});

test('findings never split code examples into extra findings and discard empty list markers', () => {
  const input = '## Findings\n- Result A\n\n  ```md\n  - example\n  ## Background\n  ```\n\n- Result B';
  const findings = parseSummarySections(input)[0];
  assert.equal(findings.items?.length, 2);
  assert.equal(findings.items?.[0], 'Result A\n\n```md\n- example\n## Background\n```');
  assert.deepEqual(parseSummarySections('## Findings\n- \n- \n'), []);
  const item = 'Finding with code:\n```md\n- example\n```';
  assert.deepEqual(parseSummarySections(summary({ keyFindings: [item] }))[0].items, [item]);
});

test('cached content always takes precedence over model/source availability and refresh loading', () => {
  for (const aiConfigured of [false, true]) {
    for (const hasBlocks of [false, true]) {
      for (const loading of [false, true]) {
        assert.deepEqual(resolveSummaryPanelState({ hasContent: true, aiConfigured, hasBlocks, loading }),
          { status: 'content', canGenerate: aiConfigured && hasBlocks && !loading });
      }
    }
  }
});

test('empty states distinguish configured, unconfigured, unavailable source, and generating', () => {
  const base = { hasContent: false, loading: false, hasBlocks: true, aiConfigured: true };
  assert.deepEqual(resolveSummaryPanelState(base), { status: 'ready', canGenerate: true });
  assert.deepEqual(resolveSummaryPanelState({ ...base, aiConfigured: false }), { status: 'unconfigured', canGenerate: false });
  assert.deepEqual(resolveSummaryPanelState({ ...base, hasBlocks: false }), { status: 'missing-source', canGenerate: false });
  assert.deepEqual(resolveSummaryPanelState({ ...base, loading: true }), { status: 'loading', canGenerate: false });
  assert.deepEqual(resolveSummaryPanelState({ ...base, aiConfigured: false, hasBlocks: false }),
    { status: 'unconfigured', canGenerate: false });
});

const require = createRequire(import.meta.url);
const components = (async () => {
  const result = await build({ stdin: {
    contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {SummaryPanel} from './src/features/reader/assistantSidebarPrimitives.tsx';
      import {AppLocaleProvider} from './src/i18n/uiLanguage.tsx';
      import {ConfirmHost} from './src/ui/confirmHost.tsx';
      export const render = (props, locale = 'en-US') => renderToStaticMarkup(
        React.createElement(AppLocaleProvider, {value: locale}, React.createElement(SummaryPanel, props)));
      // Drive the actual component handlers without a DOM. SSR above separately exercises rendering.
      function hookHarness(Component, initialProps) {
        const slots = []; let cursor = 0; let props = initialProps;
        let disposed = false; let lateUpdates = 0; let effects = [];
        const changed = (before, after) => !before || !after || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
        const memo = (fn, dependencies) => {
          const index = cursor++;
          if (!slots[index] || changed(slots[index].dependencies, dependencies)) {
            slots[index] = {dependencies, value: fn()};
          }
          return slots[index].value;
        };
        const dispatcher = {
          useContext: (context) => context._currentValue,
          useCallback: (fn, dependencies) => memo(() => fn, dependencies), useMemo: memo, useId: () => ':summary-test:',
          useEffect(setup, dependencies) {
            const index = cursor++; const previous = slots[index];
            if (!previous || changed(previous.dependencies, dependencies)) {
              effects.push(() => {
                previous?.cleanup?.();
                slots[index] = {kind: 'effect', dependencies, cleanup: setup()};
              });
            }
          },
          useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], (value) => {
              if (disposed) { lateUpdates += 1; return; }
              slots[index] = typeof value === 'function' ? value(slots[index]) : value;
            }];
          },
          useRef(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = {current: initial};
            return slots[index];
          },
        };
        return { render(nextProps = props) {
          if (disposed) throw new Error('Cannot render an unmounted panel');
          props = nextProps; cursor = 0;
          const current = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
          const previous = current.current; current.current = dispatcher;
          let tree;
          try { tree = Component(props); } finally { current.current = previous; }
          const committed = effects; effects = []; committed.forEach((effect) => effect());
          return tree;
        }, unmount() {
          disposed = true;
          slots.forEach((slot) => { if (slot?.kind === 'effect') slot.cleanup?.(); });
        }, stateUpdatesAfterUnmount: () => lateUpdates };
      }
      export const createPanel = (props) => hookHarness(SummaryPanel, props);
      export const confirmation = () => {
        const host = hookHarness(ConfirmHost, {}); const tree = host.render(); host.unmount(); return tree;
      };`,
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty' },
  write: false, logLevel: 'silent' });
  const module = { exports: {} as {
    render: (props: object, locale?: string) => string;
    createPanel: (props: object) => { render: (props?: object) => any; unmount: () => void; stateUpdatesAfterUnmount: () => number };
    confirmation: () => any;
  } };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
})();

const panelProps = { paperSummary: summary({ overview: 'Cached overview body', keywords: ['keyword', ' '], keyFindings: ['Result'] }),
  loading: false, error: '', hasBlocks: true, aiConfigured: true, onGenerateSummary() {} };

test('actual shared panel supports normal and compact rendering with localized labels and no repeated decoration', async () => {
  const { render } = await components;
  for (const compact of [false, true]) {
    for (const locale of ['en-US', 'zh-CN']) {
      const html = render({ ...panelProps, compact }, locale);
      assert.ok(html.includes('Cached overview body'));
      assert.ok(html.includes('data-tour="generate-summary"'));
      assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
      assert.ok(!html.includes('Overview Ready') && !html.includes('概览已生成'));
      assert.ok(!html.includes('Generate a structured overview') && !html.includes('uppercase'));
      if (locale === 'en-US') {
        assert.ok(html.includes(compact ? 'Paper Overview' : 'AI Overview'));
        assert.ok(html.includes('1 keywords') && html.includes('1 findings'));
        assert.ok(html.includes('aria-label="Regenerate"'));
      } else {
        assert.ok(html.includes(compact ? '论文概览' : 'AI 概览'));
        assert.ok(html.includes('1 个关键词') && html.includes('1 条发现'));
        assert.ok(html.includes('aria-label="重新生成"'));
      }
    }
  }
});

test('actual compact panel keeps cached content and errors visible while unconfigured or refreshing', async () => {
  const { render } = await components;
  const html = render({ ...panelProps, compact: true, aiConfigured: false, loading: true,
    error: 'Refresh failed', onOpenSettings() {} });
  for (const content of ['Cached overview body', 'Refresh failed', 'Saved content is available.', 'Model Settings', 'Generating…']) {
    assert.ok(html.includes(content), content);
  }
  assert.match(html, /<button[^>]*data-tour="generate-summary"[^>]*disabled=""/);
});

test('actual empty panel shows model status, settings, and a disabled generation action without configuration', async () => {
  const { render } = await components;
  const props = { ...panelProps, paperSummary: null, onOpenSettings() {} };
  const unconfigured = render({ ...props, aiConfigured: false });
  assert.ok(unconfigured.includes('Overview model not configured') && unconfigured.includes('Model Settings'));
  assert.match(unconfigured, /<button[^>]*data-tour="generate-summary"[^>]*disabled=""/);
  const configured = render(props);
  assert.ok(configured.includes('Overview model configured'));
  assert.doesNotMatch(configured, /data-tour="generate-summary"[^>]*disabled=""/);
  const missingSource = render({ ...props, hasBlocks: false });
  assert.ok(missingSource.includes('Load the document content'));
  assert.match(missingSource, /data-tour="generate-summary"[^>]*disabled=""/);
});

test('actual findings-only summary renders a semantic list and selects the first populated tab', async () => {
  const { render } = await components;
  const html = render({ ...panelProps, paperSummary: summary({ keyFindings: ['First **result**', 'Second result'] }) });
  assert.match(html, /role="tab" aria-selected="true"[^>]*>Findings<\/button>/);
  assert.ok(html.includes('<ul') && html.includes('<li>') && html.includes('<strong'));
  assert.ok(!html.includes('No content yet'));
});

function elements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...elements(tree.props?.children, predicate)];
}

function generateButton(tree: any) {
  return elements(tree, (element) => element.type === 'button' && element.props['data-tour'] === 'generate-summary')[0];
}

const flushAction = () => new Promise<void>((resolve) => setImmediate(resolve));

test('actual generation handler uses no force for an empty summary and guards unavailable configuration or source', async () => {
  const { createPanel, confirmation } = await components;
  const calls: unknown[] = [];
  const props = { ...panelProps, paperSummary: null, onGenerateSummary: (options?: object) => { calls.push(options); } };
  generateButton(createPanel(props).render()).props.onClick();
  await flushAction();
  assert.deepEqual(calls, [undefined]);
  assert.equal(confirmation(), null);
  for (const availability of [{ aiConfigured: false }, { hasBlocks: false }, { loading: true }]) {
    const tree = createPanel({ ...props, ...availability }).render();
    const button = generateButton(tree);
    assert.equal(button.props.disabled, true);
    button.props.onClick(); // Even a programmatic invocation must respect the guard.
    await flushAction();
  }
  assert.deepEqual(calls, [undefined]);
});

test('actual regeneration uses the existing confirm host, prevents duplicate prompts, and forces only after approval', async () => {
  const { createPanel, confirmation } = await components;
  const calls: unknown[] = [];
  const panel = createPanel({ ...panelProps, onGenerateSummary: (options?: object) => { calls.push(options); } });
  const button = generateButton(panel.render());
  button.props.onClick();
  button.props.onClick();
  assert.equal(calls.length, 0);
  const cancelDialog = confirmation();
  assert.ok(cancelDialog.props.description.includes('消耗额度'));
  assert.equal(generateButton(panel.render()).props['aria-disabled'], true);
  assert.equal(generateButton(panel.render()).props.disabled, false); // Preserve the trigger for Dialog focus restoration.
  cancelDialog.props.onClose();
  await flushAction();
  assert.equal(calls.length, 0);
  assert.equal(confirmation(), null);
  generateButton(panel.render()).props.onClick();
  confirmation().props.onConfirm();
  await flushAction();
  assert.deepEqual(calls, [{ force: true }]);
});

test('pending regeneration cannot apply to a changed summary or newly unavailable source/model', async () => {
  const { createPanel, confirmation } = await components;
  for (const changed of [{ paperSummary: summary({ overview: 'Another document' }) }, { aiConfigured: false }, { hasBlocks: false }, { loading: true }]) {
    const calls: unknown[] = [];
    const props = { ...panelProps, onGenerateSummary: (options?: object) => { calls.push(options); } };
    const panel = createPanel(props);
    generateButton(panel.render()).props.onClick();
    panel.render({ ...props, ...changed });
    confirmation().props.onConfirm();
    await flushAction();
    assert.equal(calls.length, 0);
  }
});

test('unmounting a panel cancels its confirmation even when the next document shares the same summary object', async () => {
  const { createPanel, confirmation } = await components;
  const calls: string[] = [];
  const oldPanel = createPanel({ ...panelProps, onGenerateSummary: () => { calls.push('old document'); } });
  const oldButton = generateButton(oldPanel.render());
  oldButton.props.onClick();
  oldPanel.unmount();
  const nextPanel = createPanel({ ...panelProps, onGenerateSummary: () => { calls.push('new document'); } });
  nextPanel.render(); // Mirrors the parent's document-key remount with the same cached object.
  confirmation().props.onConfirm();
  await flushAction();
  oldButton.props.onClick();
  await flushAction();
  assert.deepEqual(calls, []);
  assert.equal(confirmation(), null);
  assert.equal(oldPanel.stateUpdatesAfterUnmount(), 0);
  generateButton(nextPanel.render()).props.onClick();
  confirmation().props.onConfirm();
  await flushAction();
  assert.deepEqual(calls, ['new document']);
  nextPanel.unmount();
});

test('a task, model, source, or summary change permanently invalidates an open confirmation even after restoration', async () => {
  const { createPanel, confirmation } = await components;
  for (const changed of [{ loading: true }, { aiConfigured: false }, { hasBlocks: false }, { paperSummary: summary({ overview: 'Replacement' }) }]) {
    const calls: unknown[] = [];
    const props = { ...panelProps, onGenerateSummary: (options?: object) => { calls.push(options); } };
    const panel = createPanel(props);
    generateButton(panel.render()).props.onClick();
    panel.render({ ...props, ...changed });
    panel.render(props);
    confirmation().props.onConfirm();
    await flushAction();
    assert.deepEqual(calls, [], JSON.stringify(changed));
    panel.unmount();
  }
});

test('confirmation uses the latest callback when document and eligibility remain unchanged', async () => {
  const { createPanel, confirmation } = await components;
  const calls: unknown[] = [];
  const props = { ...panelProps, onGenerateSummary: () => { calls.push('stale'); } };
  const panel = createPanel(props);
  generateButton(panel.render()).props.onClick();
  panel.render({ ...props, onGenerateSummary: (options?: object) => { calls.push(options); } });
  confirmation().props.onConfirm();
  await flushAction();
  assert.deepEqual(calls, [{ force: true }]);
  panel.unmount();
});

test('generation remains locked until its callback settles and surfaces a rejection before allowing retry', async () => {
  const { createPanel, confirmation } = await components;
  let reject!: (error: Error) => void;
  let calls = 0;
  const panel = createPanel({ ...panelProps, onGenerateSummary: () => {
    calls += 1;
    return new Promise<void>((_resolve, fail) => { reject = fail; });
  } });
  const button = generateButton(panel.render());
  button.props.onClick();
  confirmation().props.onConfirm();
  await flushAction();
  button.props.onClick();
  generateButton(panel.render()).props.onClick();
  assert.equal(calls, 1);
  assert.equal(confirmation(), null);
  assert.equal(generateButton(panel.render()).props['aria-disabled'], true);
  reject(new Error('Model request failed'));
  await flushAction();
  assert.ok(elements(panel.render(), (element) => element.props?.role === 'alert')[0].props.children.includes('Model request failed'));
  generateButton(panel.render()).props.onClick();
  assert.ok(confirmation());
  confirmation().props.onClose();
  await flushAction();
  panel.unmount();
});

test('a callback rejection after unmount neither updates the old panel nor leaks into the next document', async () => {
  const { createPanel, confirmation } = await components;
  let reject!: (error: Error) => void;
  const panel = createPanel({ ...panelProps, paperSummary: null, onGenerateSummary: () => new Promise<void>((_resolve, fail) => { reject = fail; }) });
  generateButton(panel.render()).props.onClick();
  panel.unmount();
  const nextPanel = createPanel(panelProps);
  nextPanel.render();
  reject(new Error('Old document failed'));
  await flushAction();
  assert.equal(panel.stateUpdatesAfterUnmount(), 0);
  assert.deepEqual(elements(nextPanel.render(), (element) => element.props?.role === 'alert'), []);
  assert.equal(confirmation(), null);
  nextPanel.unmount();
});

test('actual tab selection falls back to a populated section on document changes and settings callback stays reachable', async () => {
  const { createPanel } = await components;
  let opened = 0;
  const props = { ...panelProps, aiConfigured: false, onOpenSettings: () => { opened += 1; } };
  const panel = createPanel(props);
  let tree = panel.render();
  elements(tree, (element) => element.type === 'button' && element.props.onClick === props.onOpenSettings)[0].props.onClick();
  assert.equal(opened, 1);
  elements(tree, (element) => element.props?.role === 'tab' && element.props.children === '发现')[0].props.onClick();
  tree = panel.render();
  assert.equal(elements(tree, (element) => element.props?.role === 'tab' && element.props['aria-selected'])[0].props.children, '发现');
  tree = panel.render({ ...props, paperSummary: summary({ approach: 'A populated method' }) });
  assert.equal(elements(tree, (element) => element.props?.role === 'tab' && element.props['aria-selected'])[0].props.children, '方法');
});
