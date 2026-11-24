import type { Editor } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import type { ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { cellAround, cellNear, tableEditingKey } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { Plus, Table2, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { NotesContextMenuEntry } from '../NotesContextMenu';

export const EditableTable = Table.extend({
  selectable: false,
});

export type TableCellPointer = {
  cell: HTMLTableCellElement;
  clientX: number;
  clientY: number;
};

export function iconNode(node: ReactNode) {
  return node;
}

function isTableCellEditClick(event: MouseEvent) {
  if (event.button !== 0) return false;

  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest('.column-resize-handle')) return false;
  if (target.closest('button, input, textarea, select, a, .pq-tiptap-token, [contenteditable="false"]')) return false;

  return Boolean(target.closest('td, th'));
}

function getClickedTableCell(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const cell = target.closest('td, th');
  return cell instanceof HTMLTableCellElement ? cell : null;
}

function getTableCellStartFromResolvedPosition($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return $pos.before(depth);
  }

  return null;
}

function getTableCellStartNearPosition(view: EditorView, position: number) {
  const safePosition = Math.max(0, Math.min(position, view.state.doc.content.size));
  const $pos = view.state.doc.resolve(safePosition);
  const directCellStart = getTableCellStartFromResolvedPosition($pos);
  if (directCellStart !== null) return directCellStart;

  const nearbyCell = cellAround($pos) ?? cellNear($pos);
  return nearbyCell?.pos ?? null;
}

function createTextSelectionInsideTableCell(view: EditorView, cellStart: number, preferredPosition?: number) {
  const { doc } = view.state;
  const cellNode = doc.nodeAt(cellStart);
  if (!cellNode) return null;

  const cellEnd = cellStart + cellNode.nodeSize;
  const positions: number[] = [];

  if (typeof preferredPosition === 'number') {
    positions.push(Math.max(cellStart + 1, Math.min(preferredPosition, cellEnd - 1)));
  }

  cellNode.descendants((node, offset) => {
    if (!node.isTextblock) return true;

    positions.push(cellStart + 1 + offset + 1);
    return false;
  });

  positions.push(cellStart + 1);

  for (const position of positions) {
    try {
      const safePosition = Math.max(cellStart + 1, Math.min(position, cellEnd - 1));
      const selection = TextSelection.near(doc.resolve(safePosition), 1);
      const selectionCellStart = getTableCellStartFromResolvedPosition(selection.$from);

      if (selectionCellStart === cellStart) {
        return selection;
      }
    } catch {
      // Ignore invalid cursor candidates and try the next table-cell textblock.
    }
  }

  return null;
}

function createTableCellTextSelection(view: EditorView, pointer: TableCellPointer) {
  const positions: number[] = [];
  const positionAtCoords = view.posAtCoords({ left: pointer.clientX, top: pointer.clientY });

  if (positionAtCoords?.inside !== undefined && positionAtCoords.inside >= 0) {
    positions.push(positionAtCoords.inside);
  }

  if (positionAtCoords) {
    positions.push(positionAtCoords.pos);
  }

  try {
    positions.push(view.posAtDOM(pointer.cell, 0));
    positions.push(view.posAtDOM(pointer.cell, 0) + 1);
  } catch {
    // Some browser/table DOM positions cannot be mapped directly.
  }

  for (const position of positions) {
    const cellStart = getTableCellStartNearPosition(view, position);
    if (cellStart === null) continue;

    const selection = createTextSelectionInsideTableCell(view, cellStart, positionAtCoords?.pos);
    if (selection) return selection;
  }

  return null;
}

export function setTableCellTextSelection(view: EditorView, pointer: TableCellPointer) {
  window.requestAnimationFrame(() => {
    if (!view.dom.isConnected) return;

    const selection = createTableCellTextSelection(view, pointer);
    if (!selection) return;

    view.dispatch(
      view.state.tr
        .setSelection(selection)
        .setMeta(tableEditingKey, -1)
        .scrollIntoView(),
    );
    view.focus();
  });
}

export function createTableCellEditorProps() {
  return {
    handleDOMEvents: {
      mousedown: (view: EditorView, event: Event) => {
        if (!(event instanceof MouseEvent) || !isTableCellEditClick(event)) return false;

        const cell = getClickedTableCell(event);
        if (!cell) return false;

        setTableCellTextSelection(view, {
          cell,
          clientX: event.clientX,
          clientY: event.clientY,
        });

        return true;
      },
    },
    handleClick: (view: EditorView, _position: number, event: MouseEvent) => {
      if (!isTableCellEditClick(event)) return false;

      const cell = getClickedTableCell(event);
      if (!cell) return false;

      setTableCellTextSelection(view, {
        cell,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return false;
    },
  };
}

export type TableContextMenuRun = (command: () => void) => () => void;
export type TableContextMenuLocalizer = (zh: string, en: string) => string;

export function buildTableContextMenuEntries(
  editor: Editor,
  run: TableContextMenuRun,
  l: TableContextMenuLocalizer,
): NotesContextMenuEntry[] {
  return [
    {
      id: 'table-add-row-before',
      label: l('在上方插入行', 'Insert row above'),
      icon: iconNode(<Plus className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().addRowBefore().run()),
    },
    {
      id: 'table-add-row-after',
      label: l('在下方插入行', 'Insert row below'),
      icon: iconNode(<Plus className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().addRowAfter().run()),
    },
    {
      id: 'table-add-column-before',
      label: l('在左侧插入列', 'Insert column left'),
      icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().addColumnBefore().run()),
    },
    {
      id: 'table-add-column-after',
      label: l('在右侧插入列', 'Insert column right'),
      icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().addColumnAfter().run()),
    },
    { type: 'separator', id: 'table-separator-structure' },
    {
      id: 'table-toggle-header-row',
      label: l('切换表头行', 'Toggle header row'),
      icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleHeaderRow().run()),
    },
    {
      id: 'table-toggle-header-column',
      label: l('切换表头列', 'Toggle header column'),
      icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleHeaderColumn().run()),
    },
    {
      id: 'table-merge-cells',
      label: l('合并单元格', 'Merge cells'),
      icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
      disabled: !editor.can().mergeCells(),
      onSelect: run(() => editor.chain().focus().mergeCells().run()),
    },
    {
      id: 'table-split-cell',
      label: l('拆分单元格', 'Split cell'),
      icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
      disabled: !editor.can().splitCell(),
      onSelect: run(() => editor.chain().focus().splitCell().run()),
    },
    { type: 'separator', id: 'table-separator-delete' },
    {
      id: 'table-delete-row',
      label: l('删除当前行', 'Delete row'),
      icon: iconNode(<Trash2 className="h-4 w-4" strokeWidth={1.8} />),
      tone: 'danger',
      onSelect: run(() => editor.chain().focus().deleteRow().run()),
    },
    {
      id: 'table-delete-column',
      label: l('删除当前列', 'Delete column'),
      icon: iconNode(<Trash2 className="h-4 w-4" strokeWidth={1.8} />),
      tone: 'danger',
      onSelect: run(() => editor.chain().focus().deleteColumn().run()),
    },
    {
      id: 'table-delete-table',
      label: l('删除表格', 'Delete table'),
      icon: iconNode(<Trash2 className="h-4 w-4" strokeWidth={1.8} />),
      tone: 'danger',
      onSelect: run(() => editor.chain().focus().deleteTable().run()),
    },
    { type: 'separator', id: 'table-separator-block' },
  ];
}
