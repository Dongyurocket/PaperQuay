import { invoke } from '../platform/electron/core.ts';
import {
  buildEmbeddingModelKey,
  normalizeEmbeddingBaseUrl,
} from '../shared/embeddingConfig.cjs';

import type {
  RagChunkContextResponse,
  RagChunkInput,
  RagDocumentIndexStatus,
  RagFinalizeDocumentIndexRequest,
  RagIndexDocumentRequest,
  RagIndexedChunkInput,
  RagStageReusedChunksResult,
  RagStagedRebuildRequest,
  RagStorageStats,
  RagCompactStorageResult,
  RagReportDocumentIndexFailureRequest,
  RagRetrievalResult,
  RagRetrievalDiagnostics,
  RagSourceMode,
} from '../types/reader';

interface RagEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions?: number | null;
  timeoutSeconds?: number;
}

interface RagRetrieveRequest {
  documentKey?: string;
  embeddingModelKey?: string;
  sourceSignature?: string;
  documentKeys?: string[];
  sourceType?: Exclude<RagSourceMode, 'off' | 'hybrid'> | null;
  queryEmbedding: number[];
  /** The original retrieval text used by the FTS5 keyword channel. */
  queryText?: string;
  includeIndexCoverage?: boolean;
  topK: number;
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

function normalizeBaseUrl(baseUrl: string): string | undefined {
  const normalized = normalizeEmbeddingBaseUrl(baseUrl);
  return normalized || undefined;
}

export function buildRagEmbeddingModelKey(options: RagEmbeddingOptions): string {
  return buildEmbeddingModelKey(options);
}

export async function embedRagText(
  text: string,
  options: RagEmbeddingOptions,
): Promise<number[]> {
  try {
    return await invoke<number[]>('rag_embed_text', {
      request: {
        text,
        embedding: {
          ...options,
          baseUrl: normalizeBaseUrl(options.baseUrl) ?? options.baseUrl.trim(),
        },
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 文本向量生成失败'));
  }
}

export async function embedRagChunks(
  chunks: RagChunkInput[],
  options: RagEmbeddingOptions,
): Promise<RagIndexedChunkInput[]> {
  try {
    return await invoke<RagIndexedChunkInput[]>('rag_embed_chunks', {
      request: {
        chunks,
        embedding: {
          ...options,
          baseUrl: normalizeBaseUrl(options.baseUrl) ?? options.baseUrl.trim(),
        },
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 分块向量生成失败'));
  }
}

export async function ragIndexDocument(
  request: RagIndexDocumentRequest,
): Promise<void> {
  try {
    await invoke('rag_index_document', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 索引写入失败'));
  }
}

export async function ragReportDocumentIndexFailure(
  request: RagReportDocumentIndexFailureRequest,
): Promise<void> {
  try {
    await invoke('rag_report_document_index_failure', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 索引失败状态写入失败'));
  }
}

export async function ragGetDocumentIndexStatus(
  documentKey: string,
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>,
): Promise<RagDocumentIndexStatus | null> {
  try {
    return await invoke<RagDocumentIndexStatus | null>('rag_get_document_index_status', {
      request: {
        documentKey,
        sourceType,
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取本地 RAG 索引状态失败'));
  }
}

export async function ragListIndexedChunkIds(
  documentKey: string,
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>,
): Promise<string[]> {
  try {
    const result = await invoke<string[]>('rag_list_indexed_chunk_ids', {
      request: {
        documentKey,
        sourceType,
      },
    });
    return Array.isArray(result) ? result.filter((id) => typeof id === 'string') : [];
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取本地 RAG 已索引分块列表失败'));
  }
}

export async function ragFinalizeDocumentIndex(
  request: RagFinalizeDocumentIndexRequest,
): Promise<RagDocumentIndexStatus | null> {
  try {
    return await invoke<RagDocumentIndexStatus | null>('rag_finalize_document_index', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 索引状态收敛失败'));
  }
}

export async function ragListIndexStatuses(): Promise<RagDocumentIndexStatus[]> {
  try {
    return await invoke<RagDocumentIndexStatus[]>('rag_list_index_statuses', {});
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取本地 RAG 索引状态列表失败'));
  }
}

export async function ragPrepareStagedRebuild(
  request: RagStagedRebuildRequest,
): Promise<{ stagedChunkIds: string[] }> {
  try {
    return await invoke<{ stagedChunkIds: string[] }>('rag_prepare_staged_rebuild', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '准备 RAG 暂存重建失败'));
  }
}

export async function ragStageReusedChunks(request: {
  documentKey: string;
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid' | 'note'>;
  embeddingModelKey: string;
  chunks: RagChunkInput[];
}): Promise<RagStageReusedChunksResult> {
  try {
    return await invoke<RagStageReusedChunksResult>('rag_stage_reused_chunks', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '复用旧 RAG 向量失败'));
  }
}

export async function ragStageEmbeddedChunks(request: {
  documentKey: string;
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid' | 'note'>;
  chunks: RagIndexedChunkInput[];
}): Promise<{ stagedChunkIds: string[] }> {
  try {
    return await invoke<{ stagedChunkIds: string[] }>('rag_stage_embedded_chunks', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '写入 RAG 暂存向量失败'));
  }
}

export async function ragCommitStagedRebuild(
  request: RagStagedRebuildRequest,
): Promise<RagDocumentIndexStatus | null> {
  try {
    return await invoke<RagDocumentIndexStatus | null>('rag_commit_staged_rebuild', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '提交 RAG 暂存重建失败'));
  }
}

export async function ragFailStagedRebuild(request: {
  documentKey: string;
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid' | 'note'>;
  errorMessage: string;
}): Promise<void> {
  try {
    await invoke('rag_fail_staged_rebuild', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '记录 RAG 重建失败状态失败'));
  }
}

export async function ragDiscardStagedRebuild(request: {
  documentKey: string;
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid' | 'note'>;
}): Promise<void> {
  try {
    await invoke('rag_discard_staged_rebuild', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '清理 RAG 暂存重建失败'));
  }
}

export async function ragStampExtractorVersion(request: {
  documentKey: string;
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid' | 'note'>;
  extractorVersion: string | null;
}): Promise<RagDocumentIndexStatus | null> {
  try {
    return await invoke<RagDocumentIndexStatus | null>('rag_stamp_extractor_version', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '补写 RAG 抽取器版本失败'));
  }
}

export async function ragStorageStats(): Promise<RagStorageStats> {
  try {
    return await invoke<RagStorageStats>('rag_storage_stats', {});
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 RAG 存储统计失败'));
  }
}

export async function ragCompactStorage(): Promise<RagCompactStorageResult> {
  try {
    return await invoke<RagCompactStorageResult>('rag_compact_storage', {});
  } catch (error) {
    throw new Error(toErrorMessage(error, '整理 RAG 索引存储失败'));
  }
}

export async function ragRetrieveDocumentChunks(
  request: RagRetrieveRequest,
): Promise<RagRetrievalResult[]> {
  try {
    return await invoke<RagRetrievalResult[]>('rag_retrieve_document_chunks', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 检索失败'));
  }
}

export async function ragRetrieveDocumentChunksWithDiagnostics(
  request: RagRetrieveRequest,
): Promise<RagRetrievalDiagnostics> {
  try {
    return await invoke<RagRetrievalDiagnostics>('rag_retrieve_document_chunks', {
      request: { ...request, includeDiagnostics: true },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 检索失败'));
  }
}

export interface RagChunkContextRequest {
  documentKey: string;
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>;
  chunkId: string;
  before?: number;
  after?: number;
}

export async function ragGetChunkContext(
  request: RagChunkContextRequest,
): Promise<RagChunkContextResponse> {
  try {
    return await invoke<RagChunkContextResponse>('rag_get_chunk_context', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取本地 RAG 切片上下文失败'));
  }
}

export interface RagEmbeddingTestResult {
  ok: boolean;
  endpoint: string;
  model: string;
  dimensions: number;
  latencyMs: number;
}

export async function testRagEmbeddingEndpoint(
  options: RagEmbeddingOptions,
): Promise<RagEmbeddingTestResult> {
  try {
    return await invoke<RagEmbeddingTestResult>('rag_test_embedding', {
      request: {
        embedding: {
          ...options,
          baseUrl: normalizeBaseUrl(options.baseUrl) ?? options.baseUrl.trim(),
        },
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, 'Embedding 接口连接测试失败'));
  }
}

export type { RagEmbeddingOptions, RagRetrieveRequest };
