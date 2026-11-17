import { ArrowRight } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { PaperSummary, PositionedMineruBlock } from '../../types/reader';
import type { LiteraturePaper, LiteraturePaperTaskState } from '../../types/library';
import { SummaryPanel } from './assistantSidebarPrimitives';
import type { ReaderWorkspaceDocument } from './readerWorkspaceShared';
import { OverviewFilesCard } from './overview/OverviewFilesCard';
import { OverviewProcessMenu } from './overview/OverviewProcessMenu';
import { deriveOverviewTask } from './overview/overviewTaskState';

export interface ReaderWorkspaceOverviewProps {
  currentDocument: ReaderWorkspaceDocument;
  selectedSectionTitle: string;
  currentPdfName: string;
  currentJsonName: string;
  originalPdfPath: string;
  mineruPath: string;
  mineruCacheDir: string;
  storageDir?: string;
  autoLoadSiblingJson: boolean;
  paper?: LiteraturePaper | null;
  operation?: LiteraturePaperTaskState | null;
  loading: boolean;
  translating: boolean;
  translationCancelling: boolean;
  blocks: PositionedMineruBlock[];
  translatedCount: number;
  translationProgressCompleted: number;
  translationProgressTotal: number;
  paperSummary: PaperSummary | null;
  paperSummaryLoading: boolean;
  summaryCacheLoading?: boolean;
  summarySourceReady?: boolean;
  paperSummaryError: string;
  onGenerateSummary: (options?: { force?: boolean }) => void;
  onEnterReading: () => void;
  onOpenMineruJson: () => void;
  onCloudParse: () => void;
  onForceReparse: () => void;
  onTranslateDocument: () => void;
  onCancelTranslateDocument: () => void;
  onOpenPreferences: () => void;
  aiConfigured: boolean;
}

export function ReaderWorkspaceOverview(props: ReaderWorkspaceOverviewProps) {
  const l = useLocaleText();
  const { currentDocument, paper, selectedSectionTitle, blocks } = props;
  const sourceLabel = currentDocument.source === 'standalone'
    ? l('独立文献', 'Standalone Document')
    : `${l('本地文库', 'Local Library')} / ${selectedSectionTitle}`;
  const tasks = {
    operation: props.operation,
    loading: props.loading,
    translating: props.translating,
    summaryLoading: props.paperSummaryLoading,
    blockCount: blocks.length,
    translatedCount: props.translatedCount,
    translationCompleted: props.translationProgressCompleted,
    translationTotal: props.translationProgressTotal,
    hasSummary: Boolean(props.paperSummary),
    summaryError: props.paperSummaryError,
  };
  const runningKind = props.translating ? 'translation' : props.loading ? 'mineru' : props.paperSummaryLoading ? 'overview' : null;
  const runningTask = runningKind ? deriveOverviewTask(runningKind, tasks) : null;
  return <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--pq-bg)] p-4 sm:p-6" data-overview-page>
    <div className="mx-auto max-w-[1440px] space-y-5">
      <section data-tour="overview-actions" className="min-w-0 rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-5">
        <span className="text-xs font-semibold text-[var(--pq-text-muted)]">{l('论文概览', 'Paper Overview')}</span>
        <h2 title={currentDocument.title} className="mt-3 line-clamp-3 break-words text-2xl font-semibold leading-snug tracking-tight text-[var(--pq-text)]">{currentDocument.title}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--pq-text-muted)]">
          <span>{currentDocument.creators || l('未知作者', 'Unknown Author')}</span>
          {currentDocument.year ? <span>· {currentDocument.year}</span> : null}
          {paper?.publication ? <span>· {paper.publication}</span> : null}
          <span>· {sourceLabel}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={props.onEnterReading} className="pq-button-primary !h-9 !rounded-[var(--pq-radius-sm)] px-4 text-sm">{l('进入阅读', 'Start Reading')}<ArrowRight className="h-4 w-4" /></button>
          <OverviewProcessMenu
            key={currentDocument.workspaceId}
            tasks={tasks}
            cancelling={props.translationCancelling}
            aiConfigured={props.aiConfigured}
            summarySourceReady={props.summarySourceReady ?? blocks.length > 0}
            onParse={props.onCloudParse}
            onReparse={props.onForceReparse}
            onTranslate={props.onTranslateDocument}
            onCancelTranslate={props.onCancelTranslateDocument}
            onGenerate={props.onGenerateSummary}
            onOpenJson={props.onOpenMineruJson}
          />
        </div>
        {runningTask ? <div role="status" className="mt-4 space-y-2 text-xs text-[var(--pq-text-muted)]">
          <div className="flex justify-between gap-3"><span>{runningTask.message || l('正在处理', 'Processing')}</span><span className="tabular-nums">{runningTask.progress.countText || l('进行中…', 'Running…')}</span></div>
          <div role="progressbar" aria-label={l('处理进度', 'Processing progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={runningTask.progress.indeterminate ? undefined : runningTask.progress.percent} className="h-1.5 overflow-hidden rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-3)]"><div className={`h-full bg-[var(--pq-accent)] ${runningTask.progress.indeterminate ? 'animate-pulse' : ''}`} style={{ width: `${runningTask.progress.percent}%` }} /></div>
        </div> : null}
      </section>
      <div className="grid min-w-0 items-start gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_280px]">
        <div data-tour="ai-summary" className="min-w-0">
          <SummaryPanel
            key={currentDocument.workspaceId}
            paperSummary={props.paperSummary}
            loading={props.paperSummaryLoading || props.summaryCacheLoading || props.loading}
            loadingLabel={props.summaryCacheLoading
              ? l('正在读取本地概览…', 'Loading the saved overview…')
              : props.loading ? l('正在加载文档…', 'Loading the document…') : undefined}
            error={props.paperSummaryError}
            hasBlocks={props.summarySourceReady ?? blocks.length > 0}
            aiConfigured={props.aiConfigured}
            onGenerateSummary={props.onGenerateSummary}
            onOpenSettings={props.onOpenPreferences}
          />
        </div>
        <OverviewFilesCard
          document={currentDocument}
          paper={paper}
          originalPdfPath={props.originalPdfPath}
          currentPdfName={props.currentPdfName}
          currentJsonName={props.currentJsonName}
          mineruPath={props.mineruPath}
          mineruCacheDir={props.mineruCacheDir}
          storageDir={props.storageDir}
          autoLoadSiblingJson={props.autoLoadSiblingJson}
          blockCount={blocks.length}
        />
      </div>
    </div>
  </div>;
}
