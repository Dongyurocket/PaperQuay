import { useCallback, useMemo, useState } from 'react';
import {
  captureSystemScreenshot,
  readLocalBinaryFile,
  selectChatAttachmentPaths,
} from '../../../services/desktop';
import {
  type NoteMutationOptions,
} from '../../../services/notes';
import { estimateRagTokens, trimDocumentTextToTokenBudget } from '../readerRag';
import { createPdfTextCache } from '../pdfTextCache';
import { askDocumentOpenAICompatibleStream } from '../../../services/qa';
import {
  resolveLocalRag,
  resolveScopedLocalRag,
  type ScopedRagDocument,
} from '../../../services/localRag';
import { buildMineruMarkdownDocument, extractPdfTextByPdfJs } from '../../../services/summarySource';
import type {
  UpdateNoteRequest,
} from '../../../types/notes';
import type {
  DocumentChatCitation,
  DocumentChatMessage,
  DocumentChatSession,
  ReaderQaScopeMode,
  RagChunkContextSlice,
} from '../../../types/reader';
import {
  loadPaperHistory,
} from '../../../utils/paperHistory';
import {
  buildAttachmentFromPath,
  buildQaSessionTitle,
  buildScreenshotAttachmentFromPath,
  createChatMessage,
  createQaSession,
  ReaderTabBridgeState,
  updateQaSession,
} from '../documentReaderShared';
import { appendUniqueChatAttachments } from '../documentReaderAttachments';
import {
  removeQaSession,
  removeFailedQaAssistantPlaceholder,
  resolveQaModelPreset,
  resolveQaSessionSelection,
} from '../documentReaderQaSessions';
import {
  createNativeLibraryWorkspaceItem,
  getModelRuntimeConfig,
} from '../readerShared';
import {
  buildScopedRagLibraryItems,
  describeScopedRagFailure,
  loadScopedRagDocuments,
} from '../readerQaScope';
import type { LocalRagResolution } from '../readerQaContext';
import { buildQaContext, formatQaContextStatus } from '../readerQaContext';
import { awaitQaRequest } from '../readerQaAbort';
import {
  getReaderQaTabSnapshot,
} from '../../../stores/useReaderQaStore';
import { isQaHistoryRestoreReady } from '../readerQaSessionLifecycle';
import {
  restorePaperQaHistory,
} from '../documentReaderHistory';
import {
  buildReaderAssistantSidebarProps,
  buildStreamedQaSession,
  readerQaStreamStore,
  resolveReaderQaStreamAbortCleanup,
} from '../readerAssistantSidebarProps';



import type { ReaderTabState } from './readerTabContext';
import type { ReaderDocumentApi } from './useReaderDocument';
import type { ReaderSummaryApi } from './useReaderSummary';
import type { ReaderNotesApi } from './useReaderNotes';
import type { ReaderAnnotationsApi } from './useReaderAnnotations';

