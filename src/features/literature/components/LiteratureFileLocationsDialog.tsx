import { useEffect, useState } from 'react';
import { ExternalLink, FolderOpen, Loader2, X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import {
  listLiteratureFileLocations,
  revealLiteratureFileLocation,
  type LiteratureFileLocation,
} from '../../../services/literatureFileLocations';

interface Props {
  paperId: string;
  paperTitle: string;
  evidenceId?: string;
  onClose: () => void;
}

function roleLabel(role: string, l: (zh: string, en: string) => string): string {
  if (role === 'original-pdf') return l('原文 PDF', 'Original PDF');
  if (role === 'translated-pdf') return l('译文 PDF', 'Translated PDF');
  if (role === 'parsed-markdown') return l('解析 Markdown', 'Parsed Markdown');
  if (role === 'associated-markdown') return l('已关联 Markdown', 'Associated Markdown');
  if (role === 'parse-directory') return l('解析目录', 'Parse directory');
  if (role === 'parse-images') return l('解析图片目录', 'Parsed images directory');
  if (role === 'parse-artifact') return l('解析产物', 'Parse artifact');
  if (role.startsWith('associated:')) return l(`关联附件：${role.slice('associated:'.length)}`, `Associated attachment: ${role.slice('associated:'.length)}`);
  return role.endsWith('.json') ? l(`解析数据：${role}`, `Parse data: ${role}`) : role;
}

export default function LiteratureFileLocationsDialog({ paperId, paperTitle, evidenceId, onClose }: Props) {
  const l = useLocaleText();
  const [locations, setLocations] = useState<LiteratureFileLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void listLiteratureFileLocations(paperId, evidenceId).then((result) => {
      if (active) setLocations(result);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [paperId, evidenceId]);

  const openLocation = async (location: LiteratureFileLocation) => {
    setBusyId(location.id);
    setError('');
    try {
      await revealLiteratureFileLocation(paperId, location.id, evidenceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      // The source can disappear between listing and use; refresh to show its current state.
      try { setLocations(await listLiteratureFileLocations(paperId, evidenceId)); } catch {}
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="literature-file-locations-title" className="pq-card w-full max-w-xl p-5 shadow-[var(--pq-shadow-dialog)]">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="literature-file-locations-title" className="text-base font-semibold">{l('打开所在位置', 'Open file location')}</h2>
            <p className="mt-1 truncate text-sm text-[var(--pq-text-muted)]" title={paperTitle}>{paperTitle}</p>
          </div>
          <button type="button" className="pq-icon-button" aria-label={l('关闭', 'Close')} onClick={onClose}><X className="h-4 w-4" /></button>
        </header>
        {loading ? <div className="flex items-center gap-2 py-6 text-sm text-[var(--pq-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" />{l('正在检查已关联的位置…', 'Checking associated locations…')}</div> : null}
        {!loading && locations.length === 0 ? <p className="py-5 text-sm text-[var(--pq-text-muted)]">{l('没有已登记的本地文件或解析产物。', 'No registered local files or parsed artifacts were found.')}</p> : null}
        <div className="max-h-[55vh] space-y-1 overflow-y-auto">
          {locations.map((location) => {
            const available = location.status === 'available';
            const label = location.status === 'missing'
              ? l('文件缺失', 'File missing')
              : location.status === 'version-mismatch'
                ? l('文件版本与登记证据不符', 'File does not match its recorded version')
              : location.status === 'remote-only'
                ? l('远端来源，无本地文件', 'Remote source; no local file')
                : location.status === 'not-generated'
                  ? l('尚未生成', 'Not generated')
                  : location.versionStatus === 'version-unverified'
                    ? l('版本未核实', 'Version unverified')
                    : l('已关联', 'Associated');
            return (
              <button key={location.id} type="button" disabled={!available || Boolean(busyId)} onClick={() => void openLocation(location)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--pq-hover)] disabled:cursor-default disabled:opacity-65">
                {location.targetKind === 'directory' ? <FolderOpen className="h-4 w-4 shrink-0 text-[var(--pq-accent)]" /> : <ExternalLink className="h-4 w-4 shrink-0 text-[var(--pq-accent)]" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{roleLabel(location.role, l)}{location.language ? ` · ${location.language}` : ''}{location.generationId ? ` · ${location.isCurrentGeneration ? l('当前版本', 'current') : l('历史版本', 'history')} ${location.generationId.slice(0, 8)}` : ''}</span>
                  <span className="block truncate text-xs text-[var(--pq-text-muted)]">{location.fileName || label}</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--pq-text-faint)]">{busyId === location.id ? l('正在打开…', 'Opening…') : label}</span>
              </button>
            );
          })}
        </div>
        {error ? <p role="alert" className="mt-3 text-sm text-[var(--pq-danger)]">{error}</p> : null}
      </section>
    </div>
  );
}
