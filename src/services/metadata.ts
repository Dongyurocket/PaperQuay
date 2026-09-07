import { invoke } from '../platform/electron/core';
import type {
  MetadataLookupRequest,
  MetadataLookupResult,
} from '../types/metadata';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

export async function lookupLiteratureMetadata(
  request: MetadataLookupRequest,
): Promise<MetadataLookupResult | null> {
  try {
    return await invoke<MetadataLookupResult | null>('lookup_literature_metadata', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '自动补全文献元数据失败'));
  }
}

export interface LlmMetadataExtractionRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiMode?: string;
  /** 已知的文献标题（可能来自文件名），用于给模型提供上下文。 */
  title?: string | null;
  /** 文献开头文本（通常是首页），抽取依据。 */
  excerptText: string;
}

/**
 * 使用 LLM 从文献正文开头提取元数据。
 * 主要面向中文文献：中文论文通常不在 Crossref/OpenAlex 覆盖范围内，
 * 远程检索未命中时以此作为兜底。
 */
export async function extractLiteratureMetadataWithLlm(
  request: LlmMetadataExtractionRequest,
): Promise<MetadataLookupResult | null> {
  try {
    return await invoke<MetadataLookupResult | null>(
      'extract_literature_metadata_openai_compatible',
      { options: request },
    );
  } catch (error) {
    throw new Error(toErrorMessage(error, '智能提取文献元数据失败'));
  }
}
