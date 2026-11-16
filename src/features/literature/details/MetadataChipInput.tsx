import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';

interface MetadataChipInputProps {
  label: string;
  values: string[];
  suggestions?: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}

export default function MetadataChipInput({
  label,
  values,
  suggestions = [],
  placeholder,
  onChange,
}: MetadataChipInputProps) {
  const l = useLocaleText();
  const [input, setInput] = useState('');
  const inputId = `paper-details-${useId().replace(/:/g, '')}-input`;
  const listId = `${inputId}-suggestions`;

  const add = (value: string) => {
    const additions = value.split(/[;,，；\n]/).map((item) => item.trim()).filter(Boolean);
    const seen = new Set(values.map((item) => item.toLocaleLowerCase()));
    const next = [...values];
    for (const item of additions) {
      const key = item.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        next.push(item);
      }
    }
    if (next.length !== values.length) onChange(next);
    setInput('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(input);
    } else if (event.key === 'Backspace' && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-[var(--pq-text-muted)]">{label}</label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-2 py-1.5">
        {values.map((value, index) => (
          <span key={`${value}:${index}`} className="pq-chip inline-flex items-center gap-1 px-2 py-1 text-xs">
            {value}
            <button
              type="button"
              className="pq-icon-button !h-4 !w-4 !rounded-full"
              aria-label={l(`移除 ${value}`, `Remove ${value}`)}
              onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={input}
          list={suggestions.length ? listId : undefined}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text');
            if (/[;,，；\n]/.test(text)) {
              event.preventDefault();
              add(text);
            }
          }}
          onBlur={() => { if (input.trim()) add(input); }}
          placeholder={values.length === 0 ? placeholder : undefined}
          className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]"
        />
      </div>
      {suggestions.length ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
      ) : null}
    </div>
  );
}
