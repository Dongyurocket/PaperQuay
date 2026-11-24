import { useCallback } from 'react';
import {
  extractTextFromMineruBlock,
} from '../../../services/mineru';
import type {
  PaperAnnotation,
  TextSelectionPayload,
  TextSelectionSource,
} from '../../../types/reader';
import {
  isEditableTarget,
  normalizeSelectedText,
} from '../documentReaderShared';



import type { ReaderTabState } from './readerTabContext';
import type { ReaderDocumentApi } from './useReaderDocument';
import type { ReaderNotesApi } from './useReaderNotes';

export function useReaderAnnotations(state: ReaderTabState, documentApi: ReaderDocumentApi, notesApi: ReaderNotesApi) {
  const { annotations, autoTranslatedSelectionKeyRef, flatBlocks, isActive, lRef, lastCapturedSelectionRef, notes, selectedExcerpt, setActivePdfHighlight, setAnnotations, setPdfHighlightSignal, setQaInput, setSelectedAnnotationId, setSelectedExcerpt, setStatusMessage, settings, translationConfigured } = state;
  const { activateBlock, activeBlock, blockById, clearSelection, createSelectionHighlightTarget, handleTranslateSelectedExcerpt, resetSelectedExcerptTranslationState, selectedExcerptTranslation } = documentApi;
  const { handleJumpToNote, handleJumpToNoteAnchor } = notesApi;

  const handleTextSelect = useCallback((selection: TextSelectionPayload, source: TextSelectionSource) => {
      if (!settings.enableSelectionTranslation) {
        return;
      }

      const normalizedText = normalizeSelectedText(selection.text);

      if (!normalizedText) {
        return;
      }

      const now = Date.now();
      const lastCapturedSelection = lastCapturedSelectionRef.current;

      if (
        lastCapturedSelection &&
        lastCapturedSelection.source === source &&
        lastCapturedSelection.text === normalizedText &&
        now - lastCapturedSelection.capturedAt < 250
      ) {
        return;
      }

      lastCapturedSelectionRef.current = {
        source,
        text: normalizedText,
        capturedAt: now,
      };

      const anchorClientRect =
        selection.anchorClientRect &&
        Number.isFinite(selection.anchorClientRect.left) &&
        Number.isFinite(selection.anchorClientRect.top) &&
        Number.isFinite(selection.anchorClientRect.width) &&
        Number.isFinite(selection.anchorClientRect.height)
          ? selection.anchorClientRect
          : undefined;
      const fallbackAnchorClientX =
        anchorClientRect
          ? anchorClientRect.left + anchorClientRect.width / 2
          : window.innerWidth / 2;
      const fallbackAnchorClientY =
        anchorClientRect
          ? selection.placement === 'top'
            ? anchorClientRect.top
            : anchorClientRect.top + anchorClientRect.height
          : window.innerHeight / 2;

      setSelectedExcerpt({
        text: normalizedText,
        source,
        blockId: selection.blockId,
        createdAt: Date.now(),
        anchorClientX: Number.isFinite(selection.anchorClientX)
          ? selection.anchorClientX
          : fallbackAnchorClientX,
        anchorClientY: Number.isFinite(selection.anchorClientY)
          ? selection.anchorClientY
          : fallbackAnchorClientY,
        anchorClientRect,
        placement: selection.placement,
        pdfLocation: selection.pdfLocation,
      });
      resetSelectedExcerptTranslationState();
      setStatusMessage(
        source === 'pdf'
          ? lRef.current('已选中 PDF 划词', 'Selected text from the PDF')
          : lRef.current('已选中结构块文本', 'Selected text from the structured block'),
      );
    }, [resetSelectedExcerptTranslationState, settings.enableSelectionTranslation]);
  const handleAppendSelectedExcerptToQa = useCallback(() => {
      if (!selectedExcerpt) {
        return;
      }

      const excerptPrompt = lRef.current(
        `请结合这段划词内容回答：\n“${selectedExcerpt.text}”`,
        `Answer with this selected excerpt in mind:\n"${selectedExcerpt.text}"`,
      );

      setQaInput((current) => (current.trim() ? `${current}\n\n${excerptPrompt}` : excerptPrompt));
      setStatusMessage(lRef.current('已将划词内容加入问答输入框', 'Added the selected excerpt to the QA input'));
    }, [selectedExcerpt]);
  const handleClearSelectedExcerpt = useCallback(() => {
      lastCapturedSelectionRef.current = null;
      autoTranslatedSelectionKeyRef.current = '';
      setSelectedExcerpt(null);
      resetSelectedExcerptTranslationState();
      setStatusMessage(lRef.current('已清除划词内容', 'Cleared the selected excerpt'));
    }, [resetSelectedExcerptTranslationState]);
  const effect_196 = useCallback(() => {
    if (
      !selectedExcerpt ||
      !settings.highlightSelectionTranslation ||
      !selectedExcerptTranslation.trim()
    ) {
      return;
    }

    if (selectedExcerpt.source === 'pdf') {
      const highlightTarget = createSelectionHighlightTarget(selectedExcerpt);

      if (highlightTarget) {
        setActivePdfHighlight(highlightTarget);
        setPdfHighlightSignal((current) => current + 1);
      }

      return;
    }

    const targetBlock = selectedExcerpt.blockId
      ? blockById.get(selectedExcerpt.blockId) ?? null
      : null;

    if (targetBlock) {
      activateBlock(targetBlock, '', { syncPdfHighlight: true });
    }
  }, [
    activateBlock,
    blockById,
    createSelectionHighlightTarget,
    selectedExcerpt,
    selectedExcerptTranslation,
    settings.highlightSelectionTranslation,
  ]);
  const effect_197 = useCallback(() => {
    if (!selectedExcerpt) {
      return;
    }

    if (
      selectedExcerpt.origin === 'pdf-block'
        ? !settings.enablePdfParagraphTranslationPopover
        : !settings.enableSelectionTranslation
    ) {
      handleClearSelectedExcerpt();
    }
  }, [
    handleClearSelectedExcerpt,
    selectedExcerpt,
    settings.enablePdfParagraphTranslationPopover,
    settings.enableSelectionTranslation,
  ]);
  const handleCreateAnnotation = useCallback(
      (note: string) => {
        if (!activeBlock || !activeBlock.bbox) {
          setStatusMessage(lRef.current('请先选中一个可批注的结构块', 'Select an annotatable block first'));
          return;
        }

        const normalizedNote = note.trim();
        const quote =
          selectedExcerpt?.text.trim() || extractTextFromMineruBlock(activeBlock).slice(0, 240);

        if (!normalizedNote && !quote) {
          setStatusMessage(lRef.current('批注内容不能为空', 'The annotation content cannot be empty'));
          return;
        }

        const now = Date.now();
        const nextAnnotation: PaperAnnotation = {
          id: `annotation-${now}-${Math.random().toString(16).slice(2, 8)}`,
          blockId: activeBlock.blockId,
          blockType: activeBlock.type,
          pageIndex: activeBlock.pageIndex,
          bbox: activeBlock.bbox,
          bboxCoordinateSystem: activeBlock.bboxCoordinateSystem,
          bboxPageSize: activeBlock.bboxPageSize,
          note: normalizedNote,
          quote,
          createdAt: now,
          updatedAt: now,
        };

        setAnnotations((current) => [nextAnnotation, ...current]);
        setSelectedAnnotationId(nextAnnotation.id);
        setStatusMessage(
          lRef.current(
            `已创建批注并关联结构块 ${activeBlock.blockId}`,
            `Created an annotation linked to block ${activeBlock.blockId}`,
          ),
        );
      },
      [activeBlock, selectedExcerpt],
    );
  const handleDeleteAnnotation = useCallback((annotationId: string) => {
      setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
      setSelectedAnnotationId((current) => (current === annotationId ? null : current));
      setStatusMessage(lRef.current('已删除批注', 'Deleted the annotation'));
    }, []);
  const handleSelectAnnotation = useCallback(
      (annotationId: string) => {
        if (annotationId.startsWith('note-anchor:')) {
          const [, noteId, anchorId] = annotationId.split(':');
          const targetNote = notes.find((note) => note.id === noteId);
          const targetAnchor = targetNote?.anchors.find((anchor) => anchor.id === anchorId);

          if (!targetNote || !targetAnchor) {
            setStatusMessage(lRef.current('该 PDF 摘录已不存在', 'This PDF clip no longer exists'));
            return;
          }

          handleJumpToNoteAnchor(targetNote, targetAnchor);
          return;
        }

        if (annotationId.startsWith('note:')) {
          const noteId = annotationId.slice('note:'.length);
          const targetNote = notes.find((note) => note.id === noteId);

          if (!targetNote) {
            setStatusMessage(lRef.current('该 PDF 笔记已不存在', 'This PDF note no longer exists'));
            return;
          }

          handleJumpToNote(targetNote);
          return;
        }

        const targetAnnotation = annotations.find((annotation) => annotation.id === annotationId);

        if (!targetAnnotation) {
          return;
        }

        const targetBlock = flatBlocks.find((block) => block.blockId === targetAnnotation.blockId);

        if (!targetBlock) {
          setStatusMessage(lRef.current('该批注对应的结构块已不存在', 'The block linked to this annotation no longer exists'));
          return;
        }

        setSelectedAnnotationId(targetAnnotation.id);
        activateBlock(
          targetBlock,
          lRef.current(
            `已定位到批注 ${targetAnnotation.blockId}`,
            `Focused annotation ${targetAnnotation.blockId}`,
          ),
        );
      },
      [activateBlock, annotations, flatBlocks, handleJumpToNote, handleJumpToNoteAnchor, notes],
    );
  const effect_269 = useCallback(() => {
    if (
      !selectedExcerpt ||
      selectedExcerpt.origin === 'pdf-block' ||
      !translationConfigured ||
      !settings.enableSelectionTranslation ||
      !settings.autoTranslateSelection
    ) {
      return;
    }

    const autoTranslatedSelectionKey = `${selectedExcerpt.createdAt}:${selectedExcerpt.source}:${selectedExcerpt.text}`;

    if (autoTranslatedSelectionKeyRef.current === autoTranslatedSelectionKey) {
      return;
    }

    autoTranslatedSelectionKeyRef.current = autoTranslatedSelectionKey;
    void handleTranslateSelectedExcerpt(false);
  }, [
    handleTranslateSelectedExcerpt,
    selectedExcerpt,
    settings.autoTranslateSelection,
    settings.enableSelectionTranslation,
    translationConfigured,
  ]);
  const effect_270 = useCallback(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        clearSelection();
        handleClearSelectedExcerpt();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, handleClearSelectedExcerpt, isActive]);

  return { effect_196, effect_197, effect_269, effect_270, handleAppendSelectedExcerptToQa, handleClearSelectedExcerpt, handleCreateAnnotation, handleDeleteAnnotation, handleSelectAnnotation, handleTextSelect };
}

export type ReaderAnnotationsApi = ReturnType<typeof useReaderAnnotations>;
