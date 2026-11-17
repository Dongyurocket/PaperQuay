import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FileJson, Languages, RefreshCw, Sparkles } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { Menu, type MenuEntry } from '../../../ui/menu';
import { confirmAction } from '../../../ui/confirmHost';
import { toast } from '../../../ui/toast';
import { deriveOverviewTask, type OverviewTaskInput } from './overviewTaskState';

export function OverviewProcessMenu({ tasks, cancelling, aiConfigured, summarySourceReady, onParse, onReparse, onTranslate, onCancelTranslate, onGenerate, onOpenJson }: {
  tasks: OverviewTaskInput;
  cancelling: boolean;
  aiConfigured: boolean;
  summarySourceReady: boolean;
  onParse: () => void | Promise<void>;
  onReparse: () => void | Promise<void>;
  onTranslate: () => void | Promise<void>;
  onCancelTranslate: () => void;
  onGenerate: (options?: { force?: boolean }) => void | Promise<void>;
  onOpenJson: () => void | Promise<void>;
}) {
  const l = useLocaleText();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const pendingRef = useRef(false);
  // The parent keys this component by document; each effect setup has its own lifetime.
  const mounted = useRef<object | null>(null);
  useEffect(() => {
    const lifetime = {};
    mounted.current = lifetime;
    return () => { mounted.current = null; };
  }, []);
  const taskBusy = tasks.loading || tasks.translating || tasks.summaryLoading || tasks.operation?.status === 'running';
  // Callback-only rerenders keep the confirmation valid. Task/eligibility transitions do not,
  // including a running task that finishes before the user approves the old dialog.
  const scope = useMemo(() => ({}), [tasks.operation, tasks.loading, tasks.translating, tasks.summaryLoading,
    tasks.blockCount, tasks.translatedCount, tasks.translationCompleted, tasks.translationTotal,
    tasks.hasSummary, tasks.summaryError, aiConfigured, summarySourceReady]);
  const latest = useRef({ scope, taskBusy, tasks, aiConfigured, summarySourceReady, onParse, onReparse, onTranslate, onGenerate, onOpenJson });
  latest.current = { scope, taskBusy, tasks, aiConfigured, summarySourceReady, onParse, onReparse, onTranslate, onGenerate, onOpenJson };
  const runAction = async (action: 'parse' | 'reparse' | 'translate' | 'summary' | 'open-json') => {
    const lifetime = mounted.current;
    const requested = latest.current;
    if (!lifetime || pendingRef.current || requested.scope !== scope || requested.taskBusy) return;
    if (action === 'summary' && (!requested.aiConfigured || !requested.summarySourceReady)) return;
    if (action === 'translate' && requested.tasks.blockCount === 0) return;
    pendingRef.current = true;
    setActionPending(true);
    try {
      if (action === 'summary' && requested.tasks.hasSummary) {
        if (!(await confirmAction({ title: l('重新生成概览？', 'Regenerate overview?'), description: l('将重新调用模型并消耗额度。生成成功前保留当前概览。', 'This calls the model again and consumes quota. The current overview stays visible until generation succeeds.'), confirmLabel: l('重新生成', 'Regenerate') }))) return;
      } else if (action === 'reparse') {
        if (!(await confirmAction({ title: l('重新识别文档？', 'Re-parse document?'), description: l('将忽略解析缓存，重新上传 PDF 并消耗解析额度。', 'This ignores the parse cache, uploads the PDF again and consumes parsing quota.'), confirmLabel: l('重新识别', 'Re-parse') }))) return;
      }
      const current = latest.current;
      if (mounted.current !== lifetime || current.scope !== requested.scope || current.taskBusy) return;
      if (action === 'summary') {
        if (!current.aiConfigured || !current.summarySourceReady) return;
        await current.onGenerate({ force: current.tasks.hasSummary });
      } else if (action === 'reparse') await current.onReparse();
      else if (action === 'parse') await current.onParse();
      else if (action === 'open-json') await current.onOpenJson();
      else if (current.tasks.blockCount > 0) await current.onTranslate();
    } catch (cause) {
      if (mounted.current === lifetime) toast({ tone: 'error', message: cause instanceof Error && cause.message
        ? cause.message : l('处理失败，请重试。', 'Processing failed. Please try again.') });
    } finally {
      pendingRef.current = false;
      if (mounted.current === lifetime) setActionPending(false);
    }
  };
  const busy = taskBusy || actionPending;
  const status = (kind: 'mineru' | 'translation' | 'overview') => {
    const task = deriveOverviewTask(kind, tasks);
    const label = task.status === 'running' ? l('进行中', 'Running')
      : task.status === 'success' ? l('已完成', 'Completed')
      : task.status === 'error' ? l('失败', 'Failed') : l('未开始', 'Not started');
    return `${label}${task.status === 'running' && task.progress.countText ? ` ${task.progress.countText}` : ''}`;
  };
  const entries: MenuEntry[] = [
    { id: 'parse', label: `${l('MinerU 解析', 'MinerU Parse')} · ${status('mineru')}`, icon: <Sparkles className="h-4 w-4" />, disabled: busy, onSelect: () => runAction('parse') },
    { id: 'translate', label: `${l('全文翻译', 'Full Translation')} · ${status('translation')}`, icon: <Languages className="h-4 w-4" />, disabled: busy || tasks.blockCount === 0, onSelect: () => runAction('translate') },
    ...(tasks.translating ? [{ id: 'cancel-translation', label: cancelling ? l('取消中…', 'Cancelling…') : l('取消翻译', 'Cancel Translation'), disabled: cancelling, onSelect: onCancelTranslate }] : []),
    { id: 'summary', label: `${tasks.hasSummary ? l('重新生成概览', 'Regenerate Overview') : l('生成概览', 'Generate Overview')} · ${status('overview')}`, icon: <RefreshCw className="h-4 w-4" />, disabled: busy || !aiConfigured || !summarySourceReady, onSelect: () => runAction('summary') },
    { type: 'separator', id: 'parse-options' },
    { id: 'open-json', label: l('打开 MinerU JSON', 'Open MinerU JSON'), icon: <FileJson className="h-4 w-4" />, disabled: busy, onSelect: () => runAction('open-json') },
    { id: 'reparse', label: l('重新识别…', 'Re-parse…'), icon: <RefreshCw className="h-4 w-4" />, disabled: busy, onSelect: () => runAction('reparse') },
  ];
  return <span data-tour="overview-mineru-parse" className="inline-flex">
    <span data-tour="overview-translate-document" className="inline-flex">
      <button type="button" className="pq-button !h-9 !rounded-[var(--pq-radius-sm)] px-3 text-sm" aria-label={l('处理', 'Process')} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
        {l('处理', 'Process')}<ChevronDown className="h-4 w-4" />
      </button>
    </span>
    {anchor ? <Menu x={anchor.getBoundingClientRect().left} y={anchor.getBoundingClientRect().bottom + 4} width={320} entries={entries} keyboardAnchor={anchor} onClose={() => setAnchor(null)} /> : null}
  </span>;
}
