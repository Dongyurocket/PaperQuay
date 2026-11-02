import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface LibraryTextInputDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export default function LibraryTextInputDialog({
  open,
  title,
  description,
  label,
  initialValue,
  placeholder,
  confirmLabel,
  cancelLabel,
  busy = false,
  onClose,
  onSubmit,
}: LibraryTextInputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setValue(initialValue);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue, open]);

  if (!open) {
    return null;
  }

  const trimmedValue = value.trim();

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4 backdrop-blur-[2px] dark:bg-black/45">
      <div className="pq-card w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--pq-text)]">
              {title}
            </h2>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-[var(--pq-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pq-icon-button h-9 w-9 shrink-0 disabled:opacity-60"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--pq-text-faint)] dark:text-[#8d8d8d]">
            {label}
          </span>
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onClose();
              }

              if (event.key === 'Enter' && trimmedValue) {
                onSubmit(trimmedValue);
              }
            }}
            className="pq-input h-11 w-full px-3 text-sm placeholder:text-[var(--pq-text-faint)]"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pq-button px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onSubmit(trimmedValue)}
            disabled={busy || !trimmedValue}
            className="pq-button-primary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
