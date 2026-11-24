import { useCallback, useEffect, useState } from 'react';
import { AnnotationEditorType } from 'pdfjs-dist';
import { emitToast } from '../../../ui/toastBridge';
import {
  applyPdfAnnotationToolColors,
  persistPdfAnnotationToolColors,
  type PdfAnnotationColorTool,
  type PdfAnnotationToolColors,
} from '../annotationColors';
import type {
  PdfSource,
} from '../../../types/reader';
import {
  buildPathInDirectory,
  getParentDirectory,
  normalizePathForCompare,
} from '../../../utils/path';
import { getFileNameFromPath } from '../../../utils/text';
import { selectSavePdfPath, writeLocalBinaryFile } from '../../../services/desktop';
import {
  hasActiveTextSelection,
  isEditableTarget,
  selectionBelongsToContainer,
} from '../pdfPageDomUtils';
import {
  buildAnnotatedFileName,
  buildAnnotatedSiblingPath,
} from '../pdfViewerUtils';
import type { AnnotationEditorTool } from '../PdfViewerToolbar';

type LocaleText = (zh: string, en: string) => string;
// pdfjs-dist 的运行时句柄与官方 .d.ts 存在差异，只在边界处集中用别名标注。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs 运行时 API 与类型声明不一致
type PdfJsLoose = any;

type MutableRef<T> = { current: T };
type BooleanStateSetter = (value: boolean | ((current: boolean) => boolean)) => void;
type AnnotationColorsSetter = (
  value: PdfAnnotationToolColors | ((current: PdfAnnotationToolColors) => PdfAnnotationToolColors),
) => void;

interface UsePdfAnnotationsOptions {
  active: boolean;
  annotationColors: PdfAnnotationToolColors;
  annotationEditorReadyRef: MutableRef<boolean>;
  annotationEditorUiManagerRef: MutableRef<PdfJsLoose>;
  clearPendingBlockSelect: () => void;
  clearSelectionCommitTimer: () => void;
  containerRef: MutableRef<HTMLDivElement | null>;
  currentPdfName: string;
  defaultSaveDirectory: string;
  editorToolRef: MutableRef<AnnotationEditorTool>;
  eventBusRef: MutableRef<PdfJsLoose>;
  hasSelectedEditor: boolean;
  lRef: MutableRef<LocaleText>;
  onBlockHover: (block: null) => void;
  onSaveSuccess?: (path: string) => void;
  originalPdfPath: string;
  pdfDocumentRef: MutableRef<PdfJsLoose>;
  pdfViewerRef: MutableRef<PdfJsLoose>;
  setAnnotationColors: AnnotationColorsSetter;
  setDocumentError: (message: string) => void;
  setHasLiveTextSelection: BooleanStateSetter;
  setHasSelectedEditor: BooleanStateSetter;
  source: PdfSource;
}

function setBooleanStateIfChanged(setter: BooleanStateSetter, value: boolean) {
  setter((current) => (current === value ? current : value));
}

export function resolveToolMode(mode: AnnotationEditorTool) {
  switch (mode) {
    case 'freetext':
      return AnnotationEditorType.FREETEXT;
    case 'ink':
      return AnnotationEditorType.INK;
    case 'none':
    default:
      return AnnotationEditorType.NONE;
  }
}

