import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, MapPin, X } from 'lucide-react';

import { useLocaleText } from '../../i18n/uiLanguage';
import { ragGetChunkContext } from '../../services/rag.ts';
import type {
  DocumentChatCitation,
  RagChunkContextResponse,
  RagChunkContextSlice,
} from '../../types/reader.ts';

interface RagChunkContextPreviewProps {
  documentKey: string;
  citation: DocumentChatCitation;
  onClose: () => void;
  onLocate: (slice: RagChunkContextSlice) => void;
}

/** 每次「更多前文 / 更多后文」追加的切片数。 */
const CONTEXT_STEP = 2;

/**
 * 「查看上下文」预览面板：展示目标切片的前后邻接切片（同文档、同来源、按 chunkIndex 排序）。
 * 仅本地预览，不会调用模型或把正文发往外部服务（方案 §5.1）。
 */
export function RagChunkContextPreview({
  documentKey,
  citation,
  onClose,
  onLocate,
}: RagChunkContextPreviewProps) {
  const l = useLocaleText();
  const [beforeCount, setBeforeCount] = useState(1);
  const [afterCount, setAfterCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<RagChunkContextResponse | null>(null);

  // 切换引用时回到默认窗口，避免沿用上一个目标的展开范围。
  useEffect(() => {
    setBeforeCount(1);
    setAfterCount(1);
    setResponse(null);
    setError(null);
  }, [citation.id, citation.chunkId]);

  useEffect(() => {
    if (!citation.chunkId) {
      return;
    }

    let disposed = false;
    setLoading(true);
    setError(null);

    ragGetChunkContext({
      documentKey,
      sourceType: citation.sourceType,
      chunkId: citation.chunkId,
      before: beforeCount,
      after: afterCount,
    })
      .then((result) => {
        if (disposed) {
          return;
        }

        setResponse(result);
        setLoading(false);
      })
      .catch((contextError: unknown) => {
        if (disposed) {
          return;
        }

        setError(contextError instanceof Error ? contextError.message : String(contextError));
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [documentKey, citation.chunkId, citation.sourceType, beforeCount, afterCount]);

  const positionLabel = (position: RagChunkContextSlice['position']) => {
    if (position === 'before') {
      return l('前文', 'Before');
    }

    if (position === 'after') {
      return l('后文', 'After');
    }

    return l('命中', 'Hit');
  };

  const renderBody = () => {
    if (!citation.chunkId) {
      return (
        <p className="px-4 py-6 text-center text-xs text-[var(--pq-text-faint)]">
          {l('该引用缺少切片标识，无法查看上下文。', 'This citation has no chunk id, so context is unavailable.')}
        </p>
      );
    }

    if (error) {
      return <p className="px-4 py-6 text-center text-xs text-red-500">{error}</p>;
    }

    if (!response) {
      return (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-[var(--pq-text-faint)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          {l('正在读取切片上下文…', 'Loading chunk context...')}
        </div>
      );
    }

    if (response.status === 'not-ready') {
      return (
        <p className="px-4 py-6 text-center text-xs text-[var(--pq-text-faint)]">
          {l(
            '目标尚未就绪：索引仍在进行中或该来源尚未建立索引，请稍后再试。',
            'Not ready yet: indexing is still in progress or this source is not indexed. Try again later.',
          )}
        </p>
      );
    }

    if (response.status === 'not-found') {
      return (
        <p className="px-4 py-6 text-center text-xs text-[var(--pq-text-faint)]">
          {l(
            '未找到该切片，可能已随重新索引失效。',
            'Chunk not found. It may have become stale after re-indexing.',
          )}
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-2 px-3 py-3">
        {response.slices.map((slice) => (
          <div
            key={`${slice.position}:${slice.chunkId}`}
            className={
              slice.position === 'hit'
                ? 'rounded-lg border border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-soft)] p-2.5'
                : 'rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface-2)] p-2.5'
            }
          >
            <div className="mb-1.5 flex items-center gap-2 text-[10px] text-[var(--pq-text-faint)]">
              <span
                className={
                  slice.position === 'hit'
                    ? 'rounded-full bg-[var(--pq-accent-bg-hover)] px-2 py-0.5 font-semibold text-[var(--pq-accent)]'
                    : 'rounded-full border border-[var(--pq-border)] px-2 py-0.5'
                }
              >
                {positionLabel(slice.position)}
              </span>
              {slice.pageIndex !== null ? (
                <span>{l(`第 ${slice.pageIndex + 1} 页`, `Page ${slice.pageIndex + 1}`)}</span>
              ) : null}
              <button
                type="button"
                onClick={() => onLocate(slice)}
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--pq-border)] px-2 py-0.5 text-[10px] text-[var(--pq-text-muted)] transition hover:border-[var(--pq-accent-border)] hover:text-[var(--pq-accent)]"
                title={l('在结构化正文中定位该切片', 'Locate this chunk in the structured blocks')}
              >
                <MapPin className="h-3 w-3" strokeWidth={1.8} />
                {l('定位', 'Locate')}
              </button>
            </div>
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[var(--pq-text)]">
              {slice.text}
            </p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-1.5rem)] w-[360px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface)] shadow-xl">
      <div className="flex items-center gap-2 border-b border-[var(--pq-border)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[var(--pq-text)]">
            {l(`切片上下文 · [${citation.label}]`, `Chunk context · [${citation.label}]`)}
          </div>
          <div className="text-[10px] text-[var(--pq-text-faint)]">
            {l('仅本地预览，不会发送给模型', 'Local preview only; nothing is sent to the model')}
          </div>
        </div>
        {loading && response ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--pq-text-faint)]" strokeWidth={1.8} />
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-[var(--pq-text-faint)] transition hover:bg-[var(--pq-surface-2)] hover:text-[var(--pq-text)]"
          title={l('关闭', 'Close')}
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{renderBody()}</div>

      {response?.status === 'ready' && (response.hasMoreBefore || response.hasMoreAfter) ? (
        <div className="flex items-center gap-2 border-t border-[var(--pq-border)] px-3 py-2">
          {response.hasMoreBefore ? (
            <button
              type="button"
              onClick={() => setBeforeCount((count) => count + CONTEXT_STEP)}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--pq-border)] px-2.5 py-1 text-[11px] text-[var(--pq-text-muted)] transition hover:border-[var(--pq-accent-border)] hover:text-[var(--pq-accent)] disabled:opacity-50"
            >
              <ChevronUp className="h-3 w-3" strokeWidth={1.8} />
              {l('更多前文', 'More before')}
            </button>
          ) : null}
          {response.hasMoreAfter ? (
            <button
              type="button"
              onClick={() => setAfterCount((count) => count + CONTEXT_STEP)}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--pq-border)] px-2.5 py-1 text-[11px] text-[var(--pq-text-muted)] transition hover:border-[var(--pq-accent-border)] hover:text-[var(--pq-accent)] disabled:opacity-50"
            >
              <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
              {l('更多后文', 'More after')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
