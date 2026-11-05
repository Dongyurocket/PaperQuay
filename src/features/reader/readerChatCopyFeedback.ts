export type ReaderChatCopyStatus = 'success' | 'error';

export interface ReaderChatCopyFeedback {
  messageId: string;
  status: ReaderChatCopyStatus;
}

interface TimerApi {
  set(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout>): void;
}

export function createReaderChatCopyFeedbackController(
  onChange: (feedback: ReaderChatCopyFeedback | null) => void,
  timers: TimerApi = {
    set: (callback, delay) => setTimeout(callback, delay),
    clear: (timer) => clearTimeout(timer),
  },
) {
  let requestId = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  };

  return {
    begin() {
      clearTimer();
      requestId += 1;
      onChange(null);
      return requestId;
    },
    resolve(id: number, feedback: ReaderChatCopyFeedback) {
      if (disposed || id !== requestId) return false;
      clearTimer();
      onChange(feedback);
      timer = timers.set(() => {
        if (disposed || id !== requestId) return;
        onChange(null);
        timer = null;
      }, 1600);
      return true;
    },
    invalidate() {
      requestId += 1;
      clearTimer();
    },
    reset() {
      this.invalidate();
      if (!disposed) onChange(null);
    },
    dispose() {
      this.invalidate();
      disposed = true;
    },
  };
}
