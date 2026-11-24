import { Sparkles } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { Dialog } from '../../../ui/dialog';
import type { LiteraturePaper } from '../../../types/library';
import { paperPdfPath } from '../literatureUi';

export interface MetadataParseDialogState {
  paper: LiteraturePaper;
  title: string;
  doi: string;
}

interface MetadataParseDialogProps {
  state: MetadataParseDialogState | null;
  busy: boolean;
  storageDir: string;
  onChangeTitle: (value: string) => void;
  onChangeDoi: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** 元数据解析对话框：从 LiteratureLibraryView 原样搬出，props/DOM/文案/键盘行为不变。 */
export default function MetadataParseDialog({
  state,
  busy,
  storageDir,
  onChangeTitle,
  onChangeDoi,
  onClose,
  onSubmit,
}: MetadataParseDialogProps) {
  const l = useLocaleText();

  return (
    <Dialog
      open={state !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissOnBackdrop={!busy}
      size="md"
      labelledBy="pq-metadata-dialog-title"
    >
      {state ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="flex items-start gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]">
              <Sparkles className="h-4.5 w-4.5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="pq-metadata-dialog-title" className="text-base font-semibold text-[var(--pq-text)]">
                {l('解析元数据', 'Parse Metadata')}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--pq-text-muted)]">
                {l('先修正标题或 DOI，再用这些信息重新匹配并更新文献元数据。', 'Correct the title or DOI first, then use them to match and update paper metadata.')}
              </p>
            </div>
          </div>

          <div className="px-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--pq-text-muted)]">
                {l('标题', 'Title')}
              </span>
              <input
                value={state.title}
                onChange={(event) => onChangeTitle(event.target.value)}
                className="pq-input h-10 w-full px-3 text-sm"
              />
            </label>

            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--pq-text-muted)]">
                DOI
              </span>
              <input
                value={state.doi}
                onChange={(event) => onChangeDoi(event.target.value)}
                placeholder="10.xxxx/xxxxx"
                className="pq-input h-10 w-full px-3 text-sm"
              />
            </label>

            <div className="mt-3 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border-subtle)] bg-[var(--pq-bg-secondary)] px-3 py-2 text-xs leading-5 text-[var(--pq-text-faint)]">
              <div className="font-medium text-[var(--pq-text-muted)]">{l('PDF 文件', 'PDF File')}</div>
              <div
                className="mt-0.5 truncate"
                title={paperPdfPath(state.paper, storageDir) || undefined}
              >
                {paperPdfPath(state.paper, storageDir) ||
                  l('未找到 PDF 路径', 'No PDF path found')}
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2 p-4 pt-0">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="pq-button h-9 px-3 text-sm"
            >
              {l('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="pq-button-primary h-9 px-3 text-sm disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.9} />
              {busy ? l('解析中...', 'Parsing...') : l('解析并更新', 'Parse and Update')}
            </button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
