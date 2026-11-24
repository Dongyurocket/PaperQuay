import { useCallback, useMemo, useRef } from 'react';
import {
  createNote as createStoredNote,
  deleteNote as deleteStoredNote,
  listAllNotes,
  type NoteMutationOptions,
  updateNote as updateStoredNote,
} from '../../../services/notes';
import {
  emitJumpToNoteAnchor,
  NOTE_CHANGED_EVENT,
  type JumpToNoteAnchorEventDetail,
  type NoteChangedEventDetail,
} from '../../../app/appEvents';
import {
  listLocalZoteroRelatedNotes,
} from '../../../services/zotero';
import type {
  CreateNoteRequest,
  Note,
  NoteAnchor,
  UpdateNoteRequest,
} from '../../../types/notes';
import type {
  DocumentChatMessage,
  PositionedMineruBlock,
  SelectedExcerpt,
  TextSelectionPayload,
} from '../../../types/reader';
import {
  normalizeSelectedText,
} from '../documentReaderShared';
import {
  buildQuoteMarkdown as buildNoteQuoteMarkdown,
  createNoteAnchorFromSelection,
  titleFromText,
} from '../../notes/noteUtils';
import { isExcerptCard } from '../../notes/noteDistill';
import { noteAnchorDisplayText, noteDisplayTitle } from '../../notes/notesDisplay';
import { noteErrorMessage } from '../../notes/notesText';
import { distillExcerpt, reidentifyExcerptImage } from '../../../services/noteDistill';
import {
  buildDistillPreviewCommit,
  cancelDistillPreview,
  confirmDistillPreview,
  createDistillPreviewState,
  markDistillPreviewProcessing,
  markDistillPreviewReady,
} from '../../notes/noteDistillPreview';
import { getPdfBlockCropDataUrl } from '../../pdf/pdfBlockCrop';
import { loadQaModelPreset } from '../../../services/modelPresets';
import { buildQaNoteContent } from '../readerQaNote';
import {
  buildPendingNoteAnchorInsert,
  buildNoteAnchorJumpDetail,
  buildNotePdfHighlightTarget,
  buildSelectedExcerptNoteCreateRequest,
  isNoteEventRecord,
  resolveNoteAnchorJumpTarget,
  resolveAgentCitationJumpTarget,
  resolveReaderNoteAnchorTarget,
  resolveNoteAnchorWorkspaceId,
  sortReaderNotes,
} from '../documentReaderNotes';



import type { ReaderTabState } from './readerTabContext';
import type { ReaderDocumentApi } from './useReaderDocument';

