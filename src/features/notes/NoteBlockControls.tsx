import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { DragHandleRule } from '@tiptap/extension-drag-handle';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Copy,
  FileText,
  GripVertical,
  Heading1,
  Heading2,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Plus,
  Quote,
  Trash2,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useLocaleText } from '../../i18n/uiLanguage';
import { copyTextToClipboard } from './NotesContextMenu';
import {
  deleteNoteBlock,
  duplicateNoteBlock,
  focusNoteBlock,
  getCurrentBlockRange,
  getTopLevelBlockRangeAtPos,
  insertComponentBelowBlock,
  insertParagraphBelowBlock,
  moveTopLevelBlock,
  refreshDragHandleForCurrentBlock,
  resolveActiveBlock,
  toActiveNoteBlock,
  type ActiveNoteBlock,
  type NoteBlockRange,
} from './noteEditorBlockUtils.ts';

const NOTE_DRAG_HANDLE_POSITION = {
  placement: 'left-start',
  strategy: 'absolute',
} as const;

const WHOLE_DRAG_CONTAINER_TYPES = new Set([
  'table',
  'blockquote',
  'noteAnchorBlock',
  'noteComponentBlock',
]);
const TABLE_STRUCTURE_TYPES = new Set(['tableRow', 'tableCell', 'tableHeader']);
const TABLE_CONTAINER_TYPES = new Set(['table']);

function hasAncestorType($pos: { depth: number; node: (depth: number) => ProseMirrorNode }, depth: number, names: Set<string>) {
  for (let ancestorDepth = depth - 1; ancestorDepth > 0; ancestorDepth -= 1) {
    if (names.has($pos.node(ancestorDepth).type.name)) return true;
  }

  return false;
}

const NOTE_DRAG_HANDLE_RULES: DragHandleRule[] = [
  {
    id: 'paperquayWholeContainerBlocks',
    evaluate: ({ node, $pos, depth }) => {
      if (WHOLE_DRAG_CONTAINER_TYPES.has(node.type.name)) return 0;
      if (hasAncestorType($pos, depth, WHOLE_DRAG_CONTAINER_TYPES)) return 1000;
      return 0;
    },
  },
  {
    id: 'paperquayNoTableInnerBlocks',
    evaluate: ({ node, $pos, depth }) => {
      if (node.type.name === 'table') return 0;
      if (TABLE_STRUCTURE_TYPES.has(node.type.name)) return 1000;
      if (hasAncestorType($pos, depth, TABLE_CONTAINER_TYPES)) return 1000;
      return 0;
    },
  },
];

const NOTE_DRAG_HANDLE_NESTED = {
  defaultRules: true,
  rules: NOTE_DRAG_HANDLE_RULES,
  edgeDetection: { threshold: 18, strength: 850 },
};

