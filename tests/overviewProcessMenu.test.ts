import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const components = (async () => {
  const result = await build({ stdin: {
    contents: `import React from 'react';
      import {OverviewProcessMenu} from './src/features/reader/overview/OverviewProcessMenu.tsx';
      import {ConfirmHost} from './src/ui/confirmHost.tsx';
      function hookHarness(Component, initialProps) {
        const slots = []; let cursor = 0, props = initialProps, disposed = false, lateUpdates = 0, effects = [];
        const changed = (before, after) => !before || !after || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
        const memo = (fn, dependencies) => {
          const index = cursor++;
          if (!slots[index] || changed(slots[index].dependencies, dependencies)) slots[index] = {dependencies, value: fn()};
          return slots[index].value;
        };
        const dispatcher = {
          useContext: context => context._currentValue, useMemo: memo, useCallback: (fn, dependencies) => memo(() => fn, dependencies),
          useEffect(setup, dependencies) {
            const index = cursor++, previous = slots[index];
            if (!previous || changed(previous.dependencies, dependencies)) effects.push(() => {
              previous?.cleanup?.(); slots[index] = {kind: 'effect', dependencies, cleanup: setup()};
            });
          },
          useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => {
              if (disposed) { lateUpdates += 1; return; }
              slots[index] = typeof value === 'function' ? value(slots[index]) : value;
            }];
          },
          useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = {current: initial}; return slots[index]; },
        };
        return {render(nextProps = props) {
          if (disposed) throw new Error('Cannot render an unmounted menu');
          props = nextProps; cursor = 0;
          const current = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
          const previous = current.current; current.current = dispatcher;
          let tree; try { tree = Component(props); } finally { current.current = previous; }
          const committed = effects; effects = []; committed.forEach(effect => effect()); return tree;
        }, unmount() { disposed = true; slots.forEach(slot => { if (slot?.kind === 'effect') slot.cleanup?.(); }); }, stateUpdatesAfterUnmount: () => lateUpdates};
      }
      export const createMenu = props => hookHarness(OverviewProcessMenu, props);
      export const confirmation = () => { const host = hookHarness(ConfirmHost, {}); const tree = host.render(); host.unmount(); return tree; };`,
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent',
  plugins: [{ name: 'capture-error-feedback', setup(build) {
    build.onLoad({ filter: /[\\/]ui[\\/]toast\.tsx$/ }, () => ({ contents: 'export const errors = []; export const toast = input => errors.push(input);', loader: 'js' }));
  } }] });
  const module = { exports: {} as {
    createMenu: (props: object) => { render: (props?: object) => any; unmount: () => void; stateUpdatesAfterUnmount: () => number };
    confirmation: () => any;
  } };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
})();

const noop = () => {};
const tasks = { loading: false, translating: false, summaryLoading: false, blockCount: 2,
  translatedCount: 0, translationCompleted: 0, translationTotal: 0, hasSummary: true };
const menuProps = { tasks, cancelling: false, aiConfigured: true, summarySourceReady: true,
  onParse: noop, onReparse: noop, onTranslate: noop, onCancelTranslate: noop, onGenerate: noop, onOpenJson: noop };
type Harness = Awaited<typeof components>['createMenu'] extends (...args: any[]) => infer Result ? Result : never;

function elements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...elements(tree.props?.children, predicate)];
}

function entries(tree: any) {
  return elements(tree, (element) => Array.isArray(element.props?.entries))[0].props.entries as any[];
}

function open(menu: Harness) {
  const trigger = elements(menu.render(), (element) => element.type === 'button')[0];
  trigger.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) } });
  return entries(menu.render());
}

const flushAction = () => new Promise<void>((resolve) => setImmediate(resolve));

test('summary and reparse require approval, reject duplicate selections, and use current callbacks', async () => {
  const { createMenu, confirmation } = await components;
  for (const action of ['summary', 'reparse']) {
    const calls: unknown[] = [];
    const props = { ...menuProps, onGenerate: () => { calls.push('stale'); }, onReparse: () => { calls.push('stale'); } };
    const menu = createMenu(props);
    const entry = open(menu).find((entry) => entry.id === action);
    const pending = entry.onSelect();
    let settled = false;
    void pending.then(() => { settled = true; });
    const dialog = confirmation();
    assert.ok(dialog.props.description.includes('消耗'));
    const duplicate = entry.onSelect();
    await flushAction();
    assert.equal(settled, false, 'a duplicate selection must not replace or cancel the first prompt');
    menu.render({ ...props, onGenerate: (options?: object) => { calls.push(options); }, onReparse: () => { calls.push('current'); } });
    assert.ok(entries(menu.render()).find((entry) => entry.id === action).disabled);
    dialog.props.onConfirm();
    await pending;
    await duplicate;
    assert.deepEqual(calls, action === 'summary' ? [{ force: true }] : ['current']);
    menu.unmount();
  }
});