export function useReaderNotes(state: ReaderTabState, documentApi: ReaderDocumentApi) {
  const { activeNoteId, activeQaSession, currentDocument, distillPreview, distillPreviewAppendTarget, distillVisionAvailable, flatBlocks, lRef, locale, notes, onPendingNoteAnchorJumpHandled, pdfOpenFailed, pdfSource, pendingBlockAnchorJump, pendingNoteAnchorJump, qaSessions, readerNoteEditorSourceId, restoringDocumentBlocks, selectedExcerpt, selectedQaSessionId, selectionDistilling, setActiveBlockId, setActiveNoteId, setActivePdfHighlight, setAssistantActivePanel, setDistillPreview, setDistillPreviewAppendTarget, setDistillVisionAvailable, setDistillVisionBusy, setHoveredBlockId, setNotes, setNotesError, setNotesLoading, setNotesSaving, setPdfHighlightSignal, setPendingBlockAnchorJump, setPendingNoteAnchorInsert, setReaderNoteExternalUpdate, setSelectedAnnotationId, setSelectedExcerpt, setSelectionDistilling, setStatusMessage, setWorkspaceStage, setZoteroRelatedNotes, setZoteroRelatedNotesError, setZoteroRelatedNotesLoading, zoteroLocalDataDir } = state;
  const { activateBlock, blockById, pdfDocumentError, pdfPageCount, resetSelectedExcerptTranslationState } = documentApi;

  // 连续刷新（NOTE_CHANGED 事件可能连发）时丢弃旧请求的晚到分页结果。
  const notesReloadGenerationRef = useRef(0);

  const reloadNotes = useCallback(async () => {
      const generation = notesReloadGenerationRef.current + 1;
      notesReloadGenerationRef.current = generation;
      setNotesLoading(true);
      setNotesError('');

      try {
        // 不再静默截断到 1000 条：按 notes_list 的分页一直取到短页。
        const nextNotes = await listAllNotes({}, {
          onPage: (_page, accumulated) => {
            if (notesReloadGenerationRef.current !== generation) return;
            setNotes(accumulated);
          },
        });
        if (notesReloadGenerationRef.current !== generation) return;

        setNotes(nextNotes);
        setReaderNoteExternalUpdate((current) =>
          current && nextNotes.some((note) => note.id === current.id) ? current : null,
        );
        setActiveNoteId((current) =>
          current && nextNotes.some((note) => note.id === current)
            ? current
            : nextNotes[0]?.id ?? null,
        );
      } catch (nextError) {
        if (notesReloadGenerationRef.current !== generation) return;
        setNotes([]);
        setActiveNoteId(null);
        setNotesError(
          nextError instanceof Error
            ? nextError.message
            : lRef.current('加载笔记失败', 'Failed to load notes'),
        );
      } finally {
        if (notesReloadGenerationRef.current === generation) setNotesLoading(false);
      }
    }, [setActiveNoteId, setNotes, setNotesError, setNotesLoading]);
  const handleSelectNote = useCallback((note: Note) => {
      setActiveNoteId(note.id);
      setAssistantActivePanel('notes');
    }, []);
  const handleJumpToNote = useCallback((note: Note) => {
      setActiveNoteId(note.id);
      setSelectedAnnotationId(null);
      setWorkspaceStage('reading');
      setAssistantActivePanel('notes');

      if (note.paperId && note.paperId !== currentDocument.workspaceId) {
        setStatusMessage(lRef.current('该笔记属于其他文献，请先打开对应文献', 'This note belongs to another paper. Open that paper first.'));
        return;
      }

      const highlightTarget = buildNotePdfHighlightTarget(note);

      if (!highlightTarget) {
        setStatusMessage(lRef.current('该笔记没有绑定 PDF 位置', 'This note is not linked to a PDF location'));
        return;
      }

      setActivePdfHighlight(highlightTarget);
      setPdfHighlightSignal((current) => current + 1);
      setStatusMessage(
        lRef.current(
          `已定位到笔记：${noteDisplayTitle(note.title, lRef.current)}`,
          `Located note: ${noteDisplayTitle(note.title, lRef.current)}`,
        ),
      );
    }, [currentDocument.workspaceId, setActiveNoteId, setAssistantActivePanel]);
  const applyNoteAnchorJump = useCallback((detail: JumpToNoteAnchorEventDetail) => {
      const agentRagJump = detail.jumpSource === 'agent-rag';
      const label = detail.anchorLabel
        ? noteAnchorDisplayText(detail.anchorLabel, lRef.current)
        : detail.noteTitle
          ? noteDisplayTitle(detail.noteTitle, lRef.current)
          : lRef.current('未命名引用', 'Untitled reference');
      if (agentRagJump && pdfPageCount === 0) return false;
      if (agentRagJump && detail.blockId && restoringDocumentBlocks) return false;
      // Agent citations require the original block; unrelated same-page blocks are only a page fallback.
      const target = agentRagJump
        ? resolveAgentCitationJumpTarget(detail, flatBlocks, pdfPageCount)
        : resolveNoteAnchorJumpTarget(detail, flatBlocks);
      const { block: targetBlock, highlightTarget, shouldWaitForBlocks } = target;

      if ('invalidPage' in target && target.invalidPage) {
        setStatusMessage(lRef.current('引用页码超出当前 PDF 范围，无法定位片段', 'The reference page is outside this PDF; the excerpt could not be located'));
        return true;
      }

      if (!targetBlock && !highlightTarget) {
        // 有 blockId 说明该文献确有结构块，可能还没加载完成：挂起等待，flatBlocks 到位后自动重放。
        if (shouldWaitForBlocks) {
          setPendingBlockAnchorJump(detail);
          return false;
        }

        setStatusMessage(lRef.current('已打开文献，该引用缺少可用位置，无法定位片段', 'Paper opened; this reference has no usable location for the excerpt'));
        return agentRagJump;
      }

      setSelectedAnnotationId(null);
      setWorkspaceStage('reading');
      setPendingBlockAnchorJump((current) =>
        current?.requestId === detail.requestId ? null : current,
      );

      if (!agentRagJump) {
        setActiveNoteId(detail.noteId);
        setAssistantActivePanel('notes');
      }

      if (targetBlock) {
        activateBlock(
          targetBlock,
          lRef.current(`已定位到引用：${label}`, `Located reference: ${label}`),
        );
        if (agentRagJump && !targetBlock.bbox && highlightTarget) {
          setActivePdfHighlight(highlightTarget);
          setPdfHighlightSignal((current) => current + 1);
        }
        return true;
      }

      setActivePdfHighlight(highlightTarget);
      if (agentRagJump) {
        setActiveBlockId(null);
        setHoveredBlockId(null);
      }
      setPdfHighlightSignal((current) => current + 1);
      setStatusMessage(
        lRef.current(
          agentRagJump ? `已定位到页面，原片段暂不可定位：${label}` : `已定位到引用：${label}`,
          agentRagJump ? `Located page; the original excerpt is unavailable: ${label}` : `Located reference: ${label}`,
        ),
      );
      return true;
    }, [activateBlock, flatBlocks, pdfPageCount, restoringDocumentBlocks, setActiveNoteId, setAssistantActivePanel]);
  const handleJumpToNoteAnchor = useCallback((note: Note, anchor: NoteAnchor) => {
      const targetWorkspaceId = resolveNoteAnchorWorkspaceId(note, anchor);
      const detail = buildNoteAnchorJumpDetail(note, anchor);

      if (targetWorkspaceId && targetWorkspaceId !== currentDocument.workspaceId) {
        setActiveNoteId(note.id);
        setAssistantActivePanel('notes');
        emitJumpToNoteAnchor(detail);
        return;
      }

      applyNoteAnchorJump(detail);
    }, [applyNoteAnchorJump, currentDocument.workspaceId, setActiveNoteId, setAssistantActivePanel]);
  const handleCreateNote = useCallback(
      async (request: CreateNoteRequest) => {
        setNotesSaving(true);
        setNotesError('');

        try {
          const created = await createStoredNote(
            {
              ...request,
              paperId: request.paperId || currentDocument.workspaceId,
            },
            { sourceId: readerNoteEditorSourceId },
          );

          setNotes((current) => [created, ...current.filter((note) => note.id !== created.id)]);
          setReaderNoteExternalUpdate((current) => (current?.id === created.id ? null : current));
          setActiveNoteId(created.id);
          setAssistantActivePanel('notes');
          setStatusMessage(lRef.current('已创建笔记', 'Created note'));
          return created;
        } catch (nextError) {
          setNotesError(
            nextError instanceof Error
              ? nextError.message
              : lRef.current('创建笔记失败', 'Failed to create note'),
          );
          return null;
        } finally {
          setNotesSaving(false);
        }
      },
      [currentDocument.workspaceId, readerNoteEditorSourceId],
    );
  const handleCreateStandaloneNote = useCallback(() => {
      void handleCreateNote({
        paperId: currentDocument.workspaceId,
        type: 'standalone',
        title: lRef.current('新的阅读笔记', 'New Reading Note'),
        content: '',
        tags: [],
        color: '#f3f4f6',
      });
    }, [currentDocument.workspaceId, handleCreateNote]);
  const handleUpdateNote = useCallback(async (
      noteId: string,
      patch: UpdateNoteRequest,
      options: NoteMutationOptions = {},
    ) => {
      setNotesSaving(true);
      setNotesError('');
      let savedNote: Note | undefined;

      try {
        const updated = await updateStoredNote(noteId, patch, {
          ...options,
          sourceId: options.sourceId ?? readerNoteEditorSourceId,
        });
        savedNote = updated;

        setNotes((current) =>
          sortReaderNotes(current.map((note) => (note.id === updated.id ? updated : note))),
        );
        setReaderNoteExternalUpdate((current) => (current?.id === updated.id ? null : current));
        setStatusMessage(lRef.current('已保存笔记', 'Saved note'));
      } catch (nextError) {
        setNotesError(
          nextError instanceof Error
            ? nextError.message
            : lRef.current('保存笔记失败', 'Failed to save note'),
        );
        if (options.expectedUpdatedAt !== undefined) throw nextError;
      } finally {
        setNotesSaving(false);
      }
      return savedNote;
    }, [readerNoteEditorSourceId]);
  const handleAddSelectionToNote = useCallback(async (excerptOverride?: SelectedExcerpt) => {
      const excerpt = excerptOverride ?? selectedExcerpt;

      if (!excerpt?.text.trim()) {
        setStatusMessage(lRef.current('请先在 PDF 或正文中划词', 'Select text in the PDF or document first'));
        return;
      }

      const anchor = createNoteAnchorFromSelection(excerpt, currentDocument.workspaceId, currentDocument.title);
      let targetNote = resolveReaderNoteAnchorTarget(notes, activeNoteId);

      if (!targetNote) {
        targetNote = await handleCreateNote(
          buildSelectedExcerptNoteCreateRequest({
            paperId: currentDocument.workspaceId,
            selectedExcerpt: excerpt,
            title: titleFromText(excerpt.text, lRef.current('新的阅读笔记', 'New Reading Note')),
          }),
        );

        if (!targetNote) {
          return;
        }
      }

      setActiveNoteId(targetNote.id);
      setAssistantActivePanel('notes');
      setPendingNoteAnchorInsert(buildPendingNoteAnchorInsert(targetNote.id, anchor));
      setStatusMessage(lRef.current('已插入当前笔记，保存后同步定位', 'Inserted into the current note. Save to sync the reference.'));
    }, [
      activeNoteId,
      currentDocument.title,
      currentDocument.workspaceId,
      handleCreateNote,
      notes,
      selectedExcerpt,
      setActiveNoteId,
      setAssistantActivePanel,
    ]);
  const activeExcerptCard = (() => {
      const target = resolveReaderNoteAnchorTarget(notes, activeNoteId);
      return isExcerptCard(target) ? target : null;
    })();
  const handleDistillSelectionToNote = useCallback(async (options?: {
      excerpt?: SelectedExcerpt;
      appendToActiveCard?: boolean;
    }) => {
      const excerpt = options?.excerpt ?? selectedExcerpt;

      if (!excerpt?.text.trim()) {
        setStatusMessage(lRef.current('请先在 PDF 或正文中划词', 'Select text in the PDF or document first'));
        return;
      }
      const appendTarget = options?.appendToActiveCard
        ? (() => {
            const target = resolveReaderNoteAnchorTarget(notes, activeNoteId);
            return isExcerptCard(target) ? target : null;
          })()
        : null;
      if (selectionDistilling || distillPreview) return;
      setDistillPreviewAppendTarget(appendTarget);
      setDistillPreview(createDistillPreviewState({ selectedExcerpt: excerpt, appendTarget }));
      try {
        const model = await loadQaModelPreset();
        setDistillVisionAvailable(model?.supportsVision === true);
      } catch {
        setDistillVisionAvailable(false);
      }
    }, [
      activeNoteId,
      currentDocument.title,
      currentDocument.workspaceId,
      handleCreateNote,
      handleUpdateNote,
      notes,
      selectedExcerpt,
      selectionDistilling,
      distillPreview,
    ]);
  const distillPreviewBlock = useMemo(
      () => (distillPreview?.selectedExcerpt.blockId ? blockById.get(distillPreview.selectedExcerpt.blockId) ?? null : null),
      [blockById, distillPreview],
    );
  const canReidentifyDistillPreview = Boolean(
      distillPreview &&
        distillVisionAvailable &&
        pdfSource &&
        distillPreviewBlock?.bbox &&
        distillPreviewBlock.bbox.length >= 4,
    );
  const handleGenerateDistillPreview = useCallback(async () => {
      if (!distillPreview || selectionDistilling) return;
      setSelectionDistilling(true);
      setDistillPreview(markDistillPreviewProcessing(distillPreview));
      try {
        const sourceText = distillPreview.aiEnhanced
          ? distillPreview.sourceText
          : distillPreview.originalText;
        const anchor = createNoteAnchorFromSelection(
          { ...distillPreview.selectedExcerpt, text: sourceText },
          currentDocument.workspaceId,
          currentDocument.title,
        );
        const distilled = await distillExcerpt({
          text: sourceText,
          paperTitle: currentDocument.title,
          pageLabel: anchor.label,
        });
        setDistillPreview((current) =>
          current
            ? markDistillPreviewReady(current, {
                title: distilled.title,
                text: distilled.text,
                sourceText,
                aiEnhanced: current.aiEnhanced,
              })
            : current,
        );
      } catch (error) {
        // 提炼错误已带稳定码，界面只显示双语映射，不回显后端原始 message。
        setStatusMessage(noteErrorMessage(error, lRef.current));
        setDistillPreview((current) => (current ? { ...current, phase: 'ready' } : current));
      } finally {
        setSelectionDistilling(false);
      }
    }, [currentDocument.title, currentDocument.workspaceId, distillPreview, selectionDistilling]);
  const handleReidentifyDistillPreview = useCallback(async () => {
      if (!distillPreview || !canReidentifyDistillPreview || !pdfSource || !distillPreviewBlock) return;
      setDistillVisionBusy(true);
      try {
        const imageDataUrl = await getPdfBlockCropDataUrl(pdfSource, distillPreviewBlock);
        if (!imageDataUrl) throw new Error('无法生成选区 PDF 切片。');
        const result = await reidentifyExcerptImage({
          text: distillPreview.originalText,
          imageDataUrl,
        });
        if (!result.reparsedText.trim()) throw new Error('视觉模型未返回可用的重识别内容。');
        setDistillPreview((current) => (current
          ? {
              ...current,
              sourceText: result.reparsedText,
              reidentifyRequested: true,
              aiEnhanced: true,
              fallbackNotice: null,
            }
          : current));
        setStatusMessage(lRef.current('已完成重识别，请生成提炼稿预览', 'Re-recognition finished. Generate the draft preview.'));
      } catch (error) {
        setDistillPreview((current) => (current
          ? {
              ...current,
              sourceText: current.originalText,
              reidentifyRequested: false,
              aiEnhanced: false,
              fallbackNotice: lRef.current(
                `重识别失败，已回退纯文本提炼：${noteErrorMessage(error, lRef.current)}`,
                `Re-recognition failed; fell back to text-only distillation: ${noteErrorMessage(error, lRef.current)}`,
              ),
            }
          : current));
        setSelectionDistilling(true);
        try {
          const fallbackAnchor = createNoteAnchorFromSelection(
            { ...distillPreview.selectedExcerpt, text: distillPreview.originalText },
            currentDocument.workspaceId,
            currentDocument.title,
          );
          const fallback = await distillExcerpt({
            text: distillPreview.originalText,
            paperTitle: currentDocument.title,
            pageLabel: fallbackAnchor.label,
          });
          setDistillPreview((current) =>
            current
              ? markDistillPreviewReady(current, {
                  title: fallback.title,
                  text: fallback.text,
                  sourceText: current.originalText,
                  aiEnhanced: false,
                  fallbackNotice: lRef.current(
                    '重识别失败，已自动回退纯文本提炼。',
                    'Re-recognition failed; automatically fell back to text-only distillation.',
                  ),
                })
              : current,
          );
        } catch (fallbackError) {
          setStatusMessage(noteErrorMessage(fallbackError, lRef.current));
        } finally {
          setSelectionDistilling(false);
        }
      } finally {
        setDistillVisionBusy(false);
      }
    }, [
      canReidentifyDistillPreview,
      currentDocument.title,
      currentDocument.workspaceId,
      distillPreview,
      distillPreviewBlock,
      pdfSource,
    ]);
  const commitDistillPreview = useCallback(async (direct = false) => {
      if (!distillPreview || !distillPreview.distilledText.trim()) return;
      const committed = buildDistillPreviewCommit({
        state: distillPreview,
        paperId: currentDocument.workspaceId,
        sourceTitle: currentDocument.title,
        appendTarget: distillPreviewAppendTarget,
        locale,
      });
      if (!committed) return;

      if (committed.kind === 'append') {
        await handleUpdateNote(committed.noteId, committed.patch);
        setStatusMessage(lRef.current('已追加提炼到当前摘录卡', 'Appended the distilled excerpt to the current card'));
      } else {
        const created = await handleCreateNote(committed.request);
        if (created) setStatusMessage(lRef.current('已生成提炼式摘录卡', 'Created a distilled excerpt card'));
      }
      setDistillPreview((current) => (current ? (direct ? confirmDistillPreview(current) : confirmDistillPreview(current)) : current));
      setDistillPreview(null);
      setDistillPreviewAppendTarget(null);
    }, [currentDocument.title, currentDocument.workspaceId, distillPreview, distillPreviewAppendTarget, handleCreateNote, handleUpdateNote, locale]);
  const handleCancelDistillPreview = useCallback(() => {
      setDistillPreview((current) => (current ? cancelDistillPreview(current) : current));
      setDistillPreview(null);
      setDistillPreviewAppendTarget(null);
      setStatusMessage(lRef.current('已取消提炼，未写入笔记', 'Distillation cancelled; no note was written'));
    }, []);
  const handleAddBlockToNote = useCallback(
      (block: PositionedMineruBlock, selection: TextSelectionPayload) => {
        const normalizedText = normalizeSelectedText(selection.text);

        if (!normalizedText) {
          setStatusMessage(lRef.current('当前结构块没有可引用文本', 'This block has no text to cite.'));
          return;
        }

        const blockPdfLocation =
          selection.pdfLocation ??
          (block.bbox
            ? {
                pageNumber: block.pageIndex + 1,
                bbox: block.bbox,
                bboxCoordinateSystem: block.bboxCoordinateSystem,
                bboxPageSize: block.bboxPageSize,
              }
            : undefined);

        const nextExcerpt: SelectedExcerpt = {
          text: normalizedText,
          source: 'blocks',
          origin: 'pdf-block',
          blockId: selection.blockId ?? block.blockId,
          createdAt: Date.now(),
          anchorClientX: selection.anchorClientX,
          anchorClientY: selection.anchorClientY,
          anchorClientRect: selection.anchorClientRect,
          placement: selection.placement,
          pdfLocation: blockPdfLocation,
        };

        setSelectedExcerpt(nextExcerpt);
        resetSelectedExcerptTranslationState();
        void handleAddSelectionToNote(nextExcerpt);
      },
      [handleAddSelectionToNote, resetSelectedExcerptTranslationState],
    );
  const handlePendingNoteAnchorInsertHandled = useCallback((requestId: string) => {
      setPendingNoteAnchorInsert((current) =>
        current?.requestId === requestId ? null : current,
      );
    }, []);
  const handleDeleteNote = useCallback(async (noteId: string) => {
      setNotesSaving(true);
      setNotesError('');

      try {
        await deleteStoredNote(noteId, { sourceId: readerNoteEditorSourceId });
        setReaderNoteExternalUpdate((current) => (current?.id === noteId ? null : current));
        setNotes((current) => {
          const nextNotes = current.filter((note) => note.id !== noteId);
          setActiveNoteId((activeId) => (activeId === noteId ? nextNotes[0]?.id ?? null : activeId));
          return nextNotes;
        });
        setStatusMessage(lRef.current('已删除笔记', 'Deleted note'));
      } catch (nextError) {
        setNotesError(
          nextError instanceof Error
            ? nextError.message
            : lRef.current('删除笔记失败', 'Failed to delete note'),
        );
      } finally {
        setNotesSaving(false);
      }
    }, [readerNoteEditorSourceId]);
  const handleReaderNoteExternalUpdateApply = useCallback((note: Note) => {
      setReaderNoteExternalUpdate((current) => (current?.id === note.id ? null : current));
      setNotes((current) => {
        const exists = current.some((item) => item.id === note.id);
        const nextNotes = exists
          ? current.map((item) => (item.id === note.id ? note : item))
          : [note, ...current];

        return sortReaderNotes(nextNotes);
      });
      setActiveNoteId((current) => current ?? note.id);
    }, [setActiveNoteId, setNotes]);
  const handleSaveAssistantMessageAsNote = useCallback(
      (message: DocumentChatMessage) => {
        const session =
          qaSessions.find((item) => item.messages.some((sessionMessage) => sessionMessage.id === message.id)) ??
          activeQaSession;
        const messageIndex = session?.messages.findIndex((sessionMessage) => sessionMessage.id === message.id) ?? -1;
        const question =
          messageIndex >= 0
            ? [...(session?.messages.slice(0, messageIndex) ?? [])]
                .reverse()
                .find((sessionMessage) => sessionMessage.role === 'user' && sessionMessage.content.trim())
                ?.content.trim() ?? ''
            : '';
        const answer = message.content.trim();

        if (!answer) {
          setStatusMessage(lRef.current('这条 AI 回复还没有可保存的内容', 'This AI reply has no content to save yet'));
          return;
        }

        const content = [
          question ? `## Question\n\n${buildNoteQuoteMarkdown(question)}` : '',
          `## Answer\n\n${answer}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        const noteContent = buildQaNoteContent({
          content,
          citations: message.citations ?? [],
          paperId: currentDocument.workspaceId,
          paperTitle: currentDocument.title,
          messageId: message.id,
          createdAt: message.createdAt,
        });

        void handleCreateNote({
          paperId: currentDocument.workspaceId,
          type: 'ai-chat',
          title: titleFromText(question || answer, lRef.current('AI 对话笔记', 'AI Chat Note')),
          content: noteContent.content,
          contentJson: noteContent.contentJson,
          anchors: noteContent.anchors,
          excerpt: question || undefined,
          aiChatId: session?.id ?? selectedQaSessionId,
          aiChatMessageIds: [message.id],
          tags: ['AI'],
          color: '#dbeafe',
        });
      },
      [
        activeQaSession,
        currentDocument.workspaceId,
        currentDocument.title,
        handleCreateNote,
        qaSessions,
        selectedQaSessionId,
      ],
    );
  const effect_247 = useCallback(() => {
    if (currentDocument.source !== 'zotero-local' || !currentDocument.itemKey.trim()) {
      setZoteroRelatedNotes([]);
      setZoteroRelatedNotesLoading(false);
      setZoteroRelatedNotesError('');
      return;
    }

    if (!zoteroLocalDataDir.trim()) {
      setZoteroRelatedNotes([]);
      setZoteroRelatedNotesLoading(false);
      setZoteroRelatedNotesError('');
      return;
    }

    let cancelled = false;

    setZoteroRelatedNotesLoading(true);
    setZoteroRelatedNotesError('');

    void listLocalZoteroRelatedNotes({
      dataDir: zoteroLocalDataDir.trim(),
      itemKey: currentDocument.itemKey,
    })
      .then((notes) => {
        if (cancelled) {
          return;
        }

        setZoteroRelatedNotes(notes);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setZoteroRelatedNotes([]);
        setZoteroRelatedNotesError(
          nextError instanceof Error
            ? nextError.message
            : lRef.current('加载 Zotero 关联笔记失败', 'Failed to load Zotero related notes'),
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setZoteroRelatedNotesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument.itemKey, currentDocument.source, zoteroLocalDataDir]);
  const effect_248 = useCallback(() => {
    void reloadNotes();
  }, [reloadNotes]);
  const effect_249 = useCallback(() => {
    const handleNoteChanged = (event: Event) => {
      const detail = (event as CustomEvent<NoteChangedEventDetail>).detail;
      if (!detail?.noteId) return;

      if (detail.action === 'deleted') {
        setReaderNoteExternalUpdate((current) => (current?.id === detail.noteId ? null : current));
        setNotes((current) => {
          const nextNotes = current.filter((note) => note.id !== detail.noteId);
          setActiveNoteId((activeId) => (activeId === detail.noteId ? nextNotes[0]?.id ?? null : activeId));
          return nextNotes;
        });
        return;
      }

      if (!isNoteEventRecord(detail.note)) {
        void reloadNotes();
        return;
      }

      const nextNote = detail.note;
      const fromThisReaderSidebar = detail.sourceId === readerNoteEditorSourceId;
      const isCurrentEditorNote = activeNoteId === nextNote.id;

      if (isCurrentEditorNote && !fromThisReaderSidebar) {
        setReaderNoteExternalUpdate(nextNote);
        return;
      }

      if (fromThisReaderSidebar) {
        setReaderNoteExternalUpdate((current) => (current?.id === nextNote.id ? null : current));
      }

      setNotes((current) => {
        const exists = current.some((note) => note.id === nextNote.id);
        const nextNotes = exists
          ? current.map((note) => (note.id === nextNote.id ? nextNote : note))
          : [nextNote, ...current];

        return sortReaderNotes(nextNotes);
      });
      setActiveNoteId((current) => current ?? nextNote.id);
    };

    window.addEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
    return () => window.removeEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
  }, [activeNoteId, readerNoteEditorSourceId, reloadNotes, setActiveNoteId, setNotes]);
  const effect_250 = useCallback(() => {
    if (!pendingNoteAnchorJump) {
      return;
    }

    const targetWorkspaceId = (
      pendingNoteAnchorJump.targetPaperId ||
      pendingNoteAnchorJump.anchorPaperId ||
      pendingNoteAnchorJump.notePaperId ||
      ''
    ).trim();

    if (targetWorkspaceId && targetWorkspaceId !== currentDocument.workspaceId) {
      return;
    }

    if (pendingNoteAnchorJump.jumpSource === 'agent-rag' && (pdfOpenFailed || pdfDocumentError)) {
      setStatusMessage(lRef.current('引用 PDF 不可用，无法定位片段；请检查附件后重试', 'The reference PDF is unavailable; check the attachment and retry'));
      onPendingNoteAnchorJumpHandled?.(pendingNoteAnchorJump.requestId);
      return;
    }

    if (!pdfSource) {
      return;
    }

    if (applyNoteAnchorJump(pendingNoteAnchorJump)) {
      onPendingNoteAnchorJumpHandled?.(pendingNoteAnchorJump.requestId);
    }
  }, [
    applyNoteAnchorJump,
    currentDocument.workspaceId,
    onPendingNoteAnchorJumpHandled,
    pdfDocumentError,
    pdfOpenFailed,
    pdfSource,
    pendingNoteAnchorJump,
  ]);
  const effect_251 = useCallback(() => {
    if (!pendingBlockAnchorJump || flatBlocks.length === 0) {
      return;
    }

    if (applyNoteAnchorJump(pendingBlockAnchorJump)) {
      onPendingNoteAnchorJumpHandled?.(pendingBlockAnchorJump.requestId);
    }
  }, [
    applyNoteAnchorJump,
    flatBlocks.length,
    onPendingNoteAnchorJumpHandled,
    pendingBlockAnchorJump,
  ]);

  return { activeExcerptCard, applyNoteAnchorJump, canReidentifyDistillPreview, commitDistillPreview, distillPreviewBlock, effect_247, effect_248, effect_249, effect_250, effect_251, handleAddBlockToNote, handleAddSelectionToNote, handleCancelDistillPreview, handleCreateNote, handleCreateStandaloneNote, handleDeleteNote, handleDistillSelectionToNote, handleGenerateDistillPreview, handleJumpToNote, handleJumpToNoteAnchor, handlePendingNoteAnchorInsertHandled, handleReaderNoteExternalUpdateApply, handleReidentifyDistillPreview, handleSaveAssistantMessageAsNote, handleSelectNote, handleUpdateNote, reloadNotes };
}

export type ReaderNotesApi = ReturnType<typeof useReaderNotes>;
