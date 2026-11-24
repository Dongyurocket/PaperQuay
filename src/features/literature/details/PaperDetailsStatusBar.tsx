import { useMemo, useState } from 'react';
import { BookOpenText, Check, ChevronDown, Database, FilePlus2, FileText, Languages, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { LiteraturePaper, LiteraturePaperTaskState } from '../../../types/library';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { Menu, type MenuEntry } from '../../../ui/menu';
import { revealLocalPath } from '../../../services/desktop';
import { toast } from '../../../ui/toast';
import { paperTranslatedPdfAttachment } from '../literatureUi';
import { getPaperTaskProgress } from '../paperTaskProgress';
import type { LiteraturePaperListStatus, LiteraturePaperRagStatus } from '../components/LiteraturePaperList';

interface PaperDetailsStatusBarProps {
  paper: LiteraturePaper;
  actionState: LiteraturePaperTaskState | null;
  paperStatus?: LiteraturePaperListStatus;
  ragStatus: LiteraturePaperRagStatus;
  storageDir?: string | null;
  onOpenPaper: (paper: LiteraturePaper) => void;
  onRunMineruParse?: (paper: LiteraturePaper) => void;
  onTranslatePaper?: (paper: LiteraturePaper) => void;
  onGenerateSummary?: (paper: LiteraturePaper) => void;
  onSetRagMembership?: (paper: LiteraturePaper, enabled: boolean) => void;
  onIndexPaperRag?: (paper: LiteraturePaper) => void;
  onGenerateTranslatedPdf?: (paper: LiteraturePaper) => void;
  onAttachTranslatedPdf?: (paper: LiteraturePaper) => void;
  onRemoveTranslatedPdf?: (paper: LiteraturePaper) => void;
  onSetTranslatedPdfLanguage?: () => void;
}

interface OpenMenu {
  x: number;
  y: number;
  anchor: HTMLButtonElement;
  entries: MenuEntry[];
}

function StatusChip({
  label,
  done,
  running,
  error,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  done: boolean;
  running?: boolean;
  error?: boolean;
  disabled?: boolean;
  onClick: (button: HTMLButtonElement) => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => onClick(event.currentTarget)}
      className={[
        'inline-flex h-7 items-center gap-1.5 rounded-[var(--pq-radius-sm)] border px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        error
          ? 'border-[var(--pq-error-bg)] bg-[var(--pq-error-bg)] text-[var(--pq-danger)]'
          : done
            ? 'border-[var(--pq-success-bg)] bg-[var(--pq-success-bg)] text-[var(--pq-success)]'
            : running
              ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]'
              : 'border-[var(--pq-border)] bg-[var(--pq-surface-1)] text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)]',
      ].join(' ')}
    >
      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
      {done ? <ChevronDown className="h-3 w-3 opacity-65" /> : null}
    </button>
  );
}

