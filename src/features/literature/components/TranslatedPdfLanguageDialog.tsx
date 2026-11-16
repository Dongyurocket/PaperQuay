import { useEffect, useState } from 'react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { Dialog } from '../../../ui/dialog';
import { canonicalizeBcp47Language } from '../metadataValidation';

interface TranslatedPdfLanguageDialogProps {
  paperTitle: string;
  fileName: string;
  language: string | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (language: string) => Promise<void> | void;
  onClear: () => Promise<void> | void;
}

const COMMON_LANGUAGES = ['zh-CN', 'zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'ko'];

export default function TranslatedPdfLanguageDialog({
  paperTitle,
  fileName,
  language,
  saving = false,
  onClose,
  onSave,
  onClear,
}: TranslatedPdfLanguageDialogProps) {
  const l = useLocaleText();
  const [draft, setDraft] = useState(language ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const busy = saving || submitting;

  useEffect(() => {
    setDraft(language ?? '');
    setError('');
  }, [language]);

  const submit = async () => {
    const nextLanguage = canonicalizeBcp47Language(draft);

    if (!nextLanguage) {
      setError(l('请输入有效的 BCP 47 语言标签', 'Enter a valid BCP 47 language tag'));
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await onSave(nextLanguage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : l('更新失败', 'Update failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const clear = async () => {
    setSubmitting(true);
    setError('');

    try {
      await onClear();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : l('更新失败', 'Update failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      size="md"
      dismissOnBackdrop={!busy}
      labelledBy="translated-language-title"
      className="!bg-[var(--pq-surface-1)]"
    >
      <form
        className="p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id="translated-language-title" className="text-base font-semibold text-[var(--pq-text)]">
          {l('设置译版语言', 'Set translated PDF language')}
        </h2>
        <p className="mt-2 break-words text-xs text-[var(--pq-text-muted)]">
          {paperTitle} · {fileName}
        </p>
        <label htmlFor="translated-language-preset" className="mt-4 block text-xs font-medium text-[var(--pq-text)]">
          {l('BCP 47 语言标签', 'BCP 47 language tag')}
        </label>
        <select
          id="translated-language-preset"
          value={COMMON_LANGUAGES.includes(draft) ? draft : ''}
          onChange={(event) => {
            setDraft(event.target.value);
            setError('');
          }}
          className="pq-input mt-1 w-full"
        >
          <option value="">{l('自定义 / 暂不设置', 'Custom / leave unset')}</option>
          <option value="zh-CN">{l('简体中文 (zh-CN)', 'Simplified Chinese (zh-CN)')}</option>
          <option value="zh-TW">{l('繁体中文 (zh-TW)', 'Traditional Chinese (zh-TW)')}</option>
          <option value="en">{l('英语 (en)', 'English (en)')}</option>
          <option value="ja">{l('日语 (ja)', 'Japanese (ja)')}</option>
          <option value="de">{l('德语 (de)', 'German (de)')}</option>
          <option value="fr">{l('法语 (fr)', 'French (fr)')}</option>
          <option value="es">{l('西班牙语 (es)', 'Spanish (es)')}</option>
          <option value="ko">{l('韩语 (ko)', 'Korean (ko)')}</option>
        </select>
        <input
          aria-label={l('自定义译版语言标签', 'Custom translated language tag')}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError('');
          }}
          placeholder={l('zh-CN、en、ja-JP…', 'zh-CN, en, ja-JP…')}
          className="pq-input mt-2 w-full"
        />
        {error ? <p role="alert" className="mt-2 text-xs text-[var(--pq-danger)]">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            disabled={busy || !language}
            onClick={() => void clear()}
            className="pq-button px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {l('清除语言', 'Clear language')}
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" disabled={busy} onClick={onClose} className="pq-button px-3 py-1.5 text-xs">
              {l('取消', 'Cancel')}
            </button>
            <button type="submit" disabled={busy || !draft.trim()} className="pq-button-primary px-3 py-1.5 text-xs disabled:opacity-50">
              {busy ? l('保存中…', 'Saving…') : l('保存', 'Save')}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
