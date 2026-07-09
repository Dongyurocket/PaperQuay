import { Search, Sparkles, X } from 'lucide-react';
import { cn } from '../../utils/cn';

type LocaleText = (zh: string, en: string) => string;
type ReviewSourceMode = 'all' | 'papers' | 'notes';

function normalizeReviewSourceMode(value: unknown): ReviewSourceMode {
  return value === 'papers' || value === 'notes' || value === 'all' ? value : 'all';
}

export function ReviewIntentPanel({
  intent,
  isEnglish,
  l,
  onIntentChange,
  onQueryChange,
  onRetrieve,
  onReviewTypeChange,
  onSemanticRerankChange,
  onSourceModeChange,
  onTargetAudienceChange,
  query,
  retrieveDisabled,
  reviewType,
  reviewTypes,
  semanticAvailable,
  semanticRerank,
  sourceMode,
  sourceModes,
  targetAudience,
}: {
  intent: string;
  isEnglish: boolean;
  l: LocaleText;
  onIntentChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onRetrieve: () => void;
  onReviewTypeChange: (value: string) => void;
  onSemanticRerankChange: (value: boolean) => void;
  onSourceModeChange: (value: ReviewSourceMode) => void;
  onTargetAudienceChange: (value: string) => void;
  query: string;
  retrieveDisabled: boolean;
  reviewType: string;
  reviewTypes: Array<{ id: string; zh: string; en: string }>;
  semanticAvailable: boolean;
  semanticRerank: boolean;
  sourceMode: ReviewSourceMode;
  sourceModes: Array<{ id: ReviewSourceMode; zh: string; en: string }>;
  targetAudience: string;
}) {
  return (
    <>
      <div className="rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--pq-text)]">
          <Search className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />
          {l('检索关键词', 'Search Keywords')}
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pq-text-faint)]"
            strokeWidth={1.8}
          />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !retrieveDisabled) {
                event.preventDefault();
                onRetrieve();
              }
            }}
            className="pq-input h-10 w-full pl-9 pr-9 text-sm"
            placeholder={l('例如：多模态 RAG、检索增强生成、图神经网络', 'e.g. multimodal RAG, retrieval-augmented generation')}
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[var(--pq-radius-sm)] text-[var(--pq-text-faint)] transition hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]"
              aria-label={l('清除', 'Clear')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
        <label
          className={cn(
            'mt-3 flex items-center justify-between gap-3 rounded-[var(--pq-radius-sm)] border px-3 py-2',
            semanticAvailable
              ? 'border-[var(--pq-border)] bg-[var(--pq-surface-1)]'
              : 'border-[var(--pq-border)] bg-[var(--pq-bg-secondary)] opacity-70',
          )}
          title={
            semanticAvailable
              ? l('对关键词结果做语义相似度重排', 'Reorder keyword results by semantic similarity')
              : l('配置 embedding 后可启用语义重排序', 'Configure embedding to enable semantic rerank')
          }
        >
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--pq-text)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--pq-accent)]" strokeWidth={1.9} />
              {l('语义重排序', 'Semantic rerank')}
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-[var(--pq-text-muted)]">
              {semanticAvailable
                ? l('用向量相似度优化关键词结果顺序', 'Refine keyword order with vector similarity')
                : l('配置 embedding 后可启用', 'Configure embedding to enable')}
            </span>
          </span>
          <input
            type="checkbox"
            checked={semanticRerank && semanticAvailable}
            disabled={!semanticAvailable}
            onChange={(event) => onSemanticRerankChange(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-[var(--pq-accent)] disabled:cursor-not-allowed"
          />
        </label>
      </div>

      <div className="rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--pq-text)]">
          <Sparkles className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />
          {l('用户意图', 'User Intent')}
        </div>
        <textarea
          value={intent}
          onChange={(event) => onIntentChange(event.target.value)}
          className="pq-input min-h-[120px] w-full resize-none px-3 py-2 text-sm leading-6"
          placeholder={l('例如：请围绕多模态 RAG 在论文阅读中的应用写一篇中文综述，重点比较方法路线、数据集、局限和未来方向。', 'For example: Write an English review about multimodal RAG for paper reading, focusing on methods, datasets, limitations, and future directions.')}
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-[var(--pq-text-muted)]">
            <span className="mb-1 block">{l('综述类型', 'Review Type')}</span>
            <select
              value={reviewType}
              onChange={(event) => onReviewTypeChange(event.target.value)}
              className="pq-input h-9 w-full px-2 text-sm"
            >
              {reviewTypes.map((item) => (
                <option key={item.id} value={item.id}>{isEnglish ? item.en : item.zh}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--pq-text-muted)]">
            <span className="mb-1 block">{l('检索来源', 'Source Scope')}</span>
            <select
              value={sourceMode}
              onChange={(event) => onSourceModeChange(normalizeReviewSourceMode(event.target.value))}
              className="pq-input h-9 w-full px-2 text-sm"
            >
              {sourceModes.map((item) => (
                <option key={item.id} value={item.id}>{isEnglish ? item.en : item.zh}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--pq-text-muted)]">
            <span className="mb-1 block">{l('目标读者', 'Audience')}</span>
            <input
              value={targetAudience}
              onChange={(event) => onTargetAudienceChange(event.target.value)}
              className="pq-input h-9 w-full px-2 text-sm"
            />
          </label>
        </div>
      </div>
    </>
  );
}
