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
import type { ComparativeSurveyArtifacts } from '../../services/agentCapability';
import type { DocumentChatAttachment } from '../../types/reader';

export type AgentStepStatus = 'waiting' | 'running' | 'success' | 'error';

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
  id: 'comparative-survey';
  status: 'running' | 'done' | 'error' | 'aborted';
  activeStage?: 'rephrase' | 'decompose' | 'research' | 'report';
  stages: Array<{
    id: 'rephrase' | 'decompose' | 'research' | 'report';
    status: AgentStepStatus;
    detail?: string;
  }>;
  artifacts?: ComparativeSurveyArtifacts;
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
  toolCall?: AgentToolCallView;
  plan?: LibraryAgentPlan;
  memoryPlan?: AgentMemoryWritePlan;
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
