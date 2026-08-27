import { useEffect, useMemo, useRef, useState } from 'react';
import { useWheelScrollDelegate } from '../../hooks/useWheelScrollDelegate';
import {
  applyLibraryAgentPlan,
  loadLibraryAgentAvailableModelPresets,
  loadLibraryAgentModelPresetById,
  runConversationalLibraryAgent,
  type LibraryAgentConversationMessage,
  type LibraryAgentPlan,
  type LibraryAgentRagCitation,
  type LibraryAgentStreamHandlers,
} from '../../services/libraryAgent';
import {
  appendAgentRunEvent,
  finishAgentRun,
  getAgentRunEvents,
  listAgentRunUsageBySession,
  listInterruptedAgentRuns,
  startAgentRun,
} from '../../services/agentRuns';
import {
  writeAgentMemory,
  type AgentMemoryWritePlan,
} from '../../services/agentMemory';
import type { AgentLoopEvent, AgentLoopMessage } from '../../services/agentLoop';
import type { ComparativeSurveyArtifacts, ComparativeSurveyEvent } from '../../services/agentCapability';
import { listLibraryCategories, listLibraryPapers } from '../../services/library';
import type { LiteratureCategory, LiteraturePaper } from '../../types/library';
import type { DocumentChatAttachment, ModelReasoningEffort, QaModelPreset } from '../../types/reader';
import {
  forkAgentHistorySession,
  patchAgentHistorySessionMessage,
  upsertAgentHistorySession,
} from './agentSessionState';
import {
  latestAgentRecoveryCheckpoint,
  latestComparativeSurveyCheckpoint,
  recoveryCheckpointToChatMessages,
} from './agentRunRecovery';
import {
  isAgentSessionRunning,
  updateAgentRunningSessions,
} from './agentRunningSessions';
import {
  applyAgentLoopEventToTrace,
  buildRunningTrace,
  buildAgentHistorySession,
  buildToolCallView,
  durationLabel,
  formatPaperMeta,
  hasAgentConversationHistory,
  loadAgentHistorySessions,
  newAgentSessionId,
  newMessageId,
  paperMatchesQuery,
  promptSuggestions,
  promptSuggestionsEn,
  saveAgentHistorySessions,
  toolFunctionName,
  toolLabel,
  uniqueTagNames,
} from './AgentWorkspace.model';
import type { AgentChatMessage, AgentHistorySession, AgentToolCallView } from './AgentWorkspace.types';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import { emitJumpToNoteAnchor } from '../../app/appEvents';
import AgentWorkspaceView from './AgentWorkspaceView';
import { buildAttachmentFromPath, buildScreenshotAttachmentFromPath } from '../reader/documentReaderShared';
import { captureSystemScreenshot, selectChatAttachmentPaths } from '../../services/desktop';
import { mergeUniqueAgentAttachments } from './agentAttachmentUtils';
import {
  buildConversationPaperScopes,
  collectPaperScopeCandidateIds,
  containsLegacyMojibake,
  hasSameAgentHistoryMessages,
  latestConversationPaperScopeIds,
  uniquePaperScopeIds,
} from './agentPaperScopes';
import {
  findMentionedCategoryScope,
  hasExplicitFullLibraryScope,
} from './agentCategoryScopes';

const AGENT_CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD = 96;

