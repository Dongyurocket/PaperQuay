import { invoke } from '../platform/electron/core';
import type {
  OpenAICompatibleTranslateOptions,
  OpenAICompatibleTranslateTextOptions,
  TranslationBlockOutput,
} from "../types/reader";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return fallback;
}

export async function translateBlocksOpenAICompatible(
  options: OpenAICompatibleTranslateOptions & { signal?: AbortSignal },
): Promise<TranslationBlockOutput[]> {
  // AbortSignal 不能跨 IPC 传递；每次请求带一个 requestId，取消时由渲染层
  // 通知主进程中止对应的 AbortController，避免「停止」后后端继续消耗配额。
  const { signal, ...forwardedOptions } = options;
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `translate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const cancelActiveRequest = () => {
    void invoke('translate_cancel', { requestId }).catch(() => undefined);
  };

  if (signal?.aborted) {
    throw new DOMException('Translation request was cancelled.', 'AbortError');
  }
  signal?.addEventListener('abort', cancelActiveRequest, { once: true });

  try {
    return await invoke<TranslationBlockOutput[]>(
      "translate_blocks_openai_compatible",
      {
        options: { ...forwardedOptions, requestId },
      },
    );
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException('Translation request was cancelled.', 'AbortError');
    }
    throw new Error(toErrorMessage(error, "调用 OpenAI 兼容翻译接口失败"));
  } finally {
    signal?.removeEventListener('abort', cancelActiveRequest);
  }
}

export async function translateTextOpenAICompatible(
  options: OpenAICompatibleTranslateTextOptions,
): Promise<string> {
  try {
    return await invoke<string>("translate_text_openai_compatible", {
      options,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, "调用 OpenAI 兼容划词翻译接口失败"));
  }
}
