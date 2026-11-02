/**
 * 兼容 shim：菜单实现已合并到 `src/ui/menu.tsx`（见该文件头注释）。
 *
 * 保留原有导出名与 props 语义，3 个调用点（TabBar、BlockViewer、PdfViewer）零改动。
 * 后续可把这 3 处改为直接 `import { Menu, type MenuEntry } from '../ui/menu'`，
 * 然后删除本文件。
 */
export { Menu as ContextMenu } from '../ui/menu';
export type { MenuEntry as ContextMenuEntry, MenuItem as ContextMenuItem } from '../ui/menu';
