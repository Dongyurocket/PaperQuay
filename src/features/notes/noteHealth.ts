import type { Note } from '../../types/notes';

// 与 src/stores/useNotesStore.ts 的 GLOBAL_NOTES_PAPER_ID 同值；内联以避免本文件被
// node --test 直接导入时拉起整个 zustand store 依赖链。
const GLOBAL_NOTES_PAPER_ID = 'global-notes';

export const NOTE_STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export type NoteHealthCategory = 'orphan' | 'broken-link' | 'untitled' | 'untagged' | 'stale';

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
    if (!title || title === '未命名笔记') report.untitledNoteIds.push(note.id);
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

/** 汇总为 badge 展示数据（保持固定顺序）。 */
export function noteHealthBadges(report: NoteHealthReport): Array<{
  category: NoteHealthCategory;
  label: string;
  count: number;
}> {
  return [
    { category: 'orphan', label: '孤立', count: report.orphanNoteIds.length },
    { category: 'broken-link', label: '断链', count: report.brokenLinkNoteIds.length },
    { category: 'untitled', label: '无标题', count: report.untitledNoteIds.length },
    { category: 'untagged', label: '无标签', count: report.untaggedNoteIds.length },
    { category: 'stale', label: '陈旧', count: report.staleNoteIds.length },
  ];
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
