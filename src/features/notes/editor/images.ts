import type { Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import {
  getImageFilesFromDataTransfer,
  insertImageFilesIntoView,
  isImageFile,
  readFileAsDataUrl,
} from '../noteEditorUtils';

// 图片插入实现仍由 noteEditorUtils 持有（data URL / base64 读取与文档写入），
// 这里只提供 Tiptap editorProps 的粘贴/拖放入口，避免 NoteEditor 内联视图逻辑。
export {
  getImageFilesFromDataTransfer,
  insertImageFilesIntoView,
  isImageFile,
  readFileAsDataUrl,
};

export function createImageEditorProps() {
  return {
    handlePaste: (view: EditorView, event: ClipboardEvent) => {
      const files = getImageFilesFromDataTransfer(event.clipboardData);
      if (files.length === 0) return false;

      event.preventDefault();
      return insertImageFilesIntoView(view, files);
    },
    handleDrop: (view: EditorView, event: DragEvent, _slice: Slice, moved: boolean) => {
      if (moved) return false;

      const files = getImageFilesFromDataTransfer(event.dataTransfer);
      if (files.length === 0) return false;

      event.preventDefault();
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
      return insertImageFilesIntoView(view, files, position?.pos ?? null);
    },
  };
}
