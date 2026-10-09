export interface AgentStreamMessageDraft {
  answer: string;
  thinking: string;
}

/** Throttle drafts while preventing queued callbacks from changing a finished response. */
export function createAgentStreamMessageBuffer<TimerHandle>(options: {
  isActive: () => boolean;
  commit: (draft: AgentStreamMessageDraft, canApply: () => boolean) => void;
  schedule: (callback: () => void, delayMs: number) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
  now?: () => number;
  intervalMs?: number;
}) {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 120;
  let turn = 0;
  let generation = 0;
  let closed = false;
  let answer = '';
  let thinking = '';
  let timer: TimerHandle | undefined;
  let lastCommitAt: number | undefined;

  const cancelPending = () => {
    if (timer !== undefined) options.cancel(timer);
    timer = undefined;
  };
  const flush = () => {
    timer = undefined;
    if (closed || !options.isActive() || (!answer.trim() && !thinking.trim())) return;
    lastCommitAt = now();
    const draftGeneration = generation;
    options.commit({ answer, thinking }, () => !closed && generation === draftGeneration && options.isActive());
  };
  const scheduleCommit = () => {
    if (closed || !options.isActive()) return;
    const elapsedMs = lastCommitAt === undefined ? intervalMs : now() - lastCommitAt;
    if (elapsedMs >= intervalMs) {
      cancelPending();
      flush();
    } else if (timer === undefined) {
      timer = options.schedule(flush, intervalMs - elapsedMs);
    }
  };
  const clearTurn = () => {
    cancelPending();
    generation += 1;
    answer = '';
    thinking = '';
  };

  return {
    startTurn(nextTurn: number) {
      if (closed) return;
      clearTurn();
      turn = nextTurn;
    },
    discardTurn() {
      if (!closed) clearTurn();
    },
    receiveAnswer(fullText: string, draftTurn?: number) {
      if (closed || (draftTurn !== undefined && draftTurn !== turn)) return;
      answer = fullText;
      scheduleCommit();
    },
    receiveThinking(fullText: string, draftTurn?: number) {
      if (closed || (draftTurn !== undefined && draftTurn !== turn)) return;
      thinking = fullText;
      scheduleCommit();
    },
    close() {
      if (closed) return;
      closed = true;
      clearTurn();
    },
    isClosed: () => closed,
  };
}
