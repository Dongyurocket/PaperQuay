/**
 * 笔记区右键菜单的目标判定。
 *
 * 从 `NotesContextMenu.tsx` 抽出：菜单组件本体已合并到 `src/ui/menu.tsx`，这两个函数
 * 与菜单渲染无关，只回答「这次右键该不该交回浏览器原生菜单」（在输入框、可编辑区或
 * 已有文本选区上右键时不应弹出应用菜单）。原模块继续 re-export，调用点不改。
 */

export function isEditableContextTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest('input, textarea, [contenteditable="true"], .ProseMirror'));
}

export function hasActiveTextSelection(target: EventTarget | null) {
  if (typeof window === 'undefined' || !(target instanceof Node)) return false;

  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;

  const targetElement =
    target instanceof HTMLElement ? target : target.parentElement;

  if (!targetElement) return true;

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const commonNode = range.commonAncestorContainer;
    const commonElement =
      commonNode instanceof HTMLElement ? commonNode : commonNode.parentElement;

    if (commonElement && (targetElement.contains(commonElement) || commonElement.contains(targetElement))) {
      return true;
    }

    try {
      if (range.intersectsNode(targetElement)) return true;
    } catch {
      return true;
    }
  }

  return false;
}
