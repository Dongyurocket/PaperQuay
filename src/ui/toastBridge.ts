export interface ToastBridgeInput {
  tone?: 'success' | 'error' | 'info' | 'progress';
  message: string;
  key?: string;
  duration?: number;
  description?: string;
}

const TOAST_EVENT = 'paperquay:toast';

export function emitToast(input: ToastBridgeInput) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: input }));
}

export function emitToastDismiss(key: string) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
    detail: { dismissKey: key },
  }));
}

export function getToastBridgeEventName() {
  return TOAST_EVENT;
}

