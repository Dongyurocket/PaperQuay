import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { ArrowDownUp, Check, FilePlus2, Filter, LayoutGrid, MoreHorizontal, Search, X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { LibraryTagCount, ListPapersRequest } from '../../../types/library';
import { registerCommands } from '../../../ui/commands';
import { Menu, type MenuEntry } from '../../../ui/menu';
import { toast } from '../../../ui/toast';
import { DEFAULT_LIBRARY_FILTERS, describeActiveFilters, removeLibraryFilter, type LibraryFilterState } from '../libraryFilters';
import type { SelectionCheckState } from '../paperSelection';
import { persistPaperTitleDisplayMode, type PaperTitleDisplayMode } from '../titleDisplay';
import LiteratureFilterPopover from './LiteratureFilterPopover';

interface Props {
  working: boolean;
  refreshing?: boolean;
  total: number;
  libraryTotal: number;
  selectAllState: SelectionCheckState;
  onToggleSelectAll?: () => void;
  search: string;
  onSearch: (value: string) => void;
  filters: LibraryFilterState;
  onFilters: (value: LibraryFilterState) => void;
  /** 演示库没有真实 RAG 索引，禁用「RAG 索引状态」筛选。 */
  ragStatusDisabled?: boolean;
  tags: LibraryTagCount[];
  sortBy: NonNullable<ListPapersRequest['sortBy']>;
  sortDirection: NonNullable<ListPapersRequest['sortDirection']>;
  onSort: (field: NonNullable<ListPapersRequest['sortBy']>, direction: NonNullable<ListPapersRequest['sortDirection']>) => void;
  titleMode: PaperTitleDisplayMode;
  onTitleMode: (value: PaperTitleDisplayMode) => void;
  showHeatmap: boolean;
  onHeatmap: (value: boolean) => void;
  compact: boolean;
  onCompact: (value: boolean) => void;
  onImport: () => void;
  onAudit: () => void;
  onRefresh: () => void;
  statusMessage: string;
  error: string;
}

export default function LiteratureToolbar(props: Props) {
  const l = useLocaleText();
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<HTMLButtonElement>(null);
  const filterId = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[]; anchor: HTMLButtonElement; kind: 'sort' | 'view' | 'more' } | null>(null);
  const active = describeActiveFilters(props.filters, l, props.tags);
  useEffect(() => registerCommands([{
    id: 'library.focus-search', title: l('搜索文献', 'Search papers'), group: l('文库', 'Library'),
    isAvailable: () => Boolean(searchRef.current?.getClientRects().length),
    shortcut: 'mod+f', run: () => { searchRef.current?.focus(); searchRef.current?.select(); },
  }]), [l]);
  useEffect(() => { if (props.error) toast({ tone: 'error', message: props.error }); }, [props.error]);
  useEffect(() => { if (props.statusMessage && props.statusMessage !== props.error) toast({ tone: 'info', message: props.statusMessage }); }, [props.error, props.statusMessage]);
  const showMenu = (event: MouseEvent<HTMLButtonElement>, entries: MenuEntry[], kind: 'sort' | 'view' | 'more') => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFilterOpen(false);
    setMenu({ x: rect.left, y: rect.bottom + 4, entries, anchor: event.currentTarget, kind });
  };
  const mark = (selected: boolean) => <span aria-hidden="true">{selected && <Check className="h-4 w-4" />}</span>;
  const sortOptions: Array<[NonNullable<ListPapersRequest['sortBy']>, string]> = [
    ['manual', l('手动排序', 'Manual order')], ['title', l('标题', 'Title')],
    ['author', l('作者', 'Author')], ['year', l('出版时间', 'Publication year')],
    ['importedAt', l('添加时间', 'Date added')], ['updatedAt', l('更新时间', 'Date updated')],
    ['lastReadAt', l('最近阅读', 'Recently read')],
  ];
  const sortLabel = sortOptions.find(([field]) => field === props.sortBy)?.[1] ?? l('排序', 'Sort');
  const sortEntries: MenuEntry[] = [
    ...sortOptions.map(([field, label]) => ({
      id: field, label, icon: mark(field === props.sortBy), checked: field === props.sortBy,
      onSelect: () => props.onSort(field, field === 'manual' ? 'asc'
        : field === 'lastReadAt' && props.sortBy !== field ? 'desc' : props.sortDirection),
    })),
    { type: 'separator', id: 'sort-direction-separator' },
    ...(['asc', 'desc'] as const).map((direction) => ({
      id: direction, label: direction === 'asc' ? l('升序', 'Ascending') : l('降序', 'Descending'),
      icon: mark(props.sortDirection === direction), checked: props.sortDirection === direction,
      disabled: props.sortBy === 'manual', onSelect: () => props.onSort(props.sortBy, direction),
    })),
  ];
  const viewEntries: MenuEntry[] = [
    ...(['both', 'zh', 'original'] as const).map((mode) => ({
      id: mode,
      label: mode === 'both' ? l('中英标题', 'Bilingual titles') : mode === 'zh' ? l('中文标题', 'Chinese titles') : l('原文标题', 'Original titles'),
      icon: mark(props.titleMode === mode), checked: props.titleMode === mode,
      onSelect: () => { props.onTitleMode(mode); persistPaperTitleDisplayMode(mode); },
    })),
    { type: 'separator', id: 'view-separator' },
    { id: 'heatmap', label: l('显示阅读热力列', 'Show reading heatmap'), icon: mark(props.showHeatmap), checked: props.showHeatmap, onSelect: () => props.onHeatmap(!props.showHeatmap) },
    { id: 'comfortable', label: l('舒适密度', 'Comfortable density'), icon: mark(!props.compact), checked: !props.compact, onSelect: () => props.onCompact(false) },
    { id: 'compact', label: l('紧凑密度', 'Compact density'), icon: mark(props.compact), checked: props.compact, onSelect: () => props.onCompact(true) },
  ];
  const moreEntries: MenuEntry[] = [
    { id: 'audit', label: l('存储体检', 'Storage audit'), disabled: props.working, onSelect: props.onAudit },
    { id: 'refresh', label: l('刷新', 'Refresh'), disabled: props.working, onSelect: props.onRefresh },
  ];
  return <header className="pq-toolbar min-w-0 px-3 py-2 [container-type:inline-size]">
    <div className="flex min-w-0 flex-nowrap items-center gap-2 whitespace-nowrap">
      <button type="button" role="checkbox" aria-checked={props.selectAllState === 'all' ? true : props.selectAllState === 'partial' ? 'mixed' : false}
        aria-label={l(`全选 ${props.total}`, `Select all ${props.total}`)}
        title={l('全选当前结果', 'Select all results')}
        disabled={props.working || props.total === 0 || !props.onToggleSelectAll} onClick={props.onToggleSelectAll}
        className="pq-button !h-8 w-8 shrink-0 px-0 text-xs [@container(min-width:480px)]:w-auto [@container(min-width:480px)]:px-2">
        <span aria-hidden="true">{props.selectAllState === 'all' ? '☑' : props.selectAllState === 'partial' ? '◩' : '□'}</span><span className="hidden [@container(min-width:480px)]:inline">{l('全选', 'Select all')}&nbsp;</span><span className="hidden [@container(min-width:480px)]:inline">{props.total}</span>
      </button>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pq-text-faint)]" />
        <input ref={searchRef} value={props.search} onChange={(e) => props.onSearch(e.target.value)} aria-label={l('搜索文献', 'Search papers')}
          placeholder={l('搜索标题、作者、摘要、DOI…', 'Search title, author, abstract, DOI…')}
          className="pq-input !h-8 w-full pl-8 pr-8 text-sm" />
        {props.search && <button type="button" onClick={() => { props.onSearch(''); searchRef.current?.focus(); }} aria-label={l('清除搜索', 'Clear search')} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[var(--pq-radius-sm)] p-1 text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)]"><X className="h-4 w-4" /></button>}
      </div>
      <span role="status" aria-live="polite" aria-atomic="true" className="shrink-0 text-xs text-[var(--pq-text-muted)]">
        {props.refreshing ? l('正在刷新…', 'Refreshing…') : ''}
      </span>
      <button ref={filterRef} type="button" aria-label={active.length ? l(`筛选（已生效 ${active.length} 项）`, `Filter (${active.length} active)`) : l('筛选', 'Filter')} aria-haspopup="dialog" aria-controls={filterOpen ? filterId : undefined} aria-expanded={filterOpen} onClick={() => { setMenu(null); setFilterOpen(!filterOpen); }} className="pq-button relative !h-8 w-8 shrink-0 px-0 text-xs [@container(min-width:480px)]:w-auto [@container(min-width:480px)]:px-2" title={l('筛选', 'Filter')}><Filter className="h-4 w-4" /><span className="hidden [@container(min-width:640px)]:inline">{l('筛选', 'Filter')}</span>{active.length > 0 && <span className="pointer-events-none absolute -right-1 -top-1 min-w-4 rounded-[var(--pq-radius-sm)] bg-[var(--pq-surface-1)] px-1 text-center text-[11px] leading-4 text-[var(--pq-accent-strong)] ring-1 ring-[var(--pq-border)] [@container(min-width:480px)]:static [@container(min-width:480px)]:bg-[var(--pq-accent-soft)] [@container(min-width:480px)]:text-xs [@container(min-width:480px)]:ring-0">{active.length}</span>}</button>
      <button type="button" aria-label={l(`排序：${sortLabel}`, `Sort: ${sortLabel}`)} aria-haspopup="menu" aria-expanded={menu?.kind === 'sort'} onClick={(event) => showMenu(event, sortEntries, 'sort')} className="pq-button !h-8 w-8 shrink-0 px-0 text-xs [@container(min-width:800px)]:w-auto [@container(min-width:800px)]:px-2" title={l('排序', 'Sort')}><ArrowDownUp className="h-4 w-4" /><span className="hidden max-w-[120px] truncate [@container(min-width:800px)]:inline">{sortLabel}</span></button>
      <button ref={viewRef} type="button" aria-haspopup="menu" aria-expanded={menu?.kind === 'view'} onClick={(event) => showMenu(event, viewEntries, 'view')} className="pq-icon-button !hidden !h-8 !w-8 shrink-0 [@container(min-width:480px)]:!inline-flex" title={l('视图', 'View')} aria-label={l('视图', 'View')}><LayoutGrid className="h-4 w-4" /></button>
      <button type="button" disabled={props.working} onClick={props.onImport} className="pq-button-primary !h-8 w-8 shrink-0 px-0 text-xs [@container(min-width:640px)]:w-auto [@container(min-width:640px)]:px-2" title={l('导入 PDF', 'Import PDF')}><FilePlus2 className="h-4 w-4" /><span className="hidden [@container(min-width:640px)]:inline">{l('导入 PDF', 'Import PDF')}</span></button>
      <button type="button" aria-haspopup="menu" aria-expanded={menu?.kind === 'more'} onClick={(event) => showMenu(event, viewRef.current?.getClientRects().length ? moreEntries : [...viewEntries, { type: 'separator', id: 'more-view-separator' }, ...moreEntries], 'more')} className="pq-icon-button !h-8 !w-8 shrink-0" title={l('更多', 'More')} aria-label={l('更多', 'More')}><MoreHorizontal className="h-4 w-4" /></button>
    </div>
    {active.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {active.map((item) => <button key={item.id} type="button" onClick={() => props.onFilters(removeLibraryFilter(props.filters, item.id))} className="pq-chip inline-flex min-w-0 max-w-full items-center gap-1 !rounded-[var(--pq-radius-sm)] px-2 py-1" title={item.label} aria-label={l(`移除筛选：${item.label}`, `Remove filter: ${item.label}`)}><span className="truncate">{item.label}</span><X className="h-3 w-3 shrink-0" /></button>)}
      <button type="button" className="text-[var(--pq-accent)] hover:underline" onClick={() => props.onFilters({ ...DEFAULT_LIBRARY_FILTERS, tagIds: [], itemTypes: [] })}>{l('清除全部', 'Clear all')}</button>
      <span className="ml-auto text-[var(--pq-text-muted)]">{l(`显示 ${props.total} / ${props.libraryTotal}`, `Showing ${props.total} / ${props.libraryTotal}`)}</span>
    </div>}
    {filterOpen && filterRef.current && <LiteratureFilterPopover id={filterId} anchor={filterRef.current} filters={props.filters} tags={props.tags} ragStatusDisabled={props.ragStatusDisabled} onChange={props.onFilters} onClose={() => setFilterOpen(false)} />}
    {menu && <Menu x={menu.x} y={menu.y} entries={menu.entries} keyboardAnchor={menu.anchor} onClose={() => setMenu(null)} />}
  </header>;
}
