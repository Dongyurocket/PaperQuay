import test from 'node:test';
import assert from 'node:assert/strict';

import { copyTextToClipboard } from '../src/utils/clipboard.ts';
import { createReaderChatCopyFeedbackController } from '../src/features/reader/readerChatCopyFeedback.ts';

async function withGlobals(values: Record<string, unknown>, run: () => Promise<void>) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    await run();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function unavailableClipboardNavigator() {
  return {};
}

test('uses the Electron bridge first and preserves the legacy trimmed default', async () => {
  const writes: string[] = [];
  await withGlobals({
    window: { paperquay: { clipboard: { writeText: (text: string) => writes.push(text) } } },
    navigator: { clipboard: { writeText: () => assert.fail('browser clipboard should not run') } },
  }, async () => {
    assert.equal(await copyTextToClipboard('  note text  '), true);
    assert.deepEqual(writes, ['note text']);
    assert.equal(await copyTextToClipboard('  reader text  ', { preserveWhitespace: true }), true);
    assert.deepEqual(writes, ['note text', '  reader text  ']);
    assert.equal(await copyTextToClipboard('   '), false);
    assert.equal(writes.length, 2);
  });
});

test('continues to browser clipboard after a synchronous Electron failure', async () => {
  const writes: string[] = [];
  await withGlobals({
    window: { paperquay: { clipboard: { writeText: () => { throw new Error('bridge failed'); } } } },
    navigator: { clipboard: { writeText: async (text: string) => { writes.push(text); } } },
  }, async () => {
    assert.equal(await copyTextToClipboard('hello'), true);
    assert.deepEqual(writes, ['hello']);
  });
});

test('continues to browser clipboard after an Electron promise rejection', async () => {
  const writes: string[] = [];
  await withGlobals({
    window: { paperquay: { clipboard: { writeText: async () => { throw new Error('bridge rejected'); } } } },
    navigator: { clipboard: { writeText: async (text: string) => { writes.push(text); } } },
  }, async () => {
    assert.equal(await copyTextToClipboard('hello'), true);
    assert.deepEqual(writes, ['hello']);
  });
});

test('falls back to textarea when browser clipboard rejects', async () => {
  const copied: string[] = [];
  class FakeElement {
    isConnected = true;
    style: Record<string, string> = {};
    value = '';
    selectionStart = 2;
    selectionEnd = 5;
    selectionDirection = 'forward';
    focusCount = 0;
    restoredInputSelection: number[] | null = null;
    setAttribute() {}
    focus() { this.focusCount += 1; }
    select() { copied.push(this.value); }
    remove() { this.isConnected = false; }
    setSelectionRange(start: number, end: number) { this.restoredInputSelection = [start, end]; }
  }
  const range = {
    startContainer: { isConnected: true },
    endContainer: { isConnected: true },
    cloneRange() { return this; },
  };
  const restoredRanges: unknown[] = [];
  const selection = {
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges() {},
    addRange: (next: unknown) => restoredRanges.push(next),
  };
  const activeElement = new FakeElement();
  let removed = 0;
  const temporaryElement = new FakeElement();
  const originalRemove = temporaryElement.remove.bind(temporaryElement);
  temporaryElement.remove = () => { removed += 1; originalRemove(); };
  const document = {
    activeElement,
    body: { appendChild() {} },
    createElement: () => temporaryElement,
    getSelection: () => selection,
    execCommand: (command: string) => command === 'copy',
  };
  await withGlobals({
    window: undefined,
    navigator: { clipboard: { writeText: async () => { throw new Error('browser denied'); } } },
    document,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeElement,
    HTMLTextAreaElement: FakeElement,
  }, async () => {
    assert.equal(await copyTextToClipboard('fallback'), true);
    assert.deepEqual(copied, ['fallback']);
    assert.equal(removed, 1);
    assert.equal(activeElement.focusCount, 1);
    assert.deepEqual(activeElement.restoredInputSelection, [2, 5]);
    assert.deepEqual(restoredRanges, []);
  });
});

test('throws when every clipboard path fails and removes fallback textarea', async () => {
  let removed = 0;
  class FakeElement {
    isConnected = true;
    style: Record<string, string> = {};
    value = '';
    setAttribute() {}
    focus() {}
    select() {}
    remove() { removed += 1; this.isConnected = false; }
    setSelectionRange() {}
  }
  const document = {
    activeElement: null,
    body: { appendChild() {} },
    createElement: () => new FakeElement(),
    getSelection: () => null,
    execCommand: () => false,
  };
  await withGlobals({
    window: { paperquay: { clipboard: { writeText: () => { throw new Error('bridge failed'); } } } },
    navigator: { clipboard: { writeText: async () => { throw new Error('browser failed'); } } },
    document,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeElement,
    HTMLTextAreaElement: FakeElement,
  }, async () => {
    await assert.rejects(copyTextToClipboard('fail'), /browser failed/);
    assert.equal(removed, 1);
  });
});

