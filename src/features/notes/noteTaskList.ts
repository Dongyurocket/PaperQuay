import type { Editor } from '@tiptap/core';

/**
 * 0.4.42：「任务列表」按钮的统一入口。
 *
 * 为什么不是直接 `toggleTaskList()`：引用摘录块是 atom 节点，光标落在其中时
 * Tiptap 的 `toggleTaskList` 直接返回 false（无事务、无提示），用户看到的就是
 * 「点击没有任何反应」。这里在命令不适用时插入一个新的任务项，保证点击一定
 * 有可见结果；调用方再根据返回值决定是否提示。
 */
export type TaskListToggleOutcome = 'toggled' | 'inserted' | 'unavailable';

export function toggleTaskListAtSelection(editor: Editor | null | undefined): TaskListToggleOutcome {
  if (!editor || editor.isDestroyed) return 'unavailable';

  if (editor.chain().focus().toggleTaskList().run()) {
    return 'toggled';
  }

  const inserted = editor
    .chain()
    .focus()
    .insertContent({
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph' }],
        },
      ],
    })
    .run();

  return inserted ? 'inserted' : 'unavailable';
}
