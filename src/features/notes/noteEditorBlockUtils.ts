import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { componentBlockNode, paragraphNode } from './noteEditorUtils.ts';

export interface NoteBlockRange {
  node: ProseMirrorNode;
  from: number;
  to: number;
}

export interface ActiveNoteBlock extends NoteBlockRange {
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface NoteEditorContextMenuState {
  x: number;
  y: number;
  position: number;
  block: NoteBlockRange;
  inTable: boolean;
}

export function clampDocPosition(editor: Editor, position: number) {
  return Math.max(0, Math.min(position, editor.state.doc.content.size));
}

export function getCurrentBlockRange(editor: Editor) {
  return getTopLevelBlockRangeAtPos(editor, editor.state.selection.from);
}

/** 不传 localizer 时保持历史输出（英文块名 + 中文「引用」），避免破坏既有调用与测试。 */
export type NoteBlockLabelLocalizer = (zh: string, en: string) => string;

export function getBlockLabelFromNode(node: ProseMirrorNode, l?: NoteBlockLabelLocalizer) {
  if (node.type.name === 'heading') {
    const level = node.attrs.level ?? 1;
    return l ? l(`标题 ${level}`, `Heading ${level}`) : `Heading ${level}`;
  }
  if (node.type.name === 'paragraph') return l ? l('正文', 'Paragraph') : 'Paragraph';
  if (node.type.name === 'bulletList') return l ? l('无序列表', 'Bullet list') : 'Bullet list';
  if (node.type.name === 'orderedList') return l ? l('有序列表', 'Ordered list') : 'Ordered list';
  if (node.type.name === 'taskList') return l ? l('任务列表', 'Task list') : 'Task list';
  if (node.type.name === 'blockquote') return l ? l('引用', 'Quote') : 'Quote';
  if (node.type.name === 'codeBlock') return l ? l('代码块', 'Code block') : 'Code block';
  if (node.type.name === 'table') return l ? l('表格', 'Table') : 'Table';
  if (node.type.name === 'image') return l ? l('图片', 'Image') : 'Image';
  if (node.type.name === 'noteAnchorBlock') return l ? l('引用', 'Source anchor') : '引用';
  if (node.type.name === 'noteComponentBlock') return l ? l('组件块', 'Component') : 'Component';
  return l ? l('块', 'Block') : 'Block';
}

export function getTopLevelBlocks(editor: Editor) {
  const blocks: NoteBlockRange[] = [];

  editor.state.doc.forEach((node, offset) => {
    blocks.push({
      node,
      from: offset,
      to: offset + node.nodeSize,
    });
  });

  return blocks;
}

export function getTopLevelBlockRangeAtPos(editor: Editor, pos: number): NoteBlockRange | null {
  const blocks = getTopLevelBlocks(editor);
  if (blocks.length === 0) return null;

  return (
    blocks.find((block) => pos >= block.from && pos <= block.to) ??
    blocks.find((block) => pos < block.to) ??
    blocks[blocks.length - 1]
  );
}

export function isEditorPositionInTable(editor: Editor, position: number, block: NoteBlockRange) {
  if (block.node.type.name === 'table') return true;

  const resolved = editor.state.doc.resolve(clampDocPosition(editor, position));
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'table') return true;
  }

  return false;
}

export function getEditorContextAtPosition(
  editor: Editor,
  positionValue: number,
): { position: number; block: NoteBlockRange; inTable: boolean } | null {
  const position = clampDocPosition(editor, positionValue);
  const block = getTopLevelBlockRangeAtPos(editor, position);
  if (!block) return null;

  return { position, block, inTable: isEditorPositionInTable(editor, position, block) };
}

export function getEditorContextAtPoint(
  editor: Editor,
  clientX: number,
  clientY: number,
): { position: number; block: NoteBlockRange; inTable: boolean } | null {
  const positionInfo = editor.view.posAtCoords({ left: clientX, top: clientY });
  const fallbackPosition = editor.state.selection.from;

  return getEditorContextAtPosition(editor, positionInfo?.pos ?? fallbackPosition);
}

export function resolveActiveBlock(editor: Editor, block: NoteBlockRange | null): NoteBlockRange | null {
  const blocks = getTopLevelBlocks(editor);
  if (block) {
    const exact = blocks.find((item) => item.from === block.from && item.to === block.to);
    if (exact) return exact;
  }

  return getCurrentBlockRange(editor);
}

