import type {
  PdfSource,
  PositionedMineruBlock,
  ReaderSettings,
  WorkspaceItem,
} from '../../types/reader.ts';
import {
  buildMineruCachePathCandidates,
  guessSiblingMarkdownPath,
} from '../../utils/mineruCache.ts';
import { getPdfSourceSignature } from '../pdf/pdfDocumentSource.ts';
import { extractTextFromMineruBlock } from '../../services/mineru.ts';

type ReadLocalTextFileIfExists = (path: string) => Promise<string | null>;
type BuildMineruMarkdownDocument = (
  blocks: PositionedMineruBlock[],
  mineruPath?: string,
) => string;
type Localize = (zh: string, en: string) => string;

function summaryKeyTextSignature(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * 由 MinerU 结构块内容计算稳定签名，作为概览缓存 key 的内容因子。
 * 不依赖 mineruPath 等易漂移的路径信息：同一份解析内容在任何入口/任何缓存位置都得到同一签名。
 */
export function computeMineruBlocksContentSignature(blocks: PositionedMineruBlock[]): string {
  if (blocks.length === 0) {
    return '';
  }

  const combined = blocks
    .map((block) => extractTextFromMineruBlock(block))
    .join('\n');

  return `blocks:${blocks.length}:${summaryKeyTextSignature(combined)}`;
}

/**
 * 统一的概览缓存 sourceKey 算法（阅读器与文库预览共用）。
 * 结构：`${itemKey}::${promptVersion}::${language}::${sourceMode}::${contentSignature}`。
 * 历史版本曾使用 workspaceId 前缀或 mineruPath/文件名字段，见 buildLegacyPaperSummarySourceKeys。
 */
export function buildPaperSummarySourceKey({
  item,
  promptVersion,
  summaryLanguage,
  summarySourceMode,
  pdfSignature,
  mineruContentSignature,
}: {
  item: WorkspaceItem | null | undefined;
  promptVersion: string;
  summaryLanguage: string;
  summarySourceMode: ReaderSettings['summarySourceMode'];
  pdfSignature?: string;
  mineruContentSignature?: string;
}): string {
  if (!item) {
    return '';
  }

  const prefix = item.itemKey?.trim() || item.workspaceId?.trim();

  if (!prefix) {
    return '';
  }

  if (summarySourceMode === 'pdf-text') {
    const signature = pdfSignature?.trim();
    return signature
      ? `${prefix}::${promptVersion}::${summaryLanguage}::pdf-text::${signature}`
      : '';
  }

  const signature = mineruContentSignature?.trim();
  return signature
    ? `${prefix}::${promptVersion}::${summaryLanguage}::mineru-markdown::${signature}`
    : '';
}

/**
 * 生成历史版本的 sourceKey 候选，用于读取期兼容迁移。
 * 覆盖两套旧算法：阅读器版（itemKey + mineruPath/jsonName + blockCount）与
 * 文库预览版（workspaceId + markdown 候选路径/blocks 后缀）。
 */
export function buildLegacyPaperSummarySourceKeys({
  item,
  promptVersion,
  summaryLanguage,
  summarySourceMode,
  pdfSource,
  pdfPath,
  currentPdfName,
  mineruPath,
  currentJsonName,
  blockCount,
  mineruMarkdownCandidatePaths = [],
  legacyPdfByteLength,
}: {
  item: WorkspaceItem | null | undefined;
  promptVersion: string;
  summaryLanguage: string;
  summarySourceMode: ReaderSettings['summarySourceMode'];
  pdfSource?: PdfSource;
  pdfPath?: string;
  currentPdfName?: string;
  mineruPath?: string;
  currentJsonName?: string;
  blockCount: number;
  mineruMarkdownCandidatePaths?: string[];
  /** 旧预览版 pdf-text key 包含 PDF 字节长度后缀，仅预览侧可重建。 */
  legacyPdfByteLength?: number | null;
}): string[] {
  if (!item) {
    return [];
  }

  const keys = new Set<string>();
  const itemKey = item.itemKey?.trim();
  const workspaceId = item.workspaceId?.trim();

  if (summarySourceMode === 'pdf-text') {
    if (itemKey && pdfSource) {
      keys.add(
        `${itemKey}::${promptVersion}::${summaryLanguage}::pdf-text::${getPdfSourceSignature(pdfSource, pdfPath || currentPdfName || '')}`,
      );
    }

    if (workspaceId) {
      const legacyPreviewBase = `${workspaceId}::${promptVersion}::${summaryLanguage}::pdf-text::${pdfPath?.trim() || 'no-pdf'}`;

      if (typeof legacyPdfByteLength === 'number' && Number.isFinite(legacyPdfByteLength)) {
        keys.add(`${legacyPreviewBase}::${legacyPdfByteLength}`);
      } else {
        keys.add(legacyPreviewBase);
      }
    }

    return Array.from(keys);
  }

  if (blockCount <= 0) {
    return [];
  }

  if (itemKey) {
    keys.add(
      `${itemKey}::${promptVersion}::${summaryLanguage}::mineru-markdown::${mineruPath || currentJsonName || ''}::${blockCount}`,
    );
  }

  if (workspaceId) {
    for (const candidatePath of mineruMarkdownCandidatePaths) {
      if (candidatePath.trim()) {
        keys.add(
          `${workspaceId}::${promptVersion}::${summaryLanguage}::mineru-markdown::${candidatePath}::${blockCount}`,
        );
      }
    }

    keys.add(
      `${workspaceId}::${promptVersion}::${summaryLanguage}::mineru-markdown::blocks::${blockCount}`,
    );
  }

  return Array.from(keys);
}

export function resolveMineruMarkdownCandidatePaths({
  item,
  mineruCacheDir,
  mineruPath,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  mineruPath: string;
}): string[] {
  const candidatePaths = new Set<string>();

  if (mineruPath.trim() && !mineruPath.startsWith('cloud:')) {
    candidatePaths.add(guessSiblingMarkdownPath(mineruPath));
  }

  if (mineruCacheDir.trim()) {
    for (const cachePaths of buildMineruCachePathCandidates(mineruCacheDir.trim(), item)) {
      candidatePaths.add(cachePaths.markdownPath);
    }
  }

  return Array.from(candidatePaths);
}

export async function loadMineruMarkdownDocument({
  item,
  flatBlocks,
  mineruPath,
  mineruCacheDir,
  readText,
  buildFallbackMarkdown,
  l,
}: {
  item: WorkspaceItem;
  flatBlocks: PositionedMineruBlock[];
  mineruPath: string;
  mineruCacheDir: string;
  readText: ReadLocalTextFileIfExists;
  buildFallbackMarkdown: BuildMineruMarkdownDocument;
  l: Localize;
}): Promise<string> {
  const candidatePaths = resolveMineruMarkdownCandidatePaths({
    item,
    mineruCacheDir,
    mineruPath,
  });

  for (const candidatePath of candidatePaths) {
    try {
      const markdownText = await readText(candidatePath);
      if (!markdownText) continue;

      if (markdownText.trim()) {
        return markdownText;
      }
    } catch {
      continue;
    }
  }

  const fallbackMarkdown = buildFallbackMarkdown(flatBlocks, mineruPath);

  if (fallbackMarkdown.trim()) {
    return fallbackMarkdown;
  }

  throw new Error(
    l(
      '请先加载 MinerU 的 full.md，再使用 MinerU Markdown 作为概览来源。',
      'Load MinerU full.md before using MinerU Markdown as the overview source.',
    ),
  );
}
