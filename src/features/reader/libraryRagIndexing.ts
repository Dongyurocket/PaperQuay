import type {
  PositionedMineruBlock,
  ReaderSettings,
  WorkspaceItem,
} from '../../types/reader';
import type { RagEmbeddingOptions } from '../../services/rag';
import { readLocalBinaryFile, readLocalTextFileIfExists } from '../../services/desktop';
import { ensurePreparedSourceIndexed } from '../../services/localRag';
import { buildMineruMarkdownDocument, extractPdfTextByPdfJs } from '../../services/summarySource';
import { loadMineruMarkdownDocument } from './documentReaderSummarySource';
import { prepareReaderRagDocument } from './readerRag';

/**
 * MinerU 解析完成后，把文献的 MinerU markdown 源纳入本地 RAG 知识库索引，
 * 让中文文献（以及其他已解析文献）无需先打开阅读器即可被知识库检索。
 *
 * 索引是否可用取决于用户设置：需要启用本地 RAG、检索源包含目标来源、
 * 且已配置 embedding 服务。任一条件不满足时静默跳过。
 *
 * 自动索引只写 mineru-markdown。hybrid / pdf-text 的 pdf-text 来源平时随阅读器问答懒索引；
 * 手动或批量重建（force）必须把未完成的 pdf-text 一并补齐，否则 MinerU 已就绪时
 * 重建会直接返回，文献卡会一直停在「RAG 待索引」。
 */

export interface LibraryRagIndexResult {
  outcome: 'indexed' | 'skipped' | 'failed' | 'excluded';
  errorMessage?: string;
}

function wantsForcedPdfTextIndex(
  mode: ReaderSettings['ragSourceMode'],
  force: boolean | undefined,
) {
  return force === true && (mode === 'pdf-text' || mode === 'hybrid');
}

function mergeLibraryRagIndexResults(results: readonly LibraryRagIndexResult[]): LibraryRagIndexResult {
  const failed = results.find((result) => result.outcome === 'failed');

  if (failed) {
    return failed;
  }

  const excluded = results.find((result) => result.outcome === 'excluded');

  if (excluded) {
    return excluded;
  }

  if (results.some((result) => result.outcome === 'indexed')) {
    return { outcome: 'indexed' };
  }

  return { outcome: 'skipped' };
}

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

async function indexLibraryPaperPdfTextSource(input: {
  item: WorkspaceItem;
  settings: Pick<ReaderSettings, 'ragSourceMode' | 'embeddingBatchSize'>;
  embedding: RagEmbeddingOptions;
  force?: boolean;
  l: <T>(zh: T, en: T) => T;
}): Promise<LibraryRagIndexResult> {
  const pdfPath = input.item.localPdfPath?.trim() ?? '';

  if (!pdfPath) {
    return {
      outcome: 'failed',
      errorMessage: input.l(
        '缺少 PDF，无法补齐 pdf-text 索引',
        'No PDF is available to finish the pdf-text index',
      ),
    };
  }

  let pdfDocumentText = '';

  try {
    pdfDocumentText = await extractPdfTextByPdfJs(await readLocalBinaryFile(pdfPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      outcome: 'failed',
      errorMessage: input.l(
        `读取 PDF 文本失败：${message}`,
        `Failed to read PDF text: ${message}`,
      ),
    };
  }

  const preparedDocument = prepareReaderRagDocument({
    item: input.item,
    settings: input.settings,
    mineruBlocks: [],
    mineruDocumentText: '',
    pdfDocumentText,
  });
  const pdfSource = preparedDocument.sources.find((source) => source.sourceType === 'pdf-text');

  if (!pdfSource) {
    return {
      outcome: 'failed',
      errorMessage: input.l(
        'PDF 未提取到可用文本，pdf-text 索引无法完成',
        'No usable PDF text was extracted, so the pdf-text index cannot be finished',
      ),
    };
  }

  const result = await ensurePreparedSourceIndexed({
    documentKey: preparedDocument.documentKey,
    title: preparedDocument.title,
    sourceType: pdfSource.sourceType,
    sourceSignature: pdfSource.sourceSignature,
    chunks: pdfSource.chunks,
    embedding: input.embedding,
    batchSize: Math.max(1, input.settings.embeddingBatchSize || 24),
    force: input.force,
  });

  if (result.outcome === 'failed' || result.outcome === 'excluded') {
    return { outcome: result.outcome, errorMessage: result.errorMessage };
  }

  return { outcome: result.outcome === 'ready' ? 'indexed' : 'skipped' };
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
  /** 手动触发时传 true：绕过失败冷却与内存失败缓存，立即重试。 */
  force?: boolean;
  l: <T>(zh: T, en: T) => T;
}): Promise<LibraryRagIndexResult> {
  if (input.item.ragEnabled === false) {
    return { outcome: 'excluded' };
  }

  const embedding = resolveLibraryRagEmbeddingOptions(input.settings, input.embeddingApiKey);

  if (!embedding) {
    return { outcome: 'skipped' };
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
  const results: LibraryRagIndexResult[] = [];
  const includePdfText = wantsForcedPdfTextIndex(input.settings.ragSourceMode, input.force);
  const mineruSource = preparedDocument.sources.find(
    (source) => source.sourceType === 'mineru-markdown',
  );

  if (!mineruSource && !includePdfText) {
    return { outcome: 'skipped' };
  }

  if (mineruSource) {
    // embedding 与索引写入失败已在内部记录状态并冷却，返回 failed；
    // 状态查询等前置 IPC 异常仍可能抛出，由调用方兜底展示。
    const result = await ensurePreparedSourceIndexed({
      documentKey: preparedDocument.documentKey,
      title: preparedDocument.title,
      sourceType: mineruSource.sourceType,
      sourceSignature: mineruSource.sourceSignature,
      chunks: mineruSource.chunks,
      embedding,
      batchSize: Math.max(1, input.settings.embeddingBatchSize || 24),
      force: input.force,
    });

    if (result.outcome === 'failed' || result.outcome === 'excluded') {
      return { outcome: result.outcome, errorMessage: result.errorMessage };
    }

    results.push({ outcome: result.outcome === 'ready' ? 'indexed' : 'skipped' });
  }

  if (includePdfText) {
    results.push(await indexLibraryPaperPdfTextSource({
      item: input.item,
      settings: input.settings,
      embedding,
      force: input.force,
      l: input.l,
    }));
  }

  return mergeLibraryRagIndexResults(results);
}
