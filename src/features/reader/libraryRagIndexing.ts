import type {
  PositionedMineruBlock,
  ReaderSettings,
  WorkspaceItem,
} from '../../types/reader';
import type { RagEmbeddingOptions } from '../../services/rag';
import { readLocalTextFileIfExists } from '../../services/desktop';
import { ensurePreparedSourceIndexed } from '../../services/localRag';
import { buildMineruMarkdownDocument } from '../../services/summarySource';
import { loadMineruMarkdownDocument } from './documentReaderSummarySource';
import { prepareReaderRagDocument } from './readerRag';

/**
 * MinerU 解析完成后，把文献的 MinerU markdown 源纳入本地 RAG 知识库索引，
 * 让中文文献（以及其他已解析文献）无需先打开阅读器即可被知识库检索。
 *
 * 索引是否可用取决于用户设置：需要启用本地 RAG、检索源包含 mineru-markdown、
 * 且已配置 embedding 服务。任一条件不满足时静默跳过。
 */

export type LibraryRagIndexOutcome = 'indexed' | 'skipped';

export function resolveLibraryRagEmbeddingOptions(
  settings: Pick<
    ReaderSettings,
    | 'localRagEnabled'
    | 'ragSourceMode'
    | 'embeddingBaseUrl'
    | 'embeddingModel'
    | 'embeddingDimensions'
    | 'embeddingRequestTimeoutSeconds'
  >,
  embeddingApiKey: string,
): RagEmbeddingOptions | null {
  if (!settings.localRagEnabled || settings.ragSourceMode === 'off') {
    return null;
  }

  const baseUrl = settings.embeddingBaseUrl.trim();
  const model = settings.embeddingModel.trim();
  const apiKey = embeddingApiKey.trim();

  if (!baseUrl || !model || !apiKey) {
    return null;
  }

  return {
    baseUrl,
    apiKey,
    model,
    dimensions: settings.embeddingDimensions,
    timeoutSeconds: settings.embeddingRequestTimeoutSeconds,
  };
}

export async function indexLibraryPaperMineruSource(input: {
  item: WorkspaceItem;
  settings: Pick<
    ReaderSettings,
    | 'localRagEnabled'
    | 'ragSourceMode'
    | 'embeddingBaseUrl'
    | 'embeddingModel'
    | 'embeddingDimensions'
    | 'embeddingRequestTimeoutSeconds'
    | 'embeddingBatchSize'
    | 'mineruCacheDir'
  >;
  embeddingApiKey: string;
  blocks: PositionedMineruBlock[];
  mineruPath: string;
  /** 新鲜解析结果中已有的 markdown 文本；缺省时回退读取缓存的 full.md。 */
  markdownText?: string | null;
  l: <T>(zh: T, en: T) => T;
}): Promise<LibraryRagIndexOutcome> {
  const embedding = resolveLibraryRagEmbeddingOptions(input.settings, input.embeddingApiKey);

  if (!embedding) {
    return 'skipped';
  }

  const mineruDocumentText = input.markdownText?.trim()
    ? input.markdownText
    : await loadMineruMarkdownDocument({
        item: input.item,
        flatBlocks: input.blocks,
        mineruPath: input.mineruPath,
        mineruCacheDir: input.settings.mineruCacheDir,
        readText: readLocalTextFileIfExists,
        buildFallbackMarkdown: buildMineruMarkdownDocument,
        l: input.l,
      }).catch(() => '');

  const preparedDocument = prepareReaderRagDocument({
    item: input.item,
    settings: input.settings,
    mineruBlocks: input.blocks,
    mineruDocumentText,
    pdfDocumentText: '',
  });
  const mineruSource = preparedDocument.sources.find(
    (source) => source.sourceType === 'mineru-markdown',
  );

  if (!mineruSource) {
    return 'skipped';
  }

  // ensurePreparedSourceIndexed 内部已容错（失败写入索引状态并冷却），不会抛出。
  await ensurePreparedSourceIndexed({
    documentKey: preparedDocument.documentKey,
    title: preparedDocument.title,
    sourceType: mineruSource.sourceType,
    sourceSignature: mineruSource.sourceSignature,
    chunks: mineruSource.chunks,
    embedding,
    batchSize: Math.max(1, input.settings.embeddingBatchSize || 24),
  });

  return 'indexed';
}