export function usePdfAnnotations({
  active,
  annotationColors,
  annotationEditorReadyRef,
  annotationEditorUiManagerRef,
  clearPendingBlockSelect,
  clearSelectionCommitTimer,
  containerRef,
  currentPdfName,
  defaultSaveDirectory,
  editorToolRef,
  eventBusRef,
  hasSelectedEditor,
  lRef,
  onBlockHover,
  onSaveSuccess,
  originalPdfPath,
  pdfDocumentRef,
  pdfViewerRef,
  setAnnotationColors,
  setDocumentError,
  setHasLiveTextSelection,
  source,
}: UsePdfAnnotationsOptions) {
  const [editorTool, setEditorTool] = useState<AnnotationEditorTool>('none');
  const [activeColorTool, setActiveColorTool] = useState<PdfAnnotationColorTool>('highlight');
  const [saving, setSaving] = useState(false);

  const updateAnnotationToolColor = useCallback(
    (tool: PdfAnnotationColorTool, value: string) => {
      const nextColor = value.trim().toLowerCase();

      setAnnotationColors((current) => {
        if (current[tool] === nextColor) {
          return current;
        }

        return {
          ...current,
          [tool]: nextColor,
        };
      });
    },
    [],
  );

  const waitForAnnotationEditorMode = useCallback((mode: number, timeout = 240) => {
    return new Promise<void>((resolve) => {
      const pdfViewer = pdfViewerRef.current;
      const eventBus = eventBusRef.current;

      if (pdfViewer?.annotationEditorMode?.mode === mode || !eventBus?.on || !eventBus?.off) {
        resolve();
        return;
      }

      let settled = false;
      const handleModeChanged = (event: { mode?: number }) => {
        if (event.mode === mode) {
          finish();
        }
      };
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        eventBus.off('annotationeditormodechanged', handleModeChanged);
        window.clearTimeout(timerId);
        resolve();
      };
      const timerId = window.setTimeout(finish, timeout);

      eventBus.on('annotationeditormodechanged', handleModeChanged);
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const uiManager = annotationEditorUiManagerRef.current;

    if (uiManager?.delete) {
      uiManager.delete();
      return;
    }

    eventBusRef.current?.dispatch?.('editingaction', {
      source: pdfViewerRef.current,
      name: 'delete',
    });
  }, []);

  const handleCreatePdfHighlight = useCallback(async () => {
    const pdfViewer = pdfViewerRef.current;
    const uiManager = annotationEditorUiManagerRef.current;

    if (!pdfViewer || !uiManager) {
      setDocumentError(
        lRef.current('PDF annotation tools are not ready yet.', 'PDF annotation tools are not ready yet.'),
      );
      return;
    }

    if (!selectionBelongsToContainer(containerRef.current) || !hasActiveTextSelection()) {
      setDocumentError(
        lRef.current(
          'Select text in the PDF before creating a highlight.',
          'Select text in the PDF before creating a highlight.',
        ),
      );
      return;
    }

    try {
      setDocumentError('');
      setActiveColorTool('highlight');
      clearSelectionCommitTimer();
      clearPendingBlockSelect();

      pdfViewer.annotationEditorMode = {
        mode: AnnotationEditorType.HIGHLIGHT,
        isFromKeyboard: false,
      };
      await waitForAnnotationEditorMode(AnnotationEditorType.HIGHLIGHT);

      uiManager.highlightSelection('paperquay_toolbar');

      pdfViewer.annotationEditorMode = {
        mode: AnnotationEditorType.NONE,
        isFromKeyboard: false,
      };
      await waitForAnnotationEditorMode(AnnotationEditorType.NONE);
      setBooleanStateIfChanged(setHasLiveTextSelection, false);
    } catch (highlightError) {
      setDocumentError(
        highlightError instanceof Error
          ? highlightError.message
          : lRef.current('创建 PDF 高亮失败', 'Failed to create the PDF highlight'),
      );
    }
  }, [
    clearPendingBlockSelect,
    clearSelectionCommitTimer,
    waitForAnnotationEditorMode,
  ]);

  useEffect(() => {
    persistPdfAnnotationToolColors(annotationColors);
  }, [annotationColors]);

  useEffect(() => {
    if (!annotationEditorReadyRef.current) {
      return;
    }

    applyPdfAnnotationToolColors(annotationEditorUiManagerRef.current, annotationColors);
  }, [annotationColors]);

  useEffect(() => {
    editorToolRef.current = editorTool;
    const pdfViewer = pdfViewerRef.current;

    if (!pdfViewer || !annotationEditorReadyRef.current) {
      return;
    }

    pdfViewer.annotationEditorMode = {
      mode: resolveToolMode(editorTool),
      isFromKeyboard: false,
    };

    if (editorTool !== 'none') {
      clearSelectionCommitTimer();
      clearPendingBlockSelect();
      window.getSelection()?.removeAllRanges();
      onBlockHover(null);
      setBooleanStateIfChanged(setHasLiveTextSelection, false);
    }
  }, [clearPendingBlockSelect, clearSelectionCommitTimer, editorTool, onBlockHover]);

  useEffect(() => {
    if (!active || !hasSelectedEditor) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      event.preventDefault();
      handleDeleteSelected();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, handleDeleteSelected, hasSelectedEditor]);

  const handleSave = useCallback(async () => {
    const pdfDocument = pdfDocumentRef.current;

    if (!pdfDocument || saving) {
      return;
    }

    try {
      setSaving(true);
      setDocumentError('');

      const sourcePath = source?.kind === 'local-path' ? source.path : '';
      const exportDirectory = defaultSaveDirectory.trim();
      const protectedSourcePath = originalPdfPath.trim();
      const suggestedFileName = buildAnnotatedFileName(
        currentPdfName || (sourcePath ? getFileNameFromPath(sourcePath) : 'document.pdf'),
      );
      const targetPath = sourcePath
        ? exportDirectory
          ? buildPathInDirectory(exportDirectory, suggestedFileName)
          : buildAnnotatedSiblingPath(sourcePath)
        : await selectSavePdfPath({
            suggestedFileName,
            initialDirectory:
              exportDirectory || (sourcePath ? getParentDirectory(sourcePath) : undefined),
          });

      if (!targetPath) {
        emitToast({
          tone: 'info',
          message: lRef.current('已取消导出批注版 PDF', 'Annotated PDF export canceled'),
        });
        return;
      }

      if (
        protectedSourcePath &&
        normalizePathForCompare(targetPath) === normalizePathForCompare(protectedSourcePath)
      ) {
        throw new Error('Cannot overwrite the original PDF. Save annotations to a separate file.');
      }

      const nextBytes = await pdfDocument.saveDocument();

      if (pdfDocumentRef.current !== pdfDocument) {
        return;
      }

      // 写权限由主进程策略决定：保存对话框已登记目标路径；同目录批注版
      // 导出依赖文库附件目录的受限写规则。

      await writeLocalBinaryFile(targetPath, new Uint8Array(nextBytes));
      const updatingCurrentAnnotatedFile =
        sourcePath && normalizePathForCompare(targetPath) === normalizePathForCompare(sourcePath);
      const saveMessage = updatingCurrentAnnotatedFile
        ? lRef.current(`已更新批注版 PDF：${targetPath}`, `Updated annotated PDF: ${targetPath}`)
        : exportDirectory
          ? lRef.current(`已将批注版 PDF 保存到文献项目目录：${targetPath}`, `Saved annotated PDF to the paper project folder: ${targetPath}`)
          : sourcePath
            ? lRef.current(`已将批注版 PDF 保存到原文件旁：${targetPath}`, `Saved annotated PDF next to the original file: ${targetPath}`)
            : lRef.current(`已导出批注版 PDF：${targetPath}`, `Exported annotated PDF: ${targetPath}`);
      emitToast({ tone: 'success', message: saveMessage });
      onSaveSuccess?.(targetPath);
    } catch (saveError) {
      setDocumentError(
        saveError instanceof Error
          ? saveError.message
          : lRef.current('导出批注版 PDF 失败', 'Failed to export the annotated PDF'),
      );
    } finally {
      setSaving(false);
    }
  }, [currentPdfName, defaultSaveDirectory, onSaveSuccess, originalPdfPath, saving, source]);

  return {
    activeColorTool,
    editorTool,
    handleCreatePdfHighlight,
    handleDeleteSelected,
    handleSave,
    saving,
    setActiveColorTool,
    setEditorTool,
    updateAnnotationToolColor,
  };
}
