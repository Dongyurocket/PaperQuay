import { useState, useEffect, useMemo, useRef } from 'react';
import { Sparkles, RefreshCw, Check, RotateCcw, X, Bot, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { useLocaleText } from '../../i18n/uiLanguage';
import { getAvailableReparseModelPresets, reparseBlockWithAi } from '../../services/blockReparse';
import type { PdfSource, PositionedMineruBlock, QaModelPreset } from '../../types/reader';
import { normalizeMarkdownMath } from '../../utils/markdown';
import { isValidBBox } from '../../utils/bbox';
import { getPdfBlockCropDataUrl } from '../pdf/pdfBlockCrop';

interface BlockReparseModalProps {
  block: PositionedMineruBlock;
  pdfSource?: PdfSource;
  initialText: string;
  hasCustomOverride?: boolean;
  storageReady: boolean;
  storageError?: string;
  onApply: (reparsedMarkdown: string) => void;
  onReset?: () => void;
  onClose: () => void;
}

export function BlockReparseModal({
  block, pdfSource, initialText, hasCustomOverride = false,
  storageReady, storageError, onApply, onReset, onClose,
}: BlockReparseModalProps) {
  const l = useLocaleText();
  const [availablePresets, setAvailablePresets] = useState<QaModelPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [reparsedResult, setReparsedResult] = useState('');
  const [resultSource, setResultSource] = useState<'image' | 'text' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewTab, setViewTab] = useState<'preview' | 'source'>('preview');
  const [crop, setCrop] = useState<{ status: 'loading' | 'ready' | 'unavailable'; dataUrl?: string }>({ status: 'loading' });
  const inFlight = useRef(false);
  const selectedPreset = availablePresets.find((preset) => preset.id === selectedPresetId);
  const visionEnabled = selectedPreset?.supportsVision === true;
  const hasGeometry = Boolean(pdfSource && isValidBBox(block.bbox));
  const imageDataUrl = visionEnabled && hasGeometry && crop.status === 'ready' ? crop.dataUrl : undefined;
  const preparingImage = visionEnabled && hasGeometry && crop.status === 'loading';

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

  const applyOrRestore = (restore: boolean) => {
    if (loading || !storageReady) return;
    try {
      if (restore) onReset?.();
      else if (reparsedResult.trim()) onApply(reparsedResult.trim());
      onClose();
    } catch (reason) {
      setError(l('保存修复失败：', 'Could not save repair: ') + (reason instanceof Error ? reason.message : String(reason)));
    }
  };
  const normalizedPreview = useMemo(() => normalizeMarkdownMath(reparsedResult), [reparsedResult]);
  const inputNotice = preparingImage
    ? l('正在准备原 PDF 区块切片…', 'Preparing the original PDF crop…')
    : imageDataUrl
      ? l('将发送下方 PDF 切片和参考 OCR 文本，自动保留段落、表格与公式结构。', 'The PDF crop and reference OCR text will be sent, preserving paragraphs, tables and equations automatically.')
      : !visionEnabled
        ? l('仅文本修复：所选模型未标记支持视觉，不会发送图片。可在模型设置中核对视觉能力。', 'Text repair only: the selected model is not marked as vision capable. No image will be sent. Check vision support in model settings.')
        : !hasGeometry
          ? l('仅文本修复：该区块缺少原 PDF 或有效 bbox，无法获取切片。', 'Text repair only: the original PDF or valid bbox is unavailable.')
          : l('仅文本修复：PDF 切片生成失败。尚未发送模型请求，可修复 PDF 来源后重新打开，或手动开始文本修复。', 'Text repair only: the PDF crop could not be created. No model request has been sent. Fix the PDF source and reopen, or start text repair manually.');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label={l('AI 重新识别', 'AI Re-parse')}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[var(--pq-surface-1)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-[var(--pq-text)]"><Sparkles className="h-4 w-4" />{l('AI 重新识别', 'AI Re-parse')}</h3>
            <p className="text-xs text-slate-400">{l(`第 ${block.pageIndex + 1} 页 · 块 ${block.blockIndex + 1}`, `Page ${block.pageIndex + 1} · Block ${block.blockIndex + 1}`)}</p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label={l('关闭', 'Close')} className="rounded-lg p-1 text-slate-400 disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block space-y-1.5 text-xs font-medium text-slate-600 dark:text-[var(--pq-text-muted)]">
            <span className="flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" />{l('选择 AI 大模型', 'Select AI Model')}</span>
            <select value={selectedPresetId} disabled={loading} onChange={(event) => setSelectedPresetId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-[var(--pq-surface-2)]">
              {!availablePresets.length && <option value="">{l('请先在设置中配置 AI 模型', 'Configure an AI model in settings')}</option>}
              {availablePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label || preset.model} · {preset.supportsVision ? l('视觉', 'Vision') : l('文本', 'Text')}</option>)}
            </select>
          </label>
          <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-950/30 dark:text-indigo-200">{inputNotice}</div>
          {imageDataUrl && <img src={imageDataUrl} alt={l('将发送给模型的原 PDF 区块切片', 'Original PDF crop to send to the model')} className="max-h-52 w-full rounded-lg border border-slate-200 bg-white object-contain" />}
          <label className="block space-y-1.5 text-xs text-slate-600 dark:text-[var(--pq-text-muted)]">
            <span>{l('补充要求（可选）', 'Additional instructions (optional)')}</span>
            <input value={customPrompt} disabled={loading} onChange={(event) => setCustomPrompt(event.target.value)} placeholder={l('例如：保留公式编号与单位', 'e.g. Preserve equation numbers and units')} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-[var(--pq-surface-2)]" />
          </label>
          <details className="rounded-xl border border-slate-200 p-2.5 text-xs dark:border-white/10">
            <summary className="cursor-pointer text-slate-500">{l('参考 OCR 文本', 'Reference OCR text')} ({initialText.length})</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600 dark:text-[var(--pq-text-muted)]">{initialText || l('无参考文字，将依据图片识别。', 'No reference text; recognition will use the image.')}</pre>
          </details>
          {(error || storageError) && <div role="alert" className="flex gap-2 whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"><AlertCircle className="h-4 w-4 shrink-0" /><span>{error || storageError}</span></div>}
          {reparsedResult && <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-600">{resultSource === 'image' ? l('图片重析结果', 'Image re-parse result') : l('文本修复结果', 'Text repair result')}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setViewTab('preview')} className={viewTab === 'preview' ? 'font-bold' : ''}>{l('预览', 'Preview')}</button>
                <button type="button" onClick={() => setViewTab('source')} className={viewTab === 'source' ? 'font-bold' : ''}>{l('Markdown 原文', 'Markdown source')}</button>
              </div>
            </div>
            <div className="max-h-60 overflow-auto rounded-xl border border-emerald-200 p-3 dark:border-emerald-500/30">
              {viewTab === 'preview' ? <div className="prose prose-slate max-w-none text-xs dark:prose-invert [&_table]:w-full [&_th]:border [&_th]:p-1.5 [&_td]:border [&_td]:p-1.5">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}>{normalizedPreview}</ReactMarkdown>
              </div> : <pre className="whitespace-pre-wrap font-mono text-[11px]">{reparsedResult}</pre>}
            </div>
          </div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5 text-xs dark:border-white/10">
          <div>{hasCustomOverride && onReset && <button type="button" disabled={loading || !storageReady} onClick={() => applyOrRestore(true)} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />{l('恢复原始识别', 'Restore original')}</button>}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={loading} className="px-3 py-1.5 disabled:opacity-40">{l('关闭', 'Close')}</button>
            <button type="button" disabled={loading || preparingImage || !selectedPreset || (!initialText.trim() && !imageDataUrl)} onClick={handleStartReparse} className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-indigo-700 disabled:opacity-40 dark:bg-indigo-950/40 dark:text-indigo-300">
              {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {loading ? l('大模型正在处理…', 'Processing…') : imageDataUrl ? l('开始重新识别', 'Start re-parse') : l('开始文本修复', 'Start text repair')}
            </button>
            {reparsedResult && <button type="button" disabled={loading || !storageReady} onClick={() => applyOrRestore(false)} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-40"><Check className="h-3.5 w-3.5" />{l('保存并应用', 'Save and apply')}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
