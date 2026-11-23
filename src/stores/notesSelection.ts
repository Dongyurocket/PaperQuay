/**
 * 笔记选择/外部更新的纯逻辑，便于单元测试。
 */

/**
 * 搜索/标签过滤只改变列表内容，不改变当前编辑器绑定：
 * 已选中的笔记即使不在过滤结果里也保持打开；只有尚未选择时才回退到第一条。
 */
export function resolveNextActiveNoteId(
  activeNoteId: string | null,
  notes: Array<{ id: string }>,
): string | null {
  return activeNoteId ?? notes[0]?.id ?? null;
}

/**
 * 外部写入只在目标笔记版本真的变化时通知编辑器。
 * 旧实现把所有打开的标签一律标记为「外部更新」，会产生假冲突横幅。
 */
export function shouldNotifyExternalNoteChange(
  previous: { updatedAt: number } | null | undefined,
  next: { updatedAt: number },
): boolean {
  // 没有基线版本时（笔记被当前搜索/标签过滤掉、或不在 1000 条窗口内）
  // 无法判断是否真的变化；宁可等用户打开时读取最新内容，也不要误报冲突。
  if (!previous) return false;
  return previous.updatedAt !== next.updatedAt;
}
