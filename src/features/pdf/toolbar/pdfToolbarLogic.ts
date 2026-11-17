export type PdfZoomPreset = 'page-width' | 'page-fit' | '100%';

export interface PdfToolbarOverflowItem {
  id: string;
  /** Estimated width in pixels, including the item's own gap. */
  width: number;
  /** Larger values keep an item visible for longer. */
  priority: number;
}

export interface PdfToolbarOverflowAllocation {
  visible: string[];
  overflow: string[];
}

/**
 * Keep the highest-priority toolbar items visible and move the least important
 * items into the overflow menu when the toolbar's own container is narrow.
 */
export function allocatePdfToolbarOverflow(
  items: readonly PdfToolbarOverflowItem[],
  containerWidth: number,
  overflowButtonWidth = 40,
): PdfToolbarOverflowAllocation {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return {
      visible: items.map((item) => item.id),
      overflow: [],
    };
  }

  const visible = [...items];
  const hidden = new Set<string>();
  const totalWidth = () => visible.reduce((sum, item) => sum + Math.max(0, item.width), 0);

  while (visible.length > 1 && totalWidth() + overflowButtonWidth > containerWidth) {
    let removeIndex = -1;

    for (let index = 0; index < visible.length; index += 1) {
      const candidate = visible[index];
      const current = removeIndex >= 0 ? visible[removeIndex] : undefined;

      if (!current || candidate.priority < current.priority ||
        (candidate.priority === current.priority && index > removeIndex)) {
        removeIndex = index;
      }
    }

    if (removeIndex < 0) {
      break;
    }

    hidden.add(visible[removeIndex].id);
    visible.splice(removeIndex, 1);
  }

  return {
    visible: items.filter((item) => !hidden.has(item.id)).map((item) => item.id),
    overflow: items.filter((item) => hidden.has(item.id)).map((item) => item.id),
  };
}

export function clampPdfPageNumber(page: number, pageCount: number): number {
  const normalizedPageCount = Math.max(0, Math.trunc(pageCount));
  const upperBound = normalizedPageCount > 0 ? normalizedPageCount : 1;
  return Math.min(upperBound, Math.max(1, Math.trunc(page) || 1));
}

export function parseAndClampPdfPageInput(
  input: string,
  pageCount: number,
  fallbackPage: number,
): number {
  const parsed = Number.parseInt(input.trim(), 10);
  return Number.isFinite(parsed)
    ? clampPdfPageNumber(parsed, pageCount)
    : clampPdfPageNumber(fallbackPage, pageCount);
}

export function getPdfZoomPresetValue(preset: PdfZoomPreset): string {
  switch (preset) {
    case 'page-width':
      return 'page-width';
    case 'page-fit':
      return 'page-fit';
    case '100%':
      return '1';
  }
}

