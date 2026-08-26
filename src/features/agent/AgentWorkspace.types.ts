import type { LucideIcon } from 'lucide-react';
import type {
  LibraryAgentPaperSelectionRequest,
  LibraryAgentPlan,
  LibraryAgentRagCitation,
  LibraryAgentTool,
  LibraryAgentUserChoice,
} from '../../services/libraryAgent';
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
  /** RAG 检索失败时的用户可见提示（Agent 已回退到全文/摘要上下文）。 */
  ragNotice?: string | null;
  toolCall?: AgentToolCallView;
  plan?: LibraryAgentPlan;
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
