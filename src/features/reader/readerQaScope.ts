import type { LiteraturePaper } from '../../types/library';
import type {
  PositionedMineruBlock,
  ReaderSettings,
  WorkspaceItem,
} from '../../types/reader';
import type {
  ScopedLocalRagResult,
  ScopedRagDocument,
  ScopedRagSkippedDocument,
} from '../../services/localRag';

export type ReaderQaScopeLocaleText = (zh: string, en: string) => string;

/**
 * 多文献问答的范围文档加载依赖。全部由调用方注入，模块本身不直接读磁盘，
 * 便于在 node:test 里用假实现覆盖缓存、缺 PDF、PDF 文本提取等分支。
 */
export interface ScopedRagDocumentLoadDeps {
  createItem: (paper: LiteraturePaper) => WorkspaceItem | null;
  loadLibraryPreviewBlocks?: (item: WorkspaceItem) => Promise<{ blocks: PositionedMineruBlock[] }>;
  readLocalBinaryFile: (path: string) => Promise<Uint8Array>;
  extractPdfTextByPdfJs: (data: Uint8Array) => Promise<string>;
  buildMineruMarkdownDocument: (blocks: PositionedMineruBlock[]) => string;
}

export interface ScopedRagDocumentLoadInput {
  papers: LiteraturePaper[];
  paperIds: string[];
  /** 当前已打开的文献，避免为它重复读盘。 */
  currentDocument?: ScopedRagDocument;
  storageDir?: string | null;
  ragSourceMode: ReaderSettings['ragSourceMode'];
  cache?: Map<string, ScopedRagDocument>;
  signal?: AbortSignal;
  deps: ScopedRagDocumentLoadDeps;
}

export interface ScopedRagDocumentLoadResult {
  documents: ScopedRagDocument[];
  /** 没找到文献记录、没有 PDF、或加载器缺失的条目。 */
  missing: ScopedRagSkippedDocument[];
}

function abortError(): Error {
  const error = new Error('RAG resolution aborted');
  error.name = 'AbortError';
  return error;
}

function fallbackItem(paper: LiteraturePaper): WorkspaceItem {
  const workspaceId = `native-library:${paper.id}`;

  return {
    itemKey: paper.id,
    title: paper.title,
    creators: paper.authors.length > 0
      ? paper.authors.map((author) => author.name).join(', ')
      : 'Unknown Authors',
    year: paper.year ?? '',
    itemType: 'pdf',
    source: 'native-library',
    workspaceId,
    groupKey: workspaceId,
    ragEnabled: paper.ragEnabled,
  };
}

/**
 * 全库范围只需要文献身份与 ragEnabled，用来排除文献、映射引用标题；
 * 没有 PDF 的文献仍应参与“已排除 / 未就绪”的判断，所以补一个最小 WorkspaceItem。
 */
export function buildScopedRagLibraryItems(
  papers: LiteraturePaper[],
  createItem: (paper: LiteraturePaper) => WorkspaceItem | null,
): WorkspaceItem[] {
  return papers.map((paper) => createItem(paper) ?? fallbackItem(paper));
}

function cacheKey(item: WorkspaceItem, paper: LiteraturePaper): string {
  return `${item.workspaceId}::${paper.updatedAt}::${item.localPdfPath ?? ''}`;
}

async function loadDocument(
  item: WorkspaceItem,
  ragSourceMode: ReaderSettings['ragSourceMode'],
  deps: ScopedRagDocumentLoadDeps,
): Promise<ScopedRagDocument> {
  let blocks: PositionedMineruBlock[] = [];

  if (deps.loadLibraryPreviewBlocks) {
    try {
      const preview = await deps.loadLibraryPreviewBlocks(item);
      blocks = preview?.blocks ?? [];
    } catch {
      blocks = [];
    }
  }

  let mineruDocumentText = '';

  if (blocks.length > 0) {
    try {
      mineruDocumentText = deps.buildMineruMarkdownDocument(blocks);
    } catch {
      mineruDocumentText = '';
    }
  }

  let pdfDocumentText = '';

  if (
    (ragSourceMode === 'pdf-text' || ragSourceMode === 'hybrid') &&
    item.localPdfPath
  ) {
    try {
      const bytes = await deps.readLocalBinaryFile(item.localPdfPath);
      pdfDocumentText = await deps.extractPdfTextByPdfJs(bytes);
    } catch {
      pdfDocumentText = '';
    }
  }

  return {
    item,
    mineruBlocks: blocks,
    mineruDocumentText,
    pdfDocumentText,
  };
}

/**
 * 为 selected scope 准备逐篇检索文档。
 *
 * - 当前已打开的文献直接复用已加载的块和 PDF 文本；
 * - 其他文献按 workspaceId + updatedAt + PDF 路径缓存，避免每次提问重读；
 * - 没有文献记录或没有 PDF 的条目返回 missing，由调用方合并进 skipped 清单。
 */
