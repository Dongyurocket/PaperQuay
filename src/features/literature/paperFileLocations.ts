/**
 * 文献在磁盘上的各类数据位置（原始 PDF、译版 PDF、MinerU 结果）。
 *
 * 每类位置给出按优先级排列的候选路径，配合一次 `paths_exist` 批量检查取第一个存在者；
 * MinerU 目录存在三种历史命名，必须以存在性为准，不能直接取第一个候选。
 */
import type { LiteraturePaper } from '../../types/library.ts';
import type { WorkspaceItem } from '../../types/reader.ts';
import {
  ATTACHMENT_KIND_TRANSLATED_PDF,
  paperPdfPath,
  resolveAttachmentPdfPath,
} from '../../utils/libraryPaper.ts';
import {
  buildMineruCachePathCandidates,
  getMineruJsonPathCandidates,
  guessSiblingJsonPaths,
  guessSiblingMarkdownPath,
} from '../../utils/mineruCache.ts';
import { createNativeWorkspaceItemForPaper } from './literatureLibraryUtils.ts';

export type PaperFileLocationKind = 'pdf' | 'translated-pdf' | 'mineru-output';

export interface PaperFileLocationTarget {
  id: string;
  kind: PaperFileLocationKind;
  /** 译版 PDF 的语言（BCP 47），其余类型为 null。 */
  language: string | null;
  candidates: string[];
}

export interface ResolvedPaperFileLocation {
  id: string;
  kind: PaperFileLocationKind;
  language: string | null;
  /** 第一个存在的候选路径；均不存在时为 null。 */
  path: string | null;
}

export interface PaperFileLocationOptions {
  storageDir?: string | null;
  mineruCacheDir?: string | null;
  autoLoadSiblingJson?: boolean;
  /** Reader documents also include standalone PDFs with their own cache identity. */
  workspaceItem?: WorkspaceItem;
  mineruPath?: string;
}

/** 单篇文献最多列出的译版 PDF 数量，避免右键菜单过长。 */
export const MAX_TRANSLATED_PDF_LOCATIONS = 3;

function uniqueNonEmpty(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of paths) {
    const trimmed = value?.trim() ?? '';
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      output.push(trimmed);
    }
  }

  return output;
}

export function buildPaperFileLocationTargets(
  paper: LiteraturePaper,
  options: PaperFileLocationOptions = {},
): PaperFileLocationTarget[] {
  const storageDir = options.storageDir ?? null;
  const pdfPath = paperPdfPath(paper, { storageDir });
  const targets: PaperFileLocationTarget[] = [
    { id: 'pdf', kind: 'pdf', language: null, candidates: uniqueNonEmpty([pdfPath]) },
  ];

  const translatedAttachments = paper.attachments
    .filter((attachment) => attachment.kind === ATTACHMENT_KIND_TRANSLATED_PDF && !attachment.missing)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_TRANSLATED_PDF_LOCATIONS);

  for (const attachment of translatedAttachments) {
    targets.push({
      id: `translated-pdf:${attachment.id}`,
      kind: 'translated-pdf',
      language: attachment.language?.trim() || null,
      candidates: uniqueNonEmpty([resolveAttachmentPdfPath(attachment, { storageDir })]),
    });
  }

  const cacheRoot = options.mineruCacheDir?.trim() ?? '';
  const workspaceItem = options.workspaceItem ?? createNativeWorkspaceItemForPaper(paper, storageDir);
  const cacheCandidates = workspaceItem && cacheRoot
    ? buildMineruCachePathCandidates(cacheRoot, workspaceItem)
    : [];
  const siblingMarkdown = pdfPath && options.autoLoadSiblingJson
    ? guessSiblingMarkdownPath(pdfPath)
    : null;

  targets.push({
    id: 'mineru-output',
    kind: 'mineru-output',
    language: null,
    candidates: uniqueNonEmpty([
      ...cacheCandidates.map((cachePaths) => cachePaths.markdownPath),
      siblingMarkdown,
      options.mineruPath,
      ...cacheCandidates.flatMap(getMineruJsonPathCandidates),
      ...(pdfPath && options.autoLoadSiblingJson ? guessSiblingJsonPaths(pdfPath) : []),
    ]),
  });

  return targets;
}

/** 把所有候选路径摊平成一次 `paths_exist` 调用的输入。 */
export function flattenPaperFileLocationCandidates(targets: PaperFileLocationTarget[]): string[] {
  return targets.flatMap((target) => target.candidates);
}

/** 按 `flattenPaperFileLocationCandidates` 的顺序回填存在性，取每类第一个存在的路径。 */
export function resolvePaperFileLocations(
  targets: PaperFileLocationTarget[],
  existFlags: boolean[],
): ResolvedPaperFileLocation[] {
  let offset = 0;

  return targets.map((target) => {
    const flags = existFlags.slice(offset, offset + target.candidates.length);
    offset += target.candidates.length;
    const index = flags.findIndex(Boolean);

    return {
      id: target.id,
      kind: target.kind,
      language: target.language,
      path: index >= 0 ? target.candidates[index] : null,
    };
  });
}

export async function resolvePaperFileLocationsOnDisk(
  paper: LiteraturePaper,
  options: PaperFileLocationOptions,
  pathsExist: (paths: string[]) => Promise<boolean[]>,
): Promise<ResolvedPaperFileLocation[]> {
  const targets = buildPaperFileLocationTargets(paper, options);
  const candidates = flattenPaperFileLocationCandidates(targets);
  const flags = candidates.length > 0 ? await pathsExist(candidates) : [];
  return resolvePaperFileLocations(targets, flags);
}
