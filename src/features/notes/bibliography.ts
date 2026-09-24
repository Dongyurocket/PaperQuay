// 学术化参考文献格式化（痛点 7 / docs/notes-charter.md 的引用规范）。
// 支持 GB/T 7714-2015 顺序编码制（默认，中文写作场景）、APA 7 与 IEEE。
//
// 实现已收敛到共享真源 `src/shared/citation/*`（Word 加载项与本地桥复用同一套格式化），
// 本文件只保留「笔记侧」的面板设置（localStorage 样式偏好）并对旧 API 做兼容再导出。
import type { LiteraturePaper } from '../../types/library';
import {
  CITATION_STYLES,
  formatBibliographyEntry as formatBibliographyEntryShared,
  formatInlineApaCitation as formatInlineApaCitationShared,
  normalizeCitationStyle,
  type CitationPaperLike,
  type CitationStyleId,
} from '../../shared/citation/index.ts';

export type NoteCitationStyle = 'gbt7714' | 'apa7' | 'ieee';

export const NOTE_CITATION_STYLE_STORAGE_KEY = 'paperquay:note-citation-style:v1';

export const NOTE_CITATION_STYLE_OPTIONS: Array<{ id: NoteCitationStyle; label: string }> = [
  { id: 'gbt7714', label: 'GB/T 7714' },
  { id: 'apa7', label: 'APA 7' },
  { id: 'ieee', label: 'IEEE' },
];

export function normalizeNoteCitationStyle(value: unknown): NoteCitationStyle {
  const normalized = normalizeCitationStyle(value);
  return normalized === 'apa7' || normalized === 'ieee' ? normalized : 'gbt7714';
}

export function loadNoteCitationStyle(): NoteCitationStyle {
  try {
    if (typeof window === 'undefined') return 'gbt7714';
    return normalizeNoteCitationStyle(window.localStorage.getItem(NOTE_CITATION_STYLE_STORAGE_KEY));
  } catch {
    return 'gbt7714';
  }
}

export function saveNoteCitationStyle(style: NoteCitationStyle): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NOTE_CITATION_STYLE_STORAGE_KEY, normalizeNoteCitationStyle(style));
  } catch {
    // 本地设置写入失败不阻断编辑。
  }
}

/** 参考文献列表条目（笔记侧入口，实现见共享真源）。 */
export function formatBibliographyEntry(
  paper: LiteraturePaper | CitationPaperLike | undefined,
  fallbackLabel: string,
  style: NoteCitationStyle,
): string {
  return formatBibliographyEntryShared(paper, fallbackLabel, style as CitationStyleId);
}

/** 内联 APA 引用文本（笔记 decoration 入口，实现见共享真源）。 */
export function formatInlineApaCitation(
  paper: LiteraturePaper | CitationPaperLike | undefined,
  fallbackLabel: string,
): string {
  return formatInlineApaCitationShared(paper, fallbackLabel);
}

export { CITATION_STYLES };
