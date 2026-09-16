import { invoke } from '../platform/electron/core';
import {
  loadLibraryAgentAvailableModelPresets,
  loadLibraryAgentModelPresetById,
} from './libraryAgent';
import type { QaModelPreset } from '../types/reader';
import { sanitizeClientReparsedText } from '../utils/markdown';

export { sanitizeClientReparsedText };

export interface ReparseBlockRequest {
  text: string;
  blockType?: string;
  /** Original PDF bbox crop, prepared and shown before a model request. */
  imageDataUrl?: string;
  customPrompt?: string;
  preferredPresetId?: string | null;
}

export interface ReparseBlockResult {
  reparsedText: string;
  modelName: string;
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

export async function reparseBlockWithAi(
  request: ReparseBlockRequest,
): Promise<ReparseBlockResult> {
  const modelPreset = await loadLibraryAgentModelPresetById(request.preferredPresetId);

  if (!modelPreset?.apiKey?.trim() || !modelPreset.baseUrl?.trim() || !modelPreset.model?.trim()) {
    throw new Error('请先在设置中配置可用的 AI 模型（需要有效的 Base URL、API Key 与模型名称）。');
  }

  if (request.imageDataUrl && modelPreset.supportsVision !== true) {
    throw new Error('所选模型未启用视觉能力。请重新选择模型；本次未发送请求。');
  }

  try {
    const rawResult = await invoke<string>('reparse_block_openai_compatible', {
      options: {
        ...modelPreset,
        text: request.text,
        blockType: request.blockType,
        imageDataUrl: request.imageDataUrl,
        customPrompt: request.customPrompt,
      },
    });

    const reparsedText = sanitizeClientReparsedText(rawResult || '');

    return {
      reparsedText,
      modelName: modelPreset.label || modelPreset.model,
    };
  } catch (error) {
    throw new Error(toErrorMessage(error, 'AI 重新识别区块失败'));
  }
}

export async function getAvailableReparseModelPresets(): Promise<QaModelPreset[]> {
  return await loadLibraryAgentAvailableModelPresets();
}
