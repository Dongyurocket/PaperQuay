import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  Camera,
  BookOpen,
  Archive,
  ChevronDown,
  Check,
  Clipboard,
  GitFork,
  ImagePlus,
  Loader2,
  Paperclip,
  PlayCircle,
  RotateCcw,
  Search,
  User,
  X,
} from 'lucide-react';
import type { LibraryAgentFigureReference, LibraryAgentPlan, LibraryAgentRagCitation } from '../../services/libraryAgent';
import type { AgentMemoryWritePlan } from '../../services/agentMemory';
import type { AgentNoteWritePlan } from '../../services/agentNotePlan';
import type { DeliveryQualityIssue, DeliveryQualityResult } from '../../services/agentDeliveryQuality';
import type { AgentCapabilityView } from './AgentWorkspace.types';
import { getAgentCapability } from '../../services/agentCapabilityRegistry';
import { normalizeSurveyCoverageLedger, summarizeSurveyCoverage, type SurveyCoverageStopReason } from '../../services/agentSurveyCoverage';
import type { LiteraturePaper } from '../../types/library';
import type { UiLanguage } from '../../types/reader';
import type { AgentChatMessage, AgentToolCallView } from './AgentWorkspace.types';
import AgentMarkdown from './AgentMarkdown';
import AgentCitationEvidence from './AgentCitationEvidence';
import AgentAnswerReferences from './AgentAnswerReferences';
import { buildAgentAnswerReferences, type AgentCitationClick } from './agentCitationRendering.ts';
import { PlanDiffCard, ToolCallCard, TraceTimeline } from './AgentExecutionCards';
import { loadLocalAssetDataUrl } from '../../services/assets';
import { formatFileSize } from '../../utils/files';

const agentPlanPrimaryActionClass =
  'inline-flex items-center gap-2 rounded-2xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:border-emerald-700 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700 disabled:shadow-none dark:border-emerald-400 dark:bg-emerald-400 dark:text-slate-950 dark:hover:border-emerald-300 dark:hover:bg-emerald-300 dark:disabled:border-emerald-400/20 dark:disabled:bg-emerald-400/10 dark:disabled:text-emerald-200/70';
const agentPlanSecondaryActionClass =
  'inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none dark:border-white/14 dark:bg-chrome-900 dark:text-chrome-100 dark:hover:border-white/24 dark:hover:bg-chrome-800 dark:disabled:border-white/10 dark:disabled:bg-white/8 dark:disabled:text-chrome-500';

