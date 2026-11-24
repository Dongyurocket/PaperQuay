import { useCallback, useEffect, useRef, useState } from 'react';
import type { TextSelectionPayload } from '../../../types/reader';
import {
  getScopedSelectionPayload,
  hasActiveTextSelection,
  selectionBelongsToContainer,
} from '../pdfPageDomUtils';
import type { AnnotationEditorTool } from '../PdfViewerToolbar';

const PDF_SELECTION_COMMIT_RETRY_DELAYS = [48, 120, 240, 420];

type MutableRef<T> = { current: T };
type BooleanStateSetter = (value: boolean | ((current: boolean) => boolean)) => void;

interface UsePdfSelectionOptions {
  active: boolean;
  activeRef: MutableRef<boolean>;
  containerRef: MutableRef<HTMLDivElement | null>;
  editorToolRef: MutableRef<AnnotationEditorTool>;
  onTextSelect?: (selection: TextSelectionPayload) => void;
}

function setBooleanStateIfChanged(setter: BooleanStateSetter, value: boolean) {
  setter((current) => (current === value ? current : value));
}

export function usePdfSelection({
  active,
  activeRef,
  containerRef,
  editorToolRef,
  onTextSelect,
}: UsePdfSelectionOptions) {
  const [hasLiveTextSelection, setHasLiveTextSelection] = useState(false);
  const selectionStartedInsideRef = useRef(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const selectionCommitAttemptRef = useRef(0);
  const pendingBlockSelectTimerRef = useRef<number | null>(null);
  const lastSelectionRef = useRef<{ text: string; emittedAt: number } | null>(null);

  const clearSelectionCommitTimer = useCallback(() => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
      selectionCommitTimerRef.current = null;
    }

    selectionCommitAttemptRef.current = 0;
  }, []);

  const clearPendingBlockSelect = useCallback(() => {
    if (pendingBlockSelectTimerRef.current !== null) {
      window.clearTimeout(pendingBlockSelectTimerRef.current);
      pendingBlockSelectTimerRef.current = null;
    }
  }, []);

  const emitSelectedText = useCallback(() => {
    if (!activeRef.current || !onTextSelect || editorToolRef.current !== 'none') {
      return false;
    }

    const selection = getScopedSelectionPayload(containerRef.current);

    if (!selection) {
      lastSelectionRef.current = null;
      return false;
    }

    const now = Date.now();

    if (
      lastSelectionRef.current &&
      lastSelectionRef.current.text === selection.text &&
      now - lastSelectionRef.current.emittedAt < 250
    ) {
      return true;
    }

    lastSelectionRef.current = {
      text: selection.text,
      emittedAt: now,
    };
    onTextSelect(selection);
    return true;
  }, [onTextSelect]);

  const scheduleSelectionCommit = useCallback(
    (delay = PDF_SELECTION_COMMIT_RETRY_DELAYS[0], attempt = 0) => {
      if (!active || !onTextSelect || editorToolRef.current !== 'none') {
        return;
      }

      if (selectionCommitTimerRef.current !== null) {
        window.clearTimeout(selectionCommitTimerRef.current);
        selectionCommitTimerRef.current = null;
      }

      selectionCommitAttemptRef.current = attempt;
      selectionCommitTimerRef.current = window.setTimeout(() => {
        selectionCommitTimerRef.current = null;
        const committed = emitSelectedText();

        if (committed) {
          selectionCommitAttemptRef.current = 0;
          return;
        }

        const nextAttempt = selectionCommitAttemptRef.current + 1;
        const nextDelay = PDF_SELECTION_COMMIT_RETRY_DELAYS[nextAttempt];

        if (
          nextDelay !== undefined &&
          hasActiveTextSelection() &&
          editorToolRef.current === 'none' &&
          activeRef.current
        ) {
          scheduleSelectionCommit(nextDelay, nextAttempt);
          return;
        }

        selectionCommitAttemptRef.current = 0;
      }, delay);
    },
    [active, emitSelectedText, onTextSelect],
  );

  useEffect(
    () => () => {
      clearSelectionCommitTimer();
      clearPendingBlockSelect();
    },
    [clearPendingBlockSelect, clearSelectionCommitTimer],
  );

  useEffect(() => {
    if (!active || !onTextSelect) {
      return undefined;
    }

    const isEventInsideContainer = (event: Event) => {
      const container = containerRef.current;
      const target = event.target;

      return Boolean(container && target instanceof Node && container.contains(target));
    };

    const handleSelectionStart = (event: MouseEvent | PointerEvent) => {
      selectionStartedInsideRef.current = isEventInsideContainer(event);

      if (selectionStartedInsideRef.current) {
        clearPendingBlockSelect();
      }
    };

    const handleMouseSelectionCommit = (event: MouseEvent) => {
      if (editorToolRef.current !== 'none') {
        return;
      }

      const shouldReadSelection =
        selectionStartedInsideRef.current || isEventInsideContainer(event);

      selectionStartedInsideRef.current = false;

      if (!shouldReadSelection) {
        return;
      }

      clearPendingBlockSelect();
      scheduleSelectionCommit();
    };

    const handleKeyboardSelectionCommit = (event: KeyboardEvent) => {
      if (editorToolRef.current !== 'none') {
        return;
      }

      if (!isEventInsideContainer(event)) {
        return;
      }

      scheduleSelectionCommit();
    };

    const handleSelectionChange = () => {
      const selectionInside = selectionBelongsToContainer(containerRef.current);
      const activeSelectionInside = selectionInside && hasActiveTextSelection();
      setBooleanStateIfChanged(
        setHasLiveTextSelection,
        activeSelectionInside,
      );

      if (editorToolRef.current !== 'none') {
        return;
      }

      if (activeSelectionInside) {
        clearPendingBlockSelect();
        scheduleSelectionCommit(180);
        return;
      }

      if (!selectionStartedInsideRef.current && !selectionInside) {
        return;
      }

      clearPendingBlockSelect();
    };

    document.addEventListener('pointerdown', handleSelectionStart);
    document.addEventListener('mousedown', handleSelectionStart);
    document.addEventListener('mouseup', handleMouseSelectionCommit);
    document.addEventListener('keyup', handleKeyboardSelectionCommit);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      setBooleanStateIfChanged(setHasLiveTextSelection, false);
      document.removeEventListener('pointerdown', handleSelectionStart);
      document.removeEventListener('mousedown', handleSelectionStart);
      document.removeEventListener('mouseup', handleMouseSelectionCommit);
      document.removeEventListener('keyup', handleKeyboardSelectionCommit);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [active, clearPendingBlockSelect, onTextSelect, scheduleSelectionCommit]);

  return {
    clearPendingBlockSelect,
    clearSelectionCommitTimer,
    hasLiveTextSelection,
    pendingBlockSelectTimerRef,
    scheduleSelectionCommit,
    setHasLiveTextSelection,
  };
}
