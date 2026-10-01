import type { AgentToolMountContext } from './agentLoop.ts';
import { runComparativeSurveyCapability, type ComparativeSurveyResult } from './agentCapability.ts';
import type { AgentNoteWritePlan } from './agentNotePlan.ts';
import {
  runGraphExploreCapability,
  type GraphExploreCitation,
  type GraphExploreReport,
} from './agentGraphExplore.ts';
import {
  createCitationAuditModelIO,
  runCitationAuditCapability,
  type CitationAuditClaim,
  type CitationAuditResult,
  type CitationAuditSnippet,
} from './agentCitationAudit.ts';
import {
  createNoteDistillDrafter,
  runNoteDistillCapability,
} from './agentNoteDistillCapability.ts';

export type { GraphExploreCitation, GraphExploreReport } from './agentGraphExplore.ts';
export type { CitationAuditClaim, CitationAuditResult, CitationAuditSnippet } from './agentCitationAudit.ts';

export type AgentCapabilityId =
  | 'comparative-survey'
  | 'citation-audit'
  | 'note-distill'
  | 'graph-explore';

export type AgentCapabilityResult =
  | { kind: 'survey'; survey: ComparativeSurveyResult }
  | { kind: 'audit'; audit: CitationAuditResult }
  | {
    kind: 'note-plan';
    /** 校验未通过时为 null：只返回说明，不产审批卡。 */
    notePlan: AgentNoteWritePlan | null;
    answer: string;
    /** collect 阶段收集到的证据（笔记 + RAG 片段），供界面展示与证据绑定。 */
    citations?: Array<{
      label: string;
      paperId: string;
      paperTitle: string;
      pageIndex?: number | null;
      blockId?: string | null;
      previewText?: string;
    }>;
  }
  | { kind: 'graph-report'; report: GraphExploreReport; citations?: GraphExploreCitation[] };

/** 能力 runner 的模型调用通道（temperature 0、toolChoice none、不流式，由调用方装配）。 */
export interface AgentCapabilityCallModel {
  (input: { system: string; user: string; signal?: AbortSignal }): Promise<{ content: string }>;
}

/** 与 rag_search 工具相同的检索通道：citation-audit 的 retrieve 与 note-distill 的 RAG 兜底复用它。 */
export interface AgentCapabilitySearchRag {
  (input: { query: string; paperIds?: string[]; topK?: number }): Promise<{
    chunks: Array<{
      paperId: string;
      paperTitle?: string;
      page: number | null;
      blockId: string | null;
      snippet: string;
    }>;
    ragErrors?: string[];
  }>;
}

export interface AgentCapabilityRunnerInput {
  instruction: string;
  priorAssistantAnswer?: string;
  papers: Array<{
    id: string;
    title: string;
    tagNames: string[];
    categoryIds: string[];
    searchText?: string;
  }>;
  currentPaperScopeIds?: string[];
  signal?: AbortSignal;
  onEvent?: (event: AgentCapabilityEvent) => void;
  callModel?: AgentCapabilityCallModel;
  searchRag?: AgentCapabilitySearchRag;
}

export interface AgentCapabilityDefinition {
  id: AgentCapabilityId;
  title: { 'zh-CN': string; 'en-US': string };
  /** 选中后才注入，不超过 400 字符。 */
  summary: string;
  stages: readonly string[];
  minPapers: number;
  available?: (ctx: AgentToolMountContext) => boolean;
  runner: (input: AgentCapabilityRunnerInput) => Promise<AgentCapabilityResult>;
}

/**
 * 通用 capability 阶段事件（方案第 4.3 节）：stage 为注册表中的阶段 id。
 * ComparativeSurveyEvent 与各能力事件均可赋值到该类型。
 */
export type AgentCapabilityEvent =
  | { kind: 'stage_start'; capabilityId?: AgentCapabilityId; stage: string; attempt: number }
  | { kind: 'stage_progress'; capabilityId?: AgentCapabilityId; stage: string; completed: number; total: number; detail?: string }
  | { kind: 'stage_end'; capabilityId?: AgentCapabilityId; stage: string }
  | { kind: 'stage_retry'; capabilityId?: AgentCapabilityId; stage: string; attempt: number; error: string };

