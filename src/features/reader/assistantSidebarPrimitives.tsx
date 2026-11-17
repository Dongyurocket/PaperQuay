import { Component, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { Bot, Languages, LoaderCircle, PanelRightClose, Quote, RefreshCw, Settings, Sparkles } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { PaperSummary, SelectedExcerpt } from '../../types/reader';
import { confirmAction } from '../../ui/confirmHost';
import { cn } from '../../utils/cn';
import { normalizeMarkdownMath, remarkFixGluedLatex, remarkSuperscriptPlugin } from '../../utils/markdown';
import { getSummarySectionLabel, parseSummarySections, resolveSummaryPanelState, type SummarySectionKey } from './overview/summarySections';

function SectionCard({
  title,
  description,
  icon,
  children,
  actions,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] shadow-[var(--pq-shadow-soft)]',
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-[var(--pq-border)] px-4 py-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {icon ? (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)]">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-semibold leading-5 text-[var(--pq-text)]">{title}</div>
              {description ? (
                <div className="mt-1 text-xs leading-5 text-[var(--pq-text-muted)]">{description}</div>
              ) : null}
            </div>
          </div>
        </div>
        {actions ? <div className="min-w-0 shrink-0 xl:max-w-[58%]">{actions}</div> : null}
      </div>
      <div className={cn('px-4 py-3', contentClassName)}>{children}</div>
    </section>
  );
}

function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium',
        tone === 'neutral' && 'border-[var(--pq-border)] bg-[var(--pq-surface-2)] text-[var(--pq-text-muted)]',
        tone === 'accent' && 'border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]',
        tone === 'success' && 'border-[color-mix(in_srgb,var(--pq-success)_28%,transparent)] bg-[var(--pq-success-bg)] text-[var(--pq-success)]',
      )}
    >
      {children}
    </span>
  );
}

function HintPanel({
  icon,
  children,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--pq-radius-md)] border border-dashed border-[var(--pq-border)] bg-[var(--pq-surface-2)] p-4 text-sm leading-7 text-[var(--pq-text-muted)]',
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-[var(--pq-text-muted)]">{icon}</div>
      {children}
    </div>
  );
}

function formatMarkdownError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || fallback);
}

class MarkdownRenderBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    resetKey: string;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function MarkdownFallback({
  content,
  error,
}: {
  content: string;
  error?: string;
}) {
  const l = useLocaleText();

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-[var(--pq-radius-md)] border border-[color-mix(in_srgb,var(--pq-warning)_28%,transparent)] bg-[var(--pq-warning-bg)] px-3 py-2 text-xs leading-5 text-[var(--pq-warning)]">
          {l('Markdown 预览暂时无法渲染，已切换为纯文本预览。', 'Markdown preview failed and fell back to plain text.')}
          <div className="mt-1 break-all opacity-80">{error}</div>
        </div>
      ) : null}
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-4 py-3 text-sm leading-7 text-[var(--pq-text-muted)]">
        {content}
      </pre>
    </div>
  );
}

