import { invoke } from '../platform/electron/core';
import { loadQaModelPreset } from './modelPresets';
import { reparseBlockWithAi } from './blockReparse';

export interface NoteDistillResult {
  title: string;
  text: string;
}

export interface NoteDistillReidentifyResult {
  reparsedText: string;
  modelName: string;
}

export async function reidentifyExcerptImage(request: {
  text: string;
  imageDataUrl: string;
}): Promise<NoteDistillReidentifyResult> {
  return reparseBlockWithAi({
    text: request.text,
    imageDataUrl: request.imageDataUrl,
    blockType: 'formula/table',
    customPrompt: 'Reconstruct the selected formula as precise LaTeX or the selected table as a clean Markdown table. Return only the reconstructed content.',
  });
}

/**
 * 提炼错误的稳定码：message 固定为 `CODE: detail`。
 * detail 可能是后端原始信息，只用于诊断；界面渲染必须走 noteErrorMessage()，
 * 不能把 message 直接展示给用户（否则英文界面会出现中文原文）。
 */
class NoteDistillError extends Error {
  readonly code: 'NOTE_DISTILL_MODEL_MISSING' | 'NOTE_DISTILL_FAILED';

  constructor(code: 'NOTE_DISTILL_MODEL_MISSING' | 'NOTE_DISTILL_FAILED', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'NoteDistillError';
    this.code = code;
  }
}

function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return undefined;
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
  const model = await loadQaModelPreset();

  if (!model?.apiKey?.trim() || !model.baseUrl?.trim() || !model.model?.trim()) {
    throw new NoteDistillError('NOTE_DISTILL_MODEL_MISSING');
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
    throw new NoteDistillError('NOTE_DISTILL_FAILED', errorDetail(error));
  }
}