function isNearScrollBottom(element: HTMLElement, threshold = AGENT_CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function createAgentRagCitationJumpRequestId(): string {
  return `agent-rag-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createCapabilityView() {
  return {
    id: 'comparative-survey' as const,
    status: 'running' as const,
    activeStage: undefined,
    stages: (['rephrase', 'decompose', 'research', 'report'] as const).map((id) => ({
      id,
      status: 'waiting' as const,
    })),
  };
}

function recoverySnapshotMessages(messages: AgentLoopMessage[]) {
  return messages.slice(-32).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 8000),
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls?.slice(0, 12).map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
  }));
}

const agentWelcomeText = {
  zh: '直接输入问题即可。如需限定范围，可以选择文献；未选择时 RAG 会自动使用全库。',
  en: 'Type naturally. Select papers to limit the scope; when none are selected, RAG uses the full library.',
};

const agentWelcomeMeta = {
  zh: '共享文库 RAG · 文献推荐 · 工具计划需确认',
  en: 'Shared library RAG · paper recommendations · reviewable tool plans',
};

const agentWelcomeTraceSummary = {
  zh: '需要文献时会自动尝试使用全库候选，也可以手动选择范围。',
  en: 'When papers are needed, the Agent can automatically use the full library as candidates, or you can choose a scope manually.',
};

function AgentWorkspace() {
  const locale = useAppLocale();
  const l = useLocaleText();
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [categories, setCategories] = useState<LiteratureCategory[]>([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(() => new Set());
  const [paperSearchQuery, setPaperSearchQuery] = useState('');
  const [composerValue, setComposerValue] = useState('');
  const [lastInstruction, setLastInstruction] = useState('');
  const [agentModelPresets, setAgentModelPresets] = useState<QaModelPreset[]>([]);
  const [plan, setPlan] = useState<LibraryAgentPlan | null>(null);
  const [approvedItemIds, setApprovedItemIds] = useState<Set<string>>(() => new Set());
  const [expandedStepKeys, setExpandedStepKeys] = useState<Set<string>>(() => new Set());
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());
  const [activeSessionId, setActiveSessionId] = useState(() => newAgentSessionId());
  const [historySessions, setHistorySessions] = useState<AgentHistorySession[]>(() => loadAgentHistorySessions());
  const [historySidebarCollapsed, setHistorySidebarCollapsed] = useState(false);
  const [agentAttachments, setAgentAttachments] = useState<DocumentChatAttachment[]>([]);
  const [agentRagEnabled, setAgentRagEnabled] = useState(true);
  const [selectedAgentPresetId, setSelectedAgentPresetId] = useState<string | null>(null);
  const [selectedAgentReasoningEffort, setSelectedAgentReasoningEffort] =
    useState<ModelReasoningEffort>('auto');
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => [
    {
      id: newMessageId(),
      role: 'assistant',
      content:
        l(
          '直接输入问题即可。如需限定范围，可以选择文献；未选择时，RAG 会自动使用全库作为候选上下文。',
          'Type naturally. Select papers to limit the scope; when none are selected, RAG automatically uses the full library as candidate context.',
        ),
      meta: l(
        '共享文库 RAG · 文献推荐 · 可审批工具计划 · 本地写入前确认',
        'Shared library RAG · paper recommendations · reviewable tool plans · confirm before local writes',
      ),
      createdAt: Date.now(),
      trace: [
        {
          id: 'welcome-intent',
          type: 'intent',
          title: l('等待用户指令', 'Waiting for user instruction'),
          summary: l('可以在输入区选择文献来限定范围；未选择时，RAG 会自动使用全库候选。', 'Select papers in the composer to limit the scope; when none are selected, RAG automatically uses full-library candidates.'),
          status: 'waiting',
        },
      ],
    },
  ]);
  const [loading, setLoading] = useState(true);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const runningSessionIdsRef = useRef(runningSessionIds);
  const activeSessionIdRef = useRef(activeSessionId);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [currentRunTokens, setCurrentRunTokens] = useState({ promptTokens: 0, completionTokens: 0 });
  const [sessionTokenUsage, setSessionTokenUsage] = useState<Record<string, number>>({});
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const pendingCapabilityResumeRef = useRef(new Map<string, {
    instruction: string;
    artifacts: Partial<ComparativeSurveyArtifacts>;
  }>());
  const pendingLoopResumeRef = useRef(new Map<string, {
    instruction: string;
    messages: AgentLoopMessage[];
  }>());
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const historySidebarRef = useRef<HTMLElement | null>(null);
  const conversationPanelRef = useRef<HTMLElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const handleHistoryWheelCapture = useWheelScrollDelegate({ rootRef: historySidebarRef });
  const handleConversationWheelCapture = useWheelScrollDelegate({ rootRef: conversationPanelRef });

  const createLocalizedWelcomeMessage = (): AgentChatMessage => ({
    id: newMessageId(),
    role: 'assistant',
    content: l(
      '直接输入问题即可。如需限定范围，可以选择文献；未选择时，RAG 会自动使用全库作为候选上下文。',
      'Type naturally. Select papers to limit the scope; when none are selected, RAG automatically uses the full library as candidate context.',
    ),
    meta: l(
      '共享文库 RAG · 文献推荐 · 可审批工具计划 · 本地写入前确认',
      'Shared library RAG · paper recommendations · reviewable tool plans · confirm before local writes',
    ),
    createdAt: Date.now(),
    trace: [
      {
        id: 'welcome-intent',
        type: 'intent',
        title: l('等待用户指令', 'Waiting for user instruction'),
        summary: l('可以在输入区选择文献来限定范围；未选择时，RAG 会自动使用全库候选。', 'Select papers in the composer to limit the scope; when none are selected, RAG automatically uses full-library candidates.'),
        status: 'waiting',
      },
    ],
  });

  const filteredPapers = useMemo(
    () => papers.filter((paper) => paperMatchesQuery(paper, paperSearchQuery)),
    [papers, paperSearchQuery],
  );
  const selectedPapers = useMemo(
    () => papers.filter((paper) => selectedPaperIds.has(paper.id)),
    [papers, selectedPaperIds],
  );
  const selectedTags = useMemo(() => uniqueTagNames(selectedPapers), [selectedPapers]);
  const activeSessionRunning = useMemo(
    () => isAgentSessionRunning(runningSessionIds, activeSessionId),
    [activeSessionId, runningSessionIds],
  );
  const sortedHistorySessions = useMemo(
    () => historySessions.slice().sort((left, right) => right.updatedAt - left.updatedAt),
    [historySessions],
  );
  const localizedCapabilityTitles: Record<string, string> = {
    rename: l('批量重命名', 'Batch Rename'),
    metadata: l('元数据补全', 'Metadata Completion'),
    'smart-tags': l('智能标签', 'Smart Tags'),
    'clean-tags': l('标签清洗', 'Tag Cleanup'),
    classify: l('自动归类', 'Auto Classification'),
  };
  const localizedToolLabel = (tool: LibraryAgentPlan['tool']) =>
    localizedCapabilityTitles[tool] ?? (locale === 'en-US' ? toolFunctionName(tool) : toolLabel(tool));

  const refreshPapers = async () => {
    setLoading(true);
    setError('');

    try {
      const [nextCategories, nextPapers] = await Promise.all([
        listLibraryCategories(),
        listLibraryPapers({
          sortBy: 'manual',
          sortDirection: 'asc',
          limit: 1000,
        }),
      ]);

      setCategories(nextCategories);
      setPapers(nextPapers);
      setSelectedPaperIds((current) => {
        const nextIds = new Set(nextPapers.map((paper) => paper.id));
        return new Set([...current].filter((id) => nextIds.has(id)));
      });
      setStatusMessage(l(`已加载 ${nextPapers.length} 篇文献。`, `Loaded ${nextPapers.length} papers.`));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('加载文库失败', 'Failed to load library');
      setError(message);
      setStatusMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshPapers();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadModelPresets = async () => {
      try {
        const presets = await loadLibraryAgentAvailableModelPresets();

        if (cancelled) {
          return;
        }

        setAgentModelPresets(presets);
        setSelectedAgentPresetId((current) => current ?? presets[0]?.id ?? null);
      } catch {
        if (!cancelled) {
          setAgentModelPresets([]);
        }
      }
    };

    void loadModelPresets();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setComposerValue((current) =>
      containsLegacyMojibake(current)
        || current === 'Append 123 to the selected paper titles'
        || current === 'Add "Read" to the beginning of the selected paper titles'
        ? ''
        : current,
    );
  }, []);

  useEffect(() => {
    setComposerValue((current) =>
      containsLegacyMojibake(current) ? '' : current,
    );
    setMessages((current) => {
      if (
        current.length !== 1 ||
        !current[0]?.trace?.some((step) => step.id === 'welcome-intent') ||
        !containsLegacyMojibake(current[0].content)
      ) {
        return current;
      }

      const localized = createLocalizedWelcomeMessage();
      return [
        {
          ...localized,
          id: current[0].id,
          createdAt: current[0].createdAt,
        },
      ];
    });
  }, [locale]);

  useEffect(() => {
    const scrollElement = chatScrollRef.current;

    if (!scrollElement) {
      return undefined;
    }

    const handleScroll = () => {
      shouldStickToBottomRef.current = isNearScrollBottom(scrollElement);
    };

    handleScroll();
    scrollElement.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const scrollElement = chatScrollRef.current;

    if (!scrollElement) {
      return;
    }

    const lastMessageId = messages[messages.length - 1]?.id ?? null;
    const lastMessageChanged = previousLastMessageIdRef.current !== lastMessageId;

    previousLastMessageIdRef.current = lastMessageId;

    if (lastMessageChanged) {
      shouldStickToBottomRef.current = true;
    }

    if (!shouldStickToBottomRef.current && !isNearScrollBottom(scrollElement)) {
      return;
    }

    shouldStickToBottomRef.current = true;
    window.requestAnimationFrame(() => {
      const nextScrollElement = chatScrollRef.current;

      if (!nextScrollElement || (!shouldStickToBottomRef.current && !isNearScrollBottom(nextScrollElement))) {
        return;
      }

      nextScrollElement.scrollTop = nextScrollElement.scrollHeight;
    });
  }, [activeSessionId, activeSessionRunning, applyingPlan, messages]);

  useEffect(() => {
    const nextSession = buildAgentHistorySession({
      id: activeSessionId,
      messages,
      selectedPaperIds: [...selectedPaperIds],
      lastInstruction,
      ragEnabled: agentRagEnabled,
      selectedModelPresetId: selectedAgentPresetId ?? undefined,
      attachments: agentAttachments,
      locale,
    });

    setHistorySessions((current) => {
      if (!hasAgentConversationHistory(messages)) {
        return current.filter((session) => session.id !== activeSessionId);
      }

      const existingSession = current.find((session) => session.id === activeSessionId);

      if (hasSameAgentHistoryMessages(existingSession, nextSession)) {
        return current;
      }

      const otherSessions = current.filter((session) => session.id !== activeSessionId);
      return [nextSession, ...otherSessions].slice(0, 30);
    });
  }, [
    activeSessionId,
    agentAttachments,
    agentRagEnabled,
    lastInstruction,
    locale,
    messages,
    selectedAgentPresetId,
    selectedPaperIds,
  ]);

  useEffect(() => {
    saveAgentHistorySessions(historySessions);
  }, [historySessions]);

  useEffect(() => {
    const sessionIds = historySessions.map((session) => session.id);

    if (sessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    void listAgentRunUsageBySession(sessionIds)
      .then((rows) => {
        if (cancelled) return;
        setSessionTokenUsage((current) => ({
          ...current,
          ...Object.fromEntries(rows.map((row) => [
            row.sessionId,
            Math.max(current[row.sessionId] ?? 0, row.promptTokens + row.completionTokens),
          ])),
        }));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [historySessions]);

  useEffect(() => {
    runningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const updateMessage = (messageId: string, updater: (message: AgentChatMessage) => AgentChatMessage) => {
    setMessages((current) => current.map((message) => (message.id === messageId ? updater(message) : message)));
  };

  const upsertSessionSnapshot = (
    sessionId: string,
    nextMessages: AgentChatMessage[],
    nextSelectedPaperIds: string[],
    nextInstruction: string,
  ) => {
    setHistorySessions((current) =>
      upsertAgentHistorySession(current, {
        sessionId,
        messages: nextMessages,
        selectedPaperIds: nextSelectedPaperIds,
        lastInstruction: nextInstruction,
        ragEnabled: agentRagEnabled,
        selectedModelPresetId: selectedAgentPresetId ?? undefined,
        attachments: agentAttachments,
        locale,
      }),
    );
  };

  const updateSessionMessage = (
    sessionId: string,
    messageId: string,
    updater: (message: AgentChatMessage) => AgentChatMessage,
  ) => {
    setHistorySessions((current) =>
      patchAgentHistorySessionMessage(current, {
        sessionId,
        messageId,
        updater,
        locale,
      }),
    );

    if (activeSessionIdRef.current === sessionId) {
      updateMessage(messageId, updater);
    }
  };

  const restoreDraftStateFromMessages = (sessionMessages: AgentChatMessage[]) => {
    const latestPlanMessage = [...sessionMessages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.plan);
    const nextPlan = latestPlanMessage?.plan ?? null;

    setPlan(nextPlan);
    setApprovedItemIds(new Set(nextPlan?.items.map((item) => item.id) ?? []));
  };

  const setAgentSessionRunning = (sessionId: string, running: boolean) => {
    setRunningSessionIds((current) => updateAgentRunningSessions(current, sessionId, running));
  };

  const togglePaper = (paperId: string) => {
    const paper = papers.find((item) => item.id === paperId);

    setSelectedPaperIds((current) => {
      const next = new Set(current);
      const selected = next.has(paperId);

      if (selected) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }

      setStatusMessage(
        l(
          `${selected ? '已取消选择' : '已选择'}：${paper?.title ?? '论文'}`,
          `${selected ? 'Unselected' : 'Selected'}: ${paper?.title ?? 'paper'}`,
        ),
      );
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedPaperIds(new Set(filteredPapers.map((paper) => paper.id)));
    setStatusMessage(l(`已选择当前结果中的 ${filteredPapers.length} 篇文献。`, `Selected ${filteredPapers.length} papers from the current results.`));
  };

  const clearSelection = () => {
    setSelectedPaperIds(new Set());
    setStatusMessage(
      l(
        '已清空当前选中的文献。开启 RAG 时将自动使用全库候选。',
        'Cleared the current paper selection. When RAG is enabled, the full library will be used automatically.',
      ),
    );
  };

  const handleFindPapers = () => {
    setComposerValue(
      l(
        '从我的文库里找出和这个研究问题最相关的论文，并说明为什么相关：',
        'Find the papers in my library that are most relevant to this research question, and explain why they are relevant:',
      ),
    );
    setStatusMessage(l('已插入文献检索指令，可补充研究问题后发送。', 'Inserted a paper-finding prompt. Add the research question and send.'));
  };

  const handleRecommendPapers = () => {
    setAgentRagEnabled(true);
    setSelectedPaperIds(new Set());
    setComposerValue(
      l(
        '基于整个文库，推荐最值得优先阅读的论文。请按主题聚类，说明推荐理由、适合解决的问题，以及下一步阅读顺序。',
        'Based on the full library, recommend the papers worth reading first. Cluster them by topic, explain why they matter, what questions they help answer, and the suggested reading order.',
      ),
    );
    setStatusMessage(
      l(
        `已清除手动选择并开启 Agent RAG，将从全库 ${papers.length} 篇文献中推荐。`,
        `Cleared the manual selection and enabled Agent RAG. Recommendations will use all ${papers.length} library papers.`,
      ),
    );
  };

  const handleUseFullLibraryRag = () => {
    setAgentRagEnabled(true);
    setSelectedPaperIds(new Set());
    setComposerValue((current) =>
      current.trim()
        ? current
        : l(
          '使用整个文库作为 RAG 上下文回答：',
          'Use the full library as RAG context to answer:',
        ),
    );
    setStatusMessage(
      l(
        `已清除手动选择并开启 RAG，将自动使用全库 ${papers.length} 篇文献作为候选。`,
        `Cleared the manual selection and enabled RAG. All ${papers.length} library papers will be used as candidates automatically.`,
      ),
    );
  };

  const setNextPlan = (nextPlan: LibraryAgentPlan) => {
    setPlan(nextPlan);
    setApprovedItemIds(new Set(nextPlan.items.map((item) => item.id)));
    setStatusMessage(nextPlan.description);
  };

  const appendAssistantMessageToSession = (
    sessionId: string,
    content: string,
    meta?: string,
  ) => {
    const nextMessage: AgentChatMessage = {
      id: newMessageId(),
      role: 'assistant',
      content,
      meta,
      createdAt: Date.now(),
    };

    setHistorySessions((current) => {
      const targetSession = current.find((session) => session.id === sessionId);

      if (!targetSession) {
        return current;
      }

      return upsertAgentHistorySession(current, {
        sessionId,
        messages: [...targetSession.messages, nextMessage],
        selectedPaperIds: targetSession.selectedPaperIds,
        lastInstruction: targetSession.lastInstruction,
        ragEnabled: targetSession.ragEnabled,
        selectedModelPresetId: targetSession.selectedModelPresetId,
        attachments: targetSession.attachments,
        locale,
      });
    });

    if (activeSessionIdRef.current === sessionId) {
      setMessages((existingMessages) => [...existingMessages, nextMessage]);
    }
  };

  const copyToolParameters = async (toolCall: AgentToolCallView) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(toolCall.rawParameters, null, 2));
      setStatusMessage(l(`已复制 ${toolCall.functionName} 的工具参数。`, `Copied parameters for ${toolCall.functionName}.`));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('复制工具参数失败', 'Failed to copy tool parameters');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleOpenRagCitation = (citation: LibraryAgentRagCitation) => {
    const targetPaperId = `native-library:${citation.paperId}`;
    emitJumpToNoteAnchor({
      requestId: createAgentRagCitationJumpRequestId(),
      jumpSource: 'agent-rag',
      targetPaperId,
      noteId: `agent-rag:${citation.paperId}`,
      noteTitle: citation.paperTitle,
      notePaperId: targetPaperId,
      anchorId: citation.id,
      anchorPaperId: targetPaperId,
      anchorLabel: `[${citation.label}] ${citation.paperTitle}`,
      blockId: citation.blockId ?? null,
      pageIndex: citation.pageIndex,
      previewText: citation.previewText ?? null,
      sourceType: citation.sourceType,
      pdfLocation:
        citation.pageIndex !== null && citation.pageIndex !== undefined
          ? {
              pageNumber: citation.pageIndex + 1,
              bbox: [0, 0, 1000, 1000],
              bboxCoordinateSystem: 'normalized-1000',
              bboxPageSize: [1000, 1000],
            }
          : null,
    });
    setStatusMessage(
      l(
        `正在打开引用来源：${citation.paperTitle}`,
        `Opening citation source: ${citation.paperTitle}`,
      ),
    );
  };

  const buildConversationHistory = (): LibraryAgentConversationMessage[] =>
    messages
      .filter((message) => message.role === 'user' || (message.role === 'assistant' && !message.plan))
      .filter((message) => !message.trace?.some((step) => step.id === 'welcome-intent'))
      .filter((message) => (message.content.trim() || message.attachments?.length) && !message.error)
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.content.trim(),
        paperScopeIds: message.paperScopeIds,
        attachments: message.attachments,
      }));

  const runAgent = async (
    rawInstruction: string,
    inlinePaperIds?: string[],
    capabilityResume?: Partial<ComparativeSurveyArtifacts>,
  ) => {
    const instruction = rawInstruction.trim();

    if (!instruction) {
      setError(l('请输入 Agent 指令。', 'Enter an Agent instruction.'));
      return;
    }

    const sessionId = activeSessionId;
    const pendingCapabilityResume = pendingCapabilityResumeRef.current.get(sessionId);
    const effectiveCapabilityResume = capabilityResume ?? (
      pendingCapabilityResume?.instruction.trim() === instruction
        ? pendingCapabilityResume.artifacts
        : undefined
    );
    pendingCapabilityResumeRef.current.delete(sessionId);
    const pendingLoopResume = pendingLoopResumeRef.current.get(sessionId);
    const effectiveLoopResumeMessages = pendingLoopResume?.instruction.trim() === instruction
      ? pendingLoopResume.messages
      : undefined;
    pendingLoopResumeRef.current.delete(sessionId);

    if (isAgentSessionRunning(runningSessionIdsRef.current, sessionId)) {
      setStatusMessage(
        l(
          '当前对话仍在处理中，请等待这一轮回复完成后再继续发送。',
          'This chat is still processing. Wait for the current reply to finish before sending another message.',
        ),
      );
      return;
    }

    const explicitPaperScopeIds = uniquePaperScopeIds(inlinePaperIds ?? []);
    const fallbackPaperScopeIds =
      explicitPaperScopeIds.length === 0 && selectedPaperIds.size === 0
        ? latestConversationPaperScopeIds(messages)
        : [];
    const currentTurnPaperScopeIds =
      explicitPaperScopeIds.length > 0 ? explicitPaperScopeIds : fallbackPaperScopeIds;
    const inlinePaperIdSet = new Set(currentTurnPaperScopeIds);
    const inlinePapers = inlinePaperIdSet.size > 0
      ? papers.filter((paper) => inlinePaperIdSet.has(paper.id))
      : [];
    const useInlinePaperScope = inlinePapers.length > 0;
    const categoryScope = useInlinePaperScope ? null : findMentionedCategoryScope(instruction, categories, papers);
    const useCategoryScope = !useInlinePaperScope && Boolean(categoryScope && categoryScope.papers.length > 0);
    const useFullLibraryCandidates =
      !useInlinePaperScope &&
      !useCategoryScope &&
      papers.length > 0 &&
      (hasExplicitFullLibraryScope(instruction) ||
        (agentRagEnabled && selectedPapers.length === 0));
    const selectedPapersSnapshot = useInlinePaperScope
      ? inlinePapers
      : useCategoryScope
      ? categoryScope?.papers ?? []
      : useFullLibraryCandidates
        ? papers
        : selectedPapers;
    const selectedPaperIdsSnapshot = useInlinePaperScope
      ? inlinePapers.map((paper) => paper.id)
      : useCategoryScope
      ? selectedPapersSnapshot.map((paper) => paper.id)
      : useFullLibraryCandidates
        ? papers.map((paper) => paper.id)
        : [...selectedPaperIds];
    const paperScopesSnapshot = buildConversationPaperScopes(messages, selectedPaperIdsSnapshot);
    const paperScopeCandidateIds = collectPaperScopeCandidateIds(paperScopesSnapshot);
    const selectedPaperCandidateSet = new Set(selectedPapersSnapshot.map((paper) => paper.id));
    const modelPapersSnapshot = paperScopeCandidateIds.length > 0
      ? papers.filter((paper) => selectedPaperCandidateSet.has(paper.id) || paperScopeCandidateIds.includes(paper.id))
      : selectedPapersSnapshot;
    const startedAt = performance.now();
    const assistantMessageId = newMessageId();
    const paperCount = selectedPapersSnapshot.length;
    const capabilityRequested = /对比调研|比较调研|对比综述|比较综述|comparative survey|comparative review|comparison report/i.test(instruction) && paperCount >= 2;
    const historyMessages = buildConversationHistory();
    const attachmentsSnapshot = [...agentAttachments];
    const userMessage: AgentChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: instruction,
      attachments: attachmentsSnapshot,
      paperScopeIds: selectedPaperIdsSnapshot.length > 0 ? selectedPaperIdsSnapshot : undefined,
      meta: useInlinePaperScope
        ? l(`本轮已选择 ${paperCount} 篇论文`, `This turn selected ${paperCount} papers`)
        : useCategoryScope && categoryScope
        ? l(
          `文献范围：分类「${categoryScope.path}」中的 ${paperCount} 篇`,
          `Paper scope: ${paperCount} papers in category "${categoryScope.path}"`,
        )
        : useFullLibraryCandidates
          ? l(`未手动选择，RAG 使用全库候选：${paperCount} 篇`, `No manual selection; RAG uses ${paperCount} full-library candidates`)
          : paperCount > 0
            ? l(`已选择 ${paperCount} 篇论文`, `${paperCount} papers selected`)
            : undefined,
      createdAt: Date.now(),
    };
    const pendingAssistantMessage: AgentChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      paperScopeIds: selectedPaperIdsSnapshot.length > 0 ? selectedPaperIdsSnapshot : undefined,
      content: l('Agent 正在回复...', 'Agent is replying...'),
      meta: l('执行中', 'Running'),
      createdAt: Date.now(),
      trace: buildRunningTrace(instruction, paperCount, locale),
      capability: capabilityRequested ? createCapabilityView() : undefined,
    };
    const nextMessages = [...messages, userMessage, pendingAssistantMessage];
    const isTargetSessionActive = () => activeSessionIdRef.current === sessionId;
    const abortController = new AbortController();
    abortControllersRef.current.set(sessionId, abortController);
    let runId: string | null = null;
    let runEventQueue: Promise<void> = Promise.resolve();
    let runStatus: 'done' | 'error' | 'aborted' = 'done';
    let runTurns = 0;
    const runTokens = { promptTokens: 0, completionTokens: 0 };
    const appendRunEvent = (event: AgentLoopEvent) => {
      if (!runId || event.kind === 'thinking_delta') {
        return;
      }

      const request = (() => {
        switch (event.kind) {
          case 'turn_start':
            return { kind: 'turn_start', turn: event.turn, payload: { turn: event.turn } };
          case 'tool_call':
            return { kind: 'tool_call', turn: event.turn, payload: { turn: event.turn, callId: event.callId, name: event.name, args: event.args } };
          case 'tool_result':
            return { kind: 'tool_result', turn: event.turn, payload: { turn: event.turn, callId: event.callId, name: event.name, ok: event.ok, preview: event.preview } };
          case 'answer_delta':
            return { kind: 'answer_delta', payload: { characters: event.text.length } };
          case 'context_compacted':
            return {
              kind: 'context_compacted',
              payload: {
                tokenEstimate: event.tokenEstimate,
                droppedMessages: event.droppedMessages,
                fallback: event.fallback,
              },
            };
          case 'turn_end':
            return {
              kind: 'turn_end',
              turn: event.turn,
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              payload: {
                turn: event.turn,
                finishReason: event.finishReason,
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
              },
            };
          case 'error':
            return { kind: 'error', turn: event.turn, payload: { message: event.message } };
          default:
            return null;
        }
      })();

      if (!request) {
        return;
      }

      const targetRunId = runId;
      runEventQueue = runEventQueue
        .then(() => appendAgentRunEvent({ runId: targetRunId, ...request }))
        .then(() => undefined)
        .catch(() => undefined);
    };
    const appendRecoveryCheckpoint = (checkpointMessages: AgentLoopMessage[], turn: number) => {
      if (!runId) {
        return;
      }

      const targetRunId = runId;
      runEventQueue = runEventQueue
        .then(() => appendAgentRunEvent({
          runId: targetRunId,
          kind: 'checkpoint',
          turn,
          payload: { messages: recoverySnapshotMessages(checkpointMessages) },
        }))
        .then(() => undefined)
        .catch(() => undefined);
    };
    const handleAgentLoopEvent = (event: AgentLoopEvent) => {
      appendRunEvent(event);
      updateSessionMessage(sessionId, assistantMessageId, (message) => ({
        ...message,
        trace: applyAgentLoopEventToTrace(message.trace, event, locale),
      }));

      if (event.kind === 'turn_end') {
        runTurns = Math.max(runTurns, event.turn);
        runTokens.promptTokens += event.promptTokens;
        runTokens.completionTokens += event.completionTokens;
        if (isTargetSessionActive()) {
          setCurrentRunTokens({ ...runTokens });
        }
        setSessionTokenUsage((current) => ({
          ...current,
          [sessionId]: (current[sessionId] ?? 0) + event.promptTokens + event.completionTokens,
        }));
      }

      if (isTargetSessionActive() && event.kind === 'tool_call') {
        setStatusMessage(l(`第 ${event.turn} 轮正在调用 ${event.name}...`, `Turn ${event.turn} is calling ${event.name}...`));
      }
    };
    let streamedAgentAnswer = '';
    let streamedAgentThinking = '';
    let streamCommitTimer: ReturnType<typeof window.setTimeout> | null = null;
    let lastStreamCommitAt = 0;
    const commitStreamedAgentMessage = () => {
      streamCommitTimer = null;

      if ((!streamedAgentAnswer.trim() && !streamedAgentThinking.trim()) || !isTargetSessionActive()) {
        return;
      }

      lastStreamCommitAt = Date.now();
      updateMessage(assistantMessageId, (message) => ({
        ...message,
        content: streamedAgentAnswer.trim() ? streamedAgentAnswer : message.content,
        thinking: streamedAgentThinking.trim() ? streamedAgentThinking : message.thinking,
        meta: 'streaming / Running',
        error: undefined,
      }));
    };
    const scheduleStreamedAgentMessageCommit = () => {
      if (!isTargetSessionActive()) {
        return;
      }

      const elapsedMs = Date.now() - lastStreamCommitAt;

      if (elapsedMs >= 120) {
        commitStreamedAgentMessage();
        return;
      }

      if (streamCommitTimer === null) {
        streamCommitTimer = window.setTimeout(commitStreamedAgentMessage, 120 - elapsedMs);
      }
    };
    const handleCapabilityEvent = (event: ComparativeSurveyEvent) => {
      if (runId) {
        const targetRunId = runId;
        const kind = event.kind === 'stage_start'
          ? 'stage_start'
          : event.kind === 'stage_end'
            ? 'stage_end'
            : 'stage_progress';
        runEventQueue = runEventQueue
          .then(() => appendAgentRunEvent({ runId: targetRunId, kind, payload: event }))
          .then(() => undefined)
          .catch(() => undefined);
      }

      updateSessionMessage(sessionId, assistantMessageId, (message) => {
        const capability = message.capability ?? createCapabilityView();
        const stages = capability.stages.map((stage) => {
          if (stage.id !== event.stage) return stage;
          if (event.kind === 'stage_start') return { ...stage, status: 'running' as const };
          if (event.kind === 'stage_end') return { ...stage, status: 'success' as const };
          if (event.kind === 'stage_retry') return { ...stage, status: 'running' as const, detail: event.error };
          return { ...stage, status: 'running' as const, detail: event.detail };
        });

        return {
          ...message,
          capability: {
            ...capability,
            activeStage: event.kind === 'stage_end' ? capability.activeStage : event.stage,
            stages,
          },
        };
      });

      if (isTargetSessionActive()) {
        setStatusMessage(
          event.kind === 'stage_retry'
            ? l(`阶段 ${event.stage} 正在重试。`, `Retrying ${event.stage}.`)
            : l(`对比调研：${event.stage}`, `Comparative survey: ${event.stage}`),
        );
      }
    };
    const agentStreamHandlers: LibraryAgentStreamHandlers = {
      onDelta: (_delta, fullText) => {
        streamedAgentAnswer = fullText;
        scheduleStreamedAgentMessageCommit();
      },
      onThinkingDelta: (_delta, fullText) => {
        streamedAgentThinking = fullText;
        scheduleStreamedAgentMessageCommit();
      },
      onLoopEvent: handleAgentLoopEvent,
      onCapabilityEvent: handleCapabilityEvent,
      onCapabilityUsage: (usage) => {
        runTokens.promptTokens += usage.promptTokens;
        runTokens.completionTokens += usage.completionTokens;
        if (runId) {
          const targetRunId = runId;
          runEventQueue = runEventQueue
            .then(() => appendAgentRunEvent({
              runId: targetRunId,
              kind: 'capability',
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              payload: { capabilityId: 'comparative-survey', usage },
            }))
            .then(() => undefined)
            .catch(() => undefined);
        }
        setSessionTokenUsage((current) => ({
          ...current,
          [sessionId]: (current[sessionId] ?? 0) + usage.promptTokens + usage.completionTokens,
        }));
        if (isTargetSessionActive()) {
          setCurrentRunTokens({ ...runTokens });
        }
      },
      onCapabilityCheckpoint: (artifacts) => {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          capability: {
            ...(message.capability ?? createCapabilityView()),
            artifacts,
          },
        }));
        if (runId) {
          const targetRunId = runId;
          runEventQueue = runEventQueue
            .then(() => appendAgentRunEvent({
              runId: targetRunId,
              kind: 'checkpoint',
              payload: { capabilityId: 'comparative-survey', artifacts },
            }))
            .then(() => undefined)
            .catch(() => undefined);
        }
      },
      onRecoveryCheckpoint: appendRecoveryCheckpoint,
      onError: (message) => {
        if (isTargetSessionActive()) {
          setStatusMessage(message);
        }
      },
    };

    setLastInstruction(instruction);
    setMessages(nextMessages);
    upsertSessionSnapshot(sessionId, nextMessages, selectedPaperIdsSnapshot, instruction);
    setComposerValue('');
    setAgentAttachments([]);
    setAgentSessionRunning(sessionId, true);
    setError('');
    setPlan(null);
    setApprovedItemIds(new Set());
    setCurrentRunTokens({ promptTokens: 0, completionTokens: 0 });

    try {
      const preset = await loadLibraryAgentModelPresetById(selectedAgentPresetId);

      if (!preset) {
        throw new Error(l('请先在设置里配置 Agent 工具调用模型。', 'Configure the Agent tool-calling model in Settings first.'));
      }

      const runtimePreset =
        selectedAgentReasoningEffort === 'auto'
          ? preset
          : { ...preset, reasoningEffort: selectedAgentReasoningEffort };

      try {
        runId = crypto.randomUUID();
        await startAgentRun({
          runId,
          sessionId,
          model: runtimePreset.model,
          presetId: runtimePreset.id,
          instruction,
        });
      } catch {
        // Observability must not prevent the user from receiving an Agent response.
        runId = null;
      }

      if (isTargetSessionActive()) {
        setStatusMessage(
          useCategoryScope && categoryScope
            ? l(
              `正在调用大模型 Agent：${preset.label || preset.model}。本轮使用分类「${categoryScope.path}」中的 ${paperCount} 篇文献。`,
              `Calling Agent model: ${preset.label || preset.model}. This turn uses ${paperCount} papers in "${categoryScope.path}".`,
            )
            : useInlinePaperScope
              ? l(
                `正在调用大模型 Agent：${preset.label || preset.model}。本轮使用对话内选择的 ${paperCount} 篇论文。`,
                `Calling Agent model: ${preset.label || preset.model}. This turn uses ${paperCount} papers selected in chat.`,
              )
              : useFullLibraryCandidates
              ? l(
                `正在调用大模型 Agent：${preset.label || preset.model}。未手动选择文献，RAG 使用全库候选 ${paperCount} 篇。`,
                `Calling Agent model: ${preset.label || preset.model}. No papers were manually selected, so RAG uses ${paperCount} full-library candidates.`,
              )
              : l(
                `正在调用大模型 Agent：${preset.label || preset.model}...`,
                `Calling Agent model: ${preset.label || preset.model}...`,
              ),
        );
      }

      const result = await runConversationalLibraryAgent({
        papers: modelPapersSnapshot,
        categories,
        instruction,
        preset: runtimePreset,
        streamHandlers: agentStreamHandlers,
        historyMessages,
        currentPaperScopeIds: selectedPaperIdsSnapshot,
        paperScopes: paperScopesSnapshot,
        responseLanguage: locale === 'en-US' ? 'English' : 'Simplified Chinese',
        ragEnabled: agentRagEnabled,
        attachments: attachmentsSnapshot,
        signal: abortController.signal,
        capabilityResume: effectiveCapabilityResume,
        loopResumeMessages: effectiveLoopResumeMessages,
      });
      const durationMs = Math.round(performance.now() - startedAt);

      if (result.kind === 'capability') {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: result.result.markdown,
          meta: `comparative-survey · ${durationLabel(durationMs, locale)}`,
          ragCitations: result.citations,
          ragFigures: result.figures,
          visionNotice: result.visionNotice,
          ragNotice: result.ragNotice,
          capability: {
            ...(message.capability ?? createCapabilityView()),
            status: 'done',
            activeStage: 'report',
            stages: (message.capability ?? createCapabilityView()).stages.map((stage) => ({
              ...stage,
              status: 'success',
            })),
            artifacts: result.result.artifacts,
          },
          error: undefined,
        }));
        runTurns = 4;
        if (isTargetSessionActive()) {
          setCurrentRunTokens({ ...runTokens });
          setStatusMessage(l('对比调研报告已完成。', 'Comparative survey report completed.'));
        }
        return;
      }

      if (result.kind === 'answer') {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: result.answer,
          meta: `${result.contextLabel} · ${durationLabel(durationMs, locale)}`,
          thinking: result.thinking,
          ragCitations: result.citations,
          ragFigures: result.figures,
          visionNotice: result.visionNotice,
          ragNotice: result.ragNotice,
          trace: message.trace,
          toolCall: undefined,
          plan: undefined,
          choices: undefined,
          paperSelectionRequest: undefined,
          error: undefined,
        }));
        if (isTargetSessionActive()) {
          setStatusMessage(
            l(
              `已直接回答，无需工具调用。${durationLabel(durationMs, locale)}`,
              `Answered directly without tool calls. ${durationLabel(durationMs, locale)}`,
            ),
          );
        }
        return;
      }

      if (result.kind === 'choice') {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: result.answer,
          meta: `waiting for choice · ${durationLabel(durationMs, locale)}`,
          thinking: result.thinking,
          ragCitations: result.citations,
          ragFigures: result.figures,
          visionNotice: result.visionNotice,
          ragNotice: result.ragNotice,
          trace: message.trace,
          toolCall: undefined,
          plan: undefined,
          choices: result.choices,
          paperSelectionRequest: undefined,
          error: undefined,
        }));
        if (isTargetSessionActive()) {
          setStatusMessage(
            l(
              `Agent 需要你选择下一步，共 ${result.choices.length} 个选项。`,
              `The Agent needs your next-step choice. ${result.choices.length} options available.`,
            ),
          );
        }
        return;
      }

      if (result.kind === 'paper-selection') {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: result.answer,
          meta: `paper selection · ${durationLabel(durationMs, locale)}`,
          thinking: result.thinking,
          ragCitations: undefined,
          trace: message.trace,
          toolCall: undefined,
          plan: undefined,
          choices: undefined,
          paperSelectionRequest: result.request,
          error: undefined,
        }));
        if (isTargetSessionActive()) {
          setStatusMessage(
            l(
              'Agent 需要文献上下文。请在对话里的论文选择框中勾选目标论文后继续。',
              'The Agent needs paper context. Select target papers in the chat picker and continue.',
            ),
          );
        }
        return;
      }

      if (result.kind === 'memory-plan') {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: l(
            '模型建议更新本地 Agent 记忆。请审核内容后确认写入。',
            'The model proposed a local Agent memory update. Review it before applying.',
          ),
          meta: `memory approval · ${durationLabel(durationMs, locale)}`,
          thinking: message.thinking,
          ragCitations: result.citations,
          ragFigures: result.figures,
          visionNotice: result.visionNotice,
          ragNotice: result.ragNotice,
          trace: message.trace,
          toolCall: undefined,
          plan: undefined,
          memoryPlan: result.memoryPlan,
          choices: undefined,
          paperSelectionRequest: undefined,
          error: undefined,
        }));
        if (isTargetSessionActive()) {
          setStatusMessage(result.memoryPlan.summary);
        }
        return;
      }

      const nextPlan = result.plan;
      const nextToolCall = buildToolCallView(nextPlan, instruction, paperCount, durationMs, locale);

      updateSessionMessage(sessionId, assistantMessageId, (message) => ({
        ...message,
        content:
          nextPlan.items.length > 0
            ? l(
              `模型建议使用「${localizedToolLabel(nextPlan.tool)}」。已生成 ${nextPlan.items.length} 个待确认计划项，点击同意后才会执行。`,
              `The model suggested "${localizedToolLabel(nextPlan.tool)}". ${nextPlan.items.length} pending plan items were generated and will run only after approval.`,
            )
            : l(
              `模型建议使用「${localizedToolLabel(nextPlan.tool)}」，但当前没有需要变更的计划项。`,
              `The model suggested "${localizedToolLabel(nextPlan.tool)}", but there are no changes to apply.`,
            ),
        meta: `${toolFunctionName(nextPlan.tool)} · ${durationLabel(durationMs, locale)}`,
        thinking: result.thinking,
        ragCitations: result.citations,
        ragFigures: result.figures,
        visionNotice: result.visionNotice,
        ragNotice: result.ragNotice,
        trace: message.trace,
        toolCall: nextToolCall,
        plan: nextPlan,
        choices: undefined,
        paperSelectionRequest: undefined,
        error: undefined,
      }));
      if (isTargetSessionActive()) {
        setNextPlan(nextPlan);
        setExpandedStepKeys((current) => new Set([
          ...current,
          `${assistantMessageId}:intent`,
          `${assistantMessageId}:tool-call`,
          `${assistantMessageId}:tool-result`,
        ]));
        setStatusMessage(nextPlan.description);
      }
    } catch (nextError) {
      runStatus = nextError instanceof Error && nextError.name === 'AbortError' ? 'aborted' : 'error';
      const message = nextError instanceof Error ? nextError.message : l('生成 Agent 计划失败', 'Failed to generate Agent plan');
      const durationMs = Math.round(performance.now() - startedAt);

      updateSessionMessage(sessionId, assistantMessageId, (chatMessage) => ({
        ...chatMessage,
        content: runStatus === 'aborted'
          ? l('已取消当前 Agent 运行。', 'The current Agent run was cancelled.')
          : message.includes('tool call')
          ? l(
            '当前模型没有返回 tool call。请换用支持 OpenAI-compatible tools/function calling 的模型。',
            'The current model did not return a tool call. Use a model that supports OpenAI-compatible tools/function calling.',
          )
          : l(`生成计划失败：${message}`, `Plan generation failed: ${message}`),
        meta: `error · ${durationLabel(durationMs, locale)}`,
        trace: applyAgentLoopEventToTrace(chatMessage.trace, { kind: 'error', message }, locale),
        ragCitations: undefined,
        toolCall: undefined,
        plan: undefined,
        choices: undefined,
        paperSelectionRequest: undefined,
        error: runStatus === 'aborted' ? undefined : message,
        capability: chatMessage.capability
          ? { ...chatMessage.capability, status: runStatus === 'aborted' ? 'aborted' : 'error' }
          : undefined,
      }));
      if (isTargetSessionActive()) {
        if (runStatus !== 'aborted') {
          setError(message);
        }
        setStatusMessage(runStatus === 'aborted' ? l('已取消当前运行。', 'Current run cancelled.') : message);
      }
    } finally {
      if (streamCommitTimer !== null) {
        window.clearTimeout(streamCommitTimer);
      }

      commitStreamedAgentMessage();
      if (runId) {
        await runEventQueue;
        try {
          await finishAgentRun({
            runId,
            status: runStatus,
            turns: runTurns,
          });
        } catch {
          // The primary answer has already been delivered; avoid surfacing telemetry-only failures.
        }
      }
      setAgentSessionRunning(sessionId, false);
      abortControllersRef.current.delete(sessionId);
    }
  };

  const handleCancelAgentRun = () => {
    const controller = abortControllersRef.current.get(activeSessionId);

    if (!controller) {
      return;
    }

    controller.abort();
    setStatusMessage(l('正在取消当前运行...', 'Cancelling the current run...'));
  };

  const submitPrompt = (value: string) => {
    void runAgent(value);
  };

  const handleOrganizeAgentMemory = () => {
    const instruction = l(
      '读取今天的 Agent trace 与现有 L2/L3 记忆，整理出可审核的 L2 或 L3 更新；如无可靠新事实则直接说明。',
      'Read today\'s Agent trace and existing L2/L3 memory, then propose a reviewable L2 or L3 update. If no reliable new fact exists, explain that directly.',
    );
    setStatusMessage(l('正在整理 Agent 记忆。', 'Organizing Agent memory.'));
    void runAgent(instruction);
  };

  const applyPlan = async () => {
    if (applyingPlan) {
      return;
    }
    if (!plan || approvedItemIds.size === 0) {
      setError(l('没有可执行的计划项。', 'There are no executable plan items.'));
      return;
    }

    const sessionId = activeSessionId;
    const planToApply = plan;
    const approvedIdsSnapshot = new Set(approvedItemIds);
    const isTargetSessionActive = () => activeSessionIdRef.current === sessionId;

    setApplyingPlan(true);
    setError('');
    if (isTargetSessionActive()) {
      setStatusMessage(
        l(
          `正在执行 ${approvedIdsSnapshot.size} 个计划项...`,
          `Running ${approvedIdsSnapshot.size} plan items...`,
        ),
      );
    }

    try {
      const result = await applyLibraryAgentPlan(planToApply, approvedIdsSnapshot);

      await refreshPapers();
      if (isTargetSessionActive()) {
        setPlan(null);
        setApprovedItemIds(new Set());
        setStatusMessage(
          l(
            `执行完成：成功 ${result.applied}，失败 ${result.failed}。`,
            `Execution finished: ${result.applied} succeeded, ${result.failed} failed.`,
          ),
        );
      }
      appendAssistantMessageToSession(
        sessionId,
        l(`已执行计划：成功 ${result.applied} 项，失败 ${result.failed} 项。`, `Plan executed: ${result.applied} succeeded, ${result.failed} failed.`),
        result.failed > 0 ? result.errors.join('\n') : l('本地写入已完成', 'Local write completed'),
      );

      if (result.failed > 0) {
        if (isTargetSessionActive()) {
          setError(result.errors.join('\n') || l('部分计划项执行失败。', 'Some plan items failed.'));
        }
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('执行 Agent 计划失败', 'Failed to execute Agent plan');
      if (isTargetSessionActive()) {
        setError(message);
        setStatusMessage(message);
      }
      appendAssistantMessageToSession(
        sessionId,
        l(`执行计划失败：${message}`, `Plan execution failed: ${message}`),
      );
    } finally {
      setApplyingPlan(false);
    }
  };

  const applyMemoryPlan = async (memoryPlan: AgentMemoryWritePlan) => {
    try {
      await writeAgentMemory(memoryPlan.file, memoryPlan.content);
      appendAssistantMessageToSession(
        activeSessionId,
        l('已写入本地 Agent 记忆。', 'Local Agent memory was updated.'),
        memoryPlan.summary,
      );
      setStatusMessage(l('已写入 Agent 记忆。', 'Agent memory updated.'));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('写入 Agent 记忆失败', 'Failed to update Agent memory');
      setError(message);
      setStatusMessage(message);
    }
  };

  const cancelPlan = () => {
    setPlan(null);
    setApprovedItemIds(new Set());
    setStatusMessage(l('已取消当前计划。', 'Canceled the current plan.'));
  };

  const togglePlanItem = (itemId: string) => {
    const item = plan?.items.find((planItem) => planItem.id === itemId);

    setApprovedItemIds((current) => {
      const next = new Set(current);
      const wasApproved = next.has(itemId);

      if (wasApproved) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }

      setStatusMessage(
        l(
          `${wasApproved ? '已取消勾选' : '已勾选'}：${item?.paperTitle ?? '计划项'}`,
          `${wasApproved ? 'Unchecked' : 'Checked'}: ${item?.paperTitle ?? 'plan item'}`,
        ),
      );
      return next;
    });
  };

  const toggleTool = (toolCallId: string) => {
    setExpandedToolIds((current) => {
      const next = new Set(current);
      const expanded = next.has(toolCallId);

      if (expanded) {
        next.delete(toolCallId);
      } else {
        next.add(toolCallId);
      }

      setStatusMessage(expanded ? l('已收起工具调用详情。', 'Collapsed tool-call details.') : l('已展开工具调用详情。', 'Expanded tool-call details.'));
      return next;
    });
  };

  const toggleStep = (stepKey: string) => {
    setExpandedStepKeys((current) => {
      const next = new Set(current);

      if (next.has(stepKey)) {
        next.delete(stepKey);
      } else {
        next.add(stepKey);
      }

      return next;
    });
  };

  const handleModifyPreviousParameters = () => {
    const nextInstruction = l(`修改上一版参数：${lastInstruction || composerValue}`, `Modify the previous parameters: ${lastInstruction || composerValue}`);
    setComposerValue(nextInstruction);
    setStatusMessage(l('已把修改参数指令放入输入框，请编辑后重新发送。', 'The parameter-edit instruction was placed into the input. Edit it and send again.'));
  };

  const handleRetryAgent = (instruction: string) => {
    const nextInstruction = instruction.trim();

    if (!nextInstruction) {
      setStatusMessage(l('没有可重试的上一条指令。', 'There is no previous instruction to retry.'));
      return;
    }

    setStatusMessage(l('正在重新生成 Agent 计划。', 'Regenerating the Agent plan.'));
    void runAgent(nextInstruction);
  };

  const handleAgentChoice = (instruction: string, paperScopeIds?: string[]) => {
    const nextInstruction = instruction.trim();

    if (!nextInstruction) {
      setStatusMessage(l('这个选项没有可执行指令。', 'This option has no executable instruction.'));
      return;
    }

    setComposerValue(nextInstruction);
    setStatusMessage(l('已选择 Agent 建议，正在继续执行。', 'Selected the Agent suggestion. Continuing execution.'));
    void runAgent(nextInstruction, paperScopeIds);
  };

  const handleInlinePaperSelectionContinue = (instruction: string, paperIds: string[]) => {
    const nextInstruction = instruction.trim();

    if (!nextInstruction) {
      setStatusMessage(l('这个请求没有可继续执行的指令。', 'This request has no instruction to continue.'));
      return;
    }

    if (paperIds.length === 0) {
      setStatusMessage(l('请先在这条消息里选择至少一篇论文。', 'Select at least one paper in this message first.'));
      return;
    }

    setStatusMessage(
      l(
        `已选择 ${paperIds.length} 篇论文，正在继续执行当前任务。`,
        `Selected ${paperIds.length} papers. Continuing the current task.`,
      ),
    );
    void runAgent(nextInstruction, paperIds);
  };

  const handleSelectAgentAttachments = async (kind: 'image' | 'file') => {
    try {
      const paths = await selectChatAttachmentPaths(kind);

      if (paths.length === 0) {
        setStatusMessage(
          kind === 'image'
            ? l('已取消选择图片附件。', 'Cancelled image attachment selection.')
            : l('已取消选择文件附件。', 'Cancelled file attachment selection.'),
        );
        return;
      }

      const attachments = await Promise.all(
        paths.map((path) => buildAttachmentFromPath(path, kind, locale)),
      );

      setAgentAttachments((current) => mergeUniqueAgentAttachments(current, attachments));
      setStatusMessage(
        l(`已添加 ${attachments.length} 个附件。`, `Added ${attachments.length} attachment(s).`),
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('加载 Agent 附件失败', 'Failed to load Agent attachments');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleCaptureAgentScreenshot = async () => {
    if (capturingScreenshot) {
      return;
    }

    try {
      setCapturingScreenshot(true);
      setError('');
      setStatusMessage(l('正在启动系统截图...', 'Starting system screenshot...'));
      const screenshot = await captureSystemScreenshot();

      if (!screenshot) {
        setStatusMessage(l('已取消系统截图。', 'System screenshot cancelled.'));
        return;
      }

      const attachment = await buildScreenshotAttachmentFromPath(screenshot.path, locale);
      setAgentAttachments((current) => mergeUniqueAgentAttachments(current, [attachment]));
      setStatusMessage(
        l(`已添加系统截图：${attachment.name}`, `Screenshot attached: ${attachment.name}`),
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('系统截图失败', 'System screenshot failed');
      setError(message);
      setStatusMessage(message);
    } finally {
      setCapturingScreenshot(false);
    }
  };

  const handleRemoveAgentAttachment = (attachmentId: string) => {
    setAgentAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleToggleAgentRag = () => {
    setAgentRagEnabled((current) => {
      const next = !current;

      setStatusMessage(
        next
          ? l('已开启 Agent RAG，上下文请求会优先尝试本地检索。', 'Agent RAG enabled. Context requests will try local retrieval first.')
          : l('已关闭 Agent RAG，上下文请求将直接使用 PDF 全文。', 'Agent RAG disabled. Context requests will use raw PDF text directly.'),
      );

      return next;
    });
  };

  const handleAgentPresetChange = (presetId: string) => {
    const nextPreset = agentModelPresets.find((preset) => preset.id === presetId) ?? agentModelPresets[0] ?? null;

    if (!nextPreset) {
      return;
    }

    setSelectedAgentPresetId(nextPreset.id);
    setStatusMessage(
      l(`已切换 Agent 模型：${nextPreset.label || nextPreset.model}`, `Switched Agent model: ${nextPreset.label || nextPreset.model}`),
    );
  };

  const handleNewAgentSession = () => {
    if (!hasAgentConversationHistory(messages)) {
      setPlan(null);
      setApprovedItemIds(new Set());
      setLastInstruction('');
      setComposerValue('');
      setAgentAttachments([]);
      setAgentRagEnabled(true);
      setSelectedAgentPresetId((current) => current ?? agentModelPresets[0]?.id ?? null);
      setError('');
      setStatusMessage(l('当前已经是新的空白对话。', 'You are already in a blank new chat.'));
      return;
    }

    setActiveSessionId(newAgentSessionId());
    setMessages([createLocalizedWelcomeMessage()]);
    setPlan(null);
    setApprovedItemIds(new Set());
    setLastInstruction('');
    setComposerValue('');
    setAgentAttachments([]);
    setAgentRagEnabled(true);
    setSelectedAgentPresetId((current) => current ?? agentModelPresets[0]?.id ?? null);
    setError('');
    setStatusMessage(l('已创建新的 Agent 对话。', 'Created a new Agent chat.'));
  };

  const handleForkFromMessage = (messageId: string) => {
    const source = historySessions.find((session) => session.id === activeSessionId) ?? buildAgentHistorySession({
      id: activeSessionId,
      messages,
      selectedPaperIds: [...selectedPaperIds],
      lastInstruction,
      ragEnabled: agentRagEnabled,
      selectedModelPresetId: selectedAgentPresetId ?? undefined,
      attachments: agentAttachments,
      locale,
    });
    const fork = forkAgentHistorySession({
      source,
      messageId,
      forkSessionId: newAgentSessionId(),
      locale,
    });

    if (!fork) {
      setStatusMessage(l('无法从该消息创建分支。', 'Unable to create a branch from this message.'));
      return;
    }

    setHistorySessions((current) => [fork, ...current.filter((session) => session.id !== fork.id)].slice(0, 30));
    setActiveSessionId(fork.id);
    activeSessionIdRef.current = fork.id;
    setMessages(fork.messages);
    setSelectedPaperIds(new Set(fork.selectedPaperIds));
    setLastInstruction(fork.lastInstruction);
    setAgentRagEnabled(fork.ragEnabled !== false);
    setSelectedAgentPresetId(fork.selectedModelPresetId ?? agentModelPresets[0]?.id ?? null);
    setAgentAttachments(fork.attachments ?? []);
    restoreDraftStateFromMessages(fork.messages);
    setComposerValue('');
    setPlan(null);
    setApprovedItemIds(new Set());
    setStatusMessage(l('已从该消息创建新分支。', 'Created a new branch from this message.'));
  };

  const handleOpenHistorySession = (session: AgentHistorySession) => {
    setActiveSessionId(session.id);
    activeSessionIdRef.current = session.id;
    setMessages(session.messages);
    setSelectedPaperIds(new Set(session.selectedPaperIds));
    setLastInstruction(session.lastInstruction);
    setAgentRagEnabled(session.ragEnabled !== false);
    setSelectedAgentPresetId(session.selectedModelPresetId ?? agentModelPresets[0]?.id ?? null);
    setAgentAttachments(session.attachments ?? []);
    restoreDraftStateFromMessages(session.messages);
    setComposerValue('');
    setError('');
    setStatusMessage(l(`已打开历史对话：${session.title}`, `Opened history chat: ${session.title}`));

    void (async () => {
      try {
        const [interruptedRun] = await listInterruptedAgentRuns(session.id);

        if (!interruptedRun || activeSessionIdRef.current !== session.id) {
          return;
        }

        const events = await getAgentRunEvents(interruptedRun.runId);
        const checkpoint = latestAgentRecoveryCheckpoint(events);
        const capabilityCheckpoint = latestComparativeSurveyCheckpoint(events);

        if (capabilityCheckpoint) {
          const resumeCapability = window.confirm(l(
            '上次对比调研被中断。是否从最近完成的阶段继续？',
            'The previous comparative survey was interrupted. Continue from the most recently completed stage?',
          ));

          await finishAgentRun({ runId: interruptedRun.runId, status: 'aborted' }).catch(() => {});

          if (resumeCapability) {
            pendingCapabilityResumeRef.current.set(session.id, {
              instruction: session.lastInstruction,
              artifacts: capabilityCheckpoint,
            });
            setComposerValue(session.lastInstruction);
            setStatusMessage(l(
              '已恢复对比调研阶段检查点；发送输入框中的原任务即可继续。',
              'The comparative-survey stage checkpoint was restored. Send the original task in the composer to continue.',
            ));
          } else {
            setStatusMessage(l(
              '已放弃恢复上次对比调研，并将中断运行标记为已取消。',
              'The previous comparative survey was not restored and its interrupted run was marked aborted.',
            ));
          }
          return;
        }

        if (!checkpoint) {
          await finishAgentRun({ runId: interruptedRun.runId, status: 'aborted' }).catch(() => {});
          setStatusMessage(l(
            '上次运行没有可恢复的完整轮次，已将其标记为取消。',
            'The previous run had no complete recoverable turn and was marked aborted.',
          ));
          return;
        }

        const resumeLoop = window.confirm(l(
          '上次 Agent 运行被中断。是否从最近完整轮次恢复到输入区继续？',
          'The previous Agent run was interrupted. Restore the most recent complete turn to continue?',
        ));
        await finishAgentRun({ runId: interruptedRun.runId, status: 'aborted' }).catch(() => {});

        if (!resumeLoop) {
          setStatusMessage(l(
            '已放弃恢复上次运行，并将其标记为取消。',
            'The previous run was not restored and was marked aborted.',
          ));
          return;
        }

        const recoveredMessages = recoveryCheckpointToChatMessages(checkpoint);

        if (recoveredMessages.length === 0 || activeSessionIdRef.current !== session.id) {
          return;
        }

        setMessages(recoveredMessages);
        setHistorySessions((current) => upsertAgentHistorySession(current, {
          sessionId: session.id,
          messages: recoveredMessages,
          selectedPaperIds: session.selectedPaperIds,
          lastInstruction: session.lastInstruction,
          ragEnabled: session.ragEnabled,
          selectedModelPresetId: session.selectedModelPresetId,
          attachments: session.attachments,
          locale,
        }));
        setComposerValue(session.lastInstruction);
        pendingLoopResumeRef.current.set(session.id, {
          instruction: session.lastInstruction,
          messages: checkpoint,
        });
        setStatusMessage(l(
          '已恢复到最近完整轮次；发送输入框中的原任务即可从检查点继续。',
          'Restored the most recent complete turn. Send the original task in the composer to continue from the checkpoint.',
        ));
      } catch {
        // Recovery is optional; an unavailable trace must not prevent opening history.
      }
    })();
  };

  const handleDeleteHistorySession = (sessionId: string) => {
    setHistorySessions((current) => current.filter((session) => session.id !== sessionId));

    if (sessionId === activeSessionId) {
      setActiveSessionId(newAgentSessionId());
      setMessages([createLocalizedWelcomeMessage()]);
      setPlan(null);
      setApprovedItemIds(new Set());
      setLastInstruction('');
      setComposerValue('');
      setAgentAttachments([]);
      setAgentRagEnabled(true);
      setSelectedAgentPresetId((current) => current ?? agentModelPresets[0]?.id ?? null);
      setError('');
    }

    setStatusMessage(l('已删除 Agent 历史对话。', 'Deleted the Agent chat history item.'));
  };

  const handleClearAgentHistory = () => {
    const nextSessionId = newAgentSessionId();
    const nextMessages = [createLocalizedWelcomeMessage()];

    setActiveSessionId(nextSessionId);
    setMessages(nextMessages);
    setPlan(null);
    setApprovedItemIds(new Set());
    setLastInstruction('');
    setComposerValue('');
    setAgentAttachments([]);
    setAgentRagEnabled(true);
    setSelectedAgentPresetId((current) => current ?? agentModelPresets[0]?.id ?? null);
    setHistorySessions([]);
    setStatusMessage(l('已清空 Agent 历史记录。', 'Cleared Agent history.'));
  };

  const formatHistoryTime = (timestamp: number) =>
    new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);

  return (
    <AgentWorkspaceView
      activeSessionId={activeSessionId}
      activeSessionRunning={activeSessionRunning}
      agentAttachments={agentAttachments}
      agentModelPresets={agentModelPresets}
      agentRagEnabled={agentRagEnabled}
      applyingPlan={applyingPlan}
      approvedItemIds={approvedItemIds}
      chatScrollRef={chatScrollRef}
      composerValue={composerValue}
      currentRunTokens={currentRunTokens}
      sessionTokenUsage={sessionTokenUsage}
      conversationPanelRef={conversationPanelRef}
      error={error}
      expandedStepKeys={expandedStepKeys}
      expandedToolIds={expandedToolIds}
      filteredPapers={filteredPapers}
      formatHistoryTime={formatHistoryTime}
      formatPaperMeta={formatPaperMeta}
      handleAgentChoice={handleAgentChoice}
      handleClearAgentHistory={handleClearAgentHistory}
      handleConversationWheelCapture={handleConversationWheelCapture}
      handleDeleteHistorySession={handleDeleteHistorySession}
      handleHistoryWheelCapture={handleHistoryWheelCapture}
      handleModifyPreviousParameters={handleModifyPreviousParameters}
      handleNewAgentSession={handleNewAgentSession}
      handleOpenHistorySession={handleOpenHistorySession}
      handleRetryAgent={handleRetryAgent}
      historySidebarCollapsed={historySidebarCollapsed}
      historySidebarRef={historySidebarRef}
      l={l}
      lastInstruction={lastInstruction}
      loading={loading}
      locale={locale}
      localizedToolLabel={localizedToolLabel}
      messages={messages}
      onApplyPlan={() => {
        void applyPlan();
      }}
      onApplyMemoryPlan={(memoryPlan) => {
        void applyMemoryPlan(memoryPlan);
      }}
      onCancelAgentRun={handleCancelAgentRun}
      onCancelPlan={cancelPlan}
      onClearSelection={clearSelection}
      onComposerChange={setComposerValue}
      onCopyToolParameters={(toolCall) => {
        void copyToolParameters(toolCall);
      }}
      onOpenRagCitation={handleOpenRagCitation}
      onOrganizeMemory={handleOrganizeAgentMemory}
      onAgentPresetChange={handleAgentPresetChange}
      onAgentReasoningEffortChange={setSelectedAgentReasoningEffort}
      onCaptureScreenshot={() => {
        void handleCaptureAgentScreenshot();
      }}
      onHistorySidebarCollapsedChange={setHistorySidebarCollapsed}
      onInlinePaperSelectionContinue={handleInlinePaperSelectionContinue}
      onForkFromMessage={handleForkFromMessage}
      onInspectPlanItem={(_itemId, paperTitle) => {
        setStatusMessage(l(`正在查看计划项：${paperTitle}`, `Inspecting plan item: ${paperTitle}`));
      }}
      onPaperSearchQueryChange={setPaperSearchQuery}
      onRefreshPapers={() => {
        void refreshPapers();
      }}
      onRemoveAttachment={handleRemoveAgentAttachment}
      onFindPapers={handleFindPapers}
      onRecommendPapers={handleRecommendPapers}
      onSelectAllVisible={selectAllVisible}
      onSelectFileAttachments={() => {
        void handleSelectAgentAttachments('file');
      }}
      onSelectImageAttachments={() => {
        void handleSelectAgentAttachments('image');
      }}
      onSubmitPrompt={submitPrompt}
      onToggleAgentRag={handleToggleAgentRag}
      onTogglePaper={togglePaper}
      onUseFullLibraryRag={handleUseFullLibraryRag}
      onTogglePlanItem={togglePlanItem}
      onToggleStep={toggleStep}
      onToggleTool={toggleTool}
      paperSearchQuery={paperSearchQuery}
      papers={papers}
      plan={plan}
      promptSuggestions={locale === 'en-US' ? promptSuggestionsEn : promptSuggestions}
      selectedAgentPresetId={selectedAgentPresetId ?? ''}
      selectedAgentReasoningEffort={selectedAgentReasoningEffort}
      selectedPaperIds={selectedPaperIds}
      selectedPapers={selectedPapers}
      selectedTags={selectedTags}
      screenshotLoading={capturingScreenshot}
      setStatusMessage={setStatusMessage}
      sortedHistorySessions={sortedHistorySessions}
    />
  );
}

export default AgentWorkspace;