test('cancelling confirmation consumes no action and releases the lock for retry', async () => {
  const { createMenu, confirmation } = await components;
  for (const action of ['summary', 'reparse']) {
    let calls = 0;
    const menu = createMenu({ ...menuProps, onGenerate: () => { calls += 1; }, onReparse: () => { calls += 1; } });
    const entry = open(menu).find((entry) => entry.id === action);
    const pending = entry.onSelect();
    confirmation().props.onClose();
    await pending;
    assert.equal(calls, 0);
    const retry = entries(menu.render()).find((entry) => entry.id === action).onSelect();
    confirmation().props.onConfirm();
    await retry;
    assert.equal(calls, 1);
    menu.unmount();
  }
});

test('document-key remounts cancel old summary and reparse confirmations without affecting the next document', async () => {
  const { createMenu, confirmation } = await components;
  for (const action of ['summary', 'reparse']) {
    const calls: string[] = [];
    const menu = createMenu({ ...menuProps, onGenerate: () => { calls.push('old'); }, onReparse: () => { calls.push('old'); } });
    const entry = open(menu).find((entry) => entry.id === action);
    const pending = entry.onSelect();
    menu.unmount();
    const next = createMenu({ ...menuProps, onGenerate: () => { calls.push('new'); }, onReparse: () => { calls.push('new'); } });
    open(next);
    confirmation().props.onConfirm();
    await pending;
    await entry.onSelect();
    assert.deepEqual(calls, []);
    assert.equal(menu.stateUpdatesAfterUnmount(), 0);
    assert.equal(confirmation(), null);
    const nextAction = entries(next.render()).find((entry) => entry.id === action).onSelect();
    confirmation().props.onConfirm();
    await nextAction;
    assert.deepEqual(calls, ['new']);
    next.unmount();
  }
});

test('task and summary eligibility transitions invalidate confirmation even if state returns to its original value', async () => {
  const { createMenu, confirmation } = await components;
  const transitions = [
    { tasks: { ...tasks, loading: true } }, { tasks: { ...tasks, translating: true } },
    { tasks: { ...tasks, summaryLoading: true } },
    { tasks: { ...tasks, operation: { kind: 'mineru', status: 'running', completed: 0, total: 1 } } },
    { tasks: { ...tasks, hasSummary: false } }, { aiConfigured: false }, { summarySourceReady: false },
  ];
  for (const action of ['summary', 'reparse']) {
    for (const transition of transitions) {
      let calls = 0;
      const props = { ...menuProps, onGenerate: () => { calls += 1; }, onReparse: () => { calls += 1; } };
      const menu = createMenu(props);
      const pending = open(menu).find((entry) => entry.id === action).onSelect();
      menu.render({ ...props, ...transition });
      menu.render(props);
      confirmation().props.onConfirm();
      await pending;
      assert.equal(calls, 0, `${action}: ${JSON.stringify(transition)}`);
      menu.unmount();
    }
  }
});

test('retained handlers recheck current eligibility before opening a confirmation or starting an action', async () => {
  const { createMenu, confirmation } = await components;
  for (const action of ['summary', 'reparse']) {
    let calls = 0;
    const props = { ...menuProps, onGenerate: () => { calls += 1; }, onReparse: () => { calls += 1; } };
    const menu = createMenu(props);
    const entry = open(menu).find((entry) => entry.id === action);
    menu.render({ ...props, tasks: { ...tasks, summaryLoading: true } });
    await entry.onSelect();
    assert.equal(confirmation(), null);
    assert.equal(calls, 0);
    menu.unmount();
  }
});

test('empty summaries use the normal cache-aware action without quota confirmation', async () => {
  const { createMenu, confirmation } = await components;
  const calls: unknown[] = [];
  const menu = createMenu({ ...menuProps, tasks: { ...tasks, hasSummary: false }, onGenerate: (options?: object) => { calls.push(options); } });
  await open(menu).find((entry) => entry.id === 'summary').onSelect();
  assert.equal(confirmation(), null);
  assert.deepEqual(calls, [{ force: false }]);
  menu.unmount();
});

test('the lock covers pending callbacks, releases on rejection, and permits cancellation of active translation', async () => {
  const { createMenu, confirmation } = await components;
  let reject!: (error: Error) => void;
  let generated = 0, cancelled = 0;
  const props = { ...menuProps, onGenerate: () => {
    generated += 1;
    return new Promise<void>((_resolve, fail) => { reject = fail; });
  }, onCancelTranslate: () => { cancelled += 1; } };
  const menu = createMenu(props);
  const entry = open(menu).find((entry) => entry.id === 'summary');
  const pending = entry.onSelect();
  confirmation().props.onConfirm();
  await flushAction();
  await entry.onSelect();
  assert.equal(generated, 1);
  assert.equal(confirmation(), null);
  menu.render({ ...props, tasks: { ...tasks, translating: true } });
  const cancel = entries(menu.render()).find((entry) => entry.id === 'cancel-translation');
  assert.equal(cancel.disabled, false);
  cancel.onSelect();
  assert.equal(cancelled, 1);
  reject(new Error('Request failed'));
  await pending;
  menu.render(props);
  assert.equal(entries(menu.render()).find((entry) => entry.id === 'summary').disabled, false);
  menu.unmount();
});
