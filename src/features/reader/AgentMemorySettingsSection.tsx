import { Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  clearAgentMemory,
  readAgentMemory,
  writeAgentMemory,
  type AgentMemoryFile,
} from '../../services/agentMemory';
import { SettingsField, SettingsSelect } from './readerPreferencesPrimitives';
import type { ReaderPreferencesLocalizer } from './readerPreferencesTypes';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AgentMemorySettingsSection({
  active,
  l,
}: {
  active: boolean;
  l: ReaderPreferencesLocalizer;
}) {
  const [file, setFile] = useState<AgentMemoryFile>('topics');
  const [date, setDate] = useState(todayDate);
  const [content, setContent] = useState('');
  const [size, setSize] = useState(0);
  const [modifiedAt, setModifiedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result = await readAgentMemory(file, file === 'trace' ? date : undefined);
      setContent(result.content);
      setSize(result.size);
      setModifiedAt(result.modifiedAt);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [date, file]);

  useEffect(() => {
    if (active) {
      void load();
    }
  }, [active, load]);

  if (!active) {
    return null;
  }

  const save = async () => {
    setSaving(true);
    setError('');

    try {
      const result = await writeAgentMemory(file, content, file === 'trace' ? date : undefined);
      setContent(result.content);
      setSize(result.size);
      setModifiedAt(result.modifiedAt);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    const label = file === 'trace' ? l('今日 L1 trace', 'today\'s L1 trace') : file === 'topics' ? 'L2' : 'L3';

    if (!window.confirm(l(`确认清空 ${label}？`, `Clear ${label}?`))) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const result = await clearAgentMemory(file, file === 'trace' ? date : undefined);
      setContent(result.content);
      setSize(result.size);
      setModifiedAt(result.modifiedAt);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsField
      label={l('Agent 记忆', 'Agent Memory')}
      description={l('本地 L1 trace、L2 主题和 L3 综合记忆。', 'Local L1 trace, L2 topic, and L3 synthesis memory.')}
    >
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <SettingsSelect value={file} onChange={(event) => setFile(event.target.value as AgentMemoryFile)}>
            <option value="trace">L1 trace</option>
            <option value="topics">L2 topics</option>
            <option value="synthesis">L3 synthesis</option>
          </SettingsSelect>
          {file === 'trace' ? (
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value || todayDate())}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text)]"
            />
          ) : null}
        </div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="min-h-44 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs leading-5 text-slate-900 outline-none focus:border-[var(--pq-accent)] focus:bg-white dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text)]"
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-[var(--pq-text-faint)]">
          <span>{size} B{modifiedAt ? ` · ${new Date(modifiedAt).toLocaleString()}` : ''}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} disabled={loading || saving} className="pq-icon-button h-8 w-8" title={l('刷新', 'Refresh')}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={() => void save()} disabled={loading || saving} className="pq-button px-3 py-1.5 text-xs">
              <Save className="h-3.5 w-3.5" />
              {l('保存', 'Save')}
            </button>
            <button type="button" onClick={() => void clear()} disabled={loading || saving || !content} className="pq-button px-3 py-1.5 text-xs text-rose-600 dark:text-rose-300">
              <Trash2 className="h-3.5 w-3.5" />
              {l('清空', 'Clear')}
            </button>
          </div>
        </div>
        {error ? <div className="text-xs text-rose-600 dark:text-rose-300">{error}</div> : null}
      </div>
    </SettingsField>
  );
}
