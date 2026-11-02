import { useEffect } from 'react';

/**
 * 全局动作注册表与快捷键。
 *
 * 背景：此前全仓库没有任何快捷键注册表，桌面应用的键盘通道完全缺失
 * （`grep -i shortcut` 为空），每个面板各自处理 Enter/Escape。
 *
 * 设计取舍：
 *   - 动作由各 feature 通过 `registerCommands()` 注册（幂等，按 id 覆盖）；
 *   - 快捷键只声明在注册表里，统一由 `useGlobalShortcuts()` 在 App 层监听，
 *     避免各组件各自 window.addEventListener 造成重复触发与优先级混乱；
 *   - 输入框内不触发单键快捷方式，避免打断写作。
 */

export interface AppCommand {
  id: string;
  /** 面板里显示的名称，同时用于命令面板搜索。 */
  title: string;
  /** 命令面板里的分组标签，如「导航」「编辑」。 */
  group?: string;
  /** 命令面板里的补充说明。 */
  subtitle?: string;
  keywords?: string[];
  /** 例如 "mod+k"、"mod+w"；mod 在 Windows/Linux 为 Ctrl，macOS 为 Meta。 */
  shortcut?: string;
  run: () => void | Promise<void>;
}

const commands = new Map<string, AppCommand>();
const listeners = new Set<() => void>();

export function registerCommands(next: AppCommand[]): () => void {
  for (const command of next) {
    commands.set(command.id, command);
  }

  for (const listener of listeners) listener();

  return () => {
    for (const command of next) {
      // 只在仍是同一条注册时移除，避免旧组件的清理覆盖后来者的同名命令。
      if (commands.get(command.id) === command) {
        commands.delete(command.id);
      }
    }

    for (const listener of listeners) listener();
  };
}

export function listCommands(): AppCommand[] {
  return Array.from(commands.values());
}

export function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function runCommand(id: string) {
  const command = commands.get(id);

  if (!command) return Promise.resolve();

  return Promise.resolve(command.run());
}

export function isMacPlatform() {
  // 兼容无 window 的运行环境（Node 单测），避免直接访问全局对象导致抛错。
  if (typeof window === 'undefined') return false;

  const bridgePlatform = window.paperquay?.platform;

  if (bridgePlatform) {
    return bridgePlatform === 'darwin';
  }

  return /Mac|Macintosh/i.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`);
}

export interface ParsedShortcut {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export function parseShortcut(value: string): ParsedShortcut {
  const parts = value.toLowerCase().split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.find((part) => !['mod', 'ctrl', 'cmd', 'meta', 'shift', 'alt', 'option'].includes(part)) ?? '';

  return {
    key,
    mod: parts.some((part) => ['mod', 'ctrl', 'cmd', 'meta'].includes(part)),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
  };
}

/** 把 "mod+k" 渲染成当前平台的显示形式（⌘K / Ctrl+K）。 */
export function formatShortcut(value: string): string {
  const parsed = parseShortcut(value);
  const mac = isMacPlatform();
  const pieces: string[] = [];

  if (parsed.mod) pieces.push(mac ? '⌘' : 'Ctrl');
  if (parsed.shift) pieces.push(mac ? '⇧' : 'Shift');
  if (parsed.alt) pieces.push(mac ? '⌥' : 'Alt');
  pieces.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);

  return mac ? pieces.join('') : pieces.join('+');
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  if (target.isContentEditable) return true;

  const tag = target.tagName.toLowerCase();

  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

interface GlobalShortcutOptions {
  /** Cmd/Ctrl+K：打开或关闭命令面板（再次按下即关闭）。 */
  onCommandPalette: () => void;
}

export function useGlobalShortcuts({ onCommandPalette }: GlobalShortcutOptions) {
  useEffect(() => {
    const mac = isMacPlatform();

    const handler = (event: KeyboardEvent) => {
      const modPressed = mac ? event.metaKey : event.ctrlKey;

      // 命令面板开关：面板打开时由面板自己处理 Escape。
      if (modPressed && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onCommandPalette();
        return;
      }

      if (!modPressed || event.altKey || event.shiftKey) return;

      const key = event.key.toLowerCase();

      // Cmd/Ctrl+W 关闭当前标签：无输入焦点时也要生效；输入框内不拦截，交给浏览器行为。
      if (key === 'w' && !isEditableTarget(event.target)) {
        const command = Array.from(commands.values()).find((item) => item.shortcut && parseShortcut(item.shortcut).key === 'w' && parseShortcut(item.shortcut).mod);

        if (command) {
          event.preventDefault();
          void command.run();
        }

        return;
      }

      if (key === ',' && !isEditableTarget(event.target)) {
        const command = Array.from(commands.values()).find((item) => item.shortcut && parseShortcut(item.shortcut).key === ',');

        if (command) {
          event.preventDefault();
          void command.run();
        }
      }
    };

    window.addEventListener('keydown', handler);

    return () => window.removeEventListener('keydown', handler);
  }, [onCommandPalette]);
}
