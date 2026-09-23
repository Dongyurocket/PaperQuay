/** 文献列表多选（P2-2）。全选保存的是当时的 id 快照，不是“以后凡是匹配都算”。 */

export type PaperSelectionMode = 'manual' | 'all';

export type PaperSelection = {
  ids: string[];
  /** all：这次全选冻住的匹配集合。manual：Ctrl/Shift 勾选，不代表当前筛选已全选。 */
  mode: PaperSelectionMode;
};

export type SelectionCheckState = 'none' | 'partial' | 'all';

export const EMPTY_PAPER_SELECTION: PaperSelection = { ids: [], mode: 'manual' };

export function selectionCount(selection: PaperSelection): number {
  return selection.ids.length;
}

export function selectionCheckState(selection: PaperSelection, total = 0): SelectionCheckState {
  if (selection.ids.length === 0) {
    return 'none';
  }

  if (selection.mode === 'all' || (total > 0 && selection.ids.length >= total)) {
    return 'all';
  }

  return 'partial';
}

export function togglePaperSelection(selection: PaperSelection, paperId: string): PaperSelection {
  const selected = selection.ids.includes(paperId);
  const ids = selected
    ? selection.ids.filter((id) => id !== paperId)
    : [...selection.ids, paperId];

  if (ids.length === 0) {
    return EMPTY_PAPER_SELECTION;
  }

  // 全选后再改任何一篇，就不再是“当前筛选全选”。
  return { ids, mode: 'manual' };
}

export function replacePaperSelection(ids: string[]): PaperSelection {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    return EMPTY_PAPER_SELECTION;
  }

  return { ids: uniqueIds, mode: 'manual' };
}

export function capturePaperSelection(ids: string[]): PaperSelection {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    return EMPTY_PAPER_SELECTION;
  }

  return { ids: uniqueIds, mode: 'all' };
}
