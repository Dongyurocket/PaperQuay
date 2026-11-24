import type { RetainPdfJob, RetainPdfStatus } from '../../services/retainPdf';

/**
 * RetainPDF 详情面板的纯状态映射。
 *
 * 后端任务记录里的 status/stage/error 只在这里归一成固定枚举，
 * 组件再用 l() 输出双语文案，避免把后端原文（可能是 HTTP 报错或堆栈）
 * 直接展示给用户。
 */

export type RetainPdfUiPhase = 'idle' | 'unavailable' | 'running' | 'failed' | 'canceled' | 'ready';

export type RetainPdfRunningStage =
  | 'starting'
  | 'uploading'
  | 'submitting'
  | 'queued'
  | 'running'
  | 'downloading'
  | 'attaching';

export type RetainPdfUnavailableReason =
  | 'notInstalled'
  | 'configMissing'
  | 'configIncomplete'
  | 'missingPdf'
  | 'statusUnknown';

export type RetainPdfErrorKind =
  | 'notInstalled'
  | 'configIncomplete'
  | 'missingPdf'
  | 'paperMissing'
  | 'busy'
  | 'timeout'
  | 'canceled'
  | 'unknown';

export interface RetainPdfPageCountMismatch {
  original: number;
  translated: number;
}

export interface RetainPdfUiState {
  phase: RetainPdfUiPhase;
  canStart: boolean;
  canCancel: boolean;
  canRetry: boolean;
  percent: number | null;
  runningStage: RetainPdfRunningStage | null;
  unavailableReason: RetainPdfUnavailableReason | null;
  missingConfig: string[];
  errorKind: RetainPdfErrorKind | null;
  pageCountMismatch: RetainPdfPageCountMismatch | null;
  job: RetainPdfJob | null;
}

export interface RetainPdfUiInput {
  status: RetainPdfStatus | null;
  job: RetainPdfJob | null;
  hasPdf: boolean;
  /** 状态接口失败：不据此断言「未安装」，但无任务时仍按未知处理。 */
  statusFailed?: boolean;
  /** 当前文献实际挂载的译版附件 id；传入后，已移除/不匹配的 attached 记录回到可重新开始。 */
  translatedAttachmentId?: string | null;
}

const RUNNING_STATUSES: readonly string[] = [
  'starting',
  'uploading',
  'submitting',
  'queued',
  'running',
  'downloading',
  'attaching',
];
const READY_STATUSES: readonly string[] = ['attached', 'succeeded', 'success', 'finished', 'completed'];
const FAILED_STATUSES: readonly string[] = ['failed', 'error'];
const CANCELED_STATUSES: readonly string[] = ['canceled', 'cancelled'];

function runningStageOf(status: string | null | undefined): RetainPdfRunningStage | null {
  return RUNNING_STATUSES.includes(status ?? '') ? (status as RetainPdfRunningStage) : null;
}

export function retainPdfJobPercent(job: RetainPdfJob | null | undefined): number | null {
  const progress = job?.progress;
  const direct = progress?.percent;

  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return Math.min(100, Math.max(0, Math.round(direct)));
  }

  const current = progress?.current;
  const total = progress?.total;

  if (
    typeof current !== 'number'
    || !Number.isFinite(current)
    || typeof total !== 'number'
    || !Number.isFinite(total)
    || total <= 0
  ) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
}

/** 把后端错误归成固定种类；组件只显示对应的可读文案。 */
export function mapRetainPdfError(error: unknown): RetainPdfErrorKind {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';

  if (!message.trim()) {
    return 'unknown';
  }
  if (/未找到本机安装|RETAINPDF_EXE|未安装\s*RetainPDF|未检测到.*RetainPDF/.test(message)) {
    return 'notInstalled';
  }
  if (/配置不完整|未找到 RetainPDF 桌面配置|桌面配置/.test(message)) {
    return 'configIncomplete';
  }
  if (/没有可翻译的原始 PDF|原始 PDF 文件不存在|重新定位附件/.test(message)) {
    return 'missingPdf';
  }
  if (/文献不存在|已被删除/.test(message)) {
    return 'paperMissing';
  }
  if (/已有 RetainPDF 翻译任务在进行|任务在进行/.test(message)) {
    return 'busy';
  }
  if (/超时|timed out|timeout/i.test(message)) {
    return 'timeout';
  }
  if (/已经结束|已取消|canceled|cancelled/i.test(message)) {
    return 'canceled';
  }

  return 'unknown';
}

function unavailableReasonOf(
  status: RetainPdfStatus | null,
  hasPdf: boolean,
): RetainPdfUnavailableReason | null {
  if (!hasPdf) {
    return 'missingPdf';
  }
  if (!status) {
    return 'statusUnknown';
  }
  // 服务已在运行但安装路径不可探测时仍可翻译，不能误报未安装。
  if (!status.running && !status.installed) {
    return 'notInstalled';
  }
  if (!status.config) {
    return 'configMissing';
  }
  if (!status.config.ready) {
    return 'configIncomplete';
  }
  return null;
}

export function deriveRetainPdfUiState(input: RetainPdfUiInput): RetainPdfUiState {
  const job = input.job;
  const base: RetainPdfUiState = {
    phase: 'idle',
    canStart: false,
    canCancel: false,
    canRetry: false,
    percent: null,
    runningStage: null,
    unavailableReason: null,
    missingConfig: [],
    errorKind: null,
    pageCountMismatch: null,
    job,
  };

  const runningStage = runningStageOf(job?.status);
  if (job && runningStage) {
    return {
      ...base,
      phase: 'running',
      canCancel: true,
      percent: retainPdfJobPercent(job),
      runningStage,
    };
  }

  if (job && READY_STATUSES.includes(job.status)) {
    // 译版附件已被移除（或 id 不匹配）时，旧 attached 记录不再代表当前文献状态。
    const attachmentStale = input.translatedAttachmentId !== undefined
      && (!input.translatedAttachmentId || job.attachmentId !== input.translatedAttachmentId);
    if (attachmentStale) {
      return { ...base, phase: 'idle', canStart: true };
    }

    return {
      ...base,
      phase: 'ready',
      pageCountMismatch: job.pageCountMismatch ?? null,
    };
  }

  const unavailableReason = input.statusFailed
    ? null
    : unavailableReasonOf(input.status, input.hasPdf);

  // 真实不可用（未安装/缺配置/缺 PDF）优先于历史失败，避免给出无法成功的重试。
  if (unavailableReason) {
    return {
      ...base,
      phase: 'unavailable',
      unavailableReason,
      missingConfig: [...(input.status?.config?.missing ?? [])],
    };
  }

  if (job && FAILED_STATUSES.includes(job.status)) {
    return {
      ...base,
      phase: 'failed',
      canStart: true,
      canRetry: true,
      errorKind: mapRetainPdfError(job.error),
    };
  }

  if (job && CANCELED_STATUSES.includes(job.status)) {
    return {
      ...base,
      phase: 'canceled',
      canStart: true,
      canRetry: true,
    };
  }

  if (input.statusFailed) {
    return {
      ...base,
      phase: 'unavailable',
      unavailableReason: 'statusUnknown',
    };
  }

  return {
    ...base,
    phase: 'idle',
    canStart: true,
  };
}
