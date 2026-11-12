import { useEffect, useState } from 'react';
import { Dialog } from '../../../ui/dialog';

interface Props {
  paperTitle: string;
  fileName: string;
  defaultLanguage?: string | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (language: string | null) => Promise<void> | void;
}

const LANGUAGES = ['zh-CN', 'zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'ko'];
const LANGUAGE_ALIASES: Record<string, string> = {
  chinese: 'zh-CN', 'simplified chinese': 'zh-CN', 'traditional chinese': 'zh-TW',
  english: 'en', japanese: 'ja', german: 'de', french: 'fr', spanish: 'es', korean: 'ko',
};

export default function TranslatedPdfLanguageConfirmDialog({ paperTitle, fileName, defaultLanguage, busy = false, onClose, onConfirm }: Props) {
  const [language, setLanguage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    try { setLanguage(defaultLanguage ? Intl.getCanonicalLocales(defaultLanguage)[0] : ''); }
    catch { setLanguage(LANGUAGE_ALIASES[defaultLanguage?.trim().toLowerCase() ?? ''] ?? ''); }
  }, [defaultLanguage]);
  const isBusy = busy || submitting;

  return <Dialog open onClose={() => { if (!isBusy) onClose(); }} size="md" dismissOnBackdrop={!isBusy} labelledBy="attach-translated-language-title">
    <form className="p-5" onSubmit={async (event) => {
      event.preventDefault();
      let target: string | null = null;
      if (language.trim()) {
        try { target = Intl.getCanonicalLocales(language.trim())[0]; }
        catch { setError('请输入有效的 BCP 47 语言标签'); return; }
      }
      setSubmitting(true);
      try { await onConfirm(target); } finally { setSubmitting(false); }
    }}>
      <h2 id="attach-translated-language-title" className="text-lg font-semibold">确认译版语言</h2>
      <p className="mt-2 break-words text-sm text-[var(--pq-text-muted)]">{paperTitle} · {fileName}</p>
      <p className="mt-3 text-sm">请确认所选 PDF 的实际语言。</p>
      <select value={LANGUAGES.includes(language) ? language : ''} onChange={(event) => { setLanguage(event.target.value); setError(''); }} className="pq-input mt-3 w-full">
        <option value="">暂不设置 / 自定义</option><option value="zh-CN">简体中文 (zh-CN)</option><option value="zh-TW">繁体中文 (zh-TW)</option><option value="en">英语 (en)</option><option value="ja">日语 (ja)</option><option value="de">德语 (de)</option><option value="fr">法语 (fr)</option><option value="es">西班牙语 (es)</option><option value="ko">韩语 (ko)</option>
      </select>
      <input value={language} onChange={(event) => { setLanguage(event.target.value); setError(''); }} placeholder="自定义 BCP 47，例如 pt-BR" className="pq-input mt-2 w-full" />
      {error ? <p role="alert" className="mt-2 text-sm text-[var(--pq-danger)]">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={isBusy} onClick={onClose} className="pq-button px-4 py-2 text-sm">取消</button>
        <button type="submit" disabled={isBusy} className="pq-button-primary px-4 py-2 text-sm disabled:opacity-50">{isBusy ? '处理中…' : '附加'}</button>
      </div>
    </form>
  </Dialog>;
}
