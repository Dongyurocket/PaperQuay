import type { PositionedMineruBlock, ReaderSettings, WorkspaceItem } from '../types/reader';
import {
  buildRagContextText,
  buildRagRetrievalQuery,
  prepareReaderRagDocument,
} from '../features/reader/readerRag';
import type { LocalRagResolution } from '../features/reader/readerQaContext';
import { summarizeRagIndexStatuses } from '../features/reader/readerQaContext';
import {
  buildRagEmbeddingModelKey,
  embedRagChunks,
  embedRagText,
  ragFinalizeDocumentIndex,
  ragGetDocumentIndexStatus,
  ragIndexDocument,
  ragListIndexedChunkIds,
  ragReportDocumentIndexFailure,
  ragRetrieveDocumentChunks,
  type RagEmbeddingOptions,
} from './rag';
import { RAG_INDEX_STATUS_UPDATED_EVENT } from './ragIndexStatus';

function emitRagIndexStatusUpdated(documentKey: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(RAG_INDEX_STATUS_UPDATED_EVENT, { detail: { documentKey } }),
  );
}

const RAG_INDEX_FAILURE_COOLDOWN_MS = 60_000;
const RAG_RESULT_MIN_MARGIN = 0.12;
const RAG_RESULT_MAX_MARGIN = 0.45;
const RAG_RESULT_RELATIVE_MARGIN = 0.4;

const ragIndexFailureCache = new Map<string, { failedAt: number; message: string }>();

function ragFailureCacheKey(
  documentKey: string,
  sourceType: string,
  sourceSignature: string,
  embeddingModelKey: string,
): string {
  return `${documentKey}::${sourceType}::${sourceSignature}::${embeddingModelKey}`;
}

function getCachedRagIndexFailure(
  documentKey: string,
  sourceType: string,
  sourceSignature: string,
  embeddingModelKey: string,
) {
  const key = ragFailureCacheKey(documentKey, sourceType, sourceSignature, embeddingModelKey);
  const cached = ragIndexFailureCache.get(key);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.failedAt > RAG_INDEX_FAILURE_COOLDOWN_MS) {
    ragIndexFailureCache.delete(key);
    return null;
  }

  return cached;
}

function setCachedRagIndexFailure(
  documentKey: string,
  sourceType: string,
  sourceSignature: string,
  embeddingModelKey: string,
  message: string,
) {
  ragIndexFailureCache.set(
    ragFailureCacheKey(documentKey, sourceType, sourceSignature, embeddingModelKey),
    {
      failedAt: Date.now(),
      message,
    },
  );
}

function clearCachedRagIndexFailure(
  documentKey: string,
  sourceType: string,
  sourceSignature: string,
  embeddingModelKey: string,
) {
  ragIndexFailureCache.delete(
    ragFailureCacheKey(documentKey, sourceType, sourceSignature, embeddingModelKey),
  );
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const normalizedSize = Math.max(1, size);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += normalizedSize) {
    chunks.push(items.slice(index, index + normalizedSize));
  }

  return chunks;
}

function shouldSkipFailedStatus(cooldownUntil?: number | null) {
  return typeof cooldownUntil === 'number' && Number.isFinite(cooldownUntil) && cooldownUntil > Date.now();
}

function filterRelevantRetrievals(
  results: Awaited<ReturnType<typeof ragRetrieveDocumentChunks>>,
  topK: number,
) {
  if (results.length <= 1) {
    return results.slice(0, topK);
  }

  const sorted = [...results].sort((left, right) => left.score - right.score);
  const bestScore = sorted[0]?.score ?? 0;
  const dynamicMargin = Math.max(
    RAG_RESULT_MIN_MARGIN,
    Math.min(RAG_RESULT_MAX_MARGIN, Math.abs(bestScore) * RAG_RESULT_RELATIVE_MARGIN),
  );
  const threshold = bestScore + dynamicMargin;
  const filtered = sorted.filter((result, index) => index === 0 || result.score <= threshold);

  return (filtered.length > 0 ? filtered : sorted).slice(0, topK);
}

export interface RagIndexEnsureResult {
  outcome: 'ready' | 'skipped' | 'failed';
  errorMessage?: string;
}