export function toActiveNoteBlock(
  editor: Editor,
  block: NoteBlockRange,
  l?: NoteBlockLabelLocalizer,
): ActiveNoteBlock {
  const blocks = getTopLevelBlocks(editor);
  const index = blocks.findIndex((item) => item.from === block.from && item.to === block.to);

  return {
    ...block,
    label: getBlockLabelFromNode(block.node, l),
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < blocks.length - 1,
  };
}

export function getTextPositionInsideBlock(editor: Editor, block: NoteBlockRange) {
  let position = Math.min(block.from + 1, editor.state.doc.content.size);
  let found = false;

  block.node.descendants((node, pos) => {
    if (found || !node.isTextblock) return !found;
    position = Math.min(block.from + pos + 1, editor.state.doc.content.size);
    found = true;
    return false;
  });

  return Math.max(0, position);
}

export function refreshDragHandleForCurrentBlock(editor: Editor) {
  if (editor.isDestroyed || !editor.view.hasFocus()) return;

  const block = getCurrentBlockRange(editor);
  if (!block) return;

  const dom = editor.view.nodeDOM(block.from);
  if (!(dom instanceof Element)) return;

  const rect = dom.getBoundingClientRect();
  if (
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return;
  }

  const clientX = Math.min(rect.right - 2, Math.max(rect.left + 2, rect.left + 8));
  const clientY = Math.min(rect.bottom - 2, Math.max(rect.top + 2, rect.top + Math.min(18, rect.height / 2)));

  editor.view.dom.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window,
    }),
  );
}

export function focusTextPosition(editor: Editor, position: number) {
  window.requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    editor.commands.focus();
    editor.commands.setTextSelection(clampDocPosition(editor, position));
  });
}

export function focusNoteBlock(editor: Editor, block: NoteBlockRange, position?: number) {
  editor.commands.focus();

  if (block.node.isAtom || block.node.isLeaf) {
    editor.commands.setNodeSelection(block.from);
    return;
  }

  editor.commands.setTextSelection(
    typeof position === 'number'
      ? clampDocPosition(editor, position)
      : getTextPositionInsideBlock(editor, block),
  );
}

export function insertParagraphBelowBlock(editor: Editor, block: NoteBlockRange) {
  const insertAt = block.to;
  editor
    .chain()
    .focus()
    .insertContentAt(insertAt, paragraphNode(), { updateSelection: false })
    .run();
  focusTextPosition(editor, insertAt + 1);
}

export function insertComponentBelowBlock(editor: Editor, block: NoteBlockRange) {
  const insertAt = block.to;
  editor
    .chain()
    .focus()
    .insertContentAt(insertAt, componentBlockNode('Component'), { updateSelection: false })
    .run();
  focusTextPosition(editor, insertAt + 2);
}

export function duplicateNoteBlock(editor: Editor, block: NoteBlockRange) {
  const insertAt = block.to;
  editor
    .chain()
    .focus()
    .insertContentAt(insertAt, block.node.toJSON(), { updateSelection: false })
    .run();
  focusTextPosition(editor, insertAt + 1);
}

export function deleteNoteBlock(editor: Editor, block: NoteBlockRange) {
  editor.chain().focus().deleteRange({ from: block.from, to: block.to }).run();
  if (editor.state.doc.childCount === 0) {
    editor.chain().focus().insertContent(paragraphNode()).run();
  }
}

export function moveTopLevelBlock(editor: Editor, block: NoteBlockRange, direction: 'up' | 'down') {
  const blocks = getTopLevelBlocks(editor);
  const index = blocks.findIndex((item) => item.from === block.from && item.to === block.to);
  if (index < 0) return false;

  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  const neighbor = blocks[neighborIndex];
  if (!neighbor) return false;

  const current = blocks[index];
  const from = direction === 'up' ? neighbor.from : current.from;
  const to = direction === 'up' ? current.to : neighbor.to;
  const content = direction === 'up'
    ? [current.node, neighbor.node]
    : [neighbor.node, current.node];
  const nextFrom = direction === 'up' ? neighbor.from : current.from + neighbor.node.nodeSize;

  editor.view.dispatch(editor.state.tr.replaceWith(from, to, content).scrollIntoView());
  focusTextPosition(editor, nextFrom + 1);
  return true;
}
