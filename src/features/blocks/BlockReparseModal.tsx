import { useState, useEffect, useMemo, useRef } from 'react';
import { Sparkles, RefreshCw, Check, RotateCcw, X, Bot, AlertCircle, Pencil, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { useLocaleText } from '../../i18n/uiLanguage';
import { getAvailableReparseModelPresets, reparseBlockWithAi } from '../../services/blockReparse';
import { confirmAction } from '../../ui/confirmHost';
import { Dialog } from '../../ui/dialog';
import type { PdfSource, PositionedMineruBlock, QaModelPreset } from '../../types/reader';
import { normalizeMarkdownMath, remarkFixGluedLatex } from '../../utils/markdown';
import { isValidBBox } from '../../utils/bbox';
import { getPdfBlockCropDataUrl } from '../pdf/pdfBlockCrop';

type BlockEditorTab = 'manual' | 'ai';

interface BlockReparseModalProps {
  block: PositionedMineruBlock;
  pdfSource?: PdfSource;
  /** MinerU 原始识别文本，作为 AI 重析的参考，不包含用户编辑。 */
  initialText: string;
  /** 当前生效文本（已包含用户编辑），作为手动编辑区的初始值。缺省等于 initialText。 */
  currentText?: string;
  initialTab?: BlockEditorTab;
  hasCustomOverride?: boolean;
  storageReady: boolean;
  storageError?: string;
  onApply: (markdown: string) => Promise<void>;
  onReset?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function BlockReparseModal({
  block, pdfSource, initialText, currentText = initialText, initialTab = 'manual',
  hasCustomOverride = false, storageReady, storageError, onApply, onReset, onDelete, onClose,
}: BlockReparseModalProps) {
  const l = useLocaleText();
  const [tab, setTab] = useState<BlockEditorTab>(initialTab);
  const [draft, setDraft] = useState(currentText);
  const [draftTab, setDraftTab] = useState<'edit' | 'preview'>('edit');
  const [availablePresets, setAvailablePresets] = useState<QaModelPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [reparsedResult, setReparsedResult] = useState('');
  const [resultSource, setResultSource] = useState<'image' | 'text' | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [viewTab, setViewTab] = useState<'preview' | 'source'>('preview');
  const [crop, setCrop] = useState<{ status: 'loading' | 'ready' | 'unavailable'; dataUrl?: string }>({ status: 'loading' });
  const inFlight = useRef(false);
  const selectedPreset = availablePresets.find((preset) => preset.id === selectedPresetId);
  const visionEnabled = selectedPreset?.supportsVision === true;
  const hasGeometry = Boolean(pdfSource && isValidBBox(block.bbox));
  const imageDataUrl = visionEnabled && hasGeometry && crop.status === 'ready' ? crop.dataUrl : undefined;
  const preparingImage = visionEnabled && hasGeometry && crop.status === 'loading';
  const busy = loading || saving;
  const dirty = draft.trim() !== currentText.trim();

  useEffect(() => {
    let disposed = false;
    void getAvailableReparseModelPresets().then((presets) => {
      if (disposed) return;
      setAvailablePresets(presets);
      setSelectedPresetId((presets.find((preset) => preset.supportsVision === true) || presets[0])?.id || '');
    }).catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!visionEnabled || !pdfSource || !isValidBBox(block.bbox)) {
      setCrop({ status: 'unavailable' });
      return;
    }
    setCrop({ status: 'loading' });
    void getPdfBlockCropDataUrl(pdfSource, block).then((dataUrl) => {
      if (!disposed) setCrop(dataUrl ? { status: 'ready', dataUrl } : { status: 'unavailable' });
    }).catch(() => {
      if (!disposed) setCrop({ status: 'unavailable' });
    });
    return () => { disposed = true; };
  }, [pdfSource, block, visionEnabled]);

  const handleStartReparse = async () => {
    if (inFlight.current || preparingImage || !selectedPreset || (!initialText.trim() && !imageDataUrl)) return;
    inFlight.current = true;
    setLoading(true);
    setError('');
    setReparsedResult('');
    setResultSource(null);
    try {
      const res = await reparseBlockWithAi({
        text: initialText,
        blockType: block.type,
        imageDataUrl,
        customPrompt: customPrompt.trim() || undefined,
        preferredPresetId: selectedPresetId,
      });
      setReparsedResult(res.reparsedText);
      setResultSource(imageDataUrl ? 'image' : 'text');
      // AI 结果同样进入编辑区，允许用户删除多余内容或修正措辞后再保存；
      // 保持当前标签页，结果预览与「手动编辑」入口同时可见。
      setDraft(res.reparsedText);
      setDraftTab('edit');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(imageDataUrl
        ? `${message}\n${l('图片识别失败，未自动重试或追加文本调用。请检查模型视觉能力配置，或选择文本模型后手动开始文本修复。', 'Image recognition failed. No automatic retry or extra text request was sent. Check vision settings or select a text model and start text repair manually.')}`
        : message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (busy || !storageReady || !draft.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onApply(draft.trim());
      onClose();
    } catch (reason) {
      setError(l('保存编辑失败：', 'Could not save the edit: ') + (reason instanceof Error ? reason.message : String(reason)));
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    if (busy || !storageReady || !onReset) return;
    setSaving(true);
    setError('');
    try {
      await onReset();
      onClose();
    } catch (reason) {
      setError(l('恢复原始识别失败：', 'Could not restore the original result: ') + (reason instanceof Error ? reason.message : String(reason)));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (busy || !storageReady || !onDelete) return;

    const confirmed = await confirmAction({
      title: l('删除这个识别块？', 'Delete this recognized block?'),
      description: l(
        '该块会从阅读、翻译和重新索引中排除，原始解析文件不会被修改。之后可以在右侧工具栏的「识别结果」列表里恢复。',
        'The block will be excluded from reading, translation and re-indexing. The original parse file is not modified, and the block can be restored from the "Recognition results" list in the toolbar.',
      ),
      confirmLabel: l('删除此块', 'Delete Block'),
      danger: true,
    });

    if (!confirmed) return;

    setSaving(true);
    setError('');
    try {
      await onDelete();
      onClose();
    } catch (reason) {
      setError(l('删除识别块失败：', 'Could not delete the block: ') + (reason instanceof Error ? reason.message : String(reason)));
    } finally {
      setSaving(false);
    }
  };

  const normalizedPreview = useMemo(() => normalizeMarkdownMath(draft), [draft]);
  const inputNotice = preparingImage
    ? l('正在准备原 PDF 区块切片…', 'Preparing the original PDF crop…')
    : imageDataUrl
      ? l('将发送下方 PDF 切片和参考 OCR 文本，自动保留段落、表格与公式结构。', 'The PDF crop and reference OCR text will be sent, preserving paragraphs, tables and equations automatically.')
      : !visionEnabled
        ? l('仅文本修复：所选模型未标记支持视觉，不会发送图片。可在模型设置中核对视觉能力。', 'Text repair only: the selected model is not marked as vision capable. No image will be sent. Check vision support in model settings.')
        : !hasGeometry
          ? l('仅文本修复：该区块缺少原 PDF 或有效 bbox，无法获取切片。', 'Text repair only: the original PDF or valid bbox is unavailable.')
          : l('仅文本修复：PDF 切片生成失败。尚未发送模型请求，可修复 PDF 来源后重新打开，或手动开始文本修复。', 'Text repair only: the PDF crop could not be created. No model request has been sent. Fix the PDF source and reopen, or start text repair manually.');

  const requestClose = () => {
    if (!busy) onClose();
  };

  return (
    <Dialog
      open
      onClose={requestClose}
      overlay="soft"
      dismissOnBackdrop={false}
      size="lg"
      labelledBy="pq-block-reparse-title"
      className="flex max-h-[90vh] flex-col bg-white dark:bg-[var(--pq-surface-1)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--pq-border)] px-5 py-4 dark:border-white/10">
        <div>
          <h3 id="pq-block-reparse-title" className="flex items-center gap-2 text-sm font-semibold text-[var(--pq-text)] dark:text-[var(--pq-text)]">
            <Pencil className="h-4 w-4" />
            {l('编辑识别结果', 'Edit Recognized Content')}
            {hasCustomOverride ? (
              <span className="rounded-full bg-[var(--pq-success-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--pq-success)]">
                {l('已编辑', 'Edited')}
              </span>
            ) : null}
          </h3>
          <p className="text-xs text-[var(--pq-text-faint)]">{l(`第 ${block.pageIndex + 1} 页 · 块 ${block.blockIndex + 1}`, `Page ${block.pageIndex + 1} · Block ${block.blockIndex + 1}`)}</p>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label={l('关闭', 'Close')} className="rounded-lg p-1 text-[var(--pq-text-faint)] disabled:opacity-40"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--pq-border)] px-5 py-2 text-xs dark:border-white/10">
        <button
          type="button"
          onClick={() => setTab('manual')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${tab === 'manual' ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]' : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)]'}`}
        >
          <Pencil className="h-3.5 w-3.5" />
          {l('手动编辑', 'Manual edit')}
        </button>
        <button
          type="button"
          onClick={() => setTab('ai')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${tab === 'ai' ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]' : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)]'}`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {l('AI 重析', 'AI Re-parse')}
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!storageReady && !loading ? (
          <div role="status" className="rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface-2)] p-3 text-xs text-[var(--pq-text-muted)]">
            {l(
              '编辑存储尚未就绪，请稍后重试；若持续出现，请检查应用的 MinerU 缓存目录设置。',
              'Edit storage is not ready yet. Retry shortly; if it persists, check the MinerU cache directory in Settings.',
            )}
          </div>
        ) : null}
        {tab === 'manual' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--pq-text-muted)]">
              <span>{l('直接修改识别的 Markdown 文本，支持表格与 LaTeX 公式。', 'Edit the recognized Markdown directly; tables and LaTeX are supported.')}</span>
              <div className="flex gap-1 rounded-lg border border-[var(--pq-border)] p-0.5">
                <button type="button" onClick={() => setDraftTab('edit')} className={`rounded-md px-2 py-0.5 ${draftTab === 'edit' ? 'bg-[var(--pq-accent-bg)] font-semibold text-[var(--pq-accent)]' : ''}`}>{l('编辑', 'Edit')}</button>
                <button type="button" onClick={() => setDraftTab('preview')} className={`rounded-md px-2 py-0.5 ${draftTab === 'preview' ? 'bg-[var(--pq-accent-bg)] font-semibold text-[var(--pq-accent)]' : ''}`}>{l('预览', 'Preview')}</button>
              </div>
            </div>
            {draftTab === 'edit' ? (
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={busy}
                spellCheck={false}
                rows={16}
                aria-label={l('识别结果 Markdown', 'Recognized Markdown')}
                className="min-h-[18rem] w-full resize-y rounded-xl border border-[var(--pq-border)] bg-white px-3 py-2 font-mono text-[12px] leading-5 text-[var(--pq-text)] outline-none focus:border-[color-mix(in_srgb,var(--pq-accent)_45%,transparent)] disabled:opacity-60 dark:border-white/10 dark:bg-[var(--pq-surface-2)]"
              />
            ) : (
              <div className="max-h-[26rem] min-h-[18rem] overflow-auto rounded-xl border border-[var(--pq-border)] p-3 dark:border-white/10">
                <div className="prose prose-slate max-w-none text-xs dark:prose-invert [&_table]:w-full [&_th]:border [&_th]:p-1.5 [&_td]:border [&_td]:p-1.5">
                  <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath, remarkFixGluedLatex]} rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}>{normalizedPreview}</ReactMarkdown>
                </div>
              </div>
            )}
            <p className="text-[11px] leading-5 text-[var(--pq-text-faint)]">
              {l(
                '编辑只改变阅读与索引使用的文本，不改写 MinerU 原始解析文件；重新索引后新文本进入知识库检索。',
                'Edits change the text used for reading and indexing only; the original MinerU parse file is untouched. The new text enters knowledge-base search after re-indexing.',
              )}
            </p>
          </div>
        ) : (
          <>
            <label className="block space-y-1.5 text-xs font-medium text-[var(--pq-text-muted)] dark:text-[var(--pq-text-muted)]">
              <span className="flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" />{l('选择 AI 大模型', 'Select AI Model')}</span>
              <select value={selectedPresetId} disabled={busy} onChange={(event) => setSelectedPresetId(event.target.value)} className="w-full rounded-xl border border-[var(--pq-border)] bg-white px-3 py-2 dark:border-white/10 dark:bg-[var(--pq-surface-2)]">
                {!availablePresets.length && <option value="">{l('请先在设置中配置 AI 模型', 'Configure an AI model in settings')}</option>}
                {availablePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label || preset.model} · {preset.supportsVision ? l('视觉', 'Vision') : l('文本', 'Text')}</option>)}
              </select>
            </label>
            <div role="status" className="rounded-xl border border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] p-3 text-xs text-[var(--pq-accent)] ">{inputNotice}</div>
            {imageDataUrl && <img src={imageDataUrl} alt={l('将发送给模型的原 PDF 区块切片', 'Original PDF crop to send to the model')} className="max-h-52 w-full rounded-lg border border-[var(--pq-border)] bg-white object-contain" />}
            <label className="block space-y-1.5 text-xs text-[var(--pq-text-muted)] dark:text-[var(--pq-text-muted)]">
              <span>{l('补充要求（可选）', 'Additional instructions (optional)')}</span>
              <input value={customPrompt} disabled={busy} onChange={(event) => setCustomPrompt(event.target.value)} placeholder={l('例如：删除页眉页脚，保留公式编号与单位', 'e.g. Remove running headers, keep equation numbers and units')} className="w-full rounded-xl border border-[var(--pq-border)] bg-white px-3 py-2 dark:border-white/10 dark:bg-[var(--pq-surface-2)]" />
            </label>
            <details className="rounded-xl border border-[var(--pq-border)] p-2.5 text-xs dark:border-white/10">
              <summary className="cursor-pointer text-[var(--pq-text-muted)]">{l('参考 OCR 文本', 'Reference OCR text')} ({initialText.length})</summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--pq-text-muted)] dark:text-[var(--pq-text-muted)]">{initialText || l('无参考文字，将依据图片识别。', 'No reference text; recognition will use the image.')}</pre>
            </details>
            {reparsedResult && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--pq-success)]">{resultSource === 'image' ? l('图片重析结果', 'Image re-parse result') : l('文本修复结果', 'Text repair result')}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setViewTab('preview')} className={viewTab === 'preview' ? 'font-bold' : ''}>{l('预览', 'Preview')}</button>
                    <button type="button" onClick={() => setViewTab('source')} className={viewTab === 'source' ? 'font-bold' : ''}>{l('Markdown 原文', 'Markdown source')}</button>
                  </div>
                </div>
                <div className="max-h-60 overflow-auto rounded-xl border border-[color-mix(in_srgb,var(--pq-success)_28%,transparent)] p-3 ">
                  {viewTab === 'preview' ? <div className="prose prose-slate max-w-none text-xs dark:prose-invert [&_table]:w-full [&_th]:border [&_th]:p-1.5 [&_td]:border [&_td]:p-1.5">
                    <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath, remarkFixGluedLatex]} rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}>{normalizeMarkdownMath(reparsedResult)}</ReactMarkdown>
                  </div> : <pre className="whitespace-pre-wrap font-mono text-[11px]">{reparsedResult}</pre>}
                </div>
                <p className="text-[11px] text-[var(--pq-text-faint)]">{l('结果已填入编辑区，可继续手动调整后保存。', 'The result is in the editor; adjust it manually before saving.')}</p>
              </div>
            )}
            <button type="button" disabled={busy || preparingImage || !selectedPreset || (!initialText.trim() && !imageDataUrl)} onClick={handleStartReparse} className="inline-flex items-center gap-1.5 rounded-xl border border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] px-3 py-2 text-xs font-medium text-[var(--pq-accent)] disabled:opacity-40 ">
              {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {loading ? l('大模型正在处理…', 'Processing…') : imageDataUrl ? l('开始重新识别', 'Start re-parse') : l('开始文本修复', 'Start text repair')}
            </button>
          </>
        )}

        {(error || storageError) && <div role="alert" className="flex gap-2 whitespace-pre-wrap rounded-xl border border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-error-bg)] p-3 text-xs text-[var(--pq-danger)] "><AlertCircle className="h-4 w-4 shrink-0" /><span>{error || storageError}</span></div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--pq-border)] px-5 py-3.5 text-xs dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          {hasCustomOverride && onReset && (
            <button type="button" disabled={busy || !storageReady} onClick={handleRestore} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 disabled:opacity-40">
              <RotateCcw className="h-3.5 w-3.5" />{l('恢复原始识别', 'Restore original')}
            </button>
          )}
          {onDelete && (
            <button type="button" disabled={busy || !storageReady} onClick={handleDelete} className="inline-flex items-center gap-1.5 rounded-xl border border-[color-mix(in_srgb,var(--pq-danger)_35%,transparent)] px-3 py-1.5 text-[var(--pq-danger)] disabled:opacity-40">
              <Trash2 className="h-3.5 w-3.5" />{l('删除此块', 'Delete block')}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 disabled:opacity-40">{l('取消', 'Cancel')}</button>
          <button type="button" disabled={busy || !storageReady || !draft.trim() || !dirty} onClick={handleSave} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--pq-accent-button-bg)] px-3 py-1.5 text-[var(--pq-accent-button-text)] disabled:opacity-40">
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {saving ? l('保存中…', 'Saving…') : l('保存并应用', 'Save and apply')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