export function NoteBlockControls({
  compact,
  editor,
}: {
  compact?: boolean;
  editor: Editor | null;
}) {
  const [activeBlock, setActiveBlock] = useState<ActiveNoteBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const l = useLocaleText();
  const draggingRef = useRef(false);
  const menuOpenRef = useRef(false);

  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  const syncSelectionBlock = useCallback(() => {
    if (!editor) return;
    const block = getCurrentBlockRange(editor);
    if (block) setActiveBlock(toActiveNoteBlock(editor, block, l));
  }, [editor, l]);

  useEffect(() => {
    if (!editor) return undefined;

    const update = () => window.requestAnimationFrame(() => {
      syncSelectionBlock();
      refreshDragHandleForCurrentBlock(editor);
    });
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('update', update);
    update();

    return () => {
      editor.off('selectionUpdate', update);
      editor.off('focus', update);
      editor.off('update', update);
    };
  }, [editor, syncSelectionBlock]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;

    editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', menuOpen));

    return () => {
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', false));
      }
    };
  }, [editor, menuOpen]);

  const handleNodeChange = useCallback((data: { node: ProseMirrorNode | null; pos: number }) => {
    if (!editor) return;
    if (!data.node || data.pos < 0) {
      if (!menuOpenRef.current) {
        setActiveBlock(null);
      }
      return;
    }

    const block = getTopLevelBlockRangeAtPos(editor, data.pos);
    if (block) {
      setActiveBlock(toActiveNoteBlock(editor, block, l));
    }
  }, [editor, l]);
  const clearDragArtifacts = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (!editor || editor.isDestroyed) return;
      const dropcursorRoot = editor.view.dom.parentElement ?? editor.view.dom;
      dropcursorRoot.querySelectorAll('.ProseMirror-dropcursor').forEach((element) => element.remove());
      editor.view.dispatch(
        editor.state.tr
          .setMeta('hideDragHandle', true)
          .setMeta('lockDragHandle', false),
      );
    });
  }, [editor]);
  const handleElementDragStart = useCallback(() => {
    draggingRef.current = true;
    setMenuOpen(false);
  }, []);
  const handleElementDragEnd = useCallback(() => {
    window.setTimeout(() => {
      draggingRef.current = false;
      clearDragArtifacts();
    }, 0);
  }, [clearDragArtifacts]);

  if (!editor) return null;

  const runWithBlock = (callback: (block: NoteBlockRange) => void) => {
    const block = resolveActiveBlock(editor, activeBlock) ?? getCurrentBlockRange(editor);
    if (!block) return;

    callback(block);
    window.requestAnimationFrame(() => {
      const nextBlock = resolveActiveBlock(editor, block);
      if (nextBlock) setActiveBlock(toActiveNoteBlock(editor, nextBlock, l));
    });
  };
  const convertBlock = (callback: () => void) => {
    runWithBlock((block) => {
      focusNoteBlock(editor, block);
      callback();
      setMenuOpen(false);
    });
  };
  const insertBelow = () => {
    runWithBlock((block) => {
      insertParagraphBelowBlock(editor, block);
      setMenuOpen(false);
    });
  };
  const insertComponentBelow = () => {
    runWithBlock((block) => {
      insertComponentBelowBlock(editor, block);
      setMenuOpen(false);
    });
  };
  const copyBlock = () => {
    runWithBlock((block) => {
      const text = block.node.textContent.trim();
      if (text) void copyTextToClipboard(text);
      setMenuOpen(false);
    });
  };
  const duplicateBlock = () => {
    runWithBlock((block) => {
      duplicateNoteBlock(editor, block);
      setMenuOpen(false);
    });
  };
  const deleteBlock = () => {
    runWithBlock((block) => {
      deleteNoteBlock(editor, block);
      setMenuOpen(false);
    });
  };
  const moveBlock = (direction: 'up' | 'down') => {
    runWithBlock((block) => {
      moveTopLevelBlock(editor, block, direction);
      setMenuOpen(false);
    });
  };

  return (
    <DragHandle
      editor={editor}
      className="pq-note-block-drag-host"
      computePositionConfig={NOTE_DRAG_HANDLE_POSITION}
      nested={NOTE_DRAG_HANDLE_NESTED}
      onNodeChange={handleNodeChange}
      onElementDragStart={handleElementDragStart}
      onElementDragEnd={handleElementDragEnd}
    >
      <div
        className={cn('pq-note-block-controls', compact ? 'is-compact' : '', menuOpen ? 'is-menu-open' : '')}
        onMouseDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('.pq-note-block-menu')) {
            event.preventDefault();
          }
        }}
      >
        <button
          type="button"
          draggable={false}
          className="pq-note-block-control-button"
          title={l('在下方插入块', 'Insert block below')}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={insertBelow}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="pq-note-block-control-button pq-note-block-grip-button"
          title={l(
            `${activeBlock?.label ?? l('块', 'Block')} 菜单`,
            `${activeBlock?.label ?? l('块', 'Block')} menu`,
          )}
          onClick={(event) => {
            event.preventDefault();
            if (draggingRef.current) return;
            setMenuOpen((open) => !open);
          }}
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        {menuOpen ? (
          <div className="pq-note-toolbar-menu pq-note-block-menu">
            <div className="px-2 py-1 text-[11px] font-semibold text-[var(--pq-text-faint)]">
              {activeBlock?.label ?? l('块', 'Block')}
            </div>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => convertBlock(() => editor.chain().focus().setParagraph().run())}>
              <Pilcrow className="h-4 w-4" strokeWidth={1.8} />
              {l('正文', 'Paragraph')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => convertBlock(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>
              <Heading1 className="h-4 w-4" strokeWidth={1.8} />
              {l('一级标题', 'Heading 1')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => convertBlock(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>
              <Heading2 className="h-4 w-4" strokeWidth={1.8} />
              {l('二级标题', 'Heading 2')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => convertBlock(() => editor.chain().focus().toggleBulletList().run())}>
              <List className="h-4 w-4" strokeWidth={1.8} />
              {l('无序列表', 'Bullet list')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => convertBlock(() => editor.chain().focus().toggleOrderedList().run())}>
              <ListOrdered className="h-4 w-4" strokeWidth={1.8} />
              {l('有序列表', 'Ordered list')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => convertBlock(() => editor.chain().focus().toggleTaskList().run())}>
              <ListChecks className="h-4 w-4" strokeWidth={1.8} />
              {l('任务列表', 'Task list')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => convertBlock(() => editor.chain().focus().toggleBlockquote().run())}>
              <Quote className="h-4 w-4" strokeWidth={1.8} />
              {l('引用', 'Quote')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => convertBlock(() => editor.chain().focus().toggleCodeBlock().run())}>
              <Code2 className="h-4 w-4" strokeWidth={1.8} />
              {l('代码块', 'Code block')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={insertComponentBelow}>
              <FileText className="h-4 w-4" strokeWidth={1.8} />
              {l('组件块', 'Component')}
            </button>
            <div className="my-1 border-t border-[var(--pq-border-subtle)]" />
            <button type="button" disabled={!activeBlock?.canMoveUp} onMouseDown={(event) => event.preventDefault()} onClick={() => moveBlock('up')}>
              <ArrowUp className="h-4 w-4" strokeWidth={1.8} />
              {l('上移', 'Move up')}
            </button>
            <button type="button" disabled={!activeBlock?.canMoveDown} onMouseDown={(event) => event.preventDefault()} onClick={() => moveBlock('down')}>
              <ArrowDown className="h-4 w-4" strokeWidth={1.8} />
              {l('下移', 'Move down')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={copyBlock}>
              <Copy className="h-4 w-4" strokeWidth={1.8} />
              {l('复制块文本', 'Copy block text')}
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={duplicateBlock}>
              <FileText className="h-4 w-4" strokeWidth={1.8} />
              {l('复制块', 'Duplicate block')}
            </button>
            <button type="button" className="is-danger" onMouseDown={(event) => event.preventDefault()} onClick={deleteBlock}>
              <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              {l('删除块', 'Delete block')}
            </button>
          </div>
        ) : null}
      </div>
    </DragHandle>
  );
}
