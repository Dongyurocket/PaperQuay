import { useMemo, useState } from 'react';
import type { LiteraturePaper, TranslatedPdfLanguageChange } from '../../../types/library';
import { Dialog } from '../../../ui/dialog';

export interface TranslatedPdfLanguageBatchEntry {
  paper: LiteraturePaper;
  attachmentId: string;
  fileName: string;
  language: string | null;
}

interface Props {
  entries: TranslatedPdfLanguageBatchEntry[];
  skippedCount: number;
  saving: boolean;
  onClose: () => void;
  onSave: (changes: TranslatedPdfLanguageChange[]) => Promise<void>;
}

const COMMON_LANGUAGES = ['zh-CN', 'zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'ko'];
const isUnknown = (value: string | null) => !value || ['und', 'unknown', 'undefined'].includes(value.toLowerCase());

export default function TranslatedPdfLanguageBatchDialog({ entries, skippedCount, saving, onClose, onSave }: Props) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(entries.filter((entry) => isUnknown(entry.language)).map((entry) => entry.attachmentId)));
  const [language, setLanguage] = useState('zh-CN');
  const [clear, setClear] = useState(false);
  const [error, setError] = useState('');
  const selected = useMemo(() => entries.filter((entry) => selectedIds.has(entry.attachmentId)), [entries, selectedIds]);
  let normalizedLanguage = '';
  if (!clear) {
    try { normalizedLanguage = Intl.getCanonicalLocales(language.trim())[0] ?? ''; }
    catch { normalizedLanguage = ''; }
  }
  const actualChanges = selected.filter((entry) => clear
    ? entry.language !== null
    : !normalizedLanguage || entry.language !== normalizedLanguage).length;

  return <Dialog open onClose={() => { if (!saving) onClose(); }} size="xl" dismissOnBackdrop={!saving} labelledBy="translated-language-batch-title">
    <div className="p-5">
      <h2 id="translated-language-batch-title" className="text-lg font-semibold">设置译版语言</h2>
      <p className="mt-2 text-sm text-[var(--pq-text-muted)]">已选文献 {new Set(entries.map((entry) => entry.paper.id)).size} 篇 · 译版附件 {entries.length} 个 · 实际变更 {actualChanges} 项 · 跳过 {skippedCount} 篇（无译版）</p>
      <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clear} onChange={(event) => setClear(event.target.checked)} />清除语言</label>
      <select disabled={clear} value={COMMON_LANGUAGES.includes(language) ? language : ''} onChange={(event) => setLanguage(event.target.value)} className="pq-input">
        <option value="">自定义语言</option><option value="zh-CN">简体中文 (zh-CN)</option><option value="zh-TW">繁体中文 (zh-TW)</option><option value="en">英语 (en)</option><option value="ja">日语 (ja)</option><option value="de">德语 (de)</option><option value="fr">法语 (fr)</option><option value="es">西班牙语 (es)</option><option value="ko">韩语 (ko)</option>
      </select>
      <input disabled={clear} value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="BCP 47 语言标签" className="pq-input min-w-32 flex-1" />
    </div>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-[var(--pq-danger)]">{error}</p> : null}
      <div className="mt-4 max-h-[50vh] overflow-auto rounded-lg border border-[var(--pq-border)]">
      <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-[var(--pq-panel)]"><tr><th className="p-2">应用</th><th className="p-2">文献 / 附件</th><th className="p-2">原值</th><th className="p-2">保存后</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.attachmentId} className="border-t border-[var(--pq-border)]">
          <td className="p-2"><input type="checkbox" checked={selectedIds.has(entry.attachmentId)} disabled={saving} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(entry.attachmentId) : next.delete(entry.attachmentId); return next; })} /></td>
          <td className="max-w-[28rem] p-2"><div className="truncate" title={entry.paper.title}>{entry.paper.title}</div><div className="truncate text-[var(--pq-muted)]" title={entry.fileName}>{entry.fileName}</div></td>
          <td className="p-2">{isUnknown(entry.language) ? `语言待确认${entry.language ? `（原值 ${entry.language}）` : '（原值为空）'}` : entry.language}</td><td className="p-2">{clear ? '语言待确认' : normalizedLanguage || language}</td>
        </tr>)}</tbody>
      </table>
      {entries.length === 0 ? <p className="p-4 text-sm text-[var(--pq-muted)]">所选文献没有已登记的译版附件。</p> : null}
      </div>
      {skippedCount > 0 ? <p className="mt-2 text-xs text-[var(--pq-text-muted)]">{skippedCount} 篇文献没有译版附件，已跳过。</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={onClose} className="pq-button px-4 py-2 text-sm">取消</button>
        <button type="button" disabled={saving || actualChanges === 0} onClick={() => {
          if (actualChanges === 0) return;
          let target: string | null = null;
          if (!clear) {
            try { [target] = Intl.getCanonicalLocales(language.trim()); }
            catch { setError('请输入有效的 BCP 47 语言标签'); return; }
          }
          setError('');
          void onSave(selected.filter((entry) => entry.language !== target).map((entry) => ({
            paperId: entry.paper.id,
            attachmentId: entry.attachmentId,
            expectedLanguage: entry.language,
            language: target,
          })));
        }} className="pq-button-primary px-4 py-2 text-sm disabled:opacity-50">{saving ? '保存中…' : `保存 ${actualChanges} 项变更`}</button>
      </div>
    </div>
  </Dialog>;
}
