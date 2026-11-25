import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { LibraryTagCount } from '../../../types/library';
import { itemTypeLabel, LIBRARY_ITEM_TYPES, type LibraryFilterState } from '../libraryFilters';

interface Props {
  id: string;
  anchor: HTMLElement;
  filters: LibraryFilterState;
  tags: LibraryTagCount[];
  /** 演示库没有真实 RAG 索引，状态筛选禁用。 */
  ragStatusDisabled?: boolean;
  onChange: (filters: LibraryFilterState) => void;
  onClose: () => void;
}

export default function LiteratureFilterPopover({ id, anchor, filters, tags, ragStatusDisabled, onChange, onClose }: Props) {
  const l = useLocaleText();
  const root = useRef<HTMLDivElement>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [yearFrom, setYearFrom] = useState(filters.yearFrom?.toString() ?? '');
  const [yearTo, setYearTo] = useState(filters.yearTo?.toString() ?? '');
  const [, setPositionRevision] = useState(0);
  useEffect(() => {
    root.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus(); } };
    const focusOutside = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    };
    const reposition = () => setPositionRevision((value) => value + 1);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [anchor, onClose]);
  useEffect(() => { setYearFrom(filters.yearFrom?.toString() ?? ''); setYearTo(filters.yearTo?.toString() ?? ''); }, [filters.yearFrom, filters.yearTo]);
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(352, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = Math.max(0, window.innerHeight - rect.bottom - 14);
  const above = Math.max(0, rect.top - 14);
  const openAbove = below < 320 && above > below;
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []);
    if ((event.shiftKey && document.activeElement === controls[0]) || (!event.shiftKey && document.activeElement === controls[controls.length - 1])) {
      event.preventDefault();
      onClose();
      const next = event.shiftKey ? anchor : anchor.nextElementSibling;
      (next instanceof HTMLElement ? next : anchor).focus();
    }
  };
  const set = (patch: Partial<LibraryFilterState>) => onChange({ ...filters, ...patch });
  const checkbox = (label: string, checked: boolean, update: (checked: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--pq-text)]">
      <input type="checkbox" className="shrink-0 accent-[var(--pq-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pq-accent)]" checked={checked} onChange={(event) => update(event.target.checked)} /><span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
    </label>
  );
  const toggleArray = (field: 'tagIds' | 'itemTypes', id: string, checked: boolean) => set({
    [field]: checked ? [...filters[field], id] : filters[field].filter((item) => item !== id),
  });
  const commitYears = () => {
    const valid = (s: string) => !s || /^[1-9]\d{3}$/.test(s);
    const from = yearFrom ? Number(yearFrom) : null;
    const to = yearTo ? Number(yearTo) : null;
    if (valid(yearFrom) && valid(yearTo) && (from === null || to === null || from <= to)) set({ yearFrom: from, yearTo: to });
    else { setYearFrom(filters.yearFrom?.toString() ?? ''); setYearTo(filters.yearTo?.toString() ?? ''); }
  };
  const visibleTags = tags.filter((tag) => tag.name.toLocaleLowerCase().includes(tagSearch.toLocaleLowerCase()));
  return createPortal(
    <div id={id} ref={root} role="dialog" onKeyDown={handleKeyDown} aria-label={l('筛选文献', 'Filter papers')}
      className="fixed z-[10001] overflow-y-auto rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] p-4"
      style={{ left, width, top: openAbove ? undefined : rect.bottom + 6, bottom: openAbove ? window.innerHeight - rect.top + 6 : undefined, maxHeight: openAbove ? above : below, boxShadow: 'var(--pq-shadow-dialog)' }}>
      <div className="space-y-4 [&_fieldset]:min-w-0">
        <fieldset><legend className="text-xs font-semibold text-[var(--pq-text-muted)]">{l('常用', 'Common')}</legend>
          {checkbox(l('仅收藏', 'Favorites only'), filters.favorite, (v) => set({ favorite: v }))}
          {checkbox(l('最近 30 天阅读', 'Read in the last 30 days'), filters.recentlyRead, (v) => set({ recentlyRead: v }))}
        </fieldset>
        <label className="block text-xs font-semibold text-[var(--pq-text-muted)]">{l('阅读状态', 'Reading status')}
          <select className="pq-input mt-1 h-9 w-full px-2 text-sm" value={filters.readStatus ?? ''} onChange={(e) => set({ readStatus: (e.target.value || null) as LibraryFilterState['readStatus'] })}>
            <option value="">{l('全部', 'All')}</option><option value="unread">{l('未读', 'Unread')}</option><option value="reading">{l('在读', 'Reading')}</option><option value="finished">{l('已读完', 'Finished')}</option>
          </select>
        </label>
        <fieldset><legend className="text-xs font-semibold text-[var(--pq-text-muted)]">{l('出版年份', 'Publication year')}</legend>
          <div className="mt-1 flex items-center gap-2">
            <input aria-label={l('起始年份', 'From year')} className="pq-input h-9 min-w-0 flex-1 px-2 text-sm" inputMode="numeric" maxLength={4} value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} onBlur={commitYears} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitYears(); } }} placeholder={l('起始', 'From')} />
            <span>–</span>
            <input aria-label={l('结束年份', 'To year')} className="pq-input h-9 min-w-0 flex-1 px-2 text-sm" inputMode="numeric" maxLength={4} value={yearTo} onChange={(e) => setYearTo(e.target.value)} onBlur={commitYears} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitYears(); } }} placeholder={l('结束', 'To')} />
          </div>
          <div className="mt-2 flex gap-2">{[3, 5].map((n) => <button key={n} type="button" className="pq-button !h-8 px-2 text-xs" onClick={() => set({ yearFrom: new Date().getFullYear() - n + 1, yearTo: new Date().getFullYear() })}>{l(`近 ${n} 年`, `Last ${n} years`)}</button>)}</div>
        </fieldset>
        <fieldset><legend className="text-xs font-semibold text-[var(--pq-text-muted)]">{l('文献类型', 'Paper type')}</legend>
          <div className="grid grid-cols-2">{LIBRARY_ITEM_TYPES.map((id) => <div key={id}>{checkbox(itemTypeLabel(id, l), filters.itemTypes.includes(id), (v) => toggleArray('itemTypes', id, v))}</div>)}</div>
        </fieldset>
        <fieldset><legend className="text-xs font-semibold text-[var(--pq-text-muted)]">{l('标签', 'Tags')}</legend>
          <input aria-label={l('搜索标签', 'Search tags')} className="pq-input mt-1 h-9 w-full px-2 text-sm" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder={l('搜索标签', 'Search tags')} />
          <div className="mt-1 max-h-32 overflow-auto">{visibleTags.map((tag) => <div key={tag.id}>{checkbox(`${tag.name} (${tag.count})`, filters.tagIds.includes(tag.id), (v) => toggleArray('tagIds', tag.id, v))}</div>)}</div>
        </fieldset>
        <fieldset><legend className="text-xs font-semibold text-[var(--pq-text-muted)]">{l('附件', 'Attachments')}</legend>
          {checkbox(l('有 PDF', 'Has PDF'), filters.hasPdf, (v) => set({ hasPdf: v }))}
          {checkbox(l('有译版 PDF', 'Has translated PDF'), filters.hasTranslatedPdf, (v) => set({ hasTranslatedPdf: v }))}
          {checkbox(l('文件缺失', 'Missing file'), filters.missingFile, (v) => set({ missingFile: v }))}
        </fieldset>
        <fieldset><legend className="text-xs font-semibold text-[var(--pq-text-muted)]">{l('处理状态', 'Processing')}</legend>
          {checkbox(l('已生成概览', 'Has overview'), filters.hasSummary, (v) => set({ hasSummary: v }))}
          {checkbox(l('MinerU 已解析', 'MinerU parsed'), filters.mineruParsed, (v) => set({ mineruParsed: v }))}
        </fieldset>
        <label className="block text-xs font-semibold text-[var(--pq-text-muted)]">{l('知识库', 'Knowledge base')}
          <select className="pq-input mt-1 h-9 w-full px-2 text-sm" value={filters.ragMembership} onChange={(e) => set({ ragMembership: e.target.value as LibraryFilterState['ragMembership'] })}>
            <option value="all">{l('全部', 'All')}</option><option value="included">{l('已加入', 'Included')}</option><option value="excluded">{l('已排除', 'Excluded')}</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-[var(--pq-text-muted)]">{l('RAG 索引状态', 'RAG index status')}
          <select
            className="pq-input mt-1 h-9 w-full px-2 text-sm"
            value={filters.ragStatus}
            disabled={ragStatusDisabled}
            title={ragStatusDisabled ? l('演示库不提供 RAG 状态', 'RAG status is unavailable in the demo library') : undefined}
            onChange={(e) => set({ ragStatus: e.target.value as LibraryFilterState['ragStatus'] })}
          >
            <option value="all">{l('全部', 'All')}</option>
            <option value="ready">{l('已索引', 'Indexed')}</option>
            <option value="stale">{l('待更新', 'Update needed')}</option>
            <option value="pending">{l('待索引', 'Pending')}</option>
            <option value="failed">{l('失败', 'Failed')}</option>
            <option value="none">{l('未建立（含未解析）', 'Not built (incl. unparsed)')}</option>
          </select>
          {ragStatusDisabled && <span className="mt-1 block font-normal text-[var(--pq-text-muted)]">{l('演示库不提供 RAG 状态。', 'RAG status is unavailable in the demo library.')}</span>}
        </label>
        <label className="block text-xs font-semibold text-[var(--pq-text-muted)]">{l('来源', 'Source')}
          <select className="pq-input mt-1 h-9 w-full px-2 text-sm" value={filters.source} onChange={(e) => set({ source: e.target.value as LibraryFilterState['source'] })}>
            <option value="">{l('全部', 'All')}</option><option value="local">{l('本地', 'Local')}</option><option value="zotero">{l('Zotero', 'Zotero')}</option>
          </select>
        </label>
      </div>
    </div>, document.body,
  );
}
