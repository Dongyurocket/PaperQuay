import { useMemo } from 'react';
import { BookCopy, FilePlus2, Link2, Unlink2 } from 'lucide-react';
import PdfViewer from '../pdf/PdfViewer';
import { useLocaleText } from '../../i18n/uiLanguage';
import type {
  PaperAnnotation,
  PdfSource,
  PositionedMineruBlock,
} from '../../types/reader';

interface TranslatedPdfPaneProps {
  /** 翻译版 PDF 本地路径；为空时渲染附加引导空状态 */
  translatedPdfPath: string;
  fileName?: string;
  /** 来自原版 PDF 栏的页码同步信号 */
  pageSyncSignal?: { context: string; page: number; token: number } | null;
  syncEnabled: boolean;
  onSyncEnabledChange: (enabled: boolean) => void;
  /** 本栏页码变化（用于反向同步到原版栏） */
  onPageChange?: (page: number) => void;
  /** 来自原版栏的同步信号已实际应用 */
  onPageSyncApplied?: (page: number, token: number) => void;
  onAttachTranslatedPdf?: () => void;
  attaching?: boolean;
  active: boolean;
  smoothScroll: boolean;
  softPageShadow: boolean;
}

const noop = () => {};
const EMPTY_BLOCKS: PositionedMineruBlock[] = [];
const EMPTY_ANNOTATIONS: PaperAnnotation[] = [];

/**
 * 翻译版 PDF 对照栏：以精简模式复用 PdfViewer 渲染 retainpdf 翻译的 PDF，
 * 页码与原版一一对应，通过 pageSyncSignal / onPageChange 与左侧原版栏双向联动。
 */
export default function TranslatedPdfPane({
  translatedPdfPath,
  fileName = '',
  pageSyncSignal = null,
  syncEnabled,
  onSyncEnabledChange,
  onPageChange,
  onPageSyncApplied,
  onAttachTranslatedPdf,
  attaching = false,
  active,
  smoothScroll,
  softPageShadow,
}: TranslatedPdfPaneProps) {
  const l = useLocaleText();
  const source = useMemo<PdfSource>(
    () => translatedPdfPath ? { kind: 'local-path', path: translatedPdfPath } : null,
    [translatedPdfPath],
  );

  if (!translatedPdfPath) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-8 text-center">
        <BookCopy className="h-10 w-10 text-slate-300 dark:text-[#666]" strokeWidth={1.6} />
        <div className="max-w-sm">
          <div className="text-sm font-semibold text-slate-700 dark:text-[var(--pq-text)]">
            {l('尚未附加翻译版 PDF', 'No translated PDF attached')}
          </div>
          <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-[var(--pq-text-muted)]">
            {l(
              '附加由 retainpdf 翻译的 PDF 后，可与原版 PDF 逐页对照阅读。翻译版页码需与原版一一对应。',
              'Attach a retainpdf-translated PDF to read it side by side with the original. Page numbers must match the original.',
            )}
          </p>
        </div>
        {onAttachTranslatedPdf ? (
          <button
            type="button"
            onClick={onAttachTranslatedPdf}
            disabled={attaching}
            className="pq-button-primary h-9 px-4 text-sm"
          >
            <FilePlus2 className="mr-2 h-4 w-4" strokeWidth={1.9} />
            {attaching
              ? l('正在附加…', 'Attaching…')
              : l('附加翻译版 PDF', 'Attach Translated PDF')}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white/60 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex min-w-0 items-center gap-1.5">
          <BookCopy className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" strokeWidth={1.9} />
          <span className="shrink-0 text-[11px] font-semibold text-slate-600 dark:text-[var(--pq-text-muted)]">
            {l('翻译版 PDF', 'Translated PDF')}
          </span>
          {fileName ? (
            <span
              className="truncate text-[11px] text-slate-400 dark:text-[var(--pq-text-faint)]"
              title={fileName}
            >
              {fileName}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onSyncEnabledChange(!syncEnabled)}
          className={
            syncEnabled
              ? 'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-emerald-300/70 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 transition dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:text-emerald-200'
              : 'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-slate-300/80 bg-slate-50 px-2 text-[11px] font-medium text-slate-500 transition dark:border-white/10 dark:bg-white/[0.06] dark:text-[var(--pq-text-faint)]'
          }
          title={
            syncEnabled
              ? l('滚动同步已开启，点击关闭', 'Scroll sync on. Click to turn off')
              : l('滚动同步已关闭，点击开启', 'Scroll sync off. Click to turn on')
          }
        >
          {syncEnabled ? (
            <Link2 className="h-3 w-3" strokeWidth={2} />
          ) : (
            <Unlink2 className="h-3 w-3" strokeWidth={2} />
          )}
          {l('滚动同步', 'Sync scroll')}
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <PdfViewer
          source={source}
          pdfData={null}
          pageSyncSignal={syncEnabled ? pageSyncSignal : null}
          onPageSyncApplied={onPageSyncApplied}
          currentPdfName={fileName}
          hideToolbar
          blocks={EMPTY_BLOCKS}
          annotations={EMPTY_ANNOTATIONS}
          activeBlockId={null}
          hoveredBlockId={null}
          activeHighlight={null}
          smoothScroll={smoothScroll}
          active={active}
          enableReadingHeatmap={false}
          softPageShadow={softPageShadow}
          onBlockHover={noop}
          onBlockSelect={noop}
          onPageChange={onPageChange}
        />
      </div>
    </div>
  );
}
