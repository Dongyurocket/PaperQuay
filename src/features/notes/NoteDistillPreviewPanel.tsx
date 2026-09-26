import { Check, Eye, Image, LoaderCircle, X } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { DistillPreviewState } from './noteDistillPreview';
import { MarkdownPreview } from '../reader/assistantSidebarPrimitives';

export interface NoteDistillPreviewPanelProps {
  state: DistillPreviewState;
  appendTargetTitle?: string | null;
  supportsVision: boolean;
  canReidentify: boolean;
  reidentifying: boolean;
  onStateChange: (patch: Partial<DistillPreviewState>) => void;
  onGenerate: () => void;
  onReidentify: () => void;
  onConfirm: () => void;
  onDirectSave: () => void;
  onCancel: () => void;
}

export function NoteDistillPreviewPanel({
  state,
  appendTargetTitle,
  supportsVision,
  canReidentify,
  reidentifying,
  onStateChange,
  onGenerate,
  onReidentify,
  onConfirm,
  onDirectSave,
  onCancel,
}: NoteDistillPreviewPanelProps) {
  const l = useLocaleText();
  const ready = state.phase === 'ready';
  const processing = state.phase === 'processing';

  return (
    <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-distill-preview-title"
        className="flex max-h-[min(860px,calc(100vh-32px))] w-[min(1180px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-teal-600">
              <Eye className="h-4 w-4" />
              {l('提炼预览确认', 'Distill Preview')}
            </div>
            <h2 id="note-distill-preview-title" className="mt-1 text-lg font-semibold text-slate-900">
              {appendTargetTitle
                ? l(`追加到：${appendTargetTitle}`, `Append to: ${appendTargetTitle}`)
                : l('生成新的摘录卡', 'Create a new excerpt card')}
            </h2>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={l('取消', 'Cancel')}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
              {l('原始识别文本', 'Original recognition')}
            </div>
            <div className="min-h-[220px] flex-1 overflow-auto p-4 text-sm leading-6 text-slate-700">
              <MarkdownPreview content={state.originalText} className="text-sm leading-6 [&_p]:my-1" />
            </div>
            <div className="border-t border-slate-200 px-4 py-3">
              <label className={`flex items-start gap-2 text-sm ${canReidentify ? 'text-slate-700' : 'text-slate-400'}`}>
                <input
                  type="checkbox"
                  checked={state.reidentifyRequested}
                  disabled={!canReidentify || !supportsVision || processing || reidentifying}
                  onChange={(event) => {
                    const requested = event.target.checked;
                    onStateChange({ reidentifyRequested: requested });
                    if (requested) onReidentify();
                  }}
                  className="mt-0.5 accent-teal-600"
                />
                <span>
                  <span className="flex items-center gap-1 font-medium">
                    <Image className="h-4 w-4" />
                    {l('AI 重识别公式/表格区域', 'AI re-recognize formula/table')}
                  </span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {supportsVision
                      ? canReidentify
                        ? l('确认后用视觉模型重建，并在原文快照上留痕。', 'Confirmed re-recognition uses the vision model and leaves an audit marker.')
                        : l('仅对可生成 PDF 区域切片的选区可用。', 'Available only when a PDF region crop can be generated.')
                      : l('当前模型不支持视觉。', 'The selected model does not support vision.')}
                  </span>
                </span>
              </label>
              {state.aiEnhanced && canReidentify ? (
                <button
                  type="button"
                  onClick={onReidentify}
                  disabled={reidentifying || processing}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60"
                >
                  {reidentifying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Image className="h-3.5 w-3.5" />}
                  {reidentifying ? l('重识别中…', 'Re-recognizing…') : l('重识别并重新提炼', 'Re-recognize and distill')}
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-xl border border-teal-200 bg-white">
            <div className="border-b border-teal-100 px-4 py-3 text-sm font-semibold text-slate-800">
              {l('提炼稿（可编辑）', 'Distilled draft (editable)')}
            </div>
            <div className="grid min-h-[220px] flex-1 gap-3 p-4">
              <input
                value={state.title}
                onChange={(event) => onStateChange({ title: event.target.value })}
                placeholder={l('摘录卡标题', 'Excerpt card title')}
                disabled={processing}
                className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-800 outline-none focus:border-teal-400"
              />
              <textarea
                value={state.distilledText}
                onChange={(event) => onStateChange({ distilledText: event.target.value })}
                placeholder={l('先点击“生成提炼稿”…', 'Click “Generate draft” first…')}
                disabled={processing}
                className="min-h-[240px] resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-teal-400"
              />
            </div>
          </div>
        </div>

        {state.fallbackNotice ? (
          <div className="mx-5 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {state.fallbackNotice}
          </div>
        ) : null}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
          <div className="text-xs text-slate-400">
            {state.aiEnhanced
              ? l('已标记为 AI 重识别原文快照', 'AI-enhanced source snapshot is marked')
              : l('锚点与原文快照在确认前不会写入', 'Anchors and snapshots are not written before confirmation')}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              {l('取消', 'Cancel')}
            </button>
            <button type="button" onClick={onGenerate} disabled={processing} className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-60">
              {processing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {l('生成提炼稿', 'Generate draft')}
            </button>
            {ready ? (
              <>
                <button type="button" onClick={onDirectSave} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {l('直接保存', 'Save directly')}
                </button>
                <button type="button" onClick={onConfirm} disabled={!state.distilledText.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                  <Check className="h-4 w-4" />
                  {l('确认并写入', 'Confirm and save')}
                </button>
              </>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}