function MarkdownPreview({
  content,
  className,
  normalizeMath = true,
  components,
}: {
  content: string;
  className?: string;
  normalizeMath?: boolean;
  components?: Components;
}) {
  const l = useLocaleText();
  const normalized = useMemo(() => {
    try {
      return {
        content: normalizeMath ? normalizeMarkdownMath(content) : content,
        error: '',
      };
    } catch (error) {
      return {
        content,
        error: formatMarkdownError(error, l('Markdown 渲染失败', 'Markdown rendering failed')),
      };
    }
  }, [content, normalizeMath, l]);

  if (normalized.error) {
    return <MarkdownFallback content={content} error={normalized.error} />;
  }

  const fallback = <MarkdownFallback content={content} />;

  return (
    <MarkdownRenderBoundary resetKey={normalized.content} fallback={fallback}>
      <ReactMarkdown
        className={cn(
          'max-w-none space-y-3 text-sm leading-7 text-[var(--pq-text-muted)]',
          '[&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:border-b [&_h1]:border-[var(--pq-border)] [&_h1]:pb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-[var(--pq-text)]',
          '[&_h2]:mb-2.5 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-[var(--pq-text)]',
          '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--pq-text)]',
          '[&_h4]:mb-1.5 [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-[var(--pq-text)]',
          '[&_p]:my-2 [&_p]:leading-7 [&_strong]:font-semibold [&_strong]:text-[var(--pq-text)] [&_em]:text-[var(--pq-text-muted)]',
          '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-1',
          '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--pq-accent-border)] [&_blockquote]:bg-[var(--pq-accent-soft)] [&_blockquote]:py-2 [&_blockquote]:pl-4 [&_blockquote]:pr-3 [&_blockquote]:text-[var(--pq-text-muted)]',
          '[&_code]:rounded [&_code]:bg-[var(--pq-surface-2)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:text-[var(--pq-accent)]',
          '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-[var(--pq-radius-md)] [&_pre]:border [&_pre]:border-[var(--pq-border)] [&_pre]:bg-[var(--pq-surface-2)] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[var(--pq-text)]',
          '[&_a]:font-medium [&_a]:text-[var(--pq-accent)] [&_a]:underline [&_a]:underline-offset-2',
          '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-[var(--pq-radius-sm)] [&_th]:border [&_th]:border-[var(--pq-border)] [&_th]:bg-[var(--pq-surface-2)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-[var(--pq-border)] [&_td]:px-3 [&_td]:py-2',
          '[&_hr]:my-5 [&_hr]:border-[var(--pq-border)] [&_.katex]:text-[var(--pq-text)] [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2',
          className,
        )}
        remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath, remarkFixGluedLatex, remarkSuperscriptPlugin]}
        rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
        components={{
          sup: ({ children }) => (
            <sup className="align-super text-[0.72em] font-medium leading-none text-[var(--pq-text)] dark:text-[var(--pq-text)]">
              {children}
            </sup>
          ),
          sub: ({ children }) => (
            <sub className="align-sub text-[0.72em] font-medium leading-none text-[var(--pq-text)] dark:text-[var(--pq-text)]">
              {children}
            </sub>
          ),
          ...components,
        }}
      >
        {normalized.content}
      </ReactMarkdown>
    </MarkdownRenderBoundary>
  );
}

export interface SummaryPanelProps {
  paperSummary: PaperSummary | null;
  loading: boolean;
  loadingLabel?: string;
  error: string;
  /** Whether the selected generation source is ready (including PDF text mode). */
  hasBlocks: boolean;
  /** Configuration of the overview model, independent of other AI features. */
  aiConfigured: boolean;
  compact?: boolean;
  onGenerateSummary: (options?: { force?: boolean }) => void | Promise<void>;
  onOpenSettings?: () => void;
}

