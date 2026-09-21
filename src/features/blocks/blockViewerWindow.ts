export const BLOCK_ITEM_GAP_PX = 4;
export const BLOCK_WINDOW_OVERSCAN = 8;
export const BLOCK_WINDOW_VIEWPORT_FALLBACK_PX = 900;

const BASE_HEIGHTS: Record<string, number> = {
  title: 72,
  heading: 48,
  image: 280,
  table: 240,
  equation: 88,
  list: 96,
  caption: 44,
  code: 140,
  page_header: 36,
  page_footer: 36,
  page_number: 32,
  page_footnote: 40,
};

const VISUAL_BLOCK_TYPES = new Set(['image', 'table', 'equation']);

export function estimateBlockHeight(
  block: { type: string },
  options: {
    scale: number;
    compactMode: boolean;
    bilingual: boolean;
  },
): number {
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1;
  const compact = options.compactMode ? 0.86 : 1;
  const bilingual = options.bilingual && !VISUAL_BLOCK_TYPES.has(block.type) ? 1.65 : 1;
  const base = BASE_HEIGHTS[block.type] ?? 80;

  return Math.max(36, Math.round(base * scale * compact * bilingual));
}
