import type {
  DocumentChatCitation,
  PositionedMineruBlock,
  RagRetrievalResult,
  ReaderQaScopeMode,
  ReaderSettings,
  WorkspaceItem,
} from '../types/reader';
import {
  buildRagContextText,
  buildRagRetrievalQuery,
  prepareReaderRagDocument,
} from '../features/reader/readerRag';
import type { LocalRagResolution, LocalRagResolutionSuccess } from '../features/reader/readerQaContext';
import { summarizeRagIndexStatuses } from '../features/reader/readerQaContext';
import {
  buildRagEmbeddingModelKey,
  embedRagChunks,
  embedRagText,
  ragFinalizeDocumentIndex,
  ragGetDocumentIndexStatus,
  ragIndexDocument,
  ragListIndexStatuses,
  ragListIndexedChunkIds,
  ragReportDocumentIndexFailure,
  ragRetrieveDocumentChunks,
  ragRetrieveDocumentChunksWithDiagnostics,
  type RagEmbeddingOptions,
} from './rag';
import { emitRagIndexStatusUpdated } from './ragIndexStatus.ts';

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
  outcome: 'ready' | 'skipped' | 'failed' | 'excluded';
  errorMessage?: string;
}

function isRagIndexExcludedMessage(message: string) {
  return message.includes('rag_index_excluded');
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
      emitRagIndexStatusUpdated({
        documentKey: input.documentKey,
        status: 'ready',
        title: input.title,
        sourceType: input.sourceType,
      });
    }
    return { outcome: 'ready' };
  }

  emitRagIndexStatusUpdated({
    documentKey: input.documentKey,
    status: 'pending',
    title: input.title,
    sourceType: input.sourceType,
  });

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
    emitRagIndexStatusUpdated({
      documentKey: input.documentKey,
      status: 'ready',
      title: input.title,
      sourceType: input.sourceType,
    });
    return { outcome: 'ready' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isRagIndexExcludedMessage(message)) {
      emitRagIndexStatusUpdated({
        documentKey: input.documentKey,
        status: 'excluded',
        title: input.title,
        sourceType: input.sourceType,
      });
      return { outcome: 'excluded', errorMessage: message };
    }

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

    emitRagIndexStatusUpdated({
      documentKey: input.documentKey,
      status: 'failed',
      title: input.title,
      error: message,
      sourceType: input.sourceType,
    });
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
  /** 当前文献证据的 token 预算；未提供时不主动截取。 */
  tokenBudget?: number;
}): Promise<LocalRagResolution> {
  if (input.signal?.aborted) {
    const error = new Error('RAG resolution aborted');
    error.name = 'AbortError';
    throw error;
  }

  if (input.item.ragEnabled === false) {
    return { kind: 'excluded' };
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
        const ensured = await ensurePreparedSourceIndexed({
          documentKey: preparedDocument.documentKey,
          title: preparedDocument.title,
          sourceType: source.sourceType,
          sourceSignature: source.sourceSignature,
          chunks: source.chunks,
          embedding: input.embedding,
          batchSize: Math.max(1, input.settings.embeddingBatchSize || 24),
          signal: input.signal,
        });
        if (ensured.outcome === 'excluded') {
          return { kind: 'excluded' };
        }
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
        ragRetrieveDocumentChunksWithDiagnostics({
          documentKey: preparedDocument.documentKey,
          sourceType: source.sourceType,
          embeddingModelKey,
          sourceSignature: source.sourceSignature,
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

  const diagnostics = {
    ftsStatuses: [...new Set(retrievals.map((result) => result.ftsStatus))],
    ftsHitCount: retrievals.reduce((total, result) => total + result.ftsHitCount, 0),
    partialSources: readySources.length < preparedDocument.sources.length,
  };
  const merged = filterRelevantRetrievals(
    retrievals
    .flatMap((result) => result.results)
    .sort((left, right) => left.score - right.score),
    input.settings.localRagTopK,
  );

  if (merged.length === 0) {
    return {
      kind: 'empty',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
      ...diagnostics,
    };
  }

  const contextDocument = buildRagContextText({
    results: merged,
    topK: input.settings.localRagTopK,
    mineruBlocks: input.mineruBlocks,
    preparedSources: preparedDocument.sources,
    paperId: input.item.itemKey,
    paperTitle: input.item.title,
    tokenBudget: input.tokenBudget,
  });

  if (!contextDocument.documentText.trim()) {
    return {
      kind: 'empty',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
      ...diagnostics,
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
    ...diagnostics,
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


export interface ReaderQaScope {
  mode: ReaderQaScopeMode;
  /** selected 范围下用户勾选的文献 ID。 */
  paperIds?: string[];
}

export interface ScopedRagDocument {
  item: WorkspaceItem;
  mineruBlocks: PositionedMineruBlock[];
  mineruDocumentText: string;
  pdfDocumentText: string;
}

export interface ScopedRagSkippedDocument {
  paperId: string;
  title: string;
  reason:
    | 'indexing'
    | 'failed'
    | 'empty'
    | 'no-sources'
    | 'excluded'
    | 'disabled'
    | 'missing-embedding-config'
    | 'budget'
    | 'not-ready'
    | 'missing';
}

export interface ScopedLocalRagResult {
  resolution: LocalRagResolution;
  skippedDocuments: ScopedRagSkippedDocument[];
  consideredPaperIds: string[];
}

function normalizeRagKey(value: string): string {
  return value.trim().replace(/^native-library:/, '');
}

function skippedReasonFromResolution(resolution: LocalRagResolution): ScopedRagSkippedDocument['reason'] {
  switch (resolution.kind) {
    case 'indexing':
      return 'indexing';
    case 'failed':
      return 'failed';
    case 'empty':
      return 'empty';
    case 'no-sources':
      return 'no-sources';
    case 'excluded':
      return 'excluded';
    case 'disabled':
      return 'disabled';
    case 'missing-embedding-config':
      return 'missing-embedding-config';
    default:
      return 'empty';
  }
}

function mergeRetrievedResolutions(
  retrieved: Array<{ item: WorkspaceItem; resolution: LocalRagResolutionSuccess }>,
): { resolution: LocalRagResolutionSuccess; skippedDocuments: ScopedRagSkippedDocument[] } {
  const skippedDocuments: ScopedRagSkippedDocument[] = [];
  let documentText = '';
  const citations: DocumentChatCitation[] = [];
  const retrievals: RagRetrievalResult[] = [];
  let indexedChunkCount = 0;
  let totalChunkCount = 0;
  let ftsHitCount = 0;
  const ftsStatuses = new Set<string>();
  const embeddedPapers: Array<{ resolution: LocalRagResolutionSuccess }> = [];

  for (const entry of retrieved) {
    if (!entry.resolution.documentText.trim()) {
      skippedDocuments.push({ paperId: entry.item.itemKey, title: entry.item.title, reason: 'empty' });
      continue;
    }
    documentText += `${documentText ? '\n\n' : ''}${entry.resolution.documentText}`;
    citations.push(...entry.resolution.citations);
    retrievals.push(...entry.resolution.retrievals);
    indexedChunkCount += Number(entry.resolution.indexedChunkCount) || 0;
    totalChunkCount += Number(entry.resolution.totalChunkCount) || 0;
    ftsHitCount += Number(entry.resolution.ftsHitCount) || 0;
    for (const status of entry.resolution.ftsStatuses ?? []) ftsStatuses.add(status);
    embeddedPapers.push({ resolution: entry.resolution });
  }

  return {
    resolution: {
      kind: 'retrieved',
      documentText: documentText.trim(),
      retrievedChunkCount: embeddedPapers.reduce((sum, entry) => sum + entry.resolution.retrievedChunkCount, 0),
      citations,
      retrievals,
      indexedChunkCount,
      totalChunkCount,
      ftsStatuses: [...ftsStatuses] as LocalRagResolutionSuccess['ftsStatuses'],
      ftsHitCount,
      partialSources: skippedDocuments.length > 0,
    },
    skippedDocuments,
  };
}

/**
 * 阅读器问答的多文献范围检索。
 *
 * - current：沿用单文献完整路径（含懒建索引）。
 * - selected：逐篇检索，每篇最多 localRagTopK；未就绪索引先尝试懒建，失败后列入跳过清单。
 * - library：只使用已就绪索引，用一个全局 localRagTopK 检索；不触发整库建索引。
 */
export async function resolveScopedLocalRag(input: {
  scope: ReaderQaScope;
  documents: ScopedRagDocument[];
  libraryItems: WorkspaceItem[];
  settings: Pick<
    ReaderSettings,
    'localRagEnabled' | 'localRagTopK' | 'ragSourceMode' | 'embeddingBatchSize'
  >;
  embedding: RagEmbeddingOptions;
  question: string;
  excerptText?: string | null;
  tokenBudget?: number;
  signal?: AbortSignal;
}): Promise<ScopedLocalRagResult> {
  const consideredPaperIds: string[] = [];
  const scopePaperIds = Array.isArray(input.scope.paperIds) ? input.scope.paperIds : [];
  const documents = input.scope.mode === 'selected'
    ? input.documents.filter((document) => scopePaperIds.includes(document.item.itemKey))
    : input.documents.slice(0, 1);

  if (input.scope.mode === 'current') {
    const document = documents[0];
    if (!document) {
      return {
        resolution: { kind: 'no-sources' },
        skippedDocuments: [],
        consideredPaperIds: [],
      };
    }
    const resolution = await resolveLocalRag({
      item: document.item,
      settings: input.settings,
      embedding: input.embedding,
      question: input.question,
      excerptText: input.excerptText,
      mineruBlocks: document.mineruBlocks,
      mineruDocumentText: document.mineruDocumentText,
      pdfDocumentText: document.pdfDocumentText,
      signal: input.signal,
      tokenBudget: input.tokenBudget,
    });
    return {
      resolution,
      skippedDocuments: resolution.kind === 'retrieved'
        ? []
        : [{ paperId: document.item.itemKey, title: document.item.title, reason: skippedReasonFromResolution(resolution) }],
      consideredPaperIds: [document.item.itemKey],
    };
  }

  if (input.scope.mode === 'selected') {
    // 每篇文献至少分到一条证据的空间；预算不足时按文献依次保留（调用方已按相关性排序）。
    const perDocumentBudget = typeof input.tokenBudget === 'number' && input.tokenBudget > 0
      ? Math.max(300, Math.floor(input.tokenBudget / Math.max(1, documents.length)))
      : undefined;
    const retrieved: Array<{ item: WorkspaceItem; resolution: LocalRagResolutionSuccess }> = [];
    const skippedDocuments: ScopedRagSkippedDocument[] = [];
    let citationOffset = 0;

    for (const document of documents) {
      if (input.signal?.aborted) {
        const error = new Error('RAG resolution aborted');
        error.name = 'AbortError';
        throw error;
      }
      consideredPaperIds.push(document.item.itemKey);
      const resolution = await resolveLocalRag({
        item: document.item,
        settings: input.settings,
        embedding: input.embedding,
        question: input.question,
        excerptText: input.excerptText,
        mineruBlocks: document.mineruBlocks,
        mineruDocumentText: document.mineruDocumentText,
        pdfDocumentText: document.pdfDocumentText,
        signal: input.signal,
        tokenBudget: perDocumentBudget,
      });

      if (resolution.kind !== 'retrieved' || !resolution.documentText.trim()) {
        skippedDocuments.push({
          paperId: document.item.itemKey,
          title: document.item.title,
          reason: skippedReasonFromResolution(resolution),
        });
        continue;
      }

      const citations = resolution.citations.map((citation, index) => {
        const label = String(citationOffset + index + 1);
        return { ...citation, id: `cite:${label}`, label };
      });
      const offset = citationOffset;
      const renumberedText = resolution.documentText.replace(
        /^# Source \[(\d+)\]$/gm,
        (_match, number: string) => `# Source [${Number(number) + offset}]`,
      );
      citationOffset += resolution.citations.length;
      retrieved.push({
        item: document.item,
        resolution: { ...resolution, documentText: renumberedText, citations },
      });
    }

    if (retrieved.length === 0) {
      const firstReason = skippedDocuments[0]?.reason ?? 'empty';
      const allIndexing = skippedDocuments.every((entry) => entry.reason === 'indexing');
      const allExcluded = skippedDocuments.every((entry) => entry.reason === 'excluded');
      return {
        resolution: allExcluded
          ? { kind: 'excluded' }
          : allIndexing
            ? { kind: 'indexing' }
            : firstReason === 'failed'
              ? { kind: 'failed', errorMessage: '所选文献的本地索引不可用' }
              : firstReason === 'disabled'
                ? { kind: 'disabled' }
                : firstReason === 'missing-embedding-config'
                  ? { kind: 'missing-embedding-config' }
                  : { kind: 'empty' },
        skippedDocuments,
        consideredPaperIds,
      };
    }

    const merged = mergeRetrievedResolutions(retrieved);
    return {
      resolution: merged.resolution,
      skippedDocuments: [...skippedDocuments, ...merged.skippedDocuments],
      consideredPaperIds,
    };
  }

  // library：只读已就绪索引，不触发整库建索引。
  const excluded = new Set<string>();
  for (const item of input.libraryItems) {
    if (item.ragEnabled === false) {
      excluded.add(normalizeRagKey(item.itemKey));
      excluded.add(item.itemKey);
    }
  }
  const embeddingModelKey = buildRagEmbeddingModelKey(input.embedding);
  const statuses = await ragListIndexStatuses();
  const readyKeys = [...new Set(statuses
    .filter((status) => status.status === 'ready'
      && status.embeddingModelKey === embeddingModelKey
      && !excluded.has(status.documentKey)
      && !excluded.has(normalizeRagKey(status.documentKey)))
    .map((status) => status.documentKey)
    .filter(Boolean))];

  if (readyKeys.length === 0) {
    return {
      resolution: { kind: 'indexing' },
      skippedDocuments: [],
      consideredPaperIds,
    };
  }

  const queryText = buildRagRetrievalQuery(input.question, input.excerptText);
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedRagText(queryText, input.embedding);
  } catch (error) {
    return {
      resolution: {
        kind: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      skippedDocuments: [],
      consideredPaperIds: readyKeys,
    };
  }

  if (queryEmbedding.length === 0) {
    return { resolution: { kind: 'empty' }, skippedDocuments: [], consideredPaperIds: readyKeys };
  }

  const diagnostics = await ragRetrieveDocumentChunksWithDiagnostics({
    documentKeys: readyKeys,
    embeddingModelKey,
    queryEmbedding,
    queryText,
    topK: input.settings.localRagTopK,
  });
  const merged = filterRelevantRetrievals(
    diagnostics.results.slice().sort((left, right) => left.score - right.score),
    input.settings.localRagTopK,
  );

  if (merged.length === 0) {
    return {
      resolution: {
        kind: 'empty',
        ftsStatuses: [diagnostics.ftsStatus],
        ftsHitCount: diagnostics.ftsHitCount,
      },
      skippedDocuments: [],
      consideredPaperIds: readyKeys,
    };
  }

  const paperByKey = new Map<string, { paperId: string; paperTitle: string }>();
  for (const item of input.libraryItems) {
    paperByKey.set(item.itemKey, { paperId: item.itemKey, paperTitle: item.title });
    paperByKey.set(item.workspaceId, { paperId: item.itemKey, paperTitle: item.title });
    paperByKey.set(`native-library:${item.itemKey}`, { paperId: item.itemKey, paperTitle: item.title });
  }

  const contextDocument = buildRagContextText({
    results: merged,
    topK: input.settings.localRagTopK,
    mineruBlocks: [],
    preparedSources: [],
    paperLookup: (result) => {
      const key = result.documentKey ?? '';
      return paperByKey.get(key) ?? paperByKey.get(normalizeRagKey(key)) ?? null;
    },
    tokenBudget: input.tokenBudget,
  });

  if (!contextDocument.documentText.trim()) {
    return {
      resolution: {
        kind: 'empty',
        ftsStatuses: [diagnostics.ftsStatus],
        ftsHitCount: diagnostics.ftsHitCount,
      },
      skippedDocuments: [],
      consideredPaperIds: readyKeys,
    };
  }

  return {
    resolution: {
      kind: 'retrieved',
      documentText: contextDocument.documentText,
      retrievedChunkCount: contextDocument.sectionCount,
      citations: contextDocument.citations,
      retrievals: contextDocument.retrievals,
      budgetSkippedCount: contextDocument.budgetSkippedCount,
      indexedChunkCount: merged.length,
      totalChunkCount: merged.length,
      ftsStatuses: [diagnostics.ftsStatus],
      ftsHitCount: diagnostics.ftsHitCount,
      partialSources: readyKeys.length < input.libraryItems.length,
    },
    skippedDocuments: [],
    consideredPaperIds: readyKeys,
  };
}
