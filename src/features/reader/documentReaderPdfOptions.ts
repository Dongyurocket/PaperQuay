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
}): ReaderPdfOption[] {
  const {
    originalPdfPath,
    projectPdfFiles,
    currentLocalPdfPath,
    currentPdfVariantLabel,
  } = options;
  const pdfOptions: ReaderPdfOption[] = [];
  const appendOption = (path: string, label: string) => {
    if (!path.trim()) {
      return;
    }

    if (pdfOptions.some((option) => isSameLocalPath(option.path, path))) {
      return;
    }

    pdfOptions.push({ path, label });
  };

  if (originalPdfPath) {
    appendOption(originalPdfPath, `Original - ${getFileNameFromPath(originalPdfPath)}`);
  }

  projectPdfFiles.forEach((entry) => {
    const prefix = entry.role || (
      originalPdfPath && isSameLocalPath(entry.path, originalPdfPath) ? 'Original' : 'Project'
    );
    appendOption(entry.path, `${prefix} - ${entry.name}`);
  });

  if (currentLocalPdfPath) {
    appendOption(
      currentLocalPdfPath,
      `${currentPdfVariantLabel || 'Current'} - ${getFileNameFromPath(currentLocalPdfPath)}`,
    );
  }

  return pdfOptions;
}
