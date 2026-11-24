/**
 * 阅读器问答历史的生命周期判定。
 *
 * 历史恢复由 DocumentReaderTab 在挂载时写入 zustand slice（同步生效），
 * 父组件 Reader 的 effect 可能在同一提交里先于/晚于它执行。
 * 这些纯函数把「什么时候可以写初始会话」「恢复是否已落地」固定下来，
 * 避免再次出现：父组件用空会话覆盖刚恢复的历史，导致问答就绪标记永远对不上、
 * 提交的回答被静默丢弃。
 */

export interface ReaderQaTabSliceLike {
  workspaceId: string;
}

/** slice 尚未恢复历史（workspaceId 为空）时，不允许写入初始会话。 */
export function canSeedInitialQaSession(
  slice: ReaderQaTabSliceLike | undefined | null,
): boolean {
  return Boolean(slice?.workspaceId);
}

/** 恢复是否已在 store 落地：按 workspaceId 判断，不依赖会话数组引用。 */
export function isQaHistoryRestoreReady(
  slice: ReaderQaTabSliceLike | undefined | null,
  expectedWorkspaceId: string,
): boolean {
  return Boolean(slice && expectedWorkspaceId && slice.workspaceId === expectedWorkspaceId);
}
