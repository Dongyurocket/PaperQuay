import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { listen } from '../../../platform/electron/event';
import {
  RETAINPDF_TRANSLATION_EVENT,
  cancelRetainPdfTranslation,
  getRetainPdfStatus,
  getRetainPdfTranslation,
  startRetainPdfTranslationOnce,
  type RetainPdfJob,
  type RetainPdfStatus,
  type RetainPdfTranslationEvent,
} from '../../../services/retainPdf';
import { Button } from '../../../ui/button';
import {
  deriveRetainPdfUiState,
  mapRetainPdfError,
  type RetainPdfErrorKind,
  type RetainPdfRunningStage,
  type RetainPdfUiState,
} from '../retainPdfUiState';

interface RetainPdfTranslationPanelProps {
  paperId: string;
  hasPdf: boolean;
  /** 当前文献实际挂载的译版附件；用于识别已移除的旧 attached 记录。 */
  translatedAttachmentId?: string | null;
  onChanged?: () => void;
}

type LocaleText = (zh: string, en: string) => string;

/**
 * 文献详情里的 RetainPDF 译版状态卡。
 *
 * 自包含：只接收 paperId / hasPdf，挂载时通过 get_status + get_translation
 * 拉取一次，之后靠 RETAINPDF_TRANSLATION_EVENT 增量刷新，不轮询。
 * 错误一律经 mapRetainPdfError 归一后显示双语文案，不回显后端原文。
 */

function runningStageLabel(l: LocaleText, stage: RetainPdfRunningStage | null): string {
  switch (stage) {
    case 'starting':
      return l('正在启动 RetainPDF', 'Starting RetainPDF');
    case 'uploading':
      return l('正在上传 PDF', 'Uploading PDF');
    case 'submitting':
      return l('正在创建翻译任务', 'Creating translation job');
    case 'queued':
      return l('排队等待翻译', 'Queued for translation');
    case 'downloading':
      return l('正在下载译版 PDF', 'Downloading translated PDF');
    case 'attaching':
      return l('正在附加译版 PDF', 'Attaching translated PDF');
    case 'running':
    default:
      return l('正在翻译', 'Translating');
  }
}

function unavailableText(l: LocaleText, ui: RetainPdfUiState): string {
  switch (ui.unavailableReason) {
    case 'notInstalled':
      return l(
        '未检测到本机的 RetainPDF，安装后即可在此发起翻译。',
        'RetainPDF was not found on this computer. Install it to start translations here.',
      );
    case 'configMissing':
      return l(
        '尚未检测到 RetainPDF 配置，请先启动 RetainPDF 并完成 OCR 与翻译模型设置。',
        'No RetainPDF configuration found. Start RetainPDF and finish the OCR and translation model setup.',
      );
    case 'configIncomplete':
      return l(
        `RetainPDF 配置不完整：缺少 ${ui.missingConfig.join('、')}。请在 RetainPDF 设置中补齐。`,
        `RetainPDF setup is incomplete: ${ui.missingConfig.join(', ')} missing. Complete it in RetainPDF settings.`,
      );
    case 'missingPdf':
      return l('这篇文献没有可翻译的原始 PDF。', 'This paper has no original PDF to translate.');
    case 'statusUnknown':
    default:
      return l('无法读取 RetainPDF 状态。', 'Could not read RetainPDF status.');
  }
}

function actionErrorText(l: LocaleText, kind: RetainPdfErrorKind | null): string {
  switch (kind) {
    case 'notInstalled':
      return l('未检测到本机的 RetainPDF，请先安装后重试。', 'RetainPDF was not found. Install it and try again.');
    case 'configIncomplete':
      return l('RetainPDF 配置不完整，请先在 RetainPDF 中完成设置。', 'RetainPDF setup is incomplete. Finish it in RetainPDF settings.');
    case 'missingPdf':
      return l('这篇文献没有可翻译的原始 PDF。', 'This paper has no original PDF to translate.');
    case 'paperMissing':
      return l('文献不存在或已被删除。', 'The paper no longer exists.');
    case 'busy':
      return l('该文献已有翻译任务在进行。', 'A translation is already running for this paper.');
    case 'timeout':
      return l('翻译任务超时，请重试。', 'The translation timed out. Try again.');
    case 'canceled':
      return l('翻译任务已取消。', 'The translation was canceled.');
    case 'unknown':
    default:
      return l('操作失败，请稍后重试。', 'The action failed. Try again later.');
  }
}

