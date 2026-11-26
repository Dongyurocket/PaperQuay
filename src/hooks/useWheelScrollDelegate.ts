import { useCallback, useEffect, type RefObject, type WheelEventHandler } from 'react';
import {
  canScrollInDirection,
  normalizeWheelDelta,
  shouldIgnoreWheelDelegation,
} from '../utils/wheelScroll';

const DEFAULT_TARGET_SELECTOR = '[data-wheel-scroll-target]';
const DEFAULT_IGNORE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'option',
  'iframe',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[data-wheel-scroll-ignore]',
].join(', ');

function matchesEditableContext(target: Element, ignoreSelector: string): boolean {
  return Boolean(target.closest(ignoreSelector));
}

function isElementVerticallyScrollable(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;

  return (
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight + 1
  );
}

function findScrollableAncestor(target: Element, boundary: HTMLElement): HTMLElement | null {
  let current = target instanceof HTMLElement ? target : target.parentElement;

  while (current) {
    if (current === boundary) {
      return isElementVerticallyScrollable(current) ? current : null;
    }

    if (isElementVerticallyScrollable(current)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

interface UseWheelScrollDelegateOptions {
  rootRef: RefObject<HTMLElement | null>;
  targetSelector?: string;
  ignoreSelector?: string;
  /**
   * 弹窗类调用方在 `open=false` 时不渲染 DOM，`rootRef.current` 为 null；
   * 首次挂载的 effect 会在这种状态下只跑一次，之后再打开弹窗也不会重挂。
   * 传入 `enabled`（例如 `open`）让监听随可见性重新建立。
   */
  enabled?: boolean;
}

function handleWheelDelegation(
  root: HTMLElement | null,
  targetSelector: string,
  ignoreSelector: string,
  event: Pick<WheelEvent, 'target' | 'deltaY' | 'deltaMode' | 'preventDefault'> & {
    defaultPrevented: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
  },
) {
  if (!root || shouldIgnoreWheelDelegation(event)) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;

  if (!target || !root.contains(target) || matchesEditableContext(target, ignoreSelector)) {
    return;
  }

  const scrollTarget = root.querySelector<HTMLElement>(targetSelector);

  if (!scrollTarget) {
    return;
  }

  const normalizedDeltaY = normalizeWheelDelta(event, 16, Math.max(scrollTarget.clientHeight, 1));

  if (Math.abs(normalizedDeltaY) < 0.5) {
    return;
  }

  const nestedScrollable = findScrollableAncestor(target, root);

  if (
    nestedScrollable &&
    nestedScrollable !== scrollTarget &&
    canScrollInDirection(nestedScrollable, normalizedDeltaY)
  ) {
    return;
  }

  if (!canScrollInDirection(scrollTarget, normalizedDeltaY)) {
    return;
  }

  event.preventDefault();
  scrollTarget.scrollTop += normalizedDeltaY;
}

export function useWheelScrollDelegate({
  rootRef,
  targetSelector = DEFAULT_TARGET_SELECTOR,
  ignoreSelector = DEFAULT_IGNORE_SELECTOR,
  enabled = true,
}: UseWheelScrollDelegateOptions): WheelEventHandler<HTMLElement> {
  const wheelHandler = useCallback<WheelEventHandler<HTMLElement>>(() => {
    // React attaches wheel listeners as passive in this runtime, so preventDefault()
    // must stay in the native passive:false listener below.
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const root = rootRef.current;

    if (!root) {
      return undefined;
    }

    const nativeHandler = (event: WheelEvent) => {
      handleWheelDelegation(root, targetSelector, ignoreSelector, event);
    };

    root.addEventListener('wheel', nativeHandler, {
      passive: false,
      capture: true,
    });

    return () => {
      root.removeEventListener('wheel', nativeHandler, true);
    };
  }, [enabled, ignoreSelector, rootRef, targetSelector]);

  return wheelHandler;
}
