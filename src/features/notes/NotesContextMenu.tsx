import { hasActiveTextSelection, isEditableContextTarget } from './noteContextMenuTargets';

/**
 * 兼容 shim：菜单实现已合并到 `src/ui/menu.tsx`，文本选择判定已抽到
 * `./noteContextMenuTargets.ts`。
 *
 * 保留原有导出名与用法，4 个调用点（NoteBlockControls、NoteEditor、NotesSidebar、
 * NotesWorkspace）零改动。后续可改为直接 import 两处新模块，然后删除本文件。
 */
export { Menu as NotesContextMenu } from '../../ui/menu';
export type { MenuEntry as NotesContextMenuEntry, MenuItem as NotesContextMenuItem } from '../../ui/menu';
export { hasActiveTextSelection, isEditableContextTarget } from './noteContextMenuTargets';

/** 输入框、可编辑区或已有文本选区上右键时，交给浏览器原生菜单。 */
export function shouldUseNativeTextContextMenu(target: EventTarget | null) {
  return isEditableContextTarget(target) || hasActiveTextSelection(target);
}

export async function copyTextToClipboard(value: string) {
  const text = value.trim();
  if (!text) return;

  if (window.paperquay?.clipboard?.writeText) {
    window.paperquay.clipboard.writeText(text);
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}
