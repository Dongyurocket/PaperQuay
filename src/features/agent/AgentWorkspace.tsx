import { useEffect, useMemo, useRef, useState } from 'react';
import { useWheelScrollDelegate } from '../../hooks/useWheelScrollDelegate';
import {
  applyLibraryAgentPlan,
  loadLibraryAgentAvailableModelPresets,
  loadLibraryAgentModelPresetById,
  runConversationalLibraryAgent,
  verifyLibraryAgentAnswerCitations,
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
  createAgentMemoryWritePlan,
  readAgentMemory,
  writeAgentMemory,
  type AgentMemoryWritePlan,
} from '../../services/agentMemory';
import { mergeRejectedClaims, type RejectedClaimLine } from '../../services/agentMemoryContract';
import {
  applyAgentNoteWritePlan,
  type AgentNoteWritePlan,
} from '../../services/agentNotePlan';
import type { AgentLoopEvent, AgentLoopMessage } from '../../services/agentLoop';
import { isComparativeSurveyInstruction } from '../../services/agentCapabilityTrigger';
import type { ComparativeSurveyArtifacts } from '../../services/agentCapability';
import {
  type AgentCapabilityEvent,
  type AgentCapabilityId,
  getAgentCapability,
} from '../../services/agentCapabilityRegistry';
import { resolveAgentCapabilityRoute } from '../../services/agentCapabilityRoute';
import { deriveAgentDeliveryRequirement } from '../../services/agentDeliveryQuality';
import { normalizeSurveyCoverageLedger } from '../../services/agentSurveyCoverage';
import { listLibraryCategories, listLibraryPapers } from '../../services/library';
import { paperPdfPath } from '../../utils/libraryPaper';
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
  latestAgentRecoveryCitations,
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
  settleAgentTrace,
  formatPaperMeta,
  hasAgentConversationHistory,
  loadAgentHistorySessions,
  normalizeAgentHistorySessionMeta,
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
import type { AgentCapabilityView, AgentChatMessage, AgentHistorySession, AgentToolCallView } from './AgentWorkspace.types';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import {
  emitJumpToNoteAnchor,
  OPEN_AGENT_WITH_INSTRUCTION_EVENT,
} from '../../app/appEvents';
import AgentWorkspaceView from './AgentWorkspaceView';
import { buildAttachmentFromPath, buildScreenshotAttachmentFromPath } from '../reader/documentReaderShared';
import { captureSystemScreenshot, selectChatAttachmentPaths } from '../../services/desktop';
import { mergeUniqueAgentAttachments } from './agentAttachmentUtils';
import {
  buildConversationPaperScopes,
  containsLegacyMojibake,
  hasSameAgentHistoryMessages,
  resolveAgentWorkspacePaperScope,
} from './agentPaperScopes';
import { createAgentStreamMessageBuffer } from './agentStreamMessageBuffer';

const AGENT_CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD = 96;

