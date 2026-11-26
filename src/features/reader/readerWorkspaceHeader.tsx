import { useState } from 'react';
import {
  BookCopy,
  BookOpen,
  ChevronDown,
  CircleStop,
  Columns2,
  FileJson,
  FileText,
  GitBranch,
  Info,
  Languages,
  Loader2,
  Maximize2,
  MoreHorizontal,
  RefreshCw,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import { formatShortcut } from '../../ui/commands';
import { Menu, type MenuEntry } from '../../ui/menu';
import { emitOpenGraphFocus } from '../../app/appEvents';
import type { ReaderViewMode, WorkspaceStage } from '../../types/reader';
import { cn } from '../../utils/cn';
import { READER_IMMERSIVE_SHORTCUT } from './readerImmersive';

interface PdfOption {
  path: string;
  label: string;
  title?: string;
}
export interface ReaderWorkspaceHeaderProps {
  /** 当前文献在本地文库中的 id；独立 PDF 为空。 */
  paperId?: string;
  sourceLabel: string;
  documentTitle: string;
  documentCreators: string;
  documentYear: string;
  currentPdfName: string;
  currentPdfVariantLabel: string;
  currentPdfPath: string;
  availablePdfOptions: PdfOption[];
  workspaceStage: WorkspaceStage;
  readingViewMode: ReaderViewMode;
  pdfCompareAvailable: boolean;
  loading: boolean;
  translating: boolean;
  translationCancelling: boolean;
  statusMessage?: string;
  activeBlockSummary?: string;
  onStageChange: (stage: WorkspaceStage) => void;
  onReadingViewModeChange: (mode: ReaderViewMode) => void;
  onCurrentPdfPathChange: (path: string) => void;
  onOpenMineruJson: () => void;
  onCloudParse: () => void;
  onForceReparse: () => void;
  onTranslateDocument: () => void;
  onCancelTranslateDocument: () => void;
  onOpenPreferences: () => void;
  onEnterImmersive: () => void;
}

function HeaderStageTabs({
  workspaceStage,
  onStageChange,
}: Pick<ReaderWorkspaceHeaderProps, 'workspaceStage' | 'onStageChange'>) {
  const l = useLocaleText();
  const tabs = [
    {
      key: 'overview' as const,
      label: l('概览', 'Overview'),
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'reading' as const,
      label: l('阅读', 'Reading'),
      icon: <BookOpen className="h-4 w-4" strokeWidth={1.8} />,
    },
  ];

  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onStageChange(tab.key)}
          title={tab.label}
          aria-label={tab.label}
          className={cn(
            'pq-nav-item !h-8 !min-w-8 gap-1.5 px-2 text-[11px] font-medium',
            workspaceStage === tab.key && 'active !text-[var(--pq-accent-strong)]',
          )}
        >
          {tab.icon}
          <span className="hidden xl:inline">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function HeaderReadingModeTabs({
  readingViewMode,
  pdfCompareAvailable,
  onReadingViewModeChange,
}: Pick<
  ReaderWorkspaceHeaderProps,
  'readingViewMode' | 'pdfCompareAvailable' | 'onReadingViewModeChange'
>) {
  const l = useLocaleText();
  const modes = [
    { key: 'pdf-only' as const, label: l('单栏 PDF', 'Single PDF'), icon: <FileText className="h-4 w-4" strokeWidth={1.8} /> },
    { key: 'dual-pane' as const, label: l('PDF 双栏', 'PDF Dual Pane'), icon: <Columns2 className="h-4 w-4" strokeWidth={1.8} /> },
    {
      key: 'pdf-compare' as const,
      label: pdfCompareAvailable
        ? l('PDF 对照', 'PDF Compare')
        : l('PDF 对照（本地文献可附加翻译版 PDF）', 'PDF Compare (available for local library papers)'),
      disabled: !pdfCompareAvailable,
      icon: <BookCopy className="h-4 w-4" strokeWidth={1.8} />,
    },
  ];

  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] p-0.5">
      {modes.map((mode) => (
        <button
          key={mode.key}
          type="button"
          disabled={mode.disabled}
          onClick={() => onReadingViewModeChange(mode.key)}
          title={mode.label}
          aria-label={mode.label}
          className={cn(
            'pq-nav-item !h-8 !min-w-8 gap-1.5 px-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-45',
            readingViewMode === mode.key && 'active !text-[var(--pq-accent-strong)]',
          )}
        >
          {mode.icon}
          <span className="hidden xl:inline">{mode.label}</span>
        </button>
      ))}
    </div>
  );
}

