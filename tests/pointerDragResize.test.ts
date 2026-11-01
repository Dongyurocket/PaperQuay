import test from 'node:test';
import assert from 'node:assert/strict';

import { startPointerDrag } from '../src/features/reader/usePointerDragResize.ts';

class FakeClassList {
  private readonly classes = new Set<string>();

  add(value: string) {
    this.classes.add(value);
  }

  remove(value: string) {
    this.classes.delete(value);
  }

  contains(value: string) {
    return this.classes.has(value);
  }
}

class FakeSeparator extends EventTarget {
  private readonly captured = new Set<number>();

  setPointerCapture(pointerId: number) {
    this.captured.add(pointerId);
  }

  hasPointerCapture(pointerId: number) {
    return this.captured.has(pointerId);
  }

  releasePointerCapture(pointerId: number) {
    this.captured.delete(pointerId);
  }
}

class FakePointerEvent extends Event {
  pointerId: number;
  buttons: number;
  clientX: number;

  constructor(
    type: string,
    init: { pointerId?: number; buttons?: number; clientX?: number } = {},
  ) {
    super(type);
    this.pointerId = init.pointerId ?? 1;
    this.buttons = init.buttons ?? 1;
    this.clientX = init.clientX ?? 0;
  }
}

interface StartOptions {
  button?: number;
  pointerId?: number;
  onMove?: (event: { clientX: number }) => void;
  onEnd?: () => void;
}

function createHarness() {
  const separator = new FakeSeparator();
  const classList = new FakeClassList();
  const body = { style: { userSelect: 'text', cursor: 'auto' }, classList };
  const fakeWindow = new EventTarget();
  const previousDocument = (globalThis as any).document;
  const previousWindow = (globalThis as any).window;

  (globalThis as any).document = { body };
  (globalThis as any).window = fakeWindow;

  return {
    separator,
    body,
    start({ button = 0, pointerId = 1, onMove, onEnd }: StartOptions = {}) {
      let prevented = false;
      const event = {
        button,
        pointerId,
        currentTarget: separator,
        preventDefault() {
          prevented = true;
        },
      } as any;

      const end = startPointerDrag(event, {
        cursor: 'col-resize',
        onMove: onMove ?? (() => {}),
        onEnd,
      });

      return { end, prevented };
    },
    dispatch(
      type: string,
      init: { pointerId?: number; buttons?: number; clientX?: number } = {},
    ) {
      fakeWindow.dispatchEvent(new FakePointerEvent(type, init));
    },
    restore() {
      (globalThis as any).document = previousDocument;
      (globalThis as any).window = previousWindow;
    },
  };
}

test('捕获指针并标记拖拽中，结束后恢复 body 状态', () => {
  const harness = createHarness();

  try {
    const { prevented } = harness.start();

    assert.equal(prevented, true, 'pointerdown 默认行为应被阻止');
    assert.equal(harness.separator.hasPointerCapture(1), true, '应捕获指针');
    assert.equal(harness.body.classList.contains('pq-resizing'), true, '应标记拖拽中');
    assert.equal(harness.body.style.cursor, 'col-resize');
    assert.equal(harness.body.style.userSelect, 'none');

    harness.dispatch('pointerup');

    assert.equal(harness.separator.hasPointerCapture(1), false, '结束后应释放捕获');
    assert.equal(harness.body.classList.contains('pq-resizing'), false);
    assert.equal(harness.body.style.cursor, 'auto', '光标应恢复');
    assert.equal(harness.body.style.userSelect, 'text', 'user-select 应恢复');
  } finally {
    harness.restore();
  }
});

test('左键已松开（buttons === 0）时立即结束，不再跟随鼠标', () => {
  const harness = createHarness();
  const moves: number[] = [];
  let ended = 0;

  try {
    harness.start({
      onMove: (event) => moves.push(event.clientX),
      onEnd: () => {
        ended += 1;
      },
    });

    harness.dispatch('pointermove', { buttons: 1, clientX: 640 });
    harness.dispatch('pointermove', { buttons: 0, clientX: 700 });
    harness.dispatch('pointermove', { buttons: 1, clientX: 900 });

    assert.deepEqual(moves, [640], '松开左键后不应继续调整宽度');
    assert.equal(ended, 1, 'buttons === 0 的 move 应立即结束拖拽');
    assert.equal(harness.body.classList.contains('pq-resizing'), false);
  } finally {
    harness.restore();
  }
});

test('blur / pointercancel / lostpointercapture 三个兜底出口都能结束拖拽', () => {
  const triggers: Array<(harness: ReturnType<typeof createHarness>) => void> = [
    (harness) => harness.dispatch('blur'),
    (harness) => harness.dispatch('pointercancel'),
    (harness) => harness.separator.dispatchEvent(new Event('lostpointercapture')),
  ];

  for (const trigger of triggers) {
    const harness = createHarness();
    let ended = 0;

    try {
      harness.start({ onEnd: () => (ended += 1) });
      harness.dispatch('pointermove', { buttons: 1, clientX: 620 });
      trigger(harness);

      assert.equal(ended, 1, '兜底出口应调用一次 onEnd');
      assert.equal(harness.body.classList.contains('pq-resizing'), false);
      assert.equal(harness.separator.hasPointerCapture(1), false, '兜底出口应释放捕获');
    } finally {
      harness.restore();
    }
  }
});

test('非左键不启动拖拽，其他 pointerId 的事件被忽略', () => {
  const harness = createHarness();
  const moves: number[] = [];

  try {
    const secondary = harness.start({ button: 2 });

    assert.equal(secondary.end, null, '非左键不应开始拖拽');
    assert.equal(harness.body.classList.contains('pq-resizing'), false);

    harness.start({
      pointerId: 7,
      onMove: (event) => moves.push(event.clientX),
    });

    harness.dispatch('pointermove', { pointerId: 8, buttons: 1, clientX: 800 });
    assert.deepEqual(moves, [], '其他指针的事件应被忽略');

    harness.dispatch('pointermove', { pointerId: 7, buttons: 1, clientX: 810 });
    assert.deepEqual(moves, [810]);
  } finally {
    harness.restore();
  }
});
