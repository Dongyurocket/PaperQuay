import type {
  PaperAnnotation,
  PdfHighlightTarget,
  PdfScrollPosition,
  PositionedMineruBlock,
} from '../../types/reader';
import { buildSiblingPath } from '../../utils/mineruCache.ts';
import type { PageSize } from '../../utils/bbox';
import { getFileNameFromPath } from '../../utils/text.ts';
import { resolveVirtualWindow, type VirtualWindow } from '../../utils/virtualWindow.ts';

export const MAX_EAGER_THUMBNAILS = 36;
export const THUMBNAIL_NEIGHBOR_RADIUS = 4;
export const THUMBNAIL_ITEM_HEIGHT_PX = 188;
export const THUMBNAIL_ITEM_GAP_PX = 10;
export const THUMBNAIL_ITEM_STRIDE_PX = THUMBNAIL_ITEM_HEIGHT_PX + THUMBNAIL_ITEM_GAP_PX;
export const THUMBNAIL_WINDOW_OVERSCAN = 8;

export type PdfAnnotationColorPresetId = 'yellow' | 'green' | 'blue' | 'pink' | 'red';
type Localize = (zh: string, en: string) => string;

export function getPercentProgress(completed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (completed / total) * 100));
}

export function getPdfAnnotationColorLabel(
  presetId: PdfAnnotationColorPresetId,
  l: Localize,
): string {
  switch (presetId) {
    case 'yellow':
      return l('黄色', 'Yellow');
    case 'green':
      return l('绿色', 'Green');
    case 'blue':
      return l('蓝色', 'Blue');
    case 'pink':
      return l('粉色', 'Pink');
    case 'red':
      return l('红色', 'Red');
  }
}

export function resolveBBoxBaseSize(
  source: Pick<
    PositionedMineruBlock | PdfHighlightTarget | PaperAnnotation,
    'bboxCoordinateSystem' | 'bboxPageSize'
  > | null,
  originalPage: PageSize,
): PageSize {
  if (source?.bboxCoordinateSystem === 'normalized-1000') {
    return { width: 1000, height: 1000 };
  }

  if (source?.bboxPageSize) {
    return {
      width: source.bboxPageSize[0],
      height: source.bboxPageSize[1],
    };
  }

  return originalPage;
}

export function buildAnnotatedFileName(fileName: string): string {
  const trimmedName = fileName.trim() || 'document.pdf';
  const lowerName = trimmedName.toLowerCase();

  if (lowerName.endsWith('.annotated.pdf')) {
    return trimmedName;
  }

  if (!lowerName.endsWith('.pdf')) {
    return `${trimmedName}.annotated.pdf`;
  }

  return `${trimmedName.slice(0, -4)}.annotated.pdf`;
}

export function buildAnnotatedSiblingPath(path: string): string {
  return buildSiblingPath(path, buildAnnotatedFileName(getFileNameFromPath(path) || 'document.pdf'));
}

export function loadStoredBoolean(key: string, fallback = false): boolean {
  try {
    const rawValue = localStorage.getItem(key);

    return rawValue === null ? fallback : rawValue === 'true';
  } catch {
    return fallback;
  }
}

export function resolveThumbnailWindow(
  pageCount: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = THUMBNAIL_WINDOW_OVERSCAN,
): VirtualWindow {
  return resolveVirtualWindow({
    itemCount: Math.max(0, pageCount),
    getItemSize: () => THUMBNAIL_ITEM_STRIDE_PX,
    scrollOffset: scrollTop,
    viewportSize: viewportHeight,
    overscan,
  });
}