export default function PaperDetailsStatusBar({
  paper,
  actionState,
  paperStatus,
  ragStatus,
  storageDir,
  onOpenPaper,
  onRunMineruParse,
  onTranslatePaper,
  onGenerateSummary,
  onSetRagMembership,
  onIndexPaperRag,
  onGenerateTranslatedPdf,
  onAttachTranslatedPdf,
  onRemoveTranslatedPdf,
  onSetTranslatedPdfLanguage,
}: PaperDetailsStatusBarProps) {
  const l = useLocaleText();
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
  const translatedPdf = paperTranslatedPdfAttachment(paper, storageDir);
  const task = (kind: LiteraturePaperTaskState['kind']) => actionState?.kind === kind ? actionState : null;
  const mineruTask = task('mineru');
  const translationTask = task('translation');
  const overviewTask = task('overview');
  const anyTaskRunning = actionState?.status === 'running';

  const showMenu = (anchor: HTMLButtonElement, entries: MenuEntry[]) => {
    const rect = anchor.getBoundingClientRect();
    setOpenMenu({ x: rect.left, y: rect.bottom + 4, anchor, entries });
  };

  const runOrMenu = (
    anchor: HTMLButtonElement,
    done: boolean,
    running: boolean,
    run: (() => void) | undefined,
    label: string,
  ) => {
    if (done) {
      showMenu(anchor, [
        { id: 'run-again', label: l(`重新执行${label}`, `Run ${label} Again`), icon: <RefreshCw className="h-4 w-4" />, disabled: !run || anyTaskRunning, onSelect: () => run?.() },
        { id: 'view-result', label: l('查看', 'View'), icon: <BookOpenText className="h-4 w-4" />, onSelect: () => onOpenPaper(paper) },
      ]);
    } else if (!running) {
      run?.();
    }
  };

  const ragDone = paper.ragEnabled === false || ragStatus === 'ready' || ragStatus === 'stale';
  const mineruDone = Boolean(paperStatus?.mineruParsed || mineruTask?.status === 'success');
  const translationDone = translationTask?.status === 'success';
  const overviewDone = Boolean(paper.aiSummary?.trim() || overviewTask?.status === 'success');

  const progress = useMemo(() => actionState ? getPaperTaskProgress(actionState) : null, [actionState]);

  const ragEntries: MenuEntry[] = [
    {
      id: 'toggle-rag',
      label: paper.ragEnabled === false ? l('加入知识库', 'Include in Knowledge Base') : l('移出知识库', 'Exclude from Knowledge Base'),
      icon: <Database className="h-4 w-4" />,
      disabled: !onSetRagMembership || anyTaskRunning,
      onSelect: () => onSetRagMembership?.(paper, paper.ragEnabled === false),
    },
    ...(paper.ragEnabled === false || !onIndexPaperRag ? [] : [{ id: 'build-rag-index', label: ragStatus === 'stale' ? l('更新过期索引', 'Update Outdated Index') : l('建立 / 重建索引', 'Build / Rebuild Index'), icon: <RefreshCw className="h-4 w-4" />, onSelect: () => onIndexPaperRag(paper) }]),
    { id: 'rag-view', label: l('查看文献', 'Open Paper'), icon: <BookOpenText className="h-4 w-4" />, onSelect: () => onOpenPaper(paper) },
  ];

  const translatedEntries: MenuEntry[] = [
    {
      id: 'generate-translated-pdf',
      label: translatedPdf
        ? l('用 RetainPDF 重新生成译版', 'Regenerate with RetainPDF')
        : l('用 RetainPDF 生成译版', 'Generate with RetainPDF'),
      icon: <Sparkles className="h-4 w-4" />,
      disabled: !onGenerateTranslatedPdf || anyTaskRunning,
      onSelect: () => onGenerateTranslatedPdf?.(paper),
    },
    {
      id: 'attach-translated-pdf',
      label: translatedPdf ? l('替换译版 PDF', 'Replace Translated PDF') : l('附加译版 PDF', 'Attach Translated PDF'),
      icon: <FilePlus2 className="h-4 w-4" />,
      disabled: !onAttachTranslatedPdf,
      onSelect: () => onAttachTranslatedPdf?.(paper),
    },
    ...(translatedPdf ? [
      { id: 'set-translated-language', label: l('设置译版语言', 'Set Translation Language'), icon: <Languages className="h-4 w-4" />, onSelect: () => onSetTranslatedPdfLanguage?.() },
      { id: 'show-translated-pdf', label: l('在文件夹中显示', 'Show in Folder'), icon: <FileText className="h-4 w-4" />, onSelect: async () => {
        const result = await revealLocalPath(translatedPdf.path);
        if (!result.ok) toast({ tone: 'error', message: l('无法打开译版 PDF 所在位置', 'Could not reveal the translated PDF'), description: result.message ?? translatedPdf.path });
      } },
      { id: 'remove-translated-pdf', label: l('移除译版 PDF', 'Remove Translated PDF'), icon: <FileText className="h-4 w-4" />, tone: 'danger' as const, disabled: !onRemoveTranslatedPdf, onSelect: () => onRemoveTranslatedPdf?.(paper) },
    ] : []),
  ];

  return (
    <div className="rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip label={l('知识库', 'Knowledge')} done={ragDone} error={ragStatus === 'failed'} disabled={anyTaskRunning && !ragDone} icon={<Database className="h-3.5 w-3.5" />} onClick={(button) => {
          if (!ragDone && onIndexPaperRag) onIndexPaperRag(paper);
          else showMenu(button, ragEntries);
        }} />
        <StatusChip label="MinerU" done={mineruDone} running={mineruTask?.status === 'running'} error={mineruTask?.status === 'error'} disabled={!mineruDone && (anyTaskRunning || !onRunMineruParse)} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={(button) => runOrMenu(button, mineruDone, mineruTask?.status === 'running', onRunMineruParse ? () => onRunMineruParse(paper) : undefined, 'MinerU')} />
        <StatusChip label={l('全文翻译', 'Translation')} done={translationDone} running={translationTask?.status === 'running'} error={translationTask?.status === 'error'} disabled={!translationDone && (anyTaskRunning || !onTranslatePaper)} icon={<Languages className="h-3.5 w-3.5" />} onClick={(button) => runOrMenu(button, translationDone, translationTask?.status === 'running', onTranslatePaper ? () => onTranslatePaper(paper) : undefined, l('全文翻译', 'translation'))} />
        <StatusChip label={l('AI 概览', 'AI Overview')} done={overviewDone} running={overviewTask?.status === 'running'} error={overviewTask?.status === 'error'} disabled={!overviewDone && (anyTaskRunning || !onGenerateSummary)} icon={<FileText className="h-3.5 w-3.5" />} onClick={(button) => runOrMenu(button, overviewDone, overviewTask?.status === 'running', onGenerateSummary ? () => onGenerateSummary(paper) : undefined, l('概览', 'Overview'))} />
        <StatusChip label={translatedPdf ? translatedPdf.attachment.language || l('译版 PDF', 'Translated PDF') : l('译版 PDF', 'Translated PDF')} done={Boolean(translatedPdf)} icon={<Languages className="h-3.5 w-3.5" />} onClick={(button) => showMenu(button, translatedEntries)} />
      </div>
      {actionState ? (
        <div className="mt-2 border-t border-[var(--pq-border-subtle)] pt-2">
          <div className="flex items-center gap-2 text-xs text-[var(--pq-text-muted)]">
            {actionState.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--pq-accent)]" /> : actionState.status === 'success' ? <Check className="h-3.5 w-3.5 text-[var(--pq-success)]" /> : <Sparkles className="h-3.5 w-3.5 text-[var(--pq-danger)]" />}
            <span className="min-w-0 flex-1 truncate">{actionState.message || actionState.label}</span>
            {progress?.countText ? <span className="shrink-0 tabular-nums">{progress.countText}</span> : null}
          </div>
          {progress?.showProgressBar ? (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--pq-surface-3)]">
              <div className={["h-full rounded-full transition-all", progress.indeterminate ? 'animate-pulse' : ''].join(' ')} style={{ width: `${progress.percent}%`, backgroundColor: actionState.status === 'error' ? 'var(--pq-danger)' : actionState.status === 'success' ? 'var(--pq-success)' : 'var(--pq-accent)' }} />
            </div>
          ) : null}
        </div>
      ) : null}
      {openMenu ? <Menu x={openMenu.x} y={openMenu.y} entries={openMenu.entries} onClose={() => { setOpenMenu(null); openMenu.anchor.focus(); }} keyboardAnchor={openMenu.anchor} width={236} /> : null}
    </div>
  );
}
