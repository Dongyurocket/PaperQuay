import type { LiteraturePaper } from '../../types/library';

export type PaperTitleDisplayMode = 'both' | 'zh' | 'original';

export const PAPER_TITLE_DISPLAY_STORAGE_KEY = 'paperquay-literature-title-display-v1';

export const PAPER_TITLE_DISPLAY_MODES: PaperTitleDisplayMode[] = ['both', 'zh', 'original'];

export function normalizePaperTitleDisplayMode(value: unknown): PaperTitleDisplayMode {
  return PAPER_TITLE_DISPLAY_MODES.includes(value as PaperTitleDisplayMode)
    ? (value as PaperTitleDisplayMode)
    : 'both';
}

export function loadPaperTitleDisplayMode(storage?: Pick<Storage, 'getItem'> | null): PaperTitleDisplayMode {
  try {
    return normalizePaperTitleDisplayMode(
      (storage ?? localStorage).getItem(PAPER_TITLE_DISPLAY_STORAGE_KEY),
    );
  } catch {
    return 'both';
  }
}

export function persistPaperTitleDisplayMode(
  mode: PaperTitleDisplayMode,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    (storage ?? localStorage).setItem(PAPER_TITLE_DISPLAY_STORAGE_KEY, mode);
  } catch {
    // 忽略持久化失败（如隐私模式），保持内存态即可
  }
}

export interface PaperTitleDisplay {
  /** 主标题（优先按模式显示；可能为空字符串表示无内容） */
  primary: string;
  /** 副标题（仅 both 模式且存在中文译名与原文不同的时候给出） */
  secondary: string;
}

/**
 * 解析文献标题的展示形态。
 * - both：有中文译名时中文为主、英文原名为副；无译名时只显示原标题。
 * - zh：优先中文译名，缺失时回退原标题。
 * - original：始终显示原标题。
 */
export function resolvePaperTitleDisplay(
  paper: Pick<LiteraturePaper, 'title' | 'titleZh'>,
  mode: PaperTitleDisplayMode,
): PaperTitleDisplay {
  const original = paper.title?.trim() ?? '';
  const translated = paper.titleZh?.trim() ?? '';

  if (mode === 'original') {
    return { primary: original, secondary: '' };
  }

  if (mode === 'zh') {
    return { primary: translated || original, secondary: '' };
  }

  if (translated && translated !== original) {
    return { primary: translated, secondary: original };
  }

  return { primary: original, secondary: '' };
}
