import { ArrowRightToLine, MousePointer2, X, XCircle } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { AppTab } from '../../stores/useTabsStore';
import TabItem, { displayTabTitle, tabElementId, type TabDropPosition } from './TabItem';

const TAB_DRAG_MIME = 'application/x-paperquay-tab-id';

interface TabBarProps {
  tabs: AppTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorder: (sourceTabId: string, targetTabId: string, position: TabDropPosition) => void;
}

function getDropPosition(event: ReactDragEvent<HTMLDivElement>): TabDropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

function TabBar({ tabs, activeTabId, onSelect, onClose, onReorder }: TabBarProps) {
  const l = useLocaleText();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ tabId: string; position: TabDropPosition } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ tab: AppTab; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!draggingTabId) {
      return undefined;
    }

    const handleWindowTabDrag = (event: DragEvent) => {
      const target = event.target;
      const insideTabBar = target instanceof Node && Boolean(rootRef.current?.contains(target));

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }

      if (!insideTabBar) {
        event.stopPropagation();
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      const target = event.target;
      const insideTabBar = target instanceof Node && Boolean(rootRef.current?.contains(target));

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }

      if (!insideTabBar) {
        event.stopPropagation();
      }

      setDraggingTabId(null);
      setDropTarget(null);
    };

    const handleWindowDragEnd = () => {
      setDraggingTabId(null);
      setDropTarget(null);
    };

    window.addEventListener('dragenter', handleWindowTabDrag, true);
    window.addEventListener('dragover', handleWindowTabDrag, true);
    window.addEventListener('drop', handleWindowDrop, true);
    window.addEventListener('dragend', handleWindowDragEnd, true);

    return () => {
      window.removeEventListener('dragenter', handleWindowTabDrag, true);
      window.removeEventListener('dragover', handleWindowTabDrag, true);
      window.removeEventListener('drop', handleWindowDrop, true);
      window.removeEventListener('dragend', handleWindowDragEnd, true);
    };
  }, [draggingTabId]);

  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(TAB_DRAG_MIME, tabId);
    setDraggingTabId(tabId);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
    const sourceTabId = draggingTabId || event.dataTransfer.getData(TAB_DRAG_MIME);
    if (!sourceTabId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (sourceTabId === tabId) {
      setDropTarget((current) => (current?.tabId === tabId ? null : current));
      return;
    }

    const position = getDropPosition(event);
    setDropTarget((current) =>
      current?.tabId === tabId && current.position === position
        ? current
        : { tabId, position },
    );
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setDropTarget((current) => (current?.tabId === tabId ? null : current));
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
    event.preventDefault();
    const sourceTabId = event.dataTransfer.getData(TAB_DRAG_MIME) || draggingTabId;
    const position = dropTarget?.tabId === tabId ? dropTarget.position : getDropPosition(event);

    setDraggingTabId(null);
    setDropTarget(null);

    if (!sourceTabId || sourceTabId === tabId) {
      return;
    }

    onReorder(sourceTabId, tabId, position);
  };

  const handleDragEnd = () => {
    setDraggingTabId(null);
    setDropTarget(null);
  };

  const handleBarDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggingTabId && !event.dataTransfer.types.includes(TAB_DRAG_MIME)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>, tab: AppTab) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingTabId(null);
    setDropTarget(null);
    setContextMenu({ tab, x: event.clientX, y: event.clientY });
  };

  // E4：tablist 的方向键导航（roving tabindex 由 TabItem 的 active 控制）。
  const handleTabListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    if (currentIndex < 0) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % tabs.length
          : (currentIndex - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;

    onSelect(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(tabElementId(nextTab.id))?.focus();
    });
  };

  const contextMenuEntries = useMemo<ContextMenuEntry[]>(() => {
    if (!contextMenu) return [];

    const targetTab = contextMenu.tab;
    const targetIndex = tabs.findIndex((tab) => tab.id === targetTab.id);
    const closable = targetTab.type !== 'library';
    const closableTabs = tabs.filter((tab) => tab.type !== 'library');
    const otherClosableTabs = closableTabs.filter((tab) => tab.id !== targetTab.id);
    const rightClosableTabs = targetIndex >= 0
      ? tabs.slice(targetIndex + 1).filter((tab) => tab.type !== 'library')
      : [];

    return [
      {
        id: 'activate-tab',
        label: l('切换到此标签', 'Switch to this tab'),
        tone: 'accent',
        icon: <MousePointer2 className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: () => onSelect(targetTab.id),
      },
      { type: 'separator', id: 'tab-close-separator' },
      {
        id: 'close-tab',
        label: l('关闭标签', 'Close tab'),
        disabled: !closable,
        tone: 'danger',
        icon: <X className="h-4 w-4" strokeWidth={1.9} />,
        onSelect: () => onClose(targetTab.id),
      },
      {
        id: 'close-other-tabs',
        label: l('关闭其他标签', 'Close other tabs'),
        disabled: otherClosableTabs.length === 0,
        icon: <XCircle className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: () => {
          for (const tab of otherClosableTabs) {
            onClose(tab.id);
          }
          onSelect(targetTab.id);
        },
      },
      {
        id: 'close-tabs-to-right',
        label: l('关闭右侧标签', 'Close tabs to the right'),
        disabled: rightClosableTabs.length === 0,
        icon: <ArrowRightToLine className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: () => {
          for (const tab of rightClosableTabs) {
            onClose(tab.id);
          }
          onSelect(targetTab.id);
        },
      },
    ];
  }, [contextMenu, l, onClose, onSelect, tabs]);

  return (
    <div
      ref={rootRef}
      className="flex h-9 shrink-0 items-end border-b border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-1 pt-1"
    >
      <div
        role="tablist"
        aria-label={l('打开的标签', 'Open tabs')}
        className="flex min-w-0 flex-1 items-end overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onDragOver={handleBarDragOver}
        onKeyDown={handleTabListKeyDown}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            dragging={draggingTabId === tab.id}
            dropPosition={dropTarget?.tabId === tab.id ? dropTarget.position : null}
            onSelect={onSelect}
            onClose={onClose}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={displayTabTitle(contextMenu.tab, l)}
          entries={contextMenuEntries}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

export default TabBar;