test('does not report a false execCommand result as success', async () => {
  class FakeElement {
    isConnected = true;
    style: Record<string, string> = {};
    value = '';
    setAttribute() {}
    focus() {}
    select() {}
    remove() {}
    setSelectionRange() {}
  }
  await withGlobals({
    window: undefined,
    navigator: unavailableClipboardNavigator(),
    document: {
      activeElement: null,
      body: { appendChild() {} },
      createElement: () => new FakeElement(),
      getSelection: () => null,
      execCommand: () => false,
    },
    HTMLElement: FakeElement,
    HTMLInputElement: FakeElement,
    HTMLTextAreaElement: FakeElement,
  }, async () => {
    await assert.rejects(copyTextToClipboard('not copied'), /Clipboard write failed/);
  });
});

test('textarea fallback restores a content selection and cleans up if execCommand throws', async () => {
  let removed = 0;
  let focusRestored = false;
  const range = { startContainer: { isConnected: true }, endContainer: { isConnected: true }, cloneRange() { return this; } };
  const restored: unknown[] = [];
  const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange: (value: unknown) => restored.push(value) };
  class FakeInput {}
  const activeElement = { isConnected: true, focus() { focusRestored = true; } };
  await withGlobals({ window: undefined, navigator: undefined, HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeInput,
    document: { activeElement, body: { appendChild() {} }, getSelection: () => selection,
      createElement: () => ({ style: {}, value: '', setAttribute() {}, focus() {}, select() {}, remove() { removed += 1; } }),
      execCommand() { throw new Error('exec rejected'); } },
  }, async () => {
    await assert.rejects(copyTextToClipboard('content'), /exec rejected/);
    assert.equal(removed, 1);
    assert.equal(focusRestored, true);
    assert.deepEqual(restored, [range]);
  });
});

test('empty text skips all clipboard access and source strings are preserved', async () => {
  await withGlobals({ window: undefined, navigator: undefined, document: undefined }, async () => {
    assert.equal(await copyTextToClipboard(' \n\t', { preserveWhitespace: true }), false);
    await assert.rejects(copyTextToClipboard('not empty'), /Clipboard write failed/);
  });
  const writes: string[] = [];
  await withGlobals({ window: { paperquay: { clipboard: { writeText: (text: string) => writes.push(text) } } } }, async () => {
    for (const source of ['  ## Markdown\n\n$C_L$ [1]\n```ts\nconst x = 1;\n```  ', '<section><p>HTML source</p></section>']) {
      assert.equal(await copyTextToClipboard(source, { preserveWhitespace: true }), true);
      assert.equal(writes[writes.length - 1], source);
    }
  });
});

test('new copy clears prior feedback timer and successful feedback expires', () => {
  const updates: unknown[] = [];
  const callbacks: Array<() => void> = [];
  let cleared = 0;
  const controller = createReaderChatCopyFeedbackController((value) => updates.push(value), {
    set(callback, delay) { assert.equal(delay, 1600); callbacks.push(callback); return callbacks.length as unknown as ReturnType<typeof setTimeout>; },
    clear() { cleared += 1; },
  });
  const first = controller.begin();
  controller.resolve(first, { messageId: 'a', status: 'success' });
  const second = controller.begin();
  assert.equal(cleared, 1);
  callbacks[0]();
  assert.equal(updates.length, 3);
  controller.resolve(second, { messageId: 'b', status: 'success' });
  callbacks[1]();
  assert.equal(updates[updates.length - 1], null);
});

test('feedback ignores stale requests and clears its timer on invalidation', () => {
  const updates: unknown[] = [];
  const scheduled: Array<() => void> = [];
  let cleared = 0;
  const controller = createReaderChatCopyFeedbackController(
    (value) => updates.push(value),
    {
      set(callback) { scheduled.push(callback); return scheduled.length as unknown as ReturnType<typeof setTimeout>; },
      clear() { cleared += 1; },
    },
  );
  const first = controller.begin();
  const second = controller.begin();
  assert.equal(controller.resolve(first, { messageId: 'a', status: 'success' }), false);
  assert.equal(controller.resolve(second, { messageId: 'b', status: 'success' }), true);
  controller.invalidate();
  scheduled[0]?.();
  assert.deepEqual(updates, [null, null, { messageId: 'b', status: 'success' }]);
  assert.equal(cleared, 1);
});

test('feedback disposal prevents late async results and timer updates', () => {
  const updates: unknown[] = [];
  let timerCallback: (() => void) | undefined;
  const controller = createReaderChatCopyFeedbackController(
    (value) => updates.push(value),
    {
      set(callback) { timerCallback = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
      clear() {},
    },
  );
  const request = controller.begin();
  controller.dispose();
  assert.equal(controller.resolve(request, { messageId: 'a', status: 'error' }), false);
  timerCallback?.();
  assert.deepEqual(updates, [null]);
});
