import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, X } from 'lucide-react';

import { Dialog } from '../../ui/dialog';
import { SettingsInput } from './readerPreferencesPrimitives';
import type { ReaderPreferencesLocalizer } from './readerPreferencesTypes';

interface BackupPasswordDialogProps {
  open: boolean;
  mode: 'export' | 'import';
  l: ReaderPreferencesLocalizer;
  description?: string;
  confirmLabel?: string;
  error?: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<boolean | void>;
}

function normalizedLength(value: string): number {
  return Array.from(value.normalize('NFC')).length;
}

function passwordStrength(value: string): 0 | 1 | 2 | 3 {
  if (!value) return 0;
  const length = normalizedLength(value);
  const groups = [/\p{Ll}/u.test(value), /\p{Lu}/u.test(value), /\p{N}/u.test(value), /[^\p{L}\p{N}]/u.test(value)]
    .filter(Boolean).length;
  if (length < 8) return 1;
  if (length >= 14 && groups >= 3) return 3;
  return 2;
}

export function BackupPasswordDialog({
  open,
  mode,
  l,
  description,
  confirmLabel,
  error,
  busy = false,
  onClose,
  onSubmit,
}: BackupPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const strength = useMemo(() => passwordStrength(password), [password]);
  const isExport = mode === 'export';
  const isMatching = password.normalize('NFC') === confirmation.normalize('NFC');
  const isLengthValid = normalizedLength(password) >= 8 && normalizedLength(password) <= 256;
  const disabled = submitting || busy || !isLengthValid || (isExport && (!isMatching || !confirmation));

  useEffect(() => {
    if (!open) {
      setPassword('');
      setConfirmation('');
      setShowPassword(false);
      setSubmitting(false);
      setLocalError('');
    }
  }, [open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;

    const submittedPassword = password;
    setPassword('');
    setConfirmation('');
    setLocalError('');
    setSubmitting(true);

    try {
      const accepted = await onSubmit(submittedPassword);
      if (accepted !== false) onClose();
    } catch {
      setLocalError(l('操作失败，请重试。', 'The operation failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const strengthLabel = strength === 0
    ? l('未设置', 'Not set')
    : strength === 1
      ? l('弱', 'Weak')
      : strength === 2
        ? l('中', 'Fair')
        : l('强', 'Strong');
  const strengthColor = strength === 3
    ? 'bg-[var(--pq-success)]'
    : strength === 2
      ? 'bg-[var(--pq-warning)]'
      : 'bg-[var(--pq-danger)]';
  const title = isExport
    ? l('设置备份读取密码', 'Set Backup Password')
    : l('输入备份读取密码', 'Enter Backup Password');

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!submitting && !busy) onClose();
      }}
      size="md"
      overlay="strong"
      dismissOnBackdrop={!submitting && !busy}
      labelledBy="backup-password-title"
      describedBy="backup-password-description"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]">
              <KeyRound className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <h2 id="backup-password-title" className="text-base font-semibold text-[var(--pq-text)]">
                  {title}
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting || busy}
                  className="pq-icon-button h-8 w-8 shrink-0 disabled:opacity-60"
                  aria-label={l('关闭对话框', 'Close dialog')}
                  title={l('关闭', 'Close')}
                >
                  <X className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
              <p id="backup-password-description" className="mt-2 text-sm leading-5 text-[var(--pq-text-muted)]">
                {description ?? (isExport
                  ? l('密码至少 8 个字符，且无法找回。请妥善保管。', 'Use at least 8 characters. The password cannot be recovered; store it safely.')
                  : l('密码错误或备份包已损坏时，系统会显示统一提示。', 'An incorrect password and a damaged package produce the same error message.'))}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--pq-text-muted)]">
                {l('读取密码', 'Password')}
              </span>
              <span className="relative block">
                <SettingsInput
                  autoFocus
                  autoComplete="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  maxLength={256}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-11"
                  aria-describedby={isExport ? 'backup-password-strength' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="pq-icon-button absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2"
                  aria-label={showPassword ? l('隐藏密码', 'Hide password') : l('显示密码', 'Show password')}
                  title={showPassword ? l('隐藏密码', 'Hide password') : l('显示密码', 'Show password')}
                >
                  {showPassword
                    ? <EyeOff className="h-4 w-4" strokeWidth={1.8} />
                    : <Eye className="h-4 w-4" strokeWidth={1.8} />}
                </button>
              </span>
            </label>

            {isExport ? (
              <>
                <div id="backup-password-strength" className="flex items-center gap-3" aria-live="polite">
                  <div className="flex flex-1 gap-1" aria-hidden="true">
                    {[1, 2, 3].map((step) => (
                      <span
                        key={step}
                        className={`h-1.5 flex-1 rounded-full ${strength >= step ? strengthColor : 'bg-[var(--pq-surface-3)]'}`}
                      />
                    ))}
                  </div>
                  <span className="min-w-12 text-right text-xs text-[var(--pq-text-muted)]">
                    {l('强度', 'Strength')}：{strengthLabel}
                  </span>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-[var(--pq-text-muted)]">
                    {l('再次输入密码', 'Confirm password')}
                  </span>
                  <SettingsInput
                    autoComplete="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmation}
                    maxLength={256}
                    onChange={(event) => setConfirmation(event.target.value)}
                    aria-invalid={Boolean(confirmation) && !isMatching}
                  />
                  {confirmation && !isMatching ? (
                    <span className="mt-1 block text-xs text-[var(--pq-danger)]">
                      {l('两次输入不一致', 'Passwords do not match')}
                    </span>
                  ) : null}
                </label>
              </>
            ) : null}

            {error || localError ? (
              <div role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--pq-danger)_28%,transparent)] bg-[var(--pq-danger-bg)] px-3 py-2 text-xs leading-5 text-[var(--pq-danger)]">
                {error || localError}
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting || busy}
              className="pq-button px-4 py-2 text-sm disabled:opacity-60"
            >
              {l('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={disabled}
              className="pq-button-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {submitting || busy
                ? l('处理中…', 'Working…')
                : confirmLabel ?? (isExport ? l('开始加密导出', 'Start Encrypted Export') : l('检查备份包', 'Inspect Backup'))}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
