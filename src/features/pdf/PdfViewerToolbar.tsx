import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Highlighter,
  Loader2,
  MoreHorizontal,
  MousePointer2,
  PenTool,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Menu, type MenuEntry } from '../../ui/menu';
import { cn } from '../../utils/cn';
import {
  getPdfAnnotationColorValue,
  PDF_ANNOTATION_COLOR_PRESETS,
  type PdfAnnotationColorTool,
  type PdfAnnotationToolColors,
} from './annotationColors';
import {
  getPdfAnnotationColorLabel,
  getPercentProgress,
} from './pdfViewerUtils';
import {
  allocatePdfToolbarOverflow,
  parseAndClampPdfPageInput,
  type PdfZoomPreset,
} from './toolbar/pdfToolbarLogic';

type Localize = (zh: string, en: string) => string;

export type AnnotationEditorTool = 'none' | 'freetext' | 'ink';

type ToolbarToolKey = 'select' | 'highlight' | 'freetext' | 'ink';
type EditableToolbarToolKey = Extract<ToolbarToolKey, 'freetext' | 'ink'>;

interface ToolbarTool {
  key: ToolbarToolKey;
  label: string;
  icon: ReactNode;
}
interface PdfViewerToolbarProps {
  activeColorTool: PdfAnnotationColorTool;
  annotationColors: PdfAnnotationToolColors;
  canShowReadingHeatmapBar: boolean;
  currentPage: number;
  editorTool: AnnotationEditorTool;
  enableReadingHeatmap: boolean;
  hasLiveTextSelection: boolean;
  hasSelectedEditor: boolean;
  hideToolbar: boolean;
  l: Localize;
  loading: boolean;
  onActiveColorToolChange: Dispatch<SetStateAction<PdfAnnotationColorTool>>;
  onAnnotationToolColorChange: (tool: PdfAnnotationColorTool, value: string) => void;
  onCreateHighlight: () => void | Promise<void>;
  onDeleteSelected: () => void;
  onEditorToolChange: Dispatch<SetStateAction<AnnotationEditorTool>>;
  onSave: () => void | Promise<void>;
  onScrollToPage: (pageIndex: number) => void;
  onToggleReadingHeatmapBar: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomPresetChange: (preset: PdfZoomPreset) => void;
  pageCount: number;
  readingHeatmapToggleLabel: string;
  saving: boolean;
  showReadingHeatmapBar: boolean;
  translating: boolean;
  translationProgressCompleted: number;
  translationProgressTotal: number;
  zoomLabel: string;
}

const TOOLBAR_OVERFLOW_ITEMS = [
  { id: 'tools', width: 148, priority: 100 },
  { id: 'page', width: 168, priority: 90 },
  { id: 'zoom', width: 126, priority: 80 },
] as const;
const TOOLBAR_DELETE_ITEM = { id: 'delete', width: 40, priority: 30 } as const;
/** 始终可见的「当前颜色」按钮与「⋯」按钮（含间距）所占宽度。 */
const TOOLBAR_RESERVED_WIDTH = 88;
const ZOOM_PRESETS = ['page-width', 'page-fit', '100%'] as const;
const COLOR_PANEL_WIDTH = 176;

