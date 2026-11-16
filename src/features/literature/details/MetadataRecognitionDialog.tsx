import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { lookupLiteratureMetadata } from '../../../services/metadata';
import type { LiteraturePaper, UpdatePaperRequest } from '../../../types/library';
import type { MetadataLookupResult } from '../../../types/metadata';
import { Dialog } from '../../../ui/dialog';
import { mergeSelectedPaperMetadata, buildManualMetadataUpdateRequest, buildPaperMetadataDifferences, type PaperMetadataDifference } from './paperMetadataRecognition';

const FIELD_LABEL_EN: Record<PaperMetadataDifference['key'], string> = {
  title: 'Title',
  titleZh: 'Chinese title',
  year: 'Year',
  publication: 'Publication',
  doi: 'DOI',
  url: 'URL',
  abstractText: 'Abstract',
  itemType: 'Item type',
  publisher: 'Publisher',
  institution: 'Institution',
  reportNumber: 'Report number',
  volume: 'Volume',
  issue: 'Issue',
  pages: 'Pages',
  isbn: 'ISBN',
  issn: 'ISSN',
  keywords: 'Keywords',
  tags: 'Tags',
  authors: 'Authors',
  authorDetails: 'Author details',
  language: 'Paper language',
  citationKey: 'Citation key',
  userNote: 'User note',
  aiSummary: 'AI overview',
  citation: 'Citation',
  isFavorite: 'Favorite',
};

interface MetadataRecognitionDialogProps {
  open: boolean;
  paper: LiteraturePaper;
  pdfPath: string | null;
  onClose: () => void;
  onApply: (request: UpdatePaperRequest) => Promise<void>;
}

function displayValue(value: unknown, empty: string): string {
  if (value === null || value === undefined || value === '') return empty;
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function MetadataRecognitionDialog({ open, paper, pdfPath, onClose, onApply }: MetadataRecognitionDialogProps) {
  const l = useLocaleText();
  const [metadata, setMetadata] = useState<MetadataLookupResult | null>(null);
  const [differences, setDifferences] = useState<PaperMetadataDifference[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setMetadata(null);
      setDifferences([]);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void lookupLiteratureMetadata({ doi: paper.doi, title: paper.title, path: pdfPath })
      .then((result) => {
        if (cancelled) return;
        setMetadata(result);
        const request = buildManualMetadataUpdateRequest(paper, result, { title: paper.title, doi: paper.doi ?? '' });
        setDifferences(request ? buildPaperMetadataDifferences(paper, request) : []);
        if (!result) setError(l('没有找到匹配的元数据。', 'No matching metadata was found.'));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : l('元数据识别失败。', 'Metadata lookup failed.'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [l, open, paper, pdfPath]);

  const toggle = (key: PaperMetadataDifference['key'], checked: boolean) => {
    setDifferences((current) => current.map((item) => item.key === key ? { ...item, checked } : item));
  };

  const apply = async () => {
    if (!metadata || saving) return;
    const fullRequest = buildManualMetadataUpdateRequest(paper, metadata, { title: paper.title, doi: paper.doi ?? '' });
    if (!fullRequest) {
      onClose();
      return;
    }
    const request = mergeSelectedPaperMetadata(paper.id, fullRequest, differences.filter((item) => item.checked).map((item) => item.key));
    if (!request) return;
    setSaving(true);
    setError('');
    try {
      await onApply(request);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : l('保存识别结果失败。', 'Could not save recognized metadata.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => { if (!saving) onClose(); }} size="lg" dismissOnBackdrop={!saving} labelledBy="paper-metadata-recognition-title">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="paper-metadata-recognition-title" className="text-base font-semibold text-[var(--pq-text)]">{l('重新识别元数据', 'Re-identify Metadata')}</h2>
            <p className="mt-1 text-xs text-[var(--pq-text-muted)]">{l('逐项检查识别结果；仅勾选的字段会应用。', 'Review each result. Only checked fields will be applied.')}</p>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--pq-accent)]" /> : null}
        </div>

        {loading ? <div className="py-10 text-center text-sm text-[var(--pq-text-muted)]">{l('正在查询元数据…', 'Looking up metadata…')}</div> : null}
        {!loading && differences.length ? (
          <div className="mt-4 max-h-[min(55vh,520px)] space-y-2 overflow-y-auto">
            {differences.map((difference) => (
              <label key={difference.key} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] p-2.5">
                <input type="checkbox" checked={difference.checked} onChange={(event) => toggle(difference.key, event.target.checked)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--pq-text)]">{l(difference.label, FIELD_LABEL_EN[difference.key])}</span>
                  <span className="mt-1 block break-words text-xs leading-5 text-[var(--pq-text-muted)]">{displayValue(difference.current, l('（空）', '(empty)'))} <span className="px-1 text-[var(--pq-text-faint)]">→</span> {displayValue(difference.next, l('（空）', '(empty)'))}</span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
        {!loading && metadata && differences.length === 0 ? <p className="mt-5 rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-2)] p-3 text-sm text-[var(--pq-text-muted)]">{l('没有发现可应用的字段差异。', 'No applicable field differences were found.')}</p> : null}
        {error ? <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-[var(--pq-danger)]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="pq-button px-3 py-2 text-sm">{l('取消', 'Cancel')}</button>
          <button type="button" disabled={loading || saving || !differences.some((item) => item.checked)} onClick={() => void apply()} className="pq-button-primary px-3 py-2 text-sm disabled:opacity-50">{saving ? l('正在保存…', 'Saving…') : l('应用勾选项', 'Apply Selected')}</button>
        </div>
      </div>
    </Dialog>
  );
}