export function buildThumbnailPageIndexes(pageCount: number, currentPage: number): number[] {
  const indexes = new Set<number>();
  const leadingCount = Math.min(pageCount, 12);

  for (let pageIndex = 0; pageIndex < leadingCount; pageIndex += 1) {
    indexes.add(pageIndex);
  }

  const currentPageIndex = Math.max(0, currentPage - 1);
  const start = Math.max(0, currentPageIndex - THUMBNAIL_NEIGHBOR_RADIUS);
  const end = Math.min(pageCount - 1, currentPageIndex + THUMBNAIL_NEIGHBOR_RADIUS);

  for (let pageIndex = start; pageIndex <= end; pageIndex += 1) {
    indexes.add(pageIndex);
  }

  return Array.from(indexes)
    .sort((left, right) => left - right)
    .slice(0, MAX_EAGER_THUMBNAILS);
}

export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export function isPdfDocumentUsable(pdfDocument: unknown): boolean {
  const maybeDocument = pdfDocument as {
    _transport?: {
      destroyed?: boolean;
      messageHandler?: unknown;
    };
  } | null | undefined;
  const transport = maybeDocument?._transport;

  return Boolean(transport && !transport.destroyed && transport.messageHandler);
}

export function detachPdfViewerDocument(pdfViewer: unknown, linkService?: unknown): void {
  const maybeViewer = pdfViewer as {
    setDocument?: (document: null) => unknown;
    cleanup?: () => unknown;
  } | null | undefined;
  const maybeLinkService = linkService as {
    setDocument?: (document: null, baseUrl?: null) => unknown;
  } | null | undefined;

  try {
    maybeViewer?.setDocument?.(null);
  } catch {
    // Best-effort PDF.js viewer detachment before document teardown.
  }

  try {
    maybeLinkService?.setDocument?.(null, null);
  } catch {
    // Best-effort PDF.js link service detachment.
  }

  try {
    maybeViewer?.cleanup?.();
  } catch {
    // Best-effort PDF.js viewer cleanup.
  }
}

type CatchableLifecycleResult = {
  catch?: (onRejected: () => undefined) => unknown;
};

function suppressLifecyclePromise(result: unknown): void {
  if (
    result &&
    typeof result === 'object' &&
    'catch' in result &&
    typeof (result as CatchableLifecycleResult).catch === 'function'
  ) {
    void (result as CatchableLifecycleResult).catch?.(() => undefined);
  }
}

export function releasePdfDocument(pdfDocument: unknown): void {
  const maybeDocument = pdfDocument as {
    cleanup?: () => unknown;
    destroy?: () => unknown;
  } | null | undefined;

  try {
    suppressLifecyclePromise(maybeDocument?.cleanup?.());
  } catch {
    // Best-effort PDF.js memory release.
  }

  try {
    suppressLifecyclePromise(maybeDocument?.destroy?.());
  } catch {
    // Best-effort PDF.js memory release.
  }
}

export function releasePdfDocumentSoon(pdfDocument: unknown): void {
  if (!pdfDocument) {
    return;
  }

  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    window.setTimeout(() => releasePdfDocument(pdfDocument), 0);
    return;
  }

  releasePdfDocument(pdfDocument);
}

export function releasePdfLoadingTask(loadingTask: unknown): void {
  const maybeLoadingTask = loadingTask as {
    destroy?: () => unknown;
  } | null | undefined;

  try {
    suppressLifecyclePromise(maybeLoadingTask?.destroy?.());
  } catch {
    // Best-effort PDF.js loading task release.
  }
}

export function isPdfLifecycleCancellation(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');

  return (
    name === 'RenderingCancelledException' ||
    /cancel|destroy|transport|sendWithPromise/i.test(message)
  );
}

export function suppressPdfLifecycleRejection(event: PromiseRejectionEvent): void {
  if (isPdfLifecycleCancellation(event.reason)) {
    event.preventDefault();
  }
}

export function buildScrollRestoreKey(position: PdfScrollPosition): string {
  return [
    position.sourceKey,
    Math.round(position.top),
    Math.round(position.left),
    position.page,
    Math.round(position.pageOffsetTop),
    Math.round((position.pageOffsetRatio ?? -1) * 100000),
    Math.round(position.pageHeight ?? 0),
  ].join(':');
}

export function clampScrollRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
