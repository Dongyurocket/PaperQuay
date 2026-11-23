import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog } from './dialog';

/**
 * 单行文本输入对话框。
 *
 * 背景：文库分类/标签重命名与笔记批量加标签此前各自实现模态或直接调用
 * `window.prompt`（E2）。这里统一为 Dialog + 受控输入，带 dialog 语义、
 * 焦点陷阱与 Esc 关闭（Dialog 提供）。
 */

export interface TextInputDialogProps {
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

const TITLE_ID = 'pq-text-input-dialog-title';

export function TextInputDialog({
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
}: TextInputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue, open]);

  const trimmedValue = value.trim();

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissOnBackdrop={!busy}
      labelledBy={TITLE_ID}
      className="max-w-md"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="text-lg font-semibold text-[var(--pq-text)]">
              {title}
            </h2>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-[var(--pq-text-muted)]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pq-icon-button h-9 w-9 shrink-0 disabled:opacity-60"
            aria-label={cancelLabel}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--pq-text-faint)]">
            {label}
          </span>
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmedValue && !busy) {
                event.preventDefault();
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
    </Dialog>
  );
}

export default TextInputDialog;
