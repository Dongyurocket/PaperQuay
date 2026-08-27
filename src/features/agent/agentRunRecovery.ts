import type { AgentRunEventRecord } from '../../services/agentRuns';
import type { ComparativeSurveyArtifacts } from '../../services/agentCapability';
import type { AgentLoopMessage } from '../../services/agentLoop';
import type { AgentChatMessage } from './AgentWorkspace.types';
import { newMessageId } from './AgentWorkspace.model.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function recoveredLoopMessage(value: unknown): AgentLoopMessage | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  const content = typeof value.content === 'string' ? value.content : '';

  if (
    (role !== 'system' && role !== 'assistant' && role !== 'user' && role !== 'tool') ||
    !content
  ) {
    return null;
  }

  return {
    role,
    content,
    toolCallId: typeof value.toolCallId === 'string' ? value.toolCallId : undefined,
  };
}

export function latestComparativeSurveyCheckpoint(
  events: AgentRunEventRecord[],
): Partial<ComparativeSurveyArtifacts> | null {
  for (const event of [...events].reverse()) {
    if (
      event.kind === 'checkpoint' &&
      isRecord(event.payload) &&
      event.payload.capabilityId === 'comparative-survey' &&
      isRecord(event.payload.artifacts)
    ) {
      const artifacts = event.payload.artifacts;
      return {
        rephrasedQuestion: typeof artifacts.rephrasedQuestion === 'string' ? artifacts.rephrasedQuestion : undefined,
        subquestions: Array.isArray(artifacts.subquestions)
          ? artifacts.subquestions.filter((value): value is string => typeof value === 'string')
          : undefined,
        researchNotes: typeof artifacts.researchNotes === 'string' ? artifacts.researchNotes : undefined,
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

    const messages = event.payload.messages
      .map(recoveredLoopMessage)
      .filter((message): message is AgentLoopMessage => Boolean(message));

    if (messages.length > 0) {
      return messages;
    }
  }

  return null;
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
