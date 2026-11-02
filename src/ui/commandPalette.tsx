import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, CornerDownLeft, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '../utils/cn';
import { useLocaleText } from '../i18n/uiLanguage';
import { formatShortcut, listCommands, subscribeCommands, type AppCommand } from './commands';

/**
 * 命令面板（Cmd/Ctrl+K）。
 *
 * 对熟练用户来说，「可搜索的动作清单」比引导式教程更实用：不用记快捷键，
 * 也不用满界面找按钮。动作来自 src/ui/commands.ts 的注册表，面板自身不硬编码业务。
 */

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const l = useLocaleText();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => subscribeCommands(() => setRevision((value) => value + 1)), []);

  const commands = useMemo<AppCommand[]>(() => {
    void revision;

    return listCommands().sort((left, right) => (left.group ?? '').localeCompare(right.group ?? '') || left.title.localeCompare(right.title));
  }, [revision]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) return commands;

    return commands.filter((command) => {
      const haystack = [command.title, command.subtitle ?? '', command.group ?? '', ...(command.keywords ?? [])]
        .join(' ')
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return;
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => (filtered.length === 0 ? 0 : (current + 1) % filtered.length));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => (filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length));
        return;
      }

      if (event.key === 'Enter') {
        const target = filtered[activeIndex];

        if (!target) return;

        event.preventDefault();
        onClose();
        void target.run();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [activeIndex, filtered, onClose, open]);

  useEffect(() => {
    if (!open) return;

    const active = listRef.current?.querySelector<HTMLElement>(`[data-command-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] dark:bg-black/55" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={l('命令面板', 'Command palette')}
        className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--pq-radius-lg)] border border-[var(--pq-border)] bg-[var(--pq-bg-primary)] shadow-[var(--pq-shadow-dialog)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--pq-border)] px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-[var(--pq-text-faint)]" strokeWidth={1.9} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={l('搜索操作、文献或笔记…', 'Search commands, papers, or notes…')}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]"
            aria-label={l('搜索操作', 'Search commands')}
          />
          <kbd className="pq-chip shrink-0 px-1.5 py-0.5 text-[11px] text-[var(--pq-text-faint)]">Esc</kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label={l('可用操作', 'Available commands')}>
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--pq-text-faint)]">
              {l('没有匹配的操作', 'No matching commands')}
            </div>
          ) : (
            filtered.map((command, index) => {
              const Icon = Command;
              const previousGroup = filtered[index - 1]?.group;
              const showGroup = Boolean(command.group) && command.group !== previousGroup;

              return (
                <div key={command.id}>
                  {showGroup ? (
                    <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--pq-text-faint)]">
                      {command.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    data-command-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      onClose();
                      void command.run();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[var(--pq-radius-sm)] px-2.5 py-2 text-left transition',
                      index === activeIndex ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-text)]' : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)]',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.9} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{command.title}</span>
                    {command.shortcut ? (
                      <kbd className="shrink-0 text-[11px] text-[var(--pq-text-faint)]">{formatShortcut(command.shortcut)}</kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--pq-border)] px-3 py-1.5 text-[11px] text-[var(--pq-text-faint)]">
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" strokeWidth={2} />
            {l('执行', 'Run')}
          </span>
          <span>{l('↑↓ 选择 · Esc 关闭', '↑↓ to move · Esc to close')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