async function runCitationAuditFromRegistry(input: AgentCapabilityRunnerInput): Promise<AgentCapabilityResult> {
  if (!input.callModel) {
    return {
      kind: 'audit',
      audit: {
        claims: [],
        markdown: '引用核对需要可用的模型配置。请先在设置里配置 Agent 模型后重试。',
        rejectedClaimLines: [],
      },
    };
  }

  return runCitationAuditCapability({
    instruction: input.instruction,
    priorAssistantAnswer: input.priorAssistantAnswer,
    model: createCitationAuditModelIO(input.callModel),
    retrieve: async (claim) => {
      if (!input.searchRag) {
        return [];
      }
      const result = await input.searchRag({
        query: claim,
        paperIds: input.currentPaperScopeIds?.length ? input.currentPaperScopeIds : undefined,
        topK: 8,
      });
      const titleById = new Map(input.papers.map((paper) => [paper.id, paper.title]));
      return (result.chunks ?? []).slice(0, 8).map((chunk) => ({
        paperId: chunk.paperId,
        paperTitle: chunk.paperTitle?.trim() || titleById.get(chunk.paperId) || chunk.paperId,
        pageIndex: typeof chunk.page === 'number' && Number.isFinite(chunk.page) ? chunk.page - 1 : null,
        blockId: chunk.blockId ?? null,
        snippet: chunk.snippet ?? '',
      }));
    },
    signal: input.signal,
    onEvent: input.onEvent,
  });
}

async function runNoteDistillFromRegistry(input: AgentCapabilityRunnerInput): Promise<AgentCapabilityResult> {
  if (!input.callModel) {
    return {
      kind: 'note-plan',
      notePlan: null,
      answer: '笔记蒸馏需要可用的模型配置。请先在设置里配置 Agent 模型后重试。',
      citations: [],
    };
  }

  return runNoteDistillCapability({
    instruction: input.instruction,
    papers: input.papers.map((paper) => ({ id: paper.id, title: paper.title })),
    currentPaperScopeIds: input.currentPaperScopeIds,
    searchRag: input.searchRag,
    draft: createNoteDistillDrafter(input.callModel),
    judgeSynthesisClaim: createCitationAuditModelIO(input.callModel).judgeClaim,
    signal: input.signal,
    onEvent: input.onEvent,
  });
}

export const AGENT_CAPABILITIES: Record<AgentCapabilityId, AgentCapabilityDefinition> = {
  'comparative-survey': {
    id: 'comparative-survey',
    title: { 'zh-CN': '库内综述', 'en-US': 'Comparative Survey' },
    summary: '对比分析选定文献的核心观点、方法与实验证据，输出结构化综述报告与引用出处。',
    stages: ['rephrase', 'decompose', 'research', 'report'] as const,
    minPapers: 2,
    runner: runComparativeSurveyCapability as unknown as AgentCapabilityDefinition['runner'],
  },
  'citation-audit': {
    id: 'citation-audit',
    title: { 'zh-CN': '引用核对', 'en-US': 'Citation Audit' },
    summary: '逐句核对给定观点或笔记主张在文献库中的原文出处与证据强度，标注支持、部分支持或库内无证据。',
    stages: ['extract', 'retrieve', 'judge', 'report'] as const,
    minPapers: 0,
    available: (ctx: AgentToolMountContext) => ctx.localLibraryMode,
    runner: runCitationAuditFromRegistry,
  },
  'note-distill': {
    id: 'note-distill',
    title: { 'zh-CN': '笔记蒸馏', 'en-US': 'Note Distillation' },
    summary: '检索关联摘录与问答，综合多篇文献提炼结构化笔记草稿（概念、综述或问答卡）并提交审批。',
    stages: ['collect', 'draft', 'plan'] as const,
    minPapers: 0,
    available: (ctx: AgentToolMountContext) => ctx.localLibraryMode,
    runner: runNoteDistillFromRegistry,
  },
  'graph-explore': {
    id: 'graph-explore',
    title: { 'zh-CN': '图谱探索', 'en-US': 'Graph Exploration' },
    summary: '探索文献邻域关系，基于共享标签或分类发现潜在缺边与概念主题，生成图谱结构洞察。',
    stages: ['neighbors', 'gaps', 'topics', 'report'] as const,
    minPapers: 0,
    available: (ctx: AgentToolMountContext) => ctx.localLibraryMode,
    runner: runGraphExploreCapability as unknown as AgentCapabilityDefinition['runner'],
  },
};

export function getAgentCapability(id: string): AgentCapabilityDefinition | undefined {
  if (id in AGENT_CAPABILITIES) {
    return AGENT_CAPABILITIES[id as AgentCapabilityId];
  }
  return undefined;
}

export function listAgentCapabilities(): AgentCapabilityDefinition[] {
  return Object.values(AGENT_CAPABILITIES);
}
