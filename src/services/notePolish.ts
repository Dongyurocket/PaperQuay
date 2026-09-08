import { invoke } from '../platform/electron/core';
import { loadLibraryAgentModelPreset } from './libraryAgent';
import { loadReviewEmbeddingConfig } from '../features/review/reviewSemantic';
import type { NotePolishResult, NotePolishScope } from '../types/notes';

export interface NotePolishRequest {
  text: string;
  scope: NotePolishScope;
  linkedPaperIds: string[];
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' ? error : fallback;
}

export async function polishNote(request: NotePolishRequest): Promise<NotePolishResult> {
  const model = await loadLibraryAgentModelPreset();

  if (!model?.apiKey?.trim() || !model.baseUrl?.trim() || !model.model?.trim()) {
    throw new Error('请先在模型设置中配置可用的问答或 Agent 模型。');
  }

  const embedding = request.scope === 'none' ? null : await loadReviewEmbeddingConfig();

  try {
    return await invoke<NotePolishResult>('notes_polish_openai_compatible', {
      options: {
        ...model,
        text: request.text,
        scope: request.scope,
        linkedPaperIds: request.linkedPaperIds,
        embedding,
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '笔记润色失败'));
  }
}
