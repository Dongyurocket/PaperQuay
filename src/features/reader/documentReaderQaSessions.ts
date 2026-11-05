import type { DocumentChatSession, QaModelPreset } from '../../types/reader';

export function resolveActiveQaSession(
  sessions: DocumentChatSession[],
  selectedSessionId: string,
): DocumentChatSession | null {
  return sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
}

export function resolveQaSessionSelection(
  sessions: DocumentChatSession[],
  selectedSessionId: string,
): DocumentChatSession | null {
  if (!selectedSessionId) {
    return null;
  }

  return sessions.find((session) => session.id === selectedSessionId) ?? null;
}

export function removeQaSession(
  sessions: DocumentChatSession[],
  sessionId: string,
  createFallbackSession: () => DocumentChatSession,
): {
  sessions: DocumentChatSession[];
  selectedSessionId: string;
  removed: boolean;
} {
  const nextSessions = sessions.filter((session) => session.id !== sessionId);

  if (nextSessions.length === sessions.length) {
    return {
      sessions,
      selectedSessionId: '',
      removed: false,
    };
  }

  if (nextSessions.length === 0) {
    const fallbackSession = createFallbackSession();

    return {
      sessions: [fallbackSession],
      selectedSessionId: fallbackSession.id,
      removed: true,
    };
  }

  return {
    sessions: nextSessions,
    selectedSessionId: nextSessions[0].id,
    removed: true,
  };
}

export function removeFailedQaAssistantPlaceholder(
  sessions: DocumentChatSession[],
  sessionId: string,
  assistantMessageId: string,
): DocumentChatSession[] {
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId);
  if (sessionIndex < 0) return sessions;
  const session = sessions[sessionIndex];
  const messageIndex = session.messages.findIndex((message) => message.id === assistantMessageId);
  if (messageIndex < 0) return sessions;
  const message = session.messages[messageIndex];
  if (message.role !== 'assistant' || message.content.trim()) return sessions;

  const messages = session.messages.filter((_, index) => index !== messageIndex);
  const updatedAt = messageIndex === session.messages.length - 1
    ? (messages[messages.length - 1]?.createdAt ?? session.createdAt)
    : session.updatedAt;
  return sessions.map((item, index) => index === sessionIndex
    ? { ...session, messages, updatedAt }
    : item);
}

export function resolveQaModelPreset(
  presets: QaModelPreset[],
  presetId: string,
): QaModelPreset | null {
  return presets.find((preset) => preset.id === presetId) ?? presets[0] ?? null;
}