export function PdfViewerToolbar({
  activeColorTool,
  annotationColors,
  canShowReadingHeatmapBar,
  currentPage,
  editorTool,
  enableReadingHeatmap,
  hasLiveTextSelection,
  hasSelectedEditor,
  hideToolbar,
  l,
  loading,
  onActiveColorToolChange,
  onAnnotationToolColorChange,
  onCreateHighlight,
  onDeleteSelected,
  onEditorToolChange,
  onSave,
  onScrollToPage,
  onToggleReadingHeatmapBar,
  onZoomIn,
  onZoomOut,
  onZoomPresetChange,
  pageCount,
  readingHeatmapToggleLabel,
  saving,
  showReadingHeatmapBar,
  translating,
  translationProgressCompleted,
  translationProgressTotal,
  zoomLabel,
}: PdfViewerToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [colorPanel, setColorPanel] = useState<{ x: number; y: number } | null>(null);
  const [zoomMenu, setZoomMenu] = useState<{ x: number; y: number; anchor: HTMLButtonElement } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; anchor: HTMLButtonElement } | null>(null);
  const colorPanelRef = useRef<HTMLDivElement | null>(null);
  const colorButtonRef = useRef<HTMLButtonElement | null>(null);
  const skipPageBlurRef = useRef(false);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    const element = toolbarRef.current;

    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // 颜色弹层渲染到 body（工具行 overflow-hidden 会裁掉内部弹层），这里负责点外部、Esc 和窗口缩放时关闭。
  useEffect(() => {
    if (!colorPanel) {
      return undefined;
    }

    const close = () => setColorPanel(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node &&
        (colorPanelRef.current?.contains(target) || colorButtonRef.current?.contains(target))
      ) {
        return;
      }

      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        colorButtonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [colorPanel]);

  const activeToolColor = annotationColors[activeColorTool];
  const translationProgressRatio = getPercentProgress(
    translationProgressCompleted,
    translationProgressTotal,
  );
  const allocation = useMemo(
    () => allocatePdfToolbarOverflow(
      hasSelectedEditor ? [...TOOLBAR_OVERFLOW_ITEMS, TOOLBAR_DELETE_ITEM] : TOOLBAR_OVERFLOW_ITEMS,
      containerWidth,
      TOOLBAR_RESERVED_WIDTH,
    ),
    [containerWidth, hasSelectedEditor],
  );
  const overflowIds = new Set(allocation.overflow);

  const toolbarTools: ToolbarTool[] = [
    {
      key: 'select',
      label: l('选择联动', 'Select & Link'),
      icon: <MousePointer2 className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'highlight',
      label: l('高亮', 'Highlight'),
      icon: <Highlighter className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'freetext',
      label: l('文本', 'Text'),
      icon: <Type className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'ink',
      label: l('手写', 'Ink'),
      icon: <PenTool className="h-4 w-4" strokeWidth={1.8} />,
    },
  ];

  const getToolLabel = (key: ToolbarToolKey) => {
    if (key === 'select') return l('选择联动', 'Select & Link');
    if (key === 'highlight') return l('高亮', 'Highlight');
    if (key === 'freetext') return l('文本批注', 'Text Annotation');
    return l('手写批注', 'Ink Annotation');
  };

  const getZoomPresetLabel = (preset: PdfZoomPreset) =>
    preset === 'page-width'
      ? l('适合宽度', 'Fit width')
      : preset === 'page-fit'
        ? l('适合页面', 'Fit page')
        : '100%';

  const isToolActive = (key: ToolbarToolKey) =>
    (key === 'select' && editorTool === 'none') ||
    (key !== 'select' && key !== 'highlight' && editorTool === key);

  const isToolDisabled = (key: ToolbarToolKey) =>
    key === 'highlight'
      ? !hasLiveTextSelection || editorTool !== 'none' || loading || saving
      : loading || saving;

  const runTool = (key: ToolbarToolKey) => {
    if (key === 'highlight') {
      onActiveColorToolChange('highlight');
      void onCreateHighlight();
      return;
    }

    if (key === 'select') {
      onEditorToolChange('none');
      return;
    }

    const editableTool = key as EditableToolbarToolKey;
    onActiveColorToolChange(editableTool);
    onEditorToolChange((current) => (current === editableTool ? 'none' : editableTool));
  };

  const goToPreviousPage = () => onScrollToPage(Math.max(0, currentPage - 2));
  const goToNextPage = () => onScrollToPage(Math.min(Math.max(pageCount - 1, 0), currentPage));

  const handlePageSubmit = () => {
    const page = parseAndClampPdfPageInput(pageInput, pageCount, currentPage);
    setPageInput(String(page));
    onScrollToPage(page - 1);
  };

  // 被挤进「⋯」的分组在菜单里给出完整等价操作，窄宽时不丢功能。
  const overflowEntries: MenuEntry[] = [
    ...(overflowIds.has('tools')
      ? toolbarTools.map((item) => ({
          id: `overflow-tool-${item.key}`,
          label: getToolLabel(item.key),
          icon: item.icon,
          checked: item.key === 'highlight' ? undefined : isToolActive(item.key),
          disabled: isToolDisabled(item.key),
          onSelect: () => runTool(item.key),
        }))
      : []),
    ...(overflowIds.has('page')
      ? [
          {
            id: 'overflow-previous-page',
            label: `${l('上一页', 'Previous page')} (${currentPage}/${pageCount || '—'})`,
            icon: <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />,
            disabled: currentPage <= 1,
            onSelect: goToPreviousPage,
          },
          {
            id: 'overflow-next-page',
            label: l('下一页', 'Next page'),
            icon: <ChevronRight className="h-4 w-4" strokeWidth={1.8} />,
            disabled: pageCount <= 0 || currentPage >= pageCount,
            onSelect: goToNextPage,
          },
        ]
      : []),
    ...(overflowIds.has('zoom')
      ? [
          {
            id: 'overflow-zoom-out',
            label: l('缩小', 'Zoom out'),
            icon: <ZoomOut className="h-4 w-4" strokeWidth={1.8} />,
            onSelect: onZoomOut,
          },
          {
            id: 'overflow-zoom-in',
            label: `${l('放大', 'Zoom in')} (${zoomLabel})`,
            icon: <ZoomIn className="h-4 w-4" strokeWidth={1.8} />,
            onSelect: onZoomIn,
          },
          ...ZOOM_PRESETS.map((preset) => ({
            id: `overflow-zoom-${preset}`,
            label: getZoomPresetLabel(preset),
            onSelect: () => onZoomPresetChange(preset),
          })),
        ]
      : []),
    ...(overflowIds.has('delete') && hasSelectedEditor
      ? [{
          id: 'overflow-delete',
          label: l('删除所选', 'Delete Selected'),
          icon: <Trash2 className="h-4 w-4" strokeWidth={1.8} />,
          tone: 'danger' as const,
          disabled: loading || saving,
          onSelect: onDeleteSelected,
        }]
      : []),
  ];
  const menuEntries: MenuEntry[] = [
    ...overflowEntries,
    ...(overflowEntries.length > 0 ? [{ type: 'separator' as const, id: 'overflow-separator' }] : []),
    ...(enableReadingHeatmap
      ? [{
          id: 'reading-heatmap',
          label: readingHeatmapToggleLabel,
          icon: <Activity className="h-4 w-4" strokeWidth={1.8} />,
          checked: showReadingHeatmapBar,
          onSelect: onToggleReadingHeatmapBar,
          disabled: !canShowReadingHeatmapBar,
        }]
      : []),
    {
      id: 'export-annotated-pdf',
      label: saving ? l('正在导出…', 'Exporting…') : l('导出批注 PDF', 'Export Annotated PDF'),
      icon: saving
        ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
        : <Download className="h-4 w-4" strokeWidth={1.8} />,
      onSelect: onSave,
      disabled: saving || loading,
      tone: 'accent' as const,
    },
  ];

  const renderToolButtons = () => (
    <div className="inline-flex shrink-0 items-center gap-1">
      {toolbarTools.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => runTool(item.key)}
          disabled={isToolDisabled(item.key)}
          title={getToolLabel(item.key)}
          aria-label={getToolLabel(item.key)}
          aria-pressed={item.key === 'highlight' ? undefined : isToolActive(item.key)}
          className={cn(
            'pq-icon-button !h-8 !w-8 shrink-0 border border-transparent disabled:cursor-not-allowed disabled:opacity-55',
            isToolActive(item.key)
              ? '!bg-[var(--pq-accent-soft)] !text-[var(--pq-accent)] !shadow-[inset_0_0_0_1px_var(--pq-accent-border)]'
              : '',
          )}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={toolbarRef}
      className={cn(
        'pq-toolbar relative flex min-w-0 shrink-0 items-center gap-2 px-3 [container-type:inline-size]',
        '!h-9',
        hideToolbar && 'hidden',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap">
        {overflowIds.has('tools') ? null : renderToolButtons()}

        <button
          ref={colorButtonRef}
          type="button"
          onClick={(event) => {
            if (colorPanel) {
              setColorPanel(null);
              return;
            }

            const rect = event.currentTarget.getBoundingClientRect();
            setColorPanel({
              x: Math.max(8, Math.min(rect.left, window.innerWidth - COLOR_PANEL_WIDTH - 8)),
              y: rect.bottom + 4,
            });
          }}
          className="pq-icon-button !h-8 !w-8 shrink-0 border border-[var(--pq-border)] bg-[var(--pq-surface-1)]"
          title={l('当前颜色', 'Current color')}
          aria-label={l('当前颜色', 'Current color')}
          aria-haspopup="dialog"
          aria-expanded={Boolean(colorPanel)}
        >
          <span
            className="h-4 w-4 rounded-full border border-[var(--pq-border-strong)]"
            style={{ backgroundColor: activeToolColor }}
          />
        </button>

        {overflowIds.has('page') ? null : (
          <div className="inline-flex shrink-0 items-center gap-1 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-1">
            <button
              type="button"
              onClick={goToPreviousPage}
              className="pq-icon-button !h-8 !w-8"
              title={l('上一页', 'Previous page')}
              aria-label={l('上一页', 'Previous page')}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handlePageSubmit();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  // Esc 还原为当前页；跳过随后的 blur 归一化，否则会把输入的值写回去。
                  skipPageBlurRef.current = true;
                  setPageInput(String(currentPage));
                  event.currentTarget.blur();
                }
              }}
              onBlur={() => {
                if (skipPageBlurRef.current) {
                  skipPageBlurRef.current = false;
                  return;
                }

                setPageInput(String(parseAndClampPdfPageInput(pageInput, pageCount, currentPage)));
              }}
              inputMode="numeric"
              aria-label={l('当前页码', 'Current page')}
              title={l('输入页码后按 Enter 跳转，Esc 还原', 'Enter a page and press Enter to jump; Esc restores')}
              className="pq-input !h-7 !w-12 border-0 bg-transparent px-1 text-center text-[11px] font-medium"
            />
            <span className="text-[11px] text-[var(--pq-text-faint)]">/{pageCount || '—'}</span>
            <button
              type="button"
              onClick={goToNextPage}
              className="pq-icon-button !h-8 !w-8"
              title={l('下一页', 'Next page')}
              aria-label={l('下一页', 'Next page')}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        )}

        {overflowIds.has('zoom') ? null : (
          <div className="inline-flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setZoomMenu({ x: rect.left, y: rect.bottom + 4, anchor: event.currentTarget });
              }}
              className="pq-button-secondary !h-8 min-w-16 px-2 text-[11px]"
              title={l('缩放预设', 'Zoom presets')}
              aria-label={`${l('缩放预设', 'Zoom presets')}: ${zoomLabel}`}
              aria-haspopup="menu"
              aria-expanded={Boolean(zoomMenu)}
            >
              <span className="max-w-12 truncate">{zoomLabel}</span>
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={onZoomOut}
              className="pq-icon-button !h-8 !w-8"
              title={l('缩小', 'Zoom out')}
              aria-label={l('缩小', 'Zoom out')}
            >
              <ZoomOut className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={onZoomIn}
              className="pq-icon-button !h-8 !w-8"
              title={l('放大', 'Zoom in')}
              aria-label={l('放大', 'Zoom in')}
            >
              <ZoomIn className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        )}

        {overflowIds.has('delete') || !hasSelectedEditor ? null : (
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={loading || saving}
            className="pq-icon-button !h-8 !w-8 shrink-0 !text-[var(--pq-danger)] hover:!bg-[var(--pq-error-bg)] disabled:cursor-not-allowed disabled:opacity-55"
            title={l('删除当前选中的 PDF 批注', 'Delete the selected PDF annotation')}
            aria-label={l('删除所选', 'Delete Selected')}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.right - 224, y: rect.bottom + 4, anchor: event.currentTarget });
        }}
        className="pq-icon-button !h-8 !w-8 shrink-0"
        title={l('更多工具', 'More tools')}
        aria-label={l('更多工具', 'More tools')}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
      </button>

      {colorPanel && typeof document !== 'undefined' ? createPortal(
        <div
          ref={colorPanelRef}
          role="dialog"
          aria-label={l('批注颜色', 'Annotation color')}
          className="fixed z-[80] w-44 rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] p-2 shadow-[var(--pq-shadow-dialog)]"
          style={{ left: colorPanel.x, top: colorPanel.y }}
        >
          <div className="mb-2 text-[11px] font-medium text-[var(--pq-text-muted)]">
            {l('当前颜色', 'Current color')}
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {PDF_ANNOTATION_COLOR_PRESETS.map((preset) => {
              const colorValue = getPdfAnnotationColorValue(preset, activeColorTool);
              const colorLabel = getPdfAnnotationColorLabel(preset.id, l);
              const selected = colorValue.toLowerCase() === activeToolColor.toLowerCase();

              return (
                <button
                  key={`${activeColorTool}-${preset.id}`}
                  type="button"
                  onClick={() => onAnnotationToolColorChange(activeColorTool, colorValue)}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition',
                    selected
                      ? 'border-[var(--pq-accent)] shadow-[0_0_0_2px_var(--pq-accent-soft)]'
                      : 'border-[var(--pq-border)] hover:border-[var(--pq-border-strong)]',
                  )}
                  style={{ backgroundColor: colorValue }}
                  title={colorLabel}
                  aria-label={colorLabel}
                  aria-pressed={selected}
                />
              );
            })}
          </div>
          <label className="mt-2 flex items-center gap-2 rounded-[var(--pq-radius-sm)] px-1.5 py-1 text-[11px] text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)]">
            <input
              type="color"
              value={activeToolColor}
              onChange={(event) => onAnnotationToolColorChange(activeColorTool, event.target.value)}
              className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
              aria-label={l('自定义颜色', 'Custom color')}
            />
            {l('自定义颜色', 'Custom color')}
          </label>
        </div>,
        document.body,
      ) : null}

      {zoomMenu ? (
        <Menu
          x={zoomMenu.x}
          y={zoomMenu.y}
          width={160}
          entries={ZOOM_PRESETS.map((preset) => ({
            id: `zoom-${preset}`,
            label: getZoomPresetLabel(preset),
            onSelect: () => onZoomPresetChange(preset),
          }))}
          keyboardAnchor={zoomMenu.anchor}
          onClose={() => setZoomMenu(null)}
        />
      ) : null}

      {menu ? (
        <Menu
          x={menu.x}
          y={menu.y}
          entries={menuEntries}
          keyboardAnchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {translating && translationProgressTotal > 0 ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-[var(--pq-accent-soft)]"
          role="progressbar"
          aria-label={l('翻译进度', 'Translation progress')}
          aria-valuemin={0}
          aria-valuemax={translationProgressTotal}
          aria-valuenow={translationProgressCompleted}
        >
          <div
            className="h-full bg-[var(--pq-accent)] transition-[width] duration-300"
            style={{ width: `${translationProgressRatio}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
