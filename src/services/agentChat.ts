import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import type {
  AgentChatTurnResponse,
  AgentLoopMessage,
} from './agentLoop';
import type { ModelReasoningEffort, OpenAICompatibleApiMode } from '../types/reader';

const AGENT_STREAM_EVENT = 'paperquay://agent-stream';

export interface AgentChatTurnModelOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiMode?: OpenAICompatibleApiMode;
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
}

function isLikelyStreamUnsupported(message: string): boolean {
  return ['stream', 'sse', 'event-stream', 'readable body', 'readablestream']
    .some((signal) => message.toLocaleLowerCase().includes(signal));
}

export async function runOpenAiCompatibleAgentChatTurn(input: {
  options: AgentChatTurnModelOptions;
  messages: AgentLoopMessage[];
  tools?: Array<Record<string, unknown>>;
  toolChoice: 'auto' | 'none';
  stream?: boolean;
  signal?: AbortSignal;
  onAnswerDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
}): Promise<AgentChatTurnResponse> {
  const requestId = crypto.randomUUID();
  const request = {
    requestId,
    options: input.options,
    messages: input.messages,
    tools: input.tools,
    toolChoice: input.toolChoice,
    stream: input.stream !== false,
  };

  if (input.signal?.aborted) {
    const error = new Error('Agent chat turn aborted');
    error.name = 'AbortError';
    throw error;
  }

  const cancel = () => {
    void invoke('agent_chat_turn_cancel', { requestId }).catch(() => {});
  };
  input.signal?.addEventListener('abort', cancel, { once: true });

  if (input.stream === false) {
    try {
      return await invoke<AgentChatTurnResponse>('agent_chat_turn', { request });
    } catch (error) {
      const nextError = new Error(toErrorMessage(error, 'Agent chat turn failed'));
      if (input.signal?.aborted) nextError.name = 'AbortError';
      throw nextError;
    } finally {
      input.signal?.removeEventListener('abort', cancel);
    }
  }

  let streamError = '';
  const unlisten = await listen<{
    requestId?: string;
    kind?: string;
    text?: string;
    error?: string;
  }>(AGENT_STREAM_EVENT, (event) => {
    const payload = event.payload;

    if (!payload || payload.requestId !== requestId) {
      return;
    }

    if ((payload.kind === 'delta' || payload.kind === 'answer_delta') && payload.text) {
      input.onAnswerDelta?.(payload.text);
      return;
    }

    if (payload.kind === 'thinking-delta' && payload.text) {
      input.onThinkingDelta?.(payload.text);
      return;
    }

    if (payload.kind === 'error') {
      streamError = payload.error || 'Agent stream failed';
    }
  });

  try {
    const response = await invoke<AgentChatTurnResponse>('agent_chat_turn', { request });

    if (streamError) {
      throw new Error(streamError);
    }

    return { ...response, didStream: true };
  } catch (error) {
    const message = toErrorMessage(error, streamError || 'Agent stream request failed');

    if (isLikelyStreamUnsupported(message)) {
      try {
        return await invoke<AgentChatTurnResponse>('agent_chat_turn', {
          request: { ...request, stream: false },
        });
      } catch (fallbackError) {
        throw new Error(toErrorMessage(fallbackError, message));
      }
    }

    const nextError = new Error(message);
    if (input.signal?.aborted) nextError.name = 'AbortError';
    throw nextError;
  } finally {
    input.signal?.removeEventListener('abort', cancel);
    unlisten();
  }
}
