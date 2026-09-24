import { invoke } from '../platform/electron/core';
import { loadLibraryAgentModelPreset } from './libraryAgent';

export interface NoteDistillResult {
  title: string;
  text: string;
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' ? error : fallback;
}

/**
 * 提炼式摘录（痛点 8）：对 PDF 选区执行两步 CoT 提炼（识别清洗 → 改写提炼），
 * 返回可编辑的提炼正文；原文由调用方以锚点块保真留存。
 */
export async function distillExcerpt(request: {
  text: string;
  paperTitle?: string;
  pageLabel?: string;
}): Promise<NoteDistillResult> {
  const model = await loadLibraryAgentModelPreset();

  if (!model?.apiKey?.trim() || !model.baseUrl?.trim() || !model.model?.trim()) {
    throw new Error('请先在模型设置中配置可用的问答或 Agent 模型。');
  }

  try {
    return await invoke<NoteDistillResult>('notes_distill_excerpt_openai_compatible', {
      options: {
        ...model,
        text: request.text,
        paperTitle: request.paperTitle ?? '',
        pageLabel: request.pageLabel ?? '',
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '提炼摘录失败'));
  }
}
