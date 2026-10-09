import type { LucideIcon } from 'lucide-react';
import type {
  LibraryAgentPaperSelectionRequest,
  LibraryAgentFigureReference,
  LibraryAgentPlan,
  LibraryAgentRagCitation,
  LibraryAgentTool,
  LibraryAgentUserChoice,
} from '../../services/libraryAgent';
import type { AgentMemoryWritePlan } from '../../services/agentMemory';
import type { AgentCitationBinding } from '../../services/agentAnswerEvidence';
import type { AgentNoteWritePlan } from '../../services/agentNotePlan';
import type { ComparativeSurveyArtifacts } from '../../services/agentCapability';
import type { DeliveryQualityResult } from '../../services/agentDeliveryQuality';
import type { AgentCapabilityId, CitationAuditResult } from '../../services/agentCapabilityRegistry';
import type { DocumentChatAttachment } from '../../types/reader';

export type AgentStepStatus = 'waiting' | 'running' | 'success' | 'warning' | 'error' | 'skipped';

export type AgentStepType =
  | 'intent'
  | 'thought-summary'
  | 'plan'
  | 'tool-call'
  | 'tool-result'
  | 'final';

export interface AgentCapability {
  key: LibraryAgentTool;
  functionName: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  icon: LucideIcon;
}

export interface AgentTraceStep {
  id: string;
  type: AgentStepType;
  title: string;
  summary: string;
  status: AgentStepStatus;
  durationMs?: number;
  detail?: string;
}

export interface AgentToolCallView {
  id: string;
  tool: LibraryAgentTool;
  functionName: string;
  status: AgentStepStatus;
  durationMs?: number;
  parameterSummary: string;
  resultSummary: string;
  rawParameters: Record<string, unknown>;
}

export interface AgentCapabilityView {
  id: AgentCapabilityId;
  status: 'running' | 'done' | 'partial' | 'error' | 'aborted';
  activeStage?: string;
  stages: Array<{
    id: string;
    status: AgentStepStatus;
    detail?: string;
  }>;
  artifacts?: unknown;
}

export interface AgentChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  meta?: string;
  createdAt: number;
  attachments?: DocumentChatAttachment[];
  paperScopeIds?: string[];
  thinking?: string | null;
  trace?: AgentTraceStep[];
  ragCitations?: LibraryAgentRagCitation[];
  ragFigures?: LibraryAgentFigureReference[];
  visionNotice?: string | null;
  /** RAG 检索失败时的用户可见提示（Agent 已回退到全文/摘要上下文）。 */
  ragNotice?: string | null;
  evidenceStats?: Record<string, number>;
  citationBindings?: AgentCitationBinding[];
  toolCall?: AgentToolCallView;
  plan?: LibraryAgentPlan;
  /** 审批计划生命周期终态；undefined 表示仍可审批。 */
  planStatus?: 'applied' | 'cancelled';
  memoryPlan?: AgentMemoryWritePlan;
  /** 记忆写入审批终态；undefined 表示仍可审批。 */
  memoryPlanStatus?: 'applied' | 'cancelled' | 'unchanged';
  notePlan?: AgentNoteWritePlan;
  /** 笔记写入审批终态；undefined 表示仍可审批。 */
  notePlanStatus?: 'applied' | 'cancelled';
  /** 引用核对（citation-audit）能力产物；rejectedClaimLines 非空时渲染「写入工作记忆」入口。 */
  citationAudit?: CitationAuditResult;
  /** 能力交付质量检查；可选以兼容旧消息与恢复 checkpoint。 */
  deliveryQuality?: DeliveryQualityResult;
  capability?: AgentCapabilityView;
  choices?: LibraryAgentUserChoice[];
  paperSelectionRequest?: LibraryAgentPaperSelectionRequest;
  error?: string;
}

export interface AgentHistorySession {
  id: string;
  title: string;
  summary: string;
  updatedAt: number;
  messages: AgentChatMessage[];
  selectedPaperIds: string[];
  lastInstruction: string;
  ragEnabled?: boolean;
  selectedModelPresetId?: string;
  attachments?: DocumentChatAttachment[];
  status: AgentStepStatus;
}
