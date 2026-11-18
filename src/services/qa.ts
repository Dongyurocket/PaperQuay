import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import type {
  OpenAICompatibleQaOptions,
} from '../types/reader';
import { cleanQaAssistantOutput } from '../utils/qaOutput';

const QA_STREAM_EVENT = 'paperquay://qa-stream';

interface QaStreamEventPayload {
  requestId: string;
  kind: 'delta' | 'done' | 'error';
  text?: string | null;
  error?: string | null;
}

interface QaStreamHandlers {
  onDelta?: (text: string, fullText: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (message: string) => void;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

export async function askDocumentOpenAICompatible(
  options: OpenAICompatibleQaOptions,
): Promise<string> {
  try {
    return cleanQaAssistantOutput(await invoke<string>('ask_document_openai_compatible', { options }));
  } catch (error) {
    throw new Error(toErrorMessage(error, '调用论文问答接口失败'));
  }
}

export async function askDocumentOpenAICompatibleStream(
  options: OpenAICompatibleQaOptions,
  handlers: QaStreamHandlers = {},
  signal?: AbortSignal,
): Promise<string> {
  const requestId = crypto.randomUUID();
  let answer = '';
  let streamError = '';
  const unlisten = await listen<QaStreamEventPayload>(QA_STREAM_EVENT, (event) => {
    const payload = event.payload;

    if (!payload || payload.requestId !== requestId || signal?.aborted) {
      return;
    }

    if (payload.kind === 'delta') {
      const delta = payload.text ?? '';

      if (!delta) {
        return;
      }

      answer += delta;
      handlers.onDelta?.(delta, cleanQaAssistantOutput(answer));
      return;
    }

    if (payload.kind === 'error') {
      streamError = payload.error || '论文问答流式输出失败';
      handlers.onError?.(streamError);
      return;
    }

    handlers.onDone?.(cleanQaAssistantOutput(answer));
  });

  const abort = () => { void invoke('ask_document_openai_compatible_stream_cancel', { requestId }).catch(() => {}); };
  try {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    signal?.addEventListener('abort', abort, { once: true });
    const completedAnswer = await invoke<string | void>('ask_document_openai_compatible_stream', {
      requestId,
      options,
    });

    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (streamError) {
      throw new Error(streamError);
    }

    return cleanQaAssistantOutput(typeof completedAnswer === 'string' ? completedAnswer : answer);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const message = toErrorMessage(error, streamError || '调用论文问答流式接口失败');
    handlers.onError?.(message);
    throw new Error(message);
  } finally {
    signal?.removeEventListener('abort', abort);
    unlisten();
  }
}