function PaperSelectionRequestCard({
  activeSessionRunning,
  formatPaperMeta,
  l,
  loading,
  locale,
  message,
  onContinueWithSelectedPapers,
  papers,
}: {
  activeSessionRunning: boolean;
  formatPaperMeta: (paper: LiteraturePaper, locale: UiLanguage) => string;
  l: (zh: string, en: string) => string;
  loading: boolean;
  locale: UiLanguage;
  message: AgentChatMessage;
  onContinueWithSelectedPapers: (instruction: string, paperIds: string[]) => void;
  papers: LiteraturePaper[];
}) {
  const request = message.paperSelectionRequest;
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [localSelectedPaperIds, setLocalSelectedPaperIds] = useState<Set<string>>(() => new Set());
  const visiblePapers = useMemo(() => {
    const normalizedQuery = localSearchQuery.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return papers;
    }

    return papers.filter((paper) =>
      [
        paper.title,
        paper.year,
        paper.publication,
        paper.doi,
        paper.url,
        paper.abstractText,
        paper.authors.map((author) => author.name).join(' '),
        paper.keywords.join(' '),
        paper.tags.map((tag) => tag.name).join(' '),
      ]
        .filter(Boolean)
        .join('\n')
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [localSearchQuery, papers]);

  if (!request) {
    return null;
  }

  const toggleLocalPaper = (paperId: string) => {
    setLocalSelectedPaperIds((current) => {
      const next = new Set(current);

      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }

      return next;
    });
  };

  return (
    <div className="mt-4 overflow-hidden rounded-[var(--pq-radius-lg)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--pq-border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--pq-text)]">
            <BookOpen className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />
            {l('选择要提供给模型的论文', 'Choose papers for the model')}
            <span className="rounded-full bg-[var(--pq-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--pq-accent)]">
              {request.mode === 'pdf-text' ? 'PDF text' : 'Summary'}
            </span>
          </div>
          <div className="mt-1 max-w-2xl text-xs leading-5 text-[var(--pq-text-muted)]">
            {request.reason}
          </div>
        </div>
        <div className="text-xs font-semibold text-[var(--pq-text-faint)]">
          {localSelectedPaperIds.size}/{papers.length}
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="pq-input flex min-w-[220px] flex-1 items-center gap-2 px-3 py-2 text-sm text-[var(--pq-text-muted)]">
            <Search className="h-4 w-4 shrink-0 text-[var(--pq-text-faint)]" strokeWidth={2} />
            <input
              value={localSearchQuery}
              onChange={(event) => setLocalSearchQuery(event.target.value)}
              placeholder={l('搜索标题、作者、年份、标签...', 'Search title, author, year, tags...')}
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]"
            />
          </label>
          <button
            type="button"
            onClick={() => setLocalSelectedPaperIds(new Set(visiblePapers.map((paper) => paper.id)))}
            disabled={activeSessionRunning || visiblePapers.length === 0}
            className="pq-button px-3 py-2 text-xs disabled:opacity-50"
          >
            {l('选择当前结果', 'Select Results')}
          </button>
          <button
            type="button"
            onClick={() => setLocalSelectedPaperIds(new Set())}
            disabled={activeSessionRunning || localSelectedPaperIds.size === 0}
            className="pq-button px-3 py-2 text-xs disabled:opacity-50"
          >
            {l('清空', 'Clear')}
          </button>
        </div>

        <div
          data-wheel-scroll-target
          className="max-h-72 overflow-y-auto overscroll-y-contain rounded-[var(--pq-radius-md)] border border-[var(--pq-border-subtle)] bg-[var(--pq-surface)]"
        >
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-[var(--pq-text-muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
              {l('正在加载文库...', 'Loading library...')}
            </div>
          ) : papers.length === 0 ? (
            <div className="p-4 text-sm leading-6 text-[var(--pq-text-muted)]">
              {l('当前文库为空。先导入 PDF 后，再把论文提供给 Agent。', 'The library is empty. Import PDFs before providing papers to the Agent.')}
            </div>
          ) : visiblePapers.length === 0 ? (
            <div className="p-4 text-sm leading-6 text-[var(--pq-text-muted)]">
              {l('没有匹配的论文。换一个关键词再试。', 'No matching papers. Try another keyword.')}
            </div>
          ) : (
            <div className="divide-y divide-[var(--pq-border-subtle)]">
              {visiblePapers.map((paper) => {
                const selected = localSelectedPaperIds.has(paper.id);

                return (
                  <button
                    key={paper.id}
                    type="button"
                    onClick={() => toggleLocalPaper(paper.id)}
                    disabled={activeSessionRunning}
                    className={[
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition disabled:opacity-60',
                      selected ? 'bg-[var(--pq-accent-soft)]' : 'hover:bg-[var(--pq-surface-2)]',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                        selected
                          ? 'border-[var(--pq-accent)] bg-[var(--pq-accent)] text-white'
                          : 'border-[var(--pq-border-strong)] bg-[var(--pq-surface)] text-transparent',
                      ].join(' ')}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--pq-text)]">
                        {paper.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--pq-text-muted)]">
                        {formatPaperMeta(paper, locale) || l('暂无元数据', 'No metadata')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--pq-text-faint)]">
            {l('选中后会继续同一条任务，不会立即修改本地文库。', 'After selection, the same task continues. Local library writes still require approval.')}
          </div>
          <button
            type="button"
            onClick={() => onContinueWithSelectedPapers(request.instruction, [...localSelectedPaperIds])}
            disabled={activeSessionRunning || localSelectedPaperIds.size === 0}
            className="pq-button-primary px-4 py-2 text-sm disabled:opacity-50"
          >
            <PlayCircle className="h-4 w-4" />
            {l('继续', 'Continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssistantThinkingBlock({
  l,
  thinking,
}: {
  l: (zh: string, en: string) => string;
  thinking: string;
}) {
  if (!thinking.trim()) {
    return null;
  }

  return (
    <details open className="group mt-3 rounded-2xl border border-[var(--pq-border-subtle)] bg-[var(--pq-surface-1)] px-3 py-2">
      <summary className="flex select-none items-center gap-1.5 text-xs font-medium text-[var(--pq-text-muted)] outline-none">
        <span>{l('思考过程', 'Reasoning')}</span>
        <ChevronDown
          className="h-3.5 w-3.5 text-[var(--pq-text-faint)] transition-transform group-open:rotate-180"
          strokeWidth={2}
        />
      </summary>
      <div className="mt-2 border-l border-[var(--pq-border)] pl-3 text-[13px] leading-6 text-[var(--pq-text-muted)]">
        <div className="whitespace-pre-wrap">{thinking}</div>
      </div>
    </details>
  );
}


function AgentFigureReferences({
  figures,
  l,
}: {
  figures?: LibraryAgentFigureReference[];
  l: (zh: string, en: string) => string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<LibraryAgentFigureReference | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.all((figures ?? []).map(async (figure) => {
      try {
        return [figure.id, await loadLocalAssetDataUrl(figure.path)] as const;
      } catch {
        return [figure.id, ''] as const;
      }
    })).then((entries) => {
      if (!cancelled) setUrls(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [figures]);

  if (!figures?.length) return null;

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {figures.map((figure) => (
          <button
            key={figure.id}
            type="button"
            onClick={() => setPreview(figure)}
            className="flex max-w-[260px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 text-left dark:border-white/10 dark:bg-chrome-950"
          >
            {urls[figure.id] ? (
              <img src={urls[figure.id]} alt={figure.caption} className="h-12 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-[10px] text-slate-500 dark:bg-white/10 dark:text-chrome-400">
                {figure.kind === 'table' ? l('表', 'Table') : l('图', 'Figure')}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-slate-700 dark:text-chrome-200">{figure.paperTitle}</span>
              <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-slate-500 dark:text-chrome-400">{figure.caption}</span>
            </span>
          </button>
        ))}
      </div>
      {preview && urls[preview.id] && typeof document !== 'undefined'
        ? createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-6" onClick={() => setPreview(null)}>
            <div className="max-h-full max-w-5xl overflow-auto" onClick={(event) => event.stopPropagation()}>
              <img src={urls[preview.id]} alt={preview.caption} className="max-h-[80vh] max-w-full object-contain" />
              <div className="bg-white p-3 text-sm text-slate-700 dark:bg-chrome-900 dark:text-chrome-200">{preview.caption}</div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

function CapabilityProgress({
  capability,
  l,
}: {
  capability: AgentCapabilityView;
  l: (zh: string, en: string) => string;
}) {
  const definition = getAgentCapability(capability.id);
  const title = definition ? l(definition.title['zh-CN'], definition.title['en-US']) : l('对比调研', 'Comparative Survey');

  const labels: Record<string, [string, string]> = {
    rephrase: ['改写问题', 'Rephrase'],
    decompose: ['分解子题', 'Decompose'],
    research: ['逐题调研', 'Research'],
    report: ['综合报告', 'Report'],
    extract: ['抽取主张', 'Extract'],
    retrieve: ['证据检索', 'Retrieve'],
    judge: ['判定支持', 'Judge'],
    collect: ['收集上下文', 'Collect'],
    draft: ['提炼草稿', 'Draft'],
    plan: ['生成计划', 'Plan'],
    neighbors: ['邻域探索', 'Neighbors'],
    gaps: ['发现缺边', 'Missing Edges'],
    topics: ['概念主题', 'Topics'],
  };

  const getStageTitle = (stageId: string) => {
    const pair = labels[stageId];
    if (pair) return l(pair[0], pair[1]);
    return stageId.charAt(0).toUpperCase() + stageId.slice(1);
  };
  const statusLabel = capability.status === 'running'
    ? l('执行中', 'Running')
    : capability.status === 'done'
      ? l('执行结束', 'Finished')
      : capability.status === 'partial'
        ? l('部分完成', 'Partial')
        : capability.status === 'aborted'
          ? l('已取消', 'Cancelled')
          : l('未完成', 'Failed');

  return (
    <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-chrome-950/60">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-slate-950 dark:text-white">
          {title}
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-chrome-400">{statusLabel}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {capability.stages.map((stage, index) => (
          <div key={stage.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-chrome-900">
            <div className="flex items-center gap-2">
              <span className={[
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                stage.status === 'success'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-300/15 dark:text-emerald-200'
                  : stage.status === 'running'
                    ? 'bg-sky-100 text-sky-700 dark:bg-sky-300/15 dark:text-sky-200'
                    : stage.status === 'error'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-300/15 dark:text-rose-200'
                      : stage.status === 'warning'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-300/15 dark:text-amber-200'
                        : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-chrome-400',
              ].join(' ')}>{index + 1}</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-chrome-200">
                {getStageTitle(stage.id)}
              </span>
            </div>
            {stage.detail ? <div className="mt-1 line-clamp-2 text-[10px] text-slate-400">{stage.detail}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeliveryQualitySummary({
  quality,
  l,
}: {
  quality: DeliveryQualityResult;
  l: (zh: string, en: string) => string;
}) {
  const stateLabel = quality.state === 'complete'
    ? l('交付检查：未发现结构缺项', 'Delivery check: no structural gaps found')
    : quality.state === 'partial'
      ? l('交付检查：部分完成', 'Delivery check: partial')
      : l('交付检查：未完成', 'Delivery check: failed');
  const stateClass = quality.state === 'complete'
    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:text-emerald-200'
    : quality.state === 'partial'
      ? 'border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200'
      : 'border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-300/25 dark:bg-rose-300/10 dark:text-rose-200';
  const issueLabel = (item: DeliveryQualityIssue) => {
    const labels: Record<DeliveryQualityIssue['code'], [string, string]> = {
      'empty-answer': ['回答为空', 'Answer is empty'],
      'missing-section': ['缺少要求的章节', 'Required section is missing'],
      'unfinished-content': ['包含未完成内容', 'Unfinished content detected'],
      'internal-protocol-leak': ['发现内部引用协议', 'Internal citation protocol detected'],
      'incomplete-run': ['运行未完整收敛', 'Run did not complete'],
      'engineering-structure-gap': ['工程条件说明不完整', 'Engineering conditions are incomplete'],
      'missing-conditionality': ['建议缺少适用条件', 'Recommendation lacks conditions'],
      'unbounded-research-gap': ['研究空白表述过强', 'Research-gap wording is too broad'],
      'missing-evidence-boundary': ['证据边界未明确', 'Evidence boundary is unclear'],
      'coverage-gap': ['仍有候选文献待处理', 'Candidate papers remain pending'],
    };
    return l(item.message, `${labels[item.code][1]}${item.section ? ` · ${item.section}` : ''}`);
  };
  const issues = quality.issues.slice(0, 2);

  return (
    <div className={`mt-4 rounded-2xl border px-4 py-3 text-xs ${stateClass}`}>
      <div className="font-bold">{stateLabel}</div>
      {issues.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 leading-5">
          {issues.map((item, index) => (
            <li key={`${item.code}:${index}`}>
              {issueLabel(item)}
            </li>
          ))}
        </ul>
      ) : null}
      {quality.issues.length > issues.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold">{l(`查看其余 ${quality.issues.length - issues.length} 项`, `Show ${quality.issues.length - issues.length} more issues`)}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 leading-5">
            {quality.issues.slice(issues.length).map((item, index) => <li key={`${item.code}:more:${index}`}>{issueLabel(item)}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function SurveyCoverageCard({
  capability,
  disabled,
  l,
  onContinue,
}: {
  capability: AgentCapabilityView;
  disabled: boolean;
  l: (zh: string, en: string) => string;
  onContinue?: () => void;
}) {
  if (capability.id !== 'comparative-survey') return null;
  const artifacts = capability.artifacts && typeof capability.artifacts === 'object'
    ? capability.artifacts as { coverage?: unknown }
    : undefined;
  const coverage = normalizeSurveyCoverageLedger(artifacts?.coverage);
  if (!coverage || coverage.papers.length === 0) return (
    <div className="mt-3 text-xs text-slate-500 dark:text-chrome-400">
      {capability.status === 'running' ? l('覆盖情况：等待本轮记录。', 'Coverage: awaiting this run’s records.') : l('覆盖情况：未记录，无法推定已读数量。', 'Coverage: not recorded; reading counts are unknown.')}
    </div>
  );
  const summary = summarizeSurveyCoverage(coverage);
  const counts: Array<[string, string, number]> = [
    ['候选', 'Candidates', summary.candidateCount],
    ['摘要已看', 'Abstracts reviewed', summary.abstractReviewedCount],
    ['正文已检索', 'Body searched', summary.bodySearchedCount],
    ['重点正文已读', 'Focused reading', summary.focusedReadCount],
    ['实际引用', 'Cited', summary.citedCount],
    ['无关', 'Irrelevant', summary.irrelevantCount],
    ['证据未解决', 'Unresolved evidence', summary.unresolvedCount],
    ['检索空命中', 'Empty retrieval', summary.emptyHitCount],
    ['无正文或未解析', 'Body unavailable', summary.unreadableCount],
    ['正文检索失败', 'Body retrieval failed', summary.retrievalFailedCount],
    ['处理失败', 'Processing failed', summary.failedCount],
    ['待处理', 'Pending', summary.pendingCount],
  ];
  const stopLabels: Record<SurveyCoverageStopReason, [string, string]> = {
    completed: ['检索计划已完成', 'Research plan completed'],
    'budget-time': ['达到时间预算', 'Time budget reached'],
    'budget-tokens': ['达到 token 预算', 'Token budget reached'],
    'budget-papers': ['达到本批文献预算', 'Paper batch budget reached'],
    'budget-subquestions': ['达到子问题预算', 'Subquestion budget reached'],
    cancelled: ['用户取消', 'Cancelled'],
    error: ['执行失败', 'Execution failed'],
    unknown: ['停止原因未记录', 'Stop reason unknown'],
  };
  const { budget } = coverage;
  const measuredTokens = budget.promptTokens + budget.completionTokens;
  const executionTokens = measuredTokens - (budget.execution?.promptTokenBaseline ?? 0) - (budget.execution?.completionTokenBaseline ?? 0);
  const executionMilliseconds = budget.elapsedMilliseconds - (budget.execution?.elapsedBaseline ?? 0);
  const continueDelivery = summary.canResume || coverage.runState === 'partial' || coverage.runState === 'failed' || coverage.runState === 'cancelled';
  const evidenceGaps = coverage.subquestions.flatMap((question) => question.evidenceGaps.map((gap) => ({ question: question.question, gap })));
  const unresolvedLabels = {
    'no-document': ['无正文来源', 'No body source'],
    'unreadable-document': ['正文尚未解析或无法读取', 'Body is unparsed or unreadable'],
    'no-hit': ['检索空命中', 'Empty retrieval'],
    'no-citable-evidence': ['未取得可引用正文证据', 'No citable body evidence'],
  } as const;
  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white/70 p-4 text-xs dark:border-white/10 dark:bg-chrome-950/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-900 dark:text-white">{l('本轮调研覆盖（篇）', 'Research coverage (papers)')}</span>
        <span className="text-slate-500 dark:text-chrome-400">{coverage.stopReason ? l(...stopLabels[coverage.stopReason]) : l('检索进行中', 'Research in progress')}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {counts.map(([zh, en, count]) => <div key={en} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/5">
          <dt className="text-slate-500 dark:text-chrome-400">{l(zh, en)}</dt>
          <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{count}</dd>
        </div>)}
      </dl>
      <div className="mt-3 space-y-1 leading-5 text-slate-600 dark:text-chrome-300">
        <div>{l(`子问题完成 ${summary.completedSubquestionCount}/${summary.subquestionCount}，部分完成 ${summary.partialSubquestionCount}，失败 ${summary.failedSubquestionCount}，待处理 ${summary.pendingSubquestionCount}。`, `Subquestions: ${summary.completedSubquestionCount}/${summary.subquestionCount} completed, ${summary.partialSubquestionCount} partial, ${summary.failedSubquestionCount} failed, ${summary.pendingSubquestionCount} pending.`)}</div>
        <div>{l(`累计已记录用量 ${measuredTokens} tokens、${(budget.elapsedMilliseconds / 1000).toFixed(1)} 秒。`, `Recorded cumulative usage: ${measuredTokens} tokens, ${(budget.elapsedMilliseconds / 1000).toFixed(1)} seconds.`)}</div>
        <div>{l(`本次执行 ${Math.max(0, executionTokens)}${budget.maxTokens === undefined ? '' : `/${budget.maxTokens}`} tokens、${(Math.max(0, executionMilliseconds) / 1000).toFixed(1)}${budget.maxMilliseconds === undefined ? '' : `/${(budget.maxMilliseconds / 1000).toFixed(1)}`} 秒。`, `This execution: ${Math.max(0, executionTokens)}${budget.maxTokens === undefined ? '' : `/${budget.maxTokens}`} tokens, ${(Math.max(0, executionMilliseconds) / 1000).toFixed(1)}${budget.maxMilliseconds === undefined ? '' : `/${(budget.maxMilliseconds / 1000).toFixed(1)}`} seconds.`)}</div>
        <div>{l('各项记录可重叠。正文切片命中只计为检索；重点阅读与全文通读不同。', 'These records can overlap. A body hit counts as retrieval; focused reading does not mean the entire paper was read.')}</div>
      </div>
      {coverage.subquestions.length > 0 || summary.pendingCount || summary.failedCount || summary.unresolvedCount ? (
        <details className="mt-3 text-slate-600 dark:text-chrome-300">
          <summary className="cursor-pointer font-semibold">{l('查看子问题与待处理项', 'Show subquestions and remaining work')}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 leading-5">
            {coverage.subquestions.map((question) => <li key={question.id} className="break-words">{question.question} · {l(`检索 ${question.completedPaperIds.length}/${question.candidatePaperIds.length} 篇`, `${question.completedPaperIds.length}/${question.candidatePaperIds.length} papers searched`)}</li>)}
            {evidenceGaps.map((item, index) => <li key={`gap:${index}`} className="break-words">{item.question} · {item.gap}</li>)}
            {coverage.papers.filter((paper) => paper.failed || paper.unresolved || (!paper.focusedRead && !paper.irrelevant)).map((paper) => <li key={paper.paperId} className="break-words">{paper.paperTitle || paper.paperId} · {paper.unresolvedReason ? l(unresolvedLabels[paper.unresolvedReason][0], unresolvedLabels[paper.unresolvedReason][1]) : paper.failed ? l('处理失败', 'Processing failed') : paper.unresolved ? l('未取得正文证据', 'Body evidence unavailable') : l('待处理', 'Pending')}{paper.error ? ` · ${paper.error}` : ''}</li>)}
          </ul>
        </details>
      ) : null}
      {onContinue && continueDelivery && capability.status !== 'running' ? (
        <button type="button" onClick={onContinue} disabled={disabled} className={`${agentPlanSecondaryActionClass} mt-3`}>
          <PlayCircle className="h-4 w-4" />{l('从本轮记录继续', 'Continue from these records')}
        </button>
      ) : null}
    </div>
  );
}

export function UserMessageCard({ message }: { message: AgentChatMessage }) {
  return (
    <article className="flex items-start justify-end gap-3">
      <div className="max-w-[72%] rounded-[24px] border border-teal-300 bg-teal-600 px-4 py-3 text-sm leading-7 text-white shadow-[0_18px_40px_rgba(20,184,166,0.18)] dark:border-teal-300/30 dark:bg-teal-300 dark:text-slate-950">
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {message.attachments && message.attachments.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.attachments.map((attachment) => {
              const AttachmentIcon =
                attachment.kind === 'image'
                  ? ImagePlus
                  : attachment.kind === 'screenshot'
                    ? Camera
                    : Paperclip;

              return (
                <span
                  key={attachment.id}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-teal-50 dark:border-slate-900/10 dark:bg-slate-950/10 dark:text-slate-800"
                >
                  <AttachmentIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span className="max-w-[180px] truncate">{attachment.name}</span>
                  <span className="text-teal-50/80 dark:text-slate-700">{formatFileSize(attachment.size)}</span>
                </span>
              );
            })}
          </div>
        ) : null}
        {message.meta ? (
          <div className="mt-2 text-xs text-teal-50/85 dark:text-slate-700">{message.meta}</div>
        ) : null}
      </div>
      <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-lg dark:bg-chrome-900 dark:text-chrome-100">
        <User className="h-4 w-4" strokeWidth={2} />
      </span>
    </article>
  );
}

export function AssistantMessageCard({
  activeSessionRunning,
  approvedItemIds,
  applyingPlan,
  composerValue,
  expandedStepKeys,
  expandedToolIds,
  formatPaperMeta,
  handleAgentChoice,
  handleModifyPreviousParameters,
  handleRetryAgent,
  isActivePlan,
  l,
  lastInstruction,
  loading,
  locale,
  localizedToolLabel,
  message,
  onApplyPlan,
  onApplyMemoryPlan,
  onRejectMemoryPlan,
  onWriteRejectedClaims,
  onApplyNotePlan,
  onRejectNotePlan,
  onCancelPlan,
  onCopyToolParameters,
  onContinueWithSelectedPapers,
  onContinueSurvey,
  onForkFromMessage,
  onOpenRagCitation,
  onVerifyCitations,
  onInspectPlanItem,
  onTogglePlanItem,
  onToggleStep,
  onToggleTool,
  papers,
  setStatusMessage,
}: {
  activeSessionRunning: boolean;
  approvedItemIds: Set<string>;
  applyingPlan: boolean;
  composerValue: string;
  expandedStepKeys: Set<string>;
  expandedToolIds: Set<string>;
  formatPaperMeta: (paper: LiteraturePaper, locale: UiLanguage) => string;
  handleAgentChoice: (instruction: string, paperScopeIds?: string[]) => void;
  handleModifyPreviousParameters: () => void;
  handleRetryAgent: (instruction: string) => void;
  isActivePlan: boolean;
  l: (zh: string, en: string) => string;
  lastInstruction: string;
  loading: boolean;
  locale: UiLanguage;
  localizedToolLabel: (tool: LibraryAgentPlan['tool']) => string;
  message: AgentChatMessage;
  onApplyPlan: () => void;
  onApplyMemoryPlan: (memoryPlan: AgentMemoryWritePlan) => void;
  onRejectMemoryPlan: (memoryPlan: AgentMemoryWritePlan) => void;
  /** 引用核对「写入工作记忆」入口：点击后生成 merge-rejected-claims 记忆审批卡。 */
  onWriteRejectedClaims?: (message: AgentChatMessage) => void;
  onApplyNotePlan: (notePlan: AgentNoteWritePlan) => void;
  onRejectNotePlan: (notePlan: AgentNoteWritePlan) => void;
  onCancelPlan: () => void;
  onCopyToolParameters: (toolCall: AgentToolCallView) => void;
  onContinueWithSelectedPapers: (instruction: string, paperIds: string[]) => void;
  onContinueSurvey?: (message: AgentChatMessage) => void;
  onForkFromMessage: (messageId: string) => void;
  onOpenRagCitation?: AgentCitationClick;
  onVerifyCitations?: (message: AgentChatMessage) => Promise<void>;
  onInspectPlanItem: (itemId: string, paperTitle: string) => void;
  onTogglePlanItem: (itemId: string) => void;
  onToggleStep: (stepKey: string) => void;
  onToggleTool: (toolCallId: string) => void;
  papers: LiteraturePaper[];
  setStatusMessage: (message: string) => void;
}) {
  const messagePlan = message.plan;
  const memoryPlan = message.memoryPlan;
  const notePlan = message.notePlan;
  const toolCall = message.toolCall;
  const referenceModel = useMemo(() => buildAgentAnswerReferences(message.content, message.ragCitations, message.citationBindings),
    [message.content, message.ragCitations, message.citationBindings]);

  return (
    <article className="flex items-start gap-3">
      <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg dark:bg-teal-300 dark:text-slate-950">
        <Bot className="h-4.5 w-4.5" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1 rounded-[30px] border border-white/80 bg-white/86 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#171d26]/86 dark:shadow-none">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-400">
                Agent Reply
              </span>
              {message.meta ? (
                <span className="text-xs font-semibold text-slate-400 dark:text-chrome-500">
                  {message.meta}
                </span>
              ) : null}
            </div>
            {message.thinking ? (
              <AssistantThinkingBlock l={l} thinking={message.thinking} />
            ) : null}
            <div className="mt-3">
              <AgentMarkdown
                content={message.content}
                citations={message.ragCitations}
                citationBindings={message.citationBindings}
                referenceModel={referenceModel}
                papers={papers}
                onCitationClick={onOpenRagCitation}
              />
            </div>
            <AgentAnswerReferences model={referenceModel} papers={papers} l={l} onOpenCitation={onOpenRagCitation} />
            <AgentCitationEvidence message={message} referenceModel={referenceModel} disabled={activeSessionRunning} onVerify={onVerifyCitations} l={l} />
            {message.ragCitations?.length ? <details className="mt-2 text-xs text-[var(--pq-text-muted)]">
              <summary className="cursor-pointer">{l(`本轮检索材料（${message.ragCitations.length}）`, `Retrieved materials (${message.ragCitations.length})`)}</summary>
              <ul className="mt-2 space-y-1">{message.ragCitations.map((citation) => <li key={citation.id} className="break-words">
                {citation.paperTitle}{citation.pageIndex == null ? '' : ` · ${l('第', 'Page')} ${citation.pageIndex + 1} ${l('页', '')}`}
              </li>)}</ul>
            </details> : null}
            <AgentFigureReferences figures={message.ragFigures} l={l} />
            {message.visionNotice ? (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-700 dark:border-sky-300/20 dark:bg-sky-300/10 dark:text-sky-200">
                {message.visionNotice}
              </div>
            ) : null}
            {message.ragNotice ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200">
                {message.ragNotice}
              </div>
            ) : null}
            {message.capability ? <CapabilityProgress capability={message.capability} l={l} /> : null}
            {message.capability ? <SurveyCoverageCard capability={message.capability} disabled={activeSessionRunning} l={l} onContinue={onContinueSurvey ? () => onContinueSurvey(message) : undefined} /> : null}
            {message.deliveryQuality ? <DeliveryQualitySummary quality={message.deliveryQuality} l={l} /> : null}
            {message.citationAudit && message.citationAudit.rejectedClaimLines.length > 0 && !message.memoryPlan ? (
              <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-300/25 dark:bg-amber-300/10">
                <div className="text-sm font-bold text-slate-950 dark:text-white">
                  {l('发现未被库内证据支持的主张', 'Claims without library evidence found')}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-chrome-300">
                  {l(
                    `引用核对标记了 ${message.citationAudit.rejectedClaimLines.length} 条库内无证据或证据相反的主张。可以把它们合并进工作记忆的 Rejected claims（不影响当前任务段），避免后续回答再次引用。`,
                    `Citation audit flagged ${message.citationAudit.rejectedClaimLines.length} claim(s) with no library evidence or with contradicting evidence. Merge them into the working memory's Rejected claims (your current task stays untouched) so later answers do not cite them again.`,
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onWriteRejectedClaims?.(message)}
                    disabled={activeSessionRunning}
                    className={agentPlanSecondaryActionClass}
                  >
                    <Archive className="h-4 w-4" />
                    {l('写入工作记忆', 'Save to Working Memory')}
                  </button>
                </div>
              </div>
            ) : null}
            {memoryPlan ? (
              <div className="mt-4 rounded-[20px] border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-300/25 dark:bg-sky-300/10">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-slate-950 dark:text-white">
                    {l('Agent 记忆更新', 'Agent Memory Update')}
                  </div>
                  {message.memoryPlanStatus ? (
                    <span className="rounded-full border border-sky-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:border-sky-300/30 dark:bg-sky-300/10 dark:text-sky-200">
                      {message.memoryPlanStatus === 'applied' ? l('已写入', 'Applied') :
                        message.memoryPlanStatus === 'unchanged' ? l('未新增', 'No change') : l('已拒绝', 'Rejected')}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-chrome-300">
                  {memoryPlan.summary}
                </div>
                <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-xl border border-sky-200/80 bg-white/80 p-3 text-xs leading-5 text-slate-700 dark:border-sky-300/20 dark:bg-chrome-950 dark:text-chrome-200">
                  {memoryPlan.content}
                </pre>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onApplyMemoryPlan(memoryPlan)}
                    disabled={activeSessionRunning || Boolean(message.memoryPlanStatus)}
                    className={agentPlanPrimaryActionClass}
                  >
                    <Check className="h-4 w-4" />
                    {message.memoryPlanStatus === 'applied'
                      ? l('已写入', 'Applied')
                      : message.memoryPlanStatus === 'unchanged'
                        ? l('未新增', 'No change')
                      : message.memoryPlanStatus === 'cancelled'
                        ? l('已拒绝', 'Rejected')
                        : l('确认写入', 'Apply Update')}
                  </button>
                  {!message.memoryPlanStatus ? (
                    <button
                      type="button"
                      onClick={() => onRejectMemoryPlan(memoryPlan)}
                      disabled={activeSessionRunning}
                      className={agentPlanSecondaryActionClass}
                    >
                      <X className="h-4 w-4" />
                      {l('拒绝', 'Reject')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {notePlan ? (
              <div className="mt-4 rounded-[20px] border border-teal-200 bg-teal-50/70 p-4 dark:border-teal-300/25 dark:bg-teal-300/10">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-slate-950 dark:text-white">
                    {l('笔记变更计划', 'Note Changes')}
                  </div>
                  {message.notePlanStatus ? (
                    <span className="rounded-full border border-teal-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-teal-700 dark:border-teal-300/30 dark:bg-teal-300/10 dark:text-teal-200">
                      {message.notePlanStatus === 'applied' ? l('已写入', 'Applied') : l('已拒绝', 'Rejected')}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-chrome-300">
                  {notePlan.summary}
                </div>
                <div className="mt-3 grid gap-2">
                  {notePlan.operations.map((operation, index) => (
                    <div
                      key={`${notePlan.id}:${index}`}
                      className="rounded-xl border border-teal-200/80 bg-white/80 p-3 text-xs leading-5 dark:border-teal-300/20 dark:bg-chrome-950"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-teal-700 dark:bg-teal-300/15 dark:text-teal-200">
                          {operation.kind === 'create'
                            ? l('创建', 'Create')
                            : operation.kind === 'update'
                              ? l('更新', 'Update')
                              : l('删除', 'Delete')}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-chrome-100">
                          {operation.title || operation.noteId}
                        </span>
                      </div>
                      {operation.reason ? (
                        <div className="mt-1 text-slate-500 dark:text-chrome-400">{operation.reason}</div>
                      ) : null}
                      {operation.kind !== 'delete' && operation.content ? (
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-slate-700 dark:bg-chrome-900 dark:text-chrome-200">
                          {operation.kind === 'update' && operation.before
                            ? operation.content
                            : operation.content}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onApplyNotePlan(notePlan)}
                    disabled={activeSessionRunning || Boolean(message.notePlanStatus)}
                    className={agentPlanPrimaryActionClass}
                  >
                    <Check className="h-4 w-4" />
                    {message.notePlanStatus === 'applied'
                      ? l('已写入', 'Applied')
                      : message.notePlanStatus === 'cancelled'
                        ? l('已拒绝', 'Rejected')
                        : l('确认写入', 'Apply Changes')}
                  </button>
                  {!message.notePlanStatus ? (
                    <button
                      type="button"
                      onClick={() => onRejectNotePlan(notePlan)}
                      disabled={activeSessionRunning}
                      className={agentPlanSecondaryActionClass}
                    >
                      <X className="h-4 w-4" />
                      {l('拒绝', 'Reject')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {message.choices && message.choices.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {message.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => handleAgentChoice(choice.instruction, message.paperScopeIds)}
                    disabled={activeSessionRunning}
                    className="group rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-left transition hover:border-teal-200 hover:bg-teal-50 disabled:opacity-60 dark:border-white/10 dark:bg-chrome-950/70 dark:hover:border-teal-300/30 dark:hover:bg-teal-300/10"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black text-slate-950 group-hover:text-teal-700 dark:text-white dark:group-hover:text-teal-200">
                        {choice.label}
                      </span>
                      <PlayCircle className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-teal-600 dark:group-hover:text-teal-300" />
                    </div>
                    {choice.description ? (
                      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-chrome-400">
                        {choice.description}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onForkFromMessage(message.id)}
            className="pq-icon-button h-8 w-8 shrink-0 border border-[var(--pq-border)] bg-[var(--pq-surface-1)]"
            title={l('从此处分支', 'Fork from here')}
            aria-label={l('从此处分支', 'Fork from here')}
          >
            <GitFork className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          {messagePlan ? (
            <div className="shrink-0 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-chrome-950/70">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                {l('当前工具', 'Current Tool')}
              </div>
              <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">
                {localizedToolLabel(messagePlan.tool)}
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-400">
                {messagePlan.tool}
              </div>
            </div>
          ) : null}
        </div>

        {message.paperSelectionRequest ? (
          <PaperSelectionRequestCard
            activeSessionRunning={activeSessionRunning}
            formatPaperMeta={formatPaperMeta}
            l={l}
            loading={loading}
            locale={locale}
            message={message}
            onContinueWithSelectedPapers={onContinueWithSelectedPapers}
            papers={papers}
          />
        ) : null}

        {message.trace ? (
          <div className="mt-5">
            <TraceTimeline
              steps={message.trace}
              traceKey={message.id}
              expandedStepKeys={expandedStepKeys}
              onToggleStep={onToggleStep}
            />
          </div>
        ) : null}

        {toolCall ? (
          <div className="mt-4">
            <ToolCallCard
              toolCall={toolCall}
              expanded={expandedToolIds.has(toolCall.id)}
              onToggle={() => onToggleTool(toolCall.id)}
              onCopyParameters={() => onCopyToolParameters(toolCall)}
              onRetry={() => handleRetryAgent(lastInstruction || composerValue)}
            />
          </div>
        ) : null}

        {messagePlan && messagePlan.items.length > 0 ? (
          <div className="mt-4 rounded-[26px] border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-chrome-950/54">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-950 dark:text-white">
                  {l('结果 Diff 预览', 'Result Diff Preview')}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                  {l('原值与新值分开展示，确认前不会写入数据库。', 'Original and new values are shown separately. Nothing is written before confirmation.')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-400">
                  {messagePlan.items.length} changes
                </span>
                {message.planStatus ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-400">
                    {message.planStatus === 'applied' ? l('已执行', 'Applied') : l('已取消', 'Cancelled')}
                  </span>
                ) : null}
              </div>
            </div>
            <div
              data-wheel-scroll-target
              className="grid max-h-[32rem] gap-3 overflow-y-auto overscroll-y-contain pr-1 xl:grid-cols-2"
            >
              {messagePlan.items.map((item) => (
                <PlanDiffCard
                  key={item.id}
                  item={item}
                  approved={isActivePlan && approvedItemIds.has(item.id)}
                  onToggle={() => {
                    if (isActivePlan) {
                      onTogglePlanItem(item.id);
                    } else {
                      setStatusMessage(
                        l(
                          '这是历史计划，只能查看，不能修改审批状态。',
                          'This is a historical plan. You can view it, but cannot change its approval state.',
                        ),
                      );
                    }
                  }}
                  onInspect={() => onInspectPlanItem(item.id, item.paperTitle)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {messagePlan ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApplyPlan}
              disabled={applyingPlan || activeSessionRunning || !isActivePlan || approvedItemIds.size === 0}
              className={agentPlanPrimaryActionClass}
            >
              <PlayCircle className="h-4 w-4" />
              {isActivePlan ? l('确认执行', 'Confirm Execution') : l('历史计划', 'Historical Plan')}
            </button>
            <button
              type="button"
              onClick={handleModifyPreviousParameters}
              className={agentPlanSecondaryActionClass}
            >
              <Clipboard className="h-4 w-4" />
              {l('修改参数', 'Modify Parameters')}
            </button>
            <button
              type="button"
              onClick={onCancelPlan}
              disabled={applyingPlan || activeSessionRunning || !isActivePlan}
              className={agentPlanSecondaryActionClass}
            >
              <X className="h-4 w-4" />
              {l('取消', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={() => handleRetryAgent(lastInstruction)}
              disabled={!lastInstruction || applyingPlan || activeSessionRunning}
              className={agentPlanSecondaryActionClass}
            >
              <RotateCcw className="h-4 w-4" />
              {l('重新生成', 'Regenerate')}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
