import type { PdfSource, WorkspaceItem } from '../../types/reader';
import { buildPathInDirectory, normalizePathForCompare } from '../../utils/path.ts';

export function sanitizeFilename(filename: string): string {
  const sanitized = filename
    // eslint-disable-next-line no-control-regex -- 需要匹配并剔除不可见控制字符，保持原有字节级语义
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || 'document.pdf';
}

export function ensurePdfExtension(filename: string): string {
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
}

export function joinLocalPath(directory: string, filename: string): string {
  return buildPathInDirectory(directory, filename);
}

export function buildRemotePdfDownloadPath(
  directory: string,
  item: WorkspaceItem,
  source?: Exclude<PdfSource, null>,
) {
  const rawName =
    (source?.kind === 'remote-url' ? source.fileName : '') ||
    item.attachmentFilename ||
    item.attachmentTitle ||
    item.title ||
    item.itemKey;
  const filename = ensurePdfExtension(sanitizeFilename(rawName));
  const prefix = sanitizeFilename(item.itemKey || item.workspaceId);

  return joinLocalPath(directory, `${prefix}-${filename}`);
}

export function isSameLocalPath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

export function appendUniqueLocalPath(targets: string[], nextPath: string): void {
  if (!nextPath.trim()) {
    return;
  }

  if (targets.some((candidate) => isSameLocalPath(candidate, nextPath))) {
    return;
  }

  targets.push(nextPath);
}
