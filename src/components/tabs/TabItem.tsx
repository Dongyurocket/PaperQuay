import { FileText, Library, NotebookText, X } from 'lucide-react';
import type { DragEvent, MouseEvent } from 'react';
import { useLocaleText } from '../../i18n/uiLanguage';
import { noteDisplayTitle } from '../../features/notes/notesDisplay';
import type { AppTab } from '../../stores/useTabsStore';
import { cn } from '../../utils/cn';

export type TabDropPosition = 'before' | 'after';

interface TabItemProps {
  tab: AppTab;
  active: boolean;
  dragging: boolean;
  dropPosition: TabDropPosition | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, tabId: string) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, tabId: string) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>, tabId: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, tabId: string) => void;
  onDragEnd: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, tab: AppTab) => void;
}

export function tabPanelId(tab: AppTab): string {
  if (tab.type === 'graph') return 'pq-workspace-panel-graph';
  if (tab.type === 'notes' || tab.type === 'note') return 'pq-workspace-panel-notes';
  return 'pq-workspace-panel-library';
}

export function tabElementId(tabId: string): string {
  return `pq-tab-${tabId}`;
}

/** 静态标签（笔记/图谱）在展示层本地化；文献与笔记标签保留用户可见标题。 */
export function displayTabTitle(tab: AppTab, l: <T,>(zh: T, en: T) => T): string {
  if (tab.type === 'notes') return l('笔记', 'Notes');
  if (tab.type === 'graph') return l('知识图谱', 'Knowledge Graph');
  // 空标题与旧版中文哨兵都显示为当前语言的「未命名笔记」。
  if (tab.type === 'note') return noteDisplayTitle(tab.title, l);
  return tab.title;
}

function TabItem({
  tab,
  active,
  dragging,
  dropPosition,
  onSelect,
  onClose,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onContextMenu,
}: TabItemProps) {
  const l = useLocaleText();
  const Icon =
    tab.type === 'library'
      ? Library
      : tab.type === 'notes' || tab.type === 'note'
        ? NotebookText
        : FileText;
  const closable = tab.type !== 'library';
  const isHomeTab = tab.type === 'library';
  const title = displayTabTitle(tab, l);

  const handleClose = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose(tab.id);
  };

  return (
    <div
      role="presentation"
      draggable
      onDragStart={(event) => onDragStart(event, tab.id)}
      onDragOver={(event) => onDragOver(event, tab.id)}
      onDragLeave={(event) => onDragLeave(event, tab.id)}
      onDrop={(event) => onDrop(event, tab.id)}
      onDragEnd={onDragEnd}
      onContextMenu={(event) => onContextMenu(event, tab)}
      className={cn(
        'group relative mr-1 flex h-8 min-w-0 cursor-default items-center rounded-t-[var(--pq-radius-sm)] border px-3 text-[13px] transition',
        isHomeTab ? 'w-[164px] flex-none' : 'min-w-[128px] max-w-[220px] flex-1 basis-0',
        dragging ? 'opacity-45' : '',
        active
          ? 'border-[var(--pq-border)] border-b-[var(--pq-surface-1)] bg-[var(--pq-surface-1)] text-[var(--pq-text)] shadow-[0_1px_0_rgba(255,255,255,0.64)_inset]'
          : 'border-transparent bg-transparent text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
      )}
    >
      {dropPosition === 'before' ? (
        <span className="pointer-events-none absolute -left-0.5 bottom-1 top-1 w-0.5 rounded-full bg-[var(--pq-accent)]" />
      ) : null}
      {dropPosition === 'after' ? (
        <span className="pointer-events-none absolute -right-0.5 bottom-1 top-1 w-0.5 rounded-full bg-[var(--pq-accent)]" />
      ) : null}
      <div
        role="tab"
        id={tabElementId(tab.id)}
        aria-selected={active}
        aria-controls={tabPanelId(tab)}
        tabIndex={active ? 0 : -1}
        onClick={() => onSelect(tab.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(tab.id);
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
      >
        <span
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center',
            active ? 'text-[var(--pq-accent)]' : 'text-[var(--pq-text-faint)] group-hover:text-[var(--pq-text-muted)]',
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      </div>
      {tab.type === 'note' && tab.externalUpdate ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pq-accent)]"
          title={l('此笔记有外部更新', 'This note has external updates')}
          aria-label={l('此笔记有外部更新', 'This note has external updates')}
        />
      ) : null}
      {closable ? (
        // 关闭按钮是 tab 的兄弟而不是子元素：tablist 只允许 tab 子项，
        // tab 内再有可聚焦控件会触发 aria-required-children / nested-interactive。
        // 鼠标仍可点此按钮；键盘/读屏用户用标签右键菜单里的「关闭标签」。
        <button
          type="button"
          draggable={false}
          tabIndex={-1}
          aria-hidden="true"
          onClick={handleClose}
          title={l(`关闭 ${title}`, `Close ${title}`)}
          className={cn(
            'inline-flex h-5 w-5 shrink-0 cursor-default items-center justify-center rounded text-[var(--pq-text-faint)] transition hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

export default TabItem;