function HeaderPdfVersionControl({
  currentPdfPath,
  availablePdfOptions,
  onCurrentPdfPathChange,
}: Pick<
  ReaderWorkspaceHeaderProps,
  'currentPdfPath' | 'availablePdfOptions' | 'onCurrentPdfPathChange'
>) {
  const l = useLocaleText();

  if (availablePdfOptions.length <= 1) {
    return null;
  }

  const selectedPdfOption =
    availablePdfOptions.find((option) => option.path === currentPdfPath) ?? availablePdfOptions[0];

  return (
    <label className="relative inline-flex h-8 min-w-0 max-w-44 items-center rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] text-[11px] text-[var(--pq-text-muted)]">
      <span className="sr-only">{l('PDF 版本', 'PDF version')}</span>
      <select
        value={currentPdfPath || availablePdfOptions[0]?.path || ''}
        onChange={(event) => onCurrentPdfPathChange(event.target.value)}
        title={selectedPdfOption?.title || selectedPdfOption?.label || ''}
        aria-label={l('PDF 版本', 'PDF version')}
        className="block h-full min-w-0 max-w-full appearance-none truncate bg-transparent px-2.5 pr-7 text-[11px] outline-none"
      >
        {availablePdfOptions.map((option) => (
          <option key={option.path} value={option.path}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-[var(--pq-text-faint)]" strokeWidth={1.8} />
    </label>
  );
}

function HeaderToolsMenu({
  paperId,
  loading,
  translating,
  translationCancelling,
  onOpenMineruJson,
  onCloudParse,
  onForceReparse,
  onTranslateDocument,
  onCancelTranslateDocument,
  onOpenPreferences,
}: Pick<
  ReaderWorkspaceHeaderProps,
  | 'paperId'
  | 'loading'
  | 'translating'
  | 'translationCancelling'
  | 'onOpenMineruJson'
  | 'onCloudParse'
  | 'onForceReparse'
  | 'onTranslateDocument'
  | 'onCancelTranslateDocument'
  | 'onOpenPreferences'
>) {
  const l = useLocaleText();
  const [menu, setMenu] = useState<{ x: number; y: number; anchor: HTMLButtonElement } | null>(null);
  const entries: MenuEntry[] = [
    {
      id: 'open-in-graph',
      label: l('在知识图谱中查看', 'View in Knowledge Graph'),
      icon: <GitBranch className="h-4 w-4" strokeWidth={1.8} />,
      disabled: !paperId,
      onSelect: () => {
        if (paperId) emitOpenGraphFocus({ paperId });
      },
    },
    {
      id: 'open-json',
      label: l('打开 JSON', 'Open JSON'),
      icon: <FileJson className="h-4 w-4" strokeWidth={1.8} />,
      disabled: loading,
      onSelect: onOpenMineruJson,
    },
    {
      id: 'mineru-parse',
      label: l('MinerU 解析', 'MinerU Parse'),
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
      disabled: loading,
      onSelect: onCloudParse,
    },
    {
      id: 'reparse',
      label: l('重新解析（忽略缓存）', 'Re-parse (ignore cache)'),
      icon: <RefreshCw className="h-4 w-4" strokeWidth={1.8} />,
      disabled: loading,
      onSelect: onForceReparse,
    },
    {
      id: 'translate',
      label: translating
        ? translationCancelling
          ? l('取消中…', 'Cancelling…')
          : l('取消翻译', 'Cancel translation')
        : l('翻译全文', 'Translate document'),
      icon: translating
        ? <CircleStop className="h-4 w-4" strokeWidth={1.8} />
        : <Languages className="h-4 w-4" strokeWidth={1.8} />,
      disabled: loading || translationCancelling,
      tone: translating ? 'danger' : 'default',
      onSelect: translating ? onCancelTranslateDocument : onTranslateDocument,
    },
    { type: 'separator', id: 'tools-separator' },
    {
      id: 'preferences',
      label: l('偏好设置', 'Preferences'),
      icon: <Settings2 className="h-4 w-4" strokeWidth={1.8} />,
      onSelect: onOpenPreferences,
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu((current) => current ? null : {
            x: rect.right - 224,
            y: rect.bottom + 4,
            anchor: event.currentTarget,
          });
        }}
        className="pq-icon-button !h-8 !w-8 shrink-0 border border-[var(--pq-border)] bg-[var(--pq-surface-1)]"
        title={l('更多工具', 'More tools')}
        aria-label={l('更多工具', 'More tools')}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
      </button>
      {menu ? <Menu x={menu.x} y={menu.y} entries={entries} keyboardAnchor={menu.anchor} onClose={() => setMenu(null)} /> : null}
    </>
  );
}

export function ReaderWorkspaceHeader({
  paperId,
  sourceLabel,
  documentTitle,
  documentCreators,
  documentYear,
  currentPdfName,
  currentPdfVariantLabel: _currentPdfVariantLabel,
  currentPdfPath,
  availablePdfOptions,
  workspaceStage,
  readingViewMode,
  pdfCompareAvailable,
  loading,
  translating,
  translationCancelling,
  statusMessage = '',
  activeBlockSummary = '',
  onStageChange,
  onReadingViewModeChange,
  onCurrentPdfPathChange,
  onOpenMineruJson,
  onCloudParse,
  onForceReparse,
  onTranslateDocument,
  onCancelTranslateDocument,
  onOpenPreferences,
  onEnterImmersive,
}: ReaderWorkspaceHeaderProps) {
  const l = useLocaleText();
  const immersiveShortcut = formatShortcut(READER_IMMERSIVE_SHORTCUT);
  const documentInfo = [
    `${l('来源', 'Source')}: ${sourceLabel}`,
    `${l('作者', 'Author')}: ${documentCreators || l('未知作者', 'Unknown author')}`,
    documentYear ? `${l('年份', 'Year')}: ${documentYear}` : '',
    currentPdfName ? `${l('文件', 'File')}: ${currentPdfName}` : '',
    activeBlockSummary ? `${l('当前块', 'Current block')}: ${activeBlockSummary}` : '',
    statusMessage ? `${l('状态', 'Status')}: ${statusMessage}` : '',
    l('单击预览，双击进入阅读；Ctrl + 滚轮缩放。', 'Single-click to preview, double-click to read; Ctrl + scroll to zoom.'),
    l(`提示：可用 ${immersiveShortcut} 切换沉浸模式。`, `Tip: press ${immersiveShortcut} to toggle immersive mode.`),
  ].filter(Boolean).join('\n');
  const busy = loading || translating;

  return (
    <header className="pq-toolbar relative z-20 flex min-h-10 shrink-0 items-center px-3">
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <div
            className="min-w-0 truncate text-sm font-semibold tracking-tight text-[var(--pq-text)]"
            title={documentTitle}
          >
            {documentTitle}
          </div>
          <button
            type="button"
            className="pq-icon-button !h-8 !w-8 shrink-0"
            title={documentInfo}
            aria-label={busy && statusMessage
              ? `${l('文档信息', 'Document information')}: ${statusMessage}`
              : l('文档信息', 'Document information')}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--pq-accent)]" strokeWidth={1.8} />
            ) : (
              <Info className="h-4 w-4" strokeWidth={1.8} />
            )}
          </button>
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-center gap-1">
          <HeaderStageTabs workspaceStage={workspaceStage} onStageChange={onStageChange} />
          {workspaceStage === 'reading' ? (
            <HeaderReadingModeTabs
              readingViewMode={readingViewMode}
              pdfCompareAvailable={pdfCompareAvailable}
              onReadingViewModeChange={onReadingViewModeChange}
            />
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
          {workspaceStage === 'reading' ? (
            <HeaderPdfVersionControl
              currentPdfPath={currentPdfPath}
              availablePdfOptions={availablePdfOptions}
              onCurrentPdfPathChange={onCurrentPdfPathChange}
            />
          ) : null}
          {workspaceStage === 'reading' ? (
            <button
              type="button"
              onClick={onEnterImmersive}
              className="pq-icon-button !h-8 !w-8 shrink-0 border border-[var(--pq-border)] bg-[var(--pq-surface-1)]"
              title={l('沉浸阅读', 'Immersive reading')}
              aria-label={l('沉浸阅读', 'Immersive reading')}
            >
              <Maximize2 className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
          <HeaderToolsMenu
        paperId={paperId}
            loading={loading}
            translating={translating}
            translationCancelling={translationCancelling}
            onOpenMineruJson={onOpenMineruJson}
            onCloudParse={onCloudParse}
            onForceReparse={onForceReparse}
            onTranslateDocument={onTranslateDocument}
            onCancelTranslateDocument={onCancelTranslateDocument}
            onOpenPreferences={onOpenPreferences}
          />
        </div>
      </div>
    </header>
  );
}
