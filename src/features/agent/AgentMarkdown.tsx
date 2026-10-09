import { Component, type ReactNode, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import type { LibraryAgentRagCitation } from '../../services/libraryAgent';
import type { AgentCitationBinding } from '../../services/agentAnswerEvidence';
import { citationBindingReason, injectAgentCitationBindings } from './agentCitationRendering.ts';
import type { LiteraturePaper } from '../../types/library';
import { normalizeMarkdownMath, remarkFixGluedLatex, remarkSuperscriptPlugin } from '../../utils/markdown';
import { resolveBarePaperIds } from './agentMarkdownPaperIds.ts';

export { resolveBarePaperIds } from './agentMarkdownPaperIds.ts';

export function AgentCitationMarker({ binding, citation, onCitationClick, children }: {
  binding?: AgentCitationBinding;
  citation?: LibraryAgentRagCitation;
  onCitationClick?: (citation: LibraryAgentRagCitation) => void;
  children: ReactNode;
}) {
  if (binding?.status === 'verified' && citation && onCitationClick) {
    return <button type="button" onClick={() => onCitationClick(citation)}
      className="inline-flex items-center rounded-full border border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)] px-1.5 py-0.5 text-xs font-semibold text-[var(--pq-accent)] transition hover:border-[var(--pq-accent)] hover:bg-[var(--pq-surface)]"
      title={`${citation.paperTitle}${citation.pageIndex == null ? '' : ` · Page ${citation.pageIndex + 1}`}`}>
      [{citation.label}]
    </button>;
  }
  const reason = citationBindingReason(binding);
  return <span role="note" title={reason} aria-label={`${citation ? `[${citation.label}]` : '[?]'} ${reason}`}
    className="inline-flex rounded border border-[var(--pq-border)] px-1.5 text-xs text-[var(--pq-text-muted)] cursor-help">[{children}]</span>;
}

class AgentMarkdownBoundary extends Component<
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

function AgentMarkdownFallback({ content }: { content: string }) {
  return (
    <pre className="whitespace-pre-wrap rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-4 py-3 text-sm leading-7 text-[var(--pq-text-muted)]">
      {content}
    </pre>
  );
}

export interface PaperTargetInfo {
  paperId: string;
  page?: number;
}

export function parseAgentPaperHref(href?: string): PaperTargetInfo | null {
  if (!href) return null;
  const trimmed = href.trim();
  const prefix = '#agent-paper-';
  if (!trimmed.startsWith(prefix) || trimmed.startsWith('#agent-paper-unresolved:')) {
    return null;
  }
  const rest = trimmed.slice(prefix.length);
  const [paperId, queryString] = rest.split('?');
  if (!paperId) return null;
  let page: number | undefined;
  if (queryString) {
    const params = new URLSearchParams(queryString);
    const pageParam = params.get('page');
    if (pageParam && /^\d+$/.test(pageParam)) {
      page = parseInt(pageParam, 10);
    }
  }
  return { paperId: decodeURIComponent(paperId), page };
}

/**
 * 将正文中的内部 paper ID 解析为 Markdown 链接胶囊。
 * 实现位于 ./agentMarkdownPaperIds.ts（纯函数，供 node --test 直接加载）。
 */

// paperId 是结构化标识符，不能被 remark-math 当作带下划线的 TeX 变量。
// 模型偶尔会把标识符包在 $...$ 中；解除这层数学包裹后再生成标题胶囊，避免 KaTeX
// 在链接 href/文本中解析到 `#agent-paper-...`。
function liftPaperIdsOutOfMath(content: string): string {
  return content
    .replace(/\$([^$\n]*\b(?:paper|category)_[A-Za-z0-9_-]{8,}[^$\n]*)\$/g, '$1')
    .replace(/\\\(([^\n]*\b(?:paper|category)_[A-Za-z0-9_-]{8,}[^\n]*)\\\)/g, '$1');
}

export default function AgentMarkdown({
  content,
  citations,
  citationBindings,
  paperTitleById,
  papers,
  onCitationClick,
}: {
  content: string;
  citations?: LibraryAgentRagCitation[];
  citationBindings?: AgentCitationBinding[];
  paperTitleById?: Record<string, string> | Map<string, string>;
  papers?: LiteraturePaper[];
  onCitationClick?: (citation: LibraryAgentRagCitation) => void;
}) {
  const titleFallbackMap = useMemo(() => {
    const map = new Map<string, string>();
    if (paperTitleById) {
      if (paperTitleById instanceof Map) {
        paperTitleById.forEach((v, k) => map.set(k, v));
      } else {
        Object.entries(paperTitleById).forEach(([k, v]) => map.set(k, v));
      }
    }
    if (papers) {
      for (const p of papers) {
        if (p.id) map.set(p.id, p.title);
      }
    }
    return map;
  }, [paperTitleById, papers]);

  const citationRendering = useMemo(() => injectAgentCitationBindings(content, citations, citationBindings), [content, citations, citationBindings]);
  const normalizedContent = useMemo(() => {
    try {
      const safeContent = liftPaperIdsOutOfMath(citationRendering.content);
      const mathNormalized = normalizeMarkdownMath(safeContent);
      return resolveBarePaperIds(liftPaperIdsOutOfMath(mathNormalized), citations, titleFallbackMap);
    } catch {
      const safeContent = liftPaperIdsOutOfMath(citationRendering.content);
      return resolveBarePaperIds(safeContent, citations, titleFallbackMap);
    }
  }, [citations, citationRendering, titleFallbackMap]);

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, ...props }) => {
        const bindingIndex = href?.startsWith(citationRendering.hrefPrefix) ? href.slice(citationRendering.hrefPrefix.length) : '';
        const occurrence = /^\d+$/.test(bindingIndex) ? citationRendering.resolved[Number(bindingIndex)] : undefined;
        const citation = occurrence?.citation;
        if (occurrence || /^#agent-(?:cite|binding|untrusted)-/i.test(href ?? '')) {
          return <AgentCitationMarker binding={occurrence?.binding} citation={citation} onCitationClick={onCitationClick}>{children}</AgentCitationMarker>;
        }

        if (href?.startsWith('#agent-paper-unresolved:')) {
          return (
            <code
              title="未在本次引用中"
              className="rounded-md bg-[var(--pq-surface-2)] px-1.5 py-0.5 font-mono text-[0.88em] text-[var(--pq-text-muted)] cursor-help"
            >
              {children}
            </code>
          );
        }

        const paperTarget = parseAgentPaperHref(href);
        if (paperTarget && onCitationClick) {
          let matchedCitation = citations?.find((c) => {
            if (c.paperId !== paperTarget.paperId) return false;
            if (paperTarget.page !== undefined) {
              return c.pageIndex !== null && c.pageIndex !== undefined && c.pageIndex + 1 === paperTarget.page;
            }
            return true;
          });

          if (!matchedCitation) {
            matchedCitation = citations?.find((c) => c.paperId === paperTarget.paperId);
          }

          const fallbackTitle = titleFallbackMap.get(paperTarget.paperId) || paperTarget.paperId;
          const targetCitation: LibraryAgentRagCitation = matchedCitation ?? {
            id: `paper-link-${paperTarget.paperId}`,
            label: '1',
            sourceType: 'pdf-text',
            pageIndex: paperTarget.page !== undefined ? paperTarget.page - 1 : null,
            paperId: paperTarget.paperId,
            paperTitle: fallbackTitle,
          };

          return (
            <button
              type="button"
              onClick={() => onCitationClick(targetCitation)}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--pq-accent)] transition hover:border-[var(--pq-accent)] hover:bg-[var(--pq-surface)]"
              title={targetCitation.previewText || `${targetCitation.paperTitle}${targetCitation.pageIndex !== null && targetCitation.pageIndex !== undefined ? ` · 第 ${targetCitation.pageIndex + 1} 页` : ''}`}
            >
              <span className="truncate max-w-[200px]">{children}</span>
            </button>
          );
        }

        return (
          <a href={href} target="_blank" rel="noreferrer" {...props}>
            {children}
          </a>
        );
      },
    }),
    [citations, citationRendering, onCitationClick, titleFallbackMap],
  );
  const fallback = <AgentMarkdownFallback content={content} />;

  return (
    <AgentMarkdownBoundary resetKey={normalizedContent} fallback={fallback}>
      <ReactMarkdown
        className={[
          'max-w-none text-sm leading-7 text-[var(--pq-text-muted)]',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          '[&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:border-b [&_h1]:border-[var(--pq-border)] [&_h1]:pb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-[var(--pq-text)]',
          '[&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-[var(--pq-text)]',
          '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--pq-text)]',
          '[&_p]:my-2 [&_p]:leading-7 [&_p]:break-words [&_strong]:font-semibold [&_strong]:text-[var(--pq-text)] [&_em]:text-[var(--pq-text-muted)]',
          '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_li]:pl-1 [&_li]:break-words',
          '[&_blockquote]:my-4 [&_blockquote]:rounded-[var(--pq-radius-md)] [&_blockquote]:border [&_blockquote]:border-[var(--pq-border)] [&_blockquote]:bg-[var(--pq-surface-2)] [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:text-[var(--pq-text-muted)]',
          '[&_hr]:my-5 [&_hr]:border-[var(--pq-border)]',
          '[&_code]:rounded-md [&_code]:bg-[var(--pq-surface-2)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:break-all [&_code]:text-[var(--pq-accent)]',
          '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-[var(--pq-radius-md)] [&_pre]:border [&_pre]:border-[var(--pq-border)] [&_pre]:bg-[#111827] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-slate-100',
          '[&_a]:font-semibold [&_a]:text-[var(--pq-accent)] [&_a]:underline [&_a]:underline-offset-4 [&_a]:break-all',
          '[&_table]:my-4 [&_table]:block [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-x-auto [&_table]:rounded-[var(--pq-radius-md)] [&_th]:border [&_th]:border-[var(--pq-border)] [&_th]:bg-[var(--pq-surface-2)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-[var(--pq-border)] [&_td]:px-3 [&_td]:py-2 [&_td]:break-words',
          '[&_.katex]:text-[var(--pq-text)] [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2',
        ].join(' ')}
        remarkPlugins={[remarkGfm, remarkMath, remarkFixGluedLatex, remarkSuperscriptPlugin]}
        rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: true }]]}
        components={{
          sup: ({ children }) => (
            <sup className="align-super text-[0.72em] font-medium leading-none text-[var(--pq-text)]">
              {children}
            </sup>
          ),
          sub: ({ children }) => (
            <sub className="align-sub text-[0.72em] font-medium leading-none text-[var(--pq-text)]">
              {children}
            </sub>
          ),
          ...components,
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </AgentMarkdownBoundary>
  );
}
