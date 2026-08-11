import { CircleCheck, Download, FileText, Loader2, Play, TriangleAlert } from 'lucide-react';
import type { ReviewDocxExportResult } from '../../services/reviewWriting';

type LocaleText = (zh: string, en: string) => string;

export function ReviewExportCard({
  canExport,
  exportedPath,
  isExporting,
  l,
  onChooseOutput,
  onExport,
  onOpenOutput,
  outputPath,
  skippedFigures,
  validation,
}: {
  canExport: boolean;
  exportedPath: string;
  isExporting: boolean;
  l: LocaleText;
  onChooseOutput: () => void;
  onExport: () => void;
  onOpenOutput: () => void;
  outputPath: string;
  skippedFigures: NonNullable<ReviewDocxExportResult['skippedFigures']>;
  validation: ReviewDocxExportResult['validation'] | null;
}) {
  return (
    <div className="rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--pq-text)]">
        <FileText className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />
        {l('Word 导出', 'Word Export')}
      </div>
      <p className="mb-3 text-xs leading-5 text-[var(--pq-text-muted)]">
        {l('流程：先生成写作蓝图并分段写作，再选择导出位置，最后使用内置模板生成 Word。', 'Flow: generate a writing blueprint, draft sections in batches, choose an output path, then export Word with the built-in template.')}
      </p>
      <div className="space-y-2">
        <button type="button" onClick={onChooseOutput} className="pq-button h-8 w-full justify-start px-3 text-xs">
          <Download className="h-4 w-4" strokeWidth={1.8} />
          <span className="truncate">{outputPath || l('选择导出位置', 'Choose output path')}</span>
        </button>
        <button
          type="button"
          disabled={!canExport || isExporting}
          onClick={onExport}
          className="pq-button-primary h-8 w-full px-3 text-xs"
        >
          {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" strokeWidth={1.8} />}
          {l('导出 Word', 'Export Word')}
        </button>
        {exportedPath ? (
          <button type="button" onClick={onOpenOutput} className="pq-button h-8 w-full px-3 text-xs">
            <FileText className="h-4 w-4" strokeWidth={1.8} />
            {l('打开导出文件', 'Open exported file')}
          </button>
        ) : null}
        {skippedFigures.length > 0 ? (
          <div className="rounded-[var(--pq-radius-sm)] border border-[var(--pq-warning)] bg-[var(--pq-warning-bg)] px-3 py-2 text-xs leading-5 text-[var(--pq-warning)]">
            {l(
              `${skippedFigures.length} 张图片未能写入 Word，已使用占位提示。`,
              `${skippedFigures.length} figure(s) could not be embedded and were replaced by placeholders.`,
            )}
          </div>
        ) : null}
        {validation?.status === 'passed' ? (
          <div className="flex items-start gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-success)] bg-[var(--pq-success-bg)] px-3 py-2 text-xs leading-5 text-[var(--pq-success)]">
            <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>
              {l(
                `Word 结构校验通过：${validation.paragraphCount} 个段落、${validation.imageCount} 张图片、${validation.formulaCount} 个可编辑公式。`,
                `Word validation passed: ${validation.paragraphCount} paragraphs, ${validation.imageCount} images, and ${validation.formulaCount} editable equations.`,
              )}
            </span>
          </div>
        ) : null}
        {validation?.status === 'warning' ? (
          <div className="flex items-start gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-warning)] bg-[var(--pq-warning-bg)] px-3 py-2 text-xs leading-5 text-[var(--pq-warning)]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <div>
              <div>{l('Word 已导出，但后置校验发现以下提醒：', 'Word was exported with post-validation warnings:')}</div>
              {validation.warnings.map((warning) => <div key={warning}>· {warning}</div>)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
