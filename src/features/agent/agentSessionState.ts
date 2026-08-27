import { buildAgentHistorySession } from './AgentWorkspace.model.ts';
import type { AgentChatMessage, AgentHistorySession } from './AgentWorkspace.types.ts';
import type { DocumentChatAttachment, UiLanguage } from '../../types/reader.ts';

interface SessionSnapshotInput {
  sessionId: string;
  messages: AgentChatMessage[];
  selectedPaperIds: string[];
  lastInstruction: string;
  ragEnabled?: boolean;
  selectedModelPresetId?: string;
  attachments?: DocumentChatAttachment[];
  locale: UiLanguage;
}

export function upsertAgentHistorySession(
  sessions: AgentHistorySession[],
  input: SessionSnapshotInput,
): AgentHistorySession[] {
  const nextSession = buildAgentHistorySession({
    id: input.sessionId,
    messages: input.messages,
    selectedPaperIds: input.selectedPaperIds,
    lastInstruction: input.lastInstruction,
    ragEnabled: input.ragEnabled,
    selectedModelPresetId: input.selectedModelPresetId,
    attachments: input.attachments,
    locale: input.locale,
  });
  const otherSessions = sessions.filter((session) => session.id !== input.sessionId);

  return [nextSession, ...otherSessions].slice(0, 30);
}

export function patchAgentHistorySessionMessage(
  sessions: AgentHistorySession[],
  {
    sessionId,
    messageId,
    updater,
    locale,
  }: {
    sessionId: string;
    messageId: string;
    updater: (message: AgentChatMessage) => AgentChatMessage;
    locale: UiLanguage;
  },
): AgentHistorySession[] {
  const targetSession = sessions.find((session) => session.id === sessionId);

  if (!targetSession) {
    return sessions;
  }

  const nextMessages = targetSession.messages.map((message) =>
    message.id === messageId ? updater(message) : message,
  );

  return upsertAgentHistorySession(sessions, {
    sessionId,
    messages: nextMessages,
    selectedPaperIds: targetSession.selectedPaperIds,
    lastInstruction: targetSession.lastInstruction,
    ragEnabled: targetSession.ragEnabled,
    selectedModelPresetId: targetSession.selectedModelPresetId,
    attachments: targetSession.attachments,
    locale,
  });
}

function stripAttachmentData(attachments: DocumentChatAttachment[] | undefined) {
  return attachments?.map(({ dataUrl: _dataUrl, ...attachment }) => ({ ...attachment }));
}

function cloneForkMessage(message: AgentChatMessage): AgentChatMessage {
  return {
    ...message,
    attachments: stripAttachmentData(message.attachments),
    paperScopeIds: message.paperScopeIds ? [...message.paperScopeIds] : undefined,
    ragCitations: message.ragCitations ? message.ragCitations.map((citation) => ({ ...citation })) : undefined,
    trace: message.trace ? message.trace.map((step) => ({ ...step })) : undefined,
    plan: message.plan
      ? { ...message.plan, items: message.plan.items.map((item) => ({ ...item, updateRequest: item.updateRequest ? { ...item.updateRequest } : undefined })) }
      : undefined,
    memoryPlan: message.memoryPlan ? { ...message.memoryPlan } : undefined,
    choices: message.choices ? message.choices.map((choice) => ({ ...choice })) : undefined,
  };
}

export function forkAgentHistorySession(input: {
  source: AgentHistorySession;
  messageId: string;
  forkSessionId: string;
  locale: UiLanguage;
}): AgentHistorySession | null {
  const messageIndex = input.source.messages.findIndex((message) => message.id === input.messageId);

  if (messageIndex < 0) {
    return null;
  }

  const messages = input.source.messages.slice(0, messageIndex + 1).map(cloneForkMessage);

  return buildAgentHistorySession({
    id: input.forkSessionId,
    messages,
    selectedPaperIds: [...input.source.selectedPaperIds],
    lastInstruction: input.source.lastInstruction,
    ragEnabled: input.source.ragEnabled,
    selectedModelPresetId: input.source.selectedModelPresetId,
    attachments: stripAttachmentData(input.source.attachments),
    locale: input.locale,
  });
}
