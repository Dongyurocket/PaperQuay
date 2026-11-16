/**
 * 阅读器打开论文时「被动显示已有概览」的判定逻辑。
 *
 * 被动路径只读取磁盘缓存或文库侧已有结果，从不调用模型，因此不受
 * 「自动生成概览」开关与模型配置约束；自动生成仍由原有 effect 负责。
 */
import type { PaperSummary } from '../../types/reader.ts';

export interface CachedSummaryAutoLoadInput {
  /** 当前文档按设置计算出的概览源键；为空表示正文尚未就绪。 */
  sourceKey: string;
  /** 当前已显示概览对应的源键。 */
  currentSourceKey: string;
  /** 本文档已被动尝试过的源键，避免同一键反复读盘。 */
  attemptedSourceKey: string;
  /** 概览正在生成或读取。 */
  loading: boolean;
  /** 文库侧同一文档的概览任务正在运行。 */
  taskRunning: boolean;
}

export function shouldAutoLoadCachedSummary(input: CachedSummaryAutoLoadInput): boolean {
  const sourceKey = input.sourceKey.trim();

  if (!sourceKey || input.loading || input.taskRunning) {
    return false;
  }

  if (input.currentSourceKey === input.sourceKey) {
    return false;
  }

  return input.attemptedSourceKey !== input.sourceKey;
}

export interface PreviewSummaryFallbackInput {
  currentSummary: PaperSummary | null;
  previewSummary: PaperSummary | null | undefined;
  loading: boolean;
}

/** 阅读器尚无概览时，先显示文库侧已加载的概览，避免空白等待。 */
export function shouldUsePreviewSummaryFallback(input: PreviewSummaryFallbackInput): boolean {
  return !input.currentSummary && Boolean(input.previewSummary) && !input.loading;
}

export type SummaryModelConfigIssue = 'base-url' | 'api-key' | 'model';

export interface SummaryModelConfigLike {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function resolveSummaryModelConfigIssue(
  preset: SummaryModelConfigLike | null | undefined,
): SummaryModelConfigIssue | null {
  if (!preset || !preset.baseUrl.trim()) {
    return 'base-url';
  }

  if (!preset.apiKey.trim()) {
    return 'api-key';
  }

  if (!preset.model.trim()) {
    return 'model';
  }

  return null;
}

/**
 * 同步到文库预览时，阅读器暂无概览就不携带 summary 字段，
 * 让文库侧保留已有结果，而不是被 null 覆盖。
 */
export function previewSummarySyncField(
  summary: PaperSummary | null,
): { summary: PaperSummary } | Record<string, never> {
  return summary ? { summary } : {};
}
