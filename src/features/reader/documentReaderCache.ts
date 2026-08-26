import type { MineruPage, PaperSummary, PdfSource, WorkspaceItem } from '../../types/reader.ts';
import {
  buildMineruCachePathCandidates,
  buildMineruSummaryCachePathCandidates,
  getMineruJsonPathCandidates,
} from '../../utils/mineruCache.ts';
import { isMineruCacheManifest } from './documentReaderManifest.ts';
type Localize = (zh: string, en: string) => string;

type ReadLocalTextFileIfExists = (path: string) => Promise<string | null>;
type LoadPdfBinary = (source: PdfSource) => Promise<Uint8Array | null>;
type ParseMineruPages = (payload: string | unknown) => MineruPage[];
type ParseMineruMarkdownPages = (markdownText: string) => MineruPage[];
type SummaryCacheEnvelope = {
  sourceKey: string;
  summary: PaperSummary;
};

export interface SavedSummaryCacheResult {
  summary: PaperSummary;
  matchedSourceKey: string;
}

export interface SavedMineruPagesResult {
  pages: MineruPage[];
  path: string;
  message: string;
}

export function isMatchingSummaryCacheEnvelope(
  value: unknown,
  sourceKey: string,
): value is SummaryCacheEnvelope {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<SummaryCacheEnvelope>).sourceKey === sourceKey &&
      (value as Partial<SummaryCacheEnvelope>).summary,
  );
}

export async function loadSavedSummaryCache({
  item,
  mineruCacheDir,
  sourceKey,
  legacySourceKeys = [],
  readText,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceKey: string;
  legacySourceKeys?: string[];
  readText: ReadLocalTextFileIfExists;
}): Promise<SavedSummaryCacheResult | null> {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const sourceKeyCandidates = [sourceKey, ...legacySourceKeys]
    .map((key) => key.trim())
    .filter(Boolean);

  if (sourceKeyCandidates.length === 0) {
    return null;
  }

  const acceptedKeys = new Set(sourceKeyCandidates);
  const candidatePaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const key of sourceKeyCandidates) {
    for (const path of buildMineruSummaryCachePathCandidates(mineruCacheDir.trim(), item, key)) {
      if (seenPaths.has(path)) {
        continue;
      }

      seenPaths.add(path);
      candidatePaths.push(path);
    }
  }

  for (const candidatePath of candidatePaths) {
    try {
      const raw = await readText(candidatePath);
      if (!raw) continue;

      const parsed = JSON.parse(raw) as Partial<SummaryCacheEnvelope>;
      const matchedSourceKey = typeof parsed?.sourceKey === 'string' ? parsed.sourceKey : '';

      if (!parsed || typeof parsed !== 'object' || !acceptedKeys.has(matchedSourceKey) || !parsed.summary) {
        continue;
      }

      return { summary: parsed.summary as PaperSummary, matchedSourceKey };
    } catch {
      continue;
    }
  }

  return null;
}

export async function loadSavedMineruPages({
  item,
  mineruCacheDir,
  l,
  readText,
  parsePages,
  parseMarkdownPages,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  l: Localize;
  readText: ReadLocalTextFileIfExists;
  parsePages: ParseMineruPages;
  parseMarkdownPages?: ParseMineruMarkdownPages;
}): Promise<SavedMineruPagesResult | null> {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const candidateCaches = buildMineruCachePathCandidates(mineruCacheDir.trim(), item);

  for (const cachePaths of candidateCaches) {
    for (const candidatePath of getMineruJsonPathCandidates(cachePaths)) {
      try {
        const jsonText = await readText(candidatePath);
        if (!jsonText) continue;

        return {
          pages: parsePages(jsonText),
          path: candidatePath,
          message: l(
            `已从本地缓存恢复《${item.title}》的解析结果`,
            `Restored the parsing result for "${item.title}" from the local cache`,
          ),
        };
      } catch {
        continue;
      }
    }
  }

  if (parseMarkdownPages) {
    for (const cachePaths of candidateCaches) {
      try {
        const markdownText = await readText(cachePaths.markdownPath);
        if (!markdownText?.trim()) continue;

        const pages = parseMarkdownPages(markdownText);

        if (pages.length === 0 || pages.every((page) => page.length === 0)) {
          continue;
        }

        return {
          pages,
          path: cachePaths.markdownPath,
          message: l(
            `已从本地 MinerU Markdown 恢复《${item.title}》的结构块`,
            `Restored structured blocks for "${item.title}" from local MinerU Markdown`,
          ),
        };
      } catch {
        continue;
      }
    }
  }

  return null;
}

export async function resolveSavedPdfPath({
  item,
  mineruCacheDir,
  readText,
  loadPdf,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  readText: ReadLocalTextFileIfExists;
  loadPdf: LoadPdfBinary;
}): Promise<string | null> {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const candidateCaches = buildMineruCachePathCandidates(mineruCacheDir.trim(), item);

  for (const cachePaths of candidateCaches) {
    try {
      const manifestText = await readText(cachePaths.manifestPath);
      if (!manifestText) continue;

      const parsed = JSON.parse(manifestText);

      if (!isMineruCacheManifest(parsed) || !parsed.pdfPath.trim()) {
        continue;
      }

      try {
        await loadPdf({ kind: 'local-path', path: parsed.pdfPath } satisfies PdfSource);
        return parsed.pdfPath;
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }

  return null;
}