export function useReaderQa(state: ReaderTabState, documentApi: ReaderDocumentApi, summaryApi: ReaderSummaryApi, notesApi: ReaderNotesApi, annotationsApi: ReaderAnnotationsApi) {
  const { activeNoteId, activeQaPreset, activeQaSession, aiConfigured, assistantActivePanel, capturingScreenshot, currentDocument, document, embeddingApiKey, flatBlocks, lRef, lastDocumentSignatureRef, libraryStorageDir, loadLibraryPreviewBlocks, localeRef, notePaperCandidates, notes, notesError, notesLoading, notesSaving, onBridgeStateChange, onNotePaperClick, onOpenPreferences, onQaActivePresetChange, pdfSource, pdfTextCacheRef, pendingNoteAnchorInsert, qaAbortControllersRef, qaAbortWorkspaceRef, qaAnswerRenderMode, qaAttachments, qaConfigured, qaError, qaHistoryExpectedRef, qaHistoryGenerationRef, qaHistoryReadyWorkspaceRef, qaInput, qaMessages, qaModelPresets, qaRagEnabled, qaReasoningEffort, qaRunningSessionIds, qaScopeDocumentsRef, qaScopeMode, qaScopePaperIds, qaScopeSessionIdRef, qaSessions, qaSessionsRef, readerLocaleText, readerNoteEditorSourceId, readerNoteExternalUpdate, screenshotBusy, selectedExcerpt, selectedQaPresetId, selectedQaPresetIdRef, selectedQaSessionId, selectedQaSessionIdRef, setAssistantActivePanel, setAssistantDetached, setCapturingScreenshot, setQaAnswerRenderMode, setQaAttachments, setQaError, setQaInput, setQaRagEnabled, setQaReasoningEffort, setQaRunningSessionIds, setQaScopeMode, setQaScopePaperIds, setQaSessions, setQaWorkspaceId, setSelectedQaPresetId, setSelectedQaSessionId, setStatusMessage, setWorkspaceStage, settings, statusMessage, tabId } = state;
  const { activateBlock, currentJsonName, currentPdfName, documentSource, handleCancelDocumentTranslation, handleClearTranslations, handleCloudParse, handleTranslateDocument, handleTranslateSelectedExcerpt, loadCachedPdfDocumentText, openDocumentItem, selectedExcerptError, selectedExcerptTranslating, selectedExcerptTranslation, summaryBlockInputs, translatedCount, translating } = documentApi;
  const { handleGeneratePaperSummary, loadMineruMarkdownForSummary } = summaryApi;
  const { handleAddSelectionToNote, handleCreateStandaloneNote, handleDeleteNote, handleJumpToNoteAnchor, handlePendingNoteAnchorInsertHandled, handleReaderNoteExternalUpdateApply, handleSaveAssistantMessageAsNote, handleSelectNote, handleUpdateNote } = notesApi;
  const { handleAppendSelectedExcerptToQa, handleClearSelectedExcerpt } = annotationsApi;

  const effect_116 = useCallback(() => {
    qaScopeDocumentsRef.current.clear();
  }, [currentDocument.workspaceId]);
  const effect_117 = useCallback(() => {
    if (!activeQaSession || qaScopeSessionIdRef.current === activeQaSession.id) return;
    qaScopeSessionIdRef.current = activeQaSession.id;
    setQaScopeMode(activeQaSession.ragScopeMode ?? 'current');
    setQaScopePaperIds(activeQaSession.ragScopePaperIds ?? []);
  }, [activeQaSession]);
  const updateQaScope = useCallback((mode: ReaderQaScopeMode, paperIds: string[]) => {
      setQaScopeMode(mode);
      setQaScopePaperIds(paperIds);
      const sessionId = qaScopeSessionIdRef.current;
      if (!sessionId) return;
      setQaSessions((current) => current.map((session) => (
        session.id === sessionId
          ? { ...session, ragScopeMode: mode, ragScopePaperIds: paperIds }
          : session
      )));
    }, [setQaSessions]);
  const qaScopePaperOptions = useMemo(
      () => notePaperCandidates
        .filter((paper) => paper.ragEnabled !== false)
        .map((paper) => ({ id: paper.id, title: paper.title })),
      [notePaperCandidates],
    );
  const selectedQaSessionLoading = Boolean(
      activeQaSession && qaRunningSessionIds.includes(activeQaSession.id),
    );
  qaSessionsRef.current = qaSessions;
  selectedQaSessionIdRef.current = selectedQaSessionId;
  selectedQaPresetIdRef.current = selectedQaPresetId;
  const resolveQaRequest = useCallback(async (question: string, options?: { tokenBudget?: number; signal?: AbortSignal }) => {
      const scopedQa = qaScopeMode !== 'current';
      let pdfDocumentText = '';
      let mineruDocumentText = '';

      if (settings.ragSourceMode === 'pdf-text' || settings.ragSourceMode === 'hybrid' || settings.qaSourceMode === 'pdf-text') {
        if (!pdfSource) {
          if (!scopedQa && settings.qaSourceMode === 'pdf-text') {
            throw new Error(
              lRef.current(
                '请先加载 PDF，或切换到 MinerU 内容问答。',
                'Load a PDF first, or switch back to MinerU-based QA.',
              ),
            );
          }
        } else {
          pdfDocumentText = await loadCachedPdfDocumentText().catch(() => '');

          if (!scopedQa && settings.qaSourceMode === 'pdf-text' && !pdfDocumentText.trim()) {
            throw new Error(
              lRef.current(
                '当前 PDF 未提取到可用文本，请改用 MinerU 内容问答，或确认 PDF 可被本地文本层读取。',
                'No usable text was extracted from the current PDF. Use MinerU-based QA instead, or confirm the local PDF text layer is readable.',
              ),
            );
          }
        }
      }

      if (settings.ragSourceMode === 'mineru-markdown' || settings.ragSourceMode === 'hybrid' || settings.qaSourceMode === 'mineru-markdown') {
        mineruDocumentText = await loadMineruMarkdownForSummary().catch(() => '');
      }

      if (!mineruDocumentText.trim() && flatBlocks.length > 0) {
        // Markdown 缓存缺失时用结构块重建，避免已有 MinerU JSON 却无法参与 RAG。
        mineruDocumentText = buildMineruMarkdownDocument(flatBlocks);
      }

      if (!scopedQa && settings.qaSourceMode === 'mineru-markdown' && !mineruDocumentText.trim() && summaryBlockInputs.length === 0) {
        throw new Error(
          lRef.current(
            '请先加载 MinerU JSON，再进行基于 MinerU 内容的文档问答。',
            'Load a MinerU JSON file before starting MinerU-based document QA.',
          ),
        );
      }

      const ragEnabledForQa =
        qaRagEnabled && settings.localRagEnabled && settings.ragSourceMode !== 'off';
      const embeddingConfigured = Boolean(
        embeddingApiKey.trim() &&
        settings.embeddingBaseUrl.trim() &&
        settings.embeddingModel.trim(),
      );
      const embedding = {
        baseUrl: settings.embeddingBaseUrl,
        apiKey: embeddingApiKey.trim(),
        model: settings.embeddingModel,
        dimensions: settings.embeddingDimensions,
        timeoutSeconds: settings.embeddingRequestTimeoutSeconds,
      };

      if (qaScopeMode !== 'current') {
        if (qaScopeMode === 'selected' && qaScopePaperIds.length === 0) {
          throw new Error(lRef.current(
            '请至少选择一篇文献，或切回当前文献范围。',
            'Select at least one paper, or switch back to the current paper scope.',
          ));
        }

        if (!ragEnabledForQa) {
          throw new Error(lRef.current(
            '选定文献 / 全库问答需要开启本地 RAG；请开启本地 RAG 后重试，或切回当前文献。',
            'Selected-paper and whole-library QA require local RAG. Turn it on and retry, or switch back to the current paper.',
          ));
        }

        if (!embeddingConfigured) {
          throw new Error(lRef.current(
            '选定文献 / 全库问答需要配置 Embedding 模型；请先在设置中完成配置，或切回当前文献。',
            'Selected-paper and whole-library QA require an embedding configuration. Configure it in Settings, or switch back to the current paper.',
          ));
        }

        const currentScopedDocument: ScopedRagDocument | undefined = currentDocument
          ? {
              item: currentDocument,
              mineruBlocks: flatBlocks,
              mineruDocumentText,
              pdfDocumentText,
            }
          : undefined;
        const { documents, missing } = qaScopeMode === 'selected'
          ? await loadScopedRagDocuments({
              papers: notePaperCandidates,
              paperIds: qaScopePaperIds,
              currentDocument: currentScopedDocument,
              storageDir: libraryStorageDir,
              ragSourceMode: settings.ragSourceMode,
              cache: qaScopeDocumentsRef.current,
              signal: options?.signal,
              deps: {
                createItem: (paper) => createNativeLibraryWorkspaceItem(paper, libraryStorageDir),
                loadLibraryPreviewBlocks,
                readLocalBinaryFile,
                extractPdfTextByPdfJs,
                buildMineruMarkdownDocument,
              },
            })
          : { documents: [], missing: [] };
        const libraryItems = qaScopeMode === 'library'
          ? buildScopedRagLibraryItems(
              notePaperCandidates,
              (paper) => createNativeLibraryWorkspaceItem(paper, libraryStorageDir),
            )
          : [];
        const scoped = await resolveScopedLocalRag({
          scope: { mode: qaScopeMode, paperIds: qaScopePaperIds },
          documents,
          libraryItems,
          settings,
          embedding,
          question,
          excerptText: selectedExcerpt?.text,
          tokenBudget: options?.tokenBudget,
          signal: options?.signal,
        });
        const skippedDocuments = [...missing, ...scoped.skippedDocuments];

        if (scoped.resolution.kind === 'retrieved') {
          return {
            blocks: summaryBlockInputs,
            documentText: scoped.resolution.documentText,
            qaContext: buildQaContext({
              origin: 'local-rag',
              rag: scoped.resolution,
              skippedPaperTitles: skippedDocuments.map((entry) => entry.title),
            }),
            citations: scoped.resolution.citations,
          };
        }

        // 多文献范围没有“当前文献全文”可退；明确失败原因，避免拿当前文献冒充范围答案。
        throw new Error(describeScopedRagFailure(
          { ...scoped, skippedDocuments },
          lRef.current,
        ));
      }

      const skippedPaperTitles: string[] = [];
      let ragResolution: LocalRagResolution =
        ragEnabledForQa
          ? {
              kind: 'missing-embedding-config' as const,
            }
          : {
              kind: 'disabled' as const,
            };

      if (currentDocument?.ragEnabled === false) {
        ragResolution = { kind: 'excluded' };
      } else if (ragEnabledForQa && currentDocument && embeddingConfigured) {
        ragResolution = await resolveLocalRag({
          item: currentDocument,
          settings,
          embedding,
          question,
          excerptText: selectedExcerpt?.text,
          mineruBlocks: flatBlocks,
          mineruDocumentText,
          pdfDocumentText,
          tokenBudget: options?.tokenBudget,
          signal: options?.signal,
        });

        if (ragResolution.kind === 'retrieved') {
          return {
            blocks: summaryBlockInputs,
            documentText: ragResolution.documentText,
            qaContext: buildQaContext({
              origin: 'local-rag',
              rag: ragResolution,
              skippedPaperTitles,
            }),
            citations: ragResolution.citations,
          };
        }
      }

      const pdfText = trimDocumentTextToTokenBudget(pdfDocumentText, options?.tokenBudget);

      if (settings.qaSourceMode === 'pdf-text') {
        return {
          blocks: summaryBlockInputs,
          documentText: pdfText.text,
          qaContext: {
            ...buildQaContext({
              origin: 'pdf-text',
              rag: ragResolution,
            }),
            ...(pdfText.truncated ? { budgetSkippedCount: 1 } : {}),
          },
          citations: [],
        };
      }

      const mineruText = trimDocumentTextToTokenBudget(
        mineruDocumentText,
        options?.tokenBudget,
      );

      return {
        blocks: summaryBlockInputs,
        documentText: mineruText.text,
        qaContext: {
          ...buildQaContext({
            origin: 'mineru-markdown',
            rag: ragResolution,
          }),
          ...(mineruText.truncated ? { budgetSkippedCount: 1 } : {}),
        },
        citations: [],
      };
    }, [
      activeQaPreset,
      loadMineruMarkdownForSummary,
      loadCachedPdfDocumentText,
      currentDocument,
      embeddingApiKey,
      flatBlocks,
      libraryStorageDir,
      loadLibraryPreviewBlocks,
      notePaperCandidates,
      pdfSource,
      qaRagEnabled,
      qaScopeMode,
      qaScopePaperIds,
      selectedExcerpt?.text,
      settings,
      settings.qaSourceMode,
      summaryBlockInputs,
      summaryBlockInputs,
    ]);
  const handleOpenFloatingAssistant = useCallback(() => {
      setAssistantDetached(true);
      setAssistantActivePanel('chat');
      setWorkspaceStage('reading');
      setStatusMessage(
        lRef.current('文档问答已切换为独立浮动窗口', 'Moved document chat to a detached floating window'),
      );
    }, []);
  const handleAttachAssistant = useCallback(() => {
      setAssistantDetached(false);
      setAssistantActivePanel('chat');
      setStatusMessage(lRef.current('文档问答已停靠回右侧面板', 'Docked document chat back to the right sidebar'));
    }, []);
  const handleCreateQaSession = useCallback(() => {
      const nextSession = createQaSession(localeRef.current);

      setQaSessions((current) => [...current, nextSession]);
      setSelectedQaSessionId(nextSession.id);
      setQaInput('');
      setQaAttachments([]);
      setQaError('');
      setStatusMessage(lRef.current('已创建新会话', 'Created a new chat session'));
    }, []);
  const handleSelectQaSession = useCallback(
      (sessionId: string) => {
        if (sessionId === selectedQaSessionId) {
          return;
        }

        const nextSession = resolveQaSessionSelection(qaSessions, sessionId);

        if (!nextSession) {
          return;
        }

        setSelectedQaSessionId(nextSession.id);
        setQaInput('');
        setQaAttachments([]);
        setQaError('');
        setStatusMessage(
          lRef.current(`已切换到会话：${nextSession.title}`, `Switched to session: ${nextSession.title}`),
        );
      },
      [qaSessions, selectedQaSessionId],
    );
  const handleDeleteQaSession = useCallback(
      (sessionId: string) => {
        if (qaRunningSessionIds.includes(sessionId)) {
          setStatusMessage(lRef.current('当前会话正在回复，完成后再删除。', 'This chat is replying. Delete it after the reply finishes.'));
          return;
        }

        const nextSelection = removeQaSession(
          qaSessions,
          sessionId,
          () => createQaSession(localeRef.current),
        );

        if (!nextSelection.removed) {
          return;
        }

        setQaSessions(nextSelection.sessions);
        setSelectedQaSessionId((current) =>
          current === sessionId ? nextSelection.selectedSessionId : current,
        );

        setQaInput('');
        setQaAttachments([]);
        setQaError('');
        setStatusMessage(lRef.current('已删除会话', 'Deleted the chat session'));
      },
      [qaRunningSessionIds, qaSessions],
    );
  const handleQaPresetChange = useCallback(
      (presetId: string) => {
        const nextPreset = resolveQaModelPreset(qaModelPresets, presetId);

        if (!nextPreset) {
          return;
        }

        setSelectedQaPresetId(nextPreset.id);
        onQaActivePresetChange(nextPreset.id);
        setStatusMessage(
          lRef.current(`已切换问答模型：${nextPreset.label}`, `Switched QA model: ${nextPreset.label}`),
        );
      },
      [onQaActivePresetChange, qaModelPresets],
    );
  const handleRemoveAttachment = useCallback((attachmentId: string) => {
      setQaAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    }, []);
  const [ragContextCitation, setRagContextCitation] = useState<DocumentChatCitation | null>(null);
  const effect_236 = useCallback(() => {
    setRagContextCitation(null);
  }, [currentDocument.workspaceId]);
  const handlePreviewQaCitationContext = useCallback(
      (citation: DocumentChatCitation) => {
        setWorkspaceStage('reading');
        setAssistantActivePanel('chat');
        setRagContextCitation(citation);
      },
      [setAssistantActivePanel],
    );
  const handleLocateRagContextSlice = useCallback(
      (slice: RagChunkContextSlice) => {
        const samePageBlocks =
          slice.pageIndex !== null
            ? flatBlocks.filter((block) => block.pageIndex === slice.pageIndex)
            : [];
        const targetBlock =
          (slice.blockId ? flatBlocks.find((block) => block.blockId === slice.blockId) : null) ??
          samePageBlocks.find((block) => block.type !== 'title') ??
          samePageBlocks[0] ??
          null;

        if (!targetBlock) {
          setStatusMessage(
            lRef.current(
              '未找到上下文切片对应的结构块',
              'Could not find the block for the context chunk',
            ),
          );
          return;
        }

        setRagContextCitation(null);
        setWorkspaceStage('reading');
        activateBlock(
          targetBlock,
          lRef.current(
            `已定位到上下文切片 · ${targetBlock.blockId}`,
            `Focused context chunk · ${targetBlock.blockId}`,
          ),
        );
      },
      [activateBlock, currentDocument.itemKey, flatBlocks],
    );
  const handleSelectQaCitation = useCallback(
      (citation: DocumentChatCitation) => {
        if (citation.paperId && citation.paperId !== currentDocument.itemKey) {
          const pageLabel = citation.pageIndex !== null && citation.pageIndex !== undefined
            ? `P${citation.pageIndex + 1}`
            : lRef.current('页码未知', 'page unknown');
          setStatusMessage(lRef.current(
            `引用来自《${citation.paperTitle ?? citation.paperId}》${pageLabel}${citation.blockId ? ` · ${citation.blockId}` : ''}；跨文献引用只展示来源，不切换阅读器。`,
            `Citation from "${citation.paperTitle ?? citation.paperId}" ${pageLabel}${citation.blockId ? ` · ${citation.blockId}` : ''}. Cross-paper citations show their source without switching the reader.`,
          ));
          return;
        }
        const samePageBlocks =
          citation.pageIndex !== null && citation.pageIndex !== undefined
            ? flatBlocks.filter((block) => block.pageIndex === citation.pageIndex)
            : [];
        const samePageBodyBlock =
          samePageBlocks.find((block) => block.type !== 'title') ?? samePageBlocks[0] ?? null;
        const targetBlock =
          (citation.blockId
            ? flatBlocks.find((block) => block.blockId === citation.blockId)
            : null) ??
          samePageBodyBlock;

        if (!targetBlock) {
          setStatusMessage(
            lRef.current(
              `未找到引用 ${citation.label} 对应的结构块`,
              `Could not find the block for citation ${citation.label}`,
            ),
          );
          return;
        }

        setWorkspaceStage('reading');
        setAssistantActivePanel('chat');
        activateBlock(
          targetBlock,
          lRef.current(
            `已定位到引用 [${citation.label}] · ${targetBlock.blockId}`,
            `Focused citation [${citation.label}] · ${targetBlock.blockId}`,
          ),
        );
      },
      [activateBlock, flatBlocks],
    );
  const handleSelectQaAttachments = useCallback(
      async (kind: 'image' | 'file') => {
        try {
          const paths = await selectChatAttachmentPaths(kind);

          if (paths.length === 0) {
            setStatusMessage(
              kind === 'image'
                ? lRef.current('已取消选择图片附件', 'Cancelled image attachment selection')
                : lRef.current('已取消选择文件附件', 'Cancelled file attachment selection'),
            );
            return;
          }

          const attachments = await Promise.all(
            paths.map((path) => buildAttachmentFromPath(path, kind, localeRef.current)),
          );

          setQaAttachments((current) => appendUniqueChatAttachments(current, attachments));
          setStatusMessage(
            lRef.current(`已添加 ${attachments.length} 个附件`, `Added ${attachments.length} attachment(s)`),
          );
        } catch (nextError) {
          setQaError(
            nextError instanceof Error ? nextError.message : lRef.current('加载问答附件失败', 'Failed to load chat attachments'),
          );
        }
      },
      [],
    );
  const handleCaptureSystemScreenshotNative = useCallback(async () => {
      if (capturingScreenshot) {
        return;
      }

      try {
        setCapturingScreenshot(true);
        setQaError('');
        setStatusMessage(lRef.current('正在启动系统截图...', 'Starting system screenshot...'));

        const screenshot = await captureSystemScreenshot();

        if (!screenshot) {
          setStatusMessage(lRef.current('已取消系统截图', 'System screenshot cancelled'));
          return;
        }

        const attachment = await buildScreenshotAttachmentFromPath(screenshot.path, localeRef.current);

        setQaAttachments((current) => {
          const attachmentKey = `${attachment.filePath || attachment.name}:${attachment.size}`;

          if (
            current.some(
              (item) => `${item.filePath || item.name}:${item.size}` === attachmentKey,
            )
          ) {
            return current;
          }

          return [...current, attachment];
        });
        setStatusMessage(
          lRef.current(`已添加系统截图：${attachment.name}`, `Screenshot attached: ${attachment.name}`),
        );
      } catch (nextError) {
        setQaError(
          nextError instanceof Error ? nextError.message : lRef.current('系统截图失败', 'System screenshot failed'),
        );
      } finally {
        setCapturingScreenshot(false);
      }
    }, [capturingScreenshot]);
  const handleSubmitQa = useCallback(async (inputOverride?: string) => {
      const question = (inputOverride ?? qaInput).trim();

      if (!currentDocument || !question) {
        return;
      }

      if (!activeQaPreset) {
        setQaError(lRef.current('请先在设置中选择可用的问答模型配置。', 'Select an available QA model preset in Settings first.'));
        onOpenPreferences();
        return;
      }

      if (!qaConfigured) {
        setQaError(lRef.current('问答模型未配置，请先填写 Base URL 和 API Key。', 'The QA model is not configured. Fill in the Base URL and API key first.'));
        onOpenPreferences();
        return;
      }

      const currentSession = activeQaSession ?? createQaSession(localeRef.current);
      if (qaRunningSessionIds.includes(currentSession.id)) {
        setQaError(lRef.current('当前会话正在回复，请等待完成后再发送。', 'This chat is already replying. Wait for it to finish before sending again.'));
        return;
      }

      const nextUserMessage = createChatMessage('user', question, {
        attachments: qaAttachments,
        modelId: activeQaPreset.id,
        modelLabel: activeQaPreset.label,
      });
      const nextMessages: DocumentChatMessage[] = [
        ...currentSession.messages,
        nextUserMessage,
      ];
      const nextAssistantMessage = createChatMessage('assistant', '', {
        modelId: activeQaPreset.id,
        modelLabel: activeQaPreset.label,
        renderMode: qaAnswerRenderMode,
      });
      const streamingMessages: DocumentChatMessage[] = [
        ...nextMessages,
        nextAssistantMessage,
      ];
      const pendingSession: DocumentChatSession = {
        ...currentSession,
        title: buildQaSessionTitle(localeRef.current, nextMessages),
        createdAt: currentSession.createdAt || nextUserMessage.createdAt,
        updatedAt: nextAssistantMessage.createdAt,
        messages: streamingMessages,
      };

      setQaSessions((current) => updateQaSession(current, pendingSession));
      setSelectedQaSessionId(currentSession.id);
      setQaInput('');
      setQaAttachments([]);
      setQaRunningSessionIds((current) =>
        current.includes(currentSession.id) ? current : [...current, currentSession.id],
      );
      setQaError('');

      const requestGeneration = qaHistoryGenerationRef.current;
      const controller = new AbortController();
      qaAbortControllersRef.current.set(currentSession.id, controller);
      const isRequestCurrent = () =>
        !controller.signal.aborted &&
        qaHistoryGenerationRef.current === requestGeneration &&
        qaHistoryReadyWorkspaceRef.current === currentDocument.workspaceId;
      let streamedAnswer = '';
      // Enriched with qaContext/citations once the request resolves; deltas never rebuild it.
      let streamAssistantMessage: DocumentChatMessage = nextAssistantMessage;
      const commitStreamedAnswer = (answer: string) => {
        streamedAnswer = answer;
        setQaSessions((current) =>
          updateQaSession(
            current,
            buildStreamedQaSession(
              pendingSession,
              nextMessages,
              streamAssistantMessage,
              answer,
              Date.now(),
            ),
          ),
        );
      };

      try {
        // 模型上下文预算：仅在填写 contextWindow 时装箱；未填写时交由服务端处理。
        const contextWindow = Number(activeQaPreset.contextWindow) || 0;
        let tokenBudget: number | undefined;
        if (contextWindow > 0) {
          const outputTokens = Number(activeQaPreset.maxOutputTokens) || 0;
          const historyTokens = estimateRagTokens(
            nextMessages.slice(-12).map((message) => message.content).join('\n'),
          );
          const promptOverhead = estimateRagTokens(question) + 800;
          tokenBudget = contextWindow - outputTokens - historyTokens - promptOverhead;
          if (tokenBudget <= 0) {
            throw new Error(lRef.current(
              '提示、历史消息和输出预算已占满模型上下文窗口，请缩短问题或降低最大输出长度。',
              'The prompt, history, and output budget already fill the model context window. Shorten the question or lower the max output tokens.',
            ));
          }
        }
        const qaRequest = await awaitQaRequest(
          resolveQaRequest(question, { tokenBudget, signal: controller.signal }),
          controller.signal,
        );
        if (!isRequestCurrent()) {
          // 不能静默丢弃：移除空占位并明确告知用户重新发送。
          setQaSessions((current) =>
            removeFailedQaAssistantPlaceholder(current, currentSession.id, nextAssistantMessage.id),
          );
          if (!controller.signal.aborted) {
            setQaError(
              lRef.current(
                '会话状态已切换，本次回答被丢弃，请重新发送问题。',
                'The chat state changed, so this answer was discarded. Send the question again.',
              ),
            );
          }
          return;
        }

        if (qaRequest.documentText === '__never__') {
          throw new Error(
            lRef.current(
              '请先加载 MinerU JSON，或先在 PDF / 结构块视图中选中文本。',
              'Load MinerU JSON first, or select text in the PDF or block view.',
            ),
          );
        }

        streamAssistantMessage = {
          ...nextAssistantMessage,
          qaContext: qaRequest.qaContext,
          citations: qaRequest.citations,
        };
        readerQaStreamStore.start(currentSession.id, nextAssistantMessage.id, {
          qaContext: qaRequest.qaContext,
          citations: qaRequest.citations,
          modelId: activeQaPreset.id,
          modelLabel: activeQaPreset.label,
          renderMode: qaAnswerRenderMode,
        });

        const updateStreamingAnswer = (answer: string) => {
          if (!isRequestCurrent()) {
            return;
          }

          streamedAnswer = answer;
          // Transient per-tab slice: only the streaming bubble re-renders, qaSessions is untouched.
          readerQaStreamStore.update(currentSession.id, nextAssistantMessage.id, answer);
        };

        const answer = await askDocumentOpenAICompatibleStream(
          {
            baseUrl: activeQaPreset.baseUrl,
            apiKey: activeQaPreset.apiKey.trim(),
            model: activeQaPreset.model,
            apiMode: activeQaPreset.apiMode,
            answerRenderMode: qaAnswerRenderMode,
            temperature: getModelRuntimeConfig(settings, 'qa').temperature,
            reasoningEffort: qaReasoningEffort,
            responseLanguage: settings.uiLanguage === 'en-US' ? 'English' : 'Simplified Chinese',
            title: currentDocument.title,
            authors: currentDocument.creators || undefined,
            year: currentDocument.year || undefined,
            excerptText: selectedExcerpt?.text || undefined,
            documentText: qaRequest.documentText,
            blocks: qaRequest.blocks,
            messages: nextMessages.slice(-12),
          },
          {
            onDelta: (_delta, fullText) => updateStreamingAnswer(fullText),
          },
          controller.signal,
        );

        if (answer !== streamedAnswer) {
          updateStreamingAnswer(answer);
        }

        if (isRequestCurrent()) {
          // Commit the full answer exactly once; persistence/history never sees per-delta writes.
          commitStreamedAnswer(answer || streamedAnswer);
          const baseStatus = formatQaContextStatus(qaRequest.qaContext, lRef.current);
          const skippedTitles = qaRequest.qaContext?.skippedPaperTitles ?? [];
          const budgetSkipped = qaRequest.qaContext?.budgetSkippedCount ?? 0;
          const extras = [
            ...(skippedTitles.length > 0
              ? [lRef.current(`已跳过：${skippedTitles.join('、')}`, `Skipped: ${skippedTitles.join(', ')}`)]
              : []),
            ...(budgetSkipped > 0
              ? [lRef.current(`预算截去 ${budgetSkipped} 条证据`, `${budgetSkipped} evidence section(s) dropped by budget`)]
              : []),
          ];
          setStatusMessage(extras.length > 0 ? `${baseStatus} · ${extras.join(' · ')}` : baseStatus);
        }
      } catch (nextError) {
        if (controller.signal.aborted) {
          return;
        }
        const sessionStillActive = isRequestCurrent();

        if (sessionStillActive) {
          if (streamedAnswer.trim()) {
            // Keep the partial answer that was already streamed (matches the pre-refactor behavior).
            commitStreamedAnswer(streamedAnswer);
          } else {
            setQaSessions((current) =>
              removeFailedQaAssistantPlaceholder(current, currentSession.id, nextAssistantMessage.id),
            );
          }
          setQaError(nextError instanceof Error ? nextError.message : lRef.current('文档问答失败', 'Document QA failed'));
        }
      } finally {
        readerQaStreamStore.finish(currentSession.id, nextAssistantMessage.id);
        const abortCleanup = resolveReaderQaStreamAbortCleanup({
          aborted: controller.signal.aborted,
          sameGeneration: qaHistoryGenerationRef.current === requestGeneration,
          streamedAnswer,
        });
        if (abortCleanup === 'commit-partial') {
          // Aborting after some tokens keeps them; only an empty answer is dropped.
          commitStreamedAnswer(streamedAnswer);
        } else if (abortCleanup === 'remove-placeholder') {
          setQaSessions((current) => removeFailedQaAssistantPlaceholder(current, currentSession.id, nextAssistantMessage.id));
        }
        if (qaAbortControllersRef.current.get(currentSession.id) === controller) {
          qaAbortControllersRef.current.delete(currentSession.id);
        }
        if (qaHistoryGenerationRef.current === requestGeneration) {
          setQaRunningSessionIds((current) => current.filter((sessionId) => sessionId !== currentSession.id));
        }
      }
    }, [
      activeQaPreset,
      activeQaSession,
      currentDocument,
      onOpenPreferences,
      qaAttachments,
      qaConfigured,
      qaAnswerRenderMode,
      qaReasoningEffort,
      qaInput,
      qaRunningSessionIds,
      resolveQaRequest,
      selectedExcerpt?.text,
    ]);
  const handleStopQa = useCallback(() => {
      if (selectedQaSessionId) qaAbortControllersRef.current.get(selectedQaSessionId)?.abort();
    }, [selectedQaSessionId]);
  const effect_244 = useCallback(() => {
    const workspaceId = currentDocument.workspaceId;
    const existingTab = getReaderQaTabSnapshot(tabId);
    const previousWorkspaceId = qaAbortWorkspaceRef.current;
    qaAbortWorkspaceRef.current = workspaceId;
    qaHistoryGenerationRef.current += 1;

    const workspaceChanged = (previousWorkspaceId !== null && previousWorkspaceId !== workspaceId)
      || Boolean(existingTab?.workspaceId && existingTab.workspaceId !== workspaceId);
    if (workspaceChanged) {
      for (const controller of qaAbortControllersRef.current.values()) controller.abort();
      qaAbortControllersRef.current.clear();
    }

    if (!workspaceId) {
      qaHistoryReadyWorkspaceRef.current = '';
      qaHistoryExpectedRef.current = null;
      return;
    }

    if (existingTab?.workspaceId === workspaceId) {
      // The tab was unmounted while hidden but its live slice (including an
      // in-flight answer) is still valid; do not overwrite it with old history.
      qaHistoryReadyWorkspaceRef.current = workspaceId;
      qaHistoryExpectedRef.current = null;
      return;
    }

    qaHistoryReadyWorkspaceRef.current = '';
    const history = loadPaperHistory(workspaceId);
    const restoredQa = restorePaperQaHistory(
      history,
      () => createQaSession(localeRef.current),
      selectedQaPresetIdRef.current,
    );

    qaHistoryExpectedRef.current = {
      workspaceId,
      qaSessions: restoredQa.qaSessions,
      selectedQaSessionId: restoredQa.selectedQaSessionId,
    };
    setQaWorkspaceId(workspaceId);
    setQaSessions(restoredQa.qaSessions);
    setSelectedQaSessionId(restoredQa.selectedQaSessionId);
    setSelectedQaPresetId(restoredQa.selectedQaPresetId);
    setQaInput('');
    setQaAttachments([]);
    setQaRunningSessionIds([]);
    setQaError('');
    // zustand 写入同步生效：恢复完成即可提交问答与历史保存，
    // 不依赖后续 effect 再比较会话数组引用。
    qaHistoryReadyWorkspaceRef.current = workspaceId;
    qaHistoryExpectedRef.current = null;
  }, [currentDocument.workspaceId]);
  const effect_245 = useCallback(() => {
    const expected = qaHistoryExpectedRef.current;

    if (!expected || expected.workspaceId !== currentDocument.workspaceId) {
      return;
    }

    // zustand 写入是同步的：slice 的 workspaceId 已对齐就说明恢复已落地。
    // 不再比较会话数组引用，避免别的写入（初始会话、范围切换）让就绪标记永远对不上。
    if (!isQaHistoryRestoreReady(getReaderQaTabSnapshot(tabId), expected.workspaceId)) {
      return;
    }

    qaHistoryReadyWorkspaceRef.current = expected.workspaceId;
    qaHistoryExpectedRef.current = null;
  }, [currentDocument.workspaceId, tabId]);
  const handleAssistantQaSubmit = useCallback(
      (inputOverride?: string) => {
        void handleSubmitQa(inputOverride);
      },
      [handleSubmitQa],
    );
  const handleAssistantSelectImageAttachments = useCallback(() => {
      void handleSelectQaAttachments('image');
    }, [handleSelectQaAttachments]);
  const handleAssistantSelectFileAttachments = useCallback(() => {
      void handleSelectQaAttachments('file');
    }, [handleSelectQaAttachments]);
  const handleAssistantCaptureScreenshot = useCallback(() => {
      void handleCaptureSystemScreenshotNative();
    }, [handleCaptureSystemScreenshotNative]);
  const handleAssistantUpdateNote = useCallback(
      (noteId: string, patch: UpdateNoteRequest, options?: NoteMutationOptions) =>
        handleUpdateNote(noteId, patch, options),
      [handleUpdateNote],
    );
  const handleAssistantDeleteNote = useCallback((noteId: string) => {
      void handleDeleteNote(noteId);
    }, [handleDeleteNote]);
  const handleAssistantAddSelectionToNote = useCallback(() => {
      void handleAddSelectionToNote();
    }, [handleAddSelectionToNote]);
  const handleAssistantTranslateSelectedExcerpt = useCallback(() => {
      void handleTranslateSelectedExcerpt();
    }, [handleTranslateSelectedExcerpt]);
  const assistantSidebarProps = useMemo(
      () =>
        buildReaderAssistantSidebarProps({
          l: readerLocaleText,
          activePanel: assistantActivePanel,
          onActivePanelChange: setAssistantActivePanel,
          currentDocument,
          documentSource,
          currentPdfName,
          currentJsonName,
          blockCount: flatBlocks.length,
          translatedCount,
          statusMessage,
          hasBlocks: flatBlocks.length > 0,
          aiConfigured,
          notes,
          activeNoteId,
          notePaperCandidates,
          notesLoading,
          notesSaving,
          notesError,
          pendingAnchorInsert: pendingNoteAnchorInsert,
          onPendingAnchorInsertHandled: handlePendingNoteAnchorInsertHandled,
          noteEditorSourceId: readerNoteEditorSourceId,
          externalUpdateNote: readerNoteExternalUpdate,
          onExternalUpdateApply: handleReaderNoteExternalUpdateApply,
          qaSessions,
          selectedQaSessionId,
          qaMessages,
          qaInput,
          qaAttachments,
          qaModelPresets,
          selectedQaPresetId,
          qaRagEnabled,
          qaScopeMode,
          qaScopePaperIds,
          qaScopePaperOptions,
          qaAnswerRenderMode,
          qaReasoningEffort,
          qaLoading: selectedQaSessionLoading,
          qaRunningSessionIds,
          qaError,
          screenshotLoading: screenshotBusy,
          onQaInputChange: setQaInput,
          onQaSubmit: handleAssistantQaSubmit,
          onQaStop: handleStopQa,
          onQaPresetChange: handleQaPresetChange,
          onQaRagEnabledChange: setQaRagEnabled,
          onQaScopeChange: updateQaScope,
          onQaAnswerRenderModeChange: setQaAnswerRenderMode,
          onQaReasoningEffortChange: setQaReasoningEffort,
          onQaSessionCreate: handleCreateQaSession,
          onQaSessionSelect: handleSelectQaSession,
          onQaSessionDelete: handleDeleteQaSession,
          onSelectImageAttachments: handleAssistantSelectImageAttachments,
          onSelectFileAttachments: handleAssistantSelectFileAttachments,
          onCaptureScreenshot: handleAssistantCaptureScreenshot,
          onRemoveAttachment: handleRemoveAttachment,
          onCitationClick: handleSelectQaCitation,
          onCitationContext: handlePreviewQaCitationContext,
          onCreateStandaloneNote: handleCreateStandaloneNote,
          onSelectNote: handleSelectNote,
          onUpdateNote: handleAssistantUpdateNote,
          onDeleteNote: handleAssistantDeleteNote,
          onJumpToNoteAnchor: handleJumpToNoteAnchor,
          onNotePaperClick,
          onAddSelectionToNote: handleAssistantAddSelectionToNote,
          onSaveAssistantMessageAsNote: handleSaveAssistantMessageAsNote,
          selectedExcerpt,
          selectedExcerptTranslation,
          selectedExcerptTranslating,
          selectedExcerptError,
          onAppendSelectedExcerptToQa: handleAppendSelectedExcerptToQa,
          onTranslateSelectedExcerpt: handleAssistantTranslateSelectedExcerpt,
          onClearSelectedExcerpt: handleClearSelectedExcerpt,
          onOpenPreferences,
        }),
      [
        activeNoteId,
        aiConfigured,
        assistantActivePanel,
        currentDocument,
        currentJsonName,
        currentPdfName,
        documentSource,
        flatBlocks.length,
        handleAssistantAddSelectionToNote,
        handleAppendSelectedExcerptToQa,
        handleAssistantCaptureScreenshot,
        handleClearSelectedExcerpt,
        handleCreateQaSession,
        handleCreateStandaloneNote,
        handleAssistantDeleteNote,
        handleDeleteQaSession,
        handleJumpToNoteAnchor,
        onNotePaperClick,
        handlePendingNoteAnchorInsertHandled,
        handleQaPresetChange,
        handleReaderNoteExternalUpdateApply,
        handleRemoveAttachment,
        handleAssistantSelectFileAttachments,
        handleAssistantSelectImageAttachments,
        handleSaveAssistantMessageAsNote,
        handleSelectNote,
        handleSelectQaAttachments,
        handleSelectQaCitation,
        handlePreviewQaCitationContext,
        handleSelectQaSession,
        handleAssistantQaSubmit,
        handleStopQa,
        handleAssistantTranslateSelectedExcerpt,
        handleAssistantUpdateNote,
        notePaperCandidates,
        notes,
        notesError,
        notesLoading,
        notesSaving,
        onOpenPreferences,
        pendingNoteAnchorInsert,
        qaAnswerRenderMode,
        qaAttachments,
        qaError,
        qaRunningSessionIds,
        selectedQaSessionLoading,
        qaMessages,
        qaModelPresets,
        qaRagEnabled,
        qaReasoningEffort,
        qaInput,
        qaSessions,
        readerLocaleText,
        readerNoteExternalUpdate,
        readerNoteEditorSourceId,
        screenshotBusy,
        selectedExcerpt,
        selectedExcerptError,
        selectedExcerptTranslating,
        selectedExcerptTranslation,
        selectedQaPresetId,
        selectedQaSessionId,
        statusMessage,
        translatedCount,
      ],
    );
  const effect_265 = useCallback(() => {
    const signature = `${document.workspaceId}::${document.attachmentKey ?? ''}`;

    if (lastDocumentSignatureRef.current === signature) {
      return;
    }

    lastDocumentSignatureRef.current = signature;
    pdfTextCacheRef.current = createPdfTextCache();
    setQaRagEnabled(true);
    void openDocumentItem();
  }, [document.attachmentKey, document.workspaceId, openDocumentItem]);
  const handleBridgeTranslate = useCallback(() => {
      void handleTranslateDocument();
    }, [handleTranslateDocument]);
  const handleBridgeCancelTranslate = useCallback(() => {
      handleCancelDocumentTranslation();
    }, [handleCancelDocumentTranslation]);
  const handleBridgeCloudParse = useCallback(() => {
      void handleCloudParse();
    }, [handleCloudParse]);
  const handleBridgeGenerateSummary = useCallback(() => {
      void handleGeneratePaperSummary();
    }, [handleGeneratePaperSummary]);
  // 任一问答会话在跑都算该标签 busy：切换标签不会中止回答，标签不能被挂载预算卸载。
  const qaRunning = qaRunningSessionIds.length > 0;
  const bridgeState = useMemo<ReaderTabBridgeState>(
      () => ({
        translating,
        qaRunning,
        translatedCount,
        assistantSidebarProps,
        onDetachAssistant: handleOpenFloatingAssistant,
        onAttachAssistant: handleAttachAssistant,
        onTranslate: handleBridgeTranslate,
        onCancelTranslate: handleBridgeCancelTranslate,
        onClearTranslations: handleClearTranslations,
        onCloudParse: handleBridgeCloudParse,
        onGenerateSummary: handleBridgeGenerateSummary,
      }),
      [
        assistantSidebarProps,
        handleAttachAssistant,
        handleBridgeCancelTranslate,
        handleBridgeCloudParse,
        handleBridgeGenerateSummary,
        handleBridgeTranslate,
        handleClearTranslations,
        handleOpenFloatingAssistant,
        qaRunning,
        translatedCount,
        translating,
      ],
    );
  const effect_277 = useCallback(() => {
    onBridgeStateChange(tabId, bridgeState);

    return () => {
      onBridgeStateChange(tabId, null);
    };
  }, [bridgeState, onBridgeStateChange, tabId]);

  return { assistantSidebarProps, bridgeState, effect_116, effect_117, effect_236, effect_244, effect_245, effect_265, effect_277, handleAssistantAddSelectionToNote, handleAssistantCaptureScreenshot, handleAssistantDeleteNote, handleAssistantQaSubmit, handleAssistantSelectFileAttachments, handleAssistantSelectImageAttachments, handleAssistantTranslateSelectedExcerpt, handleAssistantUpdateNote, handleAttachAssistant, handleBridgeCancelTranslate, handleBridgeCloudParse, handleBridgeGenerateSummary, handleBridgeTranslate, handleCaptureSystemScreenshotNative, handleCreateQaSession, handleDeleteQaSession, handleLocateRagContextSlice, handleOpenFloatingAssistant, handlePreviewQaCitationContext, handleQaPresetChange, handleRemoveAttachment, handleSelectQaAttachments, handleSelectQaCitation, handleSelectQaSession, handleStopQa, handleSubmitQa, qaScopePaperOptions, ragContextCitation, resolveQaRequest, selectedQaSessionLoading, setRagContextCitation, updateQaScope };
}

export type ReaderQaApi = ReturnType<typeof useReaderQa>;
