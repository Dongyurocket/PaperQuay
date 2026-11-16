import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as settle } from 'node:timers/promises';
import { useLibraryQueryRefresh } from '../src/features/literature/useLibraryQueryRefresh.ts';
import type { ListPapersRequest, QueryPapersResult } from '../src/types/library.ts';

const require = createRequire(import.meta.url);
const React = require('react');
const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
type Hook = { value?: any; deps?: unknown[]; effect?: () => void | (() => void); cleanup?: void | (() => void); pending?: boolean };

class HookHarness {
  hooks: Hook[] = [];
  index = 0;
  useRef = (initial: unknown) => {
    const hook = this.hooks[this.index++] ?? (this.hooks[this.index - 1] = {});
    return hook.value ?? (hook.value = { current: initial });
  };
  useEffect = (effect: () => void | (() => void), deps: unknown[]) => {
    const hook = this.hooks[this.index++] ?? (this.hooks[this.index - 1] = {});
    if (!hook.deps || !deps.every((value, index) => Object.is(value, hook.deps?.[index]))) {
      hook.effect = effect;
      hook.deps = deps;
      hook.pending = true;
    }
  };
  render(options: Parameters<typeof useLibraryQueryRefresh>[0]) {
    this.index = 0;
    const previous = dispatcher.current;
    dispatcher.current = this;
    try { useLibraryQueryRefresh(options); } finally { dispatcher.current = previous; }
    for (const hook of this.hooks) {
      if (!hook.pending) continue;
      if (typeof hook.cleanup === 'function') hook.cleanup();
      hook.cleanup = hook.effect?.();
      hook.pending = false;
    }
  }
  unmount() {
    for (const hook of this.hooks) if (typeof hook.cleanup === 'function') hook.cleanup();
  }
}

test('event refresh waits for initialization, coalesces bursts and uses the latest query', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldWindow = globalThis.window;
  const windowStub = new EventTarget() as any;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub });
  const harness = new HookHarness();
  let oldQueries = 0;
  let latestQueries = 0;
  let categoryUpdates = 0;
  const options = {
    enabled: true,
    ready: false,
    refreshPapers: async () => { oldQueries += 1; },
    listCategories: async () => [],
    setCategories: () => { categoryUpdates += 1; },
  };
  try {
    harness.render(options);
    t.mock.timers.tick(1000);
    assert.equal(oldQueries, 0);
    windowStub.dispatchEvent(new Event('paperquay:native-summary-updated'));
    windowStub.dispatchEvent(new Event('paperquay:native-paper-updated'));
    t.mock.timers.tick(1000);
    assert.equal(oldQueries, 0);

    harness.render({ ...options, ready: true });
    t.mock.timers.tick(100);
    await settle();
    assert.equal(oldQueries, 1);
    assert.equal(categoryUpdates, 1);
    windowStub.dispatchEvent(new Event('paperquay:native-summary-updated'));
    windowStub.dispatchEvent(new Event('paperquay:library-reading-updated'));
    t.mock.timers.tick(99);
    assert.equal(oldQueries, 1);
    harness.render({ ...options, ready: true, refreshPapers: async () => { latestQueries += 1; } });
    t.mock.timers.tick(1);
    await settle();
    assert.equal(oldQueries, 1);
    assert.equal(latestQueries, 1);

    windowStub.dispatchEvent(new Event('paperquay:native-paper-updated'));
    harness.unmount();
    t.mock.timers.tick(1000);
    assert.equal(latestQueries, 1);
    harness.render({ ...options, enabled: false, ready: true });
    windowStub.dispatchEvent(new Event('paperquay:native-summary-updated'));
    t.mock.timers.tick(1000);
    assert.equal(oldQueries, 1);
  } finally {
    harness.unmount();
    await settle();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
  }
});

test('native events requery actual SQLite membership, totals and recent-reading order', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-query-refresh-'));
  const appPaths = { dataDir: root, configPath: path.join(root, 'config.json'), libraryPath: path.join(root, 'library.json'), libraryDatabasePath: path.join(root, 'library.sqlite'), ragDatabasePath: path.join(root, 'rag.sqlite') };
  const store = createLibraryStore(appPaths);
  const commands = createLibraryCommands({ appPaths, store });
  const oldWindow = globalThis.window;
  const windowStub = new EventTarget() as any;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub });
  const harness = new HookHarness();
  let request: ListPapersRequest = { hasSummary: true };
  let visible!: QueryPapersResult;
  const refreshPapers = async () => { visible = await commands.library_query_papers({ request }); };
  const refreshAfter = async (event: string) => {
    windowStub.dispatchEvent(new Event(event));
    t.mock.timers.tick(100);
    await settle();
  };
  try {
    const paths = ['one', 'two'].map((name) => {
      const pdf = path.join(root, `${name}.pdf`);
      writeFileSync(pdf, `%PDF-1.7\n${name}`);
      return pdf;
    });
    const imported = await commands.library_import_pdfs({ request: { paths, importMode: 'keep' } });
    const [first, second] = imported.map((result: any) => result.paper.id);
    await refreshPapers();
    assert.equal(visible.total, 0);
    harness.render({ enabled: true, ready: true, refreshPapers, listCategories: () => commands.library_list_categories(), setCategories: () => {} });

    await commands.library_update_paper({ request: { paperId: first, aiSummary: 'First summary' } });
    await refreshAfter('paperquay:native-summary-updated');
    assert.equal(visible.total, 1);
    assert.deepEqual(visible.papers.map((paper) => paper.id), [first]);
    await commands.library_update_paper({ request: { paperId: first, aiSummary: '' } });
    await refreshAfter('paperquay:native-paper-updated');
    assert.equal(visible.total, 0);
    assert.deepEqual(visible.papers, []);

    request = { readStatus: 'unread' };
    await refreshPapers();
    assert.equal(visible.total, 2);
    const timestamp = Date.now() - 1000;
    await commands.library_record_reading({ request: { paperId: first, lastReadAt: timestamp } });
    await refreshAfter('paperquay:library-reading-updated');
    assert.equal(visible.total, 1);
    assert.deepEqual(visible.papers.map((paper) => paper.id), [second]);

    request = { readAfter: timestamp, sortBy: 'lastReadAt', sortDirection: 'desc' };
    await refreshPapers();
    assert.equal(visible.total, 1);
    await commands.library_record_reading({ request: { paperId: second, lastReadAt: timestamp + 100 } });
    await refreshAfter('paperquay:native-paper-updated');
    assert.equal(visible.total, 2);
    assert.deepEqual(visible.papers.map((paper) => paper.id), [second, first]);
    await commands.library_record_reading({ request: { paperId: first, lastReadAt: timestamp + 200 } });
    await refreshAfter('paperquay:library-reading-updated');
    assert.deepEqual(visible.papers.map((paper) => paper.id), [first, second]);
  } finally {
    harness.unmount();
    await settle();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
