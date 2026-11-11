import type { LocalDirectoryFileEntry } from '../../services/desktop';
import type { PdfSource, WorkspaceItem } from '../../types/reader';
import { buildMineruCachePaths } from '../../utils/mineruCache.ts';
import { getParentDirectory } from '../../utils/path.ts';
import { getFileNameFromPath } from '../../utils/text.ts';
import {
  buildRemotePdfDownloadPath,
  isSameLocalPath,
} from './documentReaderPdfPaths.ts';

export interface ReaderPdfOption {
  path: string;
  label: string;
  title: string;
}

export function resolvePdfCompareLeftSource(
  pdfCompareMode: boolean,
  originalPdfPath: string,
  activePdfSource: PdfSource,
): PdfSource {
  return pdfCompareMode && originalPdfPath.trim()
    ? { kind: 'local-path', path: originalPdfPath }
    : activePdfSource;
}

export function resolveOriginalPdfPath(
  document: WorkspaceItem,
  remotePdfDownloadDir: string,
): string {
  if (document.localPdfPath?.trim()) {
    return document.localPdfPath;
  }

  if (document.attachmentKey && remotePdfDownloadDir.trim()) {
    return buildRemotePdfDownloadPath(remotePdfDownloadDir, document);
  }

  return '';
}

export function resolveCurrentLocalPdfPath(
  pdfPath: string,
  pdfSource: PdfSource,
): string {
  return pdfPath || (pdfSource?.kind === 'local-path' ? pdfSource.path : '');
}

export function resolveCurrentPdfVariantLabel(options: {
  currentLocalPdfPath: string;
  originalPdfPath: string;
  pdfSource: PdfSource;
  localize: (zh: string, en: string) => string;
}): string {
  const { currentLocalPdfPath, originalPdfPath, pdfSource, localize } = options;

  if (!currentLocalPdfPath) {
    return pdfSource?.kind === 'remote-url' ? localize('远程 PDF', 'Remote PDF') : '';
  }

  if (originalPdfPath && isSameLocalPath(currentLocalPdfPath, originalPdfPath)) {
    return localize('原始 PDF', 'Original PDF');
  }

  return localize('批注版 PDF', 'Annotated PDF');
}

export function canSwitchToOriginalPdf(
  currentLocalPdfPath: string,
  originalPdfPath: string,
): boolean {
  return Boolean(
    originalPdfPath &&
      currentLocalPdfPath &&
      !isSameLocalPath(currentLocalPdfPath, originalPdfPath),
  );
}

export function resolveAnnotationSaveDirectory(options: {
  mineruCacheDir: string;
  document: WorkspaceItem;
  originalPdfPath: string;
  currentLocalPdfPath: string;
}): string {
  const { mineruCacheDir, document, originalPdfPath, currentLocalPdfPath } = options;

  if (mineruCacheDir.trim()) {
    return buildMineruCachePaths(mineruCacheDir.trim(), document).directory;
  }

  if (originalPdfPath) {
    return getParentDirectory(originalPdfPath);
  }

  if (currentLocalPdfPath) {
    return getParentDirectory(currentLocalPdfPath);
  }

  return '';
}

export function buildAvailablePdfOptions(options: {
  originalPdfPath: string;
  projectPdfFiles: Array<LocalDirectoryFileEntry & { role?: string }>;
  currentLocalPdfPath: string;
  currentPdfVariantLabel: string;
  localize: (zh: string, en: string) => string;
}): ReaderPdfOption[] {
  const {
    originalPdfPath,
    projectPdfFiles,
    currentLocalPdfPath,
    currentPdfVariantLabel,
    localize,
  } = options;
  const pdfOptions: ReaderPdfOption[] = [];
  const appendOption = (path: string, label: string, title = getFileNameFromPath(path)) => {
    if (!path.trim()) {
      return;
    }

    if (pdfOptions.some((option) => isSameLocalPath(option.path, path))) {
      return;
    }

    pdfOptions.push({ path, label, title });
  };

  if (originalPdfPath) {
    appendOption(originalPdfPath, localize('原版 PDF', 'Original PDF'));
  }

  projectPdfFiles.forEach((entry) => {
    const role = (entry.role || (
      originalPdfPath && isSameLocalPath(entry.path, originalPdfPath) ? 'Original' : 'Project'
    )).trim();
    const translatedMatch = role.match(/^Translated(?:\s*[·:]\s*(.*))?$/i);
    const translatedLanguage = translatedMatch?.[1]?.trim() ?? '';
    const label = translatedMatch
      ? translatedLanguage && !/^(?:und|unknown|undefined)$/i.test(translatedLanguage)
        ? localize(`译版 · ${translatedLanguage}`, `Translated · ${translatedLanguage}`)
        : localize('译版 · 语言待确认', 'Translated · language unconfirmed')
      : /^(?:original|original pdf)$/i.test(role)
        ? localize('原版 PDF', 'Original PDF')
        : /^(?:annotated|annotated pdf)$/i.test(role)
          ? localize('批注版 PDF', 'Annotated PDF')
          : localize('其他 PDF', 'Other PDF');
    appendOption(entry.path, label, entry.name || getFileNameFromPath(entry.path));
  });

  if (currentLocalPdfPath) {
    appendOption(
      currentLocalPdfPath,
      currentPdfVariantLabel || localize('当前 PDF', 'Current PDF'),
    );
  }

  return pdfOptions;
}
