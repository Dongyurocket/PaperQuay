import type { Editor, Range } from '@tiptap/core';
import type { NotePageKind } from '../../../types/notes';
import type { UiLanguage } from '../../../types/reader';
import { focusTextPosition } from '../noteEditorBlockUtils';
import {
  componentBlockNode,
  NOTE_TEMPLATES,
  paragraphNode,
  slashCommandItems,
  templateContentForLocale,
  type NoteSlashCommandItem,
} from '../noteEditorUtils';

// 斜杠菜单的候选项数据仍由 noteEditorUtils 维护（NOTE_TEMPLATES / BASE_SLASH_COMMANDS），
// 这里只负责触发后的命令执行。
export { slashCommandItems };

// 斜杠命令在编辑器扩展创建时捕获 locale；用户可能在编辑器打开期间切换界面语言。
// 执行时以 <html lang> 为准（applyDocumentLanguage 会同步），避免插入旧语言模板。
function liveLocale(fallback: UiLanguage): UiLanguage {
  if (typeof document === 'undefined') return fallback;
  const lang = document.documentElement?.lang ?? '';
  if (!lang) return fallback;
  return lang.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

export function runSlashCommand(
  editor: Editor,
  range: Range,
  item: NoteSlashCommandItem,
  onPageKind?: (pageKind: NotePageKind) => void,
  locale: UiLanguage = 'zh-CN',
) {
  const effectiveLocale = liveLocale(locale);
  const chain = editor.chain().focus().deleteRange(range);

  if (item.id === 'paragraph') {
    chain.setParagraph().run();
    return;
  }

  if (item.id === 'heading-1') {
    chain.setNode('heading', { level: 1 }).run();
    return;
  }

  if (item.id === 'heading-2') {
    chain.setNode('heading', { level: 2 }).run();
    return;
  }

  if (item.id === 'heading-3') {
    chain.setNode('heading', { level: 3 }).run();
    return;
  }

  if (item.id === 'bullet-list') {
    chain.toggleBulletList().run();
    return;
  }

  if (item.id === 'ordered-list') {
    chain.toggleOrderedList().run();
    return;
  }

  if (item.id === 'task-list') {
    chain.toggleTaskList().run();
    return;
  }

  if (item.id === 'quote') {
    chain.toggleBlockquote().run();
    return;
  }

  if (item.id === 'code-block') {
    chain.toggleCodeBlock().run();
    return;
  }

  if (item.id === 'table') {
    chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    return;
  }

  if (item.id === 'component') {
    const insertAt = range.from;
    chain.insertContent(componentBlockNode('Component'), { updateSelection: false }).run();
    focusTextPosition(editor, insertAt + 2);
    return;
  }

  if (item.id === 'math') {
    chain.insertInlineMath({ latex: 'E = mc^2' }).insertContent(' ').run();
    return;
  }

  if (item.id.startsWith('template:')) {
    const templateId = item.id.slice('template:'.length);
    const template = NOTE_TEMPLATES.find((entry) => entry.id === templateId);
    if (template) {
      chain.insertContent([...templateContentForLocale(template, effectiveLocale), paragraphNode()]).run();
      if (template.pageKind) onPageKind?.(template.pageKind);
    }
  }
}
