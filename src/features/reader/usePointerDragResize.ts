import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * 拖拽期加到 <body> 上的类名，全局样式据此屏蔽 iframe 的指针事件。
 * 见 src/app/index.css 中的 `body.pq-resizing iframe`。
 */
const RESIZING_BODY_CLASS = 'pq-resizing';

export interface PointerDragResizeOptions {
  /** 真正开始拖拽时回调（左键按下且监听已就位） */
  onStart?: () => void;
  /** 每一次指针移动 */
  onMove: (event: PointerEvent) => void;
  /** 拖拽结束（正常松开或任一兜底出口） */
  onEnd?: () => void;
  /** 拖拽期间的光标，默认列宽调整 */
  cursor?: string;
}

/** 结束后用于提前终止当前拖拽；未开始拖拽时返回 null */
export type PointerDragEnd = () => void;

/**
 * 启动一次指针拖拽。
 *
 * 关键点：对分隔条调用 `setPointerCapture`，后续 `pointermove` / `pointerup`
 * 全部重定向到分隔条自身并冒泡到 window。这样鼠标经过 iframe（问答侧栏的
 * HTML 回答）、PDF 画布或移出窗口时，`pointerup` 依然会送达，拖拽不会粘住。
 *
 * 除正常 `pointerup` 外，还有 `pointercancel`、`lostpointercapture`、
 * `window.blur` 三个兜底出口，以及 `buttons === 0` 的立即结束判断。
 */
export function startPointerDrag(
  event: ReactPointerEvent<Element>,
  { onStart, onMove, onEnd, cursor = 'col-resize' }: PointerDragResizeOptions,
): PointerDragEnd | null {
  if (event.button !== 0) {
    return null;
  }

  event.preventDefault();

  const target = event.currentTarget;
  const { pointerId } = event;
  const body = globalThis.document.body;
  const previousUserSelect = body.style.userSelect;
  const previousCursor = body.style.cursor;
  let ended = false;

  const handlePointerMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }

    // 左键已经松开却漏掉了 pointerup（例如手势被系统打断）时立即收尾。
    if (moveEvent.buttons === 0) {
      end();
      return;
    }

    onMove(moveEvent);
  };

  const end = () => {
    if (ended) {
      return;
    }

    ended = true;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', end);
    target.removeEventListener('lostpointercapture', end);

    try {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // 指针已失效（元素卸载等），忽略。
    }

    body.style.userSelect = previousUserSelect;
    body.style.cursor = previousCursor;
    body.classList.remove(RESIZING_BODY_CLASS);
    onEnd?.();
  };

  try {
    target.setPointerCapture(pointerId);
  } catch {
    // 捕获不可用时仍能工作：指针未经过 iframe 时事件照常冒泡到 window。
  }

  body.style.userSelect = 'none';
  body.style.cursor = cursor;
  body.classList.add(RESIZING_BODY_CLASS);

  // 捕获成功后事件被重定向到 target，仍会冒泡到 window；监听放在 window 上，
  // 这样即使捕获失败也能收到同一份事件。
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
  target.addEventListener('lostpointercapture', end);

  onStart?.();

  return end;
}

/**
 * 组件内使用的拖拽启动器，负责在卸载时结束进行中的拖拽，
 * 避免遗留 body 样式与全局监听。
 */
export function usePointerDragResize(): (
  event: ReactPointerEvent<Element>,
  options: PointerDragResizeOptions,
) => PointerDragEnd | null {
  const endDragRef = useRef<PointerDragEnd | null>(null);

  useEffect(
    () => () => {
      endDragRef.current?.();
      endDragRef.current = null;
    },
    [],
  );

  return useCallback((event, options) => {
    endDragRef.current?.();

    const end = startPointerDrag(event, {
      ...options,
      onEnd: () => {
        endDragRef.current = null;
        options.onEnd?.();
      },
    });

    endDragRef.current = end;

    return end;
  }, []);
}
