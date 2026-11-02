import { useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import { useAppLocale, useLocaleText } from '../../../i18n/uiLanguage';
import { Dialog } from '../../../ui/dialog';
import type { LiteratureCategory } from '../../../types/library';
import { getFileNameFromPath, truncateMiddle } from '../../../utils/text';
import type { ImportDraftItem } from '../importTypes';
import { categoryDisplayName } from '../literatureUi';

interface ImportConfirmationDialogProps {
  open: boolean;
  drafts: ImportDraftItem[];
  categories: LiteratureCategory[];
  working: boolean;
  metadataWorking: boolean;
  onDraftChange: (path: string, patch: Partial<ImportDraftItem>) => void;
  onRemoveDraft: (path: string) => void;
  onAutoFillMetadata: () => void;
  onClose: () => void;
  onConfirm: () => void;
}

function userCategories(categories: LiteratureCategory[]) {
  return categories.filter((category) => !category.isSystem);
}

function FieldLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--pq-text-faint)]">
      {children}
    </div>
  );
}

function InputField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="pq-input h-10 w-full px-3 text-sm"
    />
  );
}

function TextareaField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={3}
      className="pq-input min-h-[84px] w-full resize-y px-3 py-2.5 text-sm leading-5"
    />
  );
}

export default function ImportConfirmationDialog({
  open,
  drafts,
  categories,
  working,
  metadataWorking,
  onDraftChange,
  onRemoveDraft,
  onAutoFillMetadata,
  onClose,
  onConfirm,
}: ImportConfirmationDialogProps) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef: panelRef });
  const editableCategories = userCategories(categories);

  if (!open) {
    return null;
  }

  const requestClose = () => {
    if (!working) onClose();
  };

  return (
    <Dialog
      open
      onClose={requestClose}
      overlay="strong"
      dismissOnBackdrop={false}
      labelledBy="pq-import-confirm-title"
      className="flex max-h-[min(760px,calc(100vh-32px))] max-w-[min(1120px,calc(100vw-32px))] flex-col bg-[var(--pq-surface-1)] text-[var(--pq-text)]"
    >
      {/* 滚轮委派需要一个「包含滚动目标」的根元素；contents 让这层不参与布局。 */}
      <div ref={panelRef} onWheelCapture={handleWheelCapture} className="contents">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--pq-border)] px-6 py-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--pq-text-faint)]">
              {l('导入确认', 'Import Confirmation')}
            </div>
            <h2 id="pq-import-confirm-title" className="mt-1 text-2xl font-semibold tracking-tight">
              {l('确认 PDF 元数据后再加入文献库', 'Confirm PDF metadata before adding to the library')}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--pq-text-muted)]">
              {l(
                '系统会先从 PDF 本地信息里提取标题和 DOI，再按需优先通过 OpenAlex 补全，Crossref 作为兜底；导入前你仍然可以手动修改。',
                'The app extracts title and DOI from the local PDF first, then enriches metadata with OpenAlex first and Crossref as fallback. You can still edit everything before import.',
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="pq-icon-button h-10 w-10 shrink-0 border border-[var(--pq-border)] bg-[var(--pq-surface-1)] disabled:opacity-60"
            aria-label={l('关闭', 'Close')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </header>

        <div
          data-wheel-scroll-target
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-6 py-5"
        >
          <div className="space-y-4">
            {drafts.map((draft, index) => (
              <section
                key={draft.path}
                className="pq-card p-4"
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--pq-accent)]">
                      {l(`文件 ${index + 1}`, `File ${index + 1}`)}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-[var(--pq-text)]">
                      {getFileNameFromPath(draft.path)}
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--pq-text-faint)]">
                      {truncateMiddle(draft.path, 96)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveDraft(draft.path)}
                    disabled={working}
                    className="pq-button px-3 py-2 text-xs text-[var(--pq-text-muted)] hover:text-[var(--pq-danger)] disabled:opacity-60"
                  >
                    {l('移除', 'Remove')}
                  </button>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <label className="lg:col-span-2">
                    <FieldLabel>{l('标题', 'Title')}</FieldLabel>
                    <InputField
                      value={draft.title}
                      onChange={(value) => onDraftChange(draft.path, { title: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>{l('作者', 'Authors')}</FieldLabel>
                    <InputField
                      value={draft.authors}
                      placeholder={l('多个作者用逗号分隔', 'Separate with commas')}
                      onChange={(value) => onDraftChange(draft.path, { authors: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>{l('年份', 'Year')}</FieldLabel>
                    <InputField
                      value={draft.year}
                      placeholder="2026"
                      onChange={(value) => onDraftChange(draft.path, { year: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>{l('期刊 / 会议', 'Venue')}</FieldLabel>
                    <InputField
                      value={draft.publication}
                      onChange={(value) => onDraftChange(draft.path, { publication: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>DOI</FieldLabel>
                    <InputField
                      value={draft.doi}
                      placeholder="10.xxxx/xxxxx"
                      onChange={(value) => onDraftChange(draft.path, { doi: value })}
                    />
                  </label>

                  <label>
                    <FieldLabel>URL</FieldLabel>
                    <InputField
                      value={draft.url}
                      placeholder="https://doi.org/..."
                      onChange={(value) => onDraftChange(draft.path, { url: value })}
                    />
                  </label>

                  <label className="lg:col-span-3">
                    <FieldLabel>{l('目标分类', 'Target Category')}</FieldLabel>
                    <select
                      value={draft.categoryId}
                      onChange={(event) => onDraftChange(draft.path, { categoryId: event.target.value })}
                      className="pq-input h-10 w-full px-3 text-sm"
                    >
                      <option value="">{l('不指定分类', 'No Category')}</option>
                      {editableCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {categoryDisplayName(category, locale)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="lg:col-span-3">
                    <FieldLabel>{l('摘要', 'Abstract')}</FieldLabel>
                    <TextareaField
                      value={draft.abstractText}
                      placeholder={l('自动补全后会写入文献详情，可留空。', 'Enriched metadata will be saved to paper details. Optional.')}
                      onChange={(value) => onDraftChange(draft.path, { abstractText: value })}
                    />
                  </label>
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--pq-border)] px-6 py-4">
          <div className="text-sm text-[var(--pq-text-muted)]">
            {l(`待导入 ${drafts.length} 个 PDF`, `${drafts.length} PDFs pending import`)}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAutoFillMetadata}
              disabled={working || metadataWorking || drafts.length === 0}
              className="pq-button px-4 py-2.5 text-sm text-[var(--pq-accent)] disabled:opacity-60"
            >
              <RefreshCw
                className={metadataWorking ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'}
                strokeWidth={1.9}
              />
              {metadataWorking ? l('正在补全...', 'Enriching...') : l('自动补全元数据', 'Auto-Fill Metadata')}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={working}
              className="pq-button px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {l('取消', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={working || drafts.length === 0}
              className="pq-button-primary px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {working ? l('正在导入...', 'Importing...') : l('确认导入', 'Confirm Import')}
            </button>
          </div>
        </footer>
      </div>
    </Dialog>
  );
}
