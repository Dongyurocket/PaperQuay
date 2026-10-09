import type { AgentRunEventRecord } from '../../services/agentRuns';
import type { ComparativeSurveyArtifacts } from '../../services/agentCapability';
import type { AgentLoopMessage } from '../../services/agentLoop';
import type { AgentChatMessage } from './AgentWorkspace.types';
import type { LibraryAgentRagCitation } from '../../services/libraryAgent';
import { newMessageId } from './AgentWorkspace.model.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function recoveredToolCall(value: unknown) {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    arguments: isRecord(value.arguments) ? value.arguments : {},
  };
}

function recoveredLoopMessage(value: unknown): AgentLoopMessage | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  const content = typeof value.content === 'string' ? value.content : '';
  const toolCalls = Array.isArray(value.toolCalls)
    ? value.toolCalls.map(recoveredToolCall).filter((call): call is NonNullable<typeof call> => Boolean(call))
    : undefined;

  if (role !== 'system' && role !== 'assistant' && role !== 'user' && role !== 'tool') {
    return null;
  }

  // 工具调用轮的 assistant 消息 content 通常为空，但它是后续 tool 消息的合法前置，必须保留。
  if (!content && !(role === 'assistant' && toolCalls && toolCalls.length > 0)) {
    return null;
  }

  return {
    role,
    content: content || ' ',
    toolCallId: typeof value.toolCallId === 'string' ? value.toolCallId : undefined,
    toolCalls,
  };
}

/** 双向清理孤儿消息：无应答的 assistant toolCalls 与没有前置 toolCalls 的 tool 消息都会被 provider 拒绝。 */
function sanitizeRecoveredLoopMessages(messages: AgentLoopMessage[]): AgentLoopMessage[] {
  const answeredCallIds = new Set(
    messages.filter((message) => message.role === 'tool').map((message) => message.toolCallId),
  );
  const declaredCallIds = new Set(
    messages.flatMap((message) => (message.toolCalls ?? []).map((call) => call.id)),
  );

  return messages.filter((message) => {
    if (message.role === 'tool') {
      return Boolean(message.toolCallId && declaredCallIds.has(message.toolCallId));
    }

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return message.toolCalls.every((call) => answeredCallIds.has(call.id));
    }

    return true;
  });
}

export interface GenericCapabilityCheckpoint {
  capabilityId: string;
  artifacts: unknown;
}

export function latestCapabilityCheckpoint(
  events: AgentRunEventRecord[],
): GenericCapabilityCheckpoint | null {
  for (const event of [...events].reverse()) {
    if (event.kind === 'checkpoint' && isRecord(event.payload) && isRecord(event.payload.artifacts)) {
      const capabilityId = typeof event.payload.capabilityId === 'string' ? event.payload.capabilityId : 'comparative-survey';
      return {
        capabilityId,
        artifacts: event.payload.artifacts,
      };
    }
  }
  return null;
}

export function latestComparativeSurveyCheckpoint(
  events: AgentRunEventRecord[],
): Partial<ComparativeSurveyArtifacts> | null {
  for (const event of [...events].reverse()) {
    if (
      event.kind === 'checkpoint' &&
      isRecord(event.payload) &&
      (!event.payload.capabilityId || event.payload.capabilityId === 'comparative-survey') &&
      isRecord(event.payload.artifacts)
    ) {
      const artifacts = event.payload.artifacts;
      return {
        rephrasedQuestion: typeof artifacts.rephrasedQuestion === 'string' ? artifacts.rephrasedQuestion : undefined,
        subquestions: Array.isArray(artifacts.subquestions)
          ? artifacts.subquestions.filter((value): value is string => typeof value === 'string')
          : undefined,
        researchNotes: typeof artifacts.researchNotes === 'string' ? artifacts.researchNotes : undefined,
        citations: Array.isArray(artifacts.citations)
          ? artifacts.citations.flatMap((value) => {
            if (!isRecord(value) || typeof value.paperId !== 'string' || typeof value.paperTitle !== 'string') {
              return [];
            }
            return [{
              ...(typeof value.id === 'string' ? { id: value.id } : {}),
              ...(typeof value.label === 'string' ? { label: value.label } : {}),
              paperId: value.paperId,
              paperTitle: value.paperTitle,
              pageIndex: typeof value.pageIndex === 'number' || value.pageIndex === null ? value.pageIndex : undefined,
              blockId: typeof value.blockId === 'string' || value.blockId === null ? value.blockId : undefined,
              previewText: typeof value.previewText === 'string' ? value.previewText : undefined,
              sourceType: value.sourceType === 'mineru-markdown' || value.sourceType === 'pdf-text'
                ? value.sourceType
                : undefined,
            }];
          })
          : undefined,
        completedStages: Array.isArray(artifacts.completedStages)
          ? artifacts.completedStages.filter((value): value is ComparativeSurveyArtifacts['completedStages'][number] =>
            value === 'rephrase' || value === 'decompose' || value === 'research' || value === 'report',
          )
          : [],
      };
    }
  }

  return null;
}

export function latestAgentRecoveryCheckpoint(events: AgentRunEventRecord[]): AgentLoopMessage[] | null {
  for (const event of [...events].reverse()) {
    if (event.kind !== 'checkpoint' || !isRecord(event.payload) || !Array.isArray(event.payload.messages)) {
      continue;
    }

    const messages = sanitizeRecoveredLoopMessages(
      event.payload.messages
        .map(recoveredLoopMessage)
        .filter((message): message is AgentLoopMessage => Boolean(message)),
    );

    if (messages.length > 0) {
      return messages;
    }
  }

  return null;
}

export function latestAgentRecoveryCitations(events: AgentRunEventRecord[]): LibraryAgentRagCitation[] {
  const checkpoint = [...events].reverse().find((event) => event.kind === 'checkpoint' && Array.isArray(event.payload.messages));
  if (!Array.isArray(checkpoint?.payload.citations)) return [];
  return checkpoint.payload.citations.filter((value): value is LibraryAgentRagCitation =>
    isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string' &&
    typeof value.paperId === 'string' && typeof value.paperTitle === 'string' &&
    (value.sourceType === 'pdf-text' || value.sourceType === 'mineru-markdown') &&
    (value.pageIndex === null || (typeof value.pageIndex === 'number' && Number.isInteger(value.pageIndex) && value.pageIndex >= 0)) &&
    (value.blockId == null || typeof value.blockId === 'string') &&
    (value.previewText === undefined || typeof value.previewText === 'string'));
}

export function recoveryCheckpointToChatMessages(messages: AgentLoopMessage[]): AgentChatMessage[] {
  return messages
    .filter((message): message is AgentLoopMessage & { role: 'user' | 'assistant' } =>
      message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({
      id: newMessageId(),
      role: message.role,
      content: message.content,
      createdAt: Date.now(),
      meta: 'Recovered from the last complete Agent turn',
    }));
}