function isNearScrollBottom(element: HTMLElement, threshold = AGENT_CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function createAgentRagCitationJumpRequestId(): string {
  return `agent-rag-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createCapabilityView(id: AgentCapabilityId = 'comparative-survey'): AgentCapabilityView {
  const definition = getAgentCapability(id) ?? getAgentCapability('comparative-survey')!;
  return {
    id: definition.id,
    status: 'running' as const,
    activeStage: undefined,
    stages: definition.stages.map((stageId) => ({
      id: stageId,
      status: 'waiting' as const,
    })),
  };
}

function recoverySnapshotMessages(messages: AgentLoopMessage[]) {
  // 始终保留系统提示；窗口不从 tool 消息开始，避免产生没有前置 assistant toolCalls 的孤儿消息。
  const root = messages[0]?.role === 'system' ? messages[0] : null;
  const rest = root ? messages.slice(1) : messages;
  let windowed = rest.slice(-32);

  while (windowed.length > 0 && windowed[0]?.role === 'tool') {
    windowed = windowed.slice(1);
  }

  return [...(root ? [root] : []), ...windowed].map((message) => ({
    role: message.role,
    // Tool results have already passed the loop budget. Preserve their JSON
    // and continuation arguments verbatim so recovery cannot create half a record.
    content: message.role === 'tool' ? message.content : message.content.slice(0, 8000),
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls?.map((call) => ({
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
  const [pinnedCapabilityId, setPinnedCapabilityId] = useState<AgentCapabilityId | 'auto'>('auto');
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
  const [cancellingSessionIds, setCancellingSessionIds] = useState<Set<string>>(() => new Set());
  const runningSessionIdsRef = useRef(runningSessionIds);
  const activeSessionIdRef = useRef(activeSessionId);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [currentRunTokens, setCurrentRunTokens] = useState({ promptTokens: 0, completionTokens: 0 });
  const [sessionTokenUsage, setSessionTokenUsage] = useState<Record<string, number>>({});
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const memoryPlanInFlightRef = useRef(new Set<string>());
  const pendingCapabilityResumeRef = useRef(new Map<string, {
    instruction: string;
    artifacts: Partial<ComparativeSurveyArtifacts>;
  }>());
  const pendingLoopResumeRef = useRef(new Map<string, {
    instruction: string;
    messages: AgentLoopMessage[];
    citations?: LibraryAgentRagCitation[];
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
    const handleOpenAgentWithInstruction = (event: Event) => {
      const instruction = (event as CustomEvent<{ instruction?: string }>).detail?.instruction?.trim();
      if (!instruction) return;
      setComposerValue(instruction);
      setStatusMessage(
        l('已载入体检修复指令，请确认后发送。', 'Health-repair instruction loaded. Review it before sending.'),
      );
    };

    window.addEventListener(OPEN_AGENT_WITH_INSTRUCTION_EVENT, handleOpenAgentWithInstruction);
    return () => {
      window.removeEventListener(OPEN_AGENT_WITH_INSTRUCTION_EVENT, handleOpenAgentWithInstruction);
    };
  }, [l]);

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
    // 有运行中的会话时（流式期间）防抖写盘，运行结束后立即落盘。
    if (runningSessionIds.size === 0) {
      saveAgentHistorySessions(historySessions);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      saveAgentHistorySessions(historySessions);
    }, 800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [historySessions, runningSessionIds]);

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
      .find((message) => message.role === 'assistant' && message.plan && !message.planStatus);
    const nextPlan = latestPlanMessage?.plan ?? null;

    setPlan(nextPlan);
    setApprovedItemIds(new Set(nextPlan?.items.map((item) => item.id) ?? []));
  };

  /** 将包含指定计划/记忆计划的消息回写终态，防止切换会话后审批卡复活并重复执行。 */
  const markPlanTerminalStatus = (
    sessionId: string,
    planId: string,
    status: 'applied' | 'cancelled',
  ) => {
    const applyStatus = (message: AgentChatMessage): AgentChatMessage =>
      message.plan?.id === planId && !message.planStatus
        ? { ...message, planStatus: status }
        : message;

    if (activeSessionIdRef.current === sessionId) {
      setMessages((current) => current.map(applyStatus));
    }

    setHistorySessions((current) => {
      const target = current.find((session) => session.id === sessionId);
      const targetMessage = target?.messages.find((entry) => entry.plan?.id === planId);

      if (!target || !targetMessage) {
        return current;
      }

      return patchAgentHistorySessionMessage(current, {
        sessionId,
        messageId: targetMessage.id,
        updater: applyStatus,
        locale,
      });
    });
  };

  const markMemoryPlanTerminalStatus = (
    sessionId: string,
    memoryPlanId: string,
    status: 'applied' | 'cancelled' | 'unchanged',
  ) => {
    const applyStatus = (message: AgentChatMessage): AgentChatMessage =>
      message.memoryPlan?.id === memoryPlanId && !message.memoryPlanStatus
        ? { ...message, memoryPlanStatus: status }
        : message;

    if (activeSessionIdRef.current === sessionId) {
      setMessages((current) => current.map(applyStatus));
    }

    setHistorySessions((current) => {
      const target = current.find((session) => session.id === sessionId);
      const targetMessage = target?.messages.find((entry) => entry.memoryPlan?.id === memoryPlanId);

      if (!target || !targetMessage) {
        return current;
      }

      return patchAgentHistorySessionMessage(current, {
        sessionId,
        messageId: targetMessage.id,
        updater: applyStatus,
        locale,
      });
    });
  };

  const markNotePlanTerminalStatus = (
    sessionId: string,
    notePlanId: string,
    status: 'applied' | 'cancelled',
  ) => {
    const applyStatus = (message: AgentChatMessage): AgentChatMessage =>
      message.notePlan?.id === notePlanId && !message.notePlanStatus
        ? { ...message, notePlanStatus: status }
        : message;

    if (activeSessionIdRef.current === sessionId) {
      setMessages((current) => current.map(applyStatus));
    }

    setHistorySessions((current) => {
      const target = current.find((session) => session.id === sessionId);
      const targetMessage = target?.messages.find((entry) => entry.notePlan?.id === notePlanId);

      if (!target || !targetMessage) {
        return current;
      }

      return patchAgentHistorySessionMessage(current, {
        sessionId,
        messageId: targetMessage.id,
        updater: applyStatus,
        locale,
      });
    });
  };

  const setAgentSessionRunning = (sessionId: string, running: boolean) => {
    // 同步更新 ref，保证运行中守卫在同一事件循环内连续调用时也能生效。
    const next = updateAgentRunningSessions(runningSessionIdsRef.current, sessionId, running);
    runningSessionIdsRef.current = next;
    setRunningSessionIds(next);
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

  const handleVerifyCitations = async (message: AgentChatMessage) => {
    const sessionId = activeSessionId;
    if (isAgentSessionRunning(runningSessionIdsRef.current, sessionId)) return;
    const controller = new AbortController();
    abortControllersRef.current.set(sessionId, controller);
    setAgentSessionRunning(sessionId, true);
    let runId: string | null = null;
    let queue = Promise.resolve();
    const tokens = { promptTokens: 0, completionTokens: 0 };
    let failed = false;
    try {
      const preset = await loadLibraryAgentModelPresetById(selectedAgentPresetId);
      if (!preset) throw new Error(l('请先配置 Agent 模型。', 'Configure an Agent model first.'));
      if (controller.signal.aborted) return;
      try {
        runId = crypto.randomUUID();
        await startAgentRun({ runId, sessionId, model: preset.model, presetId: preset.id, instruction: `Verify citations: ${message.id}` });
      } catch { runId = null; }
      updateSessionMessage(sessionId, message.id, (current) => ({ ...current, citationBindings: undefined, evidenceStats: undefined }));
      const result = await verifyLibraryAgentAnswerCitations({
        answer: message.content, citations: message.ragCitations ?? [], preset, signal: controller.signal, checkContent: true,
        streamHandlers: {
          onCapabilityUsage: (usage) => {
            tokens.promptTokens += usage.promptTokens;
            tokens.completionTokens += usage.completionTokens;
            setSessionTokenUsage((current) => ({ ...current, [sessionId]: (current[sessionId] ?? 0) + usage.promptTokens + usage.completionTokens }));
          },
          onCitationVerification: (bindings) => {
            if (!runId) return;
            const targetRunId = runId;
            queue = queue.then(() => appendAgentRunEvent({ runId: targetRunId, kind: 'citation_verification',
              payload: { messageId: message.id, bindings }, ...tokens })).then(() => undefined).catch(() => undefined);
          },
        },
      });
      updateSessionMessage(sessionId, message.id, (current) => current.content === message.content ? { ...current, ...result } : current);
      if (activeSessionIdRef.current === sessionId) setStatusMessage(l('内容检查已完成。', 'Content check completed.'));
    } catch (error) {
      failed = true;
      if (activeSessionIdRef.current === sessionId) setStatusMessage(error instanceof Error ? error.message : l('引用核验失败。', 'Citation verification failed.'));
    } finally {
      await queue;
      if (runId) await finishAgentRun({ runId, status: controller.signal.aborted ? 'aborted' : failed ? 'error' : 'done', ...tokens }).catch(() => undefined);
      if (abortControllersRef.current.get(sessionId) === controller) {
        abortControllersRef.current.delete(sessionId);
        setAgentSessionRunning(sessionId, false);
        setCancellingSessionIds((current) => {
          if (!current.has(sessionId)) return current;
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
      }
    }
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

  const handleOpenRagCitation = (citation: LibraryAgentRagCitation, referenceNumber?: number) => {
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
      anchorLabel: `${referenceNumber == null ? '' : `[${referenceNumber}] `}${citation.paperTitle}`,
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

    const currentPaperScope = resolveAgentWorkspacePaperScope({
      instruction,
      papers,
      categories,
      messages,
      selectedPaperIds,
      inlinePaperIds,
      ragEnabled: agentRagEnabled,
    });
    const { categoryScope } = currentPaperScope;
    const useInlinePaperScope = currentPaperScope.source === 'inline' || currentPaperScope.source === 'history';
    const useCategoryScope = currentPaperScope.source === 'category';
    const useFullLibraryCandidates = currentPaperScope.source === 'full-library';
    const selectedPapersSnapshot = currentPaperScope.papers;
    const selectedPaperIdsSnapshot = currentPaperScope.paperIds;
    const paperScopesSnapshot = buildConversationPaperScopes(messages, selectedPaperIdsSnapshot);
    // Historical paper scopes remain conversation context only. They must not
    // widen the current retrieval scope or introduce unselected papers into
    // model-visible metadata and evidence registration.
    const modelPapersSnapshot = selectedPapersSnapshot;
    const startedAt = performance.now();
    const assistantMessageId = newMessageId();
    const paperCount = selectedPapersSnapshot.length;
    const historyMessages = buildConversationHistory();
    const pinnedCapabilityIdForRun = effectiveCapabilityResume ? 'comparative-survey' : pinnedCapabilityId;
    // 触发判定与服务层共用同一路由解析，进度卡展示与实际执行路径保持一致。
    const capabilityRoute = resolveAgentCapabilityRoute({
      instruction,
      paperCount: modelPapersSnapshot.length,
      deliveryRequirement: deriveAgentDeliveryRequirement({ instruction, historyMessages }),
      pinnedCapabilityId: pinnedCapabilityIdForRun,
      mountContext: {
        papersCount: modelPapersSnapshot.length,
        hasOpenDocument: modelPapersSnapshot.some((paper) => Boolean(paperPdfPath(paper))),
        ragReady: Boolean(agentRagEnabled),
        localLibraryMode: true,
      },
    });
    const capabilityRequested = capabilityRoute.capabilityId !== null;
    const attachmentsSnapshot = [...agentAttachments];
    const userMessage: AgentChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: instruction,
      attachments: attachmentsSnapshot,
      paperScopeIds: currentPaperScope.source === 'empty' ? undefined : selectedPaperIdsSnapshot,
      meta: [useInlinePaperScope
        ? currentPaperScope.source === 'history'
          ? l(`沿用最近对话范围：${paperCount} 篇论文`, `Continuing the latest chat scope: ${paperCount} papers`)
          : l(`本轮已选择 ${paperCount} 篇论文`, `This turn selected ${paperCount} papers`)
        : useCategoryScope && categoryScope
        ? l(
          `文献范围：分类「${categoryScope.path}」中的 ${paperCount} 篇`,
          `Paper scope: ${paperCount} papers in category "${categoryScope.path}"`,
        )
        : useFullLibraryCandidates
          ? l(`本轮使用全库候选：${paperCount} 篇`, `This turn uses ${paperCount} full-library candidates`)
          : paperCount > 0
            ? l(`已选择 ${paperCount} 篇论文`, `${paperCount} papers selected`)
            : undefined,
        currentPaperScope.unavailablePaperIds.length > 0
          ? l(`范围中有 ${currentPaperScope.unavailablePaperIds.length} 篇已删除或不可用`, `${currentPaperScope.unavailablePaperIds.length} scoped papers are deleted or unavailable`)
          : undefined,
      ].filter(Boolean).join(' · ') || undefined,
      createdAt: Date.now(),
    };
    const pendingAssistantMessage: AgentChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      paperScopeIds: currentPaperScope.source === 'empty' ? undefined : selectedPaperIdsSnapshot,
      content: l('Agent 正在回复...', 'Agent is replying...'),
      meta: l('执行中', 'Running'),
      createdAt: Date.now(),
      trace: buildRunningTrace(instruction, paperCount, locale),
      capability: capabilityRequested && capabilityRoute.capabilityId ? createCapabilityView(capabilityRoute.capabilityId) : undefined,
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
      // delta 事件没有重放/恢复价值，不落库，避免每个 token 产生一次 IPC + SQLite 写入。
      if (!runId || event.kind === 'thinking_delta' || event.kind === 'answer_delta') {
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
    const appendRecoveryCheckpoint = (checkpointMessages: AgentLoopMessage[], turn: number, citations?: LibraryAgentRagCitation[]) => {
      if (!runId) {
        return;
      }

      const targetRunId = runId;
      runEventQueue = runEventQueue
        .then(() => appendAgentRunEvent({
          runId: targetRunId,
          kind: 'checkpoint',
          turn,
          payload: { messages: recoverySnapshotMessages(checkpointMessages), citations },
        }))
        .then(() => undefined)
        .catch(() => undefined);
    };
    const streamMessageBuffer = createAgentStreamMessageBuffer({
      isActive: isTargetSessionActive,
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => window.clearTimeout(timer),
      commit: (draft, canApply) => {
        // React may evaluate a queued updater after the request has settled.
        // Recheck the draft generation at application time as well as scheduling.
        updateMessage(assistantMessageId, (message) => canApply() ? {
          ...message,
          content: draft.answer.trim() ? draft.answer : message.content,
          thinking: draft.thinking.trim() ? draft.thinking : message.thinking,
          meta: l('流式回复中', 'Streaming'),
          error: undefined,
        } : message);
      },
    });
    const handleAgentLoopEvent = (event: AgentLoopEvent) => {
      if (streamMessageBuffer.isClosed()) return;
      if (event.kind === 'turn_start') {
        streamMessageBuffer.startTurn(event.turn);
      } else if (event.kind === 'turn_end' && !['stop', 'answer', 'max_turns'].includes(event.finishReason)) {
        // Text emitted before a tool call is a turn draft, not the final answer.
        streamMessageBuffer.discardTurn();
      }
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
    const handleCapabilityEvent = (event: AgentCapabilityEvent) => {
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
        // 分类器路由命中的能力在发送前无法预知，首个阶段事件到达时按事件携带的 capabilityId 建卡。
        const capability = message.capability ?? createCapabilityView(event.capabilityId ?? 'comparative-survey');
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
            : l(`能力阶段：${event.stage}`, `Capability stage: ${event.stage}`),
        );
      }
    };
    const agentStreamHandlers: LibraryAgentStreamHandlers = {
      onDelta: (_delta, fullText, turn) => {
        streamMessageBuffer.receiveAnswer(fullText, turn);
      },
      onThinkingDelta: (_delta, fullText, turn) => {
        streamMessageBuffer.receiveThinking(fullText, turn);
      },
      onDone: () => streamMessageBuffer.close(),
      onLoopEvent: handleAgentLoopEvent,
      onCapabilityEvent: handleCapabilityEvent,
      onCapabilityRoute: (event) => {
        // 路由事件只记 capabilityId/source/reason；分类器原始输出（含思维链）不进 trace（方案第 9 节）。
        if (!runId) {
          return;
        }
        const targetRunId = runId;
        const payload: Record<string, unknown> = event.kind === 'capability_route'
          ? { capabilityId: event.capabilityId, source: event.source, reason: event.reason }
          : { reason: event.reason };
        runEventQueue = runEventQueue
          .then(() => appendAgentRunEvent({ runId: targetRunId, kind: event.kind, payload }))
          .then(() => undefined)
          .catch(() => undefined);
      },
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
              payload: { capabilityId: usage.capabilityId, usage },
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
      onCitationVerification: (bindings) => {
        if (!runId) return;
        const targetRunId = runId;
        runEventQueue = runEventQueue.then(() => appendAgentRunEvent({
          runId: targetRunId, kind: 'citation_verification',
          payload: { bindings: bindings.map(({ tokenId, start, status, reason, model, detail }) => ({ tokenId, start, status, reason, model, detail })) },
        })).then(() => undefined).catch(() => undefined);
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
                `正在调用大模型 Agent：${preset.label || preset.model}。本轮使用全库候选 ${paperCount} 篇。`,
                `Calling Agent model: ${preset.label || preset.model}. This turn uses ${paperCount} full-library candidates.`,
              )
              : l(
                `正在调用大模型 Agent：${preset.label || preset.model}...`,
                `Calling Agent model: ${preset.label || preset.model}...`,
              ),
        );
      }

      const result = await runConversationalLibraryAgent({
        papers: modelPapersSnapshot,
        knownLibraryPapers: papers,
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
        loopResumeCitations: effectiveLoopResumeMessages ? pendingLoopResume?.citations : undefined,
        pinnedCapabilityId: pinnedCapabilityIdForRun,
      });
      streamMessageBuffer.close();
      const durationMs = Math.round(performance.now() - startedAt);

      if (result.kind === 'capability') {
        const content = result.result.kind === 'survey'
          ? result.result.survey.markdown
          : result.result.kind === 'audit'
            ? result.result.audit.markdown
            : result.result.kind === 'note-plan'
              ? result.result.answer
              : result.result.kind === 'graph-report'
                ? result.result.report.markdown
                : '';
        const artifacts = result.result.kind === 'survey' ? result.result.survey.artifacts : undefined;
        // 引用核对产物挂到消息上，rejectedClaimLines 非空时渲染「写入工作记忆」入口；
        // 笔记蒸馏走现有笔记审批卡，不新做卡片（方案第 9 节）。
        const citationAudit = result.result.kind === 'audit' ? result.result.audit : undefined;
        const notePlan = result.result.kind === 'note-plan' && result.result.notePlan
          ? result.result.notePlan
          : undefined;
        const deliveryQuality = result.result.kind === 'survey' ? result.result.survey.deliveryQuality : undefined;
        const deliveryStatus = deliveryQuality?.state === 'failed' ? 'error' : deliveryQuality?.state === 'partial' || notePlan ? 'warning' : 'success';
        const deliverySummary = deliveryQuality?.state === 'failed'
          ? l('本轮交付未完成，请查看交付检查。', 'Delivery failed; review the delivery check.')
          : deliveryQuality?.state === 'partial'
            ? l('本轮交付部分完成，请查看交付检查与待处理项。', 'Delivery is partial; review the delivery check and pending work.')
            : notePlan
              ? l('笔记计划已生成，等待审批。', 'Note plan prepared; waiting for approval.')
              : l('能力执行已结束。', 'Capability execution finished.');

        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content,
          meta: `${result.capabilityId} · ${durationLabel(durationMs, locale)}`,
          ragCitations: result.citations,
          ragFigures: result.figures,
          visionNotice: result.visionNotice,
          ragNotice: result.ragNotice,
          evidenceStats: result.evidenceStats,
          citationBindings: result.citationBindings,
          citationAudit,
          deliveryQuality,
          notePlan,
          capability: {
            ...(message.capability ?? createCapabilityView(result.capabilityId)),
            status: deliveryQuality?.state === 'failed' ? 'error' : deliveryQuality?.state === 'partial' ? 'partial' : 'done',
            activeStage: undefined,
            stages: (message.capability ?? createCapabilityView(result.capabilityId)).stages.map((stage) => ({
              ...stage,
              status: stage.id === 'report' && deliveryQuality && deliveryQuality.state !== 'complete'
                ? deliveryQuality.state === 'failed' ? 'error' : 'warning'
                : stage.id === 'research' && result.result.kind === 'survey' && result.result.survey.coverageSummary?.canResume
                  ? 'warning'
                  : artifacts?.completedStages.includes(stage.id as ComparativeSurveyArtifacts['completedStages'][number])
                    ? 'success'
                    : stage.status === 'waiting' ? 'skipped' : stage.status === 'running' ? 'warning' : stage.status,
            })),
            artifacts,
          },
          error: undefined,
          trace: settleAgentTrace(message.trace, {
            status: deliveryStatus,
            summary: deliverySummary,
            detail: deliveryQuality?.issues.map((item) => item.message).join('\n') || undefined,
            durationMs,
          }, locale),
        }));
        runTurns = 4;
        if (isTargetSessionActive()) {
          setCurrentRunTokens({ ...runTokens });
          setStatusMessage(deliverySummary);
        }
        return;
      }

      if (result.kind === 'answer') {
        const deliverySummary = result.deliveryQuality?.state === 'failed'
          ? l('回答未完成，请查看交付检查。', 'Answer failed; review the delivery check.')
          : result.deliveryQuality?.state === 'partial'
            ? l('回答部分完成，请查看交付检查。', 'Answer is partial; review the delivery check.')
            : l('回答已完成。', 'Answer completed.');
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: result.answer,
          meta: `${result.contextLabel} · ${durationLabel(durationMs, locale)}`,
          thinking: result.thinking,
          ragCitations: result.citations,
          ragFigures: result.figures,
          visionNotice: result.visionNotice,
          ragNotice: result.ragNotice,
          evidenceStats: result.evidenceStats,
          citationBindings: result.citationBindings,
          deliveryQuality: result.deliveryQuality,
          toolCall: undefined,
          plan: undefined,
          choices: undefined,
          paperSelectionRequest: undefined,
          error: undefined,
          trace: settleAgentTrace(message.trace, {
            status: result.deliveryQuality?.state === 'failed' ? 'error' : result.deliveryQuality?.state === 'partial' ? 'warning' : 'success',
            summary: deliverySummary,
            detail: result.deliveryQuality?.issues.map((item) => item.message).join('\n') || undefined,
            durationMs,
          }, locale),
        }));
        if (isTargetSessionActive()) {
          setStatusMessage(`${deliverySummary} ${durationLabel(durationMs, locale)}`);
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
          trace: settleAgentTrace(message.trace, {
            status: 'warning', summary: l('等待选择下一步。', 'Waiting for a next-step choice.'), durationMs,
          }, locale),
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
          trace: settleAgentTrace(message.trace, {
            status: 'warning', summary: l('等待选择文献范围。', 'Waiting for a paper scope selection.'), durationMs,
          }, locale),
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
          trace: settleAgentTrace(message.trace, {
            status: 'warning', summary: l('记忆计划已生成，等待审批。', 'Memory plan prepared; waiting for approval.'), durationMs,
          }, locale),
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

      if (result.kind === 'note-plan') {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: l(
            '模型建议修改笔记。请审核笔记计划后确认写入。',
            'The model proposed note changes. Review the note plan before applying.',
          ),
          meta: `note approval · ${durationLabel(durationMs, locale)}`,
          thinking: message.thinking,
          ragCitations: result.citations,
          ragFigures: result.figures,
          visionNotice: result.visionNotice,
          ragNotice: result.ragNotice,
          trace: settleAgentTrace(message.trace, {
            status: 'warning', summary: l('笔记计划已生成，等待审批。', 'Note plan prepared; waiting for approval.'), durationMs,
          }, locale),
          toolCall: undefined,
          plan: undefined,
          notePlan: result.notePlan,
          choices: undefined,
          paperSelectionRequest: undefined,
          error: undefined,
        }));
        if (isTargetSessionActive()) {
          setStatusMessage(result.notePlan.summary);
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
        trace: settleAgentTrace(message.trace, {
          status: nextPlan.items.length ? 'warning' : 'success',
          summary: nextPlan.items.length
            ? l('文库变更计划已生成，等待审批。', 'Library plan prepared; waiting for approval.')
            : l('没有需要执行的文库变更。', 'No library changes to apply.'),
          durationMs,
        }, locale),
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
      streamMessageBuffer.close();
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
        meta: `${runStatus === 'aborted' ? 'cancelled' : 'error'} · ${durationLabel(durationMs, locale)}`,
        trace: settleAgentTrace(chatMessage.trace, {
          status: runStatus === 'aborted' ? 'warning' : 'error',
          summary: runStatus === 'aborted' ? l('运行已取消，可从检查点继续。', 'Run cancelled; a checkpoint can be resumed.') : message,
          durationMs,
        }, locale),
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
      streamMessageBuffer.close();
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
      // 仅当 controller 仍是本 run 的实例时才收敛运行状态，
      // 避免旧 run 的 finally 误清新 run 的 controller 与 running 标志。
      if (abortControllersRef.current.get(sessionId) === abortController) {
        abortControllersRef.current.delete(sessionId);
        setAgentSessionRunning(sessionId, false);
        setCancellingSessionIds((current) => {
          if (!current.has(sessionId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
      }
    }
  };

  const handleCancelAgentRun = () => {
    const controller = abortControllersRef.current.get(activeSessionId);

    if (!controller) {
      setAgentSessionRunning(activeSessionId, false);
      return;
    }

    controller.abort();
    setCancellingSessionIds((current) => new Set(current).add(activeSessionId));
    // 取消的收敛完全交给 run 自身的 finally，不用定时器强制清态，避免双 run 竞态。
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

      // 执行已发生（即使部分失败），回写终态防止切换会话后计划复活重复写入。
      markPlanTerminalStatus(sessionId, planToApply.id, 'applied');
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
    if (memoryPlanInFlightRef.current.has(memoryPlan.id)) return;
    memoryPlanInFlightRef.current.add(memoryPlan.id);
    const sessionId = activeSessionId;

    try {
      // merge-rejected-claims：批准时才读当前 L2 并合并否定项，不覆盖 Current task 等段落（方案第 6.4 节）。
      let contentToWrite = memoryPlan.content;
      let mergeResult: ReturnType<typeof mergeRejectedClaims> | null = null;

      if (memoryPlan.mode === 'merge-rejected-claims' && memoryPlan.rejectedClaims?.length) {
        const existing = await readAgentMemory(memoryPlan.file);
        mergeResult = mergeRejectedClaims(existing.content, memoryPlan.rejectedClaims);
        contentToWrite = mergeResult.content;
      }

      if (mergeResult && mergeResult.added === 0) {
        markMemoryPlanTerminalStatus(sessionId, memoryPlan.id, 'unchanged');
        const message = mergeResult.droppedBecauseFull > 0
          ? l('工作记忆已达到 4,000 字符上限，本次没有新增条目。', 'Working memory is at the 4,000-character limit; no new entry was added.')
          : l('这些否定主张已存在于工作记忆中，没有新增条目。', 'These rejected claims are already in working memory; no new entry was added.');
        appendAssistantMessageToSession(sessionId, message, memoryPlan.summary);
        setStatusMessage(message);
        return;
      }

      await writeAgentMemory(memoryPlan.file, contentToWrite);
      markMemoryPlanTerminalStatus(sessionId, memoryPlan.id, 'applied');
      appendAssistantMessageToSession(
        sessionId,
        l('已写入本地 Agent 记忆。', 'Local Agent memory was updated.'),
        memoryPlan.summary,
      );
      setStatusMessage(l('已写入 Agent 记忆。', 'Agent memory updated.'));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('写入 Agent 记忆失败', 'Failed to update Agent memory');
      setError(message);
      setStatusMessage(message);
    } finally {
      memoryPlanInFlightRef.current.delete(memoryPlan.id);
    }
  };

  const rejectMemoryPlan = (memoryPlan: AgentMemoryWritePlan) => {
    markMemoryPlanTerminalStatus(activeSessionId, memoryPlan.id, 'cancelled');
    setStatusMessage(l('已拒绝本次 Agent 记忆写入。', 'The Agent memory update was rejected.'));
  };

  // 引用核对「写入工作记忆」入口（方案第 5.2/6.4 节）：
  // 点击只生成 merge-rejected-claims 审批卡；批准路径仍是 applyMemoryPlan -> writeAgentMemory('topics', merged)。
  const handleWriteRejectedClaimsToMemory = (message: AgentChatMessage) => {
    const audit = message.citationAudit;

    if (!audit || audit.rejectedClaimLines.length === 0) {
      return;
    }

    const rejectedClaims: RejectedClaimLine[] = audit.claims
      .filter((claim) => claim.status === 'not-in-library' || claim.status === 'contradicted')
      .map((claim) => ({
        text: claim.text,
        status: claim.status as RejectedClaimLine['status'],
        reason: claim.reason,
        source: 'citation-audit',
      }));

    if (rejectedClaims.length === 0) {
      return;
    }

    const memoryPlan = createAgentMemoryWritePlan({
      file: 'topics',
      // content 仅作审批卡预览；合并发生在用户批准时（读当前 L2 + mergeRejectedClaims）。
      content: audit.rejectedClaimLines.join('\n'),
      summary: l(
        `引用核对：合并 ${rejectedClaims.length} 条被否定主张到 L2 工作记忆（不覆盖当前任务段）。`,
        `Citation audit: merge ${rejectedClaims.length} rejected claim(s) into L2 working memory (current task is preserved).`,
      ),
      mode: 'merge-rejected-claims',
      rejectedClaims,
    });

    updateSessionMessage(activeSessionId, message.id, (current) => ({
      ...current,
      memoryPlan,
    }));
    setStatusMessage(l(
      '已生成工作记忆写入审批卡，确认后才会合并进 L2。',
      'A working-memory approval card was created. Merging into L2 happens only after confirmation.',
    ));
  };

  const applyNotePlan = async (notePlan: AgentNoteWritePlan) => {
    const sessionId = activeSessionId;

    try {
      const result = await applyAgentNoteWritePlan(notePlan);
      markNotePlanTerminalStatus(sessionId, notePlan.id, 'applied');
      const detail =
        result.failed > 0
          ? l(
              `${notePlan.summary}（${result.applied} 成功 / ${result.failed} 失败）`,
              `${notePlan.summary} (${result.applied} applied / ${result.failed} failed)`,
            )
          : notePlan.summary;
      appendAssistantMessageToSession(
        sessionId,
        result.failed > 0
          ? l(`笔记变更部分失败：${result.errors.join('；')}`, `Some note changes failed: ${result.errors.join('; ')}`)
          : l('笔记变更已写入。', 'Note changes were applied.'),
        detail,
      );
      setStatusMessage(
        result.failed > 0
          ? l('笔记变更部分失败。', 'Some note changes failed.')
          : l('笔记变更已写入。', 'Note changes applied.'),
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('写入笔记失败', 'Failed to apply note changes');
      setError(message);
      setStatusMessage(message);
    }
  };

  const rejectNotePlan = (notePlan: AgentNoteWritePlan) => {
    markNotePlanTerminalStatus(activeSessionId, notePlan.id, 'cancelled');
    setStatusMessage(l('已拒绝本次笔记变更。', 'The note changes were rejected.'));
  };

  const cancelPlan = () => {
    if (plan) {
      markPlanTerminalStatus(activeSessionId, plan.id, 'cancelled');
    }
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

  const handleContinueSurvey = (message: AgentChatMessage) => {
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    const originalRequest = messageIndex < 0 ? undefined : [...messages.slice(0, messageIndex)].reverse().find((item) => item.role === 'user');
    const rawArtifacts = message.capability?.id === 'comparative-survey' && message.capability.artifacts && typeof message.capability.artifacts === 'object'
      ? message.capability.artifacts as Partial<ComparativeSurveyArtifacts>
      : undefined;
    const coverage = normalizeSurveyCoverageLedger(rawArtifacts?.coverage);
    if (!originalRequest?.content.trim() || !coverage || coverage.papers.length === 0) {
      setStatusMessage(l('原任务或覆盖记录未保存，请重新提供要继续的任务。', 'The original request or coverage records are unavailable. Provide the task again.'));
      return;
    }
    const artifacts: Partial<ComparativeSurveyArtifacts> = {
      ...rawArtifacts,
      coverage,
      completedStages: Array.isArray(rawArtifacts?.completedStages)
        ? rawArtifacts.completedStages.filter((stage) => ['rephrase', 'decompose', 'research', 'report'].includes(stage))
        : [],
    };
    setStatusMessage(l('正在沿用原文献范围和覆盖记录继续调研。', 'Continuing the survey with its original paper scope and coverage records.'));
    void runAgent(originalRequest.content, coverage.papers.map((paper) => paper.paperId), artifacts);
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

  const handleOpenHistorySession = (historySession: AgentHistorySession) => {
    const session = normalizeAgentHistorySessionMeta(historySession);
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
        // 本进程内仍有活跃 controller 的会话，其 running 行属于正在执行的 run，不视为中断。
        if (abortControllersRef.current.has(session.id)) {
          return;
        }

        const interruptedRuns = await listInterruptedAgentRuns(session.id);
        const [interruptedRun, ...staleRuns] = interruptedRuns;

        if (!interruptedRun || activeSessionIdRef.current !== session.id) {
          return;
        }

        // 同会话其余遗留 running 行一并清理，避免每次打开会话重复提示。
        for (const staleRun of staleRuns) {
          await finishAgentRun({ runId: staleRun.runId, status: 'aborted' }).catch(() => {});
        }

        const events = (await getAgentRunEvents(interruptedRun.runId, 0, { order: 'desc', limit: 200 })).reverse();
        const checkpoint = latestAgentRecoveryCheckpoint(events);
        const capabilityCheckpoint = latestComparativeSurveyCheckpoint(events);

        if (capabilityCheckpoint) {
          const resumeCapability = window.confirm(l(
            '上次对比调研被中断。是否从最近完成的阶段继续？',
            'The previous comparative survey was interrupted. Continue from the most recently completed stage?',
          ));

          await finishAgentRun({ runId: interruptedRun.runId, status: 'aborted' }).catch(() => {});

          // confirm + await 期间用户可能已切换到其他会话，写输入框前必须复查。
          if (activeSessionIdRef.current !== session.id) {
            return;
          }

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
          citations: latestAgentRecoveryCitations(events),
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
    // 删除前先中止该会话仍在运行的 run，避免孤儿 run 继续消耗 token 且无法取消。
    const controller = abortControllersRef.current.get(sessionId);

    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(sessionId);
      setAgentSessionRunning(sessionId, false);
      setCancellingSessionIds((current) => {
        if (!current.has(sessionId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }

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

    // 清空历史会删除所有会话，先中止所有仍在运行的 run。
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    abortControllersRef.current.clear();
    runningSessionIdsRef.current = new Set();
    setRunningSessionIds(new Set());
    setCancellingSessionIds(new Set());

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
      activeSessionCancelling={cancellingSessionIds.has(activeSessionId)}
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
      onContinueSurvey={handleContinueSurvey}
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
      onRejectMemoryPlan={rejectMemoryPlan}
      onWriteRejectedClaims={handleWriteRejectedClaimsToMemory}
      onApplyNotePlan={(notePlan) => {
        void applyNotePlan(notePlan);
      }}
      onRejectNotePlan={rejectNotePlan}
      onCancelAgentRun={handleCancelAgentRun}
      onCancelPlan={cancelPlan}
      onClearSelection={clearSelection}
      onComposerChange={setComposerValue}
      onCopyToolParameters={(toolCall) => {
        void copyToolParameters(toolCall);
      }}
      onOpenRagCitation={handleOpenRagCitation}
      onVerifyCitations={handleVerifyCitations}
      onOrganizeMemory={handleOrganizeAgentMemory}
      onAgentPresetChange={handleAgentPresetChange}
      onAgentReasoningEffortChange={setSelectedAgentReasoningEffort}
      pinnedCapabilityId={pinnedCapabilityId}
      onPinnedCapabilityChange={setPinnedCapabilityId}
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
