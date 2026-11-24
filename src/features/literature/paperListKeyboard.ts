/**
 * 文献列表键盘漫游（纯函数）。
 *
 * 列表可能虚拟化：只有窗口内的行挂载在 DOM 里，但方向键/Home/End 要在
 * 「当前已加载的 papers 全量」上移动，越界时停在首尾，不循环。
 */

export interface PaperListNavigationInput {
  /** 当前焦点行的全局索引；-1 表示焦点不在任何行上。 */
  currentIndex: number;
  /** 已加载的文献数量（不是分页总数）。 */
  total: number;
  /** 键盘事件的 key。 */
  key: string;
}

/**
 * 把方向键解析为目标行索引；返回 null 表示该键不归列表处理
 * （Enter/Space/Tab 等保持行内与浏览器原有行为）。
 */
export function resolvePaperListNavigation(input: PaperListNavigationInput): number | null {
  const total = Math.max(0, Math.floor(input.total));
  if (total === 0) return null;

  const rawIndex = Number.isFinite(input.currentIndex) ? Math.floor(input.currentIndex) : -1;
  const currentIndex = rawIndex < 0 ? -1 : Math.min(total - 1, rawIndex);

  switch (input.key) {
    case 'ArrowDown':
      return currentIndex < 0 ? 0 : Math.min(total - 1, currentIndex + 1);
    case 'ArrowUp':
      return currentIndex < 0 ? 0 : Math.max(0, currentIndex - 1);
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
}
