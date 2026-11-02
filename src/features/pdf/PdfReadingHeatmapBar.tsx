import { useMemo } from 'react';
import type { PdfReadingHeatmap } from '../../types/reader';
import { cn } from '../../utils/cn';
import {
  buildReadingHeatGradientStops,
  formatReadingDuration,
  getReadingHeatColor,
  getReadingHeatStrength,
  PDF_READING_HEATMAP_BIN_COUNT,
} from './pdfReadingHeatmap';

interface PdfReadingHeatmapBarProps {
  heatmap: PdfReadingHeatmap | null;
  currentProgressRatio: number;
  maxBinMs: number;
  onSeek: (progressRatio: number) => void;
  label: string;
  totalLabel: string;
}

function clampProgressRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function buildHeatPath(bins: number[], maxBinMs: number) {
  if (bins.length === 0 || maxBinMs <= 0) {
    return '';
  }

  return bins
    .map((value, index) => {
      const x =
        bins.length <= 1
          ? 0
          : (index / Math.max(1, bins.length - 1)) * 100;
      const intensity = Math.min(1, Math.max(0, value / maxBinMs));
      const y = 20 - Math.max(1.5, Math.pow(intensity, 0.58) * 18);

      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
    })
    .join(' ');
}

function getHeatDisplayIntensity(value: number, maxBinMs: number) {
  if (value <= 0) {
    return 0;
  }

  const relativeIntensity = maxBinMs > 0 ? value / maxBinMs : 0;
  const timeIntensity = getReadingHeatStrength(value);

  return Math.min(1, Math.max(relativeIntensity * 0.78, timeIntensity, 0.08));
}

export function PdfReadingHeatmapBar({
  heatmap,
  currentProgressRatio,
  maxBinMs,
  onSeek,
  label,
  totalLabel,
}: PdfReadingHeatmapBarProps) {
  const bins = useMemo(
    () =>
      Array.from({ length: PDF_READING_HEATMAP_BIN_COUNT }, (_, index) => {
        const value = heatmap?.bins[index] ?? 0;

        return value > 0 && Number.isFinite(value) ? value : 0;
      }),
    [heatmap],
  );
  const heatPath = useMemo(() => buildHeatPath(bins, maxBinMs), [bins, maxBinMs]);
  const gradientStops = useMemo(() => buildReadingHeatGradientStops(bins), [bins]);
  const currentLeft = `${clampProgressRatio(currentProgressRatio) * 100}%`;
  const hasHeat = maxBinMs > 0 && bins.some((value) => value > 0);
  const totalText = formatReadingDuration(heatmap?.totalMs ?? 0);

  const handlePointer = (clientX: number, currentTarget: HTMLButtonElement) => {
    const rect = currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;

    onSeek(clampProgressRatio(ratio));
  };

  return (
    <div className="absolute inset-x-3 bottom-3 z-20 pointer-events-none">
      <div className="rounded-xl border border-slate-200/80 bg-white/88 px-3 py-2 shadow-[0_14px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-[var(--pq-sidebar)] dark:shadow-[0_14px_34px_rgba(0,0,0,0.28)]">
        <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-medium text-[var(--pq-text-muted)] dark:text-[var(--pq-text-faint)]">
          <span>{label}</span>
          <span>
            {totalLabel} {totalText}
          </span>
        </div>
        <button
          type="button"
          className="pointer-events-auto group relative h-9 w-full cursor-pointer touch-none overflow-hidden rounded-lg border border-[var(--pq-border)] bg-[var(--pq-surface-2)] text-left outline-none transition hover:border-[var(--pq-border-strong)] dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:hover:border-white/15"
          onClick={(event) => handlePointer(event.clientX, event.currentTarget)}
          onPointerDown={(event) => handlePointer(event.clientX, event.currentTarget)}
          aria-label={label}
        >
          <div
            className="absolute inset-x-2 top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-80 dark:opacity-90"
            style={{
              backgroundColor: 'rgba(96, 165, 250, 0.28)',
            }}
          />
          {hasHeat ? (
            <>
              <div className="absolute inset-x-2 bottom-2 top-1.5">
                <div className="flex h-full items-end gap-px">
                  {bins.map((value, index) => {
                    const intensity = getHeatDisplayIntensity(value, maxBinMs);

                    return (
                      <span
                        key={`heat-bin-${index}`}
                        className={cn('block min-w-0 flex-1 rounded-t-[2px]')}
                        style={{
                          height: `${Math.max(8, Math.pow(intensity, 0.52) * 100)}%`,
                          backgroundColor: getReadingHeatColor(value),
                          opacity: value <= 0 ? 0.24 : 0.34 + intensity * 0.54,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <svg
                className="absolute inset-x-2 bottom-1.5 top-1 pointer-events-none h-[calc(100%-10px)] w-[calc(100%-16px)] overflow-visible"
                viewBox="0 0 100 20"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="pdf-reading-heatmap-line" x1="0%" x2="100%" y1="0%" y2="0%">
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
                  d={heatPath}
                  fill="none"
                  stroke="url(#pdf-reading-heatmap-line)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </>
          ) : null}
          <div
            className="absolute inset-y-1.5 w-px -translate-x-1/2 bg-slate-900 shadow-[0_0_0_1px_rgba(255,255,255,0.7)] dark:bg-white"
            style={{ left: currentLeft }}
          />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow-[0_4px_12px_rgba(15,23,42,0.28)] transition group-hover:scale-110 dark:bg-white"
            style={{ left: currentLeft }}
          />
        </button>
      </div>
    </div>
  );
}
