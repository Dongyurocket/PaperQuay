import { useEffect, useRef, useState } from 'react';
import { useLocaleText } from '../../i18n/uiLanguage';
import { ChatWorkspacePanel, type ChatWorkspacePanelProps } from './assistantSidebarChat';
import { usePointerDragResize } from './usePointerDragResize';

function clampFloatingPosition(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getInitialFloatingAssistantPosition() {
  if (typeof window === 'undefined') {
    return { x: 720, y: 72 };
  }

  return {
    x: Math.max(12, window.innerWidth - Math.min(1180, window.innerWidth - 24)),
    y: 72,
  };
}

export type FloatingAssistantChatProps = ChatWorkspacePanelProps;

export interface FloatingAssistantPanelProps {
  title: string;
  onAttachAssistant: () => void;
  chatProps: FloatingAssistantChatProps;
}

export function FloatingAssistantPanel({
  title,
  onAttachAssistant,
  chatProps,
}: FloatingAssistantPanelProps) {
  const l = useLocaleText();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const startPanelDrag = usePointerDragResize();
  const [panelPosition, setPanelPosition] = useState(getInitialFloatingAssistantPosition);

  useEffect(() => {
    const handleResize = () => {
      const panelRect = panelRef.current?.getBoundingClientRect();
      const panelWidth = panelRect?.width ?? 960;
      const panelHeight = panelRect?.height ?? 720;
      const maxX = Math.max(12, window.innerWidth - panelWidth - 12);
      const maxY = Math.max(12, window.innerHeight - panelHeight - 12);

      setPanelPosition((current) => ({
        x: clampFloatingPosition(current.x, 12, maxX),
        y: clampFloatingPosition(current.y, 12, maxY),
      }));
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="fixed z-40 flex h-[min(900px,calc(100vh-20px))] min-h-[320px] w-[min(1320px,calc(100vw-20px))] min-w-[320px] max-h-[calc(100vh-20px)] max-w-[calc(100vw-20px)] resize flex-col overflow-hidden rounded-[var(--pq-radius-lg)] border border-[var(--pq-border)] bg-[var(--pq-bg-elevated)] shadow-[var(--pq-shadow-dialog)] backdrop-blur-xl"
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
      }}
    >
      <div
        className="flex cursor-move items-center justify-between gap-3 border-b border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-4 py-3"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) {
            return;
          }

          const panelRect = panelRef.current?.getBoundingClientRect();
          const startX = event.clientX;
          const startY = event.clientY;
          const startPanelX = panelRect?.left ?? panelPosition.x;
          const startPanelY = panelRect?.top ?? panelPosition.y;

          startPanelDrag(event, {
            cursor: 'move',
            onMove: (moveEvent) => {
              const currentRect = panelRef.current?.getBoundingClientRect();
              const currentWidth = currentRect?.width ?? 960;
              const currentHeight = currentRect?.height ?? 720;
              const nextX = startPanelX + moveEvent.clientX - startX;
              const nextY = startPanelY + moveEvent.clientY - startY;
              const maxX = Math.max(12, window.innerWidth - currentWidth - 12);
              const maxY = Math.max(12, window.innerHeight - currentHeight - 12);

              setPanelPosition({
                x: clampFloatingPosition(nextX, 12, maxX),
                y: clampFloatingPosition(nextY, 12, maxY),
              });
            },
          });
        }}
      >
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--pq-text-faint)]">
            {l('独立文档问答', 'Detached Document Chat')}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-[var(--pq-text)]">{title}</div>
        </div>
        <button
          type="button"
          onClick={onAttachAssistant}
          className="pq-button px-3 py-2 text-xs"
        >
          {l('停靠回右侧', 'Dock Back')}
        </button>
      </div>

      <div className="min-h-0 flex-1 bg-[var(--pq-bg-primary)]">
        <ChatWorkspacePanel
          {...chatProps}
          assistantDetached
          layoutMode="workspace"
        />
      </div>
    </div>
  );
}
