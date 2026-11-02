import { useId, useMemo } from 'react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { PdfReadingHeatmap } from '../../../types/reader';
import {
  buildReadingHeatGradientStops,
  formatReadingDuration,
  getReadingHeatColor,
} from '../../pdf/pdfReadingHeatmap';

const PREVIEW_POINT_COUNT = 42;

interface LiteratureReadingHeatmapPreviewProps {
  heatmap: PdfReadingHeatmap | null;
}

function aggregatePreviewBins(heatmap: PdfReadingHeatmap | null): number[] {
  const sourceBins = heatmap?.bins ?? [];

  if (sourceBins.length === 0) {
    return Array.from({ length: PREVIEW_POINT_COUNT }, () => 0);
  }

  return Array.from({ length: PREVIEW_POINT_COUNT }, (_, index) => {
    const start = Math.floor((index / PREVIEW_POINT_COUNT) * sourceBins.length);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) / PREVIEW_POINT_COUNT) * sourceBins.length),
    );
    let maxValue = 0;

    for (let binIndex = start; binIndex < end; binIndex += 1) {
      const value = sourceBins[binIndex];

      if (typeof value === 'number' && Number.isFinite(value) && value > maxValue) {
        maxValue = value;
      }
    }

    return maxValue;
  });
}

function buildLinePath(points: number[], maxValue: number) {
  if (points.length === 0 || maxValue <= 0) {
    return '';
  }

  return points
    .map((value, index) => {
      const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 100;
      const intensity = Math.min(1, Math.max(0, value / maxValue));
      const y = 28 - Math.max(2, Math.pow(intensity, 0.56) * 24);

      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
    })
    .join(' ');
}

export default function LiteratureReadingHeatmapPreview({
  heatmap,
}: LiteratureReadingHeatmapPreviewProps) {
  const l = useLocaleText();
  const gradientId = useId().replace(/:/g, '');
  const points = useMemo(() => aggregatePreviewBins(heatmap), [heatmap]);
  const maxValue = useMemo(() => Math.max(0, ...points), [points]);
  const linePath = useMemo(() => buildLinePath(points, maxValue), [maxValue, points]);
  const gradientStops = useMemo(() => buildReadingHeatGradientStops(points), [points]);
  const totalMs = heatmap?.totalMs ?? 0;
  const hasHeat = totalMs > 0 && maxValue > 0 && Boolean(linePath);
  const totalLabel = formatReadingDuration(totalMs);

  return (
    <span
      className="block min-w-0 overflow-hidden"
      title={
        hasHeat
          ? l(`阅读时长 ${totalLabel}`, `Reading time ${totalLabel}`)
          : l('暂无阅读热力', 'No reading heat yet')
      }
    >
      <span className="mb-1 flex min-w-0 items-center justify-between gap-2 text-[11px] font-medium text-[var(--pq-text-faint)] dark:text-[#8d8d8d]">
        <span className="truncate">{l('阅读热力', 'Reading Heat')}</span>
        <span className="shrink-0">{hasHeat ? totalLabel : l('未读', 'Unread')}</span>
      </span>
      <span className="relative block h-8 min-w-0 overflow-hidden rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface-2)] dark:border-white/10 dark:bg-white/[0.035]">
        {hasHeat ? (
          <svg
            className="absolute inset-1 h-[calc(100%-8px)] w-[calc(100%-8px)] overflow-visible"
            viewBox="0 0 100 28"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
                {gradientStops.map((stop) => (
                  <stop
                    key={`${stop.offset}-${stop.color}`}
                    offset={stop.offset}
                    stopColor={stop.color}
                  />
                ))}
              </linearGradient>
            </defs>
            <path
              d={`${linePath} L 100 28 L 0 28 Z`}
              fill={`url(#${gradientId})`}
              opacity="0.18"
            />
            <path
              d={linePath}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <span
            className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 rounded-full dark:bg-white/15"
            style={{ backgroundColor: getReadingHeatColor(0) }}
          />
        )}
      </span>
    </span>
  );
}
