import {
  buildRagEmbeddingModelKey,
  embedRagChunks,
  ragCommitStagedRebuild,
  ragFailStagedRebuild,
  ragPrepareStagedRebuild,
  ragStageEmbeddedChunks,
  ragStageReusedChunks,
  type RagEmbeddingOptions,
} from '../../services/rag';
import type { RagChunkInput, RagSourceMode } from '../../types/reader';
import { emitRagIndexStatusUpdated } from '../../services/ragIndexStatus';

/**
 * 暂存重建：新索引先写入暂存表，完整后一次性替换旧索引。
 * 与 ensurePreparedSourceIndexed 的直写路径相比，重建期间旧索引仍可检索，
 * 中途失败也不会丢掉整篇文献的索引；文本未变化的分块直接复用旧向量。
 */

export type StagedRebuildSourceType = Exclude<RagSourceMode, 'off' | 'hybrid' | 'note'>;

export interface StagedRebuildInput {
  documentKey: string;
  title: string;
  sourceType: StagedRebuildSourceType;
  sourceSignature: string;
  extractorVersion: string | null;
  chunks: RagChunkInput[];
  embedding: RagEmbeddingOptions;
  batchSize: number;
  signal?: AbortSignal;
  /** 失败时把错误写入索引元数据（后台懒重建使用）。 */
  recordFailure?: boolean;
}

export type StagedRebuildResult =
  | { outcome: 'ready' }
  | { outcome: 'failed'; errorMessage: string };

/** 复用旧向量的描述符批次上限：控制单次 IPC 的文本体积。 */
const REUSE_BATCH_SIZE = 200;

const inFlightRebuilds = new Map<string, Promise<StagedRebuildResult>>();

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Indexing aborted');
    error.name = 'AbortError';
    throw error;
  }
}

async function runStagedRebuild(input: StagedRebuildInput): Promise<StagedRebuildResult> {
  const embeddingModelKey = buildRagEmbeddingModelKey(input.embedding);
  const totalChunkCount = input.chunks.length;

  try {
    throwIfAborted(input.signal);

    const prepared = await ragPrepareStagedRebuild({
      documentKey: input.documentKey,
      sourceType: input.sourceType,
      title: input.title,
      sourceSignature: input.sourceSignature,
      embeddingModelKey,
      extractorVersion: input.extractorVersion,
      totalChunkCount,
    });
    const staged = new Set(prepared.stagedChunkIds);
    let remaining = input.chunks.filter((chunk) => !staged.has(chunk.chunkId));

    // 文本完全一致的分块直接复用旧向量，省掉 embedding 调用。
    const stillNeeded: RagChunkInput[] = [];

    for (let index = 0; index < remaining.length; index += REUSE_BATCH_SIZE) {
      throwIfAborted(input.signal);
      const batch = remaining.slice(index, index + REUSE_BATCH_SIZE);
      const reused = await ragStageReusedChunks({
        documentKey: input.documentKey,
        sourceType: input.sourceType,
        embeddingModelKey,
        chunks: batch,
      });
      const reusedSet = new Set(reused.stagedChunkIds);

      for (const chunk of batch) {
        if (!reusedSet.has(chunk.chunkId)) {
          stillNeeded.push(chunk);
        }
      }
    }

    remaining = stillNeeded;

    const batchSize = Math.max(1, input.batchSize || 24);

    for (let index = 0; index < remaining.length; index += batchSize) {
      throwIfAborted(input.signal);
      const batch = remaining.slice(index, index + batchSize);
      const embedded = await embedRagChunks(batch, input.embedding);
      await ragStageEmbeddedChunks({
        documentKey: input.documentKey,
        sourceType: input.sourceType,
        chunks: embedded,
      });
    }

    throwIfAborted(input.signal);
    await ragCommitStagedRebuild({
      documentKey: input.documentKey,
      sourceType: input.sourceType,
      title: input.title,
      sourceSignature: input.sourceSignature,
      embeddingModelKey,
      extractorVersion: input.extractorVersion,
      totalChunkCount,
    });

    emitRagIndexStatusUpdated({
      documentKey: input.documentKey,
      status: 'ready',
      title: input.title,
      sourceType: input.sourceType,
    });
    return { outcome: 'ready' };
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    if (input.recordFailure !== false) {
      emitRagIndexStatusUpdated({
        documentKey: input.documentKey,
        title: input.title,
        sourceType: input.sourceType,
      });
      try {
        await ragFailStagedRebuild({
          documentKey: input.documentKey,
          sourceType: input.sourceType,
          errorMessage: message,
        });
      } catch {
        // 错误元数据写入失败不应掩盖原始错误。
      }
    }

    return { outcome: 'failed', errorMessage: message };
  }
}

/**
 * 同一文献同一来源同时只跑一次重建；重复调用共享同一个 Promise。
 * 旧索引在重建期间保持可检索。
 */
export function rebuildSourceStaged(input: StagedRebuildInput): Promise<StagedRebuildResult> {
  const key = `${input.documentKey}::${input.sourceType}`;
  const existing = inFlightRebuilds.get(key);

  if (existing) {
    return existing;
  }

  const task = runStagedRebuild(input).finally(() => {
    if (inFlightRebuilds.get(key) === task) {
      inFlightRebuilds.delete(key);
    }
  });

  inFlightRebuilds.set(key, task);
  return task;
}

/** 仅测试用：清空在途重建缓存。 */
export function resetStagedRebuildStateForTests(): void {
  inFlightRebuilds.clear();
}