function SummaryPanel({
  paperSummary,
  loading,
  error,
  hasBlocks,
  aiConfigured,
  compact = false,
  onGenerateSummary,
  onOpenSettings,
  loadingLabel,
}: SummaryPanelProps) {
  const l = useLocaleText();
  const id = useId();
  const [activeTab, setActiveTab] = useState<SummarySectionKey>('overview');
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState('');
  const actionPending = useRef(false);
  // Document-key remounts invalidate the old instance, even if both documents share a summary.
  const mounted = useRef<object | null>(null);
  useEffect(() => {
    const lifetime = {};
    mounted.current = lifetime;
    return () => { mounted.current = null; };
  }, []);
  const scope = useMemo(() => ({}), [paperSummary, loading, hasBlocks, aiConfigured]);
  const latest = useRef({ scope, paperSummary, loading, hasBlocks, aiConfigured, onGenerateSummary });
  latest.current = { scope, paperSummary, loading, hasBlocks, aiConfigured, onGenerateSummary };
  useEffect(() => setActionError(''), [paperSummary]);

  const sections = useMemo(() => parseSummarySections(paperSummary), [paperSummary]);
  const activeSection = sections.find((section) => section.key === activeTab) ?? sections[0];
  const hasContent = sections.length > 0;
  const { status, canGenerate } = resolveSummaryPanelState({ hasContent, loading, hasBlocks, aiConfigured });
  const labels: Record<SummarySectionKey, string> = {
    overview: getSummarySectionLabel('overview', l),
    background: getSummarySectionLabel('background', l),
    problem: getSummarySectionLabel('problem', l),
    approach: getSummarySectionLabel('approach', l),
    experiment: getSummarySectionLabel('experiment', l),
    findings: getSummarySectionLabel('findings', l),
    conclusion: getSummarySectionLabel('conclusion', l),
    limitations: getSummarySectionLabel('limitations', l),
    takeaways: getSummarySectionLabel('takeaways', l),
    keywords: getSummarySectionLabel('keywords', l),
  };
  const keywordCount = paperSummary?.keywords?.filter((keyword) => keyword.trim()).length ?? 0;
  const findingCount = sections.find((section) => section.key === 'findings')?.items?.length ?? 0;
  const generateLabel = loading
    ? loadingLabel || l('生成中…', 'Generating…')
    : hasContent ? l('重新生成', 'Regenerate') : l('生成概览', 'Generate Overview');
  const generateHint = !aiConfigured
    ? l('请先配置概览模型', 'Configure an overview model first')
    : !hasBlocks ? l('请先加载文档内容', 'Load the document content first') : generateLabel;

  const generate = async () => {
    const lifetime = mounted.current;
    const requested = latest.current;
    if (!lifetime || actionPending.current || requested.scope !== scope || requested.loading || !requested.aiConfigured || !requested.hasBlocks) return;
    actionPending.current = true;
    setConfirming(true);
    setActionError('');
    const requestedSummary = requested.paperSummary;
    try {
      if (hasContent) {
        const confirmed = await confirmAction({
          title: l('重新生成概览？', 'Regenerate the overview?'),
          description: l(
            '将重新调用概览模型并消耗额度。生成成功后替换已保存内容；失败时保留原内容。',
            'This calls the overview model again and uses quota. The saved content is replaced on success and kept if generation fails.',
          ),
          confirmLabel: l('重新生成', 'Regenerate'),
          cancelLabel: l('取消', 'Cancel'),
        });
        const current = latest.current;
        if (!confirmed || mounted.current !== lifetime || current.scope !== requested.scope || current.loading || !current.aiConfigured || !current.hasBlocks) return;
        await current.onGenerateSummary({ force: true });
      } else {
        await requested.onGenerateSummary();
      }
    } catch (cause) {
      if (mounted.current === lifetime && latest.current.paperSummary === requestedSummary) {
        setActionError(cause instanceof Error && cause.message
          ? cause.message : l('生成失败，请重试。', 'Generation failed. Please try again.'));
      }
    } finally {
      actionPending.current = false;
      if (mounted.current === lifetime) setConfirming(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] shadow-[var(--pq-shadow-soft)]">
      <div className={cn('flex items-start gap-3 border-b border-[var(--pq-border)] py-3', compact ? 'px-3' : 'px-4')}>
        <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--pq-accent)]" strokeWidth={1.8} />
        <div className={cn('min-w-0 flex-1', !compact && 'flex flex-wrap items-center gap-x-3 gap-y-1')}>
          <h2 id={`${id}-title`} className="text-sm font-semibold leading-5 text-[var(--pq-text)]">
            {compact ? l('论文概览', 'Paper Overview') : l('AI 概览', 'AI Overview')}
          </h2>
          {hasContent ? (
            <div className={cn('flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5 text-[var(--pq-text-muted)]', compact && 'mt-1')}>
              <span>{l('已生成', 'Generated')}</span>
              <span>· {l(`${keywordCount} 个关键词`, `${keywordCount} keywords`)}</span>
              <span>· {l(`${findingCount} 条发现`, `${findingCount} findings`)}</span>
            </div>
          ) : null}
        </div>
        {hasContent || loading ? (
          <button type="button" onClick={() => void generate()}
            disabled={!canGenerate} aria-disabled={!canGenerate || confirming} title={generateHint} aria-label={generateLabel}
            className="pq-icon-button h-8 w-8 shrink-0">
            {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />}
          </button>
        ) : null}
      </div>
      <div className={cn('space-y-3 py-3', compact ? 'px-3' : 'px-4')}>
        {error || actionError ? (
          <div role="alert" className="rounded-[var(--pq-radius-md)] border border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-error-bg)] px-3 py-2 text-sm text-[var(--pq-danger)]">
            {error || actionError}
          </div>
        ) : null}
        {!aiConfigured ? (
          <div className="flex flex-wrap items-center gap-2 text-xs leading-5 text-[var(--pq-text-muted)]">
            <span>{hasContent
              ? l('未配置概览模型，可继续查看已保存内容。', 'No overview model configured. Saved content is available.')
              : l('概览模型未配置', 'Overview model not configured')}</span>
            {onOpenSettings ? (
              <button type="button" onClick={onOpenSettings} className="pq-button h-8 !gap-1 px-2 text-xs">
                <Settings aria-hidden="true" className="h-3.5 w-3.5" />{l('模型设置', 'Model Settings')}
              </button>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <div role="status" className="flex items-center gap-2 text-xs text-[var(--pq-text-muted)]">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />{loadingLabel || l('正在生成…', 'Generating…')}
          </div>
        ) : null}
        {activeSection ? (
          <>
            {paperSummary?.title?.trim() ? (
              <h3 title={paperSummary.title} className={cn('line-clamp-3 break-words font-semibold leading-6 text-[var(--pq-text)]', compact ? 'text-sm' : 'text-base')}>{paperSummary.title}</h3>
            ) : null}
            <div role="tablist" aria-label={l('内容分节', 'Summary sections')} className="flex flex-wrap gap-1">
              {sections.map((section, index) => (
                <button key={section.key} id={`${id}-tab-${section.key}`} type="button" role="tab"
                  aria-selected={activeSection.key === section.key} aria-controls={`${id}-body`}
                  tabIndex={activeSection.key === section.key ? 0 : -1}
                  onClick={() => setActiveTab(section.key)}
                  onKeyDown={(event) => {
                    const next = event.key === 'ArrowRight' ? (index + 1) % sections.length
                      : event.key === 'ArrowLeft' ? (index - 1 + sections.length) % sections.length
                        : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    setActiveTab(sections[next].key);
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                  }}
                  className={cn('min-h-8 rounded-[var(--pq-radius-sm)] border px-3 py-1 text-xs font-medium transition-colors',
                    activeSection.key === section.key
                      ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]'
                      : 'border-transparent text-[var(--pq-text-muted)] hover:bg-[var(--pq-surface-2)]')}>
                  {labels[section.key]}
                </button>
              ))}
            </div>
            <div id={`${id}-body`} role="tabpanel" aria-labelledby={`${id}-tab-${activeSection.key}`} tabIndex={0} className="min-w-0 break-words">
              {activeSection.key === 'findings' || activeSection.key === 'takeaways' ? (
                <ul className="list-disc space-y-2 pl-5 text-[var(--pq-text-muted)]">
                  {activeSection.items?.map((item, index) => <li key={index}><MarkdownPreview content={item} /></li>)}
                </ul>
              ) : <MarkdownPreview content={activeSection.content} />}
            </div>
          </>
        ) : status === 'loading' ? (
          <div aria-hidden="true" className="h-24 animate-pulse rounded-[var(--pq-radius-md)] bg-[var(--pq-surface-2)]" />
        ) : (
          <div className="space-y-3 py-2 text-sm leading-6 text-[var(--pq-text-muted)]">
            <p>{l('尚未生成内容。', 'No summary has been generated yet.')}</p>
            {aiConfigured ? <p className="text-xs">{l('概览模型已配置', 'Overview model configured')}</p> : null}
            {!hasBlocks ? <p className="text-xs">{l('加载文档内容后即可生成。', 'Load the document content to generate a summary.')}</p> : null}
            <button type="button" onClick={() => void generate()}
              disabled={!canGenerate} aria-disabled={!canGenerate || confirming} title={generateHint} aria-label={generateLabel} className="pq-button h-8 px-3 text-xs">
              {generateLabel}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function SelectionPanel({
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  aiConfigured,
  onAppendSelectedExcerptToQa,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
  onCollapse,
}: {
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  aiConfigured: boolean;
  onAppendSelectedExcerptToQa: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
  onCollapse?: () => void;
}) {
  const l = useLocaleText();
  const isPdfBlockExcerpt = selectedExcerpt?.origin === 'pdf-block';

  return (
    <SectionCard
      title={isPdfBlockExcerpt ? l('段落译文', 'Paragraph Translation') : l('划词翻译', 'Selection Translation')}
      description={l(
        isPdfBlockExcerpt
          ? '点击 PDF 段落后可查看缓存译文，并加入问答上下文。'
          : '选中文本后可快速翻译，并加入问答上下文。',
        isPdfBlockExcerpt
          ? 'Click a PDF paragraph to view its cached translation and append it to the QA context.'
          : 'Translate selected text quickly and append it to the QA context.',
      )}
      icon={<Languages className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="space-y-4"
      actions={
        onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            className="pq-icon-button h-8 w-8"
            title={l('收起侧边栏', 'Collapse sidebar')}
            aria-label={l('收起侧边栏', 'Collapse sidebar')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null
      }
    >
      {!selectedExcerpt ? (
        <HintPanel icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}>
          {l(
            '在 PDF 视图中选中文本后，这里会显示选中内容和译文。',
            'Once you select text in the PDF view, the selection and its translation will appear here.',
          )}
        </HintPanel>
      ) : (
        <>
          <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4">
            <MarkdownPreview content={selectedExcerpt.text} />
          </div>

          {selectedExcerptError ? (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-error-bg)] px-4 py-3 text-sm text-[var(--pq-danger)]">
              {selectedExcerptError}
            </div>
          ) : null}

          {selectedExcerptTranslating ? (
            <div className="rounded-[22px] border border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] px-4 py-4 text-sm text-[var(--pq-accent)]">
              {isPdfBlockExcerpt
                ? l('正在翻译当前段落...', 'Translating this paragraph...')
                : l('正在翻译选中文本...', 'Translating the selected text...')}
            </div>
          ) : selectedExcerptTranslation ? (
            <div className="rounded-[22px] border border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] px-4 py-4">
              <MarkdownPreview content={selectedExcerptTranslation} />
            </div>
          ) : aiConfigured ? (
            <HintPanel icon={<Languages className="h-4 w-4" strokeWidth={1.8} />}>
              {isPdfBlockExcerpt
                ? l(
                    '当前段落还没有缓存译文。可以先运行全文翻译，或点击“立即翻译”单独翻译这段。',
                    'This paragraph has no cached translation yet. Run full translation first, or click "Translate Now" for this paragraph.',
                  )
                : l(
                    '当前还没有翻译结果，可以点击“立即翻译”。',
                    'There is no translation yet. Click "Translate Now" to generate one.',
                  )}
            </HintPanel>
          ) : (
            <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
              {l('请先配置模型后再使用翻译能力。', 'Configure a model before using translation.')}
            </HintPanel>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAppendSelectedExcerptToQa}
              className="pq-button-primary px-4 py-2 text-sm"
            >
              {l('加入问答', 'Add to QA')}
            </button>
            <button
              type="button"
              onClick={onTranslateSelectedExcerpt}
              className="rounded-xl border border-[var(--pq-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--pq-text-muted)] transition hover:border-[var(--pq-border-strong)] hover:bg-[var(--pq-surface-2)]"
            >
              {l('立即翻译', 'Translate Now')}
            </button>
            <button
              type="button"
              onClick={onClearSelectedExcerpt}
              className="rounded-xl border border-[var(--pq-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--pq-text-muted)] transition hover:border-[var(--pq-border-strong)] hover:bg-[var(--pq-surface-2)]"
            >
              {l('清除', 'Clear')}
            </button>
          </div>
        </>
      )}
    </SectionCard>
  );
}

export { HintPanel, MarkdownPreview, SectionCard, SelectionPanel, StatusBadge, SummaryPanel };
