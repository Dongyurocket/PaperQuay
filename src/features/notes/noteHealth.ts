import type { Note } from '../../types/notes';
import { UNTITLED_NOTE_TITLE } from './notesText.ts';

// 与 src/stores/useNotesStore.ts 的 GLOBAL_NOTES_PAPER_ID 同值；内联以避免本文件被
// node --test 直接导入时拉起整个 zustand store 依赖链。
const GLOBAL_NOTES_PAPER_ID = 'global-notes';

export const NOTE_STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export type NoteHealthCategory = 'orphan' | 'broken-link' | 'untitled' | 'untagged' | 'stale';
export type NoteHealthLocale = 'zh-CN' | 'en-US';

export interface NoteHealthReport {
  total: number;
  /** 无标签、无双链、无论文关联且未入文件夹的孤立笔记。 */
  orphanNoteIds: string[];
  /** linkedNoteIds 指向已不存在（或已删除）笔记。 */
  brokenLinkNoteIds: string[];
  /** 无标题。 */
  untitledNoteIds: string[];
  /** 无标签。 */
  untaggedNoteIds: string[];
  /** 超过 30 天未更新。 */
  staleNoteIds: string[];
}

const emptyReport = (): NoteHealthReport => ({
  total: 0,
  orphanNoteIds: [],
  brokenLinkNoteIds: [],
  untitledNoteIds: [],
  untaggedNoteIds: [],
  staleNoteIds: [],
});

/** 笔记体检（方案 P2-2）：从笔记列表计算健康问题分类，纯函数、可测试。 */
export function buildNoteHealthReport(
  notes: Note[],
  options?: { now?: number },
): NoteHealthReport {
  const report = emptyReport();
  const now = options?.now ?? Date.now();
  const existingIds = new Set(notes.map((note) => note.id));
  report.total = notes.length;

  for (const note of notes) {
    const title = (note.title ?? '').trim();
    // 空标题是本批之后的入库形态；两个哨兵兼容旧数据与旧 MCP 写入。
    if (!title || title === UNTITLED_NOTE_TITLE || title === 'Untitled Note') {
      report.untitledNoteIds.push(note.id);
    }
    if ((note.tags ?? []).length === 0) report.untaggedNoteIds.push(note.id);
    if (now - (note.updatedAt ?? 0) > NOTE_STALE_THRESHOLD_MS) report.staleNoteIds.push(note.id);
    if ((note.linkedNoteIds ?? []).some((id) => !existingIds.has(id))) {
      report.brokenLinkNoteIds.push(note.id);
    }
    const hasLinks = (note.linkedNoteIds ?? []).length > 0 || (note.linkedPaperIds ?? []).length > 0;
    const hasPaper = Boolean(note.paperId && note.paperId !== GLOBAL_NOTES_PAPER_ID) || (note.linkedPaperIds ?? []).length > 0;
    const hasFolder = Boolean(note.folderId);
    const hasTags = (note.tags ?? []).length > 0;
    if (!hasLinks && !hasPaper && !hasFolder && !hasTags) {
      report.orphanNoteIds.push(note.id);
    }
  }

  return report;
}

interface NoteHealthBadgeText {
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
}

const HEALTH_BADGE_TEXT: Record<NoteHealthCategory, NoteHealthBadgeText> = {
  orphan: {
    zh: '孤立',
    en: 'Orphaned',
    descriptionZh: '没有标签、双链、论文关联或文件夹的孤立笔记',
    descriptionEn: 'Notes with no tags, links, paper or folder',
  },
  'broken-link': {
    zh: '断链',
    en: 'Broken links',
    descriptionZh: '双链指向已不存在的笔记',
    descriptionEn: 'Links that point to notes which no longer exist',
  },
  untitled: {
    zh: '无标题',
    en: 'Untitled',
    descriptionZh: '缺少标题或仍使用默认标题的笔记',
    descriptionEn: 'Notes with no title or only the default title',
  },
  untagged: {
    zh: '无标签',
    en: 'Untagged',
    descriptionZh: '还没有任何标签的笔记',
    descriptionEn: 'Notes without any tags',
  },
  stale: {
    zh: '陈旧',
    en: 'Stale',
    descriptionZh: '超过 30 天未更新的笔记',
    descriptionEn: 'Notes not updated for over 30 days',
  },
};

export interface NoteHealthBadge {
  category: NoteHealthCategory;
  /** 按 locale 选好的展示文案。 */
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  count: number;
}

/** 汇总为 badge 展示数据（保持固定顺序），标签与描述随 locale 切换。 */
export function noteHealthBadges(
  report: NoteHealthReport,
  locale: NoteHealthLocale = 'zh-CN',
): NoteHealthBadge[] {
  const order: NoteHealthCategory[] = ['orphan', 'broken-link', 'untitled', 'untagged', 'stale'];

  return order.map((category) => {
    const text = HEALTH_BADGE_TEXT[category];
    return {
      category,
      label: locale === 'en-US' ? text.en : text.zh,
      labelEn: text.en,
      description: locale === 'en-US' ? text.descriptionEn : text.descriptionZh,
      descriptionEn: text.descriptionEn,
      count: noteHealthCategoryIds(report, category).length,
    };
  });
}

export function noteHealthCategoryIds(report: NoteHealthReport, category: NoteHealthCategory): string[] {
  switch (category) {
    case 'orphan': return report.orphanNoteIds;
    case 'broken-link': return report.brokenLinkNoteIds;
    case 'untitled': return report.untitledNoteIds;
    case 'untagged': return report.untaggedNoteIds;
    case 'stale': return report.staleNoteIds;
  }
}
