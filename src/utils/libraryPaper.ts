import type {
  LiteratureAttachment,
  LiteraturePaper,
} from '../types/library';

/** 翻译版 PDF 附件的 kind 值（retainpdf 输出，页码与原版一一对应） */
export const ATTACHMENT_KIND_TRANSLATED_PDF = 'translated-pdf';

export interface ResolvedPaperPdfAttachment {
  attachment: LiteratureAttachment;
  path: string;
}

export interface ResolvePaperPdfAttachmentOptions {
  storageDir?: string | null;
}

function cleanPath(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function joinStorageRelativePath(storageDir: string, relativePath: string): string {
  const separator = storageDir.includes('\\') ? '\\' : '/';
  const normalizedStorageDir = storageDir.replace(/[\\/]+$/, '');
  const normalizedRelativePath = relativePath.replace(/^[\\/]+/, '');

  return normalizedStorageDir
    ? `${normalizedStorageDir}${separator}${normalizedRelativePath}`
    : normalizedRelativePath;
}

function resolveAttachmentPdfPath(
  attachment: LiteratureAttachment,
  options: ResolvePaperPdfAttachmentOptions = {},
): string {
  const storageDir = cleanPath(options.storageDir);
  const relativePath = cleanPath(attachment.relativePath);

  if (storageDir && relativePath) {
    return joinStorageRelativePath(storageDir, relativePath);
  }

  return cleanPath(attachment.storedPath) || cleanPath(attachment.originalPath);
}

export function resolvePaperPdfAttachment(
  paper: LiteraturePaper,
  options: ResolvePaperPdfAttachmentOptions = {},
): ResolvedPaperPdfAttachment | null {
  const pdfAttachments = paper.attachments.filter((attachment) => attachment.kind === 'pdf');

  for (const attachment of pdfAttachments) {
    if (attachment.missing) {
      continue;
    }

    const path = resolveAttachmentPdfPath(attachment, options);

    if (path) {
      return { attachment, path };
    }
  }

  for (const attachment of pdfAttachments) {
    const path = resolveAttachmentPdfPath(attachment, options);

    if (path) {
      return { attachment, path };
    }
  }

  return null;
}

export function paperPdfPath(
  paper: LiteraturePaper,
  options: ResolvePaperPdfAttachmentOptions = {},
): string | null {
  return resolvePaperPdfAttachment(paper, options)?.path ?? null;
}

/**
 * 解析文献的翻译版 PDF 附件（kind === 'translated-pdf'）。
 * 同一篇文献只保留一份翻译版 PDF；如出现多份，取最新创建且未缺失的一份。
 */
export function resolvePaperTranslatedPdfAttachment(
  paper: LiteraturePaper,
  options: ResolvePaperPdfAttachmentOptions = {},
): ResolvedPaperPdfAttachment | null {
  const candidates = paper.attachments
    .filter((attachment) => attachment.kind === ATTACHMENT_KIND_TRANSLATED_PDF && !attachment.missing)
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const attachment of candidates) {
    const path = resolveAttachmentPdfPath(attachment, options);

    if (path) {
      return { attachment, path };
    }
  }

  return null;
}

export function paperTranslatedPdfPath(
  paper: LiteraturePaper,
  options: ResolvePaperPdfAttachmentOptions = {},
): string | null {
  return resolvePaperTranslatedPdfAttachment(paper, options)?.path ?? null;
}
