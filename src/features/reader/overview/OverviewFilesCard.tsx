import { useMemo } from 'react';
import { FolderOpen } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { LiteraturePaper } from '../../../types/library';
import type { WorkspaceItem } from '../../../types/reader';
import { usePaperFileLocationMenu } from '../../literature/usePaperFileLocationMenu';
import type { ReaderWorkspaceDocument } from '../readerWorkspaceShared';

/** UI adapter only: standalone documents use the existing P1 path/existence/reveal pipeline. */
export function buildOverviewFilePaper(document: ReaderWorkspaceDocument, pdfPath: string, paper?: LiteraturePaper | null): LiteraturePaper {
  if (paper) return paper;
  const attachment = (path: string, kind: string) => ({ id: kind, paperId: document.itemKey, kind, originalPath: path, storedPath: path, relativePath: null, fileName: path.split(/[\\/]/).pop() || '', mimeType: 'application/pdf', fileSize: 0, contentHash: null, createdAt: 0, missing: false });
  return {
    id: document.itemKey, title: document.title, titleZh: null, year: document.year, publication: null, doi: null, url: null, abstractText: null,
    keywords: [], importedAt: 0, updatedAt: 0, lastReadAt: null, readingProgress: 0, isFavorite: false, userNote: null, aiSummary: null, citation: null,
    source: document.source, sortOrder: 0, authors: [], tags: [], categoryIds: [], ragEnabled: false,
    attachments: [...(pdfPath ? [attachment(pdfPath, 'pdf')] : []), ...(document.translatedPdfPath ? [attachment(document.translatedPdfPath, 'translated-pdf')] : [])],
  };
}

export function OverviewFilesCard({ document, paper, originalPdfPath, currentPdfName, currentJsonName, mineruPath, mineruCacheDir, storageDir, autoLoadSiblingJson, blockCount }: {
  document: ReaderWorkspaceDocument; paper?: LiteraturePaper | null; originalPdfPath: string; currentPdfName: string; currentJsonName: string;
  mineruPath: string; mineruCacheDir: string; storageDir?: string; autoLoadSiblingJson: boolean; blockCount: number;
}) {
  const l = useLocaleText();
  const filePaper = useMemo(() => buildOverviewFilePaper(document, originalPdfPath, paper), [document, originalPdfPath, paper]);
  const workspaceItem = useMemo<WorkspaceItem>(() => ({ ...document, source: document.source as WorkspaceItem['source'], itemType: 'pdf', groupKey: document.workspaceId, localPdfPath: originalPdfPath }), [document, originalPdfPath]);
  const entries = usePaperFileLocationMenu({ paper: filePaper, l, storageDir, mineruCacheDir, autoLoadSiblingJson, workspaceItem, mineruPath });
  const translatedEntries = entries.filter((entry) => !('type' in entry) && entry.id.startsWith('reveal-translated-pdf:'));
  const rows = [
    { id: 'reveal-pdf', label: l('原始 PDF', 'Original PDF'), name: filePaper.attachments.find((attachment) => attachment.kind === 'pdf')?.fileName || currentPdfName },
    ...(translatedEntries.length ? translatedEntries.map((entry) => ({ id: entry.id, label: l('译版 PDF', 'Translated PDF'), name: filePaper.attachments.find((attachment) => `reveal-translated-pdf:${attachment.id}` === entry.id)?.fileName || l('译版 PDF', 'Translated PDF') })) : [{ id: 'translated-missing', label: l('译版 PDF', 'Translated PDF'), name: '' }]),
    { id: 'reveal-mineru-output', label: l('MinerU 结果', 'MinerU output'), name: currentJsonName || mineruPath.split(/[\\/]/).pop() || '' },
  ];
  return <aside className="min-w-0 rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-4" aria-label={l('文件', 'Files')}>
    <h3 className="mb-3 text-sm font-semibold text-[var(--pq-text)]">{l('文件', 'Files')}</h3>
    <dl className="divide-y divide-[var(--pq-border-soft)]">
      {rows.map((row) => {
        const entry = entries.find((candidate) => candidate.id === row.id);
        const action = entry && !('type' in entry) ? entry : null;
        const name = action?.filePath?.split(/[\\/]/).pop() || row.name;
        return <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 py-2">
          <div className="min-w-0"><dt className="text-xs text-[var(--pq-text-muted)]">{row.label}</dt><dd title={name} className="mt-0.5 truncate text-xs text-[var(--pq-text)]">{name || l('未找到', 'Not found')}</dd></div>
          <button type="button" disabled={!action || action.disabled} title={action?.label || l('尚无此文件', 'No file available')} aria-label={action?.label || l(`在文件夹中显示${row.label}（未找到）`, `Show ${row.label} in Folder (not found)`)} className="pq-icon-button !h-8 !w-8 !rounded-[var(--pq-radius-sm)] disabled:opacity-40" onClick={() => { void action?.onSelect(); }}><FolderOpen className="h-4 w-4" /></button>
        </div>;
      })}
      <div className="flex items-center justify-between gap-3 pt-3 text-xs"><dt className="text-[var(--pq-text-muted)]">{l('结构块', 'Structured blocks')}</dt><dd className="tabular-nums text-[var(--pq-text)]">{blockCount}</dd></div>
    </dl>
  </aside>;
}
