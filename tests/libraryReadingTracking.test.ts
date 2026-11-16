import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setImmediate as settle } from 'node:timers/promises';
import { useLibraryReadingTracking } from '../src/features/reader/useLibraryReadingTracking.ts';
import type { PdfScrollPosition, WorkspaceItem } from '../src/types/reader.ts';

const require = createRequire(import.meta.url);
const React = require('react');
const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
type Hook = { value?: any; deps?: unknown[]; effect?: () => void | (() => void); cleanup?: void | (() => void); pending?: boolean };
const sameDeps = (a?: unknown[], b?: unknown[]) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));

class HookHarness {
  hooks: Hook[] = [];
  index = 0;
  useRef = (initial: unknown) => {
    const hook = this.hooks[this.index++] ?? (this.hooks[this.index - 1] = {});
    return hook.value ?? (hook.value = { current: initial });
  };
  useCallback = (callback: (...args: any[]) => unknown, deps: unknown[]) => {
    const hook = this.hooks[this.index++] ?? (this.hooks[this.index - 1] = {});
    if (!sameDeps(hook.deps, deps)) { hook.value = callback; hook.deps = deps; }
    return hook.value;
  };
  useEffect = (effect: () => void | (() => void), deps: unknown[]) => {
    const hook = this.hooks[this.index++] ?? (this.hooks[this.index - 1] = {});
    if (!sameDeps(hook.deps, deps)) { hook.effect = effect; hook.deps = deps; hook.pending = true; }
  };
  render(options: Parameters<typeof useLibraryReadingTracking>[0]) {
    this.index = 0;
    const previous = dispatcher.current;
    dispatcher.current = this;
    let result: ReturnType<typeof useLibraryReadingTracking>;
    try { result = useLibraryReadingTracking(options); } finally { dispatcher.current = previous; }
    for (const hook of this.hooks) {
      if (!hook.pending) continue;
      if (typeof hook.cleanup === 'function') hook.cleanup();
      hook.cleanup = hook.effect?.();
      hook.pending = false;
    }
    return result;
  }
  unmount() {
    for (const hook of this.hooks) if (typeof hook.cleanup === 'function') hook.cleanup();
  }
}

test('native reader records open and scroll, then flushes on deactivation', async () => {
  const oldWindow = globalThis.window;
  const windowStub = new EventTarget() as any;
  const requests: any[] = [];
  let updates = 0;
  windowStub.paperquay = { invoke: async (command: string, args: any) => {
    assert.equal(command, 'library_record_reading');
    requests.push(args.request);
    return true;
  } };
  windowStub.addEventListener('paperquay:library-reading-updated', () => { updates += 1; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub });
  const harness = new HookHarness();
  try {
    const document = { source: 'native-library', itemKey: 'p1', workspaceId: 'native-library:p1' } as WorkspaceItem;
    const options = { document, expectedWorkspaceId: document.workspaceId, active: true, sourceKey: 'pdf-a', pageCount: 4, position: null };
    const onScroll = harness.render(options);
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].paperId, 'p1');
    assert.equal(requests[0].readingProgress, undefined);

    const position: PdfScrollPosition = { sourceKey: 'pdf-a', page: 3, pageOffsetRatio: 0.5, top: 0, left: 0, pageOffsetTop: 0, updatedAt: Date.now() };
    onScroll({ ...position, sourceKey: 'stale-pdf' });
    onScroll(position);
    assert.equal(requests.length, 1);
    harness.render({ ...options, active: false });
    await settle();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].readingProgress, 0.625);
    assert.equal(updates, 2);

    harness.render({ ...options, document: { ...document, source: 'standalone' } });
    harness.render({ ...options, expectedWorkspaceId: 'native-library:other' });
    await settle();
    assert.equal(requests.length, 2);
  } finally {
    harness.unmount();
    await settle();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
  }
});

test('restored progress waits for its source page count and flushes before unload', async () => {
  const oldWindow = globalThis.window;
  const windowStub = new EventTarget() as any;
  const requests: any[] = [];
  windowStub.paperquay = { invoke: async (_command: string, args: any) => {
    requests.push(args.request);
    return true;
  } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub });
  const harness = new HookHarness();
  try {
    const document = { source: 'native-library', itemKey: 'p1', workspaceId: 'native-library:p1' } as WorkspaceItem;
    const position: PdfScrollPosition = { sourceKey: 'pdf-a', page: 3, pageOffsetRatio: 0.5, top: 0, left: 0, pageOffsetTop: 0, updatedAt: 1 };
    const options = { document, expectedWorkspaceId: document.workspaceId, active: true, sourceKey: 'pdf-a', pageCount: 0, position };
    harness.render({ ...options, active: false });
    assert.equal(requests.length, 0);
    harness.render(options);
    windowStub.dispatchEvent(new Event('beforeunload'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].readingProgress, undefined);

    harness.render({ ...options, pageCount: 4 });
    windowStub.dispatchEvent(new Event('beforeunload'));
    assert.equal(requests[1].readingProgress, 0.625);

    const onNewSourceScroll = harness.render({ ...options, sourceKey: 'pdf-b' });
    onNewSourceScroll({ ...position, sourceKey: 'pdf-b' });
    windowStub.dispatchEvent(new Event('beforeunload'));
    assert.equal(requests.length, 2);

    harness.render({ ...options, sourceKey: 'pdf-b', pageCount: 1, position: null });
    windowStub.dispatchEvent(new Event('beforeunload'));
    assert.equal(requests[2].readingProgress, 1);
    await settle();
  } finally {
    harness.unmount();
    await settle();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
  }
});