export async function ensurePreparedSourceIndexed(input: {
  documentKey: string;
  title: string;
  sourceType: 'mineru-markdown' | 'pdf-text';
  sourceSignature: string;
  chunks: Array<{
    chunkId: string;
    chunkIndex: number;
    pageIndex: number | null;
    blockId?: string | null;
    text: string;
  }>;
  embedding: RagEmbeddingOptions;
  batchSize: number;
  /** 手动触发时传 true：绕过失败冷却与内存失败缓存，立即重试。 */
  force?: boolean;
  signal?: AbortSignal;
}): Promise<RagIndexEnsureResult> {
  if (input.signal?.aborted) {
    const error = new Error('Indexing aborted');
    error.name = 'AbortError';
    throw error;
  }
  const embeddingModelKey = buildRagEmbeddingModelKey(input.embedding);
  const currentStatus = await ragGetDocumentIndexStatus(input.documentKey, input.sourceType);
  const cachedFailure = getCachedRagIndexFailure(
    input.documentKey,
    input.sourceType,
    input.sourceSignature,
    embeddingModelKey,
  );

  if (
    currentStatus?.sourceSignature === input.sourceSignature &&
    currentStatus.embeddingModelKey === embeddingModelKey &&
    currentStatus.indexedChunkCount >= input.chunks.length &&
    currentStatus.status === 'ready'
  ) {
    clearCachedRagIndexFailure(
      input.documentKey,
      input.sourceType,
      input.sourceSignature,
      embeddingModelKey,
    );
    return { outcome: 'ready' };
  }

  if (
    !input.force &&
    currentStatus?.sourceSignature === input.sourceSignature &&
    currentStatus.embeddingModelKey === embeddingModelKey &&
    currentStatus.status === 'failed' &&
    shouldSkipFailedStatus(currentStatus.cooldownUntil)
  ) {
    return { outcome: 'skipped' };
  }

  if (!input.force && cachedFailure) {
    return { outcome: 'skipped' };
  }

  // 断续索引按 chunkId 差集计算真实缺口：历史上的中断或缺陷可能导致
  // indexed_chunk_count 与实际入库的 chunk 行错位；只按位置 slice 会反复
  // 重发已存在的 chunk、永远补不上缺失的低位 chunk，状态停在 pending 形成不动点。
  const hasMatchingProgress =
    currentStatus?.sourceSignature === input.sourceSignature &&
    currentStatus.embeddingModelKey === embeddingModelKey &&
    (currentStatus.status === 'pending' || currentStatus.status === 'ready') &&
    currentStatus.indexedChunkCount > 0;
  const existingChunkIds = hasMatchingProgress
    ? new Set(await ragListIndexedChunkIds(input.documentKey, input.sourceType))
    : null;
  const remainingChunks = existingChunkIds
    ? input.chunks.filter((chunk) => !existingChunkIds.has(chunk.chunkId))
    : input.chunks;

  if (remainingChunks.length === 0) {
    // 缺口为空但状态尚未收敛为 ready（历史缺陷状态），通过 finalize 修正计数与状态。
    if (currentStatus && currentStatus.status !== 'ready') {
      await ragFinalizeDocumentIndex({
        documentKey: input.documentKey,
        title: input.title,
        sourceType: input.sourceType,
        sourceSignature: input.sourceSignature,
        embeddingModelKey,
        totalChunkCount: input.chunks.length,
        expectedChunkIds: input.chunks.map((chunk) => chunk.chunkId),
      });
      emitRagIndexStatusUpdated(input.documentKey);
    }
    return { outcome: 'ready' };
  }

  try {
    for (const batch of chunkItems(remainingChunks, input.batchSize)) {
      if (input.signal?.aborted) {
        const error = new Error('Indexing aborted');
        error.name = 'AbortError';
        throw error;
      }
      const indexedChunks = await embedRagChunks(batch, input.embedding);
      const indexedChunkById = new Map(indexedChunks.map((chunk) => [chunk.chunkId, chunk]));
      const contiguousReadyChunks = [];

      for (const chunk of batch) {
        const indexedChunk = indexedChunkById.get(chunk.chunkId);

        if (!indexedChunk) {
          break;
        }

        contiguousReadyChunks.push(indexedChunk);
      }

      if (contiguousReadyChunks.length > 0) {
        await ragIndexDocument({
          documentKey: input.documentKey,
          title: input.title,
          sourceType: input.sourceType,
          sourceSignature: input.sourceSignature,
          embeddingModelKey,
          generationId: input.sourceSignature,
          totalChunkCount: input.chunks.length,
          chunks: contiguousReadyChunks.map((chunk) => ({
            ...chunk,
            textVersion: chunk.textVersion ?? input.sourceSignature,
          })),
        });
      }

      if (contiguousReadyChunks.length !== batch.length) {
        throw new Error(`Embedding service returned incomplete vectors for ${input.sourceType}`);
      }
    }

    // 循环成功后按期望 chunkId 集收敛状态并清理可能的陈旧行，
    // 避免计数错位或历史残留导致状态停在 pending。
    await ragFinalizeDocumentIndex({
      documentKey: input.documentKey,
      title: input.title,
      sourceType: input.sourceType,
      sourceSignature: input.sourceSignature,
      embeddingModelKey,
      totalChunkCount: input.chunks.length,
      expectedChunkIds: input.chunks.map((chunk) => chunk.chunkId),
    });

    clearCachedRagIndexFailure(
      input.documentKey,
      input.sourceType,
      input.sourceSignature,
      embeddingModelKey,
    );
    emitRagIndexStatusUpdated(input.documentKey);
    return { outcome: 'ready' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    setCachedRagIndexFailure(
      input.documentKey,
      input.sourceType,
      input.sourceSignature,
      embeddingModelKey,
      message,
    );

    try {
      await ragReportDocumentIndexFailure({
        documentKey: input.documentKey,
        title: input.title,
        sourceType: input.sourceType,
        sourceSignature: input.sourceSignature,
        embeddingModelKey,
        totalChunkCount: input.chunks.length,
        errorMessage: message,
        retryAfterMs: RAG_INDEX_FAILURE_COOLDOWN_MS,
      });
    } catch {
      // 失败状态写回失败属于次要故障，保留原始错误信息向上传递。
    }

    emitRagIndexStatusUpdated(input.documentKey);
    return { outcome: 'failed', errorMessage: message };
  }
}

export async function resolveLocalRagContext(input: {
  item: WorkspaceItem;
  settings: Pick<
    ReaderSettings,
    'localRagEnabled' | 'localRagTopK' | 'ragSourceMode' | 'embeddingBatchSize'
  >;
  embedding: RagEmbeddingOptions;
  question: string;
  excerptText?: string | null;
  mineruBlocks: PositionedMineruBlock[];
  mineruDocumentText: string;
  pdfDocumentText: string;
}): Promise<string> {
  const result = await resolveLocalRag(input);
  return result.kind === 'retrieved' ? result.documentText : '';
}

export async function resolveLocalRag(input: {
  item: WorkspaceItem;
  settings: Pick<
    ReaderSettings,
    'localRagEnabled' | 'localRagTopK' | 'ragSourceMode' | 'embeddingBatchSize'
  >;
  embedding: RagEmbeddingOptions;
  question: string;
  excerptText?: string | null;
  mineruBlocks: PositionedMineruBlock[];
  mineruDocumentText: string;
  pdfDocumentText: string;
  signal?: AbortSignal;
  /** 为 false 时不阻塞当前检索调用，未就绪的来源在后台异步调度索引。缺省为 true。 */
  syncIndexing?: boolean;
}): Promise<LocalRagResolution> {
  if (input.signal?.aborted) {
    const error = new Error('RAG resolution aborted');
    error.name = 'AbortError';
    throw error;
  }

  if (!input.settings.localRagEnabled || input.settings.ragSourceMode === 'off') {
    return {
      kind: 'disabled',
    };
  }

  const preparedDocument = prepareReaderRagDocument({
    item: input.item,
    settings: input.settings,
    mineruBlocks: input.mineruBlocks,
    mineruDocumentText: input.mineruDocumentText,
    pdfDocumentText: input.pdfDocumentText,
  });

  if (preparedDocument.sources.length === 0) {
    return {
      kind: 'no-sources',
    };
  }

  try {
    if (input.syncIndexing === false) {
      for (const source of preparedDocument.sources) {
        void ensurePreparedSourceIndexed({
          documentKey: preparedDocument.documentKey,
          title: preparedDocument.title,
          sourceType: source.sourceType,
          sourceSignature: source.sourceSignature,
          chunks: source.chunks,
          embedding: input.embedding,
          batchSize: Math.max(1, input.settings.embeddingBatchSize || 24),
        }).catch((err) => {
          console.warn('[paperquay] Background RAG indexing failed:', err);
        });
      }
    } else {
      for (const source of preparedDocument.sources) {
        if (input.signal?.aborted) {
          const error = new Error('RAG resolution aborted');
          error.name = 'AbortError';
          throw error;
        }
        await ensurePreparedSourceIndexed({
          documentKey: preparedDocument.documentKey,
          title: preparedDocument.title,
          sourceType: source.sourceType,
          sourceSignature: source.sourceSignature,
          chunks: source.chunks,
          embedding: input.embedding,
          batchSize: Math.max(1, input.settings.embeddingBatchSize || 24),
          signal: input.signal,
        });
      }
    }
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw error;
    }
    return {
      kind: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  if (input.signal?.aborted) {
    const error = new Error('RAG resolution aborted');
    error.name = 'AbortError';
    throw error;
  }

  const statuses = await Promise.all(
    preparedDocument.sources.map((source) =>
      ragGetDocumentIndexStatus(preparedDocument.documentKey, source.sourceType),
    ),
  );
  const statusSummary = summarizeRagIndexStatuses(statuses);
  const embeddingModelKey = buildRagEmbeddingModelKey(input.embedding);
  const readySources = preparedDocument.sources.filter((source, index) => {
    const status = statuses[index];

    return (
      status?.status === 'ready' &&
      status.sourceSignature === source.sourceSignature &&
      status.embeddingModelKey === embeddingModelKey
    );
  });
  const hasFailedSource = statuses.some((status, index) => {
    const source = preparedDocument.sources[index];

    return (
      status?.status === 'failed' &&
      status.sourceSignature === source?.sourceSignature &&
      status.embeddingModelKey === embeddingModelKey
    );
  });

  if (readySources.length === 0) {
    if (hasFailedSource) {
      return {
        kind: 'failed',
        errorMessage: statusSummary.errorMessage || '本地 RAG 索引失败',
      };
    }

    return {
      kind: 'indexing',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
      errorMessage: statusSummary.errorMessage,
    };
  }

  let queryEmbedding: number[];
  const queryText = buildRagRetrievalQuery(input.question, input.excerptText);

  try {
    queryEmbedding = await embedRagText(
      queryText,
      input.embedding,
    );
  } catch (error) {
    return {
      kind: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  if (queryEmbedding.length === 0) {
    return {
      kind: 'empty',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
    };
  }

  let retrievals;

  try {
    retrievals = await Promise.all(
      readySources.map((source) =>
        ragRetrieveDocumentChunks({
          documentKey: preparedDocument.documentKey,
          sourceType: source.sourceType,
          queryEmbedding,
          queryText,
          topK: input.settings.localRagTopK,
        }),
      ),
    );
  } catch (error) {
    return {
      kind: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  const merged = filterRelevantRetrievals(
    retrievals
    .flat()
    .sort((left, right) => left.score - right.score),
    input.settings.localRagTopK,
  );

  if (merged.length === 0) {
    return {
      kind: 'empty',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
    };
  }

  const contextDocument = buildRagContextText({
    results: merged,
    topK: input.settings.localRagTopK,
    mineruBlocks: input.mineruBlocks,
    preparedSources: preparedDocument.sources,
  });

  if (!contextDocument.documentText.trim()) {
    return {
      kind: 'empty',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
    };
  }

  return {
    kind: 'retrieved',
    documentText: contextDocument.documentText,
    retrievedChunkCount: contextDocument.sectionCount,
    citations: contextDocument.citations,
    retrievals: contextDocument.retrievals,
    indexedChunkCount: statusSummary.indexedChunkCount,
    totalChunkCount: statusSummary.totalChunkCount,
  };
}

export async function resolveLibraryPaperRagContext(input: {
  item: WorkspaceItem;
  settings: Pick<
    ReaderSettings,
    'localRagEnabled' | 'localRagTopK' | 'ragSourceMode' | 'embeddingBatchSize'
  >;
  embedding: RagEmbeddingOptions;
  question: string;
  excerptText?: string | null;
  mineruBlocks?: PositionedMineruBlock[];
  mineruDocumentText?: string;
  pdfDocumentText: string;
}): Promise<string> {
  return resolveLocalRagContext({
    item: input.item,
    settings: input.settings,
    embedding: input.embedding,
    question: input.question,
    excerptText: input.excerptText,
    mineruBlocks: input.mineruBlocks ?? [],
    mineruDocumentText: input.mineruDocumentText ?? '',
    pdfDocumentText: input.pdfDocumentText,
  });
}