export async function loadScopedRagDocuments(
  input: ScopedRagDocumentLoadInput,
): Promise<ScopedRagDocumentLoadResult> {
  const papersById = new Map(input.papers.map((paper) => [paper.id, paper]));
  const documents: ScopedRagDocument[] = [];
  const missing: ScopedRagSkippedDocument[] = [];
  const seen = new Set<string>();

  for (const paperId of input.paperIds) {
    if (input.signal?.aborted) throw abortError();
    if (seen.has(paperId)) continue;
    seen.add(paperId);

    const paper = papersById.get(paperId);

    if (!paper) {
      missing.push({ paperId, title: paperId, reason: 'missing' });
      continue;
    }

    let item: WorkspaceItem | null = null;

    try {
      item = input.deps.createItem(paper);
    } catch {
      item = null;
    }

    if (!item) {
      missing.push({ paperId: paper.id, title: paper.title, reason: 'missing' });
      continue;
    }

    if (
      input.currentDocument &&
      (input.currentDocument.item.itemKey === item.itemKey ||
        input.currentDocument.item.workspaceId === item.workspaceId)
    ) {
      documents.push(input.currentDocument);
      continue;
    }

    const key = cacheKey(item, paper);
    const cached = input.cache?.get(key);

    if (cached) {
      documents.push(cached);
      continue;
    }

    const document = await loadDocument(item, input.ragSourceMode, input.deps);

    if (
      document.mineruBlocks.length > 0 ||
      document.mineruDocumentText.trim() ||
      document.pdfDocumentText.trim()
    ) {
      input.cache?.set(key, document);
    }

    documents.push(document);
  }

  return { documents, missing };
}

function skippedSuffix(
  skipped: ScopedRagSkippedDocument[],
  l: ReaderQaScopeLocaleText,
): string {
  const titles = [...new Set(skipped.map((entry) => entry.title.trim()).filter(Boolean))];

  if (titles.length === 0) {
    return '';
  }

  const shown = titles.slice(0, 6);
  const overflow = titles.length - shown.length;
  const label = overflow > 0
    ? l(`${shown.join('、')} 等 ${titles.length} 篇`, `${shown.join(', ')} and ${overflow} more`)
    : shown.join(l('、', ', '));

  return l(`（已跳过：${label}）`, ` (skipped: ${label})`);
}

/**
 * 把 scoped resolution 的非成功状态翻译成用户能采取动作的错误。
 * 与单文献回退不同，多文献范围没有“当前文献全文”可退，必须明确失败原因。
 */
export function describeScopedRagFailure(
  result: Pick<ScopedLocalRagResult, 'resolution' | 'skippedDocuments'>,
  l: ReaderQaScopeLocaleText,
): string {
  const suffix = skippedSuffix(result.skippedDocuments, l);
  const resolution = result.resolution;

  switch (resolution.kind) {
    case 'indexing':
      return l(
        `所选范围内没有可用的已就绪索引；请先在文献库中完成索引，或缩小检索范围。${suffix}`,
        `No ready index is available in the selected scope. Index the papers first, or narrow the scope.${suffix}`,
      );
    case 'failed': {
      const detail = resolution.errorMessage?.trim();
      const reason = detail ? l(`：${detail}`, `: ${detail}`) : '';
      return l(
        `所选范围的本地索引不可用，请检查嵌入模型配置后重试。${reason}${suffix}`,
        `Local retrieval failed for the selected scope. Check the embedding configuration and retry.${reason}${suffix}`,
      );
    }
    case 'excluded':
      return l(
        `所选文献都已移出本地知识库。${suffix}`,
        `Every selected paper is excluded from the local knowledge base.${suffix}`,
      );
    case 'no-sources':
      return l(
        `所选文献没有可用于检索的正文；请先完成 MinerU 解析或确认 PDF 可读。${suffix}`,
        `The selected papers have no text available for retrieval. Finish MinerU parsing or confirm the PDFs are readable.${suffix}`,
      );
    case 'disabled':
      return l(
        `所选范围需要本地 RAG；请开启本地 RAG 后重试，或切回当前文献。${suffix}`,
        `The selected scope requires local RAG. Turn it on and retry, or switch back to the current paper.${suffix}`,
      );
    case 'missing-embedding-config':
      return l(
        `所选范围需要 Embedding 配置；请先在设置中配置嵌入模型，或切回当前文献。${suffix}`,
        `The selected scope requires an embedding configuration. Configure the embedding model first, or switch back to the current paper.${suffix}`,
      );
    case 'empty':
    default:
      return l(
        `所选范围没有检索到可用的正文证据。${suffix}`,
        `No usable evidence was found in the selected scope.${suffix}`,
      );
  }
}
