import { useMemo } from 'react';
import { BarChart3, Clock3 } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { PdfReadingHeatmap } from '../../../types/reader';
import {
  formatReadingDuration,
  getReadingHeatColor,
  getReadingHeatStrength,
} from '../../pdf/pdfReadingHeatmap';
import {
  aggregateReadingTimeChartBins,
  READING_TIME_CHART_BAR_COUNT,
} from '../readingTimeChartUtils';

interface LiteratureReadingTimeChartProps {
  heatmap: PdfReadingHeatmap | null;
}

function formatLastReadTime(value: number, l: <T>(zh: T, en: T) => T) {
  if (!Number.isFinite(value) || value <= 0) {
    return l('暂无记录', 'No record');
  }

  return new Date(value).toLocaleString();
}

export default function LiteratureReadingTimeChart({
  heatmap,
}: LiteratureReadingTimeChartProps) {
  const l = useLocaleText();
  const bars = useMemo(() => aggregateReadingTimeChartBins(heatmap), [heatmap]);
  const maxBarMs = useMemo(() => Math.max(0, ...bars), [bars]);
  const totalMs = heatmap?.totalMs ?? 0;
  const activeBarCount = bars.filter((value) => value > 0).length;
  const hasReadingTime = totalMs > 0 && maxBarMs > 0;

  return (
    <section className="pq-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pq-text-faint)] dark:text-[#8d8d8d]">
            <Clock3 className="h-3.5 w-3.5" strokeWidth={2} />
            {l('阅读时间图', 'Reading Time')}
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--pq-text)] dark:text-[#f3f3f3]">
            {formatReadingDuration(totalMs)}
          </div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--pq-accent-ring)] bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]">
          <BarChart3 className="h-5 w-5" strokeWidth={1.9} />
        </div>
      </div>

      <div className="mt-4 flex h-28 items-end gap-1.5 rounded-xl border border-[var(--pq-border)] bg-white/54 px-3 py-3 dark:bg-white/5">
        {bars.map((value, index) => {
          const ratio = maxBarMs > 0 ? value / maxBarMs : 0;
          const height = hasReadingTime ? Math.max(6, Math.round(ratio * 92)) : 4;
          const color = getReadingHeatColor(value);
          const opacity = value > 0 ? 0.82 + getReadingHeatStrength(value) * 0.18 : 0.22;

          return (
            <span
              key={`${index}-${value}`}
              className="min-w-0 flex-1 rounded-t-md transition"
              style={{
                height,
                backgroundColor: color,
                opacity,
              }}
              title={l(
                `文档位置 ${index + 1}/${READING_TIME_CHART_BAR_COUNT}：${formatReadingDuration(value)}`,
                `Document position ${index + 1}/${READING_TIME_CHART_BAR_COUNT}: ${formatReadingDuration(value)}`,
              )}
            />
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-[var(--pq-border)] bg-white/50 px-3 py-2 dark:bg-white/5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--pq-text-faint)] dark:text-[#8d8d8d]">
            {l('活跃区段', 'Active Segments')}
          </div>
          <div className="mt-1 font-semibold tabular-nums text-[var(--pq-text-muted)] dark:text-[#e0e0e0]">
            {activeBarCount}/{READING_TIME_CHART_BAR_COUNT}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--pq-border)] bg-white/50 px-3 py-2 dark:bg-white/5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--pq-text-faint)] dark:text-[#8d8d8d]">
            {l('最后阅读', 'Last Read')}
          </div>
          <div className="mt-1 truncate font-semibold text-[var(--pq-text-muted)] dark:text-[#e0e0e0]">
            {formatLastReadTime(heatmap?.updatedAt ?? 0, l)}
          </div>
        </div>
      </div>

      {!hasReadingTime ? (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--pq-border)] bg-white/40 px-3 py-2 text-xs leading-5 text-[var(--pq-text-muted)] dark:bg-white/5">
          {l(
            '打开阅读器并停留阅读后，这里会显示各位置累计阅读时间。',
            'Open the reader and spend time on the PDF to populate this chart.',
          )}
        </div>
      ) : null}
    </section>
  );
}