export default function RetainPdfTranslationPanel({
  paperId,
  hasPdf,
  translatedAttachmentId,
  onChanged,
}: RetainPdfTranslationPanelProps) {
  const l = useLocaleText();
  const [status, setStatus] = useState<RetainPdfStatus | null>(null);
  const [job, setJob] = useState<RetainPdfJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFailed, setStatusFailed] = useState(false);
  const [busy, setBusy] = useState<'start' | 'cancel' | null>(null);
  const [actionError, setActionError] = useState<RetainPdfErrorKind | null>(null);
  const requestRef = useRef(0);
  const eventVersionRef = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const eventVersion = eventVersionRef.current;
    setLoading(true);
    setActionError(null);
    // 重新检测/切换文献时清掉上一轮操作态，避免旧请求的 busy 残留。
    setBusy(null);
    setStatus(null);
    setJob(null);

    const [statusResult, jobResult] = await Promise.allSettled([
      getRetainPdfStatus(),
      getRetainPdfTranslation(paperId),
    ]);
    if (requestRef.current !== requestId) return;

    if (statusResult.status === 'fulfilled') {
      setStatus(statusResult.value);
      setStatusFailed(false);
    } else {
      setStatusFailed(true);
    }

    // 优先使用单篇查询结果；失败或为空时回落到状态接口的 jobs 列表。
    // 请求期间已有实时事件到达时，事件比这次快照新，不能用旧快照覆盖。
    const statusJobs = statusResult.status === 'fulfilled' ? statusResult.value.jobs : [];
    if (eventVersionRef.current === eventVersion) {
      if (jobResult.status === 'fulfilled') {
        setJob(jobResult.value ?? statusJobs.find((item) => item.paperId === paperId) ?? null);
      } else {
        setJob(statusJobs.find((item) => item.paperId === paperId) ?? null);
      }
    }
    setLoading(false);
  }, [paperId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    requestRef.current += 1;
  }, []);

  // 同一文献的翻译事件直接更新状态；attached 时通知父级刷新附件。
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    listen<RetainPdfTranslationEvent>(RETAINPDF_TRANSLATION_EVENT, ({ payload }) => {
      const nextJob = payload?.job;
      if (!nextJob || nextJob.paperId !== paperId) return;
      eventVersionRef.current += 1;
      setJob(nextJob);
      setActionError(null);
      if (payload.phase === 'attached') {
        onChangedRef.current?.();
      }
    })
      .then((nextUnsubscribe) => {
        if (disposed) nextUnsubscribe();
        else unsubscribe = nextUnsubscribe;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [paperId]);

  const ui = useMemo(
    () => deriveRetainPdfUiState({ status, job, hasPdf, statusFailed, translatedAttachmentId }),
    [status, job, hasPdf, statusFailed, translatedAttachmentId],
  );

  const refreshJob = useCallback(async () => {
    try {
      setJob(await getRetainPdfTranslation(paperId));
    } catch {
      // 刷新失败保留当前状态，错误已由 actionError 呈现。
    }
  }, [paperId]);

  const handleStart = async () => {
    if (busy) return;
    setBusy('start');
    setActionError(null);

    try {
      setJob(await startRetainPdfTranslationOnce(paperId));
    } catch (error) {
      setActionError(mapRetainPdfError(error));
      void refreshJob();
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    if (busy) return;
    setBusy('cancel');
    setActionError(null);

    try {
      setJob(await cancelRetainPdfTranslation(paperId));
    } catch (error) {
      setActionError(mapRetainPdfError(error));
      void refreshJob();
    } finally {
      setBusy(null);
    }
  };

  const startLabel = busy === 'start'
    ? l('正在启动…', 'Starting…')
    : ui.phase === 'failed'
      ? l('重试', 'Retry')
      : ui.phase === 'canceled'
        ? l('重新开始', 'Start again')
        : l('开始翻译', 'Start translation');

  return (
    <section
      aria-label={l('RetainPDF 译版', 'RetainPDF translation')}
      className="rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-3 py-2.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--pq-text)]">
          <Languages className="h-3.5 w-3.5 text-[var(--pq-text-faint)]" />
          {l('RetainPDF 译版', 'RetainPDF translation')}
        </div>
        {ui.phase === 'running' && ui.percent !== null ? (
          <span className="shrink-0 tabular-nums text-[var(--pq-text-muted)]">{ui.percent}%</span>
        ) : null}
      </div>

      {loading ? (
        <p role="status" className="mt-1.5 flex items-center gap-1.5 text-[var(--pq-text-muted)]">
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 animate-spin rounded-full border border-[var(--pq-border)] border-t-[var(--pq-accent)]"
          />
          {l('正在读取 RetainPDF 状态…', 'Reading RetainPDF status…')}
        </p>
      ) : (
        <>
          {ui.phase === 'running' ? (
            <>
              <div className="mt-1.5 flex items-center gap-1.5 text-[var(--pq-text-muted)]">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 animate-spin rounded-full border border-[var(--pq-border)] border-t-[var(--pq-accent)]"
                />
                <span className="min-w-0 flex-1 truncate">{runningStageLabel(l, ui.runningStage)}</span>
              </div>
              <div
                className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--pq-bg-tertiary)]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={ui.percent ?? undefined}
                aria-label={l('翻译进度', 'Translation progress')}
              >
                <div
                  className={[
                    'h-full rounded-full bg-[var(--pq-accent)]',
                    ui.percent === null ? 'w-1/3 animate-pulse' : 'transition-all duration-300',
                  ].join(' ')}
                  style={ui.percent === null ? undefined : { width: `${ui.percent}%` }}
                />
              </div>
            </>
          ) : null}

          {ui.phase === 'idle' ? (
            <p className="mt-1.5 text-[var(--pq-text-muted)]">
              {l('尚未生成 RetainPDF 译版。', 'No RetainPDF translation yet.')}
            </p>
          ) : null}

          {ui.phase === 'failed' ? (
            <div className="mt-1.5 space-y-0.5">
              <p className="text-[var(--pq-danger)]">{l('上次翻译失败。', 'The last translation failed.')}</p>
              <p className="text-[var(--pq-text-muted)]">{actionErrorText(l, ui.errorKind)}</p>
            </div>
          ) : null}

          {ui.phase === 'canceled' ? (
            <p className="mt-1.5 text-[var(--pq-text-muted)]">
              {l('翻译已取消。', 'Translation canceled.')}
            </p>
          ) : null}

          {ui.phase === 'ready' ? (
            <p className="mt-1.5 text-[var(--pq-success)]">
              {l('译版 PDF 已附加。', 'Translated PDF attached.')}
            </p>
          ) : null}

          {ui.phase === 'unavailable' ? (
            <div role="status" className="mt-1.5 space-y-1.5">
              <p className="text-[var(--pq-text-muted)]">{unavailableText(l, ui)}</p>
              {ui.unavailableReason !== 'missingPdf' ? (
                <Button size="sm" variant="secondary" onClick={() => void load()}>
                  {l('重新检测', 'Check again')}
                </Button>
              ) : null}
            </div>
          ) : null}

          {ui.pageCountMismatch ? (
            <p role="status" className="mt-1.5 text-[var(--pq-warning)]">
              {l(
                `译版与原文页数不一致（原文 ${ui.pageCountMismatch.original} 页，译版 ${ui.pageCountMismatch.translated} 页），对照阅读可能错位。`,
                `Page counts differ (original ${ui.pageCountMismatch.original}, translated ${ui.pageCountMismatch.translated}); side-by-side reading may be misaligned.`,
              )}
            </p>
          ) : null}

          {actionError ? (
            <p role="alert" className="mt-1.5 text-[var(--pq-danger)]">{actionErrorText(l, actionError)}</p>
          ) : null}

          {ui.phase === 'running' || ui.phase === 'idle' || ui.phase === 'failed' || ui.phase === 'canceled' ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {ui.phase === 'running' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === 'cancel'}
                  onClick={() => void handleCancel()}
                >
                  {busy === 'cancel' ? l('正在取消…', 'Canceling…') : l('取消翻译', 'Cancel translation')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!ui.canStart || busy === 'start'}
                  onClick={() => void handleStart()}
                >
                  {startLabel}
                </Button>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
