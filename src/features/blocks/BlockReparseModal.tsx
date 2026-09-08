import { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  RefreshCw,
  Check,
  RotateCcw,
  X,
  FileText,
  Table2,
  Binary,
  Bot,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { useLocaleText } from '../../i18n/uiLanguage';
import {
  getAvailableReparseModelPresets,
  reparseBlockWithAi,
  type BlockReparseMode,
} from '../../services/blockReparse';
import type { PositionedMineruBlock, QaModelPreset } from '../../types/reader';
import { normalizeMarkdownMath } from '../../utils/markdown';

interface BlockReparseModalProps {
  block: PositionedMineruBlock;
  initialText: string;
  hasCustomOverride?: boolean;
  onApply: (reparsedMarkdown: string) => void;
  onReset?: () => void;
  onClose: () => void;
}

export function BlockReparseModal({
  block,
  initialText,
  hasCustomOverride = false,
  onApply,
  onReset,
  onClose,
}: BlockReparseModalProps) {
  const l = useLocaleText();
  const [availablePresets, setAvailablePresets] = useState<QaModelPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [mode, setMode] = useState<BlockReparseMode>('general');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [reparsedResult, setReparsedResult] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [viewTab, setViewTab] = useState<'preview' | 'source'>('preview');

  useEffect(() => {
    void getAvailableReparseModelPresets().then((presets) => {
      setAvailablePresets(presets);
      if (presets.length > 0 && !selectedPresetId) {
        setSelectedPresetId(presets[0].id);
      }
    });
  }, [selectedPresetId]);

  // 如果原本是 nomenclature 或者 table，默认选中 table 模式
  useEffect(() => {
    if (
      /nomenclature|notation|symbol/i.test(initialText) ||
      block.type === 'table'
    ) {
      setMode('table');
    } else if (block.type === 'equation') {
      setMode('formula');
    }
  }, [block.type, initialText]);

  const handleStartReparse = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reparseBlockWithAi({
        text: initialText,
        blockType: block.type,
        mode,
        customPrompt: customPrompt.trim() || undefined,
        preferredPresetId: selectedPresetId || undefined,
      });
      setReparsedResult(res.reparsedText);
    } catch (err) {
      setError(err instanceof Error ? err.message : l('重新识别失败', 'Re-parsing failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!reparsedResult.trim()) return;
    onApply(reparsedResult.trim());
    onClose();
  };

  const handleRestore = () => {
    onReset?.();
    onClose();
  };

  const normalizedPreview = useMemo(() => {
    return normalizeMarkdownMath(reparsedResult);
  }, [reparsedResult]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[var(--pq-surface-1)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-[var(--pq-text)]">
                {l('AI 区块重新识别与修复', 'AI Block Re-parse & Formatting')}
              </h3>
              <p className="text-xs text-slate-400 dark:text-[var(--pq-text-muted)]">
                {l(
                  `第 ${block.pageIndex + 1} 页 · 块 ${block.blockIndex + 1} (${block.type})`,
                  `Page ${block.pageIndex + 1} · Block ${block.blockIndex + 1} (${block.type})`,
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[var(--pq-surface-2)] dark:hover:text-[var(--pq-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* AI Model Selection */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-[var(--pq-text-muted)]">
              <Bot className="h-3.5 w-3.5 text-indigo-500" />
              <span>{l('选择 AI 大模型', 'Select AI Model')}</span>
            </label>
            {availablePresets.length > 0 ? (
              <select
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-xs focus:border-indigo-500 focus:outline-hidden dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text)]"
              >
                {availablePresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label || preset.model} ({preset.model})
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-300">
                {l(
                  '未检测到已配置的模型，请先前往设置配置 AI 模型 API。',
                  'No configured models found. Please configure an AI model API in settings first.',
                )}
              </div>
            )}
          </div>

          {/* Mode Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-[var(--pq-text-muted)]">
              {l('重析模式', 'Re-parse Mode')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMode('general')}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  mode === 'general'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:text-[var(--pq-text-muted)] dark:hover:bg-[var(--pq-surface-2)]'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>{l('智能排版纠错', 'General Fix')}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('table')}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  mode === 'table'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:text-[var(--pq-text-muted)] dark:hover:bg-[var(--pq-surface-2)]'
                }`}
              >
                <Table2 className="h-3.5 w-3.5" />
                <span>{l('表格/术语表结构化', 'Table/Notation')}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('formula')}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  mode === 'formula'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:text-[var(--pq-text-muted)] dark:hover:bg-[var(--pq-surface-2)]'
                }`}
              >
                <Binary className="h-3.5 w-3.5" />
                <span>{l('数学公式提取', 'LaTeX Formula')}</span>
              </button>
            </div>
          </div>

          {/* Optional Custom Instructions */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-[var(--pq-text-muted)]">
              {l('补充指令 (可选，已内置严格无多余文本约束)', 'Custom Instruction (Optional, no-filler constraint built-in)')}
            </label>
            <input
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={l(
                '例如：提取为严格两列表格，左侧符号右侧含义…',
                'e.g. Extract into a two-column table with symbols and descriptions...',
              )}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder-slate-400 shadow-xs focus:border-indigo-500 focus:outline-hidden dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text)]"
            />
          </div>

          {/* Original Text Section */}
          <details className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-2.5 text-xs dark:border-white/10 dark:bg-[var(--pq-surface-2)]">
            <summary className="cursor-pointer font-medium text-slate-500 dark:text-[var(--pq-text-muted)]">
              {l('查看当前识别原始内容', 'View Current Raw Content')} ({initialText.length} {l('字符', 'chars')})
            </summary>
            <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-2 font-mono text-[11px] text-slate-600 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)]">
              {initialText}
            </pre>
          </details>

          {/* Error display */}
          {error ? (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-xs text-rose-600 dark:border-rose-500/20 dark:bg-rose-950/30 dark:text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Reparsed Result Preview */}
          {reparsedResult ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {l('✨ 重新识别结果', '✨ Re-parsed Result')}
                </span>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px] dark:border-white/10 dark:bg-[var(--pq-surface-2)]">
                  <button
                    type="button"
                    onClick={() => setViewTab('preview')}
                    className={`rounded-md px-2 py-0.5 ${
                      viewTab === 'preview'
                        ? 'bg-white font-medium shadow-xs dark:bg-[var(--pq-surface-3)] dark:text-[var(--pq-text)]'
                        : 'text-slate-500 dark:text-[var(--pq-text-muted)]'
                    }`}
                  >
                    {l('渲染预览', 'Preview')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewTab('source')}
                    className={`rounded-md px-2 py-0.5 ${
                      viewTab === 'source'
                        ? 'bg-white font-medium shadow-xs dark:bg-[var(--pq-surface-3)] dark:text-[var(--pq-text)]'
                        : 'text-slate-500 dark:text-[var(--pq-text-muted)]'
                    }`}
                  >
                    {l('Markdown 原文', 'Markdown Source')}
                  </button>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto rounded-xl border border-emerald-200/80 bg-white p-3 shadow-inner dark:border-emerald-500/20 dark:bg-[var(--pq-surface-2)]">
                {viewTab === 'preview' ? (
                  <div className="prose prose-slate max-w-none text-xs dark:prose-invert [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:p-1.5 [&_td]:border [&_td]:border-slate-300 [&_td]:p-1.5">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
                    >
                      {normalizedPreview}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-700 dark:text-[var(--pq-text)]">
                    {reparsedResult}
                  </pre>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 dark:border-white/10">
          <div>
            {hasCustomOverride && onReset ? (
              <button
                type="button"
                onClick={handleRestore}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-white/10 dark:text-[var(--pq-text-muted)] dark:hover:bg-[var(--pq-surface-2)]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{l('恢复原始识别', 'Reset to Original')}</span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-[var(--pq-text-muted)] dark:hover:bg-[var(--pq-surface-2)]"
            >
              {l('取消', 'Cancel')}
            </button>

            <button
              type="button"
              disabled={loading || availablePresets.length === 0}
              onClick={handleStartReparse}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-xs transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
            >
              {loading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>{loading ? l('大模型正在处理…', 'Re-parsing...') : reparsedResult ? l('重新生成', 'Regenerate') : l('开始重新识别', 'Start Re-parse')}</span>
            </button>

            {reparsedResult ? (
              <button
                type="button"
                onClick={handleApply}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-indigo-700"
              >
                <Check className="h-3.5 w-3.5" />
                <span>{l('应用到此区块', 'Apply to Block')}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
